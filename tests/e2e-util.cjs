// Shared helpers for the real-Electron E2E suites.

/**
 * Evidence screenshot with a bounded retry. Hosted CI displays (Xvfb) occasionally reject a capture right
 * after a window paints ("Unable to capture screenshot"); screenshots are evidence, not assertions, so a
 * short retry is safe. Any other error, or three failed attempts, still fails the suite.
 */
async function shot(page, options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot(options);
    } catch (e) {
      if (attempt >= 3 || !/Unable to capture screenshot/.test(String(e && e.message))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

/**
 * The main workbench window. Since T-015 a startup window may exist first (hidden or showing progress),
 * so tests must not rely on window order: wait for the window served by the local backend.
 */
async function mainWindow(app, timeout = 120000) {
  const isMain = (page) => page.url().startsWith('http://127.0.0.1:');
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = app.windows().find(isMain);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('main window did not appear within ' + timeout + ' ms');
}

/** The startup window (desktop/startup.html), if it was created. */
function startupWindow(app) {
  return app.windows().find((page) => page.url().endsWith('/startup.html'));
}

module.exports = { shot, mainWindow, startupWindow };
