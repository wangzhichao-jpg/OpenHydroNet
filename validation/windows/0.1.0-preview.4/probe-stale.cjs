// Observation check: status after edit and after undo back to the calculated model.
const L = require('./lib.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { app, page } = await L.launch();
  const state = async (tag) => {
    const badge = await page.locator('.canvas-badge').first().innerText().catch(() => '');
    const status = (await page.locator('.statusbar').innerText()).split('\n')[1];
    const csv = await page.getByRole('button', { name: '结果 CSV', exact: true }).isDisabled().catch(() => 'n/a');
    L.record('obs-stale', { tag, badge, status, resultCsvDisabled: csv });
  };
  await page.getByTestId('start-example').click();
  await page.getByTestId('select-PU1').waitFor();
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 60000 });
  await state('calculated');
  await page.getByTestId('select-PU1').click();
  await page.getByLabel('相对转速 n/n₀').fill('0.9');
  await page.getByLabel('相对转速 n/n₀').press('Enter');
  await sleep(300);
  await state('after edit 1 -> 0.9');
  await L.shot(page, 'obs-编辑后');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await sleep(300);
  L.record('obs-stale', { speedAfterUndo: await page.getByLabel('相对转速 n/n₀').inputValue() });
  await state('after Ctrl+Z (model identical to calculated)');
  await L.shot(page, 'obs-撤销后');
  await app.evaluate(() => { globalThis.acc.answer = '放弃修改'; });
  const c = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await c;
  await sleep(5000);
  L.record('obs-stale', { leftover: L.packageProcesses() });
})().catch((e) => { console.error(e); process.exit(1); });
