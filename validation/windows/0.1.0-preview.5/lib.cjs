// Helpers for driving the *packaged* preview.5 Windows build (PC regression only).
// Not part of the product; the product under test is the unmodified portable ZIP.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..', '..', '..');
const { _electron } = require(path.join(repo, 'node_modules', 'playwright'));
const { mainWindow } = require(path.join(repo, 'tests', 'e2e-util.cjs'));

const BASE = 'D:\\OHN验收\\预览5';
const APP = path.join(BASE, 'OpenHydroNet-0.1.0-preview.5-win-x64');
const EXE = path.join(APP, 'OpenHydroNet.exe');
const PROFILE = path.join(BASE, 'profile');
const TAG = process.env.ACC_RUN || '';
const EXPORTS = path.join(BASE, '导出', TAG);
const SHOTS = path.join(__dirname, '截图', TAG);
const LOG = path.join(__dirname, TAG ? `raw-results-${TAG}.jsonl` : 'raw-results.jsonl');
for (const d of [EXPORTS, SHOTS]) fs.mkdirSync(d, { recursive: true });

function record(item, data) {
  const line = { item, at: new Date().toISOString(), ...data };
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(JSON.stringify(line));
}

/** Processes whose executable lives inside the unpacked package directory. */
function packageProcesses() {
  const ps =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*OpenHydroNet-0.1.0-preview.5-win-x64*' } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; cmd=($_.CommandLine -replace '^.*?OpenHydroNet-0.1.0-preview.5-win-x64','<pkg>').Substring(0,[Math]::Min(140,($_.CommandLine -replace '^.*?OpenHydroNet-0.1.0-preview.5-win-x64','<pkg>').Length)) } } | ConvertTo-Json -Compress";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  if (!out) return [];
  const v = JSON.parse(out);
  return Array.isArray(v) ? v : [v];
}
const pythons = () => packageProcesses().filter((p) => /python/i.test(p.name));

async function launch() {
  const app = await _electron.launch({
    executablePath: EXE,
    args: [],
    cwd: APP,
    env: { ...process.env, OHN_PROFILE: PROFILE },
    timeout: 60000,
  });
  // Native dialogs: answered by the driver, every call is logged with its text and buttons.
  await app.evaluate(({ dialog }) => {
    globalThis.acc = { messages: [], saves: [], opens: [], nextSave: null, nextOpen: null, answer: null };
    dialog.showMessageBox = async (_w, o) => {
      const opts = o || _w;
      const want = globalThis.acc.answer;
      const idx = want ? opts.buttons.indexOf(want) : 0;
      globalThis.acc.messages.push({ message: opts.message, detail: opts.detail, buttons: opts.buttons, chose: opts.buttons[idx] });
      return { response: idx < 0 ? 0 : idx, checkboxChecked: false };
    };
    dialog.showSaveDialog = async (_w, o) => {
      const opts = o || _w;
      const fp = globalThis.acc.nextSave;
      globalThis.acc.saves.push({ defaultPath: opts.defaultPath, filePath: fp });
      return fp ? { canceled: false, filePath: fp } : { canceled: true };
    };
    dialog.showOpenDialog = async () => {
      const fp = globalThis.acc.nextOpen;
      globalThis.acc.opens.push(fp);
      return fp ? { canceled: false, filePaths: [fp] } : { canceled: true, filePaths: [] };
    };
  });
  const page = await mainWindow(app, 150000);
  return { app, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const num = (t) => Number(String(t).replace(/,/g, ''));

module.exports = { TAG, LOG, BASE, APP, EXE, PROFILE, EXPORTS, SHOTS, record, packageProcesses, pythons, launch, shot, num };
