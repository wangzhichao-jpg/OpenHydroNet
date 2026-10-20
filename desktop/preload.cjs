const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    open: () => ipcRenderer.invoke('ohn:open'),
    openLibrary: () => ipcRenderer.invoke('ohn:open', 'library'),
    importTable: () => ipcRenderer.invoke('ohn:import-table'),
    save: (data) => ipcRenderer.invoke('ohn:save', data),
    draft: (data) => ipcRenderer.invoke('ohn:draft', data),
    export: (data) => ipcRenderer.invoke('ohn:export', data),
    version: () => ipcRenderer.invoke('ohn:version'),
    documentState: (data) => ipcRenderer.invoke('ohn:document-state', data),
    confirmUnsaved: (reason) => ipcRenderer.invoke('ohn:confirm-unsaved', reason),
    onFlushEditor: (callback) => {
      const handler = async (_event, id) => {
        await callback();
        ipcRenderer.send('ohn:flushed', id);
      };
      ipcRenderer.on('ohn:flush-editor', handler);
      return () => ipcRenderer.removeListener('ohn:flush-editor', handler);
    },
  }),
);
