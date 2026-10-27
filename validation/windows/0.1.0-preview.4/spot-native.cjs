// W4-04: real native dialogs (NO dialog interception). Playwright only clicks inside the page.
const L = require('./lib.cjs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const { _electron } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.join(L.SHOTS, 'W4-04');
const dlg = (shot, button) =>
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'spot-native-dlg.ps1'),
    'OpenHydroNet-0.1.0-preview.4-win-x64', path.join(dir, shot), button], { encoding: 'utf8' }).then((r) => r.stdout, (e) => 'ERR ' + e.stdout);
(async () => {
  const app = await _electron.launch({ executablePath: L.EXE, cwd: L.APP, env: { ...process.env, OHN_PROFILE: L.PROFILE }, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByTestId('start-example').click();
  await page.getByTestId('select-PU1').waitFor();
  // Real "save as": click Save in the page, then cancel the native dialog.
  const clicked = page.getByRole('button', { name: '保存', exact: true }).click();
  console.log(await dlg('W4-04-原生另存为对话框.png', '取消'));
  await clicked;
  await sleep(1000);
  console.log('after cancel status:', (await page.locator('.statusbar').innerText()).split('\n')[1]);
  // Real close prompt (example is unsaved): close the window, capture, choose 放弃修改.
  const closing = app.waitForEvent('close', { timeout: 60000 });
  const t = Date.now();
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
  console.log(await dlg('W4-04-原生未保存确认框.png', '放弃修改'));
  await closing;
  console.log('exit ms after close request', Date.now() - t);
  await sleep(5000);
  console.log('leftover', JSON.stringify(L.packageProcesses()));
})().catch((e) => { console.error(e); process.exit(1); });
