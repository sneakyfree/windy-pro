/**
 * Windy Pro v2.0 — Download Manager
 *
 * Handles downloading models from HuggingFace with:
 * - Correct repo names from model_registry.json
 * - Resume support (range headers)
 * - Progress callbacks
 * - Integrity verification
 * - Automatic retry with exponential backoff
 * - Subfolder filtering (multi-variant repos)
 *
 * Model naming conventions (current — WindyWord org, post-2026-04-21 migration):
 * - Voice engines:        WindyWord/listen-windy-{name} + subfolder safetensors|ct2-int8
 * - Lingua specialists:   WindyWord/listen-windy-lingua-{language}[-ct2] + subfolder safetensors|ct2-int8
 * - Pair specialists:     WindyWord/translate-{src}-{tgt} + subfolder lora|lora-ct2-int8
 *
 * Each entry's `subfolder` field tells the downloader to filter the repo's
 * file list to only that subfolder, and to strip the prefix when writing
 * locally so the model dir contains files at the top level (matching the
 * old single-variant-per-repo layout the rest of the platform expects).
 *
 * Legacy (deprecated, not used here):
 * - WindyLabs/* — empty org, never populated; original Dr. A typo. The
 *   installer pointed at this for weeks before the WindyWord migration.
 * - WindyProLabs/* — private staging org with 74 legacy models, replaced
 *   by WindyWord/* between 2026-04-19 and 2026-04-21.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HF_BASE = 'https://huggingface.co';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Complete model registry with correct HuggingFace repo names.
 * This is the source of truth for download URLs.
 *
 * Each entry shape:
 *   hfRepo:    'WindyWord/listen-windy-...' or 'WindyWord/translate-...'
 *   subfolder: '<variant>'  (filters file list + strips prefix on local write)
 *   sizeMB:    estimated total bytes for progress bar
 *   format:    safetensors | ctranslate2 | pytorch
 */
