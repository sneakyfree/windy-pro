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
  toggleModel: (modelId, selected) => ipcRenderer.invoke('wizard-toggle-model', modelId, selected),

  // Account
  login: (email, password) => ipcRenderer.invoke('wizard-login', email, password),
  register: (name, email, password) => ipcRenderer.invoke('wizard-register', name, email, password),
  createFreeAccount: () => ipcRenderer.invoke('wizard-free-account'),

  // Language Profile
  saveLanguageProfile: (languages) => ipcRenderer.invoke('wizard-save-language-profile', languages),

  // Translation
  purchaseTranslate: (tier) => ipcRenderer.invoke('wizard-purchase-translate', tier),

  // Install
  install: () => ipcRenderer.invoke('wizard-install'),
  complete: () => ipcRenderer.invoke('wizard-complete'),

  // Phase 4 permission verification
  verifyAccessibility: () => ipcRenderer.invoke('wizard-verify-accessibility'),
  micStatus: () => ipcRenderer.invoke('wizard-mic-status'),
  openPermSettings: (which) => ipcRenderer.invoke('wizard-open-perm-settings', which),
  onWindowFocus: (cb) => { ipcRenderer.on('wizard-window-focus', () => cb()); },

  // Open URL in system browser (for Stripe checkout)
  openExternal: (url) => ipcRenderer.invoke('wizard-open-external', url),

  // Progress listener
  onProgress: (callback) => {
    ipcRenderer.on('wizard-progress', (event, data) => callback(data));
  }
});
