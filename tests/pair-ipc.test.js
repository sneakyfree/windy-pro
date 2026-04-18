/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/chat/pair-ipc.js (CR-009b).
 *
 * Mocks ipcMain + PairDownloadManager + filesystem. Verifies the
 * registrar + the withTimeout wrappers + the shared-dir override
 * we use for test isolation.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerPairIpc, PAIR_IPC_CHANNELS } = require('../src/client/desktop/chat/pair-ipc');

function mockIpcMain() {
  const handlers = new Map();
  return {
    handle(c, f) { handlers.set(c, f); },
    handlers,
    invoke(c, ...args) {
      const h = handlers.get(c);
      if (!h) throw new Error(`no handler for ${c}`);
      return h({}, ...args);
    },
  };
}

function makeDeps(overrides = {}) {
  const tmpShared = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-ipc-'));
  fs.writeFileSync(path.join(tmpShared, 'pair-catalog.json'),
    JSON.stringify({ pairs: { 'windy-pair-en-es': { sizeMB: 50 } } }));
  fs.writeFileSync(path.join(tmpShared, 'pair-bundles.json'),
    JSON.stringify({ bundles: { 'europe': ['windy-pair-en-es'] } }));

  const mgr = {
    downloadPair: jest.fn(async () => ({ success: true })),
    downloadBundle: jest.fn(async () => ({ results: {} })),
    cancelDownload: jest.fn(() => ({ cancelled: true })),
    deletePair: jest.fn(async () => ({ deleted: true })),
    getDownloadedPairs: jest.fn(() => [{ id: 'windy-pair-en-es' }]),
    getStorageInfo: jest.fn(async () => ({ usedBytes: 0, availableBytes: 1e9, pairs: [] })),
  };
  return Object.assign({
    ipcMain: mockIpcMain(),
    app: { isPackaged: false },
    getPairDownloadManager: () => mgr,
    withTimeout: (p) => p,
    sharedDir: tmpShared,
    _fake: { mgr, tmpShared },
  }, overrides);
}

afterEach(() => {
  // No global state between tests — each makeDeps() mkdtemp's fresh.
});

describe('registerPairIpc', () => {
  test('registers exactly PAIR_IPC_CHANNELS', () => {
    const d = makeDeps();
    registerPairIpc(d);
    const registered = [...d.ipcMain.handlers.keys()].sort();
    expect(registered).toEqual([...PAIR_IPC_CHANNELS].sort());
  });

  test('throws on missing deps', () => {
    expect(() => registerPairIpc({})).toThrow(/missing required deps/);
  });
});

describe('pair-catalog + pair-bundles', () => {
  test('load from the shared dir override', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const catalog = await d.ipcMain.invoke('pair-catalog');
    expect(catalog.pairs['windy-pair-en-es']).toBeDefined();
    const bundles = await d.ipcMain.invoke('pair-bundles');
    expect(bundles.bundles.europe).toEqual(['windy-pair-en-es']);
  });

  test('returns { error } when file missing', async () => {
    const d = makeDeps({ sharedDir: '/nonexistent/path' });
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-catalog');
    expect(r.error).toBeDefined();
  });
});

describe('pair-download path', () => {
  test('delegates to downloadPair with the loaded catalog', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-download', 'windy-pair-en-es');
    expect(d._fake.mgr.downloadPair).toHaveBeenCalledWith(
      'windy-pair-en-es',
      expect.objectContaining({ pairs: expect.any(Object) })
    );
    expect(r.success).toBe(true);
  });

  test('surfaces timedOut on withTimeout trip', async () => {
    const d = makeDeps({
      withTimeout: () => Promise.reject(Object.assign(new Error('20min'), { timedOut: true })),
    });
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-download', 'windy-pair-en-es');
    expect(r.success).toBe(false);
    expect(r.timedOut).toBe(true);
  });
});

describe('pair-download-bundle', () => {
  test('delegates to downloadBundle', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-download-bundle', ['windy-pair-en-es']);
    expect(d._fake.mgr.downloadBundle).toHaveBeenCalled();
    expect(r.results).toBeDefined();
  });
});

describe('pair-cancel / pair-delete / pair-list-downloaded / pair-storage-info', () => {
  test('cancel returns manager result', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-cancel', 'windy-pair-en-es');
    expect(d._fake.mgr.cancelDownload).toHaveBeenCalledWith('windy-pair-en-es');
    expect(r.cancelled).toBe(true);
  });

  test('delete returns manager result', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-delete', 'windy-pair-en-es');
    expect(r.deleted).toBe(true);
  });

  test('list-downloaded returns an array', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-list-downloaded');
    expect(Array.isArray(r)).toBe(true);
  });

  test('storage-info returns usage numbers', async () => {
    const d = makeDeps();
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-storage-info');
    expect(r.availableBytes).toBeGreaterThan(0);
  });

  test('storage-info returns zeros + error on manager failure', async () => {
    const d = makeDeps();
    d._fake.mgr.getStorageInfo = () => { throw new Error('disk-broken'); };
    registerPairIpc(d);
    const r = await d.ipcMain.invoke('pair-storage-info');
    expect(r.usedBytes).toBe(0);
    expect(r.error).toBe('disk-broken');
  });
});