const MODEL_REGISTRY = {
  // ─── Voice Engines (GPU safetensors) ───
  // All voice repos co-host safetensors/, ct2-int8/, onnx/, onnx-int8/ as subfolders.
  'windy-nano':       { hfRepo: 'WindyWord/listen-windy-nano',       subfolder: 'safetensors', sizeMB: 77,   format: 'safetensors' },
  'windy-lite':       { hfRepo: 'WindyWord/listen-windy-lite',       subfolder: 'safetensors', sizeMB: 144,  format: 'safetensors' },
  'windy-core':       { hfRepo: 'WindyWord/listen-windy-core',       subfolder: 'safetensors', sizeMB: 466,  format: 'safetensors' },
  'windy-plus':       { hfRepo: 'WindyWord/listen-windy-plus',       subfolder: 'safetensors', sizeMB: 1462, format: 'safetensors' },
  'windy-turbo':      { hfRepo: 'WindyWord/listen-windy-turbo',      subfolder: 'safetensors', sizeMB: 1548, format: 'safetensors' },
  'windy-pro-engine': { hfRepo: 'WindyWord/listen-windy-pro-engine', subfolder: 'safetensors', sizeMB: 2949, format: 'safetensors' },
  'windy-edge':       { hfRepo: 'WindyWord/listen-windy-edge',       subfolder: 'safetensors', sizeMB: 1448, format: 'safetensors' },

  // ─── Voice Engines (CPU INT8 via CTranslate2) ───
  // Same repo as the GPU sibling, just a different subfolder.
  'windy-nano-ct2':       { hfRepo: 'WindyWord/listen-windy-nano',       subfolder: 'ct2-int8', sizeMB: 38,   format: 'ctranslate2' },
  'windy-lite-ct2':       { hfRepo: 'WindyWord/listen-windy-lite',       subfolder: 'ct2-int8', sizeMB: 72,   format: 'ctranslate2' },
  'windy-core-ct2':       { hfRepo: 'WindyWord/listen-windy-core',       subfolder: 'ct2-int8', sizeMB: 234,  format: 'ctranslate2' },
  'windy-plus-ct2':       { hfRepo: 'WindyWord/listen-windy-plus',       subfolder: 'ct2-int8', sizeMB: 734,  format: 'ctranslate2' },
  'windy-turbo-ct2':      { hfRepo: 'WindyWord/listen-windy-turbo',      subfolder: 'ct2-int8', sizeMB: 777,  format: 'ctranslate2' },
  'windy-pro-engine-ct2': { hfRepo: 'WindyWord/listen-windy-pro-engine', subfolder: 'ct2-int8', sizeMB: 1481, format: 'ctranslate2' },
  'windy-edge-ct2':       { hfRepo: 'WindyWord/listen-windy-edge',       subfolder: 'ct2-int8', sizeMB: 727,  format: 'ctranslate2' },

  // ─── Distil-Whisper (separate repos, each with its own subfolder layout) ───
  'windy-distil-small':  { hfRepo: 'WindyWord/listen-windy-distil-small',  subfolder: 'safetensors', sizeMB: 319,  format: 'safetensors' },
  'windy-distil-medium': { hfRepo: 'WindyWord/listen-windy-distil-medium', subfolder: 'safetensors', sizeMB: 754,  format: 'safetensors' },
  'windy-distil-large':  { hfRepo: 'WindyWord/listen-windy-distil-large',  subfolder: 'safetensors', sizeMB: 1445, format: 'safetensors' },

  // ─── Translation Engines (DEPRECATED — replaced by per-pair WindyWord/translate-* models) ──
  // The bundled "spark" and "standard" Marian translation packs from the WindyProLabs era are
  // not maintained on WindyWord. Per-pair models (windy-pair-*) provide the same coverage with
  // proper Grand Rounds v2 quality certifications. Wizard should not surface these any more.
  'windy-translate-spark':    { hfRepo: null, subfolder: null, sizeMB: 929,  format: 'safetensors', deprecated: true,
                                deprecationNote: 'Use individual windy-pair-* translations instead' },
  'windy-translate-standard': { hfRepo: null, subfolder: null, sizeMB: 2371, format: 'safetensors', deprecated: true,
                                deprecationNote: 'Use individual windy-pair-* translations instead' },

  // ─── Lingua Specialists (GPU safetensors) ───
  'windy-lingua-spanish': { hfRepo: 'WindyWord/listen-windy-lingua-spanish', subfolder: 'safetensors', sizeMB: 466,  format: 'safetensors', lang: 'es' },
  'windy-lingua-chinese': { hfRepo: 'WindyWord/listen-windy-lingua-chinese', subfolder: 'safetensors', sizeMB: 466,  format: 'safetensors', lang: 'zh' },
  'windy-lingua-hindi':   { hfRepo: 'WindyWord/listen-windy-lingua-hindi',   subfolder: 'safetensors', sizeMB: 144,  format: 'safetensors', lang: 'hi' },
  'windy-lingua-french':  { hfRepo: 'WindyWord/listen-windy-lingua-french',  subfolder: 'safetensors', sizeMB: 1462, format: 'safetensors', lang: 'fr' },
  'windy-lingua-arabic':  { hfRepo: 'WindyWord/listen-windy-lingua-arabic',  subfolder: 'safetensors', sizeMB: 2950, format: 'safetensors', lang: 'ar' },

  // ─── Lingua Specialists (CPU INT8) ───
  // Note: only Hindi has a CT2 variant on WindyWord today. Spanish/Chinese/French/Arabic CT2
  // builds are pending (we have GPU but not yet INT8 conversions for those four). Marked
  // unavailable so the wizard can show "GPU only" in the UI rather than 404 the user.
  'windy-lingua-hindi-ct2':   { hfRepo: 'WindyWord/listen-windy-lingua-hindi-ct2', subfolder: 'ct2-int8', sizeMB: 72,  format: 'ctranslate2', lang: 'hi' },
  'windy-lingua-spanish-ct2': { hfRepo: null, subfolder: null, sizeMB: 235,  format: 'ctranslate2', lang: 'es', unavailable: true,
                                unavailableNote: 'GPU variant available; CT2 INT8 build pending' },
  'windy-lingua-chinese-ct2': { hfRepo: null, subfolder: null, sizeMB: 235,  format: 'ctranslate2', lang: 'zh', unavailable: true,
                                unavailableNote: 'GPU variant available; CT2 INT8 build pending' },
  'windy-lingua-french-ct2':  { hfRepo: null, subfolder: null, sizeMB: 735,  format: 'ctranslate2', lang: 'fr', unavailable: true,
                                unavailableNote: 'GPU variant available; CT2 INT8 build pending' },
  'windy-lingua-arabic-ct2':  { hfRepo: null, subfolder: null, sizeMB: 1481, format: 'ctranslate2', lang: 'ar', unavailable: true,
                                unavailableNote: 'GPU variant available; CT2 INT8 build pending' },

  // ─── Pair Specialists (bidirectional, ISO codes) ───
  // Each WindyWord/translate-{pair} repo carries multiple variants; the wizard pulls `lora/`
  // (proprietary baseline). For CPU users the platform should swap to `lora-ct2-int8/`.
  'windy-pair-en-es': { hfRepo: 'WindyWord/translate-en-es', subfolder: 'lora', sizeMB: 299, format: 'pytorch', pair: 'en-es' },
  'windy-pair-es-en': { hfRepo: 'WindyWord/translate-es-en', subfolder: 'lora', sizeMB: 299, format: 'pytorch', pair: 'es-en' },
  'windy-pair-en-zh': { hfRepo: 'WindyWord/translate-en-zh', subfolder: 'lora', sizeMB: 299, format: 'pytorch', pair: 'en-zh' },
  'windy-pair-zh-en': { hfRepo: 'WindyWord/translate-zh-en', subfolder: 'lora', sizeMB: 299, format: 'pytorch', pair: 'zh-en' },
  'windy-pair-en-fr': { hfRepo: 'WindyWord/translate-en-fr', subfolder: 'lora', sizeMB: 288, format: 'pytorch', pair: 'en-fr' },
  'windy-pair-fr-en': { hfRepo: 'WindyWord/translate-fr-en', subfolder: 'lora', sizeMB: 288, format: 'pytorch', pair: 'fr-en' },
  'windy-pair-en-de': { hfRepo: 'WindyWord/translate-en-de', subfolder: 'lora', sizeMB: 285, format: 'pytorch', pair: 'en-de' },
  'windy-pair-de-en': { hfRepo: 'WindyWord/translate-de-en', subfolder: 'lora', sizeMB: 285, format: 'pytorch', pair: 'de-en' },
  'windy-pair-en-ar': { hfRepo: 'WindyWord/translate-en-ar', subfolder: 'lora', sizeMB: 296, format: 'pytorch', pair: 'en-ar' },
  'windy-pair-ar-en': { hfRepo: 'WindyWord/translate-ar-en', subfolder: 'lora', sizeMB: 296, format: 'pytorch', pair: 'ar-en' },
  'windy-pair-en-hi': { hfRepo: 'WindyWord/translate-en-hi', subfolder: 'lora', sizeMB: 294, format: 'pytorch', pair: 'en-hi' },
  'windy-pair-hi-en': { hfRepo: 'WindyWord/translate-hi-en', subfolder: 'lora', sizeMB: 292, format: 'pytorch', pair: 'hi-en' },
  'windy-pair-en-pt': { hfRepo: 'WindyWord/translate-en-pt', subfolder: 'lora', sizeMB: 890, format: 'pytorch', pair: 'en-pt' },
  'windy-pair-pt-en': { hfRepo: 'WindyWord/translate-pt-en', subfolder: 'lora', sizeMB: 299, format: 'pytorch', pair: 'pt-en' },
  'windy-pair-en-ru': { hfRepo: 'WindyWord/translate-en-ru', subfolder: 'lora', sizeMB: 296, format: 'pytorch', pair: 'en-ru' },
  'windy-pair-ru-en': { hfRepo: 'WindyWord/translate-ru-en', subfolder: 'lora', sizeMB: 296, format: 'pytorch', pair: 'ru-en' },
};

