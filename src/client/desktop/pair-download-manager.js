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
  // Download (L1)
  // ═══════════════════════════════════════════

  /**
   * Download a single translation pair from CDN.
   *
   * Flow: download → verify SHA-256 → encrypt → write .enc → delete temp
   *
   * Emits 'progress' events: { pairId, percent, speed, eta }
   *
   * @param {string} pairId — e.g. 'en-es'
   * @param {object} catalog — full pair-catalog object (pairs map)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async downloadPair(pairId, catalog) {
    const pairInfo = catalog?.pairs?.[pairId];
    if (!pairInfo) {
      return { success: false, error: `Unknown pair: ${pairId}` };
    }

    // Already downloaded?
    if (this.isDownloaded(pairId)) {
      return { success: true, alreadyExists: true };
    }

    // Disk space check — require 2× model size
    const requiredBytes = pairInfo.sizeMB * 1024 * 1024 * 2;
    try {
      const storageInfo = await this.getStorageInfo();
      if (storageInfo.availableBytes < requiredBytes) {
        return { success: false, error: `Insufficient disk space. Need ${(requiredBytes / 1024 / 1024).toFixed(0)} MB, have ${(storageInfo.availableBytes / 1024 / 1024).toFixed(0)} MB.` };
      }
    } catch (e) {
      // Non-fatal — proceed anyway if we can't check disk space
      console.warn('[PairDL] Could not check disk space:', e.message);
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

      // Download with optional Range header for resume
      const downloadedBuf = await this._httpDownload(pairId, pairInfo.cdnUrl, existingBytes, pairInfo.sizeMB * 1024 * 1024);

      if (!downloadedBuf) {
        return { success: false, error: 'Download cancelled' };
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
      await fsp.writeFile(tempPath, fullBuffer);

      // Verify SHA-256 checksum
      const hash = crypto.createHash('sha256').update(fullBuffer).digest('hex');
      if (hash !== pairInfo.sha256) {
        await fsp.unlink(tempPath).catch(() => {});
        return { success: false, error: `Checksum mismatch. Expected ${pairInfo.sha256}, got ${hash}` };
      }

      // Encrypt at rest
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      const encryptedData = this._encrypt(fullBuffer, salt, iv);

      // Write encrypted model
      await fsp.writeFile(encPath, encryptedData);

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
      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      // Delete temp plaintext — NEVER leave plaintext on disk
      await fsp.unlink(tempPath).catch(() => {});

      this._activeDownloads.delete(pairId);
      return { success: true };

    } catch (err) {
      this._activeDownloads.delete(pairId);
      // Clean up temp file on error
      await fsp.unlink(tempPath).catch(() => {});
      return { success: false, error: err.message };
    }
  }

  /**
   * Download file from URL with progress events and resume support.
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

      const req = transport.get(url, { headers }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          this._httpDownload(pairId, res.headers.location, existingBytes, totalSize)
            .then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
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
          this.emit('progress', { pairId, percent: 100, speed: 0, eta: 0 });
          resolve(Buffer.concat(chunks));
        });

        res.on('error', reject);
      });

      req.on('error', reject);

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
    const results = {};
    for (const pairId of pairIds) {
      results[pairId] = await this.downloadPair(pairId, catalog);
    }
    return { results };
  }

  /**
   * Cancel an in-progress download.
   * @param {string} pairId
   * @returns {{cancelled: boolean}}
   */
  cancelDownload(pairId) {
    const active = this._activeDownloads.get(pairId);
    if (active && !active.aborted) {
      active.aborted = true;
      active.req.destroy(new Error('Download cancelled'));
      this._activeDownloads.delete(pairId);

      // Clean up partial temp file
      const tempPath = path.join(this.pairsDir, pairId, `model${TEMP_SUFFIX}`);
      fs.unlink(tempPath, () => {});

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
    const pairDir = path.join(this.pairsDir, pairId);
    try {
      await fsp.rm(pairDir, { recursive: true, force: true });
      return { deleted: true };
    } catch (_) {
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
    const pairDir = path.join(this.pairsDir, pairId);
    const encPath = path.join(pairDir, MODEL_ENC_NAME);
    const metaPath = path.join(pairDir, META_NAME);

    if (!fs.existsSync(encPath) || !fs.existsSync(metaPath)) {
      throw new Error(`Pair ${pairId} is not downloaded`);
    }

    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8'));
    const iv = Buffer.from(meta.iv, 'hex');
    const salt = Buffer.from(meta.salt, 'hex');
    const encryptedData = await fsp.readFile(encPath);

    return this._decrypt(encryptedData, salt, iv);
  }
}

module.exports = { PairDownloadManager };
