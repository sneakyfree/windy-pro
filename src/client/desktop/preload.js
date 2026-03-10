/**
 * Windy Pro - Preload Script
 * Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('windyAPI', {
  // Zoom
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.send('update-settings', settings),
  rebindHotkey: (key, accelerator) => ipcRenderer.invoke('rebind-hotkey', key, accelerator),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  chooseArchiveFolder: () => ipcRenderer.invoke('choose-archive-folder'),
  archiveTranscript: (payload) => ipcRenderer.send('archive-transcript', payload),
  archiveAudio: (base64, timestamp) => ipcRenderer.invoke('archive-audio', base64, timestamp),
  archiveVideo: (base64, timestamp) => ipcRenderer.invoke('archive-video', base64, timestamp),
  readArchiveAudio: (filePath) => ipcRenderer.invoke('read-archive-audio', filePath),
  readArchiveVideo: (filePath) => ipcRenderer.invoke('read-archive-video', filePath),
  batchTranscribeLocal: (base64Audio) => ipcRenderer.invoke('batch-transcribe-local', base64Audio),
  autoPasteText: (text) => ipcRenderer.invoke('auto-paste-text', text),
  sendVoiceLevel: (level) => ipcRenderer.send('voice-level', level),
  onArchiveResult: (callback) => {
    ipcRenderer.on('archive-result', (event, payload) => callback(payload));
  },
  onUpdateToast: (callback) => {
    ipcRenderer.on('update-toast', (event, payload) => callback(payload));
  },
  openArchiveFolder: () => ipcRenderer.send('open-archive-folder'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  openCheckoutUrl: (opts) => ipcRenderer.invoke('open-checkout-url', opts),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  unmaximize: () => ipcRenderer.send('unmaximize-window'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),

  // Video preview window (independent)
  showVideoPreview: () => ipcRenderer.invoke('show-video-preview'),
  hideVideoPreview: () => ipcRenderer.invoke('hide-video-preview'),
  sendVideoFrame: (dataUrl) => ipcRenderer.send('video-frame-to-preview', dataUrl),
  sendRecordingState: (state) => ipcRenderer.send('recording-state-to-preview', state),

  // Font size control
  getFontSize: () => ipcRenderer.invoke('get-font-size'),
  setFontSize: (percent) => ipcRenderer.invoke('set-font-size', percent),
  onFontSizeChange: (cb) => ipcRenderer.on('font-size-changed', (_e, percent) => cb(percent)),

  // Recording control
  onToggleRecording: (callback) => {
    ipcRenderer.on('toggle-recording', (event, isRecording) => callback(isRecording));
  },

  // Transcript paste
  onRequestTranscript: (callback) => {
    ipcRenderer.on('request-transcript', () => callback());
  },
  sendTranscriptForPaste: (transcript) => {
    ipcRenderer.send('transcript-for-paste', transcript);
  },

  // State changes
  onStateChange: (callback) => {
    ipcRenderer.on('state-change', (event, state) => callback(state));
  },

  // Navigation
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', () => callback());
  },
  onOpenVault: (callback) => {
    ipcRenderer.on('open-vault', () => callback());
  },

  // Injection
  checkInjectionPermissions: () => ipcRenderer.invoke('check-injection-permissions'),
  onInjectionError: (callback) => {
    ipcRenderer.on('injection-error', (event, message) => callback(message));
  },

  // Crash recovery
  checkCrashRecovery: () => ipcRenderer.invoke('check-crash-recovery'),
  dismissCrashRecovery: () => ipcRenderer.invoke('dismiss-crash-recovery'),

  // Python server loading state (RP-04)
  onPythonLoading: (callback) => {
    ipcRenderer.on('python-loading', (event, isLoading) => callback(isLoading));
  },

  // Batch processing notifications
  notifyBatchComplete: (wordCount) => ipcRenderer.send('batch-complete', { wordCount }),
  notifyBatchProcessing: () => ipcRenderer.send('batch-processing'),
  notifyRecordingFailed: () => ipcRenderer.send('recording-failed'),
  onOpenHistory: (callback) => {
    ipcRenderer.on('open-history', () => callback());
  },
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  // Platform info
  platform: process.platform,

  // App version (reads from package.json via main process)
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installDebUpdate: () => ipcRenderer.invoke('install-deb-update'),
  updateTornadoSize: (size) => ipcRenderer.send('update-tornado-size', size),
  updateWidget: (data) => ipcRenderer.send('update-widget', data),
  getArchiveHistory: () => ipcRenderer.invoke('get-archive-history'),
  deleteArchiveEntry: (filePath) => ipcRenderer.invoke('delete-archive-entry', filePath),
  getArchiveStats: () => ipcRenderer.invoke('get-archive-stats'),
  exportSoulFile: () => ipcRenderer.invoke('export-soul-file'),
  exportVoiceClone: () => ipcRenderer.invoke('export-voice-clone'),

  // Translation (offline fallback + mini-translate)
  translateOffline: (text, sourceLang, targetLang) => ipcRenderer.invoke('translate-offline', text, sourceLang, targetLang),
  translateText: (text, sourceLang, targetLang) => ipcRenderer.invoke('translate-text', text, sourceLang, targetLang),
  openMiniTranslate: () => ipcRenderer.send('open-mini-translate'),
  onOpenTranslate: (callback) => {
    ipcRenderer.on('open-translate', () => callback());
  },

  // Auto-update
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Stripe payment
  createCheckoutSession: (priceId, email) => ipcRenderer.invoke('create-checkout-session', priceId, email),
  checkPaymentStatus: (sessionId) => ipcRenderer.invoke('check-payment-status', sessionId),
  getCurrentTier: () => ipcRenderer.invoke('get-current-tier'),
  applyCoupon: (code) => ipcRenderer.invoke('apply-coupon', code),

  // Model download manager
  checkModelStatus: () => ipcRenderer.invoke('check-model-status'),
  downloadModels: (modelNames) => ipcRenderer.invoke('download-models', modelNames),
  showDownloadWizard: (tier) => ipcRenderer.invoke('show-download-wizard', tier),
  onModelDownloadProgress: (callback) => ipcRenderer.on('model-download-progress', (e, data) => callback(data)),
  onLicenseUpdated: (callback) => ipcRenderer.on('license-updated', (e, tier) => callback(tier)),
  onLicenseExpired: (callback) => ipcRenderer.on('license-expired', (e, data) => callback(data)),
  validateLicense: () => ipcRenderer.invoke('validate-license'),

  // Wizard
  getWizardState: () => ipcRenderer.invoke('get-wizard-state'),
  setWizardState: (state) => ipcRenderer.invoke('set-wizard-state', state),
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
  registerWizardAccount: (data) => ipcRenderer.invoke('register-wizard-account', data),
  setupAutostart: (enable) => ipcRenderer.invoke('setup-autostart', enable),

  // ─── Premium Features ───

  // Translation Memory
  saveTranslationMemory: (data) => ipcRenderer.invoke('save-translation-memory', data),
  lookupTranslationMemory: (text, sourceLang, targetLang) => ipcRenderer.invoke('lookup-translation-memory', text, sourceLang, targetLang),
  getTranslationMemoryStats: () => ipcRenderer.invoke('get-translation-memory-stats'),
  clearTranslationMemory: () => ipcRenderer.invoke('clear-translation-memory'),

  // Voice Clone Management
  getVoiceClones: () => ipcRenderer.invoke('get-voice-clones'),
  createVoiceClone: (name, base64, duration) => ipcRenderer.invoke('create-voice-clone', name, base64, duration),
  deleteVoiceClone: (id) => ipcRenderer.invoke('delete-voice-clone', id),
  setActiveVoiceClone: (id) => ipcRenderer.invoke('set-active-voice-clone', id),
  previewVoiceClone: (id) => ipcRenderer.invoke('preview-voice-clone', id),
  uploadVoiceCloneFile: (name) => ipcRenderer.invoke('upload-voice-clone-file', name),

  // Document Translation
  extractDocumentText: (base64, ext) => ipcRenderer.invoke('extract-document-text', base64, ext),
  browseDocumentFile: () => ipcRenderer.invoke('browse-document-file'),

  // Clone Data Bundles
  saveCloneBundle: (data) => ipcRenderer.invoke('save-clone-bundle', data),
  getCloneBundles: () => ipcRenderer.invoke('get-clone-bundles'),
  deleteCloneBundle: (id) => ipcRenderer.invoke('delete-clone-bundle', id),
  playCloneBundle: (id) => ipcRenderer.invoke('play-clone-bundle', id),
  exportCloneBundles: (ids) => ipcRenderer.invoke('export-clone-bundles', ids),
  startCloneTraining: (ids) => ipcRenderer.invoke('start-clone-training', ids),

  // Auto-Sync
  getSyncState: () => ipcRenderer.invoke('get-sync-state'),
  saveSyncState: (state) => ipcRenderer.invoke('save-sync-state', state),
  fetchRemoteBundles: (since) => ipcRenderer.invoke('fetch-remote-bundles', since),
  downloadRemoteBundle: (id) => ipcRenderer.invoke('download-remote-bundle', id),
  uploadBundleToCloud: (data) => ipcRenderer.invoke('upload-bundle-to-cloud', data),
  showSyncNotification: (msg) => ipcRenderer.invoke('show-sync-notification', msg),
  getStorageStats: () => ipcRenderer.invoke('get-storage-stats'),
  deleteLocalBundleCopy: (id) => ipcRenderer.invoke('delete-local-bundle-copy', id),
});