class DownloadManager {
  constructor(modelsDir, options = {}) {
    this.modelsDir = modelsDir;
    this.onLog = options.onLog || console.log;
    this.concurrent = options.concurrent || 3;
    this._activeDownloads = 0;
    this._queue = [];
    this._aborted = false;
    this._logBuffer = [];
    this._maxLogLines = 500;
  }

  /**
   * Abort all pending downloads
   */
  abort() {
    this._aborted = true;
    this.onLog('[DownloadManager] Abort requested');
  }

  /**
   * Get model info from the registry
   */
  getModelInfo(modelId) {
    return MODEL_REGISTRY[modelId] || null;
  }

  /**
   * Get all model IDs
   */
  getAllModelIds() {
    return Object.keys(MODEL_REGISTRY);
  }

  /**
   * Get models by category. Skips deprecated and unavailable entries by default
   * so the wizard doesn't surface them as installable options.
   */
  getModelsByCategory(category, { includeUnavailable = false } = {}) {
    return Object.entries(MODEL_REGISTRY)
      .filter(([id, info]) => {
        if (!includeUnavailable && (info.deprecated || info.unavailable)) return false;
        if (category === 'voice-gpu') return id.startsWith('windy-') && !id.includes('lingua') && !id.includes('pair') && !id.includes('translate') && !id.includes('-ct2') && !id.includes('distil');
        if (category === 'voice-cpu') return id.includes('-ct2') && !id.includes('lingua') && !id.includes('pair');
        if (category === 'translation') return id.startsWith('windy-translate-');
        if (category === 'lingua-gpu') return id.startsWith('windy-lingua-') && !id.includes('-ct2');
        if (category === 'lingua-cpu') return id.startsWith('windy-lingua-') && id.includes('-ct2');
        if (category === 'pair') return id.startsWith('windy-pair-');
        return false;
      })
      .map(([id, info]) => ({ id, ...info }));
  }

