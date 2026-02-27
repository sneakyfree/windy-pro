/**
 * Windy Pro v2.0 — Wizard Preload Bridge
 * Exposes safe IPC methods to the renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardAPI', {
  scanHardware: () => ipcRenderer.invoke('wizard-scan-hardware'),
  selectModels: (ids) => ipcRenderer.invoke('wizard-select-models', ids),
  install: () => ipcRenderer.invoke('wizard-install'),
  complete: () => ipcRenderer.invoke('wizard-complete'),
  onProgress: (callback) => {
    ipcRenderer.on('wizard-progress', (event, data) => callback(data));
  }
});
