// T-015 (W4-06): waiting for the local compute backend. Node child processes stand in for Python so the
// same tests run on Linux and Windows CI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { waitForBackend } = require('../desktop/backend-launcher.cjs');

const TOKEN = 'secret-token';
const READY = JSON.stringify({ protocol: 1, port: 4321, token: TOKEN });
function child(script) {
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}
const delayedReady = (ms, line = READY) =>
  child(
    `setTimeout(() => process.stdout.write(${JSON.stringify(line + '\n')}), ${ms}); setInterval(() => {}, 1000);`,
  );
async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail('expected a rejection');
}

test('resolves with the ready line and does not call the slow notice when fast', async () => {
  const c = delayedReady(100);
  let slow = 0;
  try {
    const info = await waitForBackend(c, {
      token: TOKEN,
      timeoutMs: 10000,
      slowAfterMs: 5000,
      onSlow: () => slow++,
    });
    assert.deepEqual(info, { protocol: 1, port: 4321, token: TOKEN });
    assert.equal(slow, 0);
  } finally {
    c.kill();
  }
});

test('a slow cold start is waited for, with exactly one slow notice', async () => {
  const c = delayedReady(1200);
  let slow = 0;
  try {
    const info = await waitForBackend(c, {
      token: TOKEN,
      timeoutMs: 10000,
      slowAfterMs: 200,
      onSlow: () => slow++,
    });
    assert.equal(info.port, 4321);
    assert.equal(slow, 1);
  } finally {
    c.kill();
  }
});

test('a ready line split across output chunks is still recognised', async () => {
  const [a, b] = [READY.slice(0, 10), READY.slice(10) + '\n'];
  const c = child(
    `process.stdout.write(${JSON.stringify(a)}); setTimeout(() => process.stdout.write(${JSON.stringify(b)}), 150); setInterval(() => {}, 1000);`,
  );
  try {
    assert.equal((await waitForBackend(c, { token: TOKEN, timeoutMs: 5000 })).port, 4321);
  } finally {
    c.kill();
  }
});

test('timeout is reported as such, in seconds, and leaves stopping the process to the caller', async () => {
  const c = child('setInterval(() => {}, 1000);');
  try {
    const e = await rejection(waitForBackend(c, { token: TOKEN, timeoutMs: 400 }));
    assert.equal(e.kind, 'timeout');
    assert.match(e.message, /计算内核在 0\.4 秒内未就绪/);
    assert.equal(c.exitCode, null, 'still running: the caller decides to stop or keep waiting');
  } finally {
    c.kill();
  }
});

test('an early exit is distinguished from a timeout and carries the exit code and stderr tail', async () => {
  const c = child('process.stderr.write("ModuleNotFoundError: numpy\\n"); process.exit(3);');
  const e = await rejection(waitForBackend(c, { token: TOKEN, timeoutMs: 10000 }));
  assert.equal(e.kind, 'exit');
  assert.match(e.message, /计算内核启动后退出（退出码 3）/);
  assert.match(e.detail, /ModuleNotFoundError: numpy/);
});

test('a missing runtime is reported as not found', async () => {
  const c = spawn('/definitely/missing/python.exe', ['-m', 'x'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const e = await rejection(waitForBackend(c, { token: TOKEN, timeoutMs: 10000 }));
  assert.equal(e.kind, 'spawn');
  assert.match(e.message, /无法启动计算运行时/);
});

test('a wrong token, protocol or non-JSON first line is a protocol error', async () => {
  for (const line of [
    JSON.stringify({ protocol: 1, port: 1, token: 'other' }),
    JSON.stringify({ protocol: 2, port: 1, token: TOKEN }),
    'Traceback (most recent call last):',
  ]) {
    const c = delayedReady(10, line);
    try {
      const e = await rejection(waitForBackend(c, { token: TOKEN, timeoutMs: 5000 }));
      assert.equal(e.kind, 'protocol', line);
      assert.match(e.message, /通信协议不匹配/);
    } finally {
      c.kill();
    }
  }
});

test('every failure kind has a specific Chinese hint', () => {
  const { startupHint } = require('../desktop/backend-launcher.cjs');
  for (const kind of ['timeout', 'exit', 'spawn', 'protocol'])
    assert.match(startupHint(kind), /[\u4e00-\u9fa5]/);
  assert.match(startupHint('timeout'), /杀毒软件/);
  assert.match(startupHint('spawn'), /python\.exe/);
  assert.notEqual(startupHint('timeout'), startupHint('exit'));
});
