const { _electron } = require('playwright');
const { shot } = require('./e2e-util.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'),
  version = require('../package.json').version,
  out = path.join(root, 'artifacts', 'features', version);
(async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'diameters.csv'), 'id,diameter_mm\nP2,50\nP3,50\n');
  const errors = [];
  const app = await _electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, OHN_PROFILE: path.join(root, '.local', 'feature-test-profile') },
  });
  try {
    await app.evaluate(({ dialog }, out) => {
      globalThis.inputFile = out + '/diameters.csv';
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.inputFile] });
      dialog.showSaveDialog = async (_w, opts) => ({
        canceled: false,
        filePath: out + '/' + opts.defaultPath,
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, out);
    const page = await app.firstWindow();
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(e.stack);
    });
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-PU1').click();
    await page.getByLabel('相对转速 n/n₀').fill('0.8');
    await page.getByLabel('相对转速 n/n₀').press('Enter');
    await page.getByRole('button', { name: '设备库 / 泵曲线', exact: true }).click();
    await page.getByRole('button', { name: '＋ 水泵', exact: true }).click();
    await page.getByLabel('库中名称', { exact: true }).fill('循环泵 · 教学拟合');
    await page.getByLabel('泵性能点', { exact: true }).fill('0,32\n14.4,31\nx,14');
    await page.getByRole('button', { name: '拟合并更新曲线', exact: true }).click();
    assert.ok((await page.locator('.library-status').innerText()).includes('拟合失败'));
    await page
      .getByLabel('泵性能点', { exact: true })
      .fill('0,32\n14.4,29.12\n28.8,20.48\n43.2,6.08');
    await page.getByRole('button', { name: '拟合并更新曲线', exact: true }).click();
    await page.locator('.library-status').filter({ hasText: '拟合完成' }).waitFor();
    assert.ok(
      Math.abs(Number(await page.getByLabel('库曲线 a2', { exact: true }).inputValue()) + 180000) <
        1e-5,
    );
    await page.getByRole('img', { name: '泵库基准流量扬程曲线' }).waitFor();
    await page.getByRole('button', { name: '应用到同类选中设备', exact: true }).click();
    await page.locator('.library-status').filter({ hasText: '已应用数据副本' }).waitFor();
    assert.equal(await page.getByLabel('相对转速 n/n₀').inputValue(), '0.8');
    assert.equal(Number(await page.getByLabel('实际转速', { exact: true }).inputValue()), 1160);
    await page.getByLabel('实际转速', { exact: true }).fill('1015');
    await page.getByLabel('实际转速', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('相对转速 n/n₀').inputValue(), '0.7');
    await page.getByLabel('实际转速', { exact: true }).fill('1160');
    await page.getByLabel('实际转速', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 30000 });
    await shot(page, { path: path.join(out, '01-library-curve.png') });
    const saved = path.join(out, '双末端闭式循环 · 公开教学示例.ohn.json');
    const save = async () => {
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '工程已原子保存' }).waitFor();
      return JSON.parse(await fs.readFile(saved, 'utf8'));
    };
    let p = await save();
    assert.equal(p.library.length, 1);
    assert.equal(p.model.edges.find((e) => e.id === 'PU1').speed, 0.8);
    await page.getByRole('button', { name: '删除库条目', exact: true }).click();
    p = await save();
    assert.equal(p.library.length, 0);
    assert.equal(p.model.edges.find((e) => e.id === 'PU1').nominal_rpm, 1450);
    assert.ok(p.model.edges.find((e) => e.id === 'PU1').device_data.fit.points_si.length === 4);
    await page.keyboard.press('Control+z');
    await page.getByRole('button', { name: '导出库 JSON', exact: true }).click();
    await page.locator('.library-status').filter({ hasText: '库已导出' }).waitFor();
    const catalog = path.join(out, 'OpenHydroNet-设备库.json');
    assert.equal(JSON.parse(await fs.readFile(catalog, 'utf8')).entries.length, 1);
    await app.evaluate((_electron, file) => {
      globalThis.inputFile = file;
    }, catalog);
    await page.getByRole('button', { name: '导入库 JSON（副本）', exact: true }).click();
    await page.locator('.library-status').filter({ hasText: '已作为副本导入' }).waitFor();
    p = await save();
    assert.equal(p.library.length, 2);
    assert.notEqual(p.library[0].id, p.library[1].id);
    await app.evaluate(
      (_electron, file) => {
        globalThis.inputFile = file;
      },
      path.join(out, 'diameters.csv'),
    );
    await page.getByRole('button', { name: '导入参数表', exact: true }).click();
    await page.getByRole('button', { name: '选择 CSV / XLSX', exact: true }).click();
    await page.getByLabel('映射 diameter', { exact: true }).selectOption('diameter_mm');
    await page.getByLabel('输入单位 diameter', { exact: true }).selectOption('mm');
    await page.getByRole('button', { name: '转换单位并预览变化', exact: true }).click();
    await page.getByRole('table', { name: '导入变化预览' }).waitFor();
    assert.ok(
      (await page.getByRole('table', { name: '导入变化预览' }).innerText()).includes('0.05'),
    );
    await shot(page, { path: path.join(out, '02-unit-mapping-preview.png') });
    await page.getByRole('button', { name: '确认应用（可整体撤销）', exact: true }).click();
    p = await save();
    assert.equal(p.model.edges.find((e) => e.id === 'P2').diameter, 0.05);
    assert.equal(p.model.edges.find((e) => e.id === 'P3').diameter, 0.05);
    assert.equal(p.result_metadata, undefined);
    await page.keyboard.press('Control+z');
    p = await save();
    assert.equal(p.model.edges.find((e) => e.id === 'P2').diameter, 0.065);
    assert.equal(p.model.edges.find((e) => e.id === 'P3').diameter, 0.065);
    assert.ok(p.result_metadata.input_hash);
    await page.getByRole('button', { name: '参数 Excel', exact: true }).click();
    await page.locator('.statusbar').filter({ hasText: '导出完成' }).waitFor();
    await page.getByRole('button', { name: '结果 Excel', exact: true }).click();
    await page.locator('.statusbar').filter({ hasText: '导出完成' }).waitFor();
    const parameters = path.join(out, '双末端闭式循环 · 公开教学示例·输入参数.xlsx'),
      results = path.join(out, '双末端闭式循环 · 公开教学示例·计算结果.xlsx');
    for (const file of [parameters, results])
      assert.equal((await fs.readFile(file)).subarray(0, 2).toString(), 'PK');
    await app.evaluate((_electron, file) => {
      globalThis.inputFile = file;
    }, parameters);
    await page.getByRole('button', { name: '导入参数表', exact: true }).click();
    await page.getByRole('button', { name: '选择 CSV / XLSX', exact: true }).click();
    await page.getByLabel('Excel 工作表', { exact: true }).selectOption('管段');
    await page.getByLabel('映射 diameter', { exact: true }).waitFor();
    await page.getByRole('button', { name: '转换单位并预览变化', exact: true }).click();
    await page.getByRole('table', { name: '导入变化预览' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '确认应用（可整体撤销）', exact: true }).isDisabled(),
      true,
    );
    await shot(page, { path: path.join(out, '03-xlsx-roundtrip.png') });
    await page.getByRole('button', { name: '关闭导入', exact: true }).click();
    await page.getByTestId('select-V1').click();
    await page.getByLabel('阀门开度', { exact: true }).fill('0.6');
    await page.getByLabel('阀门开度', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '＋ 阀门', exact: true }).click();
    await page.getByLabel('库中全开 Kv', { exact: true }).fill('120');
    await page.getByLabel('库中全开 Kv', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '应用到同类选中设备', exact: true }).click();
    await page.locator('.library-status').filter({ hasText: '已应用数据副本' }).waitFor();
    p = await save();
    const valve = p.model.edges.find((e) => e.id === 'V1');
    assert.equal(valve.kv, 120);
    assert.equal(valve.opening, 0.6);
    assert.equal(valve.source, 's1');
    assert.equal(valve.target, 't1');
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, 'test-result.json'),
      JSON.stringify(
        {
          version,
          status: 'passed',
          checks: [
            'synthetic pump curve fit with bad-data rejection',
            'curve source and N0 metadata',
            'apply preserves IDs/connections/speed',
            'actual rpm input',
            'library deletion preserves engineering data',
            'JSON catalog export/import copies IDs',
            'CSV column mapping and mm→m preview',
            'atomic import undo',
            'stale metadata removed',
            'real XLSX parameter/result export and no-change reimport',
            'valve library apply preserves opening and endpoints',
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log('PASS: real library, curve fit, CSV mapping and XLSX workflows');
  } catch (e) {
    console.error(e, errors);
    process.exitCode = 1;
    try {
      await (await app.firstWindow()).screenshot({ path: path.join(out, 'failure.png') });
    } catch {}
  } finally {
    await app.close();
  }
})();
