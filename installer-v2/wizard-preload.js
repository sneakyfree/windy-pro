/**
 * Windy Pro v2.0 — Wizard Preload Bridge
 * Exposes safe IPC methods to the renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardAPI', {
  // Hardware
  scanHardware: () => ipcRenderer.invoke('wizard-scan-hardware'),

  // Models
  selectModels: (ids) => ipcRenderer.invoke('wizard-select-models', ids),

  // Account
  login: (email, password) => ipcRenderer.invoke('wizard-login', email, password),
  register: (name, email, password) => ipcRenderer.invoke('wizard-register', name, email, password),
  createFreeAccount: () => ipcRenderer.invoke('wizard-free-account'),

  // Install
  install: () => ipcRenderer.invoke('wizard-install'),
  complete: () => ipcRenderer.invoke('wizard-complete'),

  // Progress listener
  onProgress: (callback) => {
    ipcRenderer.on('wizard-progress', (event, data) => callback(data));
  }
});
