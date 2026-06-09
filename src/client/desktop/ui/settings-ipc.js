/**
 * Settings + font-size + hotkey-rebind IPC handlers — extracted
 * from main.js (CR-009 continuation).
 *
 * All reads/writes go through the shared electron-store instance.
 * Hotkey rebinding reaches back into the main-process
 * globalShortcut + the re-register callback owned by main.js.
 *
 * The "cloudPassword" path encrypts via safeStorage when available
 * (SEC-C1 from an earlier security pass); the encryption-available
 * fallback is unchanged.
 */

'use strict';

const RESERVED_SHORTCUTS_DEFAULT = Object.freeze([
  // macOS reserved
  'CommandOrControl+Space', 'CommandOrControl+Tab',
  'CommandOrControl+Q', 'CommandOrControl+W',
]);

function registerSettingsIpc(deps) {
  const {
    ipcMain, store, app, safeStorage, globalShortcut, registerHotkeys,
    mainWindowRef, reservedShortcuts,
  } = deps;

  if (!ipcMain || !store || !app || !globalShortcut || !registerHotkeys
      || !mainWindowRef) {
    throw new Error('[settings-ipc] missing required deps');
  }

  const RESERVED = reservedShortcuts || RESERVED_SHORTCUTS_DEFAULT;

  // ── get-settings / update-settings / get-app-version ────────
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-settings', () => {
    return {
      ...store.get('appearance'),
      ...store.get('server'),
      ...store.get('engine', {}),
      hotkeys: store.get('hotkeys'),
    };
  });

  ipcMain.on('update-settings', (event, settings) => {
    const appearanceKeys = ['alwaysOnTop', 'opacity'];
    const serverKeys = ['host', 'port'];
    const hotkeyKeys = ['toggleRecording', 'pasteTranscript', 'showHide'];

    for (const [key, value] of Object.entries(settings)) {
      if (appearanceKeys.includes(key)) {
        store.set(`appearance.${key}`, key === 'opacity' ? value / 100 : value);
        const mw = mainWindowRef.current;
        if (key === 'alwaysOnTop' && mw && !mw.isDestroyed()) {
          mw.setAlwaysOnTop(value, process.platform === 'darwin' ? 'floating' : 'normal');
        }
        if (key === 'opacity' && mw && !mw.isDestroyed()) {
          mw.setOpacity(value / 100);
        }
      } else if (serverKeys.includes(key)) {
        store.set(`server.${key}`, value);
      } else if (hotkeyKeys.includes(key)) {
        store.set(`hotkeys.${key}`, value);
        if (app.isReady()) {
          globalShortcut.unregisterAll();
          registerHotkeys();
        }
      } else if (key === 'cloudPassword') {
        // SEC-C1: Encrypt cloud password via safeStorage — never store plaintext
        if (value && safeStorage && safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(String(value));
          store.set('engine.cloudPasswordEncrypted', encrypted.toString('base64'));
        } else if (value) {
          store.set('engine.cloudPassword', value);
        }
        store.delete('engine.cloudPassword');
      } else {
        // Engine settings (model, device, language, vibeEnabled, micDeviceId)
        store.set(`engine.${key}`, value);
      }
    }
  });

  // ── font size ────────────────────────────────────────────────
  ipcMain.handle('get-font-size', async () => {
    return store.get('appearance.fontSize') || 100;
  });

  ipcMain.handle('set-font-size', async (event, percent) => {
    const clamped = Math.max(70, Math.min(150, Number(percent) || 100));
    store.set('appearance.fontSize', clamped);
    const mw = mainWindowRef.current;
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('font-size-changed', clamped);
    }
    return clamped;
  });

  // ── hotkey rebind ────────────────────────────────────────────
  ipcMain.handle('rebind-hotkey', (event, key, accelerator) => {
    try {
      if (RESERVED.includes(accelerator)) {
        return { ok: false, error: `${accelerator} is a reserved system shortcut` };
      }
      // Reject anything that isn't a real chord. A bare key (no modifier) registers as a
      // global shortcut that fires on every keystroke and clobbers the others — the bug
      // that hid the window and left recording un-stoppable.
      if (!/\+/.test(accelerator) || !/(CommandOrControl|Command|Control|Cmd|Ctrl|Alt|Option|Shift|Super|Meta)\s*\+/i.test(accelerator)) {
        return { ok: false, error: 'Shortcut must include a modifier, e.g. CommandOrControl+Shift+Key' };
      }
      // Snapshot the working hotkeys so we can ROLL BACK if the new one won't register —
      // never leave the user with dead show-hide / toggle-recording shortcuts.
      const oldHotkeys = { ...(store.get('hotkeys') || {}) };
      store.set('hotkeys', { ...oldHotkeys, [key]: accelerator });
      globalShortcut.unregisterAll();
      registerHotkeys();
      if (!globalShortcut.isRegistered(accelerator)) {
        store.set('hotkeys', oldHotkeys);
        globalShortcut.unregisterAll();
        registerHotkeys();
        console.warn(`[Hotkey] ${accelerator} failed to register — reverted ${key}`);
        return { ok: false, error: `${accelerator} couldn't be registered (already in use?) — reverted` };
      }
      console.info(`[Hotkey] Rebound ${key} → ${accelerator}`);
      return { ok: true, key, accelerator };
    } catch (err) {
      console.error('[Hotkey] Rebind failed:', err);
      try { globalShortcut.unregisterAll(); registerHotkeys(); } catch (_) { /* best-effort restore */ }
      return { ok: false, error: err.message };
    }
  });
}

const SETTINGS_IPC_CHANNELS = Object.freeze([
  'get-app-version',
  'get-settings',
  'update-settings',
  'get-font-size',
  'set-font-size',
  'rebind-hotkey',
]);

module.exports = { registerSettingsIpc, SETTINGS_IPC_CHANNELS, RESERVED_SHORTCUTS_DEFAULT };
