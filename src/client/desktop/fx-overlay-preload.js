// Preload for the whole-screen effects canvas (fx-overlay.html).
// One inbound channel, nothing else — the canvas can render visuals and
// that's all it can do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fxAPI', {
  onFx: (callback) => {
    ipcRenderer.on('fx', (_event, payload) => {
      if (payload && typeof payload.type === 'string') callback(payload);
    });
  },
});
