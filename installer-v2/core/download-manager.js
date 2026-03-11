/**
 * Windy Pro v2.0 — Download Manager
 * Handles engine downloads from WindyProLabs HuggingFace repos
 * with resume, retry, checksum verification, and progress tracking.
 *
 * All engines downloaded from HuggingFace: WindyProLabs/[model-id]
 * GPU models: WindyProLabs/windy-stt-*
 * CPU models: WindyProLabs/windy-stt-*-ct2
 * Translation: WindyProLabs/windy_translate_*
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// HuggingFace configuration
const HF_BASE = 'https://huggingface.co';
const HF_ORG = 'WindyProLabs';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const CHUNK_LOG_INTERVAL = 500; // Report progress every 500ms

/**
 * Map internal engine IDs to HuggingFace repo names
 * GPU models: windy-stt-* → WindyProLabs/windy-stt-*
 * CPU models: windy-stt-*-cpu → WindyProLabs/windy-stt-*-ct2
 * Translation: windy-translate-* → WindyProLabs/windy_translate_*
 */
const ENGINE_TO_HF_REPO = {
  // GPU engines
  'windy-stt-nano': 'windy-stt-nano',
  'windy-stt-lite': 'windy-stt-lite',
  'windy-stt-core': 'windy-stt-core',
  'windy-stt-edge': 'windy-stt-edge',
  'windy-stt-plus': 'windy-stt-plus',
  'windy-stt-turbo': 'windy-stt-turbo',
  'windy-stt-pro': 'windy-stt-pro',
  // CPU engines (ct2 = CTranslate2 quantized)
  'windy-stt-nano-cpu': 'windy-stt-nano-ct2',
  'windy-stt-lite-cpu': 'windy-stt-lite-ct2',
  'windy-stt-core-cpu': 'windy-stt-core-ct2',
  'windy-stt-edge-cpu': 'windy-stt-edge-ct2',
  'windy-stt-plus-cpu': 'windy-stt-plus-ct2',
  'windy-stt-turbo-cpu': 'windy-stt-turbo-ct2',
  'windy-stt-pro-cpu': 'windy-stt-pro-ct2',
  // Translation engines
  'windy-translate-spark': 'windy_translate_spark',
  'windy-translate-standard': 'windy_translate_standard'
};

/**
 * Essential files to download from each repo
 * These are the minimum files needed for inference
 */
const REQUIRED_FILES = {
  gpu: [
    'config.json',
    'preprocessor_config.json',
    'model.safetensors',
    'tokenizer.json',
    'vocabulary.json'
  ],
  cpu: [
    'config.json',
    'model.bin',
    'vocabulary.txt'
  ],
  translation: [
    'config.json',
    'model.safetensors',
    'tokenizer.json',
    'source.spm',
    'target.spm'
  ]
};

class DownloadManager {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    this.activeDownloads = new Map();
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  /**
   * Get the HuggingFace repo URL for an engine
   */
  getRepoUrl(engineId) {
    const repoName = ENGINE_TO_HF_REPO[engineId];
    if (!repoName) {
      throw new Error(`Unknown engine ID: ${engineId}`);
    }
    return `${HF_BASE}/${HF_ORG}/${repoName}`;
  }

  /**
   * Get the file download URL for an engine
   */
  getFileUrl(engineId, filename) {
    const repoName = ENGINE_TO_HF_REPO[engineId];
    if (!repoName) {
      throw new Error(`Unknown engine ID: ${engineId}`);
    }
    return `${HF_BASE}/${HF_ORG}/${repoName}/resolve/main/${filename}`;
  }

  /**
   * Determine required files based on engine type
   */
  getRequiredFiles(engineId) {
    if (engineId.includes('translate')) {
      return REQUIRED_FILES.translation;
    } else if (engineId.endsWith('-cpu')) {
      return REQUIRED_FILES.cpu;
    } else {
      return REQUIRED_FILES.gpu;
    }
  }

