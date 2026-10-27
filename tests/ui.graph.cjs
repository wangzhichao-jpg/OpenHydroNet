const { _electron } = require('playwright');
const { shot } = require('./e2e-util.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'artifacts', 'graph', require('../package.json').version);
(async () => {
  await fs.mkdir(out, { recursive: true });
  const app = await _electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, OHN_PROFILE: path.join(root, '.local', 'graph-test-profile') },
  });
  const errors = [];
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('button', { name: '空白工程', exact: false }).click();
    const palette = page.locator('.palette').getByRole('button', { name: /节点$/ }),
      canvas = page.locator('.canvas');
    await palette.dragTo(canvas, { targetPosition: { x: 220, y: 150 } });
    assert.equal(await page.locator('.react-flow__node').count(), 1);
    await palette.dragTo(canvas, { targetPosition: { x: 620, y: 330 } });
    assert.equal(await page.locator('.react-flow__node').count(), 2);
    const ids = await page
      .locator('.react-flow__node')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    await page.getByTestId('select-' + ids[0]).click();
    await page.getByLabel('定压边界 / 参考点').check();
    await page.getByTestId('select-' + ids[1]).click();
    await page.getByLabel('定压边界 / 参考点').check();
    const head = page.getByLabel('测压水头 H', { exact: true });
    await head.fill('40');
    await head.press('Enter');
    await page.getByRole('button', { name: '适配画布', exact: true }).click();
    await page.waitForTimeout(350);
    const source = await page
        .locator(`[data-id="${ids[0]}"] .react-flow__handle[data-handleid="2"]`)
        .boundingBox(),
      target = await page
        .locator(`[data-id="${ids[1]}"] .react-flow__handle[data-handleid="0"]`)
        .boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.react-flow__edge').count(), 1);
    await page.getByRole('button', { name: '计算', exact: true }).click();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 30000 });
    assert.ok((await page.locator('tbody').innerText()).includes('反向'));
    assert.equal(await page.locator('.react-flow__minimap-node').count(), 2);
    assert.ok(
      Number(await page.locator('.react-flow__minimap-node').first().getAttribute('width')) > 0,
    );
    await page.getByLabel('流量单位').selectOption('kg/h');
    assert.ok((await page.locator('thead').innerText()).includes('kg/h'));
    await shot(page, { path: path.join(out, '01-port-connected-reverse.png') });
    const edge = page.locator('.edge-label').first();
    await edge.click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.react-flow__node').count(), 4);
    assert.equal(await page.locator('.react-flow__edge').count(), 2);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.react-flow__node').count(), 2);
    assert.equal(await page.locator('.react-flow__edge').count(), 1);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showSaveDialog = async (_window, options) => ({
        canceled: false,
        filePath: directory + '/' + options.defaultPath,
      });
    }, out);
    await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
    await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
    await page.waitForTimeout(1000);
    const png = await fs.readFile(path.join(out, '未命名工程.png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok((await fs.readFile(path.join(out, '未命名工程.svg'), 'utf8')).includes('<svg'));
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, 'test-result.json'),
      JSON.stringify(
        {
          status: 'passed',
          checks: [
            'actual palette drag/drop',
            'actual port drag connection',
            'fixed-head edits',
            'reverse flow visible',
            'mass flow display unit',
            'UI copy/paste remapping',
            'UI undo',
            'actual PNG signature',
            'actual SVG export',
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log('PASS: actual palette/ports/reverse/copy/PNG/SVG');
  } catch (e) {
    console.error(e, errors);
    try {
      await (await app.firstWindow()).screenshot({ path: path.join(out, 'failure.png') });
    } catch {}
    process.exitCode = 1;
  } finally {
    await app.close();
  }
})();
