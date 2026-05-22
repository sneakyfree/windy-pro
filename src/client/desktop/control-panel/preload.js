// Sandboxed preload for the Control Panel BrowserWindow (WD-31 M-G).
// Exposes the minimal surface the renderer + drop iframes need:
//   - window.windyVitals.get() → calls the main-process IPC channel
//     registered in main.js (see ipcMain.handle('windy:control-panel:vitals'))
//   - window.windyAuth.token() → reads the JWT from the host renderer's
//     localStorage, passed through so /api/v1/me/fleet calls succeed
//
// This preload is small on purpose — drops cannot reach it directly
// (they live in a sandboxed iframe), and the host renderer
// (control-panel.html) only needs these two helpers to feed the drop.

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'windy:control-panel:vitals';

contextBridge.exposeInMainWorld('windyVitals', {
  get: () => ipcRenderer.invoke(CHANNEL),
  channel: CHANNEL,
});

// Auth token bridge — the main app's renderer stores `windy_token` in
// its localStorage; child BrowserWindows have their own storage, so we
// proxy the read through main.js (which executeJavaScript's the main
// window to fetch it). Returns null if no token / no main window.
contextBridge.exposeInMainWorld('windyAuth', {
  getToken: () => ipcRenderer.invoke('control-panel:get-token'),
});

// The account-server base URL — host renderer needs to know where to
// fetch /api/v1/me/fleet. main.js injects it via IPC so devs flipping
// ACCOUNT_SERVER_URL don't need to rebuild.
contextBridge.exposeInMainWorld('windyConfig', {
  accountServerUrl: () => ipcRenderer.invoke('control-panel:account-server-url'),
});

// Drop library (WD-31 Phase 3a) — lets the Control Panel renderer
// list installed drops, switch between them, install new ones from the
// registry, and uninstall. The renderer never sees the file system or
// makes registry requests directly; everything flows through main.js
// for sandbox safety + so the renderer stays small.
contextBridge.exposeInMainWorld('windyDropLibrary', {
  listInstalled: () => ipcRenderer.invoke('windy:control-panel:list-installed'),
  getSelected: () => ipcRenderer.invoke('windy:control-panel:get-selected'),
  selectDrop: (dropId, version) =>
    ipcRenderer.invoke('windy:control-panel:select-drop', { dropId, version }),
  installDrop: (manifest) =>
    ipcRenderer.invoke('windy:control-panel:install-drop', manifest),
  uninstallDrop: (dropId) =>
    ipcRenderer.invoke('windy:control-panel:uninstall-drop', dropId),
  browseRegistry: (query) =>
    ipcRenderer.invoke('windy:control-panel:browse-registry', query),
  // Subscribe to selection / library changes (main → renderer events).
  // Returns an unsubscribe function so consumers can tear down listeners.
  onSelectionChanged: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on('windy:control-panel:selection-changed', handler);
    return () => ipcRenderer.removeListener('windy:control-panel:selection-changed', handler);
  },
  onLibraryChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('windy:control-panel:library-changed', handler);
    return () => ipcRenderer.removeListener('windy:control-panel:library-changed', handler);
  },
});
