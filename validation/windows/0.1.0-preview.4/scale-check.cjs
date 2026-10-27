// P1-1: run the four analysis sub-pages at the current Windows scaling and check layout. Usage: node scale-check.cjs 125
const L = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');
const pct = process.argv[2];
const dir = path.join(L.SHOTS, 'P1-1');
fs.mkdirSync(dir, { recursive: true });

async function layout(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.analysis-panel');
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const view = [...panel.querySelectorAll('.analysis-view')].find(vis) || panel;
    const form = view.querySelector('.analysis-form'), out = view.querySelector('.analysis-output');
    const fr = form && form.getBoundingClientRect(), or = out && out.getBoundingClientRect();
    // Interactive controls that are actually inside their scroll container's visible area
    const clipRect = (el) => { let r = el.getBoundingClientRect(); let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
      for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflow + s.overflowY + s.overflowX)) { const q = p.getBoundingClientRect(); top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom); left = Math.max(left, q.left); right = Math.min(right, q.right); } }
      return { top, bottom, left, right, full: r, visibleFrac: Math.max(0, bottom - top) * Math.max(0, right - left) / (r.width * r.height) }; };
    const ctrls = [...panel.querySelectorAll('button, input, select')].filter(vis).map((el) => ({ el, c: clipRect(el), name: (el.getAttribute('aria-label') || el.textContent || el.name || el.type).trim().slice(0, 30) })).filter((x) => x.c.visibleFrac > 0.5);
    const overlaps = [];
    for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
      const a = ctrls[i].c.full, b = ctrls[j].c.full;
      if (ctrls[i].el.contains(ctrls[j].el) || ctrls[j].el.contains(ctrls[i].el)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) overlaps.push(ctrls[i].name + ' × ' + ctrls[j].name);
    }
    const clipped = [...panel.querySelectorAll('button')].filter(vis).filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 2).map((b) => b.textContent.trim().slice(0, 30));
    const primary = view.querySelector('.analysis-form button.primary') || view.querySelector('button.primary');
    const pc = primary && clipRect(primary);
    return {
      formOutputOverlap: fr && or ? Math.max(0, Math.min(fr.right, or.right) - Math.max(fr.left, or.left)) > 1 && Math.min(fr.bottom, or.bottom) - Math.max(fr.top, or.top) > 1 : null,
      form: fr && [Math.round(fr.left), Math.round(fr.top), Math.round(fr.width), Math.round(fr.height)],
      output: or && [Math.round(or.left), Math.round(or.top), Math.round(or.width), Math.round(or.height)],
      controlOverlaps: overlaps, clippedButtons: clipped,
      runButton: primary && { text: primary.textContent.trim(), visibleFraction: Math.round(pc.visibleFrac * 100) / 100 },
    };
  });
}

(async () => {
  const { app, page } = await L.launch();
  const res = { scale: pct };
  try {
    res.window = await page.evaluate(() => ({ inner: [innerWidth, innerHeight], dpr: devicePixelRatio, screen: [screen.width, screen.height] }));
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-PU1').waitFor();
    await page.getByRole('button', { name: '计算', exact: true }).click();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '分析', exact: true }).click();
    const sub = async (mode, run, wait, extra) => {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForTimeout(300);
      const before = await layout(page);
      if (extra) await extra();
      await run();
      await wait();
      await page.waitForTimeout(400);
      const after = await layout(page);
      await page.screenshot({ path: path.join(dir, `${pct}%-${mode}.png`) });
      res[mode] = { runButtonBeforeRun: before.runButton, ...after };
    };
    const scan = page.getByTestId('scan-view');
    await sub('参数扫描', () => scan.getByRole('button', { name: /运行扫描/ }).click(), () => page.getByTestId('scan-table').waitFor({ timeout: 60000 }), async () => {
      await scan.getByLabel('扫描参数').selectOption({ value: 'PU1:speed' });
      for (const [l, v] of [['起点', '0.6'], ['终点', '1.4'], ['点数', '5']]) { await scan.getByLabel(l, { exact: true }).fill(v); await scan.getByLabel(l, { exact: true }).press('Enter'); }
    });
    await sub('敏感性', () => page.getByTestId('sensitivity-view').getByRole('button', { name: /计算敏感性/ }).click(), () => page.getByTestId('sensitivity-summary').waitFor({ timeout: 60000 }));
    const acc = page.getByTestId('accessibility-view'), pump = '循环泵 · 虚构示例 · 相对转速';
    await sub('可及性', () => acc.getByRole('button', { name: '搜索可行调节（局部）' }).click(), () => page.getByTestId('accessibility-conclusion').filter({ hasText: '找到满足' }).waitFor({ timeout: 180000 }), async () => {
      await acc.getByLabel('参与调节 ' + pump).check();
      await acc.getByLabel(pump + ' 上界', { exact: true }).fill('1.3');
      await acc.getByLabel(pump + ' 上界', { exact: true }).press('Enter');
      await acc.getByLabel('参与调节 调节阀 1 · 开度').check();
      await acc.getByLabel('参与调节 调节阀 2 · 开度').check();
    });
    res['可及性'].suggested = (await page.getByTestId('adjustment-table').locator('tbody tr').first().innerText()).split('\t')[2];
    const bal = page.getByTestId('balance-view');
    await sub('水力平衡', () => bal.getByRole('button', { name: '计算水力平衡' }).click(), () => page.getByTestId('balance-conclusion').waitFor({ timeout: 120000 }), async () => {
      await bal.getByTestId('balance-pairs').locator('li').first().waitFor();
      await bal.getByLabel('平衡方式').selectOption('variable');
    });
    res['水力平衡'].index = await page.getByTestId('balance-index').innerText();
    res.ok = true;
  } catch (e) {
    res.ok = false; res.error = String(e).slice(0, 400);
    await page.screenshot({ path: path.join(dir, `${pct}%-失败.png`) }).catch(() => {});
  } finally {
    await app.evaluate(() => { globalThis.acc.answer = '放弃修改'; });
    const c = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await c;
    await new Promise((r) => setTimeout(r, 4000));
    res.leftover = L.packageProcesses().length;
    L.record('P1-1', res);
  }
})();
