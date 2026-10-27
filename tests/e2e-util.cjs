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

module.exports = { shot };