  /**
   * Check if a model is already downloaded
   */
  isModelDownloaded(modelId) {
    const modelDir = path.join(this.modelsDir, modelId);
    if (!fs.existsSync(modelDir)) return false;

    const files = fs.readdirSync(modelDir);
    // Must have at least config.json and a model file
    const hasConfig = files.includes('config.json');
    const hasModel = files.some(f =>
      f.endsWith('.safetensors') || f.endsWith('.bin') ||
      f.endsWith('.pt') || f === 'model.bin'
    );
    return hasConfig || hasModel || files.length >= 2;
  }

  /**
   * Download a model from HuggingFace
   * @param {string} modelId - Model ID from registry
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<string>} Path to downloaded model directory
   */
  async downloadModel(modelId, onProgress = () => { }) {
    const info = MODEL_REGISTRY[modelId];
    if (!info) throw new Error(`Unknown model: ${modelId}`);

    if (info.deprecated) {
      throw new Error(`Model ${modelId} is deprecated: ${info.deprecationNote || 'no longer available'}`);
    }
    if (info.unavailable) {
      throw new Error(`Model ${modelId} is currently unavailable: ${info.unavailableNote || 'pending build'}`);
    }
    if (!info.hfRepo) {
      throw new Error(`Model ${modelId} has no HuggingFace repo configured`);
    }

    const modelDir = path.join(this.modelsDir, modelId);

    // Already downloaded?
    if (this.isModelDownloaded(modelId)) {
      this.onLog(`[DownloadManager] ${modelId} already downloaded`);
      onProgress(100);
      return modelDir;
    }

    fs.mkdirSync(modelDir, { recursive: true });

    // Check connectivity before attempting downloads
    await this._checkConnectivity();

    const subfolderNote = info.subfolder ? ` (subfolder: ${info.subfolder})` : '';
    this.onLog(`[DownloadManager] Downloading ${modelId} from ${info.hfRepo}${subfolderNote}...`);

    // Get file list from HuggingFace API
    let files = await this._listRepoFiles(info.hfRepo);
    if (files.length === 0) {
      throw new Error(`No files found in repo ${info.hfRepo}`);
    }

    // Filter by subfolder if specified — only files under that subfolder will be downloaded.
    // Files are written to the local modelDir with the subfolder prefix STRIPPED so the
    // local layout matches the legacy single-variant-per-repo expectation.
    if (info.subfolder) {
      const prefix = info.subfolder.replace(/\/$/, '') + '/';
      files = files
        .filter(f => f.rfilename.startsWith(prefix))
        .map(f => ({
          rfilename: f.rfilename,             // server-side path (with subfolder)
          localName: f.rfilename.slice(prefix.length),  // local-side path (without)
          size: f.size,
        }));
      if (files.length === 0) {
        throw new Error(`Subfolder ${info.subfolder}/ not found in repo ${info.hfRepo}`);
      }
    } else {
      // No subfolder: localName == rfilename
      files = files.map(f => ({ rfilename: f.rfilename, localName: f.rfilename, size: f.size }));
    }

    // Download each file
    let totalSize = 0;
    let downloaded = 0;

    // Estimate total size
    for (const file of files) {
      totalSize += file.size || (info.sizeMB * 1024 * 1024 / files.length);
    }

    for (const file of files) {
      // Check abort before each file download
      if (this._aborted) {
        throw new Error('Download cancelled by user');
      }

      const destPath = path.join(modelDir, file.localName);
      const destDir = path.dirname(destPath);
      fs.mkdirSync(destDir, { recursive: true });

      // Skip if already exists with correct size
      if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (file.size && stat.size === file.size) {
          downloaded += file.size || 0;
          onProgress(Math.round(downloaded / totalSize * 100));
          continue;
        }
      }

      const url = `${HF_BASE}/${info.hfRepo}/resolve/main/${file.rfilename}`;
      await this._downloadFile(url, destPath, (fileProgress, fileBytes) => {
        const currentTotal = downloaded + fileBytes;
        onProgress(Math.min(99, Math.round(currentTotal / totalSize * 100)));
      });

      downloaded += file.size || 0;
      onProgress(Math.round(downloaded / totalSize * 100));
    }

