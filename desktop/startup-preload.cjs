// Startup window (T-015): render status pushed by the main process and send retry / quit.
// Sandboxed preload: only ipcRenderer is used; nothing is exposed to the page.
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  $('retry').addEventListener('click', () => ipcRenderer.send('ohn:startup-retry'));
  $('quit').addEventListener('click', () => ipcRenderer.send('ohn:startup-quit'));
  ipcRenderer.on('ohn:startup-status', (_event, s) => {
    document.body.classList.toggle('failed', s.state === 'failed');
    $('version').textContent = s.version ? '版本 ' + s.version : '';
    $('message').textContent = s.message || '';
    $('hint').textContent = s.hint || '';
    $('elapsed').textContent = s.state === 'failed' ? '' : `已等待 ${s.elapsed ?? 0} 秒`;
    $('detail').textContent = s.detail || '';
    if (s.state === 'failed') $('retry').focus();
  });
});
