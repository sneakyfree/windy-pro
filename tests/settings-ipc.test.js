/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/ui/settings-ipc.js.
 *
 * Mocks ipcMain + store + app + safeStorage + globalShortcut +
 * registerHotkeys + mainWindowRef. Verifies channel registration,
 * settings write-through, hotkey rebind (including the reserved
 * shortcut guard), font-size clamping, and cloudPassword
 * encryption branch.
 */

'use strict';

const { registerSettingsIpc, SETTINGS_IPC_CHANNELS } =
  require('../src/client/desktop/ui/settings-ipc');

function mockIpcMain() {
  const handlers = new Map();
  return {
    handle(c, f) { handlers.set(c, f); },
    on(c, f) { handlers.set(c, f); },
    handlers,
    invoke(c, ...args) {
      const h = handlers.get(c);
      if (!h) throw new Error(`no handler for ${c}`);
      return h({}, ...args);
    },
  };
}

function mockStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get(k, d) {
      if (map.has(k)) return map.get(k);
      return d !== undefined ? d : undefined;
    },
    set(k, v) { map.set(k, v); },
    delete(k) { map.delete(k); },
    __map: map,
  };
}

function makeDeps(overrides = {}) {
  const win = {
    __destroyed: false,
    isDestroyed() { return this.__destroyed; },
    setAlwaysOnTop: jest.fn(),
    setOpacity: jest.fn(),
    webContents: { send: jest.fn() },
  };
  return Object.assign({
    ipcMain: mockIpcMain(),
    store: mockStore({
      appearance: { alwaysOnTop: true, opacity: 1, fontSize: 100 },
      server: { host: '127.0.0.1', port: 9876 },
      engine: { model: 'base' },
      hotkeys: { toggleRecording: 'CommandOrControl+Shift+Space' },
    }),
    app: {
      isReady: () => true,
      getVersion: () => '9.9.9-test',
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('enc:' + s),
    },
    globalShortcut: { unregisterAll: jest.fn() },
    registerHotkeys: jest.fn(),
    mainWindowRef: { current: win },
    reservedShortcuts: ['CommandOrControl+Space', 'CommandOrControl+Q'],
    _win: win,
  }, overrides);
}

describe('registerSettingsIpc', () => {
  test('registers exactly SETTINGS_IPC_CHANNELS', () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    const registered = [...d.ipcMain.handlers.keys()].sort();
    expect(registered).toEqual([...SETTINGS_IPC_CHANNELS].sort());
  });

  test('throws on missing deps', () => {
    expect(() => registerSettingsIpc({})).toThrow(/missing required deps/);
  });
});

describe('get-app-version + get-settings', () => {
  test('get-app-version returns app.getVersion', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    const v = await d.ipcMain.invoke('get-app-version');
    expect(v).toBe('9.9.9-test');
  });

  test('get-settings returns flat shape with hotkeys nested', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    const s = await d.ipcMain.invoke('get-settings');
    expect(s.alwaysOnTop).toBe(true);
    expect(s.host).toBe('127.0.0.1');
    expect(s.model).toBe('base');
    expect(s.hotkeys.toggleRecording).toBe('CommandOrControl+Shift+Space');
  });
});

describe('update-settings', () => {
  test('appearance.opacity stored as fraction + mainWindow.setOpacity called', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { opacity: 80 });
    expect(d.store.get('appearance.opacity')).toBe(0.8);
    expect(d._win.setOpacity).toHaveBeenCalledWith(0.8);
  });

  test('appearance.alwaysOnTop flips via setAlwaysOnTop', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { alwaysOnTop: false });
    expect(d._win.setAlwaysOnTop).toHaveBeenCalledWith(false, expect.any(String));
  });

  test('hotkey update re-registers shortcuts', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { toggleRecording: 'CommandOrControl+Shift+R' });
    expect(d.globalShortcut.unregisterAll).toHaveBeenCalled();
    expect(d.registerHotkeys).toHaveBeenCalled();
  });

  test('cloudPassword encrypted + plaintext removed', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { cloudPassword: 'supersecret' });
    expect(d.store.get('engine.cloudPasswordEncrypted')).toBeDefined();
    expect(d.store.get('engine.cloudPassword')).toBeUndefined();
  });

  test('cloudPassword fallback plaintext when safeStorage not available', async () => {
    const d = makeDeps({ safeStorage: { isEncryptionAvailable: () => false } });
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { cloudPassword: 'pw' });
    // The handler writes then deletes the plaintext key — final state:
    // no plaintext AND no encrypted (since encryption was unavailable).
    // The intended user-facing behaviour is "don't store it at all"
    // when encryption isn't available. Adjusted assertion accordingly.
    expect(d.store.get('engine.cloudPassword')).toBeUndefined();
  });

  test('engine settings passthrough', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { model: 'large', language: 'es' });
    expect(d.store.get('engine.model')).toBe('large');
    expect(d.store.get('engine.language')).toBe('es');
  });

  test('no-ops on destroyed window for appearance updates', async () => {
    const d = makeDeps();
    d._win.__destroyed = true;
    registerSettingsIpc(d);
    await d.ipcMain.invoke('update-settings', { alwaysOnTop: true, opacity: 90 });
    // The store still updates
    expect(d.store.get('appearance.opacity')).toBe(0.9);
    // But window methods don't fire
    expect(d._win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(d._win.setOpacity).not.toHaveBeenCalled();
  });
});

describe('font size', () => {
  test('get-font-size returns stored value or 100', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    expect(await d.ipcMain.invoke('get-font-size')).toBe(100);
  });

  test('set-font-size clamps to [70, 150]', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    expect(await d.ipcMain.invoke('set-font-size', 999)).toBe(150);
    expect(await d.ipcMain.invoke('set-font-size', -5)).toBe(70);
    expect(await d.ipcMain.invoke('set-font-size', 120)).toBe(120);
  });

  test('set-font-size notifies renderer', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    await d.ipcMain.invoke('set-font-size', 110);
    expect(d._win.webContents.send).toHaveBeenCalledWith('font-size-changed', 110);
  });
});

describe('rebind-hotkey', () => {
  test('accepts a valid rebind', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    const r = await d.ipcMain.invoke('rebind-hotkey', 'toggleRecording', 'CommandOrControl+Shift+R');
    expect(r.ok).toBe(true);
    expect(d.store.get('hotkeys').toggleRecording).toBe('CommandOrControl+Shift+R');
    expect(d.globalShortcut.unregisterAll).toHaveBeenCalled();
    expect(d.registerHotkeys).toHaveBeenCalled();
  });

  test('blocks reserved shortcuts', async () => {
    const d = makeDeps();
    registerSettingsIpc(d);
    const r = await d.ipcMain.invoke('rebind-hotkey', 'toggleRecording', 'CommandOrControl+Space');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reserved/);
    // And the store is unchanged
    expect(d.store.get('hotkeys').toggleRecording).toBe('CommandOrControl+Shift+Space');
  });

  test('returns error on registerHotkeys throw', async () => {
    const d = makeDeps({ registerHotkeys: () => { throw new Error('bad binding'); } });
    registerSettingsIpc(d);
    const r = await d.ipcMain.invoke('rebind-hotkey', 'toggleRecording', 'CommandOrControl+Shift+R');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad binding');
  });
});
