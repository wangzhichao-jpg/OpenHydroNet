// preview.5 Windows acceptance driver (PC). Usage: node drive.cjs main|close|save
// Drives the unmodified packaged OpenHydroNet.exe; native file pickers / message boxes are answered by the
// driver and every call is logged to dialogs.jsonl (text + buttons + choice).
const L = require('./lib.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIALOG_LOG = path.join(__dirname, L.TAG ? `dialogs-${L.TAG}.jsonl` : 'dialogs.jsonl');

async function start(tag) {
  const t0 = Date.now();
  const { app, page } = await L.launch();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await app.evaluate(({ dialog }, [logFile, tag]) => {
    const fs = process.getBuiltinModule('fs');
    const orig = dialog.showMessageBox;
    dialog.showMessageBox = async (...a) => {
      const r = await orig(...a);
      const m = globalThis.acc.messages.at(-1);
      fs.appendFileSync(logFile, JSON.stringify({ session: tag, at: new Date().toISOString(), ...m }) + '\n');
      return r;
    };
  }, [DIALOG_LOG, tag]);
  await page.locator('[data-testid="start-example"], [data-testid="select-PU1"]').first().waitFor({ timeout: 60000 });
  return { app, page, errors, startupMs: Date.now() - t0 };
}
async function openExample(page) {
  await page.getByTestId('start-example').click();
  await page.getByTestId('select-PU1').waitFor();
}
async function calculate(page) {
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 60000 });
}
async function resultRows(page) {
  await page.getByRole('button', { name: '计算结果', exact: true }).click();
  const t = page.locator('.bottom-content > table').first();
  await t.waitFor();
  const head = await t.locator('thead th').allInnerTexts();
  const rows = await t.locator('tbody tr').allInnerTexts();
  return { head, rows };
}
const pick = (rows, name) => (rows.find((r) => r.startsWith(name)) || '').split('\t');
async function step(item, fn, page) {
  try {
    const data = await fn();
    L.record(item, { ok: true, ...data });
    return true;
  } catch (e) {
    L.record(item, { ok: false, error: String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e) });
    if (page && !page.isClosed()) await L.shot(page, item + '-失败').catch(() => {});
    return false;
  }
}
async function blurAndUndo(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await sleep(300);
}
async function waitExit(app, page, answer) {
  await app.evaluate((_e, a) => { globalThis.acc.answer = a; }, answer);
  const closing = app.waitForEvent('close', { timeout: 60000 });
  const t = Date.now();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closing;
  return Date.now() - t;
}

