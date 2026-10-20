const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    open: () => ipcRenderer.invoke('ohn:open'),
    save: (data) => ipcRenderer.invoke('ohn:save', data),
    draft: (data) => ipcRenderer.invoke('ohn:draft', data),
    export: (data) => ipcRenderer.invoke('ohn:export', data),
    version: () => ipcRenderer.invoke('ohn:version'),
  }),
);
