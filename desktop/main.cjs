const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
app.setName('OpenHydroNet');
if (process.env.OHN_PROFILE) app.setPath('userData', path.resolve(process.env.OHN_PROFILE));
let backend,
  mainWindow,
  quitting = false,
  connection;
const safeName = (name) => path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
async function atomic(file, content) {
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
function setupIPC() {
  const guard = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw Error('拒绝未知窗口请求');
  };
  ipcMain.handle('ohn:open', async (event) => {
    guard(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '打开 OpenHydroNet 工程',
      filters: [{ name: 'OpenHydroNet 工程', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 5_000_000) throw Error('工程文件超过 5 MB');
    return JSON.parse(await fs.readFile(filePaths[0], 'utf-8'));
  });
  ipcMain.handle('ohn:save', async (event, data) => {
    guard(event);
    if (data?.format !== 'openhydronet' || data.schema_version !== 1) throw Error('工程版本无效');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存工程',
      defaultPath: safeName(data.name || '工程') + '.ohn.json',
      filters: [{ name: 'OpenHydroNet 工程', extensions: ['json'] }],
    });
    if (canceled) return false;
    await atomic(filePath, JSON.stringify(data, null, 2) + '\n');
    return true;
  });
  ipcMain.handle('ohn:draft', async (event, data) => {
    guard(event);
    const file = path.join(app.getPath('userData'), 'recovery.ohn.json');
    if (data === undefined) {
      try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    }
    if (data?.format !== 'openhydronet') throw Error('草稿无效');
    await atomic(file, JSON.stringify(data));
    return true;
  });
  ipcMain.handle('ohn:version', (event) => {
    guard(event);
    return { version: '0.1.0-preview.1', protocol: 1 };
  });
  ipcMain.handle('ohn:export', async (event, data) => {
    guard(event);
    if (
      !['json', 'csv', 'html', 'pdf', 'svg', 'png'].includes(data.kind) ||
      typeof data.content !== 'string' ||
      data.content.length > 20_000_000
    )
      throw Error('导出数据无效');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出文件',
      defaultPath: safeName(data.name),
    });
    if (canceled) return false;
    if (data.kind === 'pdf') {
      const report = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: false,
        },
      });
      try {
        await report.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(data.content));
        await atomic(
          filePath,
          await report.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            landscape: true,
            margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
          }),
        );
      } finally {
        report.destroy();
      }
    } else if (data.kind === 'png') {
      if (!data.content.startsWith('data:image/png;base64,')) throw Error('PNG 内容无效');
      await atomic(filePath, Buffer.from(data.content.split(',')[1], 'base64'));
    } else await atomic(filePath, data.content);
    return true;
  });
}
function startBackend() {
  return new Promise((resolve, reject) => {
    const packaged = path.join(root, 'runtime', 'python.exe');
    const python = process.env.OHN_PYTHON || (process.platform === 'win32' ? packaged : 'python3');
    const token = crypto.randomBytes(32).toString('base64url');
    backend = spawn(python, ['-m', 'openhydronet.cli', 'serve'], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: path.join(root, 'src'),
        PYTHONIOENCODING: 'utf-8',
        OHN_SESSION_TOKEN: token,
        OPENBLAS_NUM_THREADS: '1',
        OMP_NUM_THREADS: '1',
      },
    });
    let output = '',
      stderr = '';
    const timer = setTimeout(() => reject(Error('本地计算进程启动超时')), 15000);
    backend.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    backend.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-3000);
    });
    backend.once('exit', (code) => {
      clearTimeout(timer);
      if (!connection) reject(Error('计算进程未就绪，退出码 ' + code + ' ' + stderr));
      else if (!quitting) {
        dialog.showErrorBox(
          '计算进程退出',
          '计算进程异常退出。请保存工程并重启软件；已有输入仍可恢复。',
        );
        mainWindow?.webContents.send('ohn:backend-exit');
      }
    });
    backend.stdout.on('data', (d) => {
      output += d;
      if (!connection && output.includes('\n')) {
        try {
          const info = JSON.parse(output.split('\n')[0]);
          if (info.protocol !== 1 || info.token !== token) throw Error('通信协议不匹配');
          connection = info;
          clearTimeout(timer);
          resolve(info);
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      }
    });
  });
}
async function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  if (process.platform === 'win32')
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(backend.pid), '/T', '/F'], {
        windowsHide: true,
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  else {
    backend.kill('SIGTERM');
    await Promise.race([
      new Promise((r) => backend.once('exit', r)),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    if (backend.exitCode === null) backend.kill('SIGKILL');
  }
}
app.whenReady().then(async () => {
  try {
    setupIPC();
    const info = await startBackend();
    mainWindow = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1120,
      minHeight: 720,
      backgroundColor: '#f3f7fb',
      title: 'OpenHydroNet',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`http://127.0.0.1:${info.port}/`)) event.preventDefault();
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    await mainWindow.loadURL(`http://127.0.0.1:${info.port}/#token=${info.token}`);
  } catch (e) {
    dialog.showErrorBox('启动失败', e.message + '\n请检查随附 Python 运行时及构建说明。');
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopBackend().finally(() => app.quit());
});
