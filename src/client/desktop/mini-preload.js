const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windyMini', {
  onStateChange: (cb) => ipcRenderer.on('mini-state-change', (_, state) => cb(state)),
  onVoiceLevel: (cb) => ipcRenderer.on('mini-voice-level', (_, level) => cb(level)),
  onResize: (cb) => ipcRenderer.on('mini-resize', (_, size) => cb(size)),
  onWidgetChange: (cb) => ipcRenderer.on('mini-widget-change', (_, data) => cb(data)),
  expandWindow: () => ipcRenderer.send('mini-expand'),
  moveWindow: (dx, dy) => ipcRenderer.send('mini-move', { dx, dy })
});
