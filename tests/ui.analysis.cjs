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
    assert.deepEqual(errors, []);
    console.log('analysis UI passed');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
