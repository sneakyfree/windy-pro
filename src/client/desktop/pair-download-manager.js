/**
 * Windy Pro — Pair Download Manager (L1) + Encryption at Rest (L6)
 *
 * Downloads translation-pair models from CDN, verifies SHA-256 checksums,
 * encrypts at rest with AES-256-GCM, and decrypts only into memory.
 *
 * Storage layout:
 *   {userData}/translation-pairs/{pairId}/model.enc   — encrypted model
 *   {userData}/translation-pairs/{pairId}/meta.json   — metadata + IV + salt
 *
 * DNA Strand: L1, L6
 */

'use strict';

const { EventEmitter } = require('events');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;            // 256 bits
const IV_LENGTH = 12;             // 96 bits for GCM
const SALT_LENGTH = 16;           // 128 bits
const AUTH_TAG_LENGTH = 16;       // 128-bit GCM auth tag
const TEMP_SUFFIX = '.tmp';
const MODEL_ENC_NAME = 'model.enc';
const META_NAME = 'meta.json';

// Hardening constants
const CONNECT_TIMEOUT_MS = 60000;    // 60 seconds connect timeout
const DOWNLOAD_TIMEOUT_MS = 300000;  // 300 seconds (5 min) total download timeout
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;          // 1s base for exponential backoff
const MAX_CONCURRENT_DOWNLOADS = 1;

class PairDownloadManager extends EventEmitter {
  /**
   * @param {string} pairsDir — absolute path to translation-pairs/ directory
   * @param {string} licenseToken — user license token used in key derivation
   */
  constructor(pairsDir, licenseToken) {
    super();
    this.pairsDir = pairsDir;
    this.licenseToken = licenseToken || '';
    this.deviceId = os.hostname() + '-' + os.platform();

    /** @type {Map<string, {req: http.ClientRequest, aborted: boolean}>} */
    this._activeDownloads = new Map();

    /** Concurrency semaphore — only MAX_CONCURRENT_DOWNLOADS at a time */
    this._downloadQueue = [];
    this._currentDownloads = 0;
  }

  // ═══════════════════════════════════════════
  // Logging
  // ═══════════════════════════════════════════

  /** Timestamped log helper */
  _log(level, method, msg) {
    const ts = new Date().toISOString();
    const prefix = `[PairDL ${ts}]`;
    if (level === 'error') {
      console.error(`${prefix} [${method}] ${msg}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} [${method}] ${msg}`);
    } else {
      console.log(`${prefix} [${method}] ${msg}`);
    }
  }

  // ═══════════════════════════════════════════
  // Input Validation
  // ═══════════════════════════════════════════

  /** Validate pairId is a non-empty string */
  _validatePairId(pairId) {
    if (typeof pairId !== 'string' || pairId.trim().length === 0) {
      throw new Error('pairId must be a non-empty string');
    }
  }

  // ═══════════════════════════════════════════
  // Key Derivation (L6)
  // ═══════════════════════════════════════════

  /**
   * Derive a 256-bit AES key from licence + device identity.
   * @param {Buffer} salt — 16-byte random salt
   * @returns {Buffer} 32-byte key
   */
  _deriveKey(salt) {
    const passphrase = this.licenseToken + this.deviceId;
    return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
  }

