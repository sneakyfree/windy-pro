/**
 * Windy Pro - Preload Script
 * Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windyAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.send('update-settings', settings),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  chooseArchiveFolder: () => ipcRenderer.invoke('choose-archive-folder'),
  archiveTranscript: (payload) => ipcRenderer.send('archive-transcript', payload),
  batchTranscribeLocal: (base64Audio) => ipcRenderer.invoke('batch-transcribe-local', base64Audio),
  autoPasteText: (text) => ipcRenderer.invoke('auto-paste-text', text),
  sendVoiceLevel: (level) => ipcRenderer.send('voice-level', level),
  onArchiveResult: (callback) => {
    ipcRenderer.on('archive-result', (event, payload) => callback(payload));
  },
  testDropboxConnection: () => ipcRenderer.invoke('test-dropbox-connection'),
  testGoogleConnection: () => ipcRenderer.invoke('test-google-connection'),
  minimize: () => ipcRenderer.send('minimize-window'),

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
  onOpenHistory: (callback) => {
    ipcRenderer.on('open-history', () => callback());
  },
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  // Platform info
  platform: process.platform,

  // App version (reads from package.json via main process)
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  updateTornadoSize: (size) => ipcRenderer.send('update-tornado-size', size),
  getArchiveHistory: () => ipcRenderer.invoke('get-archive-history'),
  deleteArchiveEntry: (filePath) => ipcRenderer.invoke('delete-archive-entry', filePath),
});
