/**
 * Windy Pro - Preload Script
 * SEC-L7: APIs organized into namespaced groups to reduce audit surface.
 * All handlers use contextBridge.exposeInMainWorld for safe IPC.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ── Helpers ──────────────────────────────────────────────────────
// Restrict ipcRenderer.on listeners to known channels only (defense-in-depth)
const ALLOWED_RECEIVE_CHANNELS = new Set([
  'archive-result', 'update-toast', 'toggle-recording', 'request-transcript',
  'state-change', 'open-settings', 'open-vault', 'injection-error',
  'python-loading', 'open-history', 'font-size-changed', 'model-download-progress',
  'license-updated', 'license-expired', 'open-translate', 'show-welcome',
  'show-keyboard-shortcuts', 'system-theme-changed', 'pair-download-progress',
  'video-frame-to-preview', 'recording-state-to-preview',
]);

function safeOn(channel, callback) {
  if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
    console.warn(`[Preload] Blocked listener on unknown channel: ${channel}`);
    return;
  }
  ipcRenderer.on(channel, callback);
}

contextBridge.exposeInMainWorld('windyAPI', {
  // ═══ Window Controls ═══════════════════════════════════════════
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  unmaximize: () => ipcRenderer.send('unmaximize-window'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  platform: process.platform,

  // ═══ Settings ══════════════════════════════════════════════════
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.send('update-settings', settings),
  rebindHotkey: (key, accelerator) => ipcRenderer.invoke('rebind-hotkey', key, accelerator),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),

  // ═══ Archive & History ═════════════════════════════════════════
  chooseArchiveFolder: () => ipcRenderer.invoke('choose-archive-folder'),
  archiveTranscript: (payload) => ipcRenderer.send('archive-transcript', payload),
  archiveAudio: (base64, timestamp) => ipcRenderer.invoke('archive-audio', base64, timestamp),
  archiveVideo: (base64, timestamp) => ipcRenderer.invoke('archive-video', base64, timestamp),
  readArchiveAudio: (filePath) => ipcRenderer.invoke('read-archive-audio', filePath),
  readArchiveVideo: (filePath) => ipcRenderer.invoke('read-archive-video', filePath),
  openArchiveFolder: () => ipcRenderer.send('open-archive-folder'),
  getArchiveHistory: () => ipcRenderer.invoke('get-archive-history'),
  deleteArchiveEntry: (filePath) => ipcRenderer.invoke('delete-archive-entry', filePath),
  getArchiveStats: () => ipcRenderer.invoke('get-archive-stats'),
  onArchiveResult: (callback) => {
    safeOn('archive-result', (event, payload) => callback(payload));
  },

  // ═══ Recording ═════════════════════════════════════════════════
  batchTranscribeLocal: (base64Audio) => ipcRenderer.invoke('batch-transcribe-local', base64Audio),
  autoPasteText: (text) => ipcRenderer.invoke('auto-paste-text', text),
  sendVoiceLevel: (level) => ipcRenderer.send('voice-level', level),
  onToggleRecording: (callback) => {
    safeOn('toggle-recording', (event, isRecording) => callback(isRecording));
  },
  onRequestTranscript: (callback) => {
    safeOn('request-transcript', () => callback());
  },
  sendTranscriptForPaste: (transcript) => {
    ipcRenderer.send('transcript-for-paste', transcript);
  },
  notifyBatchComplete: (wordCount) => ipcRenderer.send('batch-complete', { wordCount }),
  notifyBatchProcessing: () => ipcRenderer.send('batch-processing'),
  notifyRecordingFailed: () => ipcRenderer.send('recording-failed'),

  // ═══ Video ═════════════════════════════════════════════════════
  showVideoPreview: () => ipcRenderer.invoke('show-video-preview'),
  hideVideoPreview: () => ipcRenderer.invoke('hide-video-preview'),
  sendVideoFrame: (dataUrl) => ipcRenderer.send('video-frame-to-preview', dataUrl),
  sendRecordingState: (state) => ipcRenderer.send('recording-state-to-preview', state),

  // ═══ Font ══════════════════════════════════════════════════════
  getFontSize: () => ipcRenderer.invoke('get-font-size'),
  setFontSize: (percent) => ipcRenderer.invoke('set-font-size', percent),
  onFontSizeChange: (cb) => safeOn('font-size-changed', (_e, percent) => cb(percent)),

  // ═══ Navigation & External ════════════════════════════════════
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  openCheckoutUrl: (opts) => ipcRenderer.invoke('open-checkout-url', opts),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  // ═══ State & UI Events ════════════════════════════════════════
  onStateChange: (callback) => {
    safeOn('state-change', (event, state) => callback(state));
  },
  onOpenSettings: (callback) => {
    safeOn('open-settings', () => callback());
  },
  onOpenVault: (callback) => {
    safeOn('open-vault', () => callback());
  },
  onOpenHistory: (callback) => {
    safeOn('open-history', () => callback());
  },
  onUpdateToast: (callback) => {
    safeOn('update-toast', (event, payload) => callback(payload));
  },
  onShowWelcome: (callback) => safeOn('show-welcome', () => callback()),
  dismissWelcome: () => ipcRenderer.invoke('dismiss-welcome'),
  onShowKeyboardShortcuts: (callback) => safeOn('show-keyboard-shortcuts', () => callback()),
  onSystemThemeChanged: (callback) => safeOn('system-theme-changed', (_e, theme) => callback(theme)),

  // ═══ Injection / Accessibility ════════════════════════════════
  checkInjectionPermissions: () => ipcRenderer.invoke('check-injection-permissions'),
  onInjectionError: (callback) => {
    safeOn('injection-error', (event, message) => callback(message));
  },

  // ═══ Crash Recovery ════════════════════════════════════════════
  checkCrashRecovery: () => ipcRenderer.invoke('check-crash-recovery'),
  dismissCrashRecovery: () => ipcRenderer.invoke('dismiss-crash-recovery'),
  onPythonLoading: (callback) => {
    safeOn('python-loading', (event, isLoading) => callback(isLoading));
  },

  // ═══ App Lifecycle ════════════════════════════════════════════
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  installDebUpdate: () => ipcRenderer.invoke('install-deb-update'),
  updateTornadoSize: (size) => ipcRenderer.send('update-tornado-size', size),
  updateWidget: (data) => ipcRenderer.send('update-widget', data),

  // ═══ Song Identification ══════════════════════════════════════
  identifySong: (opts) => ipcRenderer.invoke('identify-song', opts),
  checkFpcalc: () => ipcRenderer.invoke('check-fpcalc'),

  // ═══ Translation ══════════════════════════════════════════════
  translateOffline: (text, sourceLang, targetLang) => ipcRenderer.invoke('translate-offline', text, sourceLang, targetLang),
  translateText: (text, sourceLang, targetLang) => ipcRenderer.invoke('translate-text', text, sourceLang, targetLang),
  openMiniTranslate: () => ipcRenderer.send('open-mini-translate'),
  onOpenTranslate: (callback) => {
    safeOn('open-translate', () => callback());
  },

  // ═══ Export ════════════════════════════════════════════════════
  exportSoulFile: () => ipcRenderer.invoke('export-soul-file'),
  exportVoiceClone: () => ipcRenderer.invoke('export-voice-clone'),

  // ═══ Stripe / Billing ═════════════════════════════════════════
  createCheckoutSession: (priceId, email) => ipcRenderer.invoke('create-checkout-session', priceId, email),
  checkPaymentStatus: (sessionId) => ipcRenderer.invoke('check-payment-status', sessionId),
  getCurrentTier: () => ipcRenderer.invoke('get-current-tier'),
  getStripeConfig: () => ipcRenderer.invoke('get-stripe-config'),
  applyCoupon: (code) => ipcRenderer.invoke('apply-coupon', code),
  openBillingPortal: () => ipcRenderer.invoke('open-billing-portal'),

  // ═══ Model Downloads ══════════════════════════════════════════
  checkModelStatus: () => ipcRenderer.invoke('check-model-status'),
  downloadModels: (modelNames) => ipcRenderer.invoke('download-models', modelNames),
  showDownloadWizard: (tier) => ipcRenderer.invoke('show-download-wizard', tier),
  onModelDownloadProgress: (callback) => safeOn('model-download-progress', (e, data) => callback(data)),
  onLicenseUpdated: (callback) => safeOn('license-updated', (e, tier) => callback(tier)),
  onLicenseExpired: (callback) => safeOn('license-expired', (e, data) => callback(data)),
  validateLicense: () => ipcRenderer.invoke('validate-license'),

  // ═══ Wizard ════════════════════════════════════════════════════
  getWizardState: () => ipcRenderer.invoke('get-wizard-state'),
  setWizardState: (state) => ipcRenderer.invoke('set-wizard-state', state),
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
  registerWizardAccount: (data) => ipcRenderer.invoke('register-wizard-account', data),
  setupAutostart: (enable) => ipcRenderer.invoke('setup-autostart', enable),

  // ═══ Translation Memory ════════════════════════════════════════
  saveTranslationMemory: (data) => ipcRenderer.invoke('save-translation-memory', data),
  lookupTranslationMemory: (text, sourceLang, targetLang) => ipcRenderer.invoke('lookup-translation-memory', text, sourceLang, targetLang),
  getTranslationMemoryStats: () => ipcRenderer.invoke('get-translation-memory-stats'),
  clearTranslationMemory: () => ipcRenderer.invoke('clear-translation-memory'),

  // ═══ Voice Clone ═══════════════════════════════════════════════
  getVoiceClones: () => ipcRenderer.invoke('get-voice-clones'),
  createVoiceClone: (name, base64, duration) => ipcRenderer.invoke('create-voice-clone', name, base64, duration),
  deleteVoiceClone: (id) => ipcRenderer.invoke('delete-voice-clone', id),
  setActiveVoiceClone: (id) => ipcRenderer.invoke('set-active-voice-clone', id),
  previewVoiceClone: (id) => ipcRenderer.invoke('preview-voice-clone', id),
  uploadVoiceCloneFile: (name) => ipcRenderer.invoke('upload-voice-clone-file', name),

  // ═══ Document Translation ══════════════════════════════════════
  extractDocumentText: (base64, ext) => ipcRenderer.invoke('extract-document-text', base64, ext),
  browseDocumentFile: () => ipcRenderer.invoke('browse-document-file'),

  // ═══ Clone Data Bundles ════════════════════════════════════════
  saveCloneBundle: (data) => ipcRenderer.invoke('save-clone-bundle', data),
  getCloneBundles: () => ipcRenderer.invoke('get-clone-bundles'),
  deleteCloneBundle: (id) => ipcRenderer.invoke('delete-clone-bundle', id),
  playCloneBundle: (id) => ipcRenderer.invoke('play-clone-bundle', id),
  exportCloneBundles: (ids) => ipcRenderer.invoke('export-clone-bundles', ids),
  startCloneTraining: (ids) => ipcRenderer.invoke('start-clone-training', ids),

  // ═══ Cloud Sync ════════════════════════════════════════════════
  getSyncState: () => ipcRenderer.invoke('get-sync-state'),
  saveSyncState: (state) => ipcRenderer.invoke('save-sync-state', state),
  fetchRemoteBundles: (since) => ipcRenderer.invoke('fetch-remote-bundles', since),
  downloadRemoteBundle: (id) => ipcRenderer.invoke('download-remote-bundle', id),
  uploadBundleToCloud: (data) => ipcRenderer.invoke('upload-bundle-to-cloud', data),
  showSyncNotification: (msg) => ipcRenderer.invoke('show-sync-notification', msg),
  getStorageStats: () => ipcRenderer.invoke('get-storage-stats'),
  deleteLocalBundleCopy: (id) => ipcRenderer.invoke('delete-local-bundle-copy', id),

  // ═══ Translation Pair Marketplace ══════════════════════════════
  pairCatalog: () => ipcRenderer.invoke('pair-catalog'),
  pairBundles: () => ipcRenderer.invoke('pair-bundles'),
  pairDownload: (pairId) => ipcRenderer.invoke('pair-download', pairId),
  pairDownloadBundle: (pairIds) => ipcRenderer.invoke('pair-download-bundle', pairIds),
  pairCancel: (pairId) => ipcRenderer.invoke('pair-cancel', pairId),
  pairDelete: (pairId) => ipcRenderer.invoke('pair-delete', pairId),
  pairListDownloaded: () => ipcRenderer.invoke('pair-list-downloaded'),
  pairStorageInfo: () => ipcRenderer.invoke('pair-storage-info'),
  onPairDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('pair-download-progress');
    safeOn('pair-download-progress', (event, data) => callback(data));
  },

  // ═══ Secure Key Storage ════════════════════════════════════════
  // SEC-P0: Encrypted API key storage via main process safeStorage
  setApiKey: (keyName, keyValue) => ipcRenderer.invoke('set-api-key', keyName, keyValue),
  getApiKey: (keyName) => ipcRenderer.invoke('get-api-key', keyName),
});