  /**
   * Encrypt a plaintext buffer with AES-256-GCM.
   * @param {Buffer} plaintext
   * @param {Buffer} salt
   * @param {Buffer} iv
   * @returns {Buffer} ciphertext || authTag (16 bytes appended)
   */
  _encrypt(plaintext, salt, iv) {
    const key = this._deriveKey(salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([encrypted, authTag]);
  }

  /**
   * Decrypt a ciphertext buffer (with appended auth tag) using AES-256-GCM.
   * @param {Buffer} cipherWithTag — ciphertext || 16-byte authTag
   * @param {Buffer} salt
   * @param {Buffer} iv
   * @returns {Buffer} plaintext
   */
  _decrypt(cipherWithTag, salt, iv) {
    const key = this._deriveKey(salt);
    const ciphertext = cipherWithTag.subarray(0, cipherWithTag.length - AUTH_TAG_LENGTH);
    const authTag = cipherWithTag.subarray(cipherWithTag.length - AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // ═══════════════════════════════════════════
  // Download (L1) — with retry + concurrency
  // ═══════════════════════════════════════════

  /**
   * Download a single translation pair from CDN.
   * Rate-limited to MAX_CONCURRENT_DOWNLOADS to prevent bandwidth flooding.
   *
   * @param {string} pairId — e.g. 'en-es'
   * @param {object} catalog — full pair-catalog object (pairs map)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async downloadPair(pairId, catalog) {
    // Input validation
    try {
      this._validatePairId(pairId);
    } catch (err) {
      return { success: false, error: err.message };
    }

    // Validate catalog entry exists
    const pairInfo = catalog?.pairs?.[pairId];
    if (!pairInfo) {
      this._log('warn', 'downloadPair', `Unknown pair: ${pairId}`);
      return { success: false, error: `Unknown pair: ${pairId}` };
    }

    // Already downloaded?
    if (this.isDownloaded(pairId)) {
      this._log('info', 'downloadPair', `${pairId} already downloaded`);
      return { success: true, alreadyExists: true };
    }

    // Concurrency gate — wait in queue if at limit
    if (this._currentDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      this._log('info', 'downloadPair', `${pairId} queued (${this._currentDownloads} active)`);
      await new Promise(resolve => this._downloadQueue.push(resolve));
    }
    this._currentDownloads++;

    try {
      return await this._downloadPairImpl(pairId, pairInfo);
    } finally {
      this._currentDownloads--;
      // Release next queued download
      if (this._downloadQueue.length > 0) {
        const next = this._downloadQueue.shift();
        next();
      }
    }
  }

  /**
   * Internal download implementation with retry logic.
   */
  async _downloadPairImpl(pairId, pairInfo) {
    this._log('info', 'downloadPair', `Starting download: ${pairId}`);

    // Disk space check — require 2× model size
    const requiredBytes = pairInfo.sizeMB * 1024 * 1024 * 2;
    try {
      const storageInfo = await this.getStorageInfo();
      if (storageInfo.availableBytes < requiredBytes) {
        const msg = `Insufficient disk space. Need ${(requiredBytes / 1024 / 1024).toFixed(0)} MB, have ${(storageInfo.availableBytes / 1024 / 1024).toFixed(0)} MB.`;
        this._log('error', 'downloadPair', msg);
        return { success: false, error: msg };
      }
    } catch (e) {
      // Non-fatal — proceed anyway if we can't check disk space
      this._log('warn', 'downloadPair', `Could not check disk space: ${e.message}`);
    }

    const pairDir = path.join(this.pairsDir, pairId);
    const tempPath = path.join(pairDir, `model${TEMP_SUFFIX}`);
    const encPath = path.join(pairDir, MODEL_ENC_NAME);
    const metaPath = path.join(pairDir, META_NAME);

    await fsp.mkdir(pairDir, { recursive: true });

    try {
      // Check for partial download (resume support)
      let existingBytes = 0;
      try {
        const stat = await fsp.stat(tempPath);
        existingBytes = stat.size;
      } catch (_) { /* no partial file */ }

      // Download with retry (3 attempts, exponential backoff)
      let downloadedBuf = null;
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          this._log('info', 'downloadPair', `${pairId} attempt ${attempt}/${MAX_RETRIES}`);
          downloadedBuf = await this._httpDownload(pairId, pairInfo.cdnUrl, existingBytes, pairInfo.sizeMB * 1024 * 1024);
          break; // Success
        } catch (err) {
          lastError = err;
          this._log('warn', 'downloadPair', `${pairId} attempt ${attempt} failed: ${err.message}`);
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(4, attempt - 1); // 1s, 4s, 16s
            this._log('info', 'downloadPair', `Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      if (!downloadedBuf) {
        const msg = lastError?.message === 'Download cancelled'
          ? 'Download cancelled'
          : `Download failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`;
        this._log('error', 'downloadPair', msg);
        return { success: false, error: msg };
      }

      // If we resumed, combine with existing partial data
      let fullBuffer;
      if (existingBytes > 0) {
        const existingData = await fsp.readFile(tempPath);
        fullBuffer = Buffer.concat([existingData, downloadedBuf]);
      } else {
        fullBuffer = downloadedBuf;
      }

      // Write temp file for checksum verification
      try {
        await fsp.writeFile(tempPath, fullBuffer);
      } catch (writeErr) {
        // Handle disk full (ENOSPC)
        if (writeErr.code === 'ENOSPC') {
          this._log('error', 'downloadPair', `Disk full writing ${pairId} — cleaning up`);
          await fsp.unlink(tempPath).catch(() => {});
          return { success: false, error: 'Disk full. Free some space and try again.' };
        }
        throw writeErr;
      }

      // Verify SHA-256 checksum
      const hash = crypto.createHash('sha256').update(fullBuffer).digest('hex');
      if (hash !== pairInfo.sha256) {
        await fsp.unlink(tempPath).catch(() => {});
        const msg = `Checksum mismatch. Expected ${pairInfo.sha256}, got ${hash}`;
        this._log('error', 'downloadPair', msg);
        return { success: false, error: msg };
      }

      // Encrypt at rest
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      const encryptedData = this._encrypt(fullBuffer, salt, iv);

      // Write encrypted model
      try {
        await fsp.writeFile(encPath, encryptedData);
      } catch (writeErr) {
        if (writeErr.code === 'ENOSPC') {
          this._log('error', 'downloadPair', `Disk full writing encrypted ${pairId} — cleaning up`);
          await fsp.unlink(tempPath).catch(() => {});
          await fsp.unlink(encPath).catch(() => {});
          return { success: false, error: 'Disk full. Free some space and try again.' };
        }
        throw writeErr;
      }

      // Write metadata
      const meta = {
        pairId,
        name: pairInfo.name,
        sizeMB: pairInfo.sizeMB,
        sha256: pairInfo.sha256,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        downloadedAt: new Date().toISOString(),
        encryptedSizeBytes: encryptedData.length
      };

      try {
        await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch (writeErr) {
        if (writeErr.code === 'ENOSPC') {
          this._log('error', 'downloadPair', `Disk full writing meta for ${pairId} — cleaning up`);
          await fsp.unlink(tempPath).catch(() => {});
          await fsp.unlink(encPath).catch(() => {});
          return { success: false, error: 'Disk full. Free some space and try again.' };
        }
        throw writeErr;
      }

      // Delete temp plaintext — NEVER leave plaintext on disk
      await fsp.unlink(tempPath).catch(() => {});

      this._activeDownloads.delete(pairId);
      this._log('info', 'downloadPair', `${pairId} completed successfully`);
      return { success: true };

    } catch (err) {
      this._activeDownloads.delete(pairId);
      // Clean up temp and partial files on error
      await fsp.unlink(tempPath).catch(() => {});
      await fsp.unlink(encPath).catch(() => {});
      this._log('error', 'downloadPair', `${pairId} failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Download file from URL with progress events, resume support, and timeouts.
   * @param {string} pairId
   * @param {string} url
   * @param {number} existingBytes — bytes already downloaded (for Range header)
   * @param {number} totalSize — expected total size in bytes
   * @returns {Promise<Buffer|null>} — null if cancelled
   */
  _httpDownload(pairId, url, existingBytes, totalSize) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const headers = {};
      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      // Connect timeout
      let connectTimer = setTimeout(() => {
        this._log('error', '_httpDownload', `Connect timeout for ${pairId} (${CONNECT_TIMEOUT_MS}ms)`);
        req.destroy(new Error(`Connect timeout after ${CONNECT_TIMEOUT_MS / 1000}s`));
      }, CONNECT_TIMEOUT_MS);

      // Total download timeout
      let downloadTimer = setTimeout(() => {
        this._log('error', '_httpDownload', `Download timeout for ${pairId} (${DOWNLOAD_TIMEOUT_MS}ms)`);
        req.destroy(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS / 1000}s`));
      }, DOWNLOAD_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(connectTimer);
        clearTimeout(downloadTimer);
      };

      const req = transport.get(url, { headers }, (res) => {
        // Connection established — clear connect timeout
        clearTimeout(connectTimer);

        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          cleanup();
          res.resume();
          this._httpDownload(pairId, res.headers.location, existingBytes, totalSize)
            .then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          cleanup();
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        const contentLength = parseInt(res.headers['content-length'], 10) || 0;
        const effectiveTotal = totalSize || (existingBytes + contentLength);
        const chunks = [];
        let downloadedBytes = 0;
        let lastProgressTime = Date.now();
        let lastProgressBytes = 0;

        res.on('data', (chunk) => {
          chunks.push(chunk);
          downloadedBytes += chunk.length;

          // Emit progress at most every 250ms
          const now = Date.now();
          if (now - lastProgressTime >= 250) {
            const elapsed = (now - lastProgressTime) / 1000;
            const bytesInInterval = downloadedBytes - lastProgressBytes;
            const speed = elapsed > 0 ? bytesInInterval / elapsed : 0;
            const totalDownloaded = existingBytes + downloadedBytes;
            const percent = effectiveTotal > 0 ? Math.min(99, Math.round((totalDownloaded / effectiveTotal) * 100)) : 0;
            const remaining = effectiveTotal - totalDownloaded;
            const eta = speed > 0 ? Math.round(remaining / speed) : -1;

            this.emit('progress', { pairId, percent, speed, eta });

            lastProgressTime = now;
            lastProgressBytes = downloadedBytes;
          }
        });

        res.on('end', () => {
          cleanup();
          this.emit('progress', { pairId, percent: 100, speed: 0, eta: 0 });
          resolve(Buffer.concat(chunks));
        });

        res.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });

      req.on('error', (err) => {
        cleanup();
        reject(err);
      });

      // Track active download for cancellation
      this._activeDownloads.set(pairId, { req, aborted: false });

      req.end();
    });
  }

  /**
   * Download multiple pairs sequentially.
   * @param {string[]} pairIds
   * @param {object} catalog
   * @returns {Promise<{results: Object.<string, {success: boolean, error?: string}>}>}
   */
  async downloadBundle(pairIds, catalog) {
    if (!Array.isArray(pairIds)) {
      return { results: {} };
    }
    this._log('info', 'downloadBundle', `Starting bundle: ${pairIds.length} pairs`);
    const results = {};
    for (const pairId of pairIds) {
      results[pairId] = await this.downloadPair(pairId, catalog);
    }
    this._log('info', 'downloadBundle', `Bundle complete: ${Object.values(results).filter(r => r.success).length}/${pairIds.length} succeeded`);
    return { results };
  }

  /**
   * Cancel an in-progress download.
   * @param {string} pairId
   * @returns {{cancelled: boolean}}
   */
  cancelDownload(pairId) {
    try { this._validatePairId(pairId); } catch { return { cancelled: false }; }

    const active = this._activeDownloads.get(pairId);
    if (active && !active.aborted) {
      active.aborted = true;
      active.req.destroy(new Error('Download cancelled'));
      this._activeDownloads.delete(pairId);

      // Clean up partial temp file
      const tempPath = path.join(this.pairsDir, pairId, `model${TEMP_SUFFIX}`);
      fs.unlink(tempPath, () => {});

      this._log('info', 'cancelDownload', `Cancelled: ${pairId}`);
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  // ═══════════════════════════════════════════
  // Storage Management
  // ═══════════════════════════════════════════

  /**
   * Check if a pair is fully downloaded and encrypted.
   * @param {string} pairId
   * @returns {boolean}
   */
  isDownloaded(pairId) {
    try { this._validatePairId(pairId); } catch { return false; }

    const encPath = path.join(this.pairsDir, pairId, MODEL_ENC_NAME);
    const metaPath = path.join(this.pairsDir, pairId, META_NAME);
    return fs.existsSync(encPath) && fs.existsSync(metaPath);
  }

  /**
   * List all fully downloaded pair IDs.
   * @returns {string[]}
   */
  getDownloadedPairs() {
    try {
      const entries = fs.readdirSync(this.pairsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && this.isDownloaded(e.name))
        .map(e => e.name);
    } catch (_) {
      return [];
    }
  }

  /**
   * Delete a downloaded pair and free storage.
   * @param {string} pairId
   * @returns {Promise<{deleted: boolean}>}
   */
  async deletePair(pairId) {
    try { this._validatePairId(pairId); } catch { return { deleted: false }; }

    const pairDir = path.join(this.pairsDir, pairId);
    try {
      await fsp.rm(pairDir, { recursive: true, force: true });
      this._log('info', 'deletePair', `Deleted: ${pairId}`);
      return { deleted: true };
    } catch (err) {
      this._log('error', 'deletePair', `Failed to delete ${pairId}: ${err.message}`);
      return { deleted: false };
    }
  }

  /**
   * Get storage info for all downloaded pairs.
   * @returns {Promise<{usedBytes: number, availableBytes: number, pairs: Array<{id: string, sizeMB: number}>}>}
   */
  async getStorageInfo() {
    let usedBytes = 0;
    const pairs = [];

    const downloaded = this.getDownloadedPairs();
    for (const pairId of downloaded) {
      try {
        const metaPath = path.join(this.pairsDir, pairId, META_NAME);
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const encPath = path.join(this.pairsDir, pairId, MODEL_ENC_NAME);
        const stat = fs.statSync(encPath);
        usedBytes += stat.size;
        pairs.push({ id: pairId, sizeMB: meta.sizeMB || Math.round(stat.size / 1024 / 1024) });
      } catch (_) { /* skip corrupt entries */ }
    }

    // Get available disk space
    let availableBytes = 0;
    try {
      const stats = await fsp.statfs(this.pairsDir);
      availableBytes = stats.bfree * stats.bsize;
    } catch (_) {
      // statfs may not be available on all platforms; fallback
      try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
          // Windows: use wmic
          const out = execSync(`wmic logicaldisk where "DeviceID='${this.pairsDir.charAt(0)}:'" get FreeSpace /format:value`, { encoding: 'utf-8' });
          const m = out.match(/FreeSpace=(\d+)/);
          if (m) availableBytes = parseInt(m[1], 10);
        } else {
          // Unix: use df
          const out = execSync(`df -k "${this.pairsDir}" | tail -1`, { encoding: 'utf-8' });
          const parts = out.trim().split(/\s+/);
          if (parts.length >= 4) availableBytes = parseInt(parts[3], 10) * 1024;
        }
      } catch (_) { /* best effort */ }
    }

    return { usedBytes, availableBytes, pairs };
  }

  // ═══════════════════════════════════════════
  // Decryption — Memory Only (L6)
  // ═══════════════════════════════════════════

  /**
   * Load and decrypt a pair model into memory.
   * NEVER writes plaintext to disk.
   *
   * @param {string} pairId
   * @returns {Promise<Buffer>} — decrypted model data
   */
  async loadPairModel(pairId) {
    this._validatePairId(pairId);

    const pairDir = path.join(this.pairsDir, pairId);
    const encPath = path.join(pairDir, MODEL_ENC_NAME);
    const metaPath = path.join(pairDir, META_NAME);

    if (!fs.existsSync(encPath) || !fs.existsSync(metaPath)) {
      throw new Error(`Pair ${pairId} is not downloaded`);
    }

    this._log('info', 'loadPairModel', `Decrypting: ${pairId}`);
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8'));
    const iv = Buffer.from(meta.iv, 'hex');
    const salt = Buffer.from(meta.salt, 'hex');
    const encryptedData = await fsp.readFile(encPath);

    return this._decrypt(encryptedData, salt, iv);
  }
}

module.exports = { PairDownloadManager };