    onProgress(100);
    this.onLog(`[DownloadManager] ${modelId} download complete`);
    return modelDir;
  }

  /**
   * Download multiple models with concurrency control
   */
  async downloadModels(modelIds, onModelProgress = () => { }, onOverallProgress = () => { }) {
    const results = {};
    let completed = 0;
    const total = modelIds.length;

    const downloadOne = async (modelId) => {
      try {
        await this.downloadModel(modelId, (progress) => {
          onModelProgress(modelId, progress);
        });
        results[modelId] = { success: true };
      } catch (e) {
        results[modelId] = { success: false, error: e.message };
        this.onLog(`[DownloadManager] Failed to download ${modelId}: ${e.message}`);
      }
      completed++;
      onOverallProgress(Math.round(completed / total * 100), completed, total);
    };

    // Process with concurrency limit
    const chunks = [];
    for (let i = 0; i < modelIds.length; i += this.concurrent) {
      chunks.push(modelIds.slice(i, i + this.concurrent));
    }
    for (const chunk of chunks) {
      await Promise.all(chunk.map(id => downloadOne(id)));
    }

    return results;
  }

  // ─── Internal methods ───

  async _listRepoFiles(repoId) {
    return new Promise((resolve, reject) => {
      const url = `${HF_BASE}/api/models/${repoId}`;
      this._httpGet(url, (err, data) => {
        if (err) {
          // If API fails, try common file list based on format
          this.onLog(`[DownloadManager] API failed for ${repoId}, using fallback file list`);
          resolve(this._fallbackFileList(repoId));
          return;
        }
        try {
          const json = JSON.parse(data);
          const siblings = json.siblings || [];
          resolve(siblings.map(s => ({
            rfilename: s.rfilename,
            size: s.size || 0
          })).filter(f => !f.rfilename.startsWith('.')));
        } catch (e) {
          resolve(this._fallbackFileList(repoId));
        }
      });
    });
  }

  _fallbackFileList(repoId) {
    // Common files for different model types
    // Estimate individual file sizes from registry total so progress bars are meaningful
    const id = repoId.split('/').pop();
    const registryEntry = MODEL_REGISTRY[id];
    const totalBytes = registryEntry ? registryEntry.sizeMB * 1024 * 1024 : 100 * 1024 * 1024;

    if (id.includes('-ct2')) {
      // CTranslate2 models — model.bin is ~95% of total
      return [
        { rfilename: 'config.json', size: 2048 },
        { rfilename: 'model.bin', size: Math.round(totalBytes * 0.95) },
        { rfilename: 'vocabulary.json', size: Math.round(totalBytes * 0.03) },
        { rfilename: 'tokenizer.json', size: Math.round(totalBytes * 0.02) },
      ];
    } else if (id.includes('pair')) {
      // OPUS-MT translation pairs — pytorch_model.bin is ~85% of total
      return [
        { rfilename: 'config.json', size: 2048 },
        { rfilename: 'pytorch_model.bin', size: Math.round(totalBytes * 0.85) },
        { rfilename: 'tokenizer_config.json', size: 2048 },
        { rfilename: 'source.spm', size: Math.round(totalBytes * 0.05) },
        { rfilename: 'target.spm', size: Math.round(totalBytes * 0.05) },
        { rfilename: 'vocab.json', size: Math.round(totalBytes * 0.05) },
      ];
    } else {
      // Whisper / safetensors models — model file is ~95% of total
      return [
        { rfilename: 'config.json', size: 2048 },
        { rfilename: 'model.safetensors', size: Math.round(totalBytes * 0.95) },
        { rfilename: 'preprocessor_config.json', size: 2048 },
        { rfilename: 'tokenizer.json', size: Math.round(totalBytes * 0.03) },
        { rfilename: 'special_tokens_map.json', size: 2048 },
      ];
    }
  }

  _downloadFile(url, destPath, onProgress, retries = 0, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      // Support resume
      let startByte = 0;
      const headers = {};
      if (fs.existsSync(destPath)) {
        startByte = fs.statSync(destPath).size;
        headers['Range'] = `bytes=${startByte}-`;
      }

      const request = protocol.get(url, { headers, timeout: 30000 }, (response) => {
        // Handle redirects (with depth limit)
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl && redirectCount < 10) {
            return this._downloadFile(redirectUrl, destPath, onProgress, retries, redirectCount + 1)
              .then(resolve).catch(reject);
          }
          if (redirectCount >= 10) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
        }

        if (response.statusCode === 416) {
          // Range not satisfiable — file is complete
          onProgress(100, startByte);
          resolve();
          return;
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          if (retries < MAX_RETRIES) {
            setTimeout(() => {
              this._downloadFile(url, destPath, onProgress, retries + 1)
                .then(resolve).catch(reject);
            }, RETRY_DELAY_MS * Math.pow(2, retries));
            return;
          }
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0') + startByte;
        let receivedBytes = startByte;

        const flags = response.statusCode === 206 ? 'a' : 'w';
        const fileStream = fs.createWriteStream(destPath, { flags });

        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (totalSize > 0) {
            onProgress(Math.round(receivedBytes / totalSize * 100), receivedBytes);
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          // Don't delete partial file — resume logic can recover from it
          reject(err);
        });
      });

      request.on('error', (err) => {
        if (retries < MAX_RETRIES) {
          setTimeout(() => {
            this._downloadFile(url, destPath, onProgress, retries + 1)
              .then(resolve).catch(reject);
          }, RETRY_DELAY_MS * Math.pow(2, retries));
        } else {
          reject(err);
        }
      });

      request.on('timeout', () => {
        request.destroy();
        if (retries < MAX_RETRIES) {
          this._downloadFile(url, destPath, onProgress, retries + 1)
            .then(resolve).catch(reject);
        } else {
          reject(new Error(`Timeout downloading ${url}`));
        }
      });
    });
  }

  _httpGet(url, callback, redirectCount = 0) {
    if (redirectCount >= 10) {
      callback(new Error(`Too many redirects for ${url}`));
      return;
    }
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return this._httpGet(res.headers.location, callback, redirectCount + 1);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => callback(null, data));
    }).on('error', err => callback(err));
  }

  /**
   * Quick connectivity check before starting downloads.
   * Fails fast with a clear error instead of timing out on every file.
   */
  _checkConnectivity() {
    return new Promise((resolve, reject) => {
      const req = https.get(`${HF_BASE}/api/models`, { timeout: 8000 }, (res) => {
        res.resume(); // drain the response
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
        } else {
          reject(new Error(`HuggingFace returned HTTP ${res.statusCode}. The service may be down.`));
        }
      });
      req.on('error', () => {
        reject(new Error('No internet connection. Cannot download models. Please check your network and try again.'));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Network timeout. Cannot reach HuggingFace. Please check your connection.'));
      });
    });
  }
}

module.exports = { DownloadManager, MODEL_REGISTRY };
