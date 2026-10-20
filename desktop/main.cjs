const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const { createDocumentController } = require('./document-controller.cjs');
const { atomic, parseUtf8Json } = require('./storage.cjs');
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
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  try {
    setupIPC();
    Menu.setApplicationMenu(null);
    const info = await startBackend();
    const localOrigin = `http://127.0.0.1:${info.port}`;
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => callback({ cancel: new URL(details.url).origin !== localOrigin }),
    );
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
        spellcheck: false,
      },
    });
    mainWindow.on('close', (event) => {
      if (!quitApproved) {
        event.preventDefault();
        requestExit();
      }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`http://127.0.0.1:${info.port}/`)) event.preventDefault();
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    await mainWindow.loadURL(`http://127.0.0.1:${info.port}/#token=${info.token}`);
  } catch (e) {
    dialog.showErrorBox('启动失败', e.message + '\n请检查随附 Python 运行时及构建说明。');
    quitApproved = true;
    quitting = true;
    await stopBackend();
    app.quit();
  }
});
app.on('window-all-closed', () => {
  if (!quitting) requestExit();
});
app.on('before-quit', (event) => {
  if (quitApproved) return;
  event.preventDefault();
  requestExit();
});
