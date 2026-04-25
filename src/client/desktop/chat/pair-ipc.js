/**
 * Pair-download IPC handlers — extracted from main.js (CR-009b).
 *
 * Lives under chat/ because translation pairs are adjacent to the
 * chat+translate feature set in the UI. Shares nothing with the
 * real-time Matrix chat layer at runtime; just a convenient home.
 *
 * Registers: pair-catalog, pair-bundles, pair-download,
 * pair-download-bundle, pair-cancel, pair-delete,
 * pair-list-downloaded, pair-storage-info.
 *
 * Every handler that triggers a long-running network operation
 * (pair-download, pair-download-bundle) is bounded by withTimeout —
 * CR-003 follow-on: the PairDownloadManager has its own internal
 * retry/timeout per chunk, but the IPC layer still wants an outer
 * cap so the renderer never spins forever.
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;

/**
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.app                — electron.app (for isPackaged)
 * @param {() => object} deps.getPairDownloadManager
 * @param {<T>(p: Promise<T>, ms: number, label: string) => Promise<T>} deps.withTimeout
 * @param {string} [deps.sharedDir]        — test override for the
 *                                             shared/ directory location.
 */
function registerPairIpc(deps) {
  const { ipcMain, app, getPairDownloadManager, withTimeout } = deps;
  if (!ipcMain || !app || !getPairDownloadManager) {
    throw new Error('[pair-ipc] missing required deps');
  }

  const sharedDirFor = (name) => {
    if (deps.sharedDir) return path.join(deps.sharedDir, name);
    return app.isPackaged
      ? path.join(process.resourcesPath, 'shared', name)
      : path.join(__dirname, '..', '..', '..', '..', 'shared', name);
  };

  ipcMain.handle('pair-catalog', async () => {
    try {
      return JSON.parse(await fsp.readFile(sharedDirFor('pair-catalog.json'), 'utf-8'));
    } catch (err) {
      console.error('[PairDL] Failed to load catalog:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('pair-bundles', async () => {
    try {
      return JSON.parse(await fsp.readFile(sharedDirFor('pair-bundles.json'), 'utf-8'));
    } catch (err) {
      console.error('[PairDL] Failed to load bundles:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('pair-download', async (event, pairId) => {
    try {
      const mgr = getPairDownloadManager();
      const catalog = JSON.parse(await fsp.readFile(sharedDirFor('pair-catalog.json'), 'utf-8'));
      // CR-003: 20-min cap — a pair can be 100+MB on a slow link.
      // PairDownloadManager retries internally; this is the outer
      // "you have been trying for 20 minutes, give up" bound.
      return await withTimeout(mgr.downloadPair(pairId, catalog), 20 * 60_000, 'pair-download');
    } catch (err) {
      return { success: false, error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('pair-download-bundle', async (event, pairIds) => {
    try {
      const mgr = getPairDownloadManager();
      const catalog = JSON.parse(await fsp.readFile(sharedDirFor('pair-catalog.json'), 'utf-8'));
      // CR-003: bundles are N × pair-download. 60-min cap
      // (empirically a max-size bundle of ~15 pairs on a 2MB/s link
      // needs ~45 min).
      return await withTimeout(mgr.downloadBundle(pairIds, catalog), 60 * 60_000, 'pair-download-bundle');
    } catch (err) {
      return { results: {}, error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('pair-cancel', async (event, pairId) => {
    try { return getPairDownloadManager().cancelDownload(pairId); }
    catch (err) { return { cancelled: false, error: err.message }; }
  });

  ipcMain.handle('pair-delete', async (event, pairId) => {
    try { return await getPairDownloadManager().deletePair(pairId); }
    catch (err) { return { deleted: false, error: err.message }; }
  });

  ipcMain.handle('pair-list-downloaded', async () => {
    try { return getPairDownloadManager().getDownloadedPairs(); }
    catch (err) { return []; }
  });

  ipcMain.handle('pair-storage-info', async () => {
    try { return await getPairDownloadManager().getStorageInfo(); }
    catch (err) {
      return { usedBytes: 0, availableBytes: 0, pairs: [], error: err.message };
    }
  });
}

const PAIR_IPC_CHANNELS = Object.freeze([
  'pair-catalog', 'pair-bundles',
  'pair-download', 'pair-download-bundle',
  'pair-cancel', 'pair-delete',
  'pair-list-downloaded', 'pair-storage-info',
]);

module.exports = { registerPairIpc, PAIR_IPC_CHANNELS };