async function main() {
  const { app, page, errors, startupMs } = await start('main');
  const analysis = () => page.getByRole('button', { name: '分析', exact: true }).click();
  try {
    await step('P0-1b', async () => {
      await openExample(page);
      const header = await page.locator('header').first().innerText();
      await page.getByRole('button', { name: '检查', exact: true }).click();
      await sleep(800);
      const status = await page.getByRole('status').first().innerText().catch(() => '');
      await calculate(page);
      const r = await resultRows(page);
      await L.shot(page, 'P0-1-公开示例计算通过');
      const pu1 = pick(r.rows, '循环泵'), t1 = pick(r.rows, '用户末端 1'), t2 = pick(r.rows, '用户末端 2');
      const ok = Math.abs(L.num(t1[1]) - 17.5) < 0.01 && Math.abs(L.num(t2[1]) - 13.679) < 0.01 && Math.abs(L.num(pu1[1]) - 31.178) < 0.01;
      if (!ok) throw new Error('values differ: ' + JSON.stringify({ head: r.head, pu1, t1, t2 }));
      return { startupMs, header: header.replace(/\n/g, ' | '), checkStatus: status, head: r.head, pu1, t1, t2 };
    }, page);

    await step('P0-2', async () => {
      await analysis();
      const scan = page.getByTestId('scan-view');
      await scan.getByLabel('扫描参数').selectOption({ value: 'PU1:speed' });
      for (const [l, v] of [['起点', '0.6'], ['终点', '1.4'], ['点数', '5']]) {
        await scan.getByLabel(l, { exact: true }).fill(v);
        await scan.getByLabel(l, { exact: true }).press('Enter');
      }
      await scan.getByRole('button', { name: '运行扫描（5 点）' }).click();
      const table = page.getByTestId('scan-table');
      await table.waitFor({ timeout: 60000 });
      const head = await table.locator('thead th').allInnerTexts();
      const rows = await table.locator('tbody tr').allInnerTexts();
      const t2 = rows.map((r) => L.num(r.split('\t')[2]));
      const chart = page.getByRole('img', { name: /参数扫描曲线/ });
      const circles = await chart.locator('circle').count(), lines = await chart.locator('polyline').count();
      await L.shot(page, 'P0-2-扫描表格与曲线');
      const csvDir = path.join(L.EXPORTS, 'CSV');
      fs.mkdirSync(csvDir, { recursive: true });
      await app.evaluate((_e, d) => { globalThis.acc.nextSaveDir = d; }, csvDir);
      await app.evaluate(({ dialog }) => {
        const prev = dialog.showSaveDialog;
        dialog.showSaveDialog = async (w, o) => {
          const opts = o || w;
          globalThis.acc.nextSave = globalThis.acc.nextSaveDir + '\\' + opts.defaultPath;
          dialog.showSaveDialog = prev;
          return prev(w, o);
        };
      });
      await scan.getByRole('button', { name: '导出 CSV' }).click();
      await scan.getByText('已导出 CSV（当前显示单位）').waitFor({ timeout: 20000 });
      const saves = await app.evaluate(() => globalThis.acc.saves);
      const csvPath = saves.at(-1).filePath;
      const buf = fs.readFileSync(csvPath);
      const excel = execFileSync('powershell', ['-NoProfile', '-Command',
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $x=New-Object -ComObject Excel.Application; $x.DisplayAlerts=$false; ` +
        `$w=$x.Workbooks.Open($env:OHN_CSV); $s=$w.Worksheets.Item(1); $o=@(); foreach($r in 1..6){ $o+=(@(1..5|%{ $s.Cells.Item($r,$_).Text }) -join ' ; ') }; ` +
        `$w.Close($false); $x.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($x); $o -join "\`n"`],
        { encoding: 'utf8', env: { ...process.env, OHN_CSV: csvPath } }).trim().split(/\r?\n/);
      const mono = t2.every((v, i) => i === 0 || v > t2[i - 1]);
      const garbled = /[ÃÂæçè]|锟|�/.test(excel.join(''));
      if (rows.length !== 5 || !mono || circles !== 10 || garbled || !excel[0].startsWith('循环泵'))
        throw new Error('scan check failed ' + JSON.stringify({ rows, t2, circles, lines, excel }));
      return { head, rows, t2, mono, circles, lines, csvPath: csvPath.replace(L.BASE, '<BASE>'), csvBom: buf.subarray(0, 3).toString('hex'), excelRows: excel };
    }, page);

    await step('P0-3', async () => {
      const scan = page.getByTestId('scan-view');
      await scan.getByLabel('点数', { exact: true }).fill('1000');
      await scan.getByLabel('点数', { exact: true }).press('Enter');
      const before = L.pythons();
      await scan.getByRole('button', { name: '运行扫描（1000 点）' }).click();
      await page.getByTestId('scan-progress').waitFor({ timeout: 20000 });
      await sleep(1500);
      const during = L.pythons();
      const progress = await page.getByTestId('scan-progress').innerText().catch(() => '');
      await L.shot(page, 'P0-3a-1000点运行中');
      await scan.getByRole('button', { name: '取消分析' }).click();
      await scan.getByText('已取消扫描').waitFor({ timeout: 20000 });
      await L.shot(page, 'P0-3b-已取消');
      await sleep(5000);
      const after = L.pythons();
      const leftover = after.filter((p) => !before.some((b) => b.pid === p.pid));
      if (leftover.length) throw new Error('leftover python: ' + JSON.stringify(leftover));
      if (during.length <= before.length) L.record('P0-3-note', { note: 'no extra python seen during run (analysis may run inside serve)', during });
      return { before, during, after, progress };
    }, page);

    await step('P0-4', async () => {
      await page.getByRole('button', { name: '敏感性', exact: true }).click();
      const sens = page.getByTestId('sensitivity-view');
      const btn = sens.getByRole('button', { name: /计算敏感性/ });
      const label = await btn.innerText();
      await btn.click();
      const summary = page.getByTestId('sensitivity-summary');
      await summary.waitFor({ timeout: 60000 });
      const lines = await summary.locator('li').allInnerTexts();
      const tbl = await page.getByTestId('sensitivity-table').innerText();
      await L.shot(page, 'P0-4-敏感性');
      if (lines.length !== 2 || !lines.every((l) => l.includes('影响最大：循环泵 · 虚构示例 · 相对转速')))
        throw new Error('unexpected strongest: ' + JSON.stringify(lines));
      return { button: label, lines, table: tbl.split('\n') };
    }, page);

    await step('P0-5', async () => {
      await page.getByTestId('select-PU1').click();
      const speedField = page.getByLabel('相对转速 n/n₀');
      const speed0 = await speedField.inputValue();
      await page.getByRole('button', { name: '可及性', exact: true }).click();
      const acc = page.getByTestId('accessibility-view');
      const pump = '循环泵 · 虚构示例 · 相对转速';
      await acc.getByLabel('参与调节 ' + pump).check();
      const defaults = { lower: await acc.getByLabel(pump + ' 下界', { exact: true }).inputValue(), upper: await acc.getByLabel(pump + ' 上界', { exact: true }).inputValue() };
      await acc.getByLabel(pump + ' 下界', { exact: true }).fill('0.6');
      await acc.getByLabel(pump + ' 下界', { exact: true }).press('Enter');
      await acc.getByLabel(pump + ' 上界', { exact: true }).fill('1.3');
      await acc.getByLabel(pump + ' 上界', { exact: true }).press('Enter');
      await acc.getByLabel('参与调节 调节阀 1 · 开度').check();
      await acc.getByLabel('参与调节 调节阀 2 · 开度').check();
      await acc.getByRole('button', { name: '搜索可行调节（局部）' }).click();
      const concl = page.getByTestId('accessibility-conclusion');
      await concl.filter({ hasText: '找到满足全部约束的工作点' }).waitFor({ timeout: 180000 });
      const plan = await page.getByTestId('adjustment-table').locator('tbody tr').allInnerTexts();
      const notes = await page.getByTestId('refinement-notes').locator('li').allInnerTexts();
      await L.shot(page, 'P0-5a-可及性搜索结果');
      const actions = page.getByTestId('found-actions');
      await actions.getByRole('button', { name: '应用到当前工程' }).click();
      const applyNote = await page.getByTestId('found-actions-note').innerText();
      const applied = await speedField.inputValue();
      await L.shot(page, 'P0-5b-已应用');
      await blurAndUndo(page);
      const undone = await speedField.inputValue();
      await L.shot(page, 'P0-5c-CtrlZ后');
      const found = Number(plan[0].split('\t')[2]);
      if (found !== 1.06 || Number(applied) !== 1.06 || Number(undone) !== Number(speed0))
        throw new Error(JSON.stringify({ plan, notes, applied, undone, speed0 }));
      return { defaults, conclusion: await concl.innerText(), plan, notes, applyNote, speedBefore: speed0, applied, afterCtrlZ: undone };
    }, page);

    await step('P0-6', async () => {
      await page.getByTestId('select-PU1').click();
      const speedNow = await page.getByLabel('相对转速 n/n₀').inputValue();
      await page.getByTestId('select-V1').click();
      const v1Now = await page.getByLabel('阀门开度', { exact: true }).inputValue();
      await page.getByTestId('select-V2').click();
      const v2Now = await page.getByLabel('阀门开度', { exact: true }).inputValue();
      await analysis();
      await page.getByRole('button', { name: '水力平衡', exact: true }).click();
      const bal = page.getByTestId('balance-view');
      await bal.getByTestId('balance-pairs').locator('li').first().waitFor();
      const pairs = await bal.getByTestId('balance-pairs').locator('li').allInnerTexts();
      await bal.getByLabel('平衡方式').selectOption('variable');
      await bal.getByRole('button', { name: '计算水力平衡' }).click();
      await page.getByTestId('balance-conclusion').waitFor({ timeout: 120000 });
      const conclusion = await page.getByTestId('balance-conclusion').innerText();
      const index = await page.getByTestId('balance-index').innerText();
      const table = await page.getByTestId('balance-table').locator('tbody tr').allInnerTexts();
      const compare = await page.getByTestId('balance-compare').locator('tbody tr').allInnerTexts();
      await L.shot(page, 'P0-6a-水力平衡结果');
      await page.getByTestId('balance-actions').getByRole('button', { name: '保存为工况快照' }).click();
      await page.locator('.statusbar').filter({ hasText: '平衡方案 1 已保存为工况快照' }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: '工况对比', exact: true }).click();
      const options = await page.getByLabel('对比工况').locator('option').allInnerTexts();
      const selected = await page.getByLabel('对比工况').locator('option:checked').innerText();
      await L.shot(page, 'P0-6b-工况对比平衡方案1');
      const v1 = table[0].split('\t');
      const ok = index.includes('用户末端 2') && /^泵相对转速\t1\t0\.98\t/.test(compare[0]) && v1[1] === '调节阀 1' && v1[3] === '0.22' && options.includes('平衡方案 1');
      if (!ok) throw new Error(JSON.stringify({ index, table, compare, options }));
      return { modelBefore: { pu1: speedNow, v1: v1Now, v2: v2Now }, pairs, conclusion, index, table, compare, scenarioOptions: options, selected };
    }, page);
    L.record('main-pageerrors', { errors });
  } finally {
    if (!page.isClosed()) {
      const ms = await waitExit(app, page, '放弃修改').catch((e) => String(e));
      await sleep(5000);
      L.record('main-exit', { exitMs: ms, leftover: L.packageProcesses() });
    }
  }
}

async function closeDuringAnalysis() {
  const { app, page, errors } = await start('close');
  await step('P0-7', async () => {
    await openExample(page);
    await page.getByTestId('select-PU1').click();
    await page.getByLabel('相对转速 n/n₀').fill('0.95');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await page.getByRole('button', { name: '分析', exact: true }).click();
    const scan = page.getByTestId('scan-view');
    await scan.getByLabel('扫描参数').selectOption({ value: 'PU1:speed' });
    await scan.getByLabel('点数', { exact: true }).fill('1000');
    await scan.getByLabel('点数', { exact: true }).press('Enter');
    await scan.getByRole('button', { name: '运行扫描（1000 点）' }).click();
    await page.getByTestId('scan-progress').waitFor({ timeout: 20000 });
    await sleep(1500);
    const during = L.packageProcesses();
    await L.shot(page, 'P0-7a-关闭前分析运行中');
    const exitMs = await waitExit(app, page, '放弃修改');
    const dialogs = fs.readFileSync(DIALOG_LOG, 'utf8').trim().split('\n').map(JSON.parse).filter((d) => d.session === 'close');
    await sleep(5000);
    const after = L.packageProcesses();
    if (after.length) throw new Error('leftover: ' + JSON.stringify(after));
    return { duringNames: during.map((p) => p.name + ' ' + p.cmd.slice(0, 60)), exitMs, dialogs, after, pageErrors: errors };
  });
}

async function saveReopen() {
  const projDir = path.join(L.BASE, '工程', L.TAG);
  fs.mkdirSync(projDir, { recursive: true });
  const proj = path.join(projDir, '验收示例.ohn.json');
  const pdf = path.join(L.EXPORTS, '验收示例报告.pdf');
  for (const f of [proj, pdf]) fs.rmSync(f, { force: true });
  let first;
  await step('P0-8a', async () => {
    const { app, page, errors } = await start('save');
    await openExample(page);
    await calculate(page);
    const r = await resultRows(page);
    await app.evaluate((_e, p) => { globalThis.acc.nextSave = p; }, proj);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    for (let i = 0; i < 50 && !fs.existsSync(proj); i++) await sleep(200);
    await sleep(500);
    await app.evaluate((_e, p) => { globalThis.acc.nextSave = p; }, pdf);
    await page.getByRole('button', { name: 'PDF 报告', exact: true }).click();
    for (let i = 0; i < 100 && !fs.existsSync(pdf); i++) await sleep(200);
    await sleep(1000);
    const status = await page.locator('.statusbar').innerText();
    await L.shot(page, 'P0-8a-保存与PDF');
    const exitMs = await waitExit(app, page, '取消');
    await sleep(5000);
    const left = L.packageProcesses();
    first = r;
    if (!fs.existsSync(proj) || !fs.existsSync(pdf) || left.length) throw new Error(JSON.stringify({ proj: fs.existsSync(proj), pdf: fs.existsSync(pdf), left, status }));
    return { rows: r.rows, projBytes: fs.statSync(proj).size, pdfBytes: fs.statSync(pdf).size, pdfMagic: fs.readFileSync(pdf).subarray(0, 5).toString(), status, exitMs, leftover: left, pageErrors: errors };
  });
  await step('P0-8b', async () => {
    const { app, page, errors } = await start('reopen');
    const back = page.getByRole('button', { name: '返回工作台', exact: true });
    if (await back.isVisible().catch(() => false)) await back.click();
    await app.evaluate((_e, p) => { globalThis.acc.nextOpen = p; }, proj);
    await page.getByRole('button', { name: '打开工程', exact: true }).click();
    await page.getByTestId('select-PU1').waitFor();
    const title = await page.locator('.project-title').innerText().catch(() => '');
    await calculate(page);
    const r = await resultRows(page);
    await L.shot(page, 'P0-8b-重开后计算');
    const same = first && JSON.stringify(first.rows) === JSON.stringify(r.rows);
    const exitMs = await waitExit(app, page, '取消');
    await sleep(5000);
    const left = L.packageProcesses();
    if (!same || left.length) throw new Error(JSON.stringify({ before: first && first.rows, after: r.rows, left }));
    return { title, rowsIdentical: same, rows: r.rows, exitMs, leftover: left, pageErrors: errors };
  });
}

const which = process.argv[2];
({ main, close: closeDuringAnalysis, save: saveReopen })[which]().catch((e) => {
  console.error(e);
  process.exit(1);
});
