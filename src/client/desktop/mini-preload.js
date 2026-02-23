const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windyMini', {
  onStateChange: (cb) => ipcRenderer.on('mini-state-change', (_, state) => cb(state)),
  expandWindow: () => ipcRenderer.send('mini-expand')
});
