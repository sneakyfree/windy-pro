/**
 * Windy Word - Preload Script
 * SEC-L7: APIs organized into namespaced groups to reduce audit surface.
 * All handlers use contextBridge.exposeInMainWorld for safe IPC.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Build-time edition config (book-launch flags). With `sandbox: true` the preload
// CANNOT require() local modules, so we fetch the flags synchronously from main
// (which can read edition.js). sendSync resolves before any page script runs, so
// the renderer's edition-ui.js head script + settings.js have them at first paint.
let _edition = { edition: 'reader', ecosystemUI: true, translationUI: true, unlimitedRecording: false, cloudStorage: true };
try { _edition = { ..._edition, ...(ipcRenderer.sendSync('get-edition-flags') || {}) }; } catch (_) { /* full UI fallback */ }

// ── Helpers ──────────────────────────────────────────────────────
// Restrict ipcRenderer.on listeners to known channels only (defense-in-depth)
const ALLOWED_RECEIVE_CHANNELS = new Set([
  'archive-result', 'update-toast', 'toggle-recording', 'request-transcript',
  'state-change', 'open-settings', 'open-vault', 'injection-error',
  'python-loading', 'open-history', 'font-size-changed', 'model-download-progress',
  'license-updated', 'license-expired', 'open-translate', 'show-welcome',
  'show-keyboard-shortcuts', 'system-theme-changed', 'pair-download-progress',
  'video-frame-to-preview', 'recording-state-to-preview',
  'windytune-model-switched', 'windytune-suggest-upgrade',
  'gpu-pack-offer', 'gpu-pack-download-failed', 'engine-catalog-updated',
  'effects:trigger', 'send-detection:permission-needed',
  // Wave 12 B4 — inbound deep-link payload from main.js handleDeepLink().
  // Renderer listens via windyAPI.onDeepLink(cb).
  'windy:deep-link',
  // Agent control plane (v1.3.0+) — main process sends 'agent:request' with
  // {requestId, op, args}; renderer dispatches in app.js initAgentBridge() and
  // replies on 'agent:reply'.
  'agent:request',
  // Settings-catalog side-effect — main process pushes {path, value} after
  // an agent-initiated set_setting on a renderer-state path (theme, analytics
  // opt-in, bottom-panel row visibility). Renderer dispatches in app.js
  // initSettingsSideEffectListener().
  'settings:apply-side-effect',
  // Intel V2 (INTEL-CONTRACT-V2 §3) — main pushes a gentle update nudge and
  // message-bus banners (promo/survey/maintenance). Rendered by
  // renderer/intel-banner.js, never during active dictation/recording.
  'intel:update-nudge',
  'intel:message',
  // WiFi phone companion — main relays phone signaling + connection lifecycle
  // events to the renderer ({kind: 'from-phone'|'connected'|'disconnected'|
  // 'resumed'|'socket-closed', ...}). Renderer side: phone-companion-client.js.
  'phone-companion:event',
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
  windowMoveStart: () => ipcRenderer.send('window-move-start'),
  windowResizeStart: () => ipcRenderer.send('window-resize-start'),
  windowWmEnd: () => ipcRenderer.send('window-wm-end'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  setVideoFullscreen: (on) => ipcRenderer.send('set-video-fullscreen', !!on),
  onSettingsApplySideEffect: (callback) => {
    safeOn('settings:apply-side-effect', (_e, payload) => callback(payload));
  },
  platform: process.platform,

  // ═══ Intel V2 telemetry + message bus (INTEL-CONTRACT-V2) ═══════
  // emit() forwards to the main process which validates the event type +
  // metadata keys against the contract whitelist before journaling — the
  // renderer cannot push free-form data through this channel.
  intel: {
    emit: (eventType, metadata) => ipcRenderer.invoke('intel:emit', eventType, metadata).catch(() => { }),
    onUpdateNudge: (cb) => safeOn('intel:update-nudge', (_e, payload) => cb(payload)),
    onMessage: (cb) => safeOn('intel:message', (_e, payload) => cb(payload)),
    sendFeedback: (text) => ipcRenderer.invoke('intel:feedback', text),
  },

  // ═══ Commerce — unified wallet (P3) ════════════════════════════
  // One-tap purchase when a card is already on file; otherwise
  // openWallet() hands off to the web app (Stripe Elements), so card
  // data never enters Electron.
  commerce: {
    catalog: () => ipcRenderer.invoke('commerce:catalog'),
    wallet: () => ipcRenderer.invoke('commerce:wallet'),
    purchase: (skuId) => ipcRenderer.invoke('commerce:purchase', skuId),
    entitlements: () => ipcRenderer.invoke('commerce:entitlements'),
    openWallet: (skuId) => ipcRenderer.invoke('commerce:open-wallet', skuId),
  },

  // ═══ Edition (book-launch UI flags) ════════════════════════════
  // Read synchronously by edition-ui.js to hide ecosystem/cross-sell surfaces
  // in the free build. ecosystemUI=false → pure voice-to-text. Reversible.
  edition: _edition.edition,
  ecosystemUI: _edition.ecosystemUI !== false,
  translationUI: _edition.translationUI !== false,
  unlimitedRecording: _edition.unlimitedRecording === true,
  cloudStorage: _edition.cloudStorage !== false,

  // ═══ WiFi Phone Companion ══════════════════════════════════════
  // Any phone becomes a wireless mic/camera: QR pairing + WebRTC over LAN.
  // Main process hosts the LAN server and relays signaling; the renderer
  // owns the RTCPeerConnection (phone-companion-client.js).
  phoneCompanion: {
    createSession: (intent) => ipcRenderer.invoke('phone-companion:create-session', intent),
    toPhone: (msg) => ipcRenderer.send('phone-companion:to-phone', msg),
    endSession: () => ipcRenderer.invoke('phone-companion:end'),
    onEvent: (callback) => {
      safeOn('phone-companion:event', (_e, payload) => callback(payload));
    },
  },

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
  notifyRecordingStarted: () => ipcRenderer.send('recording-started'),
  notifyRecordingStopped: () => ipcRenderer.send('recording-stopped'),

  // ═══ WindyTune Adaptive ═══
  // Start model resolved by main against models actually present on disk —
  // replaces the renderer's old hardcoded 'base' (not bundled in this edition).
  windytuneStartModel: () => ipcRenderer.invoke('windytune-start-model'),
  // Canonical engine ladder from lib/engine-catalog.js (sandboxed preload can't
  // require() it directly). Renderer keeps an inline copy only as fallback.
  getEngineCatalog: () => ipcRenderer.invoke('engine-catalog:get'),
  windytuneAcceptUpgrade: (model) => ipcRenderer.invoke('windytune-accept-upgrade', model),
  windytuneUndoSwitch: (oldModel) => ipcRenderer.invoke('windytune-undo-switch', oldModel),

  // ═══ Effects canvas ═══
  // Forward a visual to the whole-screen overlay window (fire-and-forget).
  fxOverlayRender: (type, opts) => ipcRenderer.send('fx-overlay:render', { type, opts }),
  // Physically rattle the OS window (nuclear intensity only; mac/win — see main).
  rattleWindow: (power, duration) => ipcRenderer.send('window:rattle', { power, duration }),

  // ═══ Stage 7 "Send" detection ═══
  setSendDetection: (enabled) => ipcRenderer.invoke('send-detection:set', enabled),
  getSendDetectionStatus: () => ipcRenderer.invoke('send-detection:status'),
  grantInputMonitoring: () => ipcRenderer.invoke('send-detection:grant-permission'),
  onEffectTrigger: (callback) => { safeOn('effects:trigger', (event, data) => callback(data)); },
  onSendPermissionNeeded: (callback) => { safeOn('send-detection:permission-needed', (event, data) => callback(data)); },

  // ═══ GPU Engine Pack + usage/prune ═══
  onGpuPackOffer: (callback) => { safeOn('gpu-pack-offer', (event, data) => callback(data)); },
  onGpuPackDownloadFailed: (callback) => { safeOn('gpu-pack-download-failed', (event, data) => callback(data)); },
  onEngineCatalogUpdated: (callback) => { safeOn('engine-catalog-updated', (event, data) => callback(data)); },
  gpuPackResponse: (accepted) => ipcRenderer.invoke('gpu-pack-response', accepted),
  engineUsageStats: () => ipcRenderer.invoke('engine-usage-stats'),
  pruneModel: (modelId) => ipcRenderer.invoke('prune-model', modelId),
  onWindyTuneModelSwitched: (callback) => {
    safeOn('windytune-model-switched', (event, data) => callback(data));
  },
  onWindyTuneSuggestUpgrade: (callback) => {
    safeOn('windytune-suggest-upgrade', (event, data) => callback(data));
  },

  // ═══ Focus Management ═══
  // Temporarily make window focusable when user needs keyboard input
  requestFocus: () => ipcRenderer.send('request-focus'),
  releaseFocus: () => ipcRenderer.send('release-focus'),
  // Restore focus to target app after getUserMedia steals it
  restoreFocus: () => ipcRenderer.send('mic-access-granted'),

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
  openChat: () => ipcRenderer.send('open-windy-chat'),
  // Control Panel — opens the WD-31 M-G window, which loads the
  // Echo HQ drop from the vendored bundle. See main.js
  // showControlPanelWindow().
  openControlPanel: () => ipcRenderer.send('open-control-panel'),
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  launchWindyCode: () => ipcRenderer.invoke('launch-windy-code'),
  openCheckoutUrl: (opts) => ipcRenderer.invoke('open-checkout-url', opts),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  // B3 — Reveal a saved recording in the OS file manager (Finder/Explorer/Files).
  // The 'reveal-in-folder' handler lives in main.js (added by another agent).
  revealInFolder: (filePath) => ipcRenderer.invoke('reveal-in-folder', filePath),

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

  // ═══ Deep links (Wave 12 B4) ══════════════════════════════════
  // Payload shape: { scheme, host, path, query, url }. Fires when a
  // windypro://, windychat://, windyword://, or windyfly:// link
  // opens the app — either cold boot (argv) or warm (open-url /
  // second-instance). The renderer decides what to do with it;
  // main.js never navigates on its own.
  onDeepLink: (callback) => safeOn('windy:deep-link', (_e, payload) => callback(payload)),

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
  // On-device NLLB translation (fully offline, no key) — preferred for the book-launch build.
  translateLocal: (text, sourceLang, targetLang) => ipcRenderer.invoke('translate-local', text, sourceLang, targetLang),
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
  // Word→Clone wire (ADR-045 Phase 2) — submit a local recording to Windy Clone for
  // ElevenLabs training, then poll for status until ready or failed.
  submitVoiceCloneToCloud: (id) => ipcRenderer.invoke('submit-voice-clone-to-cloud', id),
  getCloudCloneOrderStatus: (orderId) => ipcRenderer.invoke('get-cloud-clone-order-status', orderId),

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

  // ═══ M5: Deepgram WebSocket Proxy (API key stays in main process) ═══
  deepgramStreamStart: (opts) => ipcRenderer.invoke('deepgram-stream-start', opts),
  deepgramStreamSend: (audioBuffer) => ipcRenderer.invoke('deepgram-stream-send', audioBuffer),
  deepgramStreamStop: () => ipcRenderer.invoke('deepgram-stream-stop'),
  onDeepgramProxyOpen: (callback) => { ipcRenderer.removeAllListeners('deepgram-proxy-open'); safeOn('deepgram-proxy-open', () => callback()); },
  onDeepgramProxyMessage: (callback) => { ipcRenderer.removeAllListeners('deepgram-proxy-message'); safeOn('deepgram-proxy-message', (_e, data) => callback(data)); },
  onDeepgramProxyError: (callback) => { ipcRenderer.removeAllListeners('deepgram-proxy-error'); safeOn('deepgram-proxy-error', (_e, msg) => callback(msg)); },
  onDeepgramProxyClose: (callback) => { ipcRenderer.removeAllListeners('deepgram-proxy-close'); safeOn('deepgram-proxy-close', () => callback()); },
});

// ═══ Agent bridge (v1.3.0+) ════════════════════════════════════════
// Two-channel IPC for the HTTP agent control surface in main.js. Main
// process sends a request on 'agent:request' with {requestId, op, args};
// renderer handler dispatches by op, sends reply on 'agent:reply' with
// {requestId, ok, ...result}. Op vocabulary is documented in the
// renderer's agent-bridge initialization (app.js initAgentBridge).
contextBridge.exposeInMainWorld('agentBridge', {
  onRequest: (callback) => {
    safeOn('agent:request', (event, payload) => callback(payload));
  },
  sendReply: (payload) => {
    ipcRenderer.send('agent:reply', payload);
  },
});
