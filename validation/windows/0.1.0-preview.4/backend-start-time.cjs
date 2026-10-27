// Time from spawning the packaged backend (same command/env as desktop/main.cjs startBackend) to its ready line.
// Usage: node backend-start-time.cjs <app dir> [label]
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(process.argv[2], 'resources', 'app');
const t0 = process.hrtime.bigint();
const token = crypto.randomBytes(32).toString('base64url');
const p = spawn(path.join(root, 'runtime', 'python.exe'), ['-m', 'openhydronet.cli', 'serve'], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONPATH: path.join(root, 'src'), PYTHONIOENCODING: 'utf-8', OHN_SESSION_TOKEN: token, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
});
let out = '';
const done = (what) => {
  const s = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(JSON.stringify({ label: process.argv[3] || '', result: what, seconds: Math.round(s * 10) / 10, over15s: s > 15 }));
  spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }).on('exit', () => process.exit(0));
};
p.stdout.on('data', (d) => { out += d; if (out.includes('\n')) { const ok = JSON.parse(out.split('\n')[0]).token === token; done(ok ? 'ready' : 'bad-token'); } });
p.on('exit', (c) => done('exited ' + c));
setTimeout(() => done('no ready line after 120 s'), 120000);
