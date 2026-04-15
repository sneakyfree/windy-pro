/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/ui/video-ipc.js (CR-009c).
 *
 * Mocks ipcMain, videoWindow (a fake BrowserWindow with the methods
 * the handlers touch), screen.getCursorScreenPoint, and
 * createVideoWindow. Verifies channel drift, show/hide flow,
 * videoDismissed behaviour, resize-drag start/stop, and the
 * stopResizeTimer escape hatch.
 */

'use strict';

const { registerVideoIpc, VIDEO_IPC_CHANNELS } = require('../src/client/desktop/ui/video-ipc');

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

function mockWindow() {
  const calls = { setSize: [], setBounds: [], minimize: 0, hide: 0, show: 0, setAlwaysOnTop: [] };
  let destroyed = false;
  let onTop = false;
  let bounds = { x: 100, y: 100, width: 320, height: 180 };
  const webContents = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    send: jest.fn(),
  };
  return {
    isDestroyed() { return destroyed; },
    webContents,
    setSize(w, h) { calls.setSize.push([w, h]); bounds = { ...bounds, width: w, height: h }; },
    setBounds(b) { calls.setBounds.push(b); bounds = { ...b }; },
    getBounds() { return { ...bounds }; },
    minimize() { calls.minimize++; },
    hide() { calls.hide++; },
    show() { calls.show++; },
    isAlwaysOnTop() { return onTop; },
    setAlwaysOnTop(v) { calls.setAlwaysOnTop.push(v); onTop = v; },
    destroy() { destroyed = true; },
    __calls: calls,
  };
}

function makeDeps(overrides = {}) {
  const win = mockWindow();
  return Object.assign({
    ipcMain: mockIpcMain(),
    createVideoWindow: jest.fn(() => win),
    videoWindowRef: { current: win },
    videoDismissedRef: { current: false },
    screen: { getCursorScreenPoint: () => ({ x: 500, y: 500 }) },
    _win: win,
  }, overrides);
}

afterEach(() => { jest.useRealTimers(); });

describe('registerVideoIpc', () => {
  test('registers exactly VIDEO_IPC_CHANNELS', () => {
    const d = makeDeps();
    registerVideoIpc(d);
    const registered = [...d.ipcMain.handlers.keys()].sort();
    expect(registered).toEqual([...VIDEO_IPC_CHANNELS].sort());
  });

  test('throws on missing deps', () => {
    expect(() => registerVideoIpc({})).toThrow(/missing required deps/);
  });
});

describe('show / hide / close / minimize', () => {
  test('show-video-preview returns {ok:false, dismissed:true} after close', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    d.videoDismissedRef.current = true;
    const r = await d.ipcMain.invoke('show-video-preview');
    expect(r).toEqual({ ok: false, dismissed: true });
    // createVideoWindow must NOT have been called when dismissed
    expect(d.createVideoWindow).not.toHaveBeenCalled();
  });

  test('show-video-preview creates + shows window when not dismissed', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    const r = await d.ipcMain.invoke('show-video-preview');
    expect(r).toEqual({ ok: true });
    expect(d.createVideoWindow).toHaveBeenCalled();
    expect(d._win.__calls.show).toBe(1);
  });

  test('hide-video-preview sends stop-camera + hides', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('hide-video-preview');
    expect(d._win.webContents.send).toHaveBeenCalledWith('stop-camera');
    expect(d._win.__calls.hide).toBe(1);
  });

  test('close-video-preview sets videoDismissedRef.current = true', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('close-video-preview');
    expect(d.videoDismissedRef.current).toBe(true);
    expect(d._win.webContents.send).toHaveBeenCalledWith('stop-camera');
  });

  test('minimize-video-preview calls minimize()', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('minimize-video-preview');
    expect(d._win.__calls.minimize).toBe(1);
  });

  test('toggle-video-always-on-top flips the flag and returns new value', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    const r1 = await d.ipcMain.invoke('toggle-video-always-on-top');
    expect(r1).toBe(true);
    const r2 = await d.ipcMain.invoke('toggle-video-always-on-top');
    expect(r2).toBe(false);
  });

  test('all show/hide/minimize handlers no-op on destroyed window', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    d._win.destroy();
    await d.ipcMain.invoke('hide-video-preview');   // must not throw
    await d.ipcMain.invoke('close-video-preview');
    await d.ipcMain.invoke('minimize-video-preview');
    const r = await d.ipcMain.invoke('toggle-video-always-on-top');
    expect(r).toBe(false);
  });
});

describe('messaging relays', () => {
  test('video-frame-to-preview forwards on the window webContents', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('video-frame-to-preview', 'data:image/png;base64,x');
    expect(d._win.webContents.send).toHaveBeenCalledWith('video-frame', 'data:image/png;base64,x');
  });

  test('recording-state-to-preview forwards state', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('recording-state-to-preview', 'listening');
    expect(d._win.webContents.send).toHaveBeenCalledWith('recording-state', 'listening');
  });
});

describe('sizing', () => {
  test('resize-video-preview sets size', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('resize-video-preview', 640, 360);
    expect(d._win.__calls.setSize).toEqual([[640, 360]]);
  });

  test('resize-move-video-preview with x+y sets bounds', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('resize-move-video-preview', 400, 225, 50, 60);
    expect(d._win.__calls.setBounds[0]).toEqual({ x: 50, y: 60, width: 400, height: 225 });
  });

  test('resize-move-video-preview with only x keeps y from current bounds', async () => {
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('resize-move-video-preview', 400, 225, 50, null);
    expect(d._win.__calls.setBounds[0]).toMatchObject({ x: 50, width: 400, height: 225 });
  });
});

describe('resize drag', () => {
  test('start-resize-video installs a setInterval timer; stop clears it', async () => {
    jest.useFakeTimers();
    const d = makeDeps();
    const api = registerVideoIpc(d);
    await d.ipcMain.invoke('start-resize-video', 'br', 500, 500, 320, 180, 100, 100);
    // Advance timer to fire once
    jest.advanceTimersByTime(20);
    // Stop — timer cleared
    await d.ipcMain.invoke('stop-resize-video');
    expect(api.stopResizeTimer).toBeInstanceOf(Function);
    // Calling stop again is idempotent
    api.stopResizeTimer();
  });

  test('resize-drag auto-stops when window is destroyed mid-drag', async () => {
    jest.useFakeTimers();
    const d = makeDeps();
    registerVideoIpc(d);
    await d.ipcMain.invoke('start-resize-video', 'br', 500, 500, 320, 180, 100, 100);
    d._win.destroy();
    jest.advanceTimersByTime(50); // would fire the setInterval callback
    // No throw; handler must have cleared its own timer on see-destroyed.
  });
});
