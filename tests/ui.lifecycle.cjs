const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  version = require('../package.json').version,
  out = path.join(root, 'artifacts', 'lifecycle', version);
(async () => {
  await fs.mkdir(out, { recursive: true });
  const errors = [];
  const app = await _electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, OHN_PROFILE: path.join(root, '.local', 'lifecycle-test-profile') },
  });
  let closed = false;
  try {
    await app.evaluate(({ dialog }, dir) => {
      globalThis.testDecisions = [];
      globalThis.testMessages = [];
      globalThis.testCancelSave = false;
      dialog.showMessageBox = async (_w, options) => {
        globalThis.testMessages.push(options.message);
        return { response: globalThis.testDecisions.shift() ?? 2 };
      };
      dialog.showSaveDialog = async () => ({
        canceled: globalThis.testCancelSave,
        filePath: dir + '/lifecycle.ohn.json',
      });
    }, out);
    const page = await app.firstWindow();
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(e.stack);
    });
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-P2').waitFor();
    async function number(label, value, commit = true) {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(String(value));
      if (commit) await input.press('Enter');
    }
    async function calculate() {
      await page.getByRole('button', { name: '计算', exact: true }).click();
      await page
        .locator('.canvas-badge')
        .filter({ hasText: '计算通过' })
        .waitFor({ timeout: 30000 });
    }
    await calculate();
    await page.getByRole('button', { name: '对比', exact: true }).click();
    await page.getByRole('button', { name: '保存当前工况快照' }).click();
    await page.getByLabel('流量单位').selectOption('kg/h');
    await page.keyboard.press('Escape');
    await number('水温', 0);
    await page.getByTestId('select-T2').click();
    assert.ok(
      Math.abs(
        Number(await page.getByLabel('末端设计流量', { exact: true }).inputValue()) -
          0.004 * 999.8675791619049 * 3600,
      ) < 0.1,
    );
    await page.keyboard.press('Escape');
    await number('水温', 80);
    await calculate();
    await page.getByRole('button', { name: '工况对比', exact: true }).click();
    await page.getByLabel('对比工况').selectOption({ label: '工况 1' });
    const expected = JSON.parse(
      execFileSync(
        process.env.OHN_PYTHON || 'python3',
        [
          '-c',
          "import json;from openhydronet import solve,load_project;p=load_project('examples/closed-loop.ohn.json');a=solve(p['model']);p['model']['fluid']['temperature']=80;b=solve(p['model']);print(json.dumps([a['edges']['PU1']['flow_m3_s']*a['fluid']['density_kg_m3']*3600,b['edges']['PU1']['flow_m3_s']*b['fluid']['density_kg_m3']*3600]))",
        ],
        {
          cwd: root,
          env: { ...process.env, PYTHONPATH: path.join(root, 'src'), OPENBLAS_NUM_THREADS: '1' },
          encoding: 'utf8',
        },
      ),
    );
    const row = page.locator('tbody tr').filter({ hasText: '循环泵' });
    const values = await row.locator('td').allTextContents();
    const parse = (s) => Number(s.replaceAll(',', '').replace('%', ''));
    assert.ok(Math.abs(parse(values[1]) - expected[0]) / expected[0] < 0.006);
    assert.ok(Math.abs(parse(values[2]) - expected[1]) / expected[1] < 0.006);
    const pct = ((expected[1] - expected[0]) / expected[0]) * 100;
    assert.ok(Math.abs(parse(values[4]) - pct) < 0.06);
    await page.screenshot({ path: path.join(out, '01-cross-temperature.png') });
    await page.getByTestId('select-PU1').click();
    await number('相同并联泵台数', 1.5, false);
    assert.equal(await page.getByLabel('相同并联泵台数').getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.ok((await page.getByRole('status').innerText()).includes('无效参数'));
    await number('相同并联泵台数', 1);
    // Native quit must commit the focused field, ask, and leave the backend alive on cancel.
    await number('相对转速 n/n₀', 0.9, false);
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.testDecisions = [2];
      BrowserWindow.getAllWindows()[0].close();
    });
    await page.waitForTimeout(400);
    assert.equal(page.isClosed(), false);
    assert.equal(await page.getByLabel('相对转速 n/n₀').inputValue(), '0.9');
    const status = await page.evaluate(() =>
      fetch('/api/health', {
        headers: { 'X-Session-Token': sessionStorage.getItem('ohn-session') },
      }).then((r) => r.status),
    );
    assert.equal(status, 200);
    assert.ok(
      (await app.evaluate(() => globalThis.testMessages)).some((x) => x.includes('未保存修改')),
    );
    // New/open transitions respect cancel too, without replacing the current project.
    await page.getByRole('button', { name: '新建 / 模板', exact: true }).click();
    await app.evaluate(() => {
      globalThis.testDecisions = [2];
    });
    await page.getByRole('button', { name: '空白工程', exact: false }).click();
    await page.waitForTimeout(100);
    assert.ok((await page.locator('.project-title').innerText()).includes('双末端'));
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.testCancelSave = true;
      globalThis.testDecisions = [0];
      BrowserWindow.getAllWindows()[0].close();
    });
    await page.waitForTimeout(250);
    assert.equal(page.isClosed(), false);
    await app.evaluate(() => {
      globalThis.testCancelSave = false;
    });
    await page.screenshot({ path: path.join(out, '02-preserved-after-cancel.png') });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, 'test-result.json'),
      JSON.stringify(
        {
          version,
          status: 'passed',
          checks: [
            '0°C before re-solving uses current density',
            '20→80°C scenario mass comparison',
            'integer inline validation',
            'invalid-input computation blocked',
            'native close flushes focused numeric editor',
            'cancel close keeps solver alive',
            'cancel new keeps project',
            'cancel save cancels exit',
            'save-and-quit writes current input',
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    const closing = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.testDecisions = [0];
      BrowserWindow.getAllWindows()[0].close();
    });
    await closing;
    closed = true;
    const saved = JSON.parse(await fs.readFile(path.join(out, 'lifecycle.ohn.json'), 'utf8'));
    assert.equal(saved.model.edges.find((e) => e.id === 'PU1').speed, 0.9);
    assert.equal(saved.model.fluid.temperature, 80);
    console.log(
      'PASS: cross-temperature units, invalid-field guard, real close/save/cancel lifecycle',
    );
  } catch (e) {
    console.error(e, errors);
    process.exitCode = 1;
    try {
      await (await app.firstWindow()).screenshot({ path: path.join(out, 'failure.png') });
    } catch {}
  } finally {
    if (!closed) {
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1 });
        })
        .catch(() => {});
      await app.close();
    }
  }
})();
