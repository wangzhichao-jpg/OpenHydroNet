// Waiting for the local compute backend (`python -m openhydronet.cli serve`) to print its ready line.
// T-015 (W4-06): a freshly unpacked package can need well over 15 s on its first start while antivirus
// scans the new files, so the limit is generous, a "slow" notice is raised early, and failures are
// classified so the user sees an accurate reason and can retry.

/** Startup failure; ``kind`` is timeout | exit | spawn | protocol. ``detail`` carries diagnostics. */
class BackendStartError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

const seconds = (ms) => +(ms / 1000).toFixed(1);

/**
 * Resolve with the backend's ready line ({protocol, port, token}) or reject with a BackendStartError.
 * The child is never killed here: on rejection the caller stops it (or decides otherwise).
 */
function waitForBackend(child, { token, timeoutMs = 120000, slowAfterMs = 10000, onSlow } = {}) {
  return new Promise((resolve, reject) => {
    let output = '',
      stderr = '',
      settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      fn(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new BackendStartError(
            'timeout',
            `计算内核在 ${seconds(timeoutMs)} 秒内未就绪`,
            stderr.slice(-1500),
          ),
        ),
      timeoutMs,
    );
    const slowTimer = setTimeout(() => !settled && onSlow && onSlow(), slowAfterMs);
    child.once('error', (e) =>
      finish(
        reject,
        new BackendStartError('spawn', '无法启动计算运行时：' + e.message, String(e.code || '')),
      ),
    );
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d).slice(-3000);
    });
    child.once('exit', (code, signal) =>
      finish(
        reject,
        new BackendStartError(
          'exit',
          `计算内核启动后退出（退出码 ${code ?? signal}）`,
          stderr.slice(-1500),
        ),
      ),
    );
    child.stdout?.on('data', (d) => {
      output += d;
      const end = output.indexOf('\n');
      if (end < 0) return;
      let info;
      try {
        info = JSON.parse(output.slice(0, end));
      } catch {
        info = null;
      }
      if (!info || info.protocol !== 1 || info.token !== token || !Number.isInteger(info.port))
        finish(
          reject,
          new BackendStartError('protocol', '计算内核通信协议不匹配', output.slice(0, 300)),
        );
      else finish(resolve, info);
    });
  });
}

/** What the user can do about each failure kind (shown in the startup window). */
const HINTS = {
  timeout:
    '首次启动时，杀毒软件可能仍在扫描刚解压的文件，计算内核会比平时慢。可点“重试”重新启动计算内核（扫描完成后通常很快）；若反复出现，请把本窗口文字发给维护者。',
  exit: '随附的 Python 运行时可能不完整或被拦截。请重新完整解压便携包，并按“开始使用.txt”核对 SHA-256。',
  spawn:
    '找不到或无法运行随附的 Python 运行时。请确认便携包已完整解压，且 resources\\app\\runtime\\python.exe 存在。',
  protocol: '计算内核与界面版本不一致。请勿混用不同版本的文件，重新完整解压便携包。',
};
const startupHint = (kind) => HINTS[kind] || '请重试；若反复出现，请把本窗口文字发给维护者。';

module.exports = { waitForBackend, BackendStartError, startupHint };
