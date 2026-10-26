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
    assert.ok(found > 1.12 && found < 1.16, 'pump speed found ≈1.13: ' + plan[0]);
    const after = await page.getByTestId('accessibility-table').locator('tbody tr').allInnerTexts();
    assert.ok(
      after.every((r) => /\t满足\t/.test(r)),
      'all constraints satisfied: ' + after,
    );
    await page.screenshot({ path: path.join(out, '04-accessibility-found.png') });
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
    assert.deepEqual(errors, []);
    console.log('analysis UI passed');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