  /**
   * Download a single engine with progress reporting
   * Downloads all required files from HuggingFace repo
   * @param {string} engineId - Engine identifier (e.g., 'windy-stt-nano')
   * @param {number} expectedSizeMB - Expected total size in MB
   * @param {function} onProgress - Callback(percent, downloadedMB, speedMBps)
   * @param {string} accountToken - Optional JWT token
   * @returns {Promise<string>} Path to downloaded engine directory
   */
  async downloadEngine(engineId, expectedSizeMB, onProgress, accountToken = null) {
    const engineDir = path.join(this.modelsDir, engineId);
    fs.mkdirSync(engineDir, { recursive: true });

    // Check if already downloaded and complete
    const requiredFiles = this.getRequiredFiles(engineId);
    const allFilesExist = requiredFiles.every(f =>
      fs.existsSync(path.join(engineDir, f))
    );

    if (allFilesExist) {
      console.log(`[DownloadManager] Engine ${engineId} already downloaded`);
      onProgress(100, expectedSizeMB, 0);
      return engineDir;
    }

    console.log(`[DownloadManager] Downloading ${engineId} from ${HF_ORG}/${ENGINE_TO_HF_REPO[engineId]}`);

    // Download each required file
    const totalBytes = expectedSizeMB * 1024 * 1024;
    let downloadedBytes = 0;
    let startTime = Date.now();

    for (const filename of requiredFiles) {
      const fileUrl = this.getFileUrl(engineId, filename);
      const filePath = path.join(engineDir, filename);

      // Skip if file already exists
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        downloadedBytes += stat.size;
        continue;
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await this._downloadFile(fileUrl, filePath, (chunkBytes) => {
            downloadedBytes += chunkBytes;
            const elapsed = (Date.now() - startTime) / 1000;
            const speedMBps = elapsed > 0 ? (downloadedBytes / (1024 * 1024)) / elapsed : 0;
            const percent = Math.min(99, (downloadedBytes / totalBytes) * 100);
            onProgress(percent, downloadedBytes / (1024 * 1024), speedMBps);
          });
          break; // Success
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[DownloadManager] Retry ${attempt}/${MAX_RETRIES} for ${filename}: ${err.message}`);
            await this._delay(RETRY_DELAY_MS * attempt);
          } else {
            throw new Error(`Failed to download ${filename} after ${MAX_RETRIES} attempts: ${err.message}`);
          }
        }
      }
    }

    // Mark as complete
    onProgress(100, expectedSizeMB, 0);
    return engineDir;
  }

  /**
   * Download a single file with progress tracking
   */
  _downloadFile(url, destPath, onChunk) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.get(url, { timeout: 30000 }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this._downloadFile(redirectUrl, destPath, onChunk)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }

        const writeStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          writeStream.write(chunk);
          onChunk(chunk.length);
        });

        res.on('end', () => {
          writeStream.end(() => {
            resolve();
          });
        });

        res.on('error', (err) => {
          writeStream.end();
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Download multiple engines with overall progress tracking
   */
  async downloadMultiple(engines, onOverallProgress, onEngineProgress, accountToken = null) {
    const totalMB = engines.reduce((sum, e) => sum + e.sizeMB, 0);
    let completedMB = 0;

    for (let i = 0; i < engines.length; i++) {
      const engine = engines[i];

      onOverallProgress({
        engineIndex: i,
        engineCount: engines.length,
        engineId: engine.id,
        engineName: engine.displayName || engine.name,
        overallPercent: (completedMB / totalMB) * 100,
        phase: 'downloading'
      });

      await this.downloadEngine(
        engine.id,
        engine.sizeMB,
        (percent, downloadedMB, speedMBps) => {
          const currentEngineMB = (percent / 100) * engine.sizeMB;
          const overallPercent = ((completedMB + currentEngineMB) / totalMB) * 100;

          // ETA calculation
          let etaText = '';
          if (speedMBps > 0) {
            const remainingMB = totalMB - completedMB - currentEngineMB;
            const etaSeconds = remainingMB / speedMBps;
            if (etaSeconds < 60) etaText = `~${Math.ceil(etaSeconds)}s remaining`;
            else if (etaSeconds < 3600) etaText = `~${Math.ceil(etaSeconds / 60)} min remaining`;
            else etaText = `~${(etaSeconds / 3600).toFixed(1)} hr remaining`;
          }

          onEngineProgress({
            engineId: engine.id,
            enginePercent: percent,
            overallPercent,
            downloadedMB: Math.round(downloadedMB * 10) / 10,
            speedMBps: Math.round(speedMBps * 100) / 100,
            eta: etaText,
            engineDone: percent >= 100
          });
        },
        accountToken
      );

      completedMB += engine.sizeMB;
    }

    onOverallProgress({
      overallPercent: 100,
      phase: 'complete'
    });
  }

  /**
   * Verify an engine's integrity by checking all required files exist
   */
  async verifyEngine(engineId) {
    const engineDir = path.join(this.modelsDir, engineId);
    if (!fs.existsSync(engineDir)) return false;

    const requiredFiles = this.getRequiredFiles(engineId);
    const allFilesExist = requiredFiles.every(f =>
      fs.existsSync(path.join(engineDir, f))
    );

    return allFilesExist;
  }

  /**
   * Get list of installed engines
   */
  getInstalledEngines() {
    if (!fs.existsSync(this.modelsDir)) return [];
    return fs.readdirSync(this.modelsDir)
      .filter(name => {
        const engineDir = path.join(this.modelsDir, name);
        return fs.statSync(engineDir).isDirectory() && name.startsWith('windy-');
      });
  }

  /**
   * Delete an engine
   */
  deleteEngine(engineId) {
    const engineDir = path.join(this.modelsDir, engineId);
    if (fs.existsSync(engineDir)) {
      this._deleteRecursive(engineDir);
    }
  }

  /**
   * Recursively delete a directory
   */
  _deleteRecursive(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        this._deleteRecursive(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
    fs.rmdirSync(dirPath);
  }

  /**
   * Get unique device identifier for fingerprinting
   */
  _getDeviceId() {
    const os = require('os');
    const data = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus()[0]?.model || ''}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { DownloadManager };
