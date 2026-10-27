// T-015 (W4-06): slow first start, timeout with retry, and early backend exit — real Electron.
// The stand-in backend is a POSIX shell script, so this suite runs on Linux; the real Windows cold start
// is covered by the PC regression in docs/releases/HANDOFF-0.1.0-preview.5.md.
const { _electron: electron } = require('playwright');
const { shot, mainWindow, startupWindow } = require('./e2e-util.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'artifacts', 'startup', require('../package.json').version),
  standIn = path.join(__dirname, 'fixtures', 'slow-backend.sh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(env) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ohn-startup-'));
  const app = await electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: {
      ...process.env,
      OHN_PROFILE: profile,
      OHN_PYTHON: standIn,
      OHN_TEST_REAL_PYTHON: process.env.OHN_PYTHON || 'python3',
      ...env,
    },
    timeout: 30000,
  });
  const errors = [];
  app.on('window', (page) => page.on('pageerror', (e) => errors.push(e.message)));
  // Any native error box would be a regression: record instead of blocking.
  await app.evaluate(({ dialog }) => {
    globalThis.__dialogs = [];
    dialog.showErrorBox = (title, content) => globalThis.__dialogs.push({ title, content });
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async (...a) => {
      const options = a[a.length - 1];
      globalThis.__dialogs.push(options);
      // Closing after the test edited the example: discard instead of opening a real save dialog.
      const discard = (options.buttons || []).indexOf('放弃修改');
      return { response: discard >= 0 ? discard : 0 };
    };
    void original;
  });
  return { app, errors, profile };
}
async function waitStartup(app, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const w = startupWindow(app);
    if (w) return w;
    await sleep(100);
  }
  throw new Error('startup window not found');
}
const dialogs = (app) => app.evaluate(() => globalThis.__dialogs);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

(async () => {
  if (process.platform === 'win32') {
    console.log(
      'SKIP ui.startup: the stand-in backend is a POSIX shell script; Windows is covered by the PC regression',
    );
    return;
  }
  await fs.mkdir(out, { recursive: true });

  // A: a 20 s cold start is waited for with visible progress and a slow notice, then the workbench opens.
  {
    const { app, errors } = await launch({ OHN_TEST_MODE: 'delay', OHN_TEST_DELAY: '20' });
    try {
      const start = await waitStartup(app);
      await start.locator('#message').filter({ hasText: '正在启动计算内核…' }).waitFor();
      assert.match(await start.locator('#version').innerText(), /^版本 \d+\.\d+\.\d+/);
      await start
        .locator('#elapsed')
        .filter({ hasText: /已等待 [2-9] 秒/ })
        .waitFor({ timeout: 10000 });
      assert.equal(await start.evaluate(() => document.visibilityState), 'visible');
      await start.locator('#hint').filter({ hasText: '首次启动' }).waitFor({ timeout: 15000 });
      await shot(start, { path: path.join(out, '01-slow-start.png') });
      assert.equal(
        await start.locator('#retry').isVisible(),
        false,
        'no retry while still waiting',
      );
      const page = await mainWindow(app, 60000);
      await page.getByTestId('start-example').waitFor({ timeout: 30000 });
      for (let i = 0; i < 50 && startupWindow(app); i++) await sleep(100);
      assert.equal(startupWindow(app), undefined, 'startup window closes once the workbench shows');
      await page.getByTestId('start-example').click();
      await page.getByRole('button', { name: '计算', exact: true }).click();
      await page
        .locator('.canvas-badge')
        .filter({ hasText: '计算通过' })
        .waitFor({ timeout: 30000 });
      assert.deepEqual(await dialogs(app), []);
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
    }
  }

  // B: a timeout is reported as such and "重试" recovers; the first (slow) process is stopped.
  {
    const marker = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ohn-marker-')), 'first-run');
    const { app, errors } = await launch({
      OHN_TEST_MODE: 'first-slow',
      OHN_TEST_DELAY: '8',
      OHN_TEST_MARKER: marker,
      OHN_BACKEND_TIMEOUT_MS: '3000',
    });
    try {
      const start = await waitStartup(app);
      await start
        .locator('#message')
        .filter({ hasText: '启动失败：计算内核在 3 秒内未就绪' })
        .waitFor({ timeout: 15000 });
      assert.match(await start.locator('#hint').innerText(), /杀毒软件/);
      assert.match(await start.locator('#detail').innerText(), /运行时：.*slow-backend\.sh/);
      assert.equal(await start.locator('#retry').isVisible(), true);
      assert.equal(await start.locator('#quit').isVisible(), true);
      const firstPid = Number(await fs.readFile(marker + '.pid', 'utf8'));
      assert.equal(alive(firstPid), false, 'timed-out backend was stopped before offering retry');
      await shot(start, { path: path.join(out, '02-timeout.png') });
      await start.locator('#retry').click();
      const page = await mainWindow(app, 30000);
      await page.getByTestId('start-example').waitFor({ timeout: 30000 });
      assert.deepEqual(await dialogs(app), []);
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
    }
  }

  // C: an early exit is distinguished from a timeout and "退出" ends the application.
  {
    const { app } = await launch({ OHN_TEST_MODE: 'exit' });
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    const start = await waitStartup(app);
    await start
      .locator('#message')
      .filter({ hasText: '启动失败：计算内核启动后退出（退出码 3）' })
      .waitFor({ timeout: 15000 });
    assert.match(await start.locator('#detail').innerText(), /ModuleNotFoundError/);
    assert.match(await start.locator('#hint').innerText(), /重新完整解压/);
    await shot(start, { path: path.join(out, '03-exit.png') });
    // "退出" closes the application, possibly before Playwright receives the click acknowledgement.
    await start
      .locator('#quit')
      .click()
      .catch((e) => {
        if (!/has been closed/.test(e.message)) throw e;
      });
    await Promise.race([exited, sleep(15000).then(() => assert.fail('application did not exit'))]);
  }
  console.log('PASS: startup progress, slow cold start, timeout retry and early exit');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
