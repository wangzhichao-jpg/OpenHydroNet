// SPEC-001 analysis workspace, real Electron. T-001: single-parameter scan.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'artifacts', 'analysis', require('../package.json').version);
const num = (text) => Number(text.replace(/,/g, ''));
// Playwright "visible" ignores scrolling; require the element inside the bottom panel viewport.
const inPanelView = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      p = el.closest('.bottom-content').getBoundingClientRect();
    return r.height > 0 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
  });
(async () => {
  await fs.mkdir(out, { recursive: true });
  const errors = [];
  const app = await electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, OHN_PROFILE: path.join(root, '.local', 'analysis-test-profile') },
    timeout: 30000,
  });
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-PU1').waitFor();

    // T-001: PU1 speed 0.6–1.4, 5 points; T2 flow rises monotonically.
    await page.getByRole('button', { name: '分析', exact: true }).click();
    const scan = page.getByTestId('scan-view');
    await scan.getByLabel('扫描参数').selectOption({ value: 'PU1:speed' });
    await scan.getByLabel('起点').fill('0.6');
    await scan.getByLabel('起点').press('Enter');
    await scan.getByLabel('终点').fill('1.4');
    await scan.getByLabel('终点').press('Enter');
    await scan.getByLabel('点数').fill('5');
    await scan.getByLabel('点数').press('Enter');
    // Invalid analysis input must not block project editing (not part of the document).
    await scan.getByLabel('点数').fill('abc');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 30000 });
    await scan.getByLabel('点数').press('Escape');
    await scan.getByRole('button', { name: '运行扫描（5 点）' }).click();
    const table = page.getByTestId('scan-table');
    await table.waitFor({ timeout: 60000 });
    const header = await table.locator('thead th').allInnerTexts();
    assert.deepEqual(header, [
      '循环泵 · 虚构示例 · 相对转速',
      '用户末端 1 流量 [m³/h]',
      '用户末端 2 流量 [m³/h]',
      '状态',
    ]);
    const rows = await table.locator('tbody tr').all();
    assert.equal(rows.length, 5);
    const t2 = [];
    for (const row of rows) t2.push(num(await row.locator('td').nth(2).innerText()));
    assert.ok(
      t2.every((v, i) => i === 0 || v > t2[i - 1]),
      'T2 flow must rise with pump speed: ' + t2,
    );
    assert.ok(
      Math.abs(t2[2] - 13.679) < 0.01,
      'speed 1.0 matches the documented example: ' + t2[2],
    );
    // ---- T-002: chart, legend toggle and CSV export ----
    const chart = page.getByRole('img', { name: /参数扫描曲线/ });
    assert.equal(await chart.locator('circle').count(), 10, 'two series × five points');
    assert.equal(await chart.locator('polyline').count(), 2, 'no failed point, so no breaks');
    const legendT1 = scan.getByRole('button', { name: '用户末端 1 流量 [m³/h]', exact: true });
    assert.ok(await inPanelView(legendT1), 'legend stays inside the analysis panel');
    await legendT1.click();
    assert.equal(await legendT1.getAttribute('aria-pressed'), 'false');
    assert.equal(await chart.locator('circle').count(), 5);
    await legendT1.click();
    assert.equal(await chart.locator('circle').count(), 10);
    await app.evaluate(({ dialog }, dir) => {
      dialog.showSaveDialog = async (_w, options) => ({
        canceled: false,
        filePath: dir + '/' + options.defaultPath,
      });
    }, out);
    await scan.getByRole('button', { name: '导出 CSV' }).click();
    await scan.getByText('已导出 CSV（当前显示单位）').waitFor();
    const csv = await fs.readFile(
      path.join(out, '双末端闭式循环 · 公开教学示例·参数扫描.csv'),
      'utf8',
    );
    assert.ok(csv.startsWith('\ufeff'), 'UTF-8 BOM for spreadsheet software');
    const csvLines = csv.slice(1).trim().split('\r\n');
    assert.equal(
      csvLines[0],
      '循环泵 · 虚构示例 · 相对转速,用户末端 1 流量 [m³/h],用户末端 2 流量 [m³/h],状态,问题',
    );
    assert.equal(csvLines.length, 6);
    const csvT2 = Number(csvLines[3].split(',')[2]);
    assert.ok(Math.abs(csvT2 - 13.679) < 0.001, 'CSV keeps full precision: ' + csvLines[3]);
    await page.screenshot({ path: path.join(out, '01b-scan-chart.png') });
    assert.ok(await inPanelView(page.locator('.analysis-modes')), 'mode bar stays in view');
    assert.ok(await inPanelView(table.locator('thead')), 'table header stays in view');
    assert.ok(
      await inPanelView(scan.getByRole('button', { name: /运行扫描/ })),
      'run button in view',
    );
    assert.match(await rows[2].locator('td').nth(3).innerText(), /末端低于设计流量（用户末端 2）/);
    await page.screenshot({ path: path.join(out, '01-scan-table.png') });

    // Results stay when switching tabs; editing the model marks them stale.
    await page.getByRole('button', { name: '计算结果', exact: true }).click();
    await page.getByTestId('select-PU1').click();
    await page.getByLabel('相对转速 n/n₀').fill('0.9');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await page.getByRole('button', { name: '分析', exact: true }).click();
    await page.getByTestId('scan-stale').waitFor();
    assert.ok(await inPanelView(page.getByTestId('scan-stale')), 'stale banner in view');
    assert.equal(await table.locator('tbody tr').count(), 5);
    await page.screenshot({ path: path.join(out, '02-scan-stale.png') });
    // Progress is shown and cancel stops the server-side process (HTTP DELETE path).
    const deletes = [];
    page.on('request', (r) => r.method() === 'DELETE' && deletes.push(r.url()));
    await scan.getByLabel('点数').fill('1000');
    await scan.getByLabel('点数').press('Enter');
    await scan.getByRole('button', { name: '运行扫描（1000 点）' }).click();
    await page.getByTestId('scan-progress').waitFor();
    await scan.getByRole('button', { name: '取消分析' }).click();
    await scan.getByText('已取消扫描').waitFor();
    assert.ok(
      deletes.some((u) => u.includes('/api/analysis-jobs/')),
      'cancel sent DELETE',
    );
    assert.equal(await page.getByTestId('scan-table').count(), 0);
    // ---- T-003: two-parameter scan (pump speed × V2 opening, 3 × 3) ----
    await page.getByRole('button', { name: '参数扫描', exact: true }).click();
    await scan.getByLabel('点数', { exact: true }).fill('3');
    await scan.getByLabel('点数', { exact: true }).press('Enter');
    await scan.getByLabel('第二参数', { exact: true }).selectOption({ value: 'V2:opening' });
    for (const [label, value] of [
      ['第二参数 起点', '0.5'],
      ['第二参数 终点', '1'],
      ['第二参数 点数', '400'],
    ]) {
      await scan.getByLabel(label, { exact: true }).fill(value);
      await scan.getByLabel(label, { exact: true }).press('Enter');
    }
    await scan.getByText('共 1200 点，单批扫描限 1000 点；请减少点数').waitFor();
    assert.equal(await scan.getByRole('button', { name: /运行扫描/ }).isDisabled(), true);
    await scan.getByLabel('第二参数 点数', { exact: true }).fill('3');
    await scan.getByLabel('第二参数 点数', { exact: true }).press('Enter');
    await scan.getByRole('button', { name: '运行扫描（9 点）' }).click();
    const grid2 = page.getByRole('img', { name: /双参数扫描曲线/ });
    await grid2.waitFor({ timeout: 60000 });
    const rows2 = await page.getByTestId('scan-table').locator('tbody tr').allInnerTexts();
    assert.equal(rows2.length, 9);
    assert.match(rows2[0], /^0\.6\t0\.5\t/);
    assert.match(rows2[1], /^0\.6\t0\.75\t/, 'first parameter is the outer loop');
    assert.equal(
      (await page.getByTestId('scan-table').locator('thead th').allInnerTexts()).length,
      5,
      'two parameter columns + two observables + status',
    );
    assert.equal(await grid2.locator('polyline').count(), 3, 'one line per V2 opening');
    assert.equal(await grid2.locator('circle').count(), 9);
    await scan.getByLabel('曲线观测量').selectOption({ index: 1 });
    assert.match(await grid2.getAttribute('aria-label'), /双参数扫描曲线/);
    assert.equal(await grid2.locator('circle').count(), 9);
    assert.ok(
      await inPanelView(
        scan.locator('.scan-legend').getByText('调节阀 2 · 开度 = 0.75', { exact: true }),
      ),
      'grid legend in view',
    );
    await page.screenshot({ path: path.join(out, '01c-scan-two-parameters.png') });

    // ---- T-004: sensitivity matrix ----
    await page.getByRole('button', { name: '敏感性', exact: true }).click();
    const sens = page.getByTestId('sensitivity-view');
    const runSens = sens.getByRole('button', { name: /计算敏感性/ });
    assert.equal(await runSens.innerText(), '计算敏感性（7 次计算）');
    await sens.getByLabel('参与分析 调节阀 1 · 开度').uncheck();
    assert.equal(await runSens.innerText(), '计算敏感性（5 次计算）');
    await sens.getByLabel('参与分析 调节阀 1 · 开度').check();
    await runSens.click();
    const summary = page.getByTestId('sensitivity-summary');
    await summary.waitFor({ timeout: 60000 });
    const lines = await summary.locator('li').allInnerTexts();
    assert.equal(lines.length, 2);
    assert.match(
      lines[1],
      /^用户末端 2 流量 \[m³\/h\]：影响最大：循环泵 · 虚构示例 · 相对转速（弹性 1\.0\d*：参数增加 1%，约增加/,
    );
    const sensRows = page.getByTestId('sensitivity-table').locator('tbody tr');
    assert.equal(await sensRows.count(), 2);
    // Pump column (3rd cell) is the strongest for both terminals.
    assert.equal(await sensRows.nth(1).locator('td.strongest').count(), 1);
    assert.equal(await sensRows.nth(1).locator('td').nth(2).getAttribute('class'), 'strongest');
    assert.equal(
      await sensRows.nth(1).locator('td').nth(3).getAttribute('title'),
      '单侧差分（已在上限）',
    );
    assert.ok(await inPanelView(summary), 'summary in view');
    await page.screenshot({ path: path.join(out, '02b-sensitivity.png') });

    // ---- T-005: accessibility constraints and fixed check ----
    await page.getByRole('button', { name: '计算结果', exact: true }).click();
    await page.getByTestId('select-PU1').click();
    await page.getByLabel('相对转速 n/n₀').fill('1');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await page.getByRole('button', { name: '分析', exact: true }).click();
    await page.getByRole('button', { name: '可及性', exact: true }).click();
    const acc = page.getByTestId('accessibility-view');
    const t1Field = acc.getByLabel('用户末端 1 最小流量 [m³/h]', { exact: true });
    assert.equal(await t1Field.inputValue(), '14.4');
    assert.equal(
      await acc.getByLabel('用户末端 2 最小流量 [m³/h]', { exact: true }).inputValue(),
      '14.4',
    );
    // Constraints are stored in SI: a unit round trip must not change them.
    await page.getByLabel('流量单位').selectOption('kg/h');
    const kg = Number(
      await acc.getByLabel('用户末端 1 最小流量 [kg/h]', { exact: true }).inputValue(),
    );
    assert.ok(Math.abs(kg - 14.4 * 998.2336) < 0.5, 'kg/h display uses current density: ' + kg);
    await page.getByLabel('流量单位').selectOption('m3/h');
    assert.equal(await t1Field.inputValue(), '14.4');
    // Duplicate constraint is caught before running.
    const check = acc.getByRole('button', { name: '检查当前工作点' });
    await acc.getByRole('button', { name: '＋ 添加约束' }).click();
    await acc.getByText(/最小流量约束重复/).waitFor();
    assert.equal(await check.isDisabled(), true);
    await acc
      .getByRole('button', { name: /^删除约束/ })
      .last()
      .click();
    assert.equal(await check.isDisabled(), false);
    await check.click();
    const conclusion = page.getByTestId('accessibility-conclusion');
    await conclusion.waitFor({ timeout: 60000 });
    assert.equal(await conclusion.innerText(), '当前工作点不满足约束');
    const accRows = await page
      .getByTestId('accessibility-table')
      .locator('tbody tr')
      .allInnerTexts();
    assert.equal(accRows.length, 2);
    assert.match(accRows[0], /用户末端 1.*满足/);
    assert.match(accRows[1], /用户末端 2.*14\.4.*13\.679.*不满足.*5\.0%/s);
    assert.ok(await inPanelView(conclusion), 'conclusion in view');
    assert.ok(await inPanelView(check), 'check button in view');
    await page.screenshot({ path: path.join(out, '03-accessibility-fixed.png') });
    // Relaxing T2 makes the point satisfy every constraint.
    await acc.getByLabel('用户末端 2 最小流量 [m³/h]', { exact: true }).fill('13');
    await acc.getByLabel('用户末端 2 最小流量 [m³/h]', { exact: true }).press('Enter');
    await check.click();
    await page
      .getByTestId('accessibility-conclusion')
      .filter({ hasText: '当前工作点满足全部约束' })
      .waitFor();
    // Editing the model afterwards marks the check stale.
    await page.getByTestId('select-PU1').click();
    await page.getByLabel('相对转速 n/n₀').fill('1.1');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await page.getByTestId('accessibility-stale').waitFor();
    // Search variables follow the live model, not the value at mount time.
    await acc.getByText('循环泵 · 虚构示例 · 相对转速（当前 1.1）').waitFor();
    assert.ok(
      await inPanelView(page.getByTestId('accessibility-stale')),
      'accessibility stale banner in view',
    );
    // ---- T-006: bounded local search ----
    await page.getByLabel('相对转速 n/n₀').fill('1');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await acc.getByRole('button', { name: '恢复为末端设计流量' }).click();
    const pump = '循环泵 · 虚构示例 · 相对转速';
    await acc.getByLabel('参与调节 ' + pump).check();
    await acc.getByLabel(pump + ' 上界', { exact: true }).fill('1.3');
    await acc.getByLabel(pump + ' 上界', { exact: true }).press('Enter');
    await acc.getByLabel('参与调节 调节阀 1 · 开度').check();
    await acc.getByLabel('参与调节 调节阀 2 · 开度').check();
    const search = acc.getByRole('button', { name: '搜索可行调节（局部）' });
    // Invalid bounds are caught before running.
    await acc.getByLabel(pump + ' 下界', { exact: true }).fill('1.3');
    await acc.getByLabel(pump + ' 下界', { exact: true }).press('Enter');
    await acc.getByText(/下界必须小于上界/).waitFor();
    assert.equal(await search.isDisabled(), true);
    await acc.getByLabel(pump + ' 下界', { exact: true }).fill('0.6');
    await acc.getByLabel(pump + ' 下界', { exact: true }).press('Enter');
    await search.click();
    await page
      .getByTestId('accessibility-conclusion')
      .filter({ hasText: '在给定调节范围内找到满足全部约束的工作点' })
      .waitFor({ timeout: 120000 });
    const plan = await page.getByTestId('adjustment-table').locator('tbody tr').allInnerTexts();
    assert.equal(plan.length, 3);
    const found = Number(plan[0].split('\t')[2]);
    // T-009: first feasible ≈1.135 → least adjustment ≈1.051 → rounded to the 0.01 step: 1.06.
    assert.equal(found, 1.06, 'suggested pump speed: ' + plan[0]);
    const notes = await page.getByTestId('refinement-notes').locator('li').allInnerTexts();
    assert.match(notes[0], /^首个可行点：循环泵 · 虚构示例 · 相对转速 1\.13/);
    assert.match(notes[1], /^尽量少调整（局部，不保证最小）：循环泵 · 虚构示例 · 相对转速 1\.05/);
    assert.equal(
      notes[2],
      '按设定精度取整：循环泵 · 虚构示例 · 相对转速 1.06，已重新验算，满足全部约束',
    );
    assert.ok(plan[1].includes('不变') && plan[2].includes('不变'), 'valves untouched: ' + plan);
    const after = await page.getByTestId('accessibility-table').locator('tbody tr').allInnerTexts();
    assert.ok(
      after.every((r) => /\t满足\t/.test(r)),
      'all constraints satisfied: ' + after,
    );
    await page.screenshot({ path: path.join(out, '04-accessibility-found.png') });
    // ---- T-007: save the found point as a scenario, or apply it (undoable) ----
    const actions = page.getByTestId('found-actions');
    await actions.getByRole('button', { name: '保存为工况快照' }).click();
    await page.locator('.statusbar').filter({ hasText: '可及性方案 1 已保存为工况快照' }).waitFor();
    const compareSelect = page.getByLabel('对比工况');
    assert.equal(await compareSelect.locator('option:checked').innerText(), '可及性方案 1');
    const speedField = page.getByLabel('相对转速 n/n₀');
    assert.equal(
      Number(await speedField.inputValue()),
      1,
      'saving a scenario leaves the project unchanged',
    );
    await page.getByRole('button', { name: '分析', exact: true }).click();
    await actions.getByRole('button', { name: '应用到当前工程' }).click();
    const applied = Number(await speedField.inputValue());
    assert.equal(applied, 1.06, 'applied pump speed is the settable value');
    // The current model is exactly the found point: shown as applied, not stale.
    const note = page.getByTestId('found-actions-note');
    await note
      .filter({ hasText: '已应用到当前工程：循环泵 · 虚构示例 · 相对转速 1 → 1.06' })
      .waitFor();
    assert.equal(await actions.getByRole('button', { name: '已应用' }).isDisabled(), true);
    assert.equal(await page.getByTestId('accessibility-stale').count(), 0);
    await page.getByTitle('撤销 Ctrl+Z').click();
    assert.equal(Number(await speedField.inputValue()), 1, 'undo restores the original speed');
    assert.equal(await actions.getByRole('button', { name: '应用到当前工程' }).isDisabled(), false);
    // Any other edit makes the search stale: both buttons are disabled.
    await speedField.fill('0.95');
    await speedField.press('Enter');
    await page.getByTestId('accessibility-stale').waitFor();
    assert.equal(await actions.getByRole('button', { name: '应用到当前工程' }).isDisabled(), true);
    assert.equal(await actions.getByRole('button', { name: '保存为工况快照' }).isDisabled(), true);
    await page.getByTitle('撤销 Ctrl+Z').click();
    assert.equal(Number(await speedField.inputValue()), 1);
    // Recalculating the applied point reproduces the scenario's T2 flow (same model, same kernel).
    await actions.getByRole('button', { name: '应用到当前工程' }).click();
    await page.getByRole('button', { name: '计算', exact: true }).click();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '工况对比', exact: true }).click();
    await compareSelect.selectOption({ label: '可及性方案 1' });
    const t2Cells = await page
      .locator('.bottom-content > table tbody tr')
      .filter({ hasText: '用户末端 2' })
      .locator('td')
      .allInnerTexts();
    // [name, baseline, current, delta, percent]: the saved scenario equals the recalculated point.
    assert.equal(t2Cells[1], t2Cells[2], 'scenario and recalculated point agree: ' + t2Cells);
    assert.ok(num(t2Cells[1]) >= 14.4 - 1e-3, 'scenario meets the design flow: ' + t2Cells);
    assert.equal(num(t2Cells[3]), 0);
    await page.screenshot({ path: path.join(out, '06-scenario-compare.png') });
    await page.getByTitle('撤销 Ctrl+Z').click();
    await page.getByRole('button', { name: '分析', exact: true }).click();
    // Unreachable target: undetermined + closest point, never an infeasibility claim.
    await acc.getByLabel('用户末端 2 最小流量 [m³/h]', { exact: true }).fill('36');
    await acc.getByLabel('用户末端 2 最小流量 [m³/h]', { exact: true }).press('Enter');
    await search.click();
    await page
      .getByTestId('accessibility-conclusion')
      .filter({ hasText: '未确定' })
      .waitFor({ timeout: 120000 });
    await acc.getByText('最接近满足的点（仍不满足约束）').waitFor();
    const output = await acc.locator('.analysis-output').innerText();
    assert.match(output, /已评估 \d+ 次/);
    assert.doesNotMatch(output, /不可行/);
    assert.ok(
      await inPanelView(page.getByTestId('accessibility-conclusion')),
      'conclusion in view',
    );
    await page.screenshot({ path: path.join(out, '05-accessibility-undetermined.png') });

    // ---- T-012: hydraulic balancing view (SPEC-002), from a freshly loaded example ----
    await page.getByRole('button', { name: '新建 / 模板', exact: true }).click();
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-PU1').waitFor();
    await page.getByRole('button', { name: '分析', exact: true }).click();
    await page.getByRole('button', { name: '水力平衡', exact: true }).click();
    const bal = page.getByTestId('balance-view');
    const pairList = bal.getByTestId('balance-pairs').locator('li');
    await pairList.first().waitFor();
    assert.deepEqual(await pairList.allInnerTexts(), [
      '用户末端 1 ← 调节阀 1',
      '用户末端 2 ← 调节阀 2',
    ]);
    const runBalance = bal.getByRole('button', { name: '计算水力平衡' });
    // Invalid speed range is caught before running.
    await bal.getByLabel('泵速下限', { exact: true }).fill('1.6');
    await bal.getByLabel('泵速下限', { exact: true }).press('Enter');
    await bal.getByText('泵速下限须小于上限，且在 0–2 之间').waitFor();
    assert.equal(await runBalance.isDisabled(), true);
    await bal.getByLabel('泵速下限', { exact: true }).fill('0.5');
    await bal.getByLabel('泵速下限', { exact: true }).press('Enter');
    // Variable speed: index circuit T2, speed 0.98, V1 0.22, V2 fully open, lower hydraulic power.
    await runBalance.click();
    const balConclusion = page.getByTestId('balance-conclusion');
    await balConclusion.waitFor({ timeout: 60000 });
    assert.equal(await balConclusion.innerText(), '平衡完成：各末端验证流量均在容差内');
    assert.equal(
      await page.getByTestId('balance-index').innerText(),
      '最不利环路：用户末端 2（调节阀 2 保持全开）',
    );
    const balRows = page.getByTestId('balance-table').locator('tbody tr');
    const balCells = async (i) => balRows.nth(i).locator('td').allInnerTexts();
    const v1 = await balCells(0),
      v2 = await balCells(1);
    assert.deepEqual([v1[0], v1[1], v1[2], v1[3]], ['用户末端 1', '调节阀 1', '14.4', '0.22']);
    assert.deepEqual([v2[3], v2[6]], ['1', '最不利环路，保持全开']);
    for (const cells of [v1, v2])
      assert.ok(Math.abs(parseFloat(cells[5])) <= 5, 'within ±5 %: ' + cells);
    const cmp = await page.getByTestId('balance-compare').locator('tbody tr').allInnerTexts();
    assert.match(cmp[0], /^泵相对转速\t1\t0\.98\t-2\.0%$/);
    assert.match(cmp[3], /^泵水力功率 \[W\]\t.*\t-4\.\d%$/);
    assert.equal(await page.getByTestId('balance-power-note').count(), 0);
    assert.ok(await inPanelView(balConclusion), 'balance conclusion in view');
    assert.ok(await inPanelView(runBalance), 'balance run button in view');
    await page.screenshot({ path: path.join(out, '07-balance-variable.png') });
    // Fixed speed, valves only: 0.20 / 0.40, and the power note explains why power rises.
    await bal.getByLabel('平衡方式').selectOption('fixed');
    assert.equal(await bal.getByLabel('泵速下限', { exact: true }).count(), 0);
    await runBalance.click();
    await page.getByTestId('balance-power-note').waitFor({ timeout: 60000 });
    assert.equal((await balCells(0))[3], '0.2');
    assert.equal((await balCells(1))[3], '0.4');
    assert.equal(await page.getByTestId('balance-index').count(), 0);
    await page.screenshot({ path: path.join(out, '08-balance-fixed.png') });
    assert.deepEqual(errors, []);
    console.log('analysis UI passed');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
