const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const { createDocumentController } = require('./document-controller.cjs');
const { atomic, parseUtf8Json } = require('./storage.cjs');
const { waitForBackend, startupHint } = require('./backend-launcher.cjs');
const { version: APP_VERSION } = require('../package.json');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
app.setName('OpenHydroNet');
if (process.env.OHN_PROFILE) app.setPath('userData', path.resolve(process.env.OHN_PROFILE));
app.commandLine.appendSwitch('disable-background-networking');
const primaryInstance = app.requestSingleInstanceLock();
let backend,
  mainWindow,
  quitting = false,
  quitApproved = false,
  finalizing = false,
  connection;
let draftQueue = Promise.resolve(),
  draftProtected = false;
const flushRequests = new Map();
function flushRenderer() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame())
    return Promise.resolve();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      flushRequests.delete(id);
      reject(Error('界面未响应保存请求；工程未退出，请先保存或检查界面状态'));
    }, 3000);
    flushRequests.set(id, () => {
      clearTimeout(timer);
      resolve();
    });
    mainWindow.webContents.send('ohn:flush-editor', id);
  });
}
ipcMain.on('ohn:flushed', (event, id) => {
  if (event.sender === mainWindow?.webContents) {
    flushRequests.get(id)?.();
    flushRequests.delete(id);
  }
});
const documents = createDocumentController({
  dialog,
  getWindow: () => mainWindow,
  atomic,
  flushRenderer,
});
function requestExit() {
  return documents
    .requestQuit(async () => {
      finalizing = true;
      mainWindow?.setEnabled(false);
      try {
        await draftQueue.catch(() => {});
        if (!draftProtected)
          await fs.rm(path.join(app.getPath('userData'), 'recovery.ohn.json'), { force: true });
        quitApproved = true;
        quitting = true;
        mainWindow?.destroy();
        await stopBackend();
        app.quit();
      } catch (error) {
        if (!quitApproved) {
          finalizing = false;
          mainWindow?.setEnabled(true);
        }
        throw error;
      }
    })
    .catch((error) => dialog.showErrorBox('退出已取消', error.message));
}
const safeName = (name) => path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
function setupIPC() {
  const guard = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw Error('拒绝未知窗口请求');
  };
  ipcMain.handle('ohn:open', async (event, kind) => {
    guard(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'library' ? '导入设备库 JSON（作为副本）' : '打开 OpenHydroNet 工程',
      filters: [{ name: 'OpenHydroNet 工程', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 5_000_000) throw Error('工程文件超过 5 MB');
    return parseUtf8Json(await fs.readFile(filePaths[0]));
  });
  ipcMain.handle('ohn:import-table', async (event) => {
    guard(event);
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择 CSV / Excel 参数表',
      filters: [{ name: 'CSV / Excel 参数表', extensions: ['csv', 'xlsx'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const file = r.filePaths[0],
      format = path.extname(file).slice(1).toLowerCase();
    if (!['csv', 'xlsx'].includes(format)) throw Error('仅支持 CSV/XLSX，不支持旧 XLS 或宏工作簿');
    if ((await fs.stat(file)).size > 3_000_000) throw Error('参数表文件超过 3 MB，请拆分导入');
    return {
      name: path.basename(file),
      format,
      content_base64: (await fs.readFile(file)).toString('base64'),
    };
  });
  ipcMain.handle('ohn:save', async (event, data) => {
    guard(event);
    return documents.save(data);
  });
  ipcMain.handle('ohn:document-state', (event, data) => {
    guard(event);
    documents.update(data);
    return true;
  });
  ipcMain.handle('ohn:confirm-unsaved', (event, reason) => {
    guard(event);
    return documents.decision(String(reason || ''));
  });
  ipcMain.handle('ohn:draft', async (event, data) => {
    guard(event);
    const file = path.join(app.getPath('userData'), 'recovery.ohn.json');
    if (data === undefined) {
      try {
        if ((await fs.stat(file)).size > 5_000_000)
          throw Error('恢复草稿超过 5 MB，请先手动备份并拆分');
        const bytes = await fs.readFile(file);
        await atomic(path.join(app.getPath('userData'), 'recovery.previous.ohn.json'), bytes);
        return parseUtf8Json(bytes);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        draftProtected = true;
        throw e;
      }
    }
    if (finalizing) throw Error('正在退出，不再写入恢复草稿');
    if (draftProtected)
      throw Error('旧草稿读取/备份失败，暂不覆盖；请正式保存新工程并手动处理恢复文件');
    if (data?.format !== 'openhydronet') throw Error('草稿无效');
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 5_000_000)
      throw Error('草稿超过 5 MB，请删除不需要的工况或拆分工程');
    draftQueue = draftQueue.catch(() => {}).then(() => atomic(file, JSON.stringify(data)));
    await draftQueue;
    return true;
  });
  ipcMain.handle('ohn:version', (event) => {
    guard(event);
    return { version: APP_VERSION, protocol: 1 };
  });
  ipcMain.handle('ohn:export', async (event, data) => {
    guard(event);
    if (
      !['json', 'csv', 'html', 'pdf', 'svg', 'png', 'xlsx'].includes(data.kind) ||
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
    } else
      await atomic(
        filePath,
        data.kind === 'xlsx' ? Buffer.from(data.content, 'base64') : data.content,
      );
    return true;
  });
}
// ---- Backend startup (T-015, W4-06) ----
// A freshly unpacked package can need well over 15 s on the first start (antivirus scanning new files).
// The startup window gives visible progress, waits up to BACKEND_TIMEOUT_MS while the process is alive,
// reports timeout / exit / missing runtime / protocol separately and offers retry instead of exiting.
const BACKEND_TIMEOUT_MS =
  Number(process.env.OHN_BACKEND_TIMEOUT_MS) > 0
    ? Number(process.env.OHN_BACKEND_TIMEOUT_MS)
    : 120000;
const SLOW_AFTER_MS = 10000;
let startupWindow, startupStatus;
function spawnBackend(token) {
  const packaged = path.join(root, 'runtime', 'python.exe');
  const python = process.env.OHN_PYTHON || (process.platform === 'win32' ? packaged : 'python3');
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
  return { child: backend, python };
}
function sendStartupStatus(status) {
  startupStatus = { version: APP_VERSION, ...status };
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.webContents.send('ohn:startup-status', startupStatus);
    if (status.state === 'failed') startupWindow.show();
  }
}
function createStartupWindow() {
  startupWindow = new BrowserWindow({
    width: 600,
    height: 400,
    resizable: false,
    minimizable: true,
    maximizable: false,
    backgroundColor: '#f3f7fb',
    title: 'OpenHydroNet',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'startup-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  startupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  startupWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  startupWindow.webContents.on(
    'did-finish-load',
    () => startupStatus && sendStartupStatus(startupStatus),
  );
  startupWindow.on('closed', () => {
    startupWindow = null;
    if (!mainWindow) quitBeforeMainWindow();
  });
  startupWindow.loadFile(path.join(__dirname, 'startup.html'));
  // Fast starts (warm package, ~1 s) finish before this and never flash the window.
  setTimeout(
    () => startupWindow && !startupWindow.isDestroyed() && !mainWindow && startupWindow.show(),
    700,
  );
}
async function quitBeforeMainWindow() {
  quitApproved = true;
  quitting = true;
  await stopBackend();
  app.quit();
}
let launching = false;
async function launch() {
  if (launching || quitting) return;
  launching = true;
  connection = null;
  await stopBackend();
  const token = crypto.randomBytes(32).toString('base64url');
  const started = Date.now();
  let slow = false;
  const progress = () =>
    sendStartupStatus({
      state: slow ? 'slow' : 'starting',
      elapsed: Math.round((Date.now() - started) / 1000),
      message: '正在启动计算内核…',
      hint: slow
        ? '比平时慢：首次启动或杀毒软件扫描刚解压的文件时，可能需要一分钟左右，请稍候。'
        : '',
    });
  progress();
  const ticker = setInterval(progress, 1000);
  let info, python;
  try {
    const spawned = spawnBackend(token);
    python = spawned.python;
    info = await waitForBackend(spawned.child, {
      token,
      timeoutMs: BACKEND_TIMEOUT_MS,
      slowAfterMs: SLOW_AFTER_MS,
      onSlow: () => {
        slow = true;
        progress();
      },
    });
  } catch (e) {
    clearInterval(ticker);
    await stopBackend();
    launching = false;
    if (quitting) return;
    sendStartupStatus({
      state: 'failed',
      kind: e.kind || 'spawn',
      message: '启动失败：' + e.message,
      hint: startupHint(e.kind),
      detail: ['运行时：' + python, e.detail].filter(Boolean).join('\n'),
    });
    return;
  }
  clearInterval(ticker);
  connection = info;
  const child = backend;
  child.once('exit', () => {
    if (child !== backend || quitting || !connection) return;
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'OpenHydroNet',
      message: '计算进程异常退出',
      detail: '请保存工程并重启软件；已有输入仍可恢复。',
      buttons: ['确定'],
      noLink: true,
    });
    mainWindow?.webContents.send('ohn:backend-exit');
  });
  try {
    await openMainWindow(info);
  } catch (e) {
    await stopBackend();
    sendStartupStatus({
      state: 'failed',
      kind: 'window',
      message: '启动失败：主窗口无法加载界面',
      hint: startupHint('window'),
      detail: e.message,
    });
  } finally {
    launching = false;
  }
}
ipcMain.on('ohn:startup-retry', (event) => {
  if (event.sender === startupWindow?.webContents && !mainWindow) launch();
});
ipcMain.on('ohn:startup-quit', (event) => {
  if (event.sender === startupWindow?.webContents && !mainWindow) startupWindow.close();
});
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
if (!primaryInstance) {
  quitApproved = true;
  quitting = true;
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
async function openMainWindow(info) {
  const localOrigin = `http://127.0.0.1:${info.port}`;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => callback({ cancel: new URL(details.url).origin !== localOrigin }),
  );
  const win = new BrowserWindow({
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
      spellcheck: false,
    },
  });
  win.on('close', (event) => {
    if (!quitApproved) {
      event.preventDefault();
      requestExit();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${localOrigin}/`)) event.preventDefault();
  });
  win.once('ready-to-show', () => {
    win.show();
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.destroy();
  });
  // Assigned before loading: ready-to-show may fire first and closes the startup window, whose
  // 'closed' handler must then see that the main window exists.
  mainWindow = win;
  try {
    await win.loadURL(`${localOrigin}/#token=${info.token}`);
  } catch (e) {
    mainWindow = null;
    win.destroy();
    throw e;
  }
}
app.whenReady().then(() => {
  if (!primaryInstance) return;
  setupIPC();
  Menu.setApplicationMenu(null);
  createStartupWindow();
  launch();
});
app.on('window-all-closed', () => {
  if (!quitting) requestExit();
});
app.on('before-quit', (event) => {
  if (quitApproved) return;
  event.preventDefault();
  requestExit();
});
