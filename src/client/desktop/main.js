// ═══ Startup Performance Timing ═══
const _perfStart = process.hrtime.bigint();
function _perfMark(label) { const ms = Number(process.hrtime.bigint() - _perfStart) / 1e6; console.log(`[Perf] ${label}: ${ms.toFixed(0)}ms`); }

// Prevent EPIPE crashes when stdout/stderr pipe breaks
process.stdout?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

// Global crash handler — log to ~/Library/Logs/WindyPro/ (macOS) or ~/.config/windy-pro/ (others)
const _fs = require('fs');
const _path = require('path');
const _os = require('os');
const crashLogDir = process.platform === 'darwin'
  ? _path.join(_os.homedir(), 'Library', 'Logs', 'WindyPro')
  : process.platform === 'win32'
    ? _path.join(_os.homedir(), 'AppData', 'Local', 'WindyPro', 'Logs')
    : _path.join(_os.homedir(), '.config', 'windy-pro');
const crashLogPath = _path.join(crashLogDir, 'crash.log');

// CR-006 (P15): allow-list redaction. The previous deny-list missed
// anything other than Bearer/sk-/key_. Inverted: extract only known-
// safe fields (message, code, name, top-N stack frames) and drop
// everything else on the error object. Implementation in
// src/client/desktop/lib/crash-summary.js (unit tested).
const { safeErrorSummary: _safeErrorSummary } = require('./lib/crash-summary');

function writeCrashLog(type, err) {
  try {
    const dir = _path.dirname(crashLogPath);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      type,
      ..._safeErrorSummary(err),
    }) + '\n';
    _fs.appendFileSync(crashLogPath, entry);
  } catch (_) { }
}

process.on('uncaughtException', (err) => {
  writeCrashLog('UncaughtException', err);
  // CR-002: route the visible strings through safeErrorSummary so
  // the console output + the user-facing dialog never show any
  // attached fields (axios .response, etc.) — only the allow-listed
  // name / message / code. Stack stays in the JSON crash log only.
  const _summary = _safeErrorSummary(err);
  console.error('[CRASH]', _summary.message || _summary.name || '(no details)');

  // EPIPE / ECONNRESET from dead child processes (Python server) — handle gracefully
  if (['EPIPE', 'ECONNRESET', 'ECONNREFUSED'].includes(_summary.code)) {
    console.warn('[CRASH] Pipe/connection error (child process likely died) — recovering gracefully');
    return; // Don't show crash dialog for pipe errors
  }

  // Show friendly dialog on macOS (non-blocking)
  try {
    const { dialog } = require('electron');
    if (require('electron').app.isReady()) {
      dialog.showErrorBox(
        'Windy Word encountered an error',
        `Something went wrong. The error has been logged.\n\nDetails: ${_summary.message || '(no details)'}\n\nLog: ${crashLogPath}`
      );
    }
  } catch (_) { /* dialog may not be available yet */ }
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('UnhandledRejection', reason);
  // CR-002: avoid String(reason) which would call the object's
  // toString — for most Errors that's safe (name + message) but
  // a library could override toString to emit arbitrary fields.
  // Use the crash-summary helper so the console fallback matches
  // the redaction the crash log applies.
  const _sum = _safeErrorSummary(reason);
  console.error('[REJECTION]', _sum.message || _sum.name || '(no details)');
});
/**
 * Windy Word - Electron Main Process
 * 
 * Creates a floating, always-on-top window with:
 * - System tray integration
 * - Global hotkeys
 * - WebSocket connection to Python backend
 * 
 * DNA Strand: B1.1
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, dialog, Notification, shell, session, nativeTheme, safeStorage } = require('electron');

// SEC-10: --no-sandbox required for Linux AppImage (chrome-sandbox SUID issue).
// Without this, the app won't launch from AppImage on most Linux distros.
// This is a known Electron limitation: https://github.com/electron/electron/issues/17972
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

// WAYLAND FIX: Force XWayland on Wayland sessions so that:
//   1) globalShortcut.register() actually works (Wayland blocks global key grabs)
//   2) xdotool works for paste simulation (operates on XWayland windows)
//   3) Shortcut rebinding UI can capture keydown events properly
// This must run before app.whenReady() — Chromium reads ozone-platform early.
const PLATFORM = require('./platform-detect');
if (PLATFORM.isWayland) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  console.info('[Wayland] Forced --ozone-platform=x11 for global shortcut + xdotool support');
}

// SEC-06: URL validation helper — only allow safe protocols for shell.openExternal
function isSafeURL(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol);
  } catch { return false; }
}
// Enable Web Speech API support
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
const path = require('path');
const Store = require('electron-store');
const { spawn, exec, execFile, execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const util = require('util');
// CR-003: withTimeout for IPC handlers — bounds long-running awaits
// so a hung upstream (Matrix, translate API, HF download) can't
// leave the renderer waiting forever on an IPC reply.
const { withTimeout } = require('./lib/timeout');
const pasteStrategies = require('./strategies/paste-strategies');
const installer = require('./install/installer');
const settingsCatalog = require('./settings/catalog');
const doctor = require('./doctor/diagnose');
const execFileAsync = util.promisify(execFile);
// ═══ Lazy-loaded modules (deferred to speed up startup) ═══
// These modules pull in heavy deps (matrix-js-sdk, stripe, better-sqlite3, electron-updater)
// so we load them only on first use instead of blocking startup.
let _injectorInstance = null;
function getInjector() {
  if (!_injectorInstance) {
    const { CursorInjector } = require('./injection/injector');
    _injectorInstance = new CursorInjector();
  }
  return _injectorInstance;
}
// WindyUpdater, WindyChatClient, ChatTranslator — lazy-loaded in their getter functions below

_perfMark('Module load');

// Safe IPC send — guards against disposed render frames
function safeSend(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Persistent settings storage
const store = new Store({
  defaults: {
    hotkeys: {
      toggleRecording: 'CommandOrControl+Shift+Space',
      pasteTranscript: 'CommandOrControl+Shift+V',
      pasteClipboard: 'CommandOrControl+Shift+B',
      showHide: 'CommandOrControl+Shift+W',
      quickTranslate: 'CommandOrControl+Shift+T'
    },
    window: {
      width: 400,
      height: 500,
      x: null,
      y: null
    },
    server: {
      host: '127.0.0.1',
      port: 9876
    },
    appearance: {
      alwaysOnTop: true,
      opacity: 1.0
    },
    // Paste strategy registry — see src/client/desktop/strategies/paste-strategies.js
    // 'auto' = run defaultFallbackChain() in priority order; specific name = use that strategy only
    // fallbackChain: ordered list of strategy names to try if active fails (empty = use defaults)
    paste: {
      strategy: 'auto',
      fallbackChain: []
    },
    engine: {
      model: 'base',
      saveVideo: false,
      clearOnPaste: false,
      livePreview: true,
      autoArchive: true,
      archiveLocalEnabled: true,
      archiveMode: 'both',
      archiveRouteToday: 'local',
      archiveFolder: path.join(os.homedir(), 'Documents', 'WindyProArchive')
    },
    license: {
      tier: 'free',
      email: '',
      stripeSessionId: '',
      purchasedAt: '',
      expiresAt: null
    },
    wizard: {
      completed: false,
      currentStep: 0,
      completedSteps: []
    }
  }
});

let mainWindow = null;
let miniWindow = null;
let miniTranslateWindow = null;
let chatWindow = null;
let tray = null;
let isRecording = false;
global._batchProcessing = false;  // Guards focus tracker during async batch transcription
global._ourPids = new Set([process.pid]); // Our Electron process tree (main + helpers)
let userHiddenWindow = false;  // Tracks if user intentionally hid everything via Ctrl+Shift+W
let pythonProcess = null;
let pythonRestartCount = 0;
const MAX_PYTHON_RESTARTS = 3;
// Startup watchdog: if the engine never signals ready (hangs) or keeps crashing, surface
// a clear, actionable error to non-technical users instead of a frozen UI / silent fail.
let pythonReady = false;
let pythonStartupTimer = null;
let engineFailureShown = false;
const PYTHON_STARTUP_TIMEOUT_MS = 120000; // generous: the 1.5GB engine loads ~30s on old CPUs

// One-time, user-facing "engine couldn't start" dialog with Retry / Quit. Covers every
// failure mode uniformly: missing venv, model-load failure, hung startup, repeated crashes.
function showEngineFailure(detail) {
  if (engineFailureShown) return;
  engineFailureShown = true;
  try { safeSend('python-loading', false); safeSend('state-change', 'error'); } catch (_) { /* window may be gone */ }
  try {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Windy Word — Speech Engine',
      message: "Windy Word's speech engine couldn't start.",
      detail: (detail ? detail + '\n\n' : '') + 'This is usually a disk-space or first-run setup issue. You can retry, or quit and reopen the app.',
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      engineFailureShown = false;
      pythonReady = false;
      pythonRestartCount = 0;
      // Self-heal: if the engine venv is missing/broken, rebuild it rather than just
      // re-spawning against it (which would fail again). ensureEngineVenv() scrubs a
      // broken venv, rebuilds from bundled wheels, and starts the server itself when
      // ready; it returns false (start now) when the venv is already good or absent.
      const appDataDir = path.join(os.homedir(), '.windy-pro');
      if (!ensureEngineVenv(appDataDir)) startPythonServer();
    } else {
      app.isQuitting = true;
      app.quit();
    }
  } catch (e) {
    console.error('[Python] showEngineFailure dialog error:', e.message);
  }
}

// ═══ Model Download Manifest ═══
const MODEL_MANIFEST = {
  models: {
    // GPU voice models
    'windy-nano': { size: '73MB', bytes: 73 * 1024 * 1024, label: 'Windy Nano', desc: 'Fastest GPU, great for dictation' },
    'windy-lite': { size: '140MB', bytes: 140 * 1024 * 1024, label: 'Windy Lite', desc: 'Lightweight, balanced speed/quality' },
    'windy-core': { size: '462MB', bytes: 462 * 1024 * 1024, label: 'Windy Core', desc: 'Recommended for most use cases' },
    'windy-edge': { size: '1444MB', bytes: 1444 * 1024 * 1024, label: 'Windy Edge', desc: 'High-accuracy, professional grade' },
    'windy-plus': { size: '1458MB', bytes: 1458 * 1024 * 1024, label: 'Windy Plus', desc: 'Premium accuracy, production-grade' },
    'windy-turbo': { size: '1544MB', bytes: 1544 * 1024 * 1024, label: 'Windy Turbo', desc: 'Latest-gen, state-of-the-art' },
    'windy-pro-engine': { size: '2945MB', bytes: 2945 * 1024 * 1024, label: 'Windy Word Engine', desc: 'Ultra-fast large model, maximum speed' },
    // CPU voice models
    'windy-nano-cpu': { size: '406MB', bytes: 406 * 1024 * 1024, label: 'Windy Nano (CPU)', desc: 'CPU-optimized, resource-constrained' },
    'windy-lite-cpu': { size: '668MB', bytes: 668 * 1024 * 1024, label: 'Windy Lite (CPU)', desc: 'CPU-optimized, good balance' },
    'windy-core-cpu': { size: '1760MB', bytes: 1760 * 1024 * 1024, label: 'Windy Core (CPU)', desc: 'CPU-optimized, recommended for CPU' },
    'windy-edge-cpu': { size: '3824MB', bytes: 3824 * 1024 * 1024, label: 'Windy Edge (CPU)', desc: 'CPU-optimized, high accuracy' },
    'windy-plus-cpu': { size: '4872MB', bytes: 4872 * 1024 * 1024, label: 'Windy Plus (CPU)', desc: 'CPU-optimized, premium accuracy' },
    'windy-turbo-cpu': { size: '4200MB', bytes: 4200 * 1024 * 1024, label: 'Windy Turbo (CPU)', desc: 'CPU-optimized, state-of-the-art' },
    'windy-pro-engine-cpu': { size: '9456MB', bytes: 9456 * 1024 * 1024, label: 'Windy Word Engine (CPU)', desc: 'CPU-optimized, maximum performance' },
    // Translation models
    'windy-translate-spark': { size: '929MB', bytes: 929 * 1024 * 1024, label: 'Windy Translate Spark', desc: 'Fast multilingual, 100+ languages' },
    'windy-translate-standard': { size: '2371MB', bytes: 2371 * 1024 * 1024, label: 'Windy Translate Standard', desc: 'Higher quality than Spark, 100+ languages' }
  },
  tierModels: {
    free: ['windy-nano', 'windy-lite', 'windy-core'],
    pro: ['windy-nano', 'windy-lite', 'windy-core', 'windy-edge', 'windy-plus', 'windy-turbo', 'windy-pro-engine', 'windy-nano-cpu', 'windy-lite-cpu', 'windy-core-cpu', 'windy-edge-cpu', 'windy-plus-cpu', 'windy-turbo-cpu', 'windy-pro-engine-cpu'],
    translate: ['windy-nano', 'windy-lite', 'windy-core', 'windy-edge', 'windy-plus', 'windy-turbo', 'windy-pro-engine', 'windy-nano-cpu', 'windy-lite-cpu', 'windy-core-cpu', 'windy-edge-cpu', 'windy-plus-cpu', 'windy-turbo-cpu', 'windy-pro-engine-cpu', 'windy-translate-spark'],
    translate_pro: ['windy-nano', 'windy-lite', 'windy-core', 'windy-edge', 'windy-plus', 'windy-turbo', 'windy-pro-engine', 'windy-nano-cpu', 'windy-lite-cpu', 'windy-core-cpu', 'windy-edge-cpu', 'windy-plus-cpu', 'windy-turbo-cpu', 'windy-pro-engine-cpu', 'windy-translate-spark', 'windy-translate-standard']
  }
};
let activeModelDownload = null; // Track background download process

// ═══ Stripe Payment Integration ═══
// Bootstrap: load .env file if present and persist Stripe keys to electron-store
(function bootstrapStripeKeys() {
  try {
    const fs = require('fs');
    const p = require('path');
    // Try multiple locations for .env: project root (dev), app dir (prod)
    const candidates = [p.join(__dirname, '..', '..', '..', '.env'), p.join(p.dirname(process.execPath), '.env')];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
          const m = line.match(/^(STRIPE_\w+)=(.+)$/);
          if (m) {
            process.env[m[1]] = m[2].trim();
            // SEC-02: Persist Stripe key encrypted with safeStorage (not plaintext)
            if (m[1] === 'STRIPE_SECRET_KEY') {
              if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(m[2].trim());
                store.set('stripe.secretKeyEncrypted', encrypted.toString('base64'));
              }
              store.delete('stripe.secretKey'); // Remove any old plaintext key
            }
          }
        }
        break;
      }
    }
  } catch (_) { }
})();
// SEC-02: Secret key: env var → encrypted store → empty
let STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
if (!STRIPE_SECRET_KEY) {
  try {
    const encB64 = store.get('stripe.secretKeyEncrypted', '');
    if (encB64 && safeStorage.isEncryptionAvailable()) {
      STRIPE_SECRET_KEY = safeStorage.decryptString(Buffer.from(encB64, 'base64'));
    }
  } catch (_) { }
}
const STRIPE_PRICES = {
  // Monthly subscriptions
  pro_monthly: { id: 'price_1T60GeBXIOBasDQi4aitcq8O', mode: 'subscription', tier: 'pro', amount: 499, billing: 'monthly' },
  translate_monthly: { id: 'price_1T5oZJBXIOBasDQijBW23Gow', mode: 'subscription', tier: 'translate', amount: 899, billing: 'monthly' },
  translate_pro_monthly: { id: 'price_1T60H8BXIOBasDQiy5eorTWR', mode: 'subscription', tier: 'translate_pro', amount: 1499, billing: 'monthly' },
  // Annual subscriptions
  pro_annual: { id: 'price_1T5oYzBXIOBasDQibSlnIsPg', mode: 'subscription', tier: 'pro', amount: 4900, billing: 'annual' },
  translate_annual: { id: 'price_1T5oZJBXIOBasDQiHO0MtYS7', mode: 'subscription', tier: 'translate', amount: 7900, billing: 'annual' },
  translate_pro_annual: { id: 'price_1T5oZ1BXIOBasDQinrz3VdvG', mode: 'subscription', tier: 'translate_pro', amount: 14900, billing: 'annual' },
  // Lifetime (one-time payment)
  pro_lifetime: { id: 'price_1T5oYzBXIOBasDQibSlnIsPg_life', mode: 'payment', tier: 'pro', amount: 9900, billing: 'lifetime' },
  translate_lifetime: { id: 'price_1T5oZJBXIOBasDQiHO0MtYS7_life', mode: 'payment', tier: 'translate', amount: 19900, billing: 'lifetime' },
  translate_pro_lifetime: { id: 'price_1T5oZ1BXIOBasDQinrz3VdvG_life', mode: 'payment', tier: 'translate_pro', amount: 29900, billing: 'lifetime' }
};

let stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    if (!STRIPE_SECRET_KEY) {
      console.warn('[Stripe] No secret key configured. Set STRIPE_SECRET_KEY env var or stripe.secretKey in settings.');
      return null;
    }
    const Stripe = require('stripe');
    stripeClient = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function getTierLimits(tier) {
  const tiers = {
    free: { maxEngines: 3, maxLanguages: 1, maxMinutes: 5, storageMb: 500, batchMode: true, llmPolish: false, translation: false, tts: false, glossaries: false },
    pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: 30, storageMb: 5120, batchMode: true, llmPolish: true, translation: false, tts: false, glossaries: false },
    translate: { maxEngines: 15, maxLanguages: 99, maxMinutes: 60, storageMb: 10240, batchMode: true, llmPolish: true, translation: true, tts: false, glossaries: false },
    translate_pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: Infinity, storageMb: 25600, batchMode: true, llmPolish: true, translation: true, tts: true, glossaries: true }
  };
  return tiers[tier] || tiers.free;
}

function getArchiveFolder() {
  return store.get('engine.archiveFolder') || path.join(os.homedir(), 'Documents', 'WindyProArchive');
}

/**
 * Auto-cleanup: delete local audio/video files older than 7 days.
 * Keeps all .md transcript files forever (text is tiny).
 * Runs once on app startup.
 */
function autoCleanupArchive() {
  const RETENTION_DAYS = store.get('engine.archiveRetentionDays', 7);
  const archiveDir = getArchiveFolder();
  if (!fs.existsSync(archiveDir)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  let purgedCount = 0;
  let purgedBytes = 0;

  try {
    const dateDirs = fs.readdirSync(archiveDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const dateDir of dateDirs) {
      if (dateDir >= cutoffStr) continue; // Keep recent days

      const dirPath = path.join(archiveDir, dateDir);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.webm') || file.endsWith('.wav') || file.endsWith('.mp3')) {
          const filePath = path.join(dirPath, file);
          try {
            const stat = fs.statSync(filePath);
            purgedBytes += stat.size;
            fs.unlinkSync(filePath);
            purgedCount++;
          } catch (e) { /* skip locked files */ }
        }
      }

      // Remove empty date directories
      const remaining = fs.readdirSync(dirPath);
      if (remaining.length === 0) {
        try { fs.rmdirSync(dirPath); } catch (e) { /* ok */ }
      }
    }

    if (purgedCount > 0) {
      const mb = (purgedBytes / 1024 / 1024).toFixed(1);
      console.info(`🗂️ Archive cleanup: purged ${purgedCount} media files (${mb} MB), kept transcripts. Retention: ${RETENTION_DAYS} days.`);
    }
  } catch (err) {
    console.warn('[Archive] Cleanup error:', err.message);
  }
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[ensureDir] Failed to create directory:', dir, err.message);
    throw err; // Re-throw so callers (inside try/catch) can handle it
  }
}

// ═══ Archive Retry Queue ═══
// When archive writes fail (disk full, folder unavailable), queue for retry instead of losing data
const _archiveRetryQueue = [];
const MAX_ARCHIVE_RETRIES = 3;
const ARCHIVE_RETRY_INTERVAL_MS = 30000; // 30 seconds

let _archiveRetryTimer = null;
function _startArchiveRetryTimer() {
  if (_archiveRetryTimer) return;
  _archiveRetryTimer = setInterval(() => {
    if (_archiveRetryQueue.length === 0) {
      clearInterval(_archiveRetryTimer);
      _archiveRetryTimer = null;
      return;
    }
    const pending = [..._archiveRetryQueue];
    _archiveRetryQueue.length = 0;
    for (const item of pending) {
      const result = appendArchiveEntry(item.entry, true);
      if (!result.archived && item.retries < MAX_ARCHIVE_RETRIES) {
        _archiveRetryQueue.push({ entry: item.entry, retries: item.retries + 1 });
        console.warn(`[Archive] Retry ${item.retries + 1}/${MAX_ARCHIVE_RETRIES} queued for entry at ${item.entry.startedAt}`);
      } else if (!result.archived) {
        console.error(`[Archive] Permanently failed after ${MAX_ARCHIVE_RETRIES} retries:`, item.entry.startedAt);
      }
    }
  }, ARCHIVE_RETRY_INTERVAL_MS);
}

function appendArchiveEntry({ text, startedAt, endedAt }, isRetry = false) {
  const engine = store.get('engine', {});
  if (!store.get('engine.autoArchive', true) || !store.get('engine.archiveLocalEnabled', true) || !text || !text.trim()) return { archived: false };

  try {
    const archiveRoot = getArchiveFolder();
    ensureDir(archiveRoot);

    const start = startedAt ? new Date(startedAt) : new Date();
    const end = endedAt ? new Date(endedAt) : new Date();
    const yyyy = String(start.getFullYear());
    const mm = String(start.getMonth() + 1).padStart(2, '0');
    const dd = String(start.getDate()).padStart(2, '0');
    const HH = String(start.getHours()).padStart(2, '0');
    const MM = String(start.getMinutes()).padStart(2, '0');
    const SS = String(start.getSeconds()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const timeKey = `${HH}${MM}${SS}`;

    const dayDir = path.join(archiveRoot, dateKey);
    ensureDir(dayDir);

    const safeText = text.trim();
    const mode = engine.archiveMode || 'both';
    // Record the app that had focus (future-proofs per-app insights — "you dictate most
    // into VS Code"). Strip newlines and '|' so it can't break the daily-aggregate format.
    const appName = String(global._lastFocusedApp || 'unknown').replace(/[\r\n|]/g, ' ').slice(0, 80);
    const meta = `Start: ${start.toISOString()}\nEnd: ${end.toISOString()}\nWords: ${safeText.split(/\s+/).filter(Boolean).length}\nApp: ${appName}`;

    const wrote = [];

    if (mode === 'chunk' || mode === 'both') {
      const chunkPath = path.join(dayDir, `${timeKey}.md`);
      const chunk = `# Windy Word Dictation\n\n${meta}\n\n---\n\n${safeText}\n`;
      fs.writeFileSync(chunkPath, chunk, 'utf-8');
      wrote.push(chunkPath);
    }

    if (mode === 'daily' || mode === 'both') {
      const dailyPath = path.join(dayDir, `${dateKey}.md`);
      const block = `\n## ${HH}:${MM}:${SS}\n\n${meta.replace(/\n/g, ' | ')}\n\n${safeText}\n`;
      fs.appendFileSync(dailyPath, block, 'utf-8');
      wrote.push(dailyPath);
    }

    return { archived: true, files: wrote };
  } catch (err) {
    console.error('[appendArchiveEntry] Archive I/O error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      safeSend('archive-error', { error: err.message, queued: !isRetry });
    }
    // Queue for retry if this is the first attempt
    if (!isRetry) {
      _archiveRetryQueue.push({ entry: { text, startedAt, endedAt }, retries: 0 });
      _startArchiveRetryTimer();
      console.warn('[Archive] Entry queued for retry. Queue size:', _archiveRetryQueue.length);
    }
    return { archived: false, error: err.message };
  }
}

/**
 * First-run (book-launch bypass): build the offline engine venv from bundled wheels.
 *
 * The installer-v2 wizard normally creates ~/.windy-pro/venv and pip-installs the
 * bundled wheels into it — the engine server imports faster_whisper/websockets/etc.,
 * which are NOT present in the read-only bundled Python inside the .app. The
 * book-launch fast path skips the wizard, so we replicate just that one step here.
 *
 * Fully offline (`pip install --no-index --find-links <bundled/wheels>`), arch-native
 * (runs the user's own matching bundled Python — no cross-arch issue), and first-run
 * only: the venv persists, so later launches are instant. Runs ASYNC so the window +
 * welcome panel paint immediately; startPythonServer() is deferred and invoked when the
 * venv is ready (or, on failure, as a best-effort fallback to bundled/system Python).
 *
 * Returns true if a build was started (caller should defer startPythonServer); false if
 * the venv already exists or required assets are missing (caller should start now).
 */
// Written into the venv ONLY after it is built, pip-installed, AND proven to import the
// engine deps. Its presence is the single source of truth for "this venv is usable" —
// used by both ensureEngineVenv() and startPythonServer(). A venv with bin/python but no
// marker is a half-built/interrupted first run and must be rebuilt, never trusted.
const ENGINE_VENV_READY_MARKER = '.windy-engine-ready';

function ensureEngineVenv(appDataDir) {
  try {
    const venvDir = path.join(appDataDir, 'venv');
    const venvPy = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
    const readyMarker = path.join(venvDir, ENGINE_VENV_READY_MARKER);

    // Complete iff the interpreter exists AND we previously proved it can run the engine.
    if (fs.existsSync(venvPy) && fs.existsSync(readyMarker)) return false; // normal start handles it

    // A venv dir with no ready-marker is an interrupted/slow first-run build (bin/python
    // was created, but pip never finished) or a pre-marker build. Either way it is unsafe
    // to trust — remove it so the build below starts clean and can't be "adopted" as done.
    // This is the core of the anti-brick fix: without it, config.json is written before the
    // async build finishes and needsSetup() only checks config.json, so an interrupted first
    // run would leave a permanently broken venv that even reinstalling the app can't fix
    // (the venv lives in ~/.windy-pro, outside the .app).
    if (fs.existsSync(venvDir)) {
      console.warn('[Python] engine venv present but not marked ready (interrupted/old setup) — rebuilding clean');
      try { fs.rmSync(venvDir, { recursive: true, force: true }); }
      catch (e) { console.error('[Python] could not remove incomplete venv:', e.message); }
    }

    const bundledRoot = process.resourcesPath ? path.join(process.resourcesPath, 'bundled') : null;
    if (!bundledRoot) return false;
    // Universal (multi-arch) bundles stage per-arch native payloads as
    // `python-<arch>` / `wheels-<arch>` next to the shared model/. Single-arch
    // bundles ship the plain `python` / `wheels`. Resolve the arch match first
    // and fall back to the flat legacy layout (mirrors startPythonServer +
    // installer-v2/core/bundled-assets.js#_archDir).
    const archDir = (name) => {
      const suffixed = path.join(bundledRoot, `${name}-${process.arch}`);
      return fs.existsSync(suffixed) ? suffixed : path.join(bundledRoot, name);
    };
    const bundledPyRoot = archDir('python');
    const bundledPy = process.platform === 'win32'
      ? path.join(bundledPyRoot, 'python.exe')
      : path.join(bundledPyRoot, 'bin', 'python3');
    const wheelsDir = archDir('wheels');
    const reqFile = path.join(bundledRoot, 'requirements-bundle.txt');
    if (!fs.existsSync(bundledPy) || !fs.existsSync(wheelsDir) || !fs.existsSync(reqFile)) return false;

    console.info('[Python] First run: building offline engine venv from bundled wheels…');
    const { execFile } = require('child_process');
    // Any failure below removes the half-built venv so the NEXT launch retries cleanly
    // instead of adopting a broken venv forever (the original brick).
    const scrubVenv = () => { try { fs.rmSync(venvDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } };
    const startServer = () => {
      try { pythonRestartCount = 0; startPythonServer(); }
      catch (e) { console.error('[Python] start after venv failed:', e.message); }
    };
    execFile(bundledPy, ['-m', 'venv', venvDir], { timeout: 120000 }, (e1) => {
      if (e1) { console.error('[Python] venv create failed — falling back:', e1.message); scrubVenv(); startServer(); return; }
      // Supply-chain: verify bundled wheels against the build-time checksum manifest before
      // installing. Fail-closed on mismatch (possible tampering); skip if no manifest so a
      // build without one can never be bricked by this check.
      try {
        const manifest = path.join(wheelsDir, 'CHECKSUMS.sha256');
        if (fs.existsSync(manifest)) {
          const crypto = require('crypto');
          let n = 0;
          for (const line of fs.readFileSync(manifest, 'utf-8').split('\n')) {
            const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
            if (!m) continue;
            const wp = path.join(wheelsDir, path.basename(m[2]));
            if (!fs.existsSync(wp)) continue;
            const actual = crypto.createHash('sha256').update(fs.readFileSync(wp)).digest('hex');
            if (actual.toLowerCase() !== m[1].toLowerCase()) {
              console.error('[Python] Wheel checksum MISMATCH:', m[2], '— refusing to install (possible tampering)');
              scrubVenv();
              showEngineFailure('A bundled component failed its integrity check.');
              return;
            }
            n++;
          }
          console.info('[Python] ✓ wheel checksums verified (' + n + ')');
        }
      } catch (ve) { console.warn('[Python] wheel checksum verify skipped:', ve.message); }
      // Generous timeout: this is an offline `--no-index` local-wheel install, so it is
      // disk-bound, not network-bound; slow HDDs on launch-day consumer machines can take
      // several minutes. The old 5-min cap could fire mid-install and brick the venv.
      execFile(venvPy, ['-m', 'pip', 'install', '--no-index', '--no-cache-dir', '--find-links', wheelsDir, '-r', reqFile],
        { timeout: 900000, maxBuffer: 64 * 1024 * 1024 }, (e2) => {
          if (e2) {
            console.error('[Python] venv pip install failed — scrubbing so next launch retries:', e2.message);
            scrubVenv();
            startServer();
            return;
          }
          // pip can exit 0 yet leave an unusable venv (a bad/partial wheel). Prove the venv
          // can actually import the engine deps BEFORE marking it ready — the marker is what
          // every later launch and startPythonServer() trust. Async so the event loop is
          // never blocked. On failure, scrub so the next launch rebuilds cleanly.
          execFile(venvPy, ['-c', 'import faster_whisper, websockets'], { timeout: 60000 }, (e3) => {
            if (e3 || !fs.existsSync(venvPy)) {
              console.error('[Python] venv built but engine deps not importable — scrubbing so next launch retries:', e3 ? e3.message : 'venv python missing');
              scrubVenv();
              startServer();
              return;
            }
            try { fs.writeFileSync(readyMarker, `${app.getVersion()} ${new Date().toISOString()}\n`); }
            catch (me) { console.warn('[Python] could not write venv ready marker:', me.message); }
            console.info('[Python] ✓ engine venv ready (verified)');
            startServer();
          });
        });
    });
    return true;
  } catch (e) {
    console.error('[Python] ensureEngineVenv error:', e.message);
    return false;
  }
}

/**
 * Start the Python WebSocket server as a child process
 */
function startPythonServer() {
  const serverConfig = store.get('server');
  const appDataDir = path.join(os.homedir(), '.windy-pro');

  // Resolution order (matches the bundle-don't-install architecture):
  //   1. User-data venv (~/.windy-pro/venv) — created at first-run by wizard
  //      from bundled wheels. Preferred because it's writable for future deps.
  //   2. Packaged bundled Python (process.resourcesPath/bundled/python) —
  //      safety net: if wizard didn't run yet (or failed), the engine can still
  //      boot using bundled Python directly, no system Python needed.
  //   3. System python3 — last-resort fallback for dev environments.
  const userVenvPython = process.platform === 'win32'
    ? path.join(appDataDir, 'venv', 'Scripts', 'python.exe')
    : path.join(appDataDir, 'venv', 'bin', 'python');
  // Universal (multi-arch) builds ship the runtime as `python-<arch>`; single-arch
  // builds ship plain `python`. Prefer the arch match, fall back to legacy.
  const bundledPythonRoot = process.resourcesPath
    ? (fs.existsSync(path.join(process.resourcesPath, 'bundled', `python-${process.arch}`))
        ? path.join(process.resourcesPath, 'bundled', `python-${process.arch}`)
        : path.join(process.resourcesPath, 'bundled', 'python'))
    : null;
  const bundledPython = bundledPythonRoot
    ? (process.platform === 'win32'
        ? path.join(bundledPythonRoot, 'python.exe')
        : path.join(bundledPythonRoot, 'bin', 'python3'))
    : null;

  let pythonPath;
  // Prefer the user venv ONLY if ensureEngineVenv() marked it ready. A marker-less venv is
  // a half-built/interrupted first run; using it here would shadow bundled Python and fail
  // every transcription. ensureEngineVenv() rebuilds such a venv — until then, use bundled.
  const userVenvReady = fs.existsSync(path.join(appDataDir, 'venv', ENGINE_VENV_READY_MARKER));
  if (fs.existsSync(userVenvPython) && userVenvReady) {
    pythonPath = userVenvPython;
  } else if (bundledPython && fs.existsSync(bundledPython)) {
    pythonPath = bundledPython;
    console.info('[Python] Using bundled Python (engine venv not present/ready)');
  } else {
    pythonPath = 'python3';
    console.warn('[Python] Falling back to system python3 — bundled assets not detected');
  }
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', '..');
  const serverModule = app.isPackaged ? 'engine.server' : 'src.engine.server';

  console.info(`[Python] Starting server with: ${pythonPath}`);
  console.info(`[Python] cwd: ${projectRoot}, module: ${serverModule}`);

  // Kill any stale process on the server port before spawning
  const port = serverConfig.port || 9876;
  try {
    if (process.platform === 'win32') {
      // SEC-M10: Validate port is a safe integer before interpolation
      const safePort = parseInt(port, 10);
      if (!Number.isFinite(safePort) || safePort < 1 || safePort > 65535) throw new Error('Invalid port');
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${safePort} ^| findstr LISTENING') do taskkill /PID %a /F 2>nul`, { stdio: 'pipe', timeout: 5000 });
    } else {
      // SEC-M10: Use execFileSync with array arguments to avoid shell injection
      const pids = execFileSync('lsof', ['-ti', `:${port}`], { timeout: 5000, stdio: 'pipe' }).toString().trim();
      if (pids) {
        for (const pid of pids.split('\n')) {
          if (pid.trim()) {
            console.info(`[Python] Killing stale process ${pid} on port ${port}`);
            try { process.kill(parseInt(pid), 'SIGKILL'); } catch (e) { }
          }
        }
      }
    }
  } catch (e) { /* port cleanup is best-effort */ }

  // Notify renderer that Python is loading
  if (mainWindow) {
    safeSend('python-loading', true);
  }

  const engineConfig = store.get('engine', {});
  const modelSize = engineConfig.model || 'base';

  // Soft performance note — runtime monitoring handles actual detection
  if (!['tiny', 'base'].includes(modelSize)) {
    console.info(`[Performance] Using "${modelSize}" model — runtime monitoring will check if it keeps up`);
  }

  pythonProcess = spawn(pythonPath, [
    '-m', serverModule,
    '--host', serverConfig.host,
    '--port', String(serverConfig.port),
    '--model', modelSize
  ], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      KMP_DUPLICATE_LIB_OK: 'TRUE',
      // Resolve engine NAMES (base, windy-*-ct2) to bundled local dirs so the warm
      // server can actually load + hot-swap any engine — fully offline. Without these
      // the server tried to load 'windy-*-ct2' as a HuggingFace name (rejected) and
      // stayed stuck on whatever it first loaded (the engine-switch bug).
      HF_HUB_OFFLINE: '1',
      WINDY_USER_MODEL_DIR: path.join(os.homedir(), '.windy-pro', 'model'),
      WINDY_BUNDLED_MODEL_DIR: app.isPackaged
        ? path.join(process.resourcesPath, 'bundled', 'model')
        : path.join(projectRoot, 'extraResources', 'model'),
    }
  });

  // Arm the startup watchdog — cleared once the engine signals ready or the process exits.
  pythonReady = false;
  clearTimeout(pythonStartupTimer);
  pythonStartupTimer = setTimeout(() => {
    if (pythonReady) return;
    console.error(`[Python] Startup watchdog fired — engine did not signal ready within ${PYTHON_STARTUP_TIMEOUT_MS}ms`);
    try { pythonProcess && pythonProcess.kill(); } catch (_) {}
    showEngineFailure('It took too long to start.');
  }, PYTHON_STARTUP_TIMEOUT_MS);

  pythonProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`[Python] ${msg}`);
    // Detect server ready
    if (msg.includes('Waiting for connections') || msg.includes('Server running')) {
      pythonReady = true;
      clearTimeout(pythonStartupTimer);
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        safeSend('python-loading', false);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.info(`[Python] Server exited with code ${code}`);
    pythonProcess = null;
    clearTimeout(pythonStartupTimer);
    if (engineFailureShown) return; // failure dialog already owns the recovery flow

    // Auto-restart on unexpected exit with exponential backoff
    if (code !== 0 && !app.isQuitting && pythonRestartCount < MAX_PYTHON_RESTARTS) {
      pythonRestartCount++;
      const delay = 3000 * pythonRestartCount; // 3s, 6s, 9s...
      console.info(`[Python] Auto-restarting in ${delay}ms (attempt ${pythonRestartCount}/${MAX_PYTHON_RESTARTS})...`);
      setTimeout(() => startPythonServer(), delay);
    } else if (code !== 0 && pythonRestartCount >= MAX_PYTHON_RESTARTS) {
      console.error('[Python] Max restarts reached. Server will not restart.');
      showEngineFailure('The speech engine kept failing to start.');
    }
  });

  pythonProcess.on('error', (err) => {
    console.error(`[Python] Failed to start: ${err.message}`);
    if (mainWindow) {
      safeSend('state-change', 'error');
      safeSend('python-loading', false);
    }
  });
}

/**
 * Create the main floating window
 */
function createWindow() {
  const windowConfig = store.get('window');
  const appearance = store.get('appearance');

  // macOS hidden title bar + vibrancy consumes extra vertical space,
  // so enforce a height floor to prevent bottom controls from clipping.
  // This also fixes persisted configs migrated from Linux (height: 300).
  const MIN_HEIGHT = 320;
  const effectiveHeight = Math.max(windowConfig.height, MIN_HEIGHT);

  mainWindow = new BrowserWindow({
    width: windowConfig.width,
    height: effectiveHeight,
    x: windowConfig.x,
    y: windowConfig.y,

    // Floating window properties
    // macOS: 'floating' level = non-activating panel (like a utility palette).
    //   focusable:false = window never becomes key window, so the cursor
    //   stays blinking in the external app at all times during recording.
    //   Mouse clicks still work — only keyboard focus is prevented.
    // Linux Wayland: setFocusable(false) (applied during toggleRecording) is
    //   the real defense against XWayland focus theft; honoring the user's
    //   alwaysOnTop preference at creation time does not generate the X11
    //   property-change events that runtime toggling does, so it's safe.
    // Linux X11/Windows: plain alwaysOnTop works fine.
    alwaysOnTop: appearance.alwaysOnTop,
    focusable: process.platform !== 'darwin',  // Non-focusable on macOS only
    frame: true,            // Framed so user can see/cycle the window (temp Linux tweak)
    transparent: false,     // Opaque so empty page isn't invisible (temp Linux tweak)
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,

    // Minimum size
    minWidth: 250,
    minHeight: MIN_HEIGHT,

    // Web preferences
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required'
    },

    // Visual
    // Match the in-app .window background (--bg-primary #1F2937) so any pixels the
    // page hasn't painted (e.g. a brief gap after zoom/resize) blend seamlessly
    // instead of showing as a near-black strip below the UI.
    backgroundColor: '#1F2937',
    hasShadow: true,
    opacity: appearance.opacity,

    // Platform specific
    titleBarStyle: 'hidden',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined
  });

  // macOS: Override alwaysOnTop to use 'floating' panel level.
  if (process.platform === 'darwin' && appearance.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  }

  // IPC: Temporarily make window focusable when user needs keyboard input
  // (e.g. settings, typing in transcript). Call 'release-focus' when done.
  ipcMain.on('request-focus', () => {
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'darwin') {
      mainWindow.setFocusable(true);
      // A window created focusable:false at a 'floating' panel level often won't
      // become the KEY window from setFocusable+focus alone — so keyboard events
      // (e.g. rebinding a shortcut, typing in a field) never arrive. Steal app
      // focus + move to top so the window actually becomes key and receives keys.
      try { app.focus({ steal: true }); } catch (_) { /* best-effort */ }
      mainWindow.moveTop();
      mainWindow.focus();
    }
  });
  ipcMain.on('release-focus', () => {
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'darwin') {
      mainWindow.blur();
      mainWindow.setFocusable(false);
    }
  });

  // macOS: Non-focusable window means getUserMedia/AudioContext can't steal focus.
  // The cursor stays blinking in the external app at all times.
  // Fallback focus guard for edge cases (e.g. window temporarily set focusable for settings).
  if (process.platform === 'darwin') {
    mainWindow.on('focus', () => {
      if (isRecording) {
        console.info('[Focus-Guard] Window gained focus during recording — releasing immediately');
        mainWindow.blur();
      }
    });
  }
  console.info(`[Startup] ★ macOS non-activating panel mode (cursor stays in external app)`);

  // ── macOS Accessibility permission: required for auto-paste (Cmd+V keystrokes) ──
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const hasAccess = systemPreferences.isTrustedAccessibilityClient(false);
    if (!hasAccess) {
      console.warn('[Startup] ⚠️ Accessibility permission NOT granted — auto-paste will not work');
      console.warn('[Startup] Requesting Accessibility access…');
      // This triggers the macOS dialog asking the user to grant access
      systemPreferences.isTrustedAccessibilityClient(true);
    } else {
      console.info('[Startup] ✓ Accessibility permission granted');
    }
  }

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Wave 12 B4 — drain any deep-links that arrived before the window
  // existed (cold-boot "open windychat://room/foo" is the common case).
  mainWindow.webContents.once('did-finish-load', () => {
    while (pendingDeepLinks.length > 0) {
      const payload = pendingDeepLinks.shift();
      try { mainWindow.webContents.send('windy:deep-link', payload); }
      catch (e) { console.warn('[DeepLink] queued delivery failed:', e?.message || e); }
    }
  });

  // CSP Headers
  // SEC-L1: 'unsafe-inline' for style-src is an accepted risk in Electron desktop.
  // Rationale: 300+ inline style= usages across renderer JS files make nonce-based
  // CSS impractical. script-src does NOT allow unsafe-inline — that's what matters.
  // contextIsolation + sandbox + no nodeIntegration = no XSS escalation path.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' ws://127.0.0.1:* wss://*.windyword.ai https://*.windyword.ai https://api.groq.com https://api.openai.com https://api.deepgram.com wss://api.deepgram.com; " +
          "img-src 'self' data:; " +
          "media-src 'self' blob: data:; " +
          "base-uri 'self'; " +
          "object-src 'none';"
        ]
      }
    });
  });

  // Renderer crash handler
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    writeCrashLog('RendererCrash', `reason=${details.reason} exitCode=${details.exitCode}`);
    console.error('[Main] Renderer crashed:', details.reason);
    // Reload the renderer
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
      }
    }, 1000);
  });

  // Forward renderer console messages to terminal for debugging
  mainWindow.webContents.on('console-message', (event, level, message) => {
    // In dev mode, forward all logs; otherwise only warnings/errors
    // Filter out repetitive CSP noise regardless
    if (message.includes('Content-Security-Policy')) return;
    const minLevel = process.argv.includes('--dev') ? 0 : 2;
    if (level >= minLevel) {
      try { console.log(`[Renderer] ${message}`); } catch (_) { }
    }
  });

  // HTML5 video fullscreen — bridge the Chromium <video> fullscreen button to
  // the BrowserWindow. Without this the video element enters :fullscreen but
  // the BrowserWindow stays small, so nothing visibly changes when the user
  // clicks the fullscreen button in the History view (recording playback).
  //
  // macOS quirk: the main window has `focusable: false` (to avoid stealing
  // focus from the user's external app during the recording/paste flow).
  // The standard setFullScreen() uses native macOS fullscreen which requires
  // the window to become key, and refuses on a non-focusable window. The
  // setSimpleFullScreen() API uses the pre-Lion "fill the screen, stay in
  // current space" mode which works regardless of focusable state — the
  // right tool for in-app video playback.
  function enterContentFullscreen() {
    try {
      if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(true);
      else mainWindow.setFullScreen(true);
    } catch (e) { console.warn('[fullscreen] enter failed:', e.message); }
  }
  function leaveContentFullscreen() {
    try {
      if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(false);
      else mainWindow.setFullScreen(false);
    } catch (e) { console.warn('[fullscreen] leave failed:', e.message); }
  }
  mainWindow.webContents.on('enter-html-full-screen', enterContentFullscreen);
  mainWindow.webContents.on('leave-html-full-screen', leaveContentFullscreen);
  // Esc-out from the renderer side (when the user presses Esc while a <video>
  // is in :fullscreen) also fires leave-html-full-screen, so the handler
  // above covers it. No keyboard shortcut needed here.

  // Save window position on move/resize
  mainWindow.on('move', saveWindowBounds);
  mainWindow.on('resize', saveWindowBounds);

  // Hide instead of close (keep in tray)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

/**
 * Save window bounds to store
 */
let _saveWindowTimer = null;
function saveWindowBounds() {
  if (_saveWindowTimer) clearTimeout(_saveWindowTimer);
  _saveWindowTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    store.set('window', mainWindow.getBounds());
  }, 500);
}

/**
 * Create system tray
 */
function createTray() {
  // Create tray icon (green circle for now, will be replaced with proper icon)
  const iconSize = process.platform === 'darwin' ? 16 : 32;
  const icon = createTrayIcon('idle', iconSize);

  tray = new Tray(icon);
  tray.setToolTip('Windy Word - Click to show');

  updateTrayMenu();

  // Click to show/hide window
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Update tray context menu
 */
function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide Window' : 'Show Window',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: isRecording ? '⏹ Stop Recording' : '🎤 Start Recording',
      click: () => toggleRecording()
    },
    {
      label: '📋 Paste Last Transcript',
      click: () => pasteTranscript()
    },
    { type: 'separator' },
    {
      label: '⚙️ Settings',
      click: () => {
        mainWindow.show();
        safeSend('open-settings');
      }
    },
    {
      label: '📋 Open Vault',
      click: () => {
        mainWindow.show();
        safeSend('open-vault');
      }
    },
    {
      label: '🌐 Quick Translate',
      click: () => showMiniTranslateWindow()
    },
    {
      label: '💬 Windy Chat',
      click: () => showChatWindow()
    },
    {
      label: '📜 History',
      click: () => {
        mainWindow.show();
        safeSend('open-history');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Windy Word',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Show About window
 */
function showAboutWindow() {
  const aboutWin = new BrowserWindow({
    width: 380,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Handle link clicks from the about window via postMessage (contextIsolation safe)
  aboutWin.webContents.on('did-finish-load', () => {
    aboutWin.webContents.on('ipc-message', (event, channel, url) => {
      // SEC-06: Validate URL protocol before opening externally
      if (channel === 'open-url' && isSafeURL(url)) shell.openExternal(url);
    });
  });

  const version = app.getVersion();
  const electronVersion = process.versions.electron;
  const nodeVersion = process.versions.node;
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; text-align: center; padding: 32px 24px; -webkit-app-region: drag; cursor: default; user-select: none; }
  .logo { font-size: 48px; margin-bottom: 12px; }
  h1 { font-size: 22px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px; }
  .version { color: #60a5fa; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
  .built { color: #94a3b8; font-size: 13px; margin-bottom: 8px; }
  .tech { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .links { display: flex; gap: 16px; justify-content: center; margin-bottom: 12px; }
  .links a { color: #60a5fa; font-size: 13px; text-decoration: none; -webkit-app-region: no-drag; cursor: pointer; }
  .links a:hover { text-decoration: underline; }
  .close-btn { -webkit-app-region: no-drag; cursor: pointer; background: #1e293b; border: 1px solid #334155; color: #94a3b8; padding: 6px 24px; border-radius: 6px; font-size: 13px; margin-top: 8px; }
  .close-btn:hover { background: #334155; color: #f1f5f9; }
  .copyright { color: #475569; font-size: 11px; margin-top: 12px; }
</style></head><body>
  <div class="logo">🌪️</div>
  <h1>Windy Word</h1>
  <div class="version">Version ${version}</div>
  <div class="built">Built by Windy Word Labs</div>
  <div class="tech">Electron ${electronVersion} · Node ${nodeVersion} · ${process.arch}</div>
  <div class="links">
    <a onclick="window.postMessage({type:'open-url',url:'https://windyword.ai'})">Website</a>
    <a onclick="window.postMessage({type:'open-url',url:'mailto:dev@windyword.ai'})">Support</a>
    <a onclick="window.postMessage({type:'open-url',url:'https://github.com/sneakyfree/windy-pro'})">GitHub</a>
  </div>
  <button class="close-btn" onclick="window.close()">Close</button>
  <div class="copyright">&copy; 2026 Windy Word Labs. All rights reserved.</div>
<script>window.addEventListener('message',(e)=>{if(e.data&&e.data.type==='open-url'){window.open(e.data.url);}});</script>
</body></html>`;

  aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  aboutWin.center();

  // Handle window.open calls from the about window to open in system browser
  // SEC-H3: Validate URL before opening externally
  aboutWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeURL(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Create macOS application menu bar
 * Required for standard Cmd+Q, Cmd+H, Cmd+M, and Edit menu shortcuts
 */
function createMacOSMenu() {
  // Linux/Windows: suppress Electron's auto-generated File/Edit/View/Window/Help
  // menu — it duplicates nothing useful (all real commands are in the custom
  // title bar + tray menu) and exposes Reload/DevTools footguns to end users.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        {
          label: 'About Windy Word',
          click: () => showAboutWindow()
        },
        { type: 'separator' },
        {
          label: 'Settings\u2026',
          accelerator: 'Cmd+,',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              safeSend('open-settings');
            }
          }
        },
        {
          label: 'New Recording',
          accelerator: 'Cmd+N',
          click: () => toggleRecording()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit Windy Word',
          accelerator: 'Cmd+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'Cmd+/',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              safeSend('show-keyboard-shortcuts');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Privacy Policy',
          click: () => {
            const privacyWin = new BrowserWindow({
              width: 700,
              height: 600,
              title: 'Privacy Policy',
              autoHideMenuBar: true,
              backgroundColor: '#0f172a',
              webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
            });
            privacyWin.loadFile(path.join(__dirname, 'renderer', 'privacy.html'));
          }
        },
        {
          label: 'Terms of Service',
          click: () => {
            const termsWin = new BrowserWindow({
              width: 700,
              height: 600,
              title: 'Terms of Service',
              autoHideMenuBar: true,
              backgroundColor: '#0f172a',
              webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
            });
            termsWin.loadFile(path.join(__dirname, 'renderer', 'terms.html'));
          }
        },
        { type: 'separator' },
        {
          label: 'Windy Word Website',
          click: () => shell.openExternal('https://windyword.ai')
        },
        {
          label: 'Report a Bug',
          click: () => shell.openExternal('https://github.com/sneakyfree/windy-pro/issues')
        },
        { type: 'separator' },
        {
          label: 'About Windy Word',
          click: () => showAboutWindow()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Create a tray icon — colored circle for given state
 * Uses raw RGBA pixel data (no external deps)
 */
function createTrayIcon(state, size) {
  const colors = {
    idle: [107, 114, 128],  // Gray  #6B7280
    listening: [34, 197, 94],  // Green #22C55E
    buffering: [234, 179, 8],  // Yellow #EAB308
    error: [239, 68, 68],  // Red   #EF4444
    injecting: [59, 130, 246]   // Blue  #3B82F6
  };
  const [r, g, b] = colors[state] || colors.idle;
  const s = size || 16;
  const buf = Buffer.alloc(s * s * 4);
  const cx = s / 2, cy = s / 2, radius = s / 2 - 1;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const idx = (y * s + x) * 4;
      if (dist <= radius) {
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255; // opaque
      } else {
        buf[idx + 3] = 0; // transparent
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: s, height: s });
}

/**
 * Update tray icon to reflect current state
 */
function updateTrayIcon(state) {
  if (!tray) return;
  const size = process.platform === 'darwin' ? 16 : 32;
  tray.setImage(createTrayIcon(state, size));
}

/**
 * Create or show the mini tornado widget
 */
function showMiniWidget() {
  // Save position before destroying so we can restore it
  if (miniWindow && !miniWindow.isDestroyed()) {
    const [px, py] = miniWindow.getPosition();
    store.set('tornadoX', px);
    store.set('tornadoY', py);
    miniWindow.destroy();
    miniWindow = null;
  }

  const tornadoSize = store.get('tornadoSize') || 56;
  // +100 for 50px glow padding on each side
  const winSize = tornadoSize + 100;
  const savedX = store.get('tornadoX');
  const savedY = store.get('tornadoY');

  const winOpts = {
    width: winSize,
    height: winSize,
    x: savedX != null ? savedX : 100,
    y: savedY != null ? savedY : 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'mini-preload.js')
    }
  };

  // Linux: keep transparent. If GPU issues occur, launch with --disable-gpu.

  miniWindow = new BrowserWindow(winOpts);

  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini-widget.html'));
  miniWindow.setVisibleOnAllWorkspaces(true);

  miniWindow.on('closed', () => { miniWindow = null; });

  // Capture mini widget console output for debugging
  miniWindow.webContents.on('console-message', (e, level, msg) => {
    console.log(`[Mini] ${msg}`);
  });

  // Forward state + size + settings after load
  miniWindow.webContents.on('did-finish-load', () => {
    updateMiniState(isRecording ? 'recording' : 'idle');
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('mini-resize', tornadoSize);

      // Send saved widget data so the floating widget shows the correct icon
      const widgetData = store.get('widgetData');
      if (widgetData) {
        miniWindow.webContents.send('mini-widget-change', widgetData);
      }

      // Send saved widget settings (sliders, color, etc.)
      const widgetSettings = store.get('widgetSettings');
      if (widgetSettings) {
        miniWindow.webContents.send('mini-load-settings', widgetSettings);
      }
    }
  });
}

/**
 * Update mini widget state
 */
function updateMiniState(state) {
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.webContents && !miniWindow.webContents.isDestroyed()) {
    miniWindow.webContents.send('mini-state-change', state);
  }
}

// Handle expand from mini widget
ipcMain.on('mini-expand', () => {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Handle mini widget drag
let _miniMoveTimer = null;
ipcMain.on('mini-move', (event, { dx, dy }) => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    const [x, y] = miniWindow.getPosition();
    const nx = x + dx, ny = y + dy;
    miniWindow.setPosition(nx, ny);
    // Debounce disk writes — position is saved 300ms after last move event
    if (_miniMoveTimer) clearTimeout(_miniMoveTimer);
    _miniMoveTimer = setTimeout(() => {
      store.set('tornadoX', nx);
      store.set('tornadoY', ny);
    }, 300);
  }
});

// Forward voice levels from renderer to mini widget
let _voiceLevelLogCount = 0;
ipcMain.on('voice-level', (event, level) => {
  if (_voiceLevelLogCount < 5 && level > 0.05) {

    _voiceLevelLogCount++;
  }
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.webContents && !miniWindow.webContents.isDestroyed()) {
    miniWindow.webContents.send('mini-voice-level', level);
  }
});

// Update tornado widget size from settings slider
ipcMain.on('update-tornado-size', (event, size) => {
  store.set('tornadoSize', size);
  const winSize = size + 4;
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.setSize(winSize, winSize);
    if (miniWindow.webContents && !miniWindow.webContents.isDestroyed()) {
      miniWindow.webContents.send('mini-resize', size);
    }
  }
});

// Update widget appearance (forward from renderer to mini-widget)
ipcMain.on('update-widget', (event, data) => {
  // data: { type: 'stock', svg: '...' } or { type: 'custom', dataUrl: '...' }
  store.set('widgetData', data);
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.webContents && !miniWindow.webContents.isDestroyed()) {
    miniWindow.webContents.send('mini-widget-change', data);
  }
});

// ── Widget settings panel: toggle panel size ──
ipcMain.on('mini-toggle-panel', (event, open) => {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const widgetSettings = store.get('widgetSettings') || {};
  // +100 for 50px glow padding on each side
  const widgetSize = (widgetSettings.size || 56) + 100;
  if (open) {
    // Fixed size: panel is at 200px top, ~380px tall + save button + margin
    miniWindow.setSize(250, 620);
    miniWindow.setResizable(false);
  } else {
    // Shrink back to widget size
    miniWindow.setSize(widgetSize, widgetSize);
  }
});

// ── Widget settings panel: save settings ──
ipcMain.on('mini-save-settings', (event, newSettings) => {
  store.set('widgetSettings', newSettings);
  // Also update the tornado size used by showMiniWidget
  if (newSettings.size) {
    store.set('tornadoSize', newSettings.size);
    // +100 for 50px glow padding on each side
    const winSize = newSettings.size + 100;
    if (miniWindow && !miniWindow.isDestroyed()) {
      // Only resize if panel is NOT open (panel-open is fixed at 250x620)
      const [w, h] = miniWindow.getSize();
      if (h < 300) {
        miniWindow.setSize(winSize, winSize);
      }
      // When panel is open, DON'T resize — panel is fixed at 250x620
    }
  }
});

// ═══════════════════════════════════════════
//  VIDEO PREVIEW WINDOW (independent, draggable)
// ═══════════════════════════════════════════

let videoWindow = null;
let videoDismissed = false; // User closed preview — don't auto-show until app restart

function createVideoWindow() {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.show();
    return videoWindow;
  }

  const saved = store.get('videoWindow') || {};
  const w = saved.width || 240;
  const h = saved.height || 180;

  videoWindow = new BrowserWindow({
    width: w,
    height: h,
    x: saved.x != null ? saved.x : undefined,
    y: saved.y != null ? saved.y : undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false, // We handle resize manually via IPC
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    minWidth: 120,
    minHeight: 90,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'renderer', 'video-preload.js'),
      partition: 'persist:videopreview' // Own session so permissions don't conflict
    }
  });

  videoWindow.loadFile(path.join(__dirname, 'renderer', 'video-preview.html'));
  videoWindow.setVisibleOnAllWorkspaces(true);

  // Auto-grant camera permission for the video preview window's own session
  const videoSes = videoWindow.webContents.session;
  videoSes.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true);
    } else {
      callback(false);
    }
  });
  // Also needed for newer Electron: permission check handler
  videoSes.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      return true;
    }
    return false;
  });

  // Save bounds on move/resize
  const saveBounds = () => {
    if (videoWindow && !videoWindow.isDestroyed()) {
      const bounds = videoWindow.getBounds();
      store.set('videoWindow', bounds);
    }
  };
  videoWindow.on('move', saveBounds);
  videoWindow.on('resize', saveBounds);
  videoWindow.on('closed', () => { videoWindow = null; });

  return videoWindow;
}

// CR-009c: 11 video-preview IPC handlers extracted to ./ui/video-ipc.js.
// videoWindow + videoDismissed are main.js-scoped `let` globals —
// passed via ref wrappers so the registrar can mutate them through
// the getter/setter bridge.
const { registerVideoIpc } = require('./ui/video-ipc');
const _videoWindowRef = {
  get current() { return videoWindow; },
  set current(v) { videoWindow = v; },
};
const _videoDismissedRef = {
  get current() { return videoDismissed; },
  set current(v) { videoDismissed = v; },
};
registerVideoIpc({
  ipcMain,
  createVideoWindow,
  videoWindowRef: _videoWindowRef,
  videoDismissedRef: _videoDismissedRef,
  screen: require('electron').screen,
});

// ═══════════════════════════════════════════
//  FONT SIZE CONTROL
// ═══════════════════════════════════════════

// CR-009 cont: font-size / settings / rebind-hotkey extracted to
// ./ui/settings-ipc.js. Registered lower in the file where
// registerHotkeys is in scope.

// ═══════════════════════════════════════════
//  MINI TRANSLATE WINDOW (floating quick-translate)
// ═══════════════════════════════════════════

function showMiniTranslateWindow() {
  // Toggle: if already open, close it
  if (miniTranslateWindow && !miniTranslateWindow.isDestroyed()) {
    miniTranslateWindow.close();
    return;
  }

  miniTranslateWindow = new BrowserWindow({
    width: 440,
    height: 480,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: '#1F2937',
    minWidth: 340,
    minHeight: 350,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'mini-translate-preload.js')
    }
  });

  miniTranslateWindow.loadFile(path.join(__dirname, 'renderer', 'mini-translate.html'));
  miniTranslateWindow.on('closed', () => { miniTranslateWindow = null; });
}

// Mini-translate IPC close
ipcMain.on('mini-translate-close', () => {
  if (miniTranslateWindow && !miniTranslateWindow.isDestroyed()) {
    miniTranslateWindow.close();
  }
});

// Mini-translate IPC open (from renderer discovery menu)
ipcMain.on('open-mini-translate', () => {
  showMiniTranslateWindow();
});

// Mini-translate IPC text translation
ipcMain.handle('mini-translate-text', async (event, text, sourceLang, targetLang) => {
  try {
    const https = require('https');
    const token = store.get('license.cloudToken') || '';
    // CR-003: input sanity — reject absurdly large payloads at the
    // client before shipping them to the API. Server also validates
    // (≤5000 chars via shared/contracts/TranslateTextRequestSchema),
    // but this saves the round-trip on obvious abuse.
    if (typeof text !== 'string' || text.length === 0) {
      return { error: 'Empty text' };
    }
    if (text.length > 5000) {
      return { error: 'Text too long (max 5000 chars)' };
    }
    const postData = JSON.stringify({ text, sourceLang, targetLang });

    const reqPromise = new Promise((resolve) => {
      const req = https.request('https://windyword.ai/api/v1/translate/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ error: 'Invalid response from translation server' });
          }
        });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.write(postData);
      req.end();
    });
    // CR-003: 15s end-to-end bound. The server's p99 is under 3s;
    // anything above is a dead connection or an outage.
    return await withTimeout(reqPromise, 15_000, 'mini-translate-text');
  } catch (err) {
    console.error('[mini-translate-text] Error:', err.message);
    return { error: err.message, timedOut: !!err.timedOut };
  }
});

// ═══════════════════════════════════════════════════
// ═══ WINDY CHAT ═══
// ═══════════════════════════════════════════════════

let chatClient = null;
let chatTranslator = null;

function getChatClient() {
  if (!chatClient) {
    // Lazy-load chat modules (pulls in matrix-js-sdk ~2MB)
    const { WindyChatClient } = require('./chat/chat-client');
    const { ChatTranslator } = require('./chat/chat-translate');
    chatClient = new WindyChatClient(store);
    chatTranslator = new ChatTranslator(store);

    // Wire translation function into chat client
    chatClient.translateFn = (text, src, tgt) => chatTranslator.translate(text, src, tgt);

    // L5 TRIGGER 2: Forward pair-needed events to chat renderer
    chatTranslator.onPairNeeded = (data) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-pair-needed', data);
      }
    };

    // Forward events to chat window
    chatClient.on('message', (msg) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-new-message', msg);
      }
    });
    chatClient.on('presence', (data) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-presence-update', data);
      }
    });
    chatClient.on('invite', (data) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-invite', data);
      }
    });
    chatClient.on('connected', () => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-connected');
      }
    });
    chatClient.on('disconnected', () => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-disconnected');
      }
    });
    // Forward connection-status events (SYNCING, ERROR, RECONNECTING)
    chatClient.on('connection-status', (data) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-connection-status', data);
      }
    });
  }
  return chatClient;
}

function showChatWindow() {
  // Toggle: if already open, focus it
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    frame: true,
    title: 'Windy Chat',
    backgroundColor: '#0F1219',
    icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'chat', 'chat-preload.js')
    }
  });

  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  chatWindow.on('closed', () => { chatWindow = null; });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    chatWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Chat IPC — open from renderer
ipcMain.on('open-windy-chat', () => showChatWindow());

// ═══ Control Panel (WD-31 M-G; ADR-054) ═════════════════════════
// IPC handler that returns the local-machine Vitals v1 payload to any
// drop template that calls window.windyVitals.get() from a Control
// Panel-window renderer. The collector is the CJS port of
// @windy/control-panel-host-electron/collect — see
// src/client/desktop/control-panel/VENDOR_README.md.
const controlPanelCollector = require('./control-panel/vendor/collect.cjs');
ipcMain.handle('windy:control-panel:vitals', async () => {
  try {
    const vitals = await controlPanelCollector.collect();
    return { ok: true, vitals };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Control Panel window — separate BrowserWindow so the renderer can be
// a focused single-purpose host (template iframe + data feed) without
// touching the main app's chrome. Sandboxed preload exposes
// windowVitals.get() via the IPC channel registered above.
let controlPanelWindow = null;
function showControlPanelWindow() {
  if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
    controlPanelWindow.show();
    controlPanelWindow.focus();
    return;
  }
  controlPanelWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    title: 'Control Panel',
    backgroundColor: '#060a14',
    icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'control-panel', 'preload.js'),
    },
  });
  controlPanelWindow.loadFile(path.join(__dirname, 'renderer', 'control-panel.html'));
  controlPanelWindow.on('closed', () => { controlPanelWindow = null; });
  if (process.argv.includes('--dev')) {
    controlPanelWindow.webContents.openDevTools({ mode: 'detach' });
  }
}
ipcMain.on('open-control-panel', () => showControlPanelWindow());

// Auth-token bridge for the Control Panel window. The main renderer
// stores `windy_token` in its localStorage; the child window has its
// own storage scope, so we proxy the read through executeJavaScript
// on the main window. Returns null if main isn't up or the token
// isn't set yet.
ipcMain.handle('control-panel:get-token', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const token = await mainWindow.webContents.executeJavaScript(
      `(typeof localStorage !== 'undefined' && localStorage.getItem('windy_token')) || null`,
    );
    return token || null;
  } catch {
    return null;
  }
});

// Account-server base URL — environment-controlled so flipping between
// dev (http://localhost:3334) and prod (https://account.windyword.ai)
// doesn't require a rebuild.
ipcMain.handle('control-panel:account-server-url', async () => {
  return process.env.WINDY_ACCOUNT_SERVER_URL || 'https://account.windyword.ai';
});

// ─── Drop library (WD-31 Phase 3a) ───────────────────────────────────
// In-Electron marketplace plumbing. The library service tracks which
// drops the user has installed + which one is currently selected. Echo
// HQ is built-in (ships with the DMG) so first-run + offline-mode are
// always covered without a network round-trip.
const controlPanelLibrary = require('./control-panel/library-service.js');

function userDataDir() {
  return app.getPath('userData');
}

ipcMain.handle('windy:control-panel:list-installed', async () => {
  try {
    return { ok: true, drops: controlPanelLibrary.listAll(userDataDir()) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('windy:control-panel:get-selected', async () => {
  try {
    return { ok: true, selected: controlPanelLibrary.getSelected(userDataDir()) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('windy:control-panel:select-drop', async (_event, { dropId, version }) => {
  try {
    const selected = controlPanelLibrary.setSelected(userDataDir(), dropId, version);
    // Notify the Control Panel renderer so it can reload the iframe.
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
      controlPanelWindow.webContents.send('windy:control-panel:selection-changed', selected);
    }
    return { ok: true, selected };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('windy:control-panel:install-drop', async (_event, manifest) => {
  try {
    const entry = controlPanelLibrary.installDrop(userDataDir(), manifest);
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
      controlPanelWindow.webContents.send('windy:control-panel:library-changed');
    }
    return { ok: true, drop: entry };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('windy:control-panel:uninstall-drop', async (_event, dropId) => {
  try {
    const result = controlPanelLibrary.uninstallDrop(userDataDir(), dropId);
    if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
      controlPanelWindow.webContents.send('windy:control-panel:library-changed');
    }
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('windy:control-panel:browse-registry', async (_event, query) => {
  try {
    const body = await controlPanelLibrary.browseRegistry(query || {});
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Launch Windy Code desktop app
ipcMain.handle('launch-windy-code', async () => {
  const { shell } = require('electron');
  const fs = require('fs');
  // Known install locations
  const paths = [
    path.join(require('os').homedir(), 'VSCode-darwin-x64', 'Windy Code.app'),
    '/Applications/Windy Code.app',
    path.join(require('os').homedir(), 'Applications', 'Windy Code.app')
  ];
  for (const appPath of paths) {
    if (fs.existsSync(appPath)) {
      await shell.openPath(appPath);
      return { launched: true, path: appPath };
    }
  }
  return { launched: false };
});

// Chat IPC — Authentication
// CR-009: 21 chat-* IPC handlers extracted to ./chat/ipc.js so the
// main.js cold path stays manageable. The translatorRef wrapper
// preserves the original lazy-instantiate-on-first-translate
// semantics — chatTranslator is a module-level let that can be
// null until the first chat-translate-text call.
const { registerChatIpc } = require('./chat/ipc');
const _chatTranslatorRef = {
  get current() { return chatTranslator; },
  set current(v) { chatTranslator = v; },
};
// CR-012: ChatTranslator lazy-required on first chat-translate-text
// call. Keeps matrix-js-sdk + chat-translate out of the cold path
// for users who never open the chat window.
const _ChatTranslatorLazy = function ChatTranslatorLazy(store) {
  const { ChatTranslator } = require('./chat/chat-translate');
  return new ChatTranslator(store);
};
registerChatIpc({
  ipcMain,
  getChatClient,
  getChatClientUnsafe: () => chatClient,
  setupChatForwarding: _setupChatForwarding,
  withTimeout,
  store,
  ChatTranslator: _ChatTranslatorLazy,
  translatorRef: _chatTranslatorRef,
});

// Forward events from Matrix client → chat BrowserWindow
// NOTE: getChatClient() already registers message/presence/invite/connected/disconnected listeners.
// _setupChatForwarding adds ONLY the typing handler + tray badge update to avoid duplicate events.
let _chatForwardingSetup = false;
function _setupChatForwarding(client) {
  if (_chatForwardingSetup) return;
  _chatForwardingSetup = true;

  // Typing is NOT forwarded in getChatClient() — add it here
  client.on('typing', (data) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('chat-typing', data);
    }
  });

  // Tray badge update on new message
  client.on('message', () => {
    _updateTrayUnread(client.getTotalUnread());
  });

  client.on('disconnected', () => {
    _chatForwardingSetup = false;
  });
}

function _updateTrayUnread(count) {
  try {
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(count > 0 ? `Windy Word (${count} unread)` : 'Windy Word');
    }
    // Set dock badge (macOS) or taskbar overlay (Windows)
    if (app.dock && typeof app.dock.setBadge === 'function') {
      app.dock.setBadge(count > 0 ? String(count) : '');
    }
    if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setOverlayIcon === 'function') {
      // On Windows, would set overlay icon — skip for now
    }
  } catch (e) { /* ignore badge errors */ }
}

// ═══ License Token Storage (safeStorage) ═══

/**
 * Store a license token encrypted via OS keychain (safeStorage).
 * @param {string} token — plaintext license token
 */
function storeLicenseToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    store.set('license.tokenEncrypted', encrypted.toString('base64'));
    console.info('[License] Token stored in safeStorage');
  } else {
    // Fallback: store plaintext (less secure — logged as warning)
    store.set('license.tokenPlaintext', token);
    console.warn('[License] safeStorage unavailable — token stored in plaintext');
  }
}

/**
 * Retrieve the license token from safeStorage.
 * @returns {string} plaintext license token, or 'free' if none stored
 */
function retrieveLicenseToken() {
  const encB64 = store.get('license.tokenEncrypted', '');
  if (encB64 && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encB64, 'base64'));
    } catch (e) {
      console.error('[License] Failed to decrypt token from safeStorage:', e.message);
    }
  }
  // Fallback chain
  return store.get('license.tokenPlaintext', '')
    || store.get('license.stripeSessionId', '')
    || store.get('license.email', '')
    || 'free';
}

ipcMain.handle('store-license-token', async (event, token) => {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'Invalid token' };
  storeLicenseToken(token);
  // Reset PairDownloadManager so it picks up the new token
  _pairDownloadManager = null;
  return { ok: true };
});

// ═══ Pair Download Manager IPC (L1 + L6) ═══
let _pairDownloadManager = null;
function getPairDownloadManager() {
  if (!_pairDownloadManager) {
    const { PairDownloadManager } = require('./pair-download-manager');
    const pairsDir = path.join(app.getPath('userData'), 'translation-pairs');
    const licenseToken = retrieveLicenseToken();
    _pairDownloadManager = new PairDownloadManager(pairsDir, licenseToken);

    // Forward progress events to all windows
    _pairDownloadManager.on('progress', (data) => {
      safeSend('pair-download-progress', data);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('pair-download-progress', data);
      }
    });
  }
  return _pairDownloadManager;
}

// ═══ Model Migration (unencrypted → WMOD) ═══

/**
 * Migrate unencrypted or legacy-encrypted models to WMOD format.
 * - Detects missing WMOD magic bytes → re-encrypts
 * - Handles legacy PBKDF2+meta.json → decrypt with old key, re-encrypt with HKDF
 * - If no valid license exists, leaves files as-is until authentication
 * Runs once on startup; idempotent.
 */
async function migrateUnencryptedModels() {
  const { PairDownloadManager } = require('./pair-download-manager');
  const pairsDir = path.join(app.getPath('userData'), 'translation-pairs');
  const licenseToken = retrieveLicenseToken();

  if (licenseToken === 'free' || !licenseToken) {
    console.info('[Migration] No valid license — skipping model migration until user authenticates');
    return;
  }

  try {
    const entries = fs.readdirSync(pairsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    if (entries.length === 0) return;

    let migratedCount = 0;
    const total = entries.length;
    safeSend('migration-progress', { status: 'starting', total });

    for (const entry of entries) {
      const pairDir = path.join(pairsDir, entry.name);
      const encPath = path.join(pairDir, 'model.enc');
      const metaPath = path.join(pairDir, 'meta.json');

      if (!fs.existsSync(encPath)) continue;

      // Read first 4 bytes to check for WMOD magic
      const fd = fs.openSync(encPath, 'r');
      const magicBuf = Buffer.alloc(4);
      fs.readSync(fd, magicBuf, 0, 4, 0);
      fs.closeSync(fd);

      if (PairDownloadManager.hasWmodHeader(magicBuf)) {
        continue; // Already WMOD format
      }

      // Need migration — try to decrypt with legacy scheme
      console.info(`[Migration] Migrating ${entry.name} from legacy format to WMOD`);

      try {
        let plaintext;

        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

          if (meta.iv && meta.salt) {
            // Legacy PBKDF2 encrypted format
            const iv = Buffer.from(meta.iv, 'hex');
            const salt = Buffer.from(meta.salt, 'hex');
            const legacyDeviceId = os.hostname() + '-' + os.platform();
            const encData = fs.readFileSync(encPath);
            plaintext = PairDownloadManager.decryptLegacy(encData, salt, iv, licenseToken, legacyDeviceId);
          } else {
            // meta.json exists but no iv/salt → raw unencrypted file
            plaintext = fs.readFileSync(encPath);
          }
        } else {
          // No meta.json → raw unencrypted .bin file
          plaintext = fs.readFileSync(encPath);
        }

        // Re-encrypt with new HKDF scheme → WMOD format
        const mgr = new PairDownloadManager(pairsDir, licenseToken);
        const wmodBuffer = mgr._encrypt(plaintext);
        fs.writeFileSync(encPath, wmodBuffer);

        // Update meta.json — remove legacy iv/salt, add format marker
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          delete meta.iv;
          delete meta.salt;
          meta.format = 'wmod-v1';
          meta.migratedAt = new Date().toISOString();
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
        }

        migratedCount++;
        safeSend('migration-progress', { status: 'migrating', current: migratedCount, total, pairId: entry.name });
        console.info(`[Migration] ✅ ${entry.name} migrated to WMOD`);
      } catch (err) {
        console.error(`[Migration] ❌ Failed to migrate ${entry.name}:`, err.message);
        // Don't delete — leave the file for manual recovery
      }
    }

    if (migratedCount > 0) {
      safeSend('migration-progress', { status: 'complete', migrated: migratedCount });
      console.info(`[Migration] Completed: ${migratedCount}/${total} models migrated to WMOD`);
    }
  } catch (err) {
    console.error('[Migration] Migration scan error:', err.message);
  }
}

// CR-009b: 8 pair-* IPC handlers extracted to ./chat/pair-ipc.js.
// Same registrar pattern as chat/ipc.js; deps object keeps main.js
// the sole owner of the PairDownloadManager cache.
const { registerPairIpc } = require('./chat/pair-ipc');
registerPairIpc({
  ipcMain,
  app,
  getPairDownloadManager,
  withTimeout,
});

// ── Live Listen: speech translation for Quick Translate ──
ipcMain.handle('mini-translate-speech', async (event, audioArray, sourceLang, targetLang, apiKeys, options) => {
  const localOnly = options && options.localOnly;
  const listeningModel = (options && options.listeningModel) || 'windytune';
  const translatingModel = (options && options.translatingModel) || 'windytune';
  const audioBuffer = Buffer.from(audioArray);
  // Merge API keys: renderer localStorage → electron-store → env vars
  const rendererKeys = apiKeys || {};
  const groqKey = rendererKeys.groq || store.get('engine.groqApiKey', '') || process.env.GROQ_API_KEY || '';
  const openaiKey = rendererKeys.openai || store.get('engine.openaiApiKey', '') || process.env.OPENAI_API_KEY || '';

  // Use the model the user selected in the cockpit (not the global store)
  const engineId = listeningModel === 'windytune'
    ? (store.get('engine.selected') || store.get('engine.model') || 'windytune')
    : listeningModel;
  const windyTune = listeningModel === 'windytune';
  const userWantsCloud = listeningModel === 'cloud';
  const MODEL_INFO = {
    // Keep special model types
    'windytune': { name: 'WindyTune Auto', size: '', specialty: 'Auto-selects best model' },
    'cloud': { name: 'WindyCloud', size: '', specialty: 'Cloud-based transcription' },
    'local': { name: 'Local', size: '', specialty: '' },

    // Real GPU voice models from model_registry.json
    'windy-nano': { name: 'Windy Nano', size: '73 MB', specialty: 'Fastest engine. Best for quick dictation on powerful hardware.' },
    'windy-lite': { name: 'Windy Lite', size: '140 MB', specialty: 'Lightweight engine with improved accuracy. Balanced speed/quality.' },
    'windy-core': { name: 'Windy Core', size: '462 MB', specialty: 'Core engine. Recommended for most use cases.' },
    'windy-edge': { name: 'Windy Edge', size: '1444 MB', specialty: 'High-accuracy engine. Best for professional transcription.' },
    'windy-plus': { name: 'Windy Plus', size: '1458 MB', specialty: 'Premium STT with excellent accuracy. Production-grade.' },
    'windy-turbo': { name: 'Windy Turbo', size: '1544 MB', specialty: 'Latest-gen engine. State-of-the-art accuracy and robustness.' },
    'windy-pro-engine': { name: 'Windy Word Engine', size: '2945 MB', specialty: 'Ultra-fast large model. Maximum speed without sacrificing quality.' },

    // Real CPU voice models from model_registry.json
    'windy-nano-cpu': { name: 'Windy Nano (CPU)', size: '406 MB', specialty: 'CPU-optimized Nano. Best for resource-constrained environments.' },
    'windy-lite-cpu': { name: 'Windy Lite (CPU)', size: '668 MB', specialty: 'CPU-optimized Lite. Good balance for CPU-only systems.' },
    'windy-core-cpu': { name: 'Windy Core (CPU)', size: '1760 MB', specialty: 'CPU-optimized Core. Recommended for most CPU deployments.' },
    'windy-edge-cpu': { name: 'Windy Edge (CPU)', size: '3824 MB', specialty: 'CPU-optimized Edge. High accuracy on CPU hardware.' },
    'windy-plus-cpu': { name: 'Windy Plus (CPU)', size: '4872 MB', specialty: 'CPU-optimized Plus. Premium accuracy without GPU.' },
    'windy-turbo-cpu': { name: 'Windy Turbo (CPU)', size: '4200 MB', specialty: 'CPU-optimized Turbo. State-of-the-art accuracy on CPU.' },
    'windy-pro-engine-cpu': { name: 'Windy Word Engine (CPU)', size: '9456 MB', specialty: 'CPU-optimized Pro. Maximum CPU performance.' },

    // Real Translation models from model_registry.json
    'windy-translate-spark': { name: 'Windy Translate Spark', size: '929 MB', specialty: 'Fast multilingual translation. 100+ languages. LoRA-enhanced for priority pairs.' },
    'windy-translate-standard': { name: 'Windy Translate Standard', size: '2371 MB', specialty: 'Standard multilingual translation. 100+ languages. Higher quality than Spark.' },

    // Legacy model names → Real Windy model equivalents (based on base_architecture)
    'tiny': { name: 'Windy Nano', size: '73 MB', specialty: 'Fastest engine. Best for quick dictation on powerful hardware.' },
    'base': { name: 'Windy Core', size: '462 MB', specialty: 'Core engine. Recommended for most use cases.' },
    'small': { name: 'Windy Lite', size: '140 MB', specialty: 'Lightweight engine with improved accuracy. Balanced speed/quality.' },
    'medium': { name: 'Windy Edge', size: '1444 MB', specialty: 'High-accuracy engine. Best for professional transcription.' },
    'large-v3': { name: 'Windy Word Engine', size: '2945 MB', specialty: 'Ultra-fast large model. Maximum speed without sacrificing quality.' },
    'turbo': { name: 'Windy Turbo', size: '1544 MB', specialty: 'Latest-gen engine. State-of-the-art accuracy and robustness.' },
  };
  const mi = MODEL_INFO[engineId] || { name: engineId, size: '', specialty: '' };
  const modelInfo = { model: mi.name, size: mi.size, windyTune, engineId, specialty: mi.specialty };

  // If user explicitly selected cloud for listening, skip local and go straight to cloud
  if (userWantsCloud && !localOnly) {
    // Jump directly to cloud section below
  } else {

    // ── Try local Whisper engine (1 attempt — queue-level backoff handles retries) ──
    const MAX_RETRIES = 1;
    const RETRY_DELAY_MS = 1000;
    let lastLocalErr = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const serverCfg = store.get('server') || { host: '127.0.0.1', port: 9876 };
        const wsUrl = `ws://${serverCfg.host}:${serverCfg.port}`;
        const WebSocket = require('ws');

        const localResult = await new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          // Flat 8s timeout — chunks are capped at 10s (~165KB), server processes in ~5-6s
          let timeout = setTimeout(() => { ws.close(); reject(new Error('local timeout')); }, 8000);

          ws.on('open', () => {
            ws.send(JSON.stringify({
              action: 'translate_blob',
              language: sourceLang === 'auto' ? 'auto' : sourceLang,
              task: targetLang === 'en' ? 'translate' : 'transcribe'
            }));
            ws.send(audioBuffer);
          });

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'translate_result') {
                clearTimeout(timeout);
                ws.close();
                if (msg.error) reject(new Error(msg.error));
                else resolve({ text: msg.text || '', detectedLang: msg.detected_language || msg.language || sourceLang, engine: 'local', modelInfo });
              }
            } catch (e) {
              // Non-JSON message, ignore
            }
          });

          ws.on('error', () => { clearTimeout(timeout); reject(new Error('local unavailable')); });
        });

        // If target is English, Whisper already translated → done
        if (targetLang === 'en') return { ...localResult, modelInfo };

        // If target is NOT English, translate English → target
        if (localResult.text && localResult.text.trim()) {
          const textResult = await nllbTranslate(localResult.text, 'en', targetLang);
          if (textResult && textResult.ok) {
            return { text: textResult.translatedText, detectedLang: localResult.detectedLang, engine: textResult.engine || 'nllb-local', modelInfo };
          }
          return { ...localResult, modelInfo };
        }
        return { ...localResult, modelInfo };

      } catch (localErr) {
        lastLocalErr = localErr;
        if (attempt < MAX_RETRIES) {
          // Wait before retrying — server may be busy processing other chunks
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    // All retries exhausted
    if (localOnly) {
      return { error: '🔒 Local Only mode: No local engine available after ' + MAX_RETRIES + ' attempts. Server may be overloaded — try a longer chunk duration.' };
    }
  } // end else (not userWantsCloud)

  // ── Cloud fallback: Groq Whisper API ──
  try {
    const apiKey = groqKey || openaiKey;
    if (!apiKey) return { error: 'No API key. Add Groq or OpenAI key in Settings → Transcription Engine.' };

    const isGroq = !!groqKey;
    const FormData = require('form-data');
    const https = require('https');

    // Step 1: Transcribe audio via Whisper API
    const transcription = await new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', audioBuffer, { filename: 'audio.webm', contentType: 'audio/webm' });
      form.append('model', isGroq ? 'whisper-large-v3' : 'whisper-1');
      if (targetLang === 'en') form.append('response_format', 'verbose_json');

      const apiUrl = isGroq
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';
      const url = new URL(apiUrl);

      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders()
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ text: json.text || '', language: json.language || sourceLang });
          } catch (e) {
            reject(new Error('parse error'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
      form.pipe(req);
    });

    if (!transcription.text || !transcription.text.trim()) {
      return { text: '', detectedLang: transcription.language, engine: isGroq ? 'groq' : 'openai', modelInfo: { ...modelInfo, model: 'WindyCloud' } };
    }

    // Step 2: If target is different from source, translate the text
    const needsTranslation = targetLang !== sourceLang && targetLang !== 'auto';
    if (needsTranslation) {
      const textResult = await translateTextViaAI(transcription.text, transcription.language || 'auto', targetLang);
      if (textResult && textResult.ok) {
        return { text: textResult.translatedText, detectedLang: transcription.language, engine: textResult.engine || (isGroq ? 'groq' : 'openai'), modelInfo: { ...modelInfo, model: 'WindyCloud' } };
      }
    }

    return { text: transcription.text, detectedLang: transcription.language, engine: isGroq ? 'groq' : 'openai', modelInfo: { ...modelInfo, model: 'WindyCloud' } };

  } catch (cloudErr) {
    // Detect offline errors and show friendly message instead of raw ENOTFOUND
    const isOffline = cloudErr.code === 'ENOTFOUND' || cloudErr.code === 'ENETUNREACH' || cloudErr.code === 'EAI_AGAIN' || (cloudErr.message && cloudErr.message.includes('ENOTFOUND'));
    return { error: isOffline
      ? 'You\'re offline. Cloud transcription needs an internet connection — switch to a local engine in Settings, or try again when connected.'
      : `Cloud transcription failed: ${cloudErr.message}` };
  }
});

// Helper: translate text via Groq/OpenAI LLM (reused by both mini-translate-speech and translate-text)
async function translateTextViaAI(text, sourceLang, targetLang) {
  const LANG_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
    ru: 'Russian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', hi: 'Hindi',
    uk: 'Ukrainian', th: 'Thai', vi: 'Vietnamese', tr: 'Turkish', auto: 'auto-detected'
  };
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;

  const groqKey = store.get('engine.groqApiKey', '') || process.env.GROQ_API_KEY || '';
  const openaiKey = store.get('engine.openaiApiKey', '') || process.env.OPENAI_API_KEY || '';
  const apiKey = groqKey || openaiKey;
  if (!apiKey) return { ok: false, error: 'No API key' };

  const isGroq = !!groqKey;
  const apiUrl = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
  const prompt = `Translate the following text from ${srcName} to ${tgtName}. Return ONLY the translated text, nothing else.\n\n${text}`;

  const https = require('https');
  const url = new URL(apiUrl);
  const postData = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, translatedText: json.choices?.[0]?.message?.content?.trim(), engine: isGroq ? 'groq' : 'openai', confidence: 0.95 });
          } catch (e) { reject(new Error('parse error')); }
        } else { reject(new Error(`API ${res.statusCode}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// ── Wayland: HTTP control server + GNOME keybindings ─────────────────────
// On Wayland + GNOME, Electron's globalShortcut.register() doesn't fire
// reliably because Mutter intercepts X11 grabs from XWayland clients. The
// reliable path is to register custom keybindings via GNOME's own gsettings
// (gsd-media-keys), pointing them at a tiny HTTP server inside the app on
// 127.0.0.1:18765. See docs/WAYLAND-PASTE-FOCUS-GUIDE.md.
const WAYLAND_CONTROL_PORT = 18765;
let _waylandControlServer = null;
let _savedWaylandFocusTarget = null;  // Forward-compat slot (for Scope C focus restore)

// ── Settings change history (in-memory, this session only) ─────────────
// Capped ring-buffer of catalog-validated setting writes so the agent can
// answer "what did I just change?" and "undo my last change". Entries are
// pushed by applySettingChange when source !== 'undo' (undo replays
// previousValue through the same apply path but does NOT push to avoid
// an undo→undo toggle loop). Buffer survives within a single app run.
const SETTINGS_HISTORY_CAP = 50;
const SETTINGS_HISTORY = [];

function pushSettingHistory(entry) {
  SETTINGS_HISTORY.push(entry);
  while (SETTINGS_HISTORY.length > SETTINGS_HISTORY_CAP) SETTINGS_HISTORY.shift();
}

// Apply a single catalog-validated setting change. Caller MUST have
// validated `value` through settingsCatalog.validate() first. Records
// the change to SETTINGS_HISTORY unless source === 'undo'. Returns
// { previousValue, sideEffects, recordedAt }.
function applySettingChange(path, value, source) {
  const previousValue = store.get(path);
  store.set(path, value);
  console.info(`[AgentCtrl] settings.${source} ${path} = ${JSON.stringify(value)} (was ${JSON.stringify(previousValue)})`);

  const sideEffects = [];
  if (path.startsWith('hotkeys.')) {
    try {
      globalShortcut.unregisterAll();
      registerHotkeys();
      sideEffects.push('global shortcuts re-registered');
    } catch (e) {
      sideEffects.push(`hotkey re-register failed: ${e.message}`);
    }
  }
  const RENDERER_APPLY_PATHS = new Set([
    'appearance.theme',
    'analytics.enabled',
    'bottomPanel.playback',
    'bottomPanel.export',
    'bottomPanel.control',
  ]);
  if (RENDERER_APPLY_PATHS.has(path) && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('settings:apply-side-effect', { path, value });
      sideEffects.push('renderer notified for live-apply');
    } catch (e) {
      sideEffects.push(`renderer notify failed: ${e.message}`);
    }
  }
  const ENGINE_CONFIG_HOT_PATHS = {
    'engine.model': 'model',
    'engine.language': 'language',
  };
  if (ENGINE_CONFIG_HOT_PATHS[path] && pythonProcess && !pythonProcess.killed) {
    try {
      const WebSocket = require('ws');
      const cfg = store.get('server', { host: '127.0.0.1', port: 9876 });
      const ws = new WebSocket(`ws://${cfg.host}:${cfg.port}`);
      const cfgKey = ENGINE_CONFIG_HOT_PATHS[path];
      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'config', config: { [cfgKey]: value } }));
        setTimeout(() => ws.close(), 5000);
      });
      ws.on('error', () => { });
      sideEffects.push(`python engine hot-reload sent (${cfgKey})`);
    } catch (e) {
      sideEffects.push(`engine hot-reload failed: ${e.message}`);
    }
  }
  const recordedAt = Date.now();
  if (source !== 'undo') {
    pushSettingHistory({ path, previousValue, newValue: value, timestamp: recordedAt, source });
  }
  return { previousValue, sideEffects, recordedAt };
}

// ── Bulk clone-ingest helpers (chokidar + music-metadata) ──────────────
// Closes the user's natural "upload all my voice memos and make a clone"
// request. Until now /voice-clones/create handled exactly one file at a
// time, so an agent had to N-fold the call manually. These helpers
// underpin /clones/scan, /clones/bulk-ingest, and /clones/watch-folder.

// chokidar 4+ and music-metadata 11+ are ESM-only. Electron 28's bundled
// Node 18.18 doesn't support require(esm), so we dynamic-import them on
// first use and cache the module. Subsequent calls are cheap.
let _chokidarModule = null;
async function loadChokidar() {
  if (!_chokidarModule) _chokidarModule = await import('chokidar');
  return _chokidarModule.default || _chokidarModule;
}
let _musicMetadataModule = null;
async function loadMusicMetadata() {
  if (!_musicMetadataModule) _musicMetadataModule = await import('music-metadata');
  return _musicMetadataModule.default || _musicMetadataModule;
}

// Extensions we count as voice-clone training material. Audio is the
// primary target; video is included so the agent can SEE that the user
// has e.g. an old QuickTime self-recording but has to ask whether to
// strip audio before ingest (ffmpeg path is future work).
const CLONE_INGEST_AUDIO_EXTS = new Set(['.webm', '.wav', '.mp3', '.ogg', '.m4a', '.flac']);
const CLONE_INGEST_VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm']);
const CLONE_INGEST_MAX_SCAN_RESULTS = 500;
const CLONE_INGEST_MAX_DEPTH = 6;

// Recursive folder scan for media files. Robust against permission
// errors (skip + continue). Caps results so a misfire on the home
// directory doesn't return a 50MB response.
async function scanMediaFolder(rootPath, recursive) {
  const results = [];
  let truncated = false;
  async function walk(dir, depth) {
    if (results.length >= CLONE_INGEST_MAX_SCAN_RESULTS) { truncated = true; return; }
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (results.length >= CLONE_INGEST_MAX_SCAN_RESULTS) { truncated = true; return; }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < CLONE_INGEST_MAX_DEPTH) await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isAudio = CLONE_INGEST_AUDIO_EXTS.has(ext);
        const isVideo = CLONE_INGEST_VIDEO_EXTS.has(ext);
        if (!isAudio && !isVideo) continue;
        try {
          const stat = await fs.promises.stat(full);
          const item = {
            path: full,
            name: entry.name,
            ext,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            kind: isAudio ? 'audio' : 'video',
          };
          if (isAudio) {
            try {
              // music-metadata 11+ is ESM-only; Electron 28's bundled
              // Node 18.18 doesn't support require(esm), so use dynamic
              // import. _musicMetadataModule is cached at module scope.
              const mm = await loadMusicMetadata();
              const meta = await mm.parseFile(full);
              if (meta.format && typeof meta.format.duration === 'number') {
                item.durationSec = Math.round(meta.format.duration);
              }
              if (meta.format && meta.format.sampleRate) item.sampleRate = meta.format.sampleRate;
            } catch { /* metadata parse failed; skip enrichment */ }
          }
          results.push(item);
        } catch { /* stat failed; skip */ }
      }
    }
  }
  await walk(rootPath, 0);
  return { results, truncated, maxResults: CLONE_INGEST_MAX_SCAN_RESULTS };
}

// Copy N audio files into vcAudioDir + register each as a separate voice
// clone in the JSON DB. Uses ElevenLabs' multi-sample training pattern:
// each file becomes one clone entry; cloud-submission can later batch
// them. Loads + saves the JSON DB once (not per-file) for efficiency.
function bulkIngestToCloneSamples(paths, namePrefix) {
  ensureDir(vcAudioDir);
  const prefix = namePrefix || `Bulk import ${new Date().toISOString().slice(0, 10)}`;
  const data = loadVoiceClones();
  const results = [];
  for (let i = 0; i < paths.length; i++) {
    const src = paths[i];
    try {
      const srcResolved = path.resolve(src);
      if (!fs.existsSync(srcResolved)) {
        results.push({ source: src, ok: false, error: 'file not found' });
        continue;
      }
      const ext = path.extname(srcResolved).toLowerCase();
      if (!CLONE_INGEST_AUDIO_EXTS.has(ext)) {
        results.push({ source: src, ok: false, error: `unsupported extension "${ext}"`, supported: [...CLONE_INGEST_AUDIO_EXTS] });
        continue;
      }
      const id = require('crypto').randomUUID();
      const destPath = path.join(vcAudioDir, `${id}${ext}`);
      fs.copyFileSync(srcResolved, destPath);
      const clone = {
        id,
        name: paths.length === 1 ? prefix : `${prefix} (${i + 1}/${paths.length})`,
        duration: null,
        audioPath: destPath,
        status: 'ready',
        created_at: new Date().toISOString(),
      };
      data.clones.push(clone);
      results.push({ source: src, ok: true, cloneId: id, name: clone.name, copiedSizeBytes: fs.statSync(destPath).size });
    } catch (e) {
      results.push({ source: src, ok: false, error: e.message });
    }
  }
  saveVoiceClones(data);
  return results;
}

// Active folder watchers, keyed by absolute folder path. Cleared on app
// exit (in-memory only — persistence across restarts is future work).
const CLONE_WATCHERS = new Map();

function startWaylandControlServer() {
  // NOTE: originally Wayland-only for GNOME keybindings. Now the control server
  // also serves the agent-control surface (paste strategies, settings) so we
  // start it on ALL platforms — agents need it on macOS/Windows/X11 too.
  const http = require('http');
  // Edition gate: the agent-control surface is OFF in reader/lite (book-launch). On
  // macOS/Windows the control server has no other purpose (hotkeys use Electron
  // globalShortcut), so don't start it at all. On Linux it's still needed for Wayland
  // paste, so it starts but only serves the legacy paste/toggle actions (see route guard).
  const agentControl = require('./edition').AGENT_CONTROL !== false;
  if (!agentControl && !PLATFORM.isWayland) {
    console.info('[AgentCtrl] disabled in this edition — control server not started (no Wayland paste need on this platform)');
    return;
  }
  const actionHandlers = {
    'toggle-recording': () => toggleRecording(),
    'paste-transcript': () => pasteTranscript(),
    'show-hide': () => {
      const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
      const miniVisible = miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible();
      if (mainVisible) { mainWindow.hide(); showMiniWidget(); }
      else if (miniVisible) { miniWindow.hide(); userHiddenWindow = true; }
      else { userHiddenWindow = false; mainWindow.show(); mainWindow.focus(); }
    },
    'quick-translate': () => showMiniTranslateWindow(),
  };

  // Helper: read JSON body from request
  async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  _waylandControlServer = http.createServer(async (req, res) => {
    // Only accept from localhost
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403); res.end('Forbidden');
      return;
    }
    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    // Reader/lite editions: ALLOWLIST — serve ONLY the legacy Wayland-paste actions
    // (toggle-recording / paste-transcript / show-hide / quick-translate, used by GNOME
    // keybindings on Linux). EVERYTHING else — the entire agent-control surface incl.
    // /config (store dump + arbitrary mutate), /doctor/cloud-diagnose, /paste/*, /recording/*,
    // /sound-effects/*, /install, /transcribe-file, and any FUTURE route — is 404'd.
    // Allowlist by design: new endpoints are off-by-default, not exposed until whitelisted.
    if (!agentControl) {
      const LEGACY_PASTE_ACTIONS = ['toggle-recording', 'paste-transcript', 'show-hide', 'quick-translate'];
      if (!LEGACY_PASTE_ACTIONS.includes(pathname.replace(/^\//, ''))) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'agent-control is disabled in this edition' }));
        return;
      }
    }

    // ── Agent-control endpoints (paste strategy registry) ──
    try {
      // GET /paste/strategies — list all strategies with capability metadata
      if (req.method === 'GET' && pathname === '/paste/strategies') {
        const all = pasteStrategies.listStrategies();
        const available = await pasteStrategies.detectAvailable();
        const enriched = all.map(s => ({ ...s, availableOnThisMachine: available.includes(s.name) }));
        const hotkeysCfg = store.get('hotkeys');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          strategies: enriched,
          defaultChain: pasteStrategies.defaultFallbackChain(hotkeysCfg),
          hotkeyCollisionDetected: pasteStrategies.defaultFallbackChain(hotkeysCfg)[0] === 'wtype' && pasteStrategies.defaultFallbackChain(hotkeysCfg)[1] === 'ydotool_type',
        }, null, 2));
        return;
      }
      // GET /paste/active — currently selected strategy + chain
      if (req.method === 'GET' && pathname === '/paste/active') {
        const cfg = store.get('paste') || { strategy: 'auto', fallbackChain: [] };
        const hotkeysCfg = store.get('hotkeys');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          strategy: cfg.strategy,
          fallbackChain: cfg.fallbackChain,
          resolvedChain: cfg.strategy === 'auto'
            ? (cfg.fallbackChain.length > 0 ? cfg.fallbackChain : pasteStrategies.defaultFallbackChain(hotkeysCfg))
            : [cfg.strategy, ...(cfg.fallbackChain || [])],
        }, null, 2));
        return;
      }
      // POST /paste/select — set the active strategy. body: {strategy, fallbackChain?}
      if (req.method === 'POST' && pathname === '/paste/select') {
        const body = await readJsonBody(req);
        if (!body.strategy) { res.writeHead(400); res.end('strategy required'); return; }
        const s = pasteStrategies.getStrategy(body.strategy);
        if (!s && body.strategy !== 'auto') { res.writeHead(400); res.end(`unknown strategy: ${body.strategy}`); return; }
        store.set('paste.strategy', body.strategy);
        if (Array.isArray(body.fallbackChain)) {
          store.set('paste.fallbackChain', body.fallbackChain);
        }
        console.info(`[AgentCtrl] paste.strategy set to "${body.strategy}"`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, strategy: body.strategy }));
        return;
      }
      // POST /paste/test — try a strategy with a dummy paste. body: {strategy}
      // WARNING: injects test text into the focused window.
      if (req.method === 'POST' && pathname === '/paste/test') {
        const body = await readJsonBody(req);
        if (!body.strategy) { res.writeHead(400); res.end('strategy required'); return; }
        const result = await pasteStrategies.testStrategy(body.strategy);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      // POST /paste/auto — try all candidates in priority order, return winner.
      // body: {candidates?: string[], text?: string}  (text defaults to "wtest")
      if (req.method === 'POST' && pathname === '/paste/auto') {
        const body = await readJsonBody(req);
        const candidates = body.candidates || pasteStrategies.defaultFallbackChain(store.get('hotkeys'));
        const result = await pasteStrategies.autoExecute(body.text || 'wtest', candidates);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      // GET /config — return full electron-store contents
      if (req.method === 'GET' && pathname === '/config') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(store.store, null, 2));
        return;
      }
      // POST /config — patch the config. body: {path: 'a.b.c', value: …} or {patch: {…}}
      if (req.method === 'POST' && pathname === '/config') {
        const body = await readJsonBody(req);
        if (body.path && body.value !== undefined) {
          store.set(body.path, body.value);
          console.info(`[AgentCtrl] config set ${body.path} = ${JSON.stringify(body.value)}`);
        } else if (body.patch && typeof body.patch === 'object') {
          for (const [k, v] of Object.entries(body.patch)) store.set(k, v);
          console.info(`[AgentCtrl] config patched: ${Object.keys(body.patch).join(', ')}`);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // GET /paste/history — last N paste attempts with full diagnostic data.
      // Use ?limit=N (default 20). Each entry has timestamp, length, hash (not
      // the actual text), strategy chain attempted, winner, target type.
      if (req.method === 'GET' && pathname === '/paste/history') {
        const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
        const history = pasteStrategies.getHistory(limit);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ count: history.length, history }, null, 2));
        return;
      }
      // POST /paste/history/clear — reset the buffer (useful for stress tests)
      if (req.method === 'POST' && pathname === '/paste/history/clear') {
        pasteStrategies.clearHistory();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // GET /paste/target — what xdotool sees for the focused window
      // (xwayland / wayland-native / unknown) — useful for agents to verify
      // their assumptions about the user's environment.
      if (req.method === 'GET' && pathname === '/paste/target') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ targetType: pasteStrategies.detectTargetType() }));
        return;
      }
      // GET /hotkeys — list all keyboard shortcuts with defaults + current bindings
      if (req.method === 'GET' && pathname === '/hotkeys') {
        const hotkeys = store.get('hotkeys') || {};
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          bindings: hotkeys,
          available: ['toggleRecording', 'pasteTranscript', 'pasteClipboard', 'showHide', 'quickTranslate'],
          reserved: ['CommandOrControl+V', 'CommandOrControl+C', 'CommandOrControl+X', 'CommandOrControl+Z',
                     'CommandOrControl+A', 'CommandOrControl+S', 'CommandOrControl+F', 'CommandOrControl+P',
                     'CommandOrControl+N', 'CommandOrControl+W', 'CommandOrControl+T', 'CommandOrControl+Q',
                     'Alt+F4'],
        }, null, 2));
        return;
      }
      // POST /hotkeys — rebind. body: {key: 'toggleRecording', accelerator: 'Ctrl+Shift+Space'}
      if (req.method === 'POST' && pathname === '/hotkeys') {
        const body = await readJsonBody(req);
        if (!body.key || !body.accelerator) { res.writeHead(400); res.end('key + accelerator required'); return; }
        store.set(`hotkeys.${body.key}`, body.accelerator);
        try {
          globalShortcut.unregisterAll();
          registerHotkeys();
        } catch (e) { console.warn('[AgentCtrl] hotkey re-register failed:', e.message); }
        console.info(`[AgentCtrl] hotkeys.${body.key} = ${body.accelerator}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, key: body.key, accelerator: body.accelerator }));
        return;
      }
      // POST /hotkeys/reset — restore all hotkeys to catalog defaults and
      // re-register. Mirrors the "Reset All to Defaults" button in Settings →
      // Customizable Keyboard Shortcuts. Returns the new bindings so the
      // agent can confirm what was applied. Idempotent.
      if (req.method === 'POST' && pathname === '/hotkeys/reset') {
        const HOTKEY_KEYS = ['toggleRecording', 'pasteTranscript', 'pasteClipboard', 'showHide', 'quickTranslate'];
        const applied = {};
        for (const key of HOTKEY_KEYS) {
          const entry = settingsCatalog.describe(`hotkeys.${key}`);
          if (entry && entry.default) {
            store.set(`hotkeys.${key}`, entry.default);
            applied[key] = entry.default;
          }
        }
        try {
          globalShortcut.unregisterAll();
          registerHotkeys();
        } catch (e) { console.warn('[AgentCtrl] hotkey reset re-register failed:', e.message); }
        console.info(`[AgentCtrl] hotkeys reset to defaults: ${JSON.stringify(applied)}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied }, null, 2));
        return;
      }
      // POST /open-url — open an http/https URL or one of the Windy
      // ecosystem schemes in the user's default browser via Electron's
      // shell.openExternal. Mirrors what UI buttons like "View all history
      // in Web Portal" and the Upgrade flow do. Rejects file:// and other
      // schemes that could exfiltrate or run code.
      // Body: { url: "https://..." }
      if (req.method === 'POST' && pathname === '/open-url') {
        const body = await readJsonBody(req);
        if (!body.url || typeof body.url !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.url (string) required' }));
          return;
        }
        let parsed;
        try { parsed = new URL(body.url); } catch (_) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `not a valid URL: ${body.url}` }));
          return;
        }
        const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'windypro:', 'windychat:', 'windyword:', 'windyfly:']);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `protocol ${parsed.protocol} not allowed`, allowed: [...ALLOWED_PROTOCOLS] }));
          return;
        }
        try {
          await shell.openExternal(body.url);
          console.info(`[AgentCtrl] open-url: ${body.url}`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, url: body.url, protocol: parsed.protocol }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `shell.openExternal failed: ${e.message}` }));
        }
        return;
      }
      // GET /models — list available transcription models + current selection
      if (req.method === 'GET' && pathname === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          current: store.get('engine.model'),
          engine: store.get('engine.engine'),
          ladder: WINDYTUNE_MODEL_LADDER,
          // Advertise the same ct2 engine ids the ladder validates against, so
          // /models GET and POST agree. fastest/lightest → most accurate.
          available: [
            { id: 'windy-nano-ct2',       speed: 'fastest',  accuracy: 'basic' },
            { id: 'windy-lite-ct2',       speed: 'fast',     accuracy: 'good' },
            { id: 'windy-core-ct2',       speed: 'medium',   accuracy: 'better' },
            { id: 'windy-edge-ct2',       speed: 'medium',   accuracy: 'better' },
            { id: 'windy-plus-ct2',       speed: 'slow',     accuracy: 'high' },
            { id: 'windy-turbo-ct2',      speed: 'slow',     accuracy: 'high' },
            { id: 'windy-pro-engine-ct2', speed: 'slowest',  accuracy: 'best' },
          ].filter(m => WINDYTUNE_ALL_LADDER.includes(m.id)),
        }, null, 2));
        return;
      }
      // POST /models — select a model. body: {model: 'small'}
      if (req.method === 'POST' && pathname === '/models') {
        const body = await readJsonBody(req);
        if (!body.model) { res.writeHead(400); res.end('model required'); return; }
        if (!WINDYTUNE_MODEL_LADDER.includes(body.model)) {
          res.writeHead(400); res.end(`unknown model: ${body.model}`); return;
        }
        store.set('engine.model', body.model);
        console.info(`[AgentCtrl] engine.model set to "${body.model}"`);
        // Hot-reload the Python engine if running
        if (pythonProcess && !pythonProcess.killed) {
          try {
            const WebSocket = require('ws');
            const cfg = store.get('server', { host: '127.0.0.1', port: 9876 });
            const ws = new WebSocket(`ws://${cfg.host}:${cfg.port}`);
            ws.on('open', () => {
              ws.send(JSON.stringify({ action: 'config', config: { model: body.model } }));
              setTimeout(() => ws.close(), 5000);
            });
            ws.on('error', () => { });
          } catch (_) { }
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, model: body.model }));
        return;
      }
      // GET /windytune/state — current model, history of timings, ladder, thresholds
      // Agents use this to see if auto-tune is actively switching models.
      if (req.method === 'GET' && pathname === '/windytune/state') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          enabled: store.get('engine.engine') === 'windytune',
          currentModel: store.get('engine.model'),
          ladder: WINDYTUNE_MODEL_LADDER,
          thresholds: WINDYTUNE_THRESHOLDS,
          historyCount: _windyTuneHistory.length,
          history: _windyTuneHistory.slice(),
          recentAvgRatio: _windyTuneHistory.length > 0
            ? +(_windyTuneHistory.reduce((s, h) => s + h.ratio, 0) / _windyTuneHistory.length).toFixed(2)
            : null,
        }, null, 2));
        return;
      }
      // GET /platform — environment info for agents
      if (req.method === 'GET' && pathname === '/platform') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          os: process.platform,
          arch: process.arch,
          distro: PLATFORM.distro,
          distroVersion: PLATFORM.distroVersion,
          displayServer: PLATFORM.displayServer,
          desktop: PLATFORM.desktop,
          hasXdotool: PLATFORM.hasXdotool,
          hasYdotool: PLATFORM.hasYdotool,
          version: app.getVersion(),
          electronVersion: process.versions.electron,
          nodeVersion: process.versions.node,
        }, null, 2));
        return;
      }
      // POST /updates/check — trigger the electron-updater check. Returns
      // immediately; the actual check happens asynchronously. Agents can
      // poll get_config lastUpdateCheck to see when it last ran. Safe to
      // call — only DOWNLOADS the update; does NOT install (install requires
      // a separate user-driven quitAndInstall via the in-app button).
      if (req.method === 'POST' && pathname === '/updates/check') {
        try {
          const { autoUpdater } = require('electron-updater');
          autoUpdater.checkForUpdates().catch((e) => {
            console.warn('[updates/check] electron-updater rejected:', e.message);
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            currentVersion: app.getVersion(),
            message: 'update check fired; poll lastUpdateCheck or watch for in-app toast.',
          }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `electron-updater unavailable: ${e.message}` }));
        }
        return;
      }
      // ── Window + state observability (Wave W1 — UI-parity sweep) ──
      // Wraps the existing renderer→main IPC handlers so agents can do
      // what a user does with the title bar buttons: minimize, maximize,
      // bring-to-front, resize, zoom. Plus a single GET /window for state
      // snapshot and GET /recording/state for the recording-flow state.
      if (req.method === 'GET' && pathname === '/window') {
        const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          exists: !!(mainWindow && !mainWindow.isDestroyed()),
          maximized: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false,
          minimized: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMinimized() : false,
          focused: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFocused() : false,
          visible: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isVisible() : false,
          fullScreen: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false,
          simpleFullScreen: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isSimpleFullScreen?.() : false,
          bounds,
          fontSize: store.get('appearance.fontSize') || 100,
          opacity: store.get('appearance.opacity'),
          alwaysOnTop: store.get('appearance.alwaysOnTop'),
        }, null, 2));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/minimize') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'minimize' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/maximize') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.maximize();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'maximize' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/unmaximize') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.unmaximize();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'unmaximize' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/bring-to-front') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          // On macOS show() on a focusable:false window is a no-op for
          // focus; just raise to top. Caller should know they aren't
          // guaranteed input focus on this platform.
          try { mainWindow.moveTop(); } catch (_) { /* not all platforms */ }
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'bring-to-front', focused: mainWindow?.isFocused?.() }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/geometry') {
        const body = await readJsonBody(req);
        const { x, y, width, height } = body || {};
        if ([x, y, width, height].some(v => typeof v !== 'number')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body must be {x,y,width,height} all numbers' }));
          return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setBounds({ x, y, width, height });
        }
        // Persist so it survives restart
        store.set('window', { x, y, width, height });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bounds: { x, y, width, height } }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/font-size') {
        const body = await readJsonBody(req);
        const clamped = Math.max(70, Math.min(150, Number(body?.percent) || 100));
        store.set('appearance.fontSize', clamped);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('font-size-changed', clamped);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, fontSize: clamped }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/video-fullscreen') {
        const body = await readJsonBody(req);
        const on = !!body?.on;
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(on);
            else mainWindow.setFullScreen(on);
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
            return;
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, on, mode: process.platform === 'darwin' ? 'simple' : 'native' }));
        return;
      }
      if (req.method === 'GET' && pathname === '/recording/state') {
        // Recording-flow state observability. The RENDERER is the source of
        // truth for isRecording — the agentBridge `start_recording` flow
        // (Wave W5) only updates renderer state, while main's `isRecording`
        // variable is only toggled by the legacy GNOME-keybinding path. We
        // bridge through to the renderer so agents always see real state.
        // Fall back to main's variable if the bridge is unavailable
        // (renderer destroyed or not yet armed).
        const bridge = await _callAgentBridge('get_recording_status');
        const rendererTruth = bridge.ok ? !!bridge.isRecording : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          isRecording: rendererTruth !== null ? rendererTruth : isRecording,
          source: rendererTruth !== null ? 'renderer' : 'main-fallback',
          currentState: bridge.ok ? bridge.currentState : null,
          engine: bridge.ok ? bridge.engine : null,
          mode: bridge.ok ? bridge.mode : null,
          pythonEngineRunning: !!(pythonProcess && !pythonProcess.killed),
          // last paste attempt is available via /paste/history; surface count here
          // so an agent can detect whether activity has happened since last poll.
          totalPasteAttempts: pasteStrategies?.getHistory?.(9999)?.length ?? null,
        }, null, 2));
        return;
      }
      // GET /install/capabilities — what whitelisted tools the agent can
      // install on this machine + the resolved install command per tool.
      // Always safe to call (no system mutation).
      if (req.method === 'GET' && pathname === '/install/capabilities') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(installer.listInstallable(PLATFORM), null, 2));
        return;
      }
      // POST /install — install a whitelisted tool via the distro package
      // manager wrapped in pkexec. Triggers a polkit GUI prompt that the
      // user must approve. Body: {tool: string, dryRun?: boolean}.
      // Returns the full audit record (command, exit code, stdout/stderr,
      // elapsed ms, whether the tool is now on PATH).
      if (req.method === 'POST' && pathname === '/install') {
        const body = await readJsonBody(req);
        if (!body.tool || typeof body.tool !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'tool (string) required' }));
          return;
        }
        console.info(`[AgentCtrl] install requested: ${body.tool}${body.dryRun ? ' (dry-run)' : ''}`);
        const result = await installer.install(body.tool, PLATFORM, { dryRun: !!body.dryRun });
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // GET /install/history — recent install attempts (in-memory audit log).
      // Resets at app restart. Useful for agents diagnosing why a paste
      // strategy is still missing after a recent install attempt.
      if (req.method === 'GET' && pathname === '/install/history') {
        const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ history: installer.getAuditLog(limit) }, null, 2));
        return;
      }
      // POST /install/history/clear — wipe the in-memory audit log.
      if (req.method === 'POST' && pathname === '/install/history/clear') {
        installer.clearAuditLog();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // ── Transcribe arbitrary audio file (v0.11.0) ─────────────────────
      // POST /transcribe-file body={path, language?:"en"}. Reads any
      // audio file (wav/mp3/m4a/ogg/flac/webm), runs the same
      // ffmpeg → WebSocket-Python pipeline batch-transcribe-local uses,
      // returns {ok, transcript, transcribeMs, audioDurationSec,
      // modelUsed, ratio}.
      //
      // 60s ffmpeg ceiling + 120s WS ceiling (inside _transcribeAudioFile).
      // Designed for individual files; agents that want bulk processing
      // should loop over a directory and call this per file.
      if (req.method === 'POST' && pathname === '/transcribe-file') {
        const body = await readJsonBody(req);
        if (!body.path) { res.writeHead(400); res.end('path required'); return; }
        let resolvedPath;
        try { resolvedPath = path.resolve(body.path); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `bad path: ${e.message}` })); return;
        }
        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file not found: ${resolvedPath}` }));
          return;
        }
        const stat = fs.statSync(resolvedPath);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB > 500) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file too large (${sizeMB.toFixed(1)}MB); cap is 500MB`, sizeBytes: stat.size }));
          return;
        }
        try {
          const start = Date.now();
          const result = await _transcribeAudioFile(resolvedPath, { language: body.language });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ...result,
            path: resolvedPath,
            sizeBytes: stat.size,
            totalElapsedMs: Date.now() - start,
          }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, path: resolvedPath }));
        }
        return;
      }

      // ── Sound-effects + widget customization (v1.3.0) ──────────────────
      // Renderer state (effects-engine, widget-engine, localStorage) is
      // reachable via the agent IPC bridge — main.js sends 'agent:request'
      // {requestId, op, args}; renderer dispatches in app.js's
      // initAgentBridge() and replies on 'agent:reply'. One helper + many
      // thin endpoints.
      async function _callAgentBridge(op, args = {}, timeoutMs = 3000) {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return { ok: false, error: 'main window not available — Windy Word UI may be closed' };
        }
        const requestId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return new Promise((resolve) => {
          const handler = (_e, msg) => {
            if (msg?.requestId !== requestId) return;
            ipcMain.removeListener('agent:reply', handler);
            clearTimeout(timer);
            resolve(msg);
          };
          const timer = setTimeout(() => {
            ipcMain.removeListener('agent:reply', handler);
            resolve({ ok: false, error: `agent bridge timed out after ${timeoutMs}ms (renderer dispatcher may not be armed yet)` });
          }, timeoutMs);
          ipcMain.on('agent:reply', handler);
          try {
            mainWindow.webContents.send('agent:request', { requestId, op, args });
          } catch (e) {
            clearTimeout(timer);
            ipcMain.removeListener('agent:reply', handler);
            resolve({ ok: false, error: `webContents.send failed: ${e.message}` });
          }
        });
      }

      // GET /sound-effects/state — full effects state via bridge.
      if (req.method === 'GET' && pathname === '/sound-effects/state') {
        const result = await _callAgentBridge('get_effects_state');
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // GET /sound-effects/packs — EffectsEngine pack catalog via bridge.
      if (req.method === 'GET' && pathname === '/sound-effects/packs') {
        const result = await _callAgentBridge('list_effect_packs');
        const count = Array.isArray(result.packs) ? result.packs.length : 0;
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ...result, count,
          hookStages: ['start', 'during', 'stop', 'process', 'warning', 'paste'],
        }, null, 2));
        return;
      }
      // POST /sound-effects/hook body={hook, enabled?, volume?}
      if (req.method === 'POST' && pathname === '/sound-effects/hook') {
        const body = await readJsonBody(req);
        if (!body.hook) { res.writeHead(400); res.end('hook required'); return; }
        const result = await _callAgentBridge('set_hook', body);
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // POST /sound-effects/active-pack body={packId}
      if (req.method === 'POST' && pathname === '/sound-effects/active-pack') {
        const body = await readJsonBody(req);
        if (!body.packId) { res.writeHead(400); res.end('packId required'); return; }
        const result = await _callAgentBridge('set_active_pack', body);
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // POST /sound-effects/master-volume body={volume:0-100}
      if (req.method === 'POST' && pathname === '/sound-effects/master-volume') {
        const body = await readJsonBody(req);
        if (typeof body.volume !== 'number') { res.writeHead(400); res.end('volume (0-100 number) required'); return; }
        const result = await _callAgentBridge('set_master_sfx_volume', body);
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // POST /sound-effects/mode body={mode}
      if (req.method === 'POST' && pathname === '/sound-effects/mode') {
        const body = await readJsonBody(req);
        if (!body.mode) { res.writeHead(400); res.end('mode required'); return; }
        const result = await _callAgentBridge('set_effect_mode', body);
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // GET /widget/state — widget runtime + persisted state via bridge.
      if (req.method === 'GET' && pathname === '/widget/state') {
        const result = await _callAgentBridge('get_widget_state');
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }

      // ── Recording lifecycle + audio devices (Wave W5) ─────────────────
      // Agent recording verbs. The renderer's toggleRecording() owns the
      // mode/engine dispatch (batch / api / stream) and the Wayland
      // setFocusable discipline, so we bridge through it rather than
      // poking media APIs from main. GET /recording/state is exposed
      // separately (Wave W1) for state polling.

      // POST /recording/start — begin recording (mode-aware).
      // Idempotent: returns ok with alreadyRecording=true if already capturing.
      if (req.method === 'POST' && pathname === '/recording/start') {
        const result = await _callAgentBridge('start_recording');
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // POST /recording/stop — end the current recording (triggers the
      // transcription + paste pipeline against the focused window).
      // Idempotent: returns ok with alreadyStopped=true if nothing is recording.
      if (req.method === 'POST' && pathname === '/recording/stop') {
        const result = await _callAgentBridge('stop_recording');
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // GET /audio/devices — enumerate microphones via the renderer's
      // MediaDevices API. Returns each device with deviceId / label /
      // isCurrent plus the currently-selected micDeviceId. Labels are
      // hidden until mic permission has been granted at least once —
      // the response carries a hint when that is the case.
      if (req.method === 'GET' && pathname === '/audio/devices') {
        const result = await _callAgentBridge('list_audio_devices');
        res.writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // ── Voice clone cloud submit (Wave W6) ─────────────────────────────
      // POST /clones/cloud/submit body={cloneId} — submit a local voice
      // clone to Windy Clone for ElevenLabs training. Idempotent on
      // cloud_order_id (returns ok:false + the existing order_id if already
      // submitted). Requires the user to be signed in to their Windy
      // account (auth.token in electron-store). Use get_cloud_clone_order_status
      // to poll training progress with the returned order_id.
      if (req.method === 'POST' && pathname === '/clones/cloud/submit') {
        const body = await readJsonBody(req);
        if (!body.cloneId || typeof body.cloneId !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'cloneId (string) required' }));
          return;
        }
        const result = await _submitVoiceCloneToCloud(body.cloneId);
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }

      // ── Misc utilities (v0.10.0) ───────────────────────────────────────
      // GET /hardware — system info (RAM, CPU, GPU, disk free, platform/arch).
      // Pure read, no system mutation. Useful for Doctor + model selection.
      if (req.method === 'GET' && pathname === '/hardware') {
        const result = {
          totalRAM: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
          freeRAM: Math.round(os.freemem() / (1024 * 1024 * 1024)),
          cpuModel: os.cpus()[0]?.model || 'Unknown',
          cpuCores: os.cpus().length,
          platform: process.platform,
          arch: process.arch,
          gpu: null,
          diskFreeGB: null,
        };
        if (process.platform === 'darwin' && process.arch === 'arm64') {
          result.gpu = { name: 'Apple Silicon (Metal/MPS)', vramMB: 0, type: 'mps' };
        } else if (process.platform !== 'darwin') {
          try {
            const gpuInfo = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000 }).toString().trim();
            if (gpuInfo) {
              const [name, vramMB] = gpuInfo.split(', ');
              result.gpu = { name: name.trim(), vramMB: parseInt(vramMB) || 0, type: 'cuda' };
            }
          } catch (_) { /* no nvidia GPU */ }
        }
        try {
          if (process.platform !== 'win32') {
            const out = execFileSync('df', ['-BG', os.homedir()], { timeout: 3000 }).toString();
            const lines = out.trim().split('\n');
            if (lines.length >= 2) {
              const cols = lines[1].split(/\s+/);
              if (cols.length >= 4) result.diskFreeGB = parseInt(cols[3]) || null;
            }
          }
        } catch (_) { /* best-effort */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      // POST /autostart body={enable: bool} — toggle app autostart on boot.
      // Linux: writes/removes ~/.config/autostart/windy-pro.desktop.
      // macOS: writes/removes LaunchAgent plist (handled by the existing IPC).
      // Returns the resulting state so agents can verify.
      if (req.method === 'POST' && pathname === '/autostart') {
        const body = await readJsonBody(req);
        if (typeof body.enable !== 'boolean') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'enable (boolean) required' }));
          return;
        }
        try {
          if (process.platform === 'linux') {
            const autostartDir = path.join(os.homedir(), '.config', 'autostart');
            const desktopFile = path.join(autostartDir, 'windy-pro.desktop');
            if (body.enable) {
              if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
              const appPath = process.execPath;
              const iconCandidates = [
                path.join(path.dirname(appPath), 'resources', 'app', 'assets', 'icon.png'),
                path.join(path.dirname(appPath), 'resources', 'assets', 'icon.png'),
                path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
              ];
              const iconPath = iconCandidates.find(p => fs.existsSync(p)) || 'windy-pro';
              fs.writeFileSync(desktopFile, `[Desktop Entry]\nType=Application\nName=Windy Word\nExec=${appPath}\nIcon=${iconPath}\nComment=Voice-to-text transcription\nX-GNOME-Autostart-enabled=true\nStartupNotify=false\n`);
            } else if (fs.existsSync(desktopFile)) {
              fs.unlinkSync(desktopFile);
            }
            const currentlyEnabled = fs.existsSync(desktopFile);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, platform: 'linux', enabled: currentlyEnabled, desktopFile }));
            return;
          }
          if (process.platform === 'darwin') {
            app.setLoginItemSettings({ openAtLogin: body.enable });
            const s = app.getLoginItemSettings();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, platform: 'darwin', enabled: s.openAtLogin }));
            return;
          }
          if (process.platform === 'win32') {
            app.setLoginItemSettings({ openAtLogin: body.enable, path: process.execPath });
            const s = app.getLoginItemSettings();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, platform: 'win32', enabled: s.openAtLogin }));
            return;
          }
          res.writeHead(501, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `unsupported platform: ${process.platform}` }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // GET /autostart — return current autostart status without changing it.
      if (req.method === 'GET' && pathname === '/autostart') {
        try {
          if (process.platform === 'linux') {
            const desktopFile = path.join(os.homedir(), '.config', 'autostart', 'windy-pro.desktop');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ platform: 'linux', enabled: fs.existsSync(desktopFile), desktopFile }));
            return;
          }
          const s = app.getLoginItemSettings();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ platform: process.platform, enabled: s.openAtLogin }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // ── Translation (v0.9.0) ───────────────────────────────────────────
      // POST /translate body={text, sourceLang?, targetLang}. Tries the
      // translation-memory cache first; on miss, falls through to the same
      // Groq/OpenAI path the renderer uses. Stores the result in TM so
      // subsequent calls are free + instant.
      if (req.method === 'POST' && pathname === '/translate') {
        const body = await readJsonBody(req);
        if (!body.text || !body.targetLang) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'text and targetLang required' }));
          return;
        }
        const srcLang = body.sourceLang || 'auto';
        const tgtLang = body.targetLang;
        // TM lookup first (only when sourceLang is concrete — "auto" key
        // would never match anything stored under a specific source)
        let fromCache = false;
        if (srcLang !== 'auto') {
          try {
            const db = getTMDb && getTMDb();
            if (db) {
              const row = db.prepare('SELECT target FROM translations WHERE source = ? AND source_lang = ? AND target_lang = ?')
                .get(body.text.substring(0, 500), srcLang, tgtLang);
              if (row && row.target) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, translation: row.target, fromCache: true, sourceLang: srcLang, targetLang: tgtLang }));
                return;
              }
            }
          } catch (_) { /* fall through to API */ }
        }
        // Cache miss — call into the same translate-text logic by directly
        // invoking translateViaAI which is the function the IPC handler
        // also uses. If it's not in scope here, fall back to building the
        // request inline.
        try {
          const result = (typeof translateViaAI === 'function')
            ? await translateViaAI(body.text, srcLang, tgtLang)
            : null;
          if (result && result.ok) {
            // Store in TM (only when sourceLang is concrete)
            if (srcLang !== 'auto') {
              try {
                const db = getTMDb && getTMDb();
                if (db) {
                  db.prepare('INSERT OR IGNORE INTO translations (source, target, source_lang, target_lang) VALUES (?, ?, ?, ?)')
                    .run(body.text.substring(0, 500), (result.translatedText || '').substring(0, 2000), srcLang, tgtLang);
                }
              } catch (_) { }
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              ok: true, translation: result.translatedText, fromCache: false,
              sourceLang: srcLang, targetLang: tgtLang,
              engine: result.engine, confidence: result.confidence,
            }));
            return;
          }
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'translation upstream failed', detail: result }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // POST /translation-memory/lookup body={text, sourceLang, targetLang}
      if (req.method === 'POST' && pathname === '/translation-memory/lookup') {
        const body = await readJsonBody(req);
        if (!body.text || !body.sourceLang || !body.targetLang) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'text, sourceLang, targetLang required' }));
          return;
        }
        try {
          const db = getTMDb && getTMDb();
          if (!db) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'TM DB unavailable', match: null }));
            return;
          }
          const row = db.prepare('SELECT target AS translation, hits FROM translations WHERE source = ? AND source_lang = ? AND target_lang = ?')
            .get(body.text.substring(0, 500), body.sourceLang, body.targetLang);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, match: row || null }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // POST /translation-memory/save body={source, target, sourceLang, targetLang}
      if (req.method === 'POST' && pathname === '/translation-memory/save') {
        const body = await readJsonBody(req);
        if (!body.source || !body.target || !body.sourceLang || !body.targetLang) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'source, target, sourceLang, targetLang required' }));
          return;
        }
        try {
          const db = getTMDb && getTMDb();
          if (!db) { res.writeHead(500); res.end('TM DB unavailable'); return; }
          const existing = db.prepare('SELECT id FROM translations WHERE source = ? AND source_lang = ? AND target_lang = ?')
            .get(body.source.substring(0, 500), body.sourceLang, body.targetLang);
          if (existing) {
            db.prepare('UPDATE translations SET target = ?, hits = hits + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(body.target.substring(0, 2000), existing.id);
          } else {
            db.prepare('INSERT INTO translations (source, target, source_lang, target_lang) VALUES (?, ?, ?, ?)')
              .run(body.source.substring(0, 500), body.target.substring(0, 2000), body.sourceLang, body.targetLang);
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, updated: !!existing }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // GET /translation-memory/stats
      if (req.method === 'GET' && pathname === '/translation-memory/stats') {
        try {
          const db = getTMDb && getTMDb();
          if (!db) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ totalEntries: 0, topPairs: [], recentEntries: [] }));
            return;
          }
          const total = db.prepare('SELECT COUNT(*) as count FROM translations').get().count;
          const topPairs = db.prepare('SELECT source_lang, target_lang, COUNT(*) as count FROM translations GROUP BY source_lang, target_lang ORDER BY count DESC LIMIT 10').all();
          const recent = db.prepare('SELECT source, target, source_lang AS sourceLang, target_lang AS targetLang, hits, created_at FROM translations ORDER BY updated_at DESC LIMIT 50').all();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ totalEntries: total, topPairs, recentEntries: recent }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }
      // POST /translation-memory/clear — wipe the TM.
      if (req.method === 'POST' && pathname === '/translation-memory/clear') {
        try {
          const db = getTMDb && getTMDb();
          if (db) db.prepare('DELETE FROM translations').run();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // ── Documents (v0.9.0) ─────────────────────────────────────────────
      // POST /docs/extract body={path, maxBytes?} — path-based document
      // text extraction. Supports txt/md/html/csv (plain), pdf (regex
      // scrape), docx (xml-strip). 5MB cap by default. Returns plain text.
      if (req.method === 'POST' && pathname === '/docs/extract') {
        const body = await readJsonBody(req);
        if (!body.path) { res.writeHead(400); res.end('path required'); return; }
        const maxBytes = Math.min(20 * 1024 * 1024, Math.max(1024, body.maxBytes || 5 * 1024 * 1024));
        let resolvedPath;
        try { resolvedPath = path.resolve(body.path); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `bad path: ${e.message}` })); return;
        }
        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file not found: ${resolvedPath}` }));
          return;
        }
        const stat = fs.statSync(resolvedPath);
        if (stat.size > maxBytes) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file too large (${stat.size} bytes; limit ${maxBytes}). Pass maxBytes to override (up to 20MB).` }));
          return;
        }
        const buf = fs.readFileSync(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase().replace(/^\./, '');
        let text = '';
        try {
          if (ext === 'txt' || ext === 'md' || ext === 'csv') text = buf.toString('utf8');
          else if (ext === 'html' || ext === 'htm') text = buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          else if (ext === 'pdf') {
            const str = buf.toString('latin1');
            const parts = [];
            const regex = /\(([^)]+)\)/g;
            let m; while ((m = regex.exec(str)) !== null) {
              if (m[1].length > 2 && /[a-zA-Z]/.test(m[1])) parts.push(m[1]);
            }
            text = parts.join(' ') || '[PDF text extraction yielded nothing — regex scrape failed; agent should fall back to OCR]';
          } else if (ext === 'docx') {
            try {
              const AdmZip = require('adm-zip');
              const zip = new AdmZip(buf);
              const docXml = zip.readAsText('word/document.xml');
              text = docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            } catch (e) { text = `[DOCX extraction failed: ${e.message}]`; }
          } else {
            res.writeHead(415, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `unsupported extension ".${ext}"`, supported: ['txt', 'md', 'csv', 'html', 'pdf', 'docx'] }));
            return;
          }
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: resolvedPath, ext, sizeBytes: stat.size, textLength: text.length, text }, null, 2));
        return;
      }
      // POST /docs/save body={path, content, overwrite?:bool}
      // Path-based text-file write. Default: refuse to overwrite existing
      // files unless overwrite=true. Returns the resolved path and bytes
      // written.
      if (req.method === 'POST' && pathname === '/docs/save') {
        const body = await readJsonBody(req);
        if (!body.path || body.content === undefined) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'path and content required' }));
          return;
        }
        let resolvedPath;
        try { resolvedPath = path.resolve(body.path); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `bad path: ${e.message}` })); return;
        }
        if (fs.existsSync(resolvedPath) && !body.overwrite) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'file exists; pass overwrite=true to replace', existingSizeBytes: fs.statSync(resolvedPath).size }));
          return;
        }
        try {
          ensureDir(path.dirname(resolvedPath));
          const data = typeof body.content === 'string' ? body.content : JSON.stringify(body.content, null, 2);
          fs.writeFileSync(resolvedPath, data, 'utf8');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: resolvedPath, bytesWritten: Buffer.byteLength(data, 'utf8') }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // ── Archive surface (v0.8.0) ────────────────────────────────────────
      // Wraps the existing archive on-disk format but exposes opaque ids
      // instead of filesystem paths. Helpers _agentArchiveScan +
      // _agentResolveArchiveId live near the IPC handlers.

      // GET /archive — list all entries (text + metadata, no media bytes).
      // Supports ?limit=N to cap the result set (default 200, max 1000).
      if (req.method === 'GET' && pathname === '/archive') {
        const limit = Math.min(1000, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '200', 10)));
        const all = _agentArchiveScan();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ count: all.length, limit, entries: all.slice(0, limit) }, null, 2));
        return;
      }
      // GET /archive/stats — cached aggregate stats (30s TTL on the cache).
      // Returns: totalFiles, totalSizeMB, days, audioHours, videoHours,
      // totalWords, totalSessions, totalChars.
      if (req.method === 'GET' && pathname === '/archive/stats') {
        try {
          const archiveRoot = getArchiveFolder();
          try { await fsp.access(archiveRoot); } catch {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0, wpm: 0, streak: 0 }));
            return;
          }
          if (_archiveStatsCache && Date.now() - _archiveStatsCacheTime < ARCHIVE_STATS_CACHE_TTL) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ...(_archiveStatsCache), cached: true, cacheAgeSec: Math.round((Date.now() - _archiveStatsCacheTime) / 1000) }, null, 2));
            return;
          }
          // Inline scan (mirrors the IPC handler but without the cache write since this is a separate channel).
          let totalFiles = 0, totalSize = 0; const days = new Set();
          let audioBytes = 0, videoBytes = 0, totalWords = 0, totalSessions = 0, totalChars = 0;
          const items = await fsp.readdir(archiveRoot);
          for (const item of items) {
            const itemPath = path.join(archiveRoot, item);
            const stat = await fsp.stat(itemPath);
            if (!stat.isDirectory()) continue;
            days.add(item);
            const files = await fsp.readdir(itemPath);
            for (const file of files) {
              totalFiles++;
              try {
                const fStat = await fsp.stat(path.join(itemPath, file));
                totalSize += fStat.size;
                if (file.endsWith('.webm') && file.includes('-video')) videoBytes += fStat.size;
                else if (file.endsWith('.webm') || file.endsWith('.wav')) audioBytes += fStat.size;
                else if (file.endsWith('.md') && file !== `${item}.md`) {
                  totalSessions++;
                  try {
                    const content = await fsp.readFile(path.join(itemPath, file), 'utf-8');
                    const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
                    const text = textLines.join(' ').trim();
                    totalWords += text.split(/\s+/).filter(Boolean).length;
                    totalChars += text.length;
                  } catch (_) {}
                }
              } catch (_) {}
            }
          }
          const result = {
            totalFiles,
            totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10,
            days: days.size,
            audioHours: Math.round((audioBytes / 1024 / 16) / 3600 * 100) / 100,
            videoHours: Math.round((videoBytes / 1024 / 100) / 3600 * 100) / 100,
            totalWords, totalSessions, totalChars,
            cached: false,
          };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }
      // POST /archive/read body={id, mediaType:"audio"|"video", metadataOnly?}
      // Returns the entry's metadata plus (unless metadataOnly) base64 of the
      // requested media stream. Path-confined to the archive root.
      if (req.method === 'POST' && pathname === '/archive/read') {
        const body = await readJsonBody(req);
        if (!body.id) { res.writeHead(400); res.end('id required'); return; }
        const mediaType = body.mediaType === 'video' ? 'video' : 'audio';
        const resolved = _agentResolveArchiveId(body.id);
        if (!resolved) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `no archive entry with id ${body.id}` }));
          return;
        }
        const mediaPath = mediaType === 'video' ? resolved.videoPath : resolved.audioPath;
        if (!mediaPath || !fs.existsSync(mediaPath)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: body.id, mediaType, present: false, mdPath: undefined }));
          return;
        }
        const out = { ok: true, id: body.id, mediaType, present: true, mimeType: mediaType === 'video' ? 'video/webm' : 'audio/webm' };
        if (!body.metadataOnly) {
          const buf = fs.readFileSync(mediaPath);
          out.audioSizeBytes = buf.length;
          out.base64 = buf.toString('base64');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out, null, 2));
        return;
      }
      // POST /archive/search body={query, limit?, caseInsensitive?, includeBody?}
      //   Full-text search across every archived transcript. Substring match
      //   by default; pass caseInsensitive:true (default true) to ignore case.
      //   Returns matching entries with a short snippet showing the match in
      //   context. Pass includeBody:true to get the full transcript text too.
      //   Scans up to 5000 entries (covers years of usage at a few per day);
      //   limit caps the returned result count at 200 by default.
      if (req.method === 'POST' && pathname === '/archive/search') {
        const body = await readJsonBody(req);
        const query = typeof body?.query === 'string' ? body.query : '';
        if (!query) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.query (non-empty string) required' }));
          return;
        }
        const limit = Math.min(1000, Math.max(1, parseInt(body?.limit, 10) || 200));
        const ci = body?.caseInsensitive !== false; // default true
        const needle = ci ? query.toLowerCase() : query;
        const includeBody = !!body?.includeBody;
        const SNIPPET_RADIUS = 80;
        const all = _agentArchiveScan();
        const matches = [];
        for (const entry of all) {
          const text = entry.text || '';
          const haystack = ci ? text.toLowerCase() : text;
          const idx = haystack.indexOf(needle);
          if (idx === -1) continue;
          const start = Math.max(0, idx - SNIPPET_RADIUS);
          const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
          const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
          matches.push({
            id: entry.id,
            date: entry.date,
            wordCount: entry.wordCount,
            engine: entry.engine,
            hasAudio: entry.hasAudio,
            hasVideo: entry.hasVideo,
            matchIndex: idx,
            snippet,
            ...(includeBody ? { text } : {}),
          });
          if (matches.length >= limit) break;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          query, caseInsensitive: ci, scanned: all.length, matched: matches.length, limit, matches,
        }, null, 2));
        return;
      }
      // GET /archive/by-date?from=ISO&to=ISO[&limit=N]
      //   Return entries whose start date falls within [from, to] inclusive.
      //   from/to are ISO 8601 (date or date+time). Either is optional —
      //   omitting from means "from the beginning"; omitting to means "until
      //   now". Sorted newest first. limit caps at 1000 (default 200).
      if (req.method === 'GET' && pathname === '/archive/by-date') {
        const fromStr = urlObj.searchParams.get('from');
        const toStr = urlObj.searchParams.get('to');
        const limit = Math.min(1000, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '200', 10)));
        const fromMs = fromStr ? Date.parse(fromStr) : -Infinity;
        const toMs = toStr ? Date.parse(toStr) : Infinity;
        if ((fromStr && isNaN(fromMs)) || (toStr && isNaN(toMs))) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'from/to must be ISO 8601 if provided' }));
          return;
        }
        const all = _agentArchiveScan();
        const filtered = all.filter((e) => {
          if (!e.date) return false;
          const ms = Date.parse(e.date);
          return ms >= fromMs && ms <= toMs;
        }).slice(0, limit);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          from: fromStr || null, to: toStr || null, scanned: all.length, matched: filtered.length, limit, entries: filtered,
        }, null, 2));
        return;
      }
      // POST /archive/bulk-delete body={ids:[...], confirm:"YES-DELETE-N"}
      //   Tear down multiple archive entries in one call. Requires an explicit
      //   confirm token "YES-DELETE-<N>" matching the number of ids — protects
      //   against accidental wipes (an agent that hallucinates a single number
      //   doesn't accidentally delete every recording). Returns per-id status.
      if (req.method === 'POST' && pathname === '/archive/bulk-delete') {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body?.ids) ? body.ids : null;
        if (!ids || ids.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.ids (non-empty array of archive ids) required' }));
          return;
        }
        const required = `YES-DELETE-${ids.length}`;
        if (body?.confirm !== required) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `body.confirm must equal "${required}" — guards against accidental bulk deletion`, idsCount: ids.length }));
          return;
        }
        const results = [];
        for (const id of ids) {
          const resolved = _agentResolveArchiveId(id);
          if (!resolved) {
            results.push({ id, ok: false, error: 'not found' });
            continue;
          }
          const safeRoot = path.resolve(resolved.archiveDir);
          const deleted = [];
          for (const p of [resolved.mdPath, resolved.audioPath, resolved.videoPath]) {
            if (!p) continue;
            const real = path.resolve(p);
            if (!real.startsWith(safeRoot)) continue;
            if (fs.existsSync(real)) {
              try { fs.unlinkSync(real); deleted.push(path.basename(real)); } catch (_) {}
            }
          }
          results.push({ id, ok: true, deletedFiles: deleted });
        }
        _archiveStatsCache = null;
        const okCount = results.filter(r => r.ok).length;
        console.info(`[AgentCtrl] archive.bulk-delete ${okCount}/${ids.length} ok`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requested: ids.length, succeeded: okCount, results }, null, 2));
        return;
      }
      // ── Lifecycle + finishing surfaces (Wave W4 + W2 cont'd) ──────────
      // App lifecycle, window controls, notifications, and bulk archive
      // text export. Each is small and idempotent where it makes sense.
      if (req.method === 'POST' && pathname === '/recording/cancel') {
        // Cancel an in-flight recording without saving the result. Mirrors
        // what a user does by pressing the hotkey mid-recording: stops, but
        // does NOT trigger transcription or paste. Safe to call when idle —
        // returns ok:true with wasRecording:false.
        const wasRecording = isRecording;
        if (isRecording) {
          safeSend('toggle-recording', false);
          isRecording = false;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, wasRecording }));
        return;
      }
      if (req.method === 'POST' && pathname === '/app/restart') {
        // Relaunch the app. Returns 200 first, then schedules the exit on
        // the next tick so the HTTP response actually makes it back to the
        // caller before the process dies.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'restart', scheduledMs: 250 }));
        setTimeout(() => {
          try { app.relaunch(); app.exit(0); } catch (e) { console.warn('[restart]', e.message); }
        }, 250);
        return;
      }
      if (req.method === 'POST' && pathname === '/app/quit') {
        // Quit cleanly. Same delayed-exit pattern. Agent should warn the
        // user; this is destructive.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'quit', scheduledMs: 250 }));
        setTimeout(() => { try { app.quit(); } catch (_) {} }, 250);
        return;
      }
      if (req.method === 'POST' && pathname === '/window/always-on-top') {
        // Toggle alwaysOnTop on the live window + persist via catalog.
        const body = await readJsonBody(req);
        const on = !!body?.on;
        store.set('appearance.alwaysOnTop', on);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(on);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alwaysOnTop: on }));
        return;
      }
      if (req.method === 'POST' && pathname === '/window/opacity') {
        // Set window opacity (0.1-1.0). Live update + persist.
        const body = await readJsonBody(req);
        const value = Number(body?.value);
        if (!isFinite(value) || value < 0.1 || value > 1.0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.value must be a number in [0.1, 1.0]' }));
          return;
        }
        store.set('appearance.opacity', value);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(value);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, opacity: value }));
        return;
      }
      if (req.method === 'POST' && pathname === '/notifications/send') {
        // Show an OS-native notification.
        const body = await readJsonBody(req);
        const title = String(body?.title || '').slice(0, 200);
        const message = String(body?.body || '').slice(0, 1000);
        if (!title) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.title required' }));
          return;
        }
        if (!Notification.isSupported()) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'OS notifications not supported on this platform' }));
          return;
        }
        try {
          const n = new Notification({ title, body: message, silent: !!body?.silent });
          n.show();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, title, body: message }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // ── TTS — the agent talks back ────────────────────────────────────
      // Three routes that wrap the `say` npm (cross-platform OS TTS):
      // mac uses /usr/bin/say, Windows uses System.Speech.Synthesis, Linux
      // uses festival/espeak (whichever is installed). This closes the
      // half-conversation gap — until now grandma talks to the app, but
      // the app never talks back. With these the agent can read a
      // transcript aloud, confirm an action, or have a hands-free
      // conversation while she's washing dishes.

      // POST /tts/speak body={text, voice?, rate?, interrupt?}
      // Returns 200 immediately after starting playback (does NOT block
      // for the full duration). Default interrupt:true cancels any
      // currently-playing TTS first so a new utterance always wins.
      if (req.method === 'POST' && pathname === '/tts/speak') {
        const body = await readJsonBody(req);
        const text = String(body?.text || '').trim();
        if (!text) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.text required' }));
          return;
        }
        if (text.length > 5000) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `text too long (${text.length} chars; max 5000). Break long messages into chunks.` }));
          return;
        }
        const voice = (typeof body?.voice === 'string' && body.voice) ? body.voice : null;
        const rate = (typeof body?.rate === 'number' && Number.isFinite(body.rate)) ? body.rate : null;
        const interrupt = body?.interrupt !== false;
        try {
          const say = require('say');
          if (interrupt) { try { say.stop(); } catch { /* nothing playing */ } }
          // say.speak callback fires when audio completes; we don't block on it.
          say.speak(text, voice, rate, (err) => {
            if (err) console.warn('[tts/speak] playback failed:', err.message || err);
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, length: text.length, voice, rate, interrupted: interrupt }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, platform: process.platform, hint: process.platform === 'linux' ? 'Linux needs festival or espeak installed (apt install festival OR apt install espeak)' : undefined }));
        }
        return;
      }

      // POST /tts/stop — silence any in-flight TTS playback. Safe to call
      // when nothing is playing.
      if (req.method === 'POST' && pathname === '/tts/stop') {
        try {
          const say = require('say');
          say.stop();
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // GET /tts/voices — list installed system TTS voices. Returns
      // platform-specific names (mac: "Samantha", "Daniel"; win: "Microsoft
      // David Desktop"). Pass one of these as `voice` to /tts/speak to
      // change the speaker.
      //
      // The `say` npm 0.16 stubs getVoices() on darwin (throws — even the
      // error message is mislabeled "say.export()"). We shell out to
      // /usr/bin/say -v ? directly on macOS and parse the columnar output:
      //   Albert              en_US    # I have a frog in my throat...
      //   Alice               it_IT    # Salve, mi chiamo Alice...
      // Linux + Windows still use the say npm path since festival /
      // System.Speech.Synthesis enumeration through say.getInstalledVoices
      // works there.
      if (req.method === 'GET' && pathname === '/tts/voices') {
        try {
          if (process.platform === 'darwin') {
            const { stdout } = await execFileAsync('say', ['-v', '?'], { timeout: 5000 });
            const voices = stdout.split('\n')
              .map(line => line.replace(/\s+$/, ''))
              .filter(Boolean)
              .map(line => {
                const m = line.match(/^(.+?)\s{2,}([a-z]{2,3}[_-][A-Z]{2,3})(?:\s+#\s+(.*))?$/);
                if (!m) return { raw: line };
                return { name: m[1].trim(), locale: m[2], sample: m[3] || null };
              });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, voices, platform: 'darwin' }));
            return;
          }
          const say = require('say');
          const voices = await new Promise((resolve, reject) => {
            say.getInstalledVoices((err, vs) => err ? reject(err) : resolve(vs || []));
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, voices, platform: process.platform }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, platform: process.platform }));
        }
        return;
      }

      // ── Pause / resume other audio (the music-ducking grandma win) ───
      // When grandma starts recording while Spotify is playing, the music
      // ruins her transcript. These two routes let the agent pause
      // playback before recording and resume it after. Best-effort per
      // platform — failures surface in the per-app `attempts` array but
      // the overall response is still ok:true if at least one method
      // succeeded.
      //   macOS:   AppleScript to Music + Spotify (guarded by "is running")
      //   Windows: SendKeys MEDIA_PLAY_PAUSE (toggle — works for the
      //            common record-then-resume flow; calling pause twice in
      //            a row would re-start playback, which is the platform
      //            limit, not a bug here)
      //   Linux:   playerctl pause / play (MPRIS — covers Spotify, VLC,
      //            most browsers, etc.; needs `apt install playerctl`)
      if (req.method === 'POST' && (pathname === '/audio/pause-others' || pathname === '/audio/resume-others')) {
        const action = pathname === '/audio/pause-others' ? 'pause' : 'play';
        const attempts = [];
        try {
          if (process.platform === 'darwin') {
            for (const app of ['Music', 'Spotify']) {
              try {
                const script = `tell application "${app}" to if it is running then ${action}`;
                await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
                attempts.push({ app, ok: true });
              } catch (e) {
                attempts.push({ app, ok: false, error: e.message });
              }
            }
          } else if (process.platform === 'win32') {
            // Windows has only a single VK_MEDIA_PLAY_PAUSE toggle key
            // surfaced through SendKeys; both pause and resume send the
            // same toggle. This is intentional — the toggle matches the
            // record-then-resume flow grandma actually uses.
            try {
              await execFileAsync('powershell', [
                '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
                'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_PLAY_PAUSE}")',
              ], { timeout: 5000 });
              attempts.push({ app: 'system-media-key', ok: true, note: 'VK_MEDIA_PLAY_PAUSE toggle' });
            } catch (e) {
              attempts.push({ app: 'system-media-key', ok: false, error: e.message });
            }
          } else if (process.platform === 'linux') {
            try {
              await execFileAsync('playerctl', [action], { timeout: 5000 });
              attempts.push({ app: 'playerctl', ok: true });
            } catch (e) {
              const hint = e.code === 'ENOENT' ? 'playerctl is not installed — apt install playerctl (Debian/Ubuntu) or dnf install playerctl (Fedora)' : undefined;
              attempts.push({ app: 'playerctl', ok: false, error: e.message, hint });
            }
          } else {
            attempts.push({ app: 'unknown-platform', ok: false, error: `unsupported platform: ${process.platform}` });
          }
          const ok = attempts.some(a => a.ok);
          res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok, action, platform: process.platform, attempts }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, platform: process.platform, attempts }));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/archive/bulk-export-text') {
        // Bulk-export transcript text for multiple archive entries.
        // body={ids:[], targetDir, format? "md"|"txt"|"json"}
        const body = await readJsonBody(req);
        const ids = Array.isArray(body?.ids) ? body.ids : null;
        const targetDir = typeof body?.targetDir === 'string' ? body.targetDir : '';
        const format = (body?.format || 'md').toLowerCase();
        if (!ids || ids.length === 0 || !targetDir) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body must be {ids: [..], targetDir: "/...", format?: "md"|"txt"|"json"}' }));
          return;
        }
        if (!['md', 'txt', 'json'].includes(format)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'format must be md, txt, or json' }));
          return;
        }
        try { fs.mkdirSync(targetDir, { recursive: true }); }
        catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `cannot create targetDir: ${e.message}` }));
          return;
        }
        const all = _agentArchiveScan();
        const byId = new Map(all.map(e => [e.id, e]));
        const results = [];
        for (const id of ids) {
          const entry = byId.get(id);
          if (!entry) { results.push({ id, ok: false, error: 'not found' }); continue; }
          // Strip the source .md so we don't end up with double extensions
          // (e.g. arc_2026-05-20_161516.md.md). The id format is fixed:
          // "arc:YYYY-MM-DD:HHMMSS.md".
          const safeName = id.replace(/\.md$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
          const outPath = path.join(targetDir, `${safeName}.${format}`);
          let content;
          if (format === 'json') content = JSON.stringify(entry, null, 2);
          else if (format === 'txt') content = entry.text || '';
          else content = `# ${entry.date || id}\n\nWords: ${entry.wordCount}\nEngine: ${entry.engine}\n\n---\n\n${entry.text || ''}\n`;
          try {
            fs.writeFileSync(outPath, content, 'utf8');
            results.push({ id, ok: true, path: outPath, bytes: Buffer.byteLength(content, 'utf8') });
          } catch (e) {
            results.push({ id, ok: false, error: e.message });
          }
        }
        const okCount = results.filter(r => r.ok).length;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requested: ids.length, succeeded: okCount, targetDir, format, results }, null, 2));
        return;
      }

      // POST /archive/delete body={id} — tear down archive entry + media.
      // Confined to the archive folder via _agentResolveArchiveId's path
      // resolution + the explicit startsWith check below.
      if (req.method === 'POST' && pathname === '/archive/delete') {
        const body = await readJsonBody(req);
        if (!body.id) { res.writeHead(400); res.end('id required'); return; }
        const resolved = _agentResolveArchiveId(body.id);
        if (!resolved) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `no archive entry with id ${body.id}` }));
          return;
        }
        const safeRoot = path.resolve(resolved.archiveDir);
        const deleted = [];
        for (const p of [resolved.mdPath, resolved.audioPath, resolved.videoPath]) {
          if (!p) continue;
          const real = path.resolve(p);
          if (!real.startsWith(safeRoot)) continue;
          if (fs.existsSync(real)) {
            try { fs.unlinkSync(real); deleted.push(path.basename(real)); } catch (_) {}
          }
        }
        // Invalidate stats cache since totals just changed.
        _archiveStatsCache = null;
        console.info(`[AgentCtrl] archive.delete id=${body.id} files=${deleted.join(',')}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: body.id, deletedFiles: deleted }));
        return;
      }
      // POST /archive/open-folder — pop the archive directory in the OS
      // file manager. Side-effect on the user's desktop; safe to call.
      if (req.method === 'POST' && pathname === '/archive/open-folder') {
        const archiveRoot = getArchiveFolder();
        try {
          require('electron').shell.openPath(archiveRoot);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: archiveRoot }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /voice-clones/create body={name, sourcePath, durationSec?}
      // Path-based voice-clone creation. Copies the source audio file into
      // vcAudioDir under a fresh UUID, registers it in the JSON DB, returns
      // the new clone. Source path must exist and be readable; the copy is
      // confined to vcAudioDir.
      if (req.method === 'POST' && pathname === '/voice-clones/create') {
        const body = await readJsonBody(req);
        if (!body.name || !body.sourcePath) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'name and sourcePath required' }));
          return;
        }
        let sourceResolved;
        try { sourceResolved = path.resolve(body.sourcePath); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `bad sourcePath: ${e.message}` })); return;
        }
        if (!fs.existsSync(sourceResolved)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `source file not found: ${sourceResolved}` }));
          return;
        }
        const ext = path.extname(sourceResolved).toLowerCase();
        const allowed = ['.webm', '.wav', '.mp3', '.ogg', '.m4a', '.flac'];
        if (!allowed.includes(ext)) {
          res.writeHead(415, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `unsupported audio extension "${ext}"`, supported: allowed }));
          return;
        }
        try {
          ensureDir(vcAudioDir);
          const id = require('crypto').randomUUID();
          const destPath = path.join(vcAudioDir, `${id}${ext}`);
          fs.copyFileSync(sourceResolved, destPath);
          const data = loadVoiceClones();
          const clone = {
            id, name: body.name,
            duration: typeof body.durationSec === 'number' ? body.durationSec : null,
            audioPath: destPath,
            status: 'ready',
            created_at: new Date().toISOString(),
          };
          data.clones.push(clone);
          saveVoiceClones(data);
          console.info(`[AgentCtrl] voice-clones.create id=${id} name="${body.name}" from=${sourceResolved}`);
          const { audioPath, ...safe } = clone;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, clone: { ...safe, hasAudio: true }, copiedSizeBytes: fs.statSync(destPath).size }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }
      // POST /voice-clones/cloud-order-status body={orderId}
      // Queries Windy Clone for the status of a previously-submitted cloud
      // clone training order. Requires auth.token in the store; returns a
      // clean "not signed in" error if missing.
      if (req.method === 'POST' && pathname === '/voice-clones/cloud-order-status') {
        const body = await readJsonBody(req);
        if (!body.orderId) { res.writeHead(400); res.end('orderId required'); return; }
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const cloneApiUrl = process.env.WINDY_CLONE_API_URL || (typeof CLONE_API_DEFAULT_URL !== 'undefined' ? CLONE_API_DEFAULT_URL : 'https://api.windyclone.ai');
        try {
          const upstream = await fetch(`${cloneApiUrl}/api/v1/orders/${encodeURIComponent(body.orderId)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          res.writeHead(upstream.ok ? 200 : 502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: upstream.ok, orderId: body.orderId, status: upstream.status, body: parsed }));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // ── Account-server proxy (billing / plan / logout) ───────────────
      // Six routes that proxy to https://windyword.ai/api/v1/* with the
      // user's stored auth token. All return JSON {ok, ...}; auth failures
      // surface as {ok:false, error:"Not signed in ..."} with 401 so the
      // agent can prompt the user to sign in.

      // GET /account/me — current user identity + tier (the "what plan
      // am I on" answer). Wraps GET /api/v1/auth/me.
      if (req.method === 'GET' && pathname === '/account/me') {
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
        try {
          const upstream = await fetch(`${baseUrl}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          res.writeHead(upstream.ok ? 200 : upstream.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(upstream.ok
            ? { ok: true, ...parsed }
            : { ok: false, error: parsed.error || `account-server returned ${upstream.status}`, upstreamStatus: upstream.status }
          ));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // GET /account/billing/transactions — purchase history. Wraps
      // GET /api/v1/billing/transactions.
      if (req.method === 'GET' && pathname === '/account/billing/transactions') {
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
        try {
          const upstream = await fetch(`${baseUrl}/billing/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          res.writeHead(upstream.ok ? 200 : upstream.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(upstream.ok
            ? { ok: true, ...parsed }
            : { ok: false, error: parsed.error || `account-server returned ${upstream.status}`, upstreamStatus: upstream.status }
          ));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // GET /account/billing/summary — current-tier + spend summary. Wraps
      // GET /api/v1/billing/summary.
      if (req.method === 'GET' && pathname === '/account/billing/summary') {
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
        try {
          const upstream = await fetch(`${baseUrl}/billing/summary`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          res.writeHead(upstream.ok ? 200 : upstream.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(upstream.ok
            ? { ok: true, ...parsed }
            : { ok: false, error: parsed.error || `account-server returned ${upstream.status}`, upstreamStatus: upstream.status }
          ));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /account/billing/checkout body={tier, billing_type}
      // Asks account-server for a Stripe Checkout URL, then opens it in the
      // user's default browser via shell.openExternal. Response includes
      // {ok, url, opened} so the agent can describe what happened
      // ("I opened the upgrade page in your browser").
      if (req.method === 'POST' && pathname === '/account/billing/checkout') {
        const body = await readJsonBody(req);
        const tier = body.tier;
        const billing_type = body.billing_type;
        if (!tier || !billing_type) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'tier and billing_type required (tier ∈ {pro, translate, translate_pro}, billing_type ∈ {lifetime, monthly, yearly})' }));
          return;
        }
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
        try {
          const upstream = await fetch(`${baseUrl}/stripe/create-checkout-session`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier, billing_type }),
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          if (!upstream.ok || !parsed.url) {
            res.writeHead(upstream.ok ? 502 : upstream.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: parsed.error || `account-server returned ${upstream.status} without a checkout url`, upstreamStatus: upstream.status }));
            return;
          }
          let opened = false;
          try { await shell.openExternal(parsed.url); opened = true; } catch (e) { console.warn('[account/checkout] shell.openExternal failed:', e.message); }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, url: parsed.url, sessionId: parsed.sessionId, opened }));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /account/billing/portal — open Stripe Customer Portal (manage
      // subscription, update card, cancel, invoices). Wraps
      // POST /api/v1/stripe/create-portal-session and opens the URL.
      if (req.method === 'POST' && pathname === '/account/billing/portal') {
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not signed in to Windy account — auth.token missing.' }));
          return;
        }
        const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
        try {
          const upstream = await fetch(`${baseUrl}/stripe/create-portal-session`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: '{}',
          });
          const upstreamBody = await upstream.text();
          let parsed;
          try { parsed = JSON.parse(upstreamBody); } catch { parsed = { raw: upstreamBody.slice(0, 500) }; }
          if (!upstream.ok || !parsed.url) {
            res.writeHead(upstream.ok ? 502 : upstream.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: parsed.error || `account-server returned ${upstream.status} without a portal url`, upstreamStatus: upstream.status }));
            return;
          }
          let opened = false;
          try { await shell.openExternal(parsed.url); opened = true; } catch (e) { console.warn('[account/portal] shell.openExternal failed:', e.message); }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, url: parsed.url, opened }));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /account/logout — best-effort upstream logout, then clear the
      // local auth + license cache so subsequent /account/me returns 401.
      // Upstream failure does NOT block local clearing — grandma can still
      // "sign me out" when offline.
      if (req.method === 'POST' && pathname === '/account/logout') {
        const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
        let upstreamStatus = null;
        if (token) {
          const baseUrl = process.env.WINDY_ACCOUNT_API_URL || ACCOUNT_API_DEFAULT_URL;
          try {
            const upstream = await fetch(`${baseUrl}/auth/logout`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: '{}',
            });
            upstreamStatus = upstream.status;
          } catch (e) {
            console.warn('[account/logout] upstream failed (clearing local anyway):', e.message);
          }
        }
        for (const key of [
          'auth.token', 'auth.storageToken',
          'license.tier', 'license.email', 'license.purchasedAt',
          'license.expiresAt', 'license.stripeSessionId',
        ]) {
          try { store.delete(key); } catch { /* ignore */ }
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, upstreamStatus, cleared: true }));
        return;
      }

      // ── Soul file export (v0.12.0) ─────────────────────────────────────
      // POST /soul-file/export body={outputPath, overwrite?:bool}
      // Zips the entire archive (audio + video + transcripts + manifest)
      // to the given path. Path-based variant of the dialog-based
      // export-soul-file IPC. Forma Animae artifact — the user's
      // exportable "soul" for use with the Windy Clone digital-twin
      // pipeline. Refuses to overwrite unless overwrite=true.
      if (req.method === 'POST' && pathname === '/soul-file/export') {
        const body = await readJsonBody(req);
        if (!body.outputPath) { res.writeHead(400); res.end('outputPath required'); return; }
        let outPath;
        try { outPath = path.resolve(body.outputPath); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `bad outputPath: ${e.message}` })); return;
        }
        if (fs.existsSync(outPath) && !body.overwrite) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'file exists; pass overwrite=true to replace', existingSizeBytes: fs.statSync(outPath).size }));
          return;
        }
        const archiveRoot = getArchiveFolder();
        if (!fs.existsSync(archiveRoot)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `archive root does not exist: ${archiveRoot}` }));
          return;
        }
        try {
          ensureDir(path.dirname(outPath));
          const archiver = require('archiver');
          const output = fs.createWriteStream(outPath);
          const archive = archiver('zip', { zlib: { level: 6 } });
          archive.pipe(output);

          let totalFiles = 0, audioFiles = 0, videoFiles = 0, transcriptFiles = 0, totalWords = 0, totalChars = 0;
          const days = [];
          const items = fs.readdirSync(archiveRoot).sort();
          for (const item of items) {
            const itemPath = path.join(archiveRoot, item);
            if (!fs.statSync(itemPath).isDirectory()) continue;
            days.push(item);
            const files = fs.readdirSync(itemPath);
            for (const file of files) {
              const filePath = path.join(itemPath, file);
              archive.file(filePath, { name: `${item}/${file}` });
              totalFiles++;
              if (file.endsWith('.webm') && file.includes('-video')) videoFiles++;
              else if (file.endsWith('.webm') || file.endsWith('.wav')) audioFiles++;
              else if (file.endsWith('.md')) {
                transcriptFiles++;
                try {
                  const content = fs.readFileSync(filePath, 'utf-8');
                  const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
                  const text = textLines.join(' ').trim();
                  totalWords += text.split(/\s+/).filter(Boolean).length;
                  totalChars += text.length;
                } catch (_) {}
              }
            }
          }
          const manifest = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            appVersion: app.getVersion() || '1.6.1',
            via: 'agent-control-surface',
            stats: {
              totalFiles, audioFiles, videoFiles, transcriptFiles,
              totalWords, totalChars,
              days: days.length,
              dateRange: days.length ? { first: days[0], last: days[days.length - 1] } : null,
            },
          };
          archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
          await archive.finalize();
          await new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); });
          const sizeMB = Math.round(fs.statSync(outPath).size / (1024 * 1024) * 10) / 10;
          console.info(`[AgentCtrl] soul-file exported to ${outPath} (${sizeMB}MB, ${totalFiles} files)`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, outputPath: outPath, sizeMB, stats: manifest.stats }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // ── Voice-clone surface ─────────────────────────────────────────────
      // Wraps the same JSON-DB + filesystem state the renderer drives via
      // IPC (loadVoiceClones / saveVoiceClones / loadBundlesManifest at
      // ~line 6836+). All paths are user-config-scoped to vcAudioDir or
      // bundlesDir so traversal is bounded.

      // GET /voice-clones — list clones + activeId.
      if (req.method === 'GET' && pathname === '/voice-clones') {
        const data = loadVoiceClones();
        res.writeHead(200, { 'content-type': 'application/json' });
        // Strip audio paths (they're filesystem-local) — replace with
        // booleans about presence. Agents that need audio call /preview.
        const safeClones = data.clones.map(({ audioPath, ...rest }) => ({
          ...rest,
          hasAudio: !!(audioPath && fs.existsSync(audioPath)),
        }));
        res.end(JSON.stringify({ count: safeClones.length, activeId: data.activeId, clones: safeClones }, null, 2));
        return;
      }
      // GET /voice-clones/active — return the active clone (or null).
      if (req.method === 'GET' && pathname === '/voice-clones/active') {
        const data = loadVoiceClones();
        const active = data.activeId ? data.clones.find(c => c.id === data.activeId) : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        if (!active) { res.end(JSON.stringify({ active: null })); return; }
        const { audioPath, ...safe } = active;
        res.end(JSON.stringify({ active: { ...safe, hasAudio: !!(audioPath && fs.existsSync(audioPath)) } }, null, 2));
        return;
      }
      // POST /voice-clones/active body={id: string | null} — set active.
      // Pass null to deactivate. Validates id refers to an existing clone.
      if (req.method === 'POST' && pathname === '/voice-clones/active') {
        const body = await readJsonBody(req);
        const id = body.id;  // null is valid
        const data = loadVoiceClones();
        if (id !== null && id !== undefined) {
          if (!data.clones.find(c => c.id === id)) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `no voice clone with id ${id}` }));
            return;
          }
        }
        data.activeId = id === undefined ? null : id;
        saveVoiceClones(data);
        console.info(`[AgentCtrl] voice-clones.activeId = ${JSON.stringify(data.activeId)}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, activeId: data.activeId }));
        return;
      }
      // POST /voice-clones/delete body={id: string} — delete clone + audio.
      if (req.method === 'POST' && pathname === '/voice-clones/delete') {
        const body = await readJsonBody(req);
        if (!body.id) { res.writeHead(400); res.end('id required'); return; }
        const data = loadVoiceClones();
        const clone = data.clones.find(c => c.id === body.id);
        if (!clone) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `no voice clone with id ${body.id}` }));
          return;
        }
        if (clone.audioPath && fs.existsSync(clone.audioPath)) {
          const resolved = path.resolve(clone.audioPath);
          if (resolved.startsWith(path.resolve(vcAudioDir))) {
            try { fs.unlinkSync(resolved); } catch (_) {}
          }
        }
        data.clones = data.clones.filter(c => c.id !== body.id);
        if (data.activeId === body.id) data.activeId = null;
        saveVoiceClones(data);
        console.info(`[AgentCtrl] voice-clones.delete id=${body.id} name="${clone.name}"`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deletedId: body.id, deletedName: clone.name }));
        return;
      }
      // POST /voice-clones/preview body={id, metadataOnly?:bool} — return
      // clone metadata + (unless metadataOnly) base64 audio. Audio can be
      // several MB; the metadataOnly path keeps responses small.
      if (req.method === 'POST' && pathname === '/voice-clones/preview') {
        const body = await readJsonBody(req);
        if (!body.id) { res.writeHead(400); res.end('id required'); return; }
        const data = loadVoiceClones();
        const clone = data.clones.find(c => c.id === body.id);
        if (!clone) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `no voice clone with id ${body.id}` }));
          return;
        }
        const { audioPath, ...safe } = clone;
        const exists = audioPath && fs.existsSync(audioPath);
        const out = { ok: true, clone: { ...safe, hasAudio: !!exists } };
        if (!body.metadataOnly && exists) {
          const buf = fs.readFileSync(audioPath);
          out.audioBase64 = buf.toString('base64');
          out.audioSizeBytes = buf.length;
          out.mimeType = audioPath.endsWith('.webm') ? 'audio/webm' : audioPath.endsWith('.wav') ? 'audio/wav' : audioPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/octet-stream';
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out, null, 2));
        return;
      }
      // GET /clone-bundles — list training-bundle catalog (audio/video that
      // can be used to train a voice clone). Read-only — bundle deletion is
      // a UI-driven flow (delete-clone-bundle IPC handler).
      if (req.method === 'GET' && pathname === '/clone-bundles') {
        const manifest = loadBundlesManifest();
        const safe = (manifest.bundles || []).map(({ file_path, ...rest }) => ({
          ...rest,
          fileExists: !!(file_path && fs.existsSync(file_path)),
        }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ count: safe.length, bundles: safe }, null, 2));
        return;
      }

      // ── Bulk clone-ingest (the upload-everything grandma flow) ────────
      // Three routes that turn "find all my voice memos and make a clone"
      // into one (or two) calls instead of N. POST/JSON for all so paths
      // with spaces / Unicode aren't fragile.

      // POST /clones/scan body={path, recursive?} → recursive media scan.
      // Returns up to CLONE_INGEST_MAX_SCAN_RESULTS audio + video files
      // with size, mtime, and (for audio) duration via music-metadata.
      // Robust against permission errors — silently skips unreadable dirs.
      if (req.method === 'POST' && pathname === '/clones/scan') {
        const body = await readJsonBody(req);
        if (!body.path || typeof body.path !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.path (string) required' }));
          return;
        }
        let resolved;
        try { resolved = path.resolve(body.path); } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `bad path: ${e.message}` }));
          return;
        }
        if (!fs.existsSync(resolved)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `path not found: ${resolved}` }));
          return;
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `path is not a directory: ${resolved}` }));
          return;
        }
        const recursive = body.recursive !== false; // default true
        try {
          const { results, truncated, maxResults } = await scanMediaFolder(resolved, recursive);
          const audioCount = results.filter(r => r.kind === 'audio').length;
          const videoCount = results.filter(r => r.kind === 'video').length;
          const totalSizeBytes = results.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
          const totalDurationSec = results.reduce((sum, r) => sum + (r.durationSec || 0), 0);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            root: resolved,
            recursive,
            count: results.length,
            audioCount,
            videoCount,
            totalSizeBytes,
            totalDurationSec,
            truncated,
            maxResults,
            files: results,
          }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /clones/bulk-ingest body={paths, namePrefix?}
      // Copy N audio files into the voice-samples store as separate clone
      // entries. Each file becomes one clone (ElevenLabs multi-sample
      // training model). Returns per-file results so partial failures are
      // visible. Loads + saves the JSON DB exactly once.
      if (req.method === 'POST' && pathname === '/clones/bulk-ingest') {
        const body = await readJsonBody(req);
        if (!Array.isArray(body.paths) || body.paths.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.paths must be a non-empty array of file paths' }));
          return;
        }
        if (body.paths.length > 100) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `too many paths (${body.paths.length}); cap is 100 per call. Make multiple calls.` }));
          return;
        }
        const namePrefix = typeof body.namePrefix === 'string' && body.namePrefix.trim() ? body.namePrefix.trim() : null;
        try {
          const results = bulkIngestToCloneSamples(body.paths, namePrefix);
          const successCount = results.filter(r => r.ok).length;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: successCount > 0,
            totalCount: results.length,
            successCount,
            failureCount: results.length - successCount,
            results,
          }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // POST /clones/watch-folder body={path, enabled, autoIngest?}
      // Start (enabled:true) or stop (enabled:false) a chokidar watcher
      // on a folder. When autoIngest defaults true, new audio files
      // landing in the folder are immediately ingested via the same
      // bulkIngestToCloneSamples path. ignoreInitial + awaitWriteFinish
      // are set so existing files don't trigger and in-progress writes
      // wait until the file settles before ingest. In-memory only —
      // watchers do not survive an app restart (caller must re-register).
      if (req.method === 'POST' && pathname === '/clones/watch-folder') {
        const body = await readJsonBody(req);
        if (!body.path || typeof body.path !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'body.path (string) required' }));
          return;
        }
        let resolved;
        try { resolved = path.resolve(body.path); } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `bad path: ${e.message}` }));
          return;
        }
        const enabled = body.enabled !== false; // default true
        const autoIngest = body.autoIngest !== false; // default true
        try {
          if (!enabled) {
            const existing = CLONE_WATCHERS.get(resolved);
            if (!existing) {
              res.writeHead(404, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: `no active watcher for ${resolved}` }));
              return;
            }
            await existing.watcher.close();
            CLONE_WATCHERS.delete(resolved);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, action: 'stopped', path: resolved }));
            return;
          }
          // Enable path
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `path is not an existing directory: ${resolved}` }));
            return;
          }
          if (CLONE_WATCHERS.has(resolved)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, action: 'already-watching', path: resolved, ...CLONE_WATCHERS.get(resolved).meta }));
            return;
          }
          // chokidar 4+ is ESM-only; Electron 28's bundled Node 18.18
          // doesn't support require(esm), so dynamic import + module-
          // level cache via loadChokidar().
          const chokidar = await loadChokidar();
          const watcher = chokidar.watch(resolved, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
            depth: 0,
          });
          let ingestedCount = 0;
          watcher.on('add', (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            if (!CLONE_INGEST_AUDIO_EXTS.has(ext)) return;
            if (!autoIngest) {
              console.info(`[CloneWatch] new file detected (autoIngest:false): ${filePath}`);
              return;
            }
            try {
              const [r] = bulkIngestToCloneSamples([filePath], `Auto-ingest from ${path.basename(resolved)}`);
              if (r.ok) {
                ingestedCount += 1;
                console.info(`[CloneWatch] auto-ingested ${filePath} → cloneId=${r.cloneId}`);
              } else {
                console.warn(`[CloneWatch] auto-ingest failed for ${filePath}: ${r.error}`);
              }
            } catch (e) {
              console.warn(`[CloneWatch] auto-ingest threw for ${filePath}:`, e.message);
            }
          });
          watcher.on('error', (e) => console.warn(`[CloneWatch] watcher error on ${resolved}:`, e.message));
          const meta = { autoIngest, startedAt: new Date().toISOString() };
          CLONE_WATCHERS.set(resolved, { watcher, meta, get ingestedCount() { return ingestedCount; } });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, action: 'started', path: resolved, ...meta }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // GET /clones/watchers — list active folder watchers + their stats.
      if (req.method === 'GET' && pathname === '/clones/watchers') {
        const watchers = [];
        for (const [p, entry] of CLONE_WATCHERS.entries()) {
          watchers.push({ path: p, ingestedCount: entry.ingestedCount, ...entry.meta });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: watchers.length, watchers }, null, 2));
        return;
      }

      // POST /paste/inject-test — real end-to-end paste injection test.
      // Spawns a focusable Tk capture target, temporarily flips Mutter's
      // focus-new-windows policy to 'strict' so the window auto-grabs
      // keyboard focus, fires the requested paste strategy, captures what
      // landed, and returns {ok, captured, expected, match, strategy,
      // attempts}. Body: {strategy, text?, captureSeconds?}.
      //
      // Real test — actually injects keystrokes. Safe because the target is
      // a spawned scratchpad, not the user's active window.
      if (req.method === 'POST' && pathname === '/paste/inject-test') {
        const body = await readJsonBody(req);
        const strategy = body.strategy || 'ydotool_type';
        const text = body.text || `WINDY-INJECT-${Date.now()}`;
        const captureSeconds = Math.min(30, Math.max(3, parseInt(body.captureSeconds || 6, 10)));
        const outfile = path.join(os.tmpdir(), `wpaste-inject-${process.pid}-${Date.now()}.txt`);
        const targetScript = path.join(__dirname, 'stress', 'capture-target.py');

        // Flip focus policy + remember the original
        let originalPolicy = null;
        if (PLATFORM.isWayland && PLATFORM.isGnome && PLATFORM.hasGsettings) {
          try {
            originalPolicy = execSync("gsettings get org.gnome.desktop.wm.preferences focus-new-windows", { timeout: 2000 }).toString().trim();
            execSync("gsettings set org.gnome.desktop.wm.preferences focus-new-windows 'strict'", { timeout: 2000 });
          } catch (_) { /* best-effort */ }
        }

        let captured = '';
        let captureError = null;
        try {
          // Spawn the Tk capture target
          const tkProc = spawn('python3', [targetScript, outfile, String(captureSeconds)], { stdio: 'ignore' });
          // Wait for Tk to fully map + focus
          await new Promise((r) => setTimeout(r, 1500));

          // Verify the target window grabbed focus (best-effort diagnostic)
          let focusedName = '';
          try { focusedName = execSync('xdotool getactivewindow getwindowname', { timeout: 1000 }).toString().trim(); } catch (_) { }

          // Fire the paste
          const pasteResult = await pasteStrategies.autoExecute(text, [strategy]);

          // Wait for the Tk capture to complete + write the outfile
          await new Promise((r) => {
            tkProc.on('close', () => r());
            setTimeout(r, (captureSeconds + 2) * 1000);
          });

          try { captured = fs.readFileSync(outfile, 'utf8'); } catch (e) { captureError = `outfile read failed: ${e.message}`; }
          try { fs.unlinkSync(outfile); } catch (_) { }

          const match = captured === text;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: pasteResult.ok && match,
            strategy,
            expected: text,
            captured,
            capturedLength: captured.length,
            match,
            focusedWindowDuringSpawn: focusedName,
            pasteResult,
            captureError,
          }, null, 2));
        } finally {
          if (originalPolicy) {
            try { execSync(`gsettings set org.gnome.desktop.wm.preferences focus-new-windows ${originalPolicy}`, { timeout: 2000 }); } catch (_) { }
          }
        }
        return;
      }
      // POST /install/polkit-rule body={enable: bool}
      // Install or remove the polkit auto-approve rule that lets
      // install_dependency run without prompts. Triggers ONE pkexec
      // prompt for this call; thereafter all whitelisted installs are
      // silent. The rule uses `subject.active` so it's portable across
      // fleet machines (any logged-in user, not hardcoded grantwhitmer).
      //
      // Linux only — macOS/Windows return 501.
      if (req.method === 'POST' && pathname === '/install/polkit-rule') {
        if (!PLATFORM.isLinux) {
          res.writeHead(501, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `polkit is Linux-only; this machine is ${process.platform}` }));
          return;
        }
        const body = await readJsonBody(req);
        if (typeof body.enable !== 'boolean') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'enable (boolean) required' }));
          return;
        }
        const rulePath = '/etc/polkit-1/rules.d/49-windy-install-deps.rules';
        const ruleContent = `// Windy Word — auto-approve pkexec for the install_dependency whitelist.
// Installed by the agent control surface's POST /install/polkit-rule
// endpoint. Uses subject.active so any logged-in fleet user gets the
// pass-through; doesn't hardcode a specific account.
polkit.addRule(function(action, subject) {
    if (action.id !== "org.freedesktop.policykit.exec") return;
    if (!subject.active) return;
    var cmd = action.lookup("command_line") || "";
    var allowed = /^\\/usr\\/bin\\/(dnf|apt-get|pacman)\\s+(install|-S)(\\s+(-y|--noconfirm))?\\s+(wtype|ydotool|wl-clipboard|xdotool|ffmpeg)\\s*$/;
    if (allowed.test(cmd)) {
        return polkit.Result.YES;
    }
});
`;
        try {
          if (body.enable) {
            // Write to /tmp first, then pkexec install to the system path.
            // Two-step keeps pkexec call simple (no nested sh -c).
            const tmpPath = path.join(os.tmpdir(), `windy-polkit-rule-${process.pid}-${Date.now()}.rules`);
            fs.writeFileSync(tmpPath, ruleContent);
            try {
              // pkexec install -o root -g root -m 644 SRC DST is a single
              // policykit.exec action (matches the action.id our rule
              // returns YES for, except we haven't installed yet — so the
              // user sees a prompt this one time).
              await execFileAsync('pkexec', ['install', '-o', 'root', '-g', 'root', '-m', '644', tmpPath, rulePath], { timeout: 60000 });
            } finally {
              try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
            console.info(`[AgentCtrl] polkit rule installed at ${rulePath}`);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              action: 'installed',
              path: rulePath,
              hint: 'Subsequent install_dependency calls for whitelisted tools will be prompt-free.',
            }));
            return;
          } else {
            // Remove via pkexec rm. May fail if the rule doesn't exist —
            // surface that as not-an-error.
            try {
              await execFileAsync('pkexec', ['rm', '-f', rulePath], { timeout: 30000 });
            } catch (e) {
              // pkexec exit codes: 126 = user cancel, 127 = auth failed
              if (e.code === 126) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, action: 'removal-cancelled', userCancelled: true }));
                return;
              }
              throw e;
            }
            console.info(`[AgentCtrl] polkit rule removed from ${rulePath}`);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, action: 'removed', path: rulePath }));
            return;
          }
        } catch (e) {
          const userMsg = e.code === 126 ? 'User cancelled the polkit prompt — rule not installed.'
            : e.code === 127 ? 'polkit authentication failed.'
            : `polkit setup failed: ${e.message}`;
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: userMsg, exitCode: e.code }));
        }
        return;
      }
      // POST /install/start — fire-and-poll install. Returns {jobId} immediately;
      // the caller polls /install/status?jobId=X. Body: {tool, dryRun?}.
      if (req.method === 'POST' && pathname === '/install/start') {
        const body = await readJsonBody(req);
        if (!body.tool || typeof body.tool !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'tool (string) required' }));
          return;
        }
        const job = installer.installAsync(body.tool, PLATFORM, { dryRun: !!body.dryRun });
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify(job, null, 2));
        return;
      }
      // GET /install/status?jobId=X — return current state of an async install job.
      if (req.method === 'GET' && pathname === '/install/status') {
        const jobId = urlObj.searchParams.get('jobId');
        if (!jobId) { res.writeHead(400); res.end('jobId query param required'); return; }
        const status = installer.getInstallStatus(jobId);
        res.writeHead(status.status === 'unknown' ? 404 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
        return;
      }
      // GET /install/jobs — list all current jobs (running + recently completed).
      if (req.method === 'GET' && pathname === '/install/jobs') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobs: installer.listJobs() }, null, 2));
        return;
      }
      // GET /settings/catalog — list curated agent-discoverable settings.
      // Each entry includes type, description, allowed values, current
      // value (from the live store), side-effect notes, and tags.
      // Optional ?tag=X filter narrows to entries with that tag (e.g.
      // ?tag=voice-clone returns just the voice-clone-relevant settings).
      if (req.method === 'GET' && pathname === '/settings/catalog') {
        const tag = urlObj.searchParams.get('tag') || undefined;
        const catalog = settingsCatalog.listCatalog({ tag }).map(e => ({
          ...e,
          currentValue: store.get(e.path),
        }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          count: catalog.length,
          ...(tag ? { tag } : {}),
          availableTags: settingsCatalog.allTags(),
          settings: catalog,
        }, null, 2));
        return;
      }
      // GET /settings/describe?path=engine.model — single catalog entry +
      // current value. 404 if path isn't in the catalog (use get_config for
      // paths outside).
      if (req.method === 'GET' && pathname === '/settings/describe') {
        const p = urlObj.searchParams.get('path');
        if (!p) { res.writeHead(400); res.end('path query param required'); return; }
        const entry = settingsCatalog.describe(p);
        if (!entry) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: `not in catalog: ${p}`, hint: 'Use list_settings to discover catalog paths, or get_config for the full unvalidated tree.' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...entry, currentValue: store.get(p) }, null, 2));
        return;
      }
      // POST /doctor/cloud-diagnose — bundle local doctor findings + platform
      // context and route to the windy-fix-me cloud-relay for LLM-augmented
      // remediation. Body shape: { sharedSecret? } — sharedSecret is forwarded
      // as the X-Windy-Fix-Me-Key header if the worker is configured to
      // require it. Falls back to env var WINDY_FIX_ME_KEY if the body omits
      // it, so agents calling cloud_diagnose with no args still authenticate
      // when the operator has the secret configured machine-wide. The local
      // findings are gathered server-side so the agent doesn't round-trip
      // them.
      if (req.method === 'POST' && pathname === '/doctor/cloud-diagnose') {
        const reqBody = await readJsonBody(req).catch(() => ({}));
        const localReport = await doctor.runDiagnostics(PLATFORM);
        const relayUrl = process.env.WINDY_FIX_ME_URL || 'https://windy-fix-me.windyword.workers.dev/diagnose';
        const sharedSecret = reqBody?.sharedSecret || process.env.WINDY_FIX_ME_KEY;
        const headers = { 'content-type': 'application/json' };
        if (sharedSecret) headers['x-windy-fix-me-key'] = sharedSecret;
        try {
          const upstream = await fetch(relayUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              findings: localReport.findings,
              platform: {
                os: process.platform,
                arch: process.arch,
                distro: PLATFORM.distro,
                distroVersion: PLATFORM.distroVersion,
                displayServer: PLATFORM.displayServer,
                desktop: PLATFORM.desktop,
              },
              productVersion: app.getVersion(),
            }),
          });
          const upstreamBody = await upstream.text();
          let upstreamJson;
          try { upstreamJson = JSON.parse(upstreamBody); } catch { upstreamJson = { raw: upstreamBody }; }
          res.writeHead(upstream.ok ? 200 : 502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: upstream.ok,
            local: localReport,
            cloud: upstreamJson,
            relayUrl,
          }, null, 2));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            local: localReport,
            error: `cloud relay unreachable: ${e.message}`,
            relayUrl,
          }, null, 2));
        }
        return;
      }
      // GET /doctor/diagnose — run the local diagnostic check battery.
      // Each finding includes a status (ok/warning/error/not_applicable),
      // severity, what was found, and (for non-ok findings) an actionable
      // remediation step that often references a specific MCP tool call.
      // No system mutation — pure read.
      if (req.method === 'GET' && pathname === '/doctor/diagnose') {
        const report = await doctor.runDiagnostics(PLATFORM);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(report, null, 2));
        return;
      }
      // GET /doctor/checks — list the catalog of available checks
      // (without running them). Useful for agent introspection.
      if (req.method === 'GET' && pathname === '/doctor/checks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          checks: doctor.CHECKS.map((c) => ({
            name: c.name,
            description: c.description,
            appliesToCurrentPlatform: c.appliesTo ? c.appliesTo(PLATFORM) : true,
          })),
        }, null, 2));
        return;
      }
      // POST /settings/set — validate body.value against the catalog entry
      // for body.path, then apply. Triggers known side effects:
      //   hotkeys.*       → unregister + registerHotkeys()
      //   engine.model    → WebSocket hot-reload to Python engine
      // Settings outside the catalog are rejected — use /config for those.
      if (req.method === 'POST' && pathname === '/settings/set') {
        const body = await readJsonBody(req);
        if (!body || typeof body.path !== 'string' || !('value' in body)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'body must be {path: string, value: any}' }));
          return;
        }
        const validationError = settingsCatalog.validate(body.path, body.value);
        if (validationError) {
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, path: body.path, error: validationError }));
          return;
        }
        const { previousValue, sideEffects } = applySettingChange(body.path, body.value, 'set_setting');
        const entry = settingsCatalog.describe(body.path);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          path: body.path,
          previousValue,
          currentValue: body.value,
          sideEffects,
          restartRequired: entry?.restartRequired || false,
        }, null, 2));
        return;
      }

      // GET /settings/history — recent catalog-validated changes in this
      // session, oldest first. The answer to "what did I just change?" /
      // "show me my last few setting changes". Each entry contains
      // { path, previousValue, newValue, timestamp, source }. Bounded by
      // SETTINGS_HISTORY_CAP; oldest entries drop as new ones land.
      if (req.method === 'GET' && pathname === '/settings/history') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          count: SETTINGS_HISTORY.length,
          cap: SETTINGS_HISTORY_CAP,
          history: SETTINGS_HISTORY.slice(),
        }, null, 2));
        return;
      }

      // POST /settings/undo — revert the most-recent catalog-validated
      // change. Pops the last entry from SETTINGS_HISTORY (only on success)
      // and replays its previousValue through applySettingChange so all
      // side effects (hotkey re-register, renderer notify, engine hot-
      // reload) fire correctly. Returns 404 with a clean error when there
      // is nothing to undo. Re-validates the previousValue defensively in
      // case the catalog has changed mid-session.
      if (req.method === 'POST' && pathname === '/settings/undo') {
        if (SETTINGS_HISTORY.length === 0) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'no settings changes to undo in this session' }));
          return;
        }
        const last = SETTINGS_HISTORY[SETTINGS_HISTORY.length - 1];
        const validationError = settingsCatalog.validate(last.path, last.previousValue);
        if (validationError) {
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `cannot undo: ${validationError}`, entry: last }));
          return;
        }
        SETTINGS_HISTORY.pop();
        const { sideEffects } = applySettingChange(last.path, last.previousValue, 'undo');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          undone: {
            path: last.path,
            restoredValue: last.previousValue,
            wasValue: last.newValue,
            originalTimestamp: last.timestamp,
            originalSource: last.source,
          },
          sideEffects,
          remainingHistory: SETTINGS_HISTORY.length,
        }, null, 2));
        return;
      }
    } catch (e) {
      console.error('[WaylandCtrl] handler error:', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    // ── Legacy action handlers (GNOME keybindings) ──
    const action = pathname.replace(/^\//, '');
    const focusWin = urlObj.searchParams.get('focuswin');
    if (focusWin && focusWin !== '0' && focusWin !== '') {
      _savedWaylandFocusTarget = focusWin;
    }
    if (actionHandlers[action]) {
      actionHandlers[action]();
      res.writeHead(200); res.end('OK');
      console.info(`[WaylandCtrl] Executed: ${action}`);
    } else {
      res.writeHead(404); res.end('Unknown action');
    }
  });

  _waylandControlServer.listen(WAYLAND_CONTROL_PORT, '127.0.0.1', () => {
    console.info(`[WaylandCtrl] Control server listening on 127.0.0.1:${WAYLAND_CONTROL_PORT}`);
  });
  _waylandControlServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WaylandCtrl] Port ${WAYLAND_CONTROL_PORT} in use — another instance may be running`);
    } else {
      console.error('[WaylandCtrl] Server error:', err.message);
    }
  });
}

function registerGnomeKeybindings() {
  if (!PLATFORM.isWayland || !PLATFORM.isGnome) return;
  if (!PLATFORM.hasGsettings) {
    console.warn('[WaylandCtrl] gsettings not available — skipping GNOME keybinding registration');
    return;
  }

  const hotkeys = store.get('hotkeys');

  // Map Electron accelerator format to GNOME keybinding format
  function toGnomeBinding(accel) {
    return accel
      .replace(/CommandOrControl\+/g, '<Ctrl>')
      .replace(/Control\+/g, '<Ctrl>')
      .replace(/Shift\+/g, '<Shift>')
      .replace(/Alt\+/g, '<Alt>')
      .replace(/Super\+/g, '<Super>')
      .replace(/\bSpace\b/g, 'space')
      .replace(/\bPlus\b/g, 'plus')
      .replace(/\bMinus\b/g, 'minus');
  }

  const bindings = [
    { name: 'Windy Word: Toggle Recording', binding: toGnomeBinding(hotkeys.toggleRecording), action: 'toggle-recording' },
    { name: 'Windy Word: Paste Transcript', binding: toGnomeBinding(hotkeys.pasteTranscript), action: 'paste-transcript' },
    { name: 'Windy Word: Show/Hide',        binding: toGnomeBinding(hotkeys.showHide),        action: 'show-hide' },
  ];

  const basePath = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';

  try {
    // Read existing custom keybindings
    const existingRaw = execSync(
      'gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings',
      { timeout: 3000 }
    ).toString().trim();

    // Parse existing array (format: ['path1', 'path2'] or @as [])
    let existing = [];
    if (existingRaw && existingRaw !== '@as []') {
      const m = existingRaw.match(/\[([^\]]*)\]/);
      if (m) {
        existing = m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
      }
    }

    // Remove any old "Windy Word:" or legacy "Windy Pro:" bindings
    const stalePaths = [];
    for (const p of existing) {
      try {
        const name = execSync(
          `gsettings get org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${p} name`,
          { timeout: 2000 }
        ).toString().trim().replace(/'/g, '');
        if (name.startsWith('Windy Word:') || name.startsWith('Windy Pro:')) {
          stalePaths.push(p);
        }
      } catch (_) { }
    }
    existing = existing.filter(p => !stalePaths.includes(p));

    // Find next available slot numbers
    const usedSlots = existing.map(p => {
      const m = p.match(/custom(\d+)/);
      return m ? parseInt(m[1], 10) : -1;
    }).filter(n => n >= 0);
    let nextSlot = 0;
    const getNextSlot = () => {
      while (usedSlots.includes(nextSlot)) nextSlot++;
      usedSlots.push(nextSlot);
      return nextSlot;
    };

    // Register each binding (plain curl — no nested-quote bash -c)
    for (const b of bindings) {
      const slot = getNextSlot();
      const kbPath = `${basePath}/custom${slot}/`;
      const cmd = `curl -s http://127.0.0.1:${WAYLAND_CONTROL_PORT}/${b.action}`;
      execSync(`gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${kbPath} name '${b.name}'`, { timeout: 2000 });
      execSync(`gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${kbPath} command '${cmd}'`, { timeout: 2000 });
      execSync(`gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${kbPath} binding '${b.binding}'`, { timeout: 2000 });
      existing.push(kbPath);
      console.info(`[WaylandCtrl] GNOME keybinding: ${b.binding} → ${b.action}`);
    }

    // Update the master list
    const pathList = existing.map(p => `'${p}'`).join(', ');
    execSync(
      `gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[${pathList}]"`,
      { timeout: 2000 }
    );

    console.info('[WaylandCtrl] GNOME keybindings registered successfully');
  } catch (err) {
    console.error('[WaylandCtrl] Failed to register GNOME keybindings:', err.message);
    console.info('[WaylandCtrl] Manual setup: Settings → Keyboard → Custom Shortcuts');
  }
}

// ── Wayland: user-level ydotoold daemon ──────────────────────────────────
// On Wayland, the only reliable way to inject keystrokes into Wayland-native
// apps (terminals, GNOME apps) is via /dev/uinput through ydotool. The
// system-level ydotoold (when present) creates a root-only socket the user
// can't access, so the app starts its own user-level daemon with a
// user-writable socket. See docs/WAYLAND-PASTE-FOCUS-GUIDE.md.
let _ydotoolSocket = null;
let _ydotooldProc = null;

function startUserYdotoold() {
  if (!PLATFORM.isWayland) return;
  const socketPath = path.join(os.tmpdir(), `ydotool-${process.getuid()}.socket`);
  try {
    fs.accessSync('/dev/uinput', fs.constants.W_OK);
  } catch {
    console.warn('[ydotool] /dev/uinput not writable — paste to Wayland-native apps unavailable.');
    console.warn('[ydotool] Fix: add user to "input" group + udev rule KERNEL=="uinput", GROUP="input", MODE="0660"');
    if (fs.existsSync('/tmp/.ydotool_socket')) {
      try {
        // Only trust the well-known socket if it's owned by root or us — otherwise another
        // local user could pre-plant a rogue socket at this predictable path and intercept
        // our injected keystrokes.
        const st = fs.statSync('/tmp/.ydotool_socket');
        const me = process.getuid ? process.getuid() : -1;
        if (st.uid === 0 || st.uid === me) {
          fs.accessSync('/tmp/.ydotool_socket', fs.constants.W_OK); _ydotoolSocket = '/tmp/.ydotool_socket';
        } else {
          console.warn('[ydotool] ignoring /tmp/.ydotool_socket — not owned by root or current user (uid ' + st.uid + ')');
        }
      } catch { }
    }
    return;
  }
  try { fs.unlinkSync(socketPath); } catch { }
  try {
    _ydotooldProc = spawn('ydotoold', ['--socket-path', socketPath], { stdio: 'ignore', detached: true });
    _ydotooldProc.unref();
    _ydotoolSocket = socketPath;
    let waited = 0;
    const interval = setInterval(() => {
      if (fs.existsSync(socketPath) || waited > 2000) {
        clearInterval(interval);
        if (fs.existsSync(socketPath)) {
          console.info(`[ydotool] User ydotoold started, socket: ${socketPath}`);
        } else {
          console.warn('[ydotool] ydotoold socket did not appear in time');
          _ydotoolSocket = null;
        }
      }
      waited += 100;
    }, 100);
  } catch (e) {
    console.warn('[ydotool] Failed to spawn user ydotoold:', e.message);
    _ydotoolSocket = null;
  }
}

/**
 * Register global hotkeys
 */
function registerHotkeys() {
  if (!app.isReady()) return;
  const hotkeys = store.get('hotkeys');

  // Throw-safe registration. globalShortcut.register() throws synchronously on an
  // unparseable accelerator (e.g. a macOS Option dead-key like "Alt+®"). If that
  // escapes — at rebind OR at startup when a bad value was persisted — it crashes the
  // whole app. Wrap each one so a single bad accelerator is skipped, never fatal, and
  // never blocks the remaining (good) shortcuts from registering.
  const safeRegister = (accel, cb) => {
    if (!accel || typeof accel !== 'string') return false;
    try {
      return globalShortcut.register(accel, cb);
    } catch (err) {
      console.warn(`[Hotkey] skipped invalid accelerator "${accel}": ${err.message}`);
      return false;
    }
  };

  // Log platform strategy for debugging
  if (PLATFORM.isLinux) {
    console.info(`[Hotkey] Platform: ${PLATFORM.displayServer}/${PLATFORM.desktop}, strategy: ${PLATFORM.hotkeyStrategy}`);
  }

  // Toggle recording — save & restore focus so cursor stays in target app
  const regToggle = safeRegister(hotkeys.toggleRecording, () => {
    // Only capture the focused app when STARTING recording (not when stopping).
    let savedWindowId = null;
    if (!isRecording) {
      try {
        if (process.platform === 'linux') {
          // SEC-M10/L5: Use execFileSync and validate window ID is numeric
          savedWindowId = execFileSync('xdotool', ['getactivewindow'], { timeout: 500 }).toString().trim();
          if (!/^\d+$/.test(savedWindowId)) savedWindowId = null;
        }
         // macOS: Take a FRESH PID snapshot RIGHT NOW at hotkey-press time.
        // Use async execFile to avoid blocking — the 500ms tracker already
        // has a recent PID, so this is just a refinement.
        if (process.platform === 'darwin') {
          try {
            const { BrowserWindow } = require('electron');
            const focusedWin = BrowserWindow.getFocusedWindow();
            if (!focusedWin) {
              // Our window is NOT focused — capture the frontmost app (non-blocking)
              execFile('osascript', ['-e',
                'tell application "System Events"\n' +
                '  set fp to first application process whose frontmost is true\n' +
                '  return (name of fp) & "|" & (unix id of fp)\n' +
                'end tell'
              ], { timeout: 1000 }, (err, stdout) => {
                if (err) return;
                const result = stdout.toString().trim();
                const sep = result.lastIndexOf('|');
                if (sep > 0) {
                  const appName = result.substring(0, sep);
                  const appPid = parseInt(result.substring(sep + 1), 10);
                  if (appPid && !global._ourPids.has(appPid)) {
                    global._lastFocusedApp = appName;
                    global._lastFocusedPid = appPid;
                    console.info(`[Focus] Target app (async snapshot): "${appName}" (pid ${appPid})`);
                  }
                }
              });
            } else {
              console.info('[Focus] Hotkey with own window focused — using previously tracked target');
            }
          } catch (_) { /* use tracker value */ }
          console.info(`[Focus] Target (tracker): "${global._lastFocusedApp || 'NONE'}" (pid ${global._lastFocusedPid || 'NONE'})`);
        }
      } catch (_) { }

      global._focusGuardActive = false;
    }

    toggleRecording();

    // Restore focus to the user's target app after a delay (only when STARTING)
    if (!isRecording) {
      // Just STOPPED recording — auto-paste will query current frontmost app
      return;
    }

    if (savedWindowId && process.platform === 'linux') {
      const restore = () => {
        try {
          require('child_process').execFile('xdotool', ['windowactivate', savedWindowId]);
        } catch (_) { }
      };
      setTimeout(restore, 200);
      setTimeout(restore, 500);
      setTimeout(restore, 1000);
    }
    // macOS: No focus restore needed — window is non-focusable, cursor stays blinking
  });
  console.info(`[Hotkey] Toggle recording (${hotkeys.toggleRecording}): ${regToggle ? 'OK' : 'FAILED'}`);

  // Paste transcript
  const regPaste = safeRegister(hotkeys.pasteTranscript, () => {
    pasteTranscript();
  });
  console.info(`[Hotkey] Paste transcript (${hotkeys.pasteTranscript}): ${regPaste ? 'OK' : 'FAILED'}`);

  // Paste clipboard (screenshots, copied text, etc.) via simulated Ctrl+V
  const pasteClipAccel = hotkeys.pasteClipboard || 'CommandOrControl+Shift+B';
  const regClipboard = safeRegister(pasteClipAccel, () => {
    // Small delay to let modifier keys release, then simulate Ctrl+V
    // CR-005: replace `exec('sleep … && …')` with execFile + setTimeout.
    // The literal strings were safe (no renderer input interpolated),
    // but the `&&` shell pattern is easy to accidentally break. Also
    // avoids spawning a shell just to sleep.
    const { execFile } = require('child_process');
    setTimeout(() => {
      if (process.platform === 'linux') {
        // --clearmodifiers ensures held keys (Ctrl+Shift from hotkey) don't interfere
        execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], (err) => {
          if (err) console.error('[Hotkey] Paste clipboard failed:', err.message);
        });
      } else if (process.platform === 'darwin') {
        execFile('osascript', ['-e',
          'tell application "System Events" to keystroke "v" using command down'],
          (err) => { if (err) console.error('[Hotkey] Paste clipboard failed:', err.message); });
      } else {
        // Windows: SendKeys ^v — no shell escapes needed when we pass
        // the script via -Command as a single argv element.
        execFile('powershell', ['-NoProfile', '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
        ], (err) => { if (err) console.error('[Hotkey] Paste clipboard failed:', err.message); });
      }
    }, 100);
  });
  console.info(`[Hotkey] Paste clipboard (${pasteClipAccel}): ${regClipboard ? 'OK' : 'FAILED'}`);

  // Show/hide window — three-state cycle: Full Window → Tornado → Hidden → Full Window
  const regShow = safeRegister(hotkeys.showHide, () => {
    const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    const miniVisible = miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible();

    if (mainVisible) {
      // State 1 → State 2: Full window → Tornado
      mainWindow.hide();
      showMiniWidget();
    } else if (miniVisible) {
      // State 2 → State 3: Tornado → Hidden (everything gone)
      miniWindow.hide();
      userHiddenWindow = true;  // Track that user intentionally hid everything
    } else {
      // State 3 → State 1: Hidden → Full window
      userHiddenWindow = false;  // User brought window back
      mainWindow.show();
      mainWindow.focus();
    }
  });
  console.info(`[Hotkey] Show/Hide (${hotkeys.showHide}): ${regShow ? 'OK' : 'FAILED'}`);

  // Quick Translate hotkey — skip when Translate is hidden (book-launch), so the
  // global Ctrl+Shift+T can't summon a hidden, cloud-only feature.
  let translationOn = true;
  try { translationOn = require('./edition').TRANSLATION_UI !== false; } catch (_) {}
  if (translationOn) {
    const qtAccel = hotkeys.quickTranslate || 'CommandOrControl+Shift+T';
    const regTranslate = safeRegister(qtAccel, () => {
      showMiniTranslateWindow();
    });
    console.info(`[Hotkey] Quick Translate (${qtAccel}): ${regTranslate ? 'OK' : 'FAILED'}`);
  } else {
    console.info('[Hotkey] Quick Translate skipped (Translate hidden in this edition)');
  }
}

/**
 * IPC: Rebind a hotkey from renderer Settings panel
 * Unregisters all shortcuts, updates the store, re-registers all
 */
const RESERVED_SHORTCUTS = [
  'CommandOrControl+V', 'CommandOrControl+C', 'CommandOrControl+X',
  'CommandOrControl+Z', 'CommandOrControl+A', 'CommandOrControl+S',
  'CommandOrControl+F', 'CommandOrControl+P', 'CommandOrControl+N',
  'CommandOrControl+W', 'CommandOrControl+T', 'CommandOrControl+Q',
  'Alt+F4'
];

const HOTKEY_DEFAULTS = {
  toggleRecording: 'CommandOrControl+Shift+Space',
  pasteTranscript: 'CommandOrControl+Shift+V',
  pasteClipboard: 'CommandOrControl+Shift+B',
  showHide: 'CommandOrControl+Shift+W',
  quickTranslate: 'CommandOrControl+Shift+T'
};

// Startup: sanitize any reserved shortcuts that were accidentally bound
function sanitizeHotkeys() {
  const hotkeys = store.get('hotkeys');
  let fixed = false;
  for (const [key, accel] of Object.entries(hotkeys)) {
    if (RESERVED_SHORTCUTS.includes(accel)) {
      console.warn(`[Hotkey] Resetting reserved shortcut ${key}: ${accel} → ${HOTKEY_DEFAULTS[key]}`);
      hotkeys[key] = HOTKEY_DEFAULTS[key];
      fixed = true;
    }
  }
  if (fixed) store.set('hotkeys', hotkeys);
}

// rebind-hotkey extracted to ./ui/settings-ipc.js — registered
// below once registerHotkeys is in scope.

/**
 * Toggle recording state
 */
function toggleRecording() {
  isRecording = !isRecording;

  // ── Wayland focus preservation ─────────────────────────────────────────
  // On Wayland, any Electron window manipulation (renderer DOM updates,
  // getUserMedia, AudioContext, button clicks) can cause XWayland to
  // request focus from Mutter, which steals the cursor from the user's
  // target app. setFocusable(false) sets WM_HINTS so Mutter ignores
  // those focus requests entirely.
  //
  // Apply to ALL Windy Word windows (mainWindow, miniWindow, videoWindow)
  // — any XWayland surface can steal focus, not just the main one.
  //
  // Re-enable after the focus-stealing work is done:
  //   start: ~3s   (getUserMedia + AudioContext + MediaRecorder init)
  //   stop:  ~10s  (stop recording + send to Python + transcribe + paste)
  // Re-enabling too early lets remaining renderer activity steal focus
  // right before paste fires.
  if (PLATFORM.isWayland) {
    const winsNow = [mainWindow, miniWindow, videoWindow].filter(w => w && !w.isDestroyed());
    winsNow.forEach(w => { try { w.setFocusable(false); } catch (_) { } });
    const delayMs = isRecording ? 3000 : 10000;
    setTimeout(() => {
      const winsLater = [mainWindow, miniWindow, videoWindow].filter(w => w && !w.isDestroyed());
      winsLater.forEach(w => { try { w.setFocusable(true); } catch (_) { } });
    }, delayMs);
  }

  safeSend('toggle-recording', isRecording);
  updateTrayMenu();
  updateTrayIcon(isRecording ? 'listening' : 'idle');

  // Update mini widget state if it's visible (don't force-show it)
  updateMiniState(isRecording ? 'recording' : 'idle');

  // Update tray icon color based on state
  if (tray) {
    tray.setToolTip(isRecording ? 'Windy Word — Recording (click the tray icon to stop)' : 'Windy Word');
  }

  // macOS: getUserMedia/AudioContext in Chromium steal focus even with focusable:false.
  // Restore focus to the tracked target app in rapid succession to keep the cursor blinking.
  // The cursor may flicker for ~150ms but comes back immediately.
  if (isRecording && process.platform === 'darwin' && global._lastFocusedPid) {
    const targetPid = global._lastFocusedPid;
    const targetApp = global._lastFocusedApp;
    const restoreFocus = () => {
      if (!isRecording) return;
      execFile('osascript', ['-e',
        `tell application "System Events" to set frontmost of (first application process whose unix id is ${targetPid}) to true`
      ], { timeout: 1500 }, (err) => {
        if (!err) console.info(`[Focus] ✓ Cursor restored to "${targetApp}" (pid ${targetPid})`);
      });
    };
    // Rapid-fire restores: getUserMedia steals at ~100ms, AudioContext may steal again at ~300ms
    setTimeout(restoreFocus, 150);
    setTimeout(restoreFocus, 400);
    setTimeout(restoreFocus, 800);
  }
}

/**
 * Paste current transcript to cursor position
 */
function pasteTranscript() {
  safeSend('request-transcript');
}

// IPC Handlers

// Get transcript and paste it via cursor injection
ipcMain.on('transcript-for-paste', async (event, transcript) => {
  // CR-004: ipcMain.on (not handle) doesn't propagate the rejection
  // back to the renderer — async exceptions become process-level
  // unhandledRejection events. Wrap the WHOLE body so any throw
  // (mainWindow destroyed mid-flight, injector unavailable, etc.)
  // becomes a logged error instead of crashing the dialog handler.
  try {
    if (!transcript || !transcript.trim()) return;
    safeSend('state-change', 'injecting');
    updateTrayIcon('injecting');

    // macOS: Activate tracked target app by PID before injecting.
    // Must actively restore focus because macOS may have shifted
    // focus to an Electron helper during processing.
    if (process.platform === 'darwin' && global._lastFocusedPid) {
      try {
        execFileSync('osascript', ['-e',
          `tell application "System Events" to set frontmost of (first application process whose unix id is ${global._lastFocusedPid}) to true`
        ], { timeout: 2000 });
        console.info(`[Paste] Activated "${global._lastFocusedApp}" (pid ${global._lastFocusedPid})`);
      } catch (_) { /* best-effort */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    } else if (process.platform !== 'darwin' && !PLATFORM.isWayland && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      // X11 only: hiding generates an unmap that lets focus pass to the prior
      // window. On Wayland this is forbidden — Mutter doesn't transfer focus
      // back reliably, so we'd lose the paste target. Window is focusable:false
      // on Wayland anyway, so it never had focus to release.
      mainWindow.hide();
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    try {
      await getInjector().inject(transcript);
    } catch (error) {
      console.error('Injection failed:', error.message);
      safeSend('injection-error', error.message);
    }

    // Restore UI state (window is already visible on macOS)
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.showInactive();  // Show without taking focus (non-macOS)
        }
        const newState = isRecording ? 'listening' : 'idle';
        safeSend('state-change', newState);
        updateTrayIcon(newState);
      } catch (e) { console.error('[transcript-for-paste] restore-state failed:', e.message); }
    }, 500);
  } catch (e) {
    // Last-line-of-defence: never let an async exception escape an
    // ipcMain.on listener.
    console.error('[transcript-for-paste] handler threw:', e?.message || e);
    writeCrashLog('transcript-for-paste', e);
  }
});

// Check injection permissions
ipcMain.handle('check-injection-permissions', async () => {
  try {
    return getInjector().checkPermissions();
  } catch (err) {
    console.error('[check-injection-permissions] Error:', err.message);
    return { error: err.message, permitted: false };
  }
});

// Update settings — accepts flat keys from renderer and routes to correct store namespace
// CR-009 cont: update-settings / get-settings / get-app-version /
// get-font-size / set-font-size / rebind-hotkey extracted to
// ./ui/settings-ipc.js. registerHotkeys is defined above, so the
// registrar can take a direct reference.
const { registerSettingsIpc } = require('./ui/settings-ipc');
const _mainWindowRefForSettings = {
  get current() { return mainWindow; },
};
registerSettingsIpc({
  ipcMain,
  store,
  app,
  safeStorage,
  globalShortcut,
  registerHotkeys,
  mainWindowRef: _mainWindowRefForSettings,
  reservedShortcuts: RESERVED_SHORTCUTS,
});

// Edition flags for the renderer. With `sandbox: true`, the preload CANNOT
// require() local modules — so it can't read edition.js directly. The main
// process can, and exposes the book-launch flags synchronously via sendSync so
// the renderer has them before first paint (used by edition-ui.js + settings.js).
ipcMain.on('get-edition-flags', (event) => {
  try {
    const ed = require('./edition');
    event.returnValue = {
      edition: ed.EDITION,
      ecosystemUI: ed.ECOSYSTEM_UI !== false,
      translationUI: ed.TRANSLATION_UI !== false,
      unlimitedRecording: ed.UNLIMITED_RECORDING === true,
      cloudStorage: ed.CLOUD_STORAGE !== false,
    };
  } catch (_) {
    event.returnValue = { edition: 'reader', ecosystemUI: true, translationUI: true, unlimitedRecording: false, cloudStorage: true };
  }
});

// SEC-P0: Encrypted API key storage via safeStorage (replaces plaintext localStorage)
ipcMain.handle('set-api-key', (event, keyName, keyValue) => {
  const allowedKeys = ['groqApiKey', 'openaiApiKey', 'deepgramApiKey'];
  if (!allowedKeys.includes(keyName)) return { ok: false, error: 'Unknown key name' };
  if (!keyValue || typeof keyValue !== 'string') {
    // Clear the key
    store.delete(`engine.${keyName}`);
    store.delete(`engine.${keyName}Encrypted`);
    return { ok: true };
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(keyValue.trim());
      store.set(`engine.${keyName}Encrypted`, encrypted.toString('base64'));
      store.delete(`engine.${keyName}`); // Remove any old plaintext key
    } else {
      // Fallback: store in electron-store (still better than renderer localStorage)
      store.set(`engine.${keyName}`, keyValue.trim());
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-api-key', (event, keyName) => {
  const allowedKeys = ['groqApiKey', 'openaiApiKey', 'deepgramApiKey'];
  if (!allowedKeys.includes(keyName)) return '';
  try {
    // Try encrypted first
    const encB64 = store.get(`engine.${keyName}Encrypted`, '');
    if (encB64 && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encB64, 'base64'));
    }
    // Fallback to plaintext store or env vars
    const envMap = { groqApiKey: 'GROQ_API_KEY', openaiApiKey: 'OPENAI_API_KEY', deepgramApiKey: 'DEEPGRAM_API_KEY' };
    return store.get(`engine.${keyName}`, '') || process.env[envMap[keyName]] || '';
  } catch (err) {
    return '';
  }
});

// M5: Deepgram WebSocket proxy — keeps API key in main process, never sent to renderer
let _dgProxyWs = null;
ipcMain.handle('deepgram-stream-start', async (_event, opts) => {
  try {
    const apiKey = await (async () => {
      const encB64 = store.get('engine.deepgramApiKeyEncrypted', '');
      if (encB64 && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encB64, 'base64'));
      }
      return store.get('engine.deepgramApiKey', '') || process.env.DEEPGRAM_API_KEY || '';
    })();
    if (!apiKey) return { ok: false, error: 'No Deepgram API key configured' };

    const WebSocket = require('ws');
    const lang = opts?.language || 'en';
    const diarize = opts?.diarize || false;
    let dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${encodeURIComponent(lang)}&smart_format=true&interim_results=true&punctuate=true`;
    if (diarize) dgUrl += '&diarize=true';

    // Connect with Authorization header (not sub-protocol) — API key stays server-side
    _dgProxyWs = new WebSocket(dgUrl, { headers: { 'Authorization': `Token ${apiKey}` } });

    _dgProxyWs.on('open', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deepgram-proxy-open');
      }
    });
    _dgProxyWs.on('message', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deepgram-proxy-message', data.toString());
      }
    });
    _dgProxyWs.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deepgram-proxy-error', err.message || 'WebSocket error');
      }
    });
    _dgProxyWs.on('close', () => {
      _dgProxyWs = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deepgram-proxy-close');
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('deepgram-stream-send', (_event, audioBuffer) => {
  if (_dgProxyWs && _dgProxyWs.readyState === 1) { // WebSocket.OPEN
    _dgProxyWs.send(Buffer.from(audioBuffer));
    return true;
  }
  return false;
});

ipcMain.handle('deepgram-stream-stop', () => {
  if (_dgProxyWs) {
    try { _dgProxyWs.close(); } catch (_) {}
    _dgProxyWs = null;
  }
  return true;
});

ipcMain.handle('choose-archive-folder', async () => {
  const oldFolder = getArchiveFolder();
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: oldFolder
  });
  if (result.canceled || !result.filePaths?.length) return { canceled: true };
  const selected = result.filePaths[0];

  // Check if old folder has existing archive data to migrate
  let hasExistingData = false;
  try {
    if (fs.existsSync(oldFolder)) {
      const dirs = fs.readdirSync(oldFolder).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      hasExistingData = dirs.length > 0;
    }
  } catch (_) { }

  if (hasExistingData && selected !== oldFolder) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Copy files to new folder', 'Start fresh (keep old files where they are)', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Migrate Archive?',
      message: `You have existing recordings in:\n${oldFolder}\n\nWould you like to copy them to the new folder?`,
      detail: 'Copying ensures all your recordings, audio, and video stay accessible in the new location. If you start fresh, old recordings remain in the original folder.'
    });

    if (response === 2) return { canceled: true }; // Cancel

    if (response === 0) {
      // Copy existing archive data to new folder
      try {
        const dirs = fs.readdirSync(oldFolder).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
        let copied = 0;
        for (const dir of dirs) {
          const srcDir = path.join(oldFolder, dir);
          const destDir = path.join(selected, dir);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          const files = fs.readdirSync(srcDir);
          for (const file of files) {
            const srcFile = path.join(srcDir, file);
            const destFile = path.join(destDir, file);
            if (!fs.existsSync(destFile)) {
              fs.copyFileSync(srcFile, destFile);
              copied++;
            }
          }
        }
        console.info(`[Archive] Migrated ${copied} files from ${oldFolder} to ${selected}`);
      } catch (err) {
        console.error('[Archive] Migration error:', err.message);
        await dialog.showMessageBox({
          type: 'warning',
          title: 'Migration Warning',
          message: `Some files may not have been copied: ${err.message}\n\nYour original files are still safe in: ${oldFolder}`
        });
      }
    }
    // response === 1: Start fresh, just change the folder
  }

  store.set('engine.archiveFolder', selected);
  return { canceled: false, path: selected };
});

ipcMain.on('open-archive-folder', () => {
  const folder = getArchiveFolder();
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
});

ipcMain.handle('copy-to-clipboard', async (event, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle('open-external-url', async (event, url) => {

  // Security: validate URL — allow https and mailto
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      console.warn('[Main] Blocked non-https/mailto external URL:', url);
      return { ok: false, error: 'Only HTTPS and mailto URLs are allowed' };
    }
  } catch (e) {
    console.warn('[Main] Invalid URL:', url);
    return { ok: false, error: 'Invalid URL' };
  }

  // Linux: BrowserWindow is the most reliable on AppImage
  if (process.platform === 'linux') {
    // mailto: can't be loaded into a BrowserWindow (no navigation, false success).
    // Hand it to the system default mail handler instead.
    {
      const parsed = new URL(url);
      if (parsed.protocol === 'mailto:') {
        await shell.openExternal(url);
        return { ok: true };
      }
    }
    // Method 1: BrowserWindow (opens inside app — with OAuth support)
    try {
      const extWin = new BrowserWindow({
        width: 1100,
        height: 750,
        title: 'Windy Word — Browser',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: true,
          partition: 'persist:checkout'
        }
      });

      // Allow OAuth popups — open them in new BrowserWindows
      extWin.webContents.setWindowOpenHandler(({ url: popupUrl }) => {

        // Open OAuth popups in a new BrowserWindow
        const popupWin = new BrowserWindow({
          width: 600,
          height: 700,
          title: 'Sign In',
          autoHideMenuBar: true,
          parent: extWin,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            javascript: true,
            partition: 'persist:checkout'
          }
        });
        popupWin.loadURL(popupUrl);
        popupWin.focus();
        // Allow popups inside popups (OAuth redirect chains)
        // SEC-H4: Only allow https:// URLs to prevent protocol injection
        popupWin.webContents.setWindowOpenHandler(({ url: nestedUrl }) => {
          if (nestedUrl.startsWith('https://') || nestedUrl.startsWith('http://')) {
            popupWin.loadURL(nestedUrl);
          }
          return { action: 'deny' };
        });
        return { action: 'deny' }; // deny default, we handled it manually
      });

      // SEC-H8: Only allow http(s) navigation — block file://, javascript://, etc.
      extWin.webContents.on('will-navigate', (event, navUrl) => {
        if (!navUrl.startsWith('https://') && !navUrl.startsWith('http://')) {
          event.preventDefault();
        }
      });

      extWin.loadURL(url);
      extWin.focus();
      console.info('[Main] ✅ Opened URL in BrowserWindow (Linux primary)');
      return { ok: true };
    } catch (e) {
      console.error('[Main] BrowserWindow failed:', e.message);
    }

    // Method 2: xdg-open fallback
    try {
      const { spawn } = require('child_process');
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      console.info('[Main] ✅ Opened URL via xdg-open (Linux fallback)');
      return { ok: true };
    } catch (e) {
      console.warn('[Main] xdg-open failed:', e.message);
    }

    // Method 3: shell.openExternal
    try {
      // SEC-06: Validate URL before shell.openExternal
      if (isSafeURL(url)) await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      console.error('[Main] All methods failed on Linux');
      return { ok: false, error: e.message };
    }
  }

  // macOS/Windows: shell.openExternal works reliably
  try {
    // SEC-06: Validate URL before shell.openExternal
    if (isSafeURL(url)) await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    console.error('[Main] shell.openExternal failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// Reveal a file in the OS file manager (Finder/Explorer) — used by the Share feature.
// The preload bridge + UI button are wired by another agent.
ipcMain.handle('reveal-in-folder', (e, filePath) => {
  try {
    require('electron').shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════════════
// WindyTune Adaptive Model Tracker
// ═══════════════════════════════════════════════════════════════════
const _windyTuneHistory = [];          // Rolling window of last 10 transcription timings
// The exact ct2 engine ids, ascending accuracy/cost. These are the model ids the
// engine actually reports + accepts, so indexOf() against the running model id works.
const WINDYTUNE_ALL_LADDER = [
  'windy-nano-ct2',
  'windy-lite-ct2',
  'windy-core-ct2',
  'windy-edge-ct2',
  'windy-plus-ct2',
  'windy-turbo-ct2',
  'windy-pro-engine-ct2',
]; // fastest/lightest → most accurate

// Resolve a model id to its on-disk dir (user-downloaded OR bundled). Mirrors the
// per-batch findModelDir helper but at module scope so the ladder can be derived
// from what's actually present. Lean Windy engines use canonical ct2 ids
// (bundled/model/<id>/); legacy whisper names use faster-whisper-<name>/.
function _windyTuneModelDir(m) {
  const dirFor = (n) => (/-ct2$/.test(n) ? n : `faster-whisper-${n}`);
  const userRoot = path.join(os.homedir(), '.windy-pro', 'model');
  const u = path.join(userRoot, dirFor(m));
  if (fs.existsSync(path.join(u, 'model.bin'))) return u;
  const bundledRoot = process.resourcesPath ? path.join(process.resourcesPath, 'bundled', 'model') : '';
  if (bundledRoot) {
    const b = path.join(bundledRoot, dirFor(m));
    if (fs.existsSync(path.join(b, 'model.bin'))) return b;
  }
  return null;
}

// Tank-proof: WindyTune may only move among models that are actually present on the
// machine — it can never auto-switch to an absent model and trigger a silent multi-GB
// download (the wobble we're killing). Derive the bundled set from on-disk model.bin
// presence instead of hardcoding it. With one present model the ladder has a single
// rung, so Auto simply stays put; the full engine pack lights up extra rungs.
const WINDYTUNE_MODEL_LADDER = WINDYTUNE_ALL_LADDER.filter(m => _windyTuneModelDir(m) !== null);
const WINDYTUNE_THRESHOLDS = {
  DOWNGRADE_RATIO: 2.0,       // transcription_time / audio_duration > 2x → too slow
  UPGRADE_RATIO: 0.3,         // ratio < 0.3 → model is fast enough to try bigger
  CRITICAL_RATIO: 4.0,        // a single transcription > 4x slower than real-time → immediate downgrade
  CRITICAL_MIN_AUDIO_S: 5,    // ...but only with ≥5s of audio, so a short-clip cold-start outlier can't false-trigger
  AUTO_DOWNGRADE_AFTER: 2,    // consecutive slow transcriptions before auto-switch
  PROMPT_UPGRADE_AFTER: 3,    // consecutive fast transcriptions before suggesting upgrade
};

function _windyTuneRecord(elapsed, audioDuration, model) {
  const ratio = elapsed / Math.max(audioDuration, 0.1);
  _windyTuneHistory.push({ elapsed, audioDuration, ratio, model, ts: Date.now() });
  // Keep last 10
  if (_windyTuneHistory.length > 10) _windyTuneHistory.shift();

  const isWindyTune = store.get('engine.engine') === 'windytune';
  if (!isWindyTune) return; // Only adapt in WindyTune auto mode

  // Map the running model id onto the ct2 ladder so indexOf is never -1.
  // Legacy whisper names ('base' / 'faster-whisper-base') and any model not on the
  // ladder anchor at 'windy-lite-ct2' so downgrade (toward nano) + upgrade can fire.
  let ladderModel = model;
  if (WINDYTUNE_MODEL_LADDER.indexOf(ladderModel) < 0) {
    ladderModel = WINDYTUNE_MODEL_LADDER.indexOf('windy-lite-ct2') >= 0
      ? 'windy-lite-ct2'
      : (WINDYTUNE_MODEL_LADDER[0] || null);
  }
  const currentIdx = ladderModel === null ? -1 : WINDYTUNE_MODEL_LADDER.indexOf(ladderModel);
  if (currentIdx < 0) return; // No present model on the ladder, can't adapt
  model = ladderModel; // downstream switch/messages use the ladder id

  // ── Critical: a single transcription far slower than real-time → immediate downgrade.
  // Uses RATIO, not absolute elapsed. A long (dictate-a-whole-book) recording legitimately
  // takes many seconds to transcribe, so the old `elapsed > 30s` rule wrongly pinned whole
  // sessions down to the lowest-accuracy engine. Ratio is length-independent; the min-audio
  // guard keeps a short-clip cold-start outlier from tripping it. ──
  if (audioDuration >= WINDYTUNE_THRESHOLDS.CRITICAL_MIN_AUDIO_S &&
      ratio > WINDYTUNE_THRESHOLDS.CRITICAL_RATIO && currentIdx > 0) {
    const newModel = WINDYTUNE_MODEL_LADDER[currentIdx - 1];
    console.warn(`[WindyTune] ⚡ CRITICAL: ${ratio.toFixed(1)}x slower than real-time (${elapsed.toFixed(1)}s / ${audioDuration.toFixed(1)}s) → auto-switching ${model} → ${newModel}`);
    _windyTuneSwitch(newModel, `Transcription ran ${ratio.toFixed(1)}× slower than real time — switched to ${newModel} for speed`);
    return;
  }

  // ── Auto-downgrade: 2+ consecutive slow (ratio > 2x) ──
  const recentSlow = _windyTuneHistory.slice(-WINDYTUNE_THRESHOLDS.AUTO_DOWNGRADE_AFTER);
  if (recentSlow.length >= WINDYTUNE_THRESHOLDS.AUTO_DOWNGRADE_AFTER &&
      recentSlow.every(h => h.ratio > WINDYTUNE_THRESHOLDS.DOWNGRADE_RATIO) &&
      currentIdx > 0) {
    const newModel = WINDYTUNE_MODEL_LADDER[currentIdx - 1];
    const avgRatio = (recentSlow.reduce((s, h) => s + h.ratio, 0) / recentSlow.length).toFixed(1);
    console.warn(`[WindyTune] ⚡ Auto-downgrade: avg ratio ${avgRatio}x → switching ${model} → ${newModel}`);
    _windyTuneSwitch(newModel, `WindyTune switched to ${newModel} for faster performance (avg ${avgRatio}x slower than real-time)`);
    return;
  }

  // ── Suggest upgrade: 3+ consecutive fast (ratio < 0.3x) ──
  const recentFast = _windyTuneHistory.slice(-WINDYTUNE_THRESHOLDS.PROMPT_UPGRADE_AFTER);
  if (recentFast.length >= WINDYTUNE_THRESHOLDS.PROMPT_UPGRADE_AFTER &&
      recentFast.every(h => h.ratio < WINDYTUNE_THRESHOLDS.UPGRADE_RATIO) &&
      currentIdx < WINDYTUNE_MODEL_LADDER.length - 1) {
    const suggestedModel = WINDYTUNE_MODEL_LADDER[currentIdx + 1];
    const avgRatio = (recentFast.reduce((s, h) => s + h.ratio, 0) / recentFast.length).toFixed(2);
    console.info(`[WindyTune] 🎯 Upgrade suggestion: avg ratio ${avgRatio}x → suggesting ${suggestedModel}`);
    safeSend('windytune-suggest-upgrade', {
      currentModel: model,
      suggestedModel,
      avgRatio,
      message: `Your hardware can handle ${suggestedModel} for better accuracy`
    });
    // Don't auto-switch — wait for user confirmation
  }
}

function _windyTuneSwitch(newModel, userMessage) {
  const oldModel = store.get('engine.model');
  store.set('engine.model', newModel);
  console.info(`[WindyTune] Model switched: ${oldModel} → ${newModel}`);

  // Notify renderer
  safeSend('windytune-model-switched', {
    oldModel, newModel, message: userMessage,
    canUndo: true
  });

  // Send config update to the Python WS server to hot-reload the model
  if (pythonProcess && !pythonProcess.killed) {
    try {
      const WebSocket = require('ws');
      const serverConfig = store.get('server', { host: '127.0.0.1', port: 9876 });
      const ws = new WebSocket(`ws://${serverConfig.host}:${serverConfig.port}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'config', config: { model: newModel } }));
        setTimeout(() => ws.close(), 5000); // Close after model reload
      });
      ws.on('error', () => { /* Server may be restarting */ });
    } catch (_) { /* ws module may not be available */ }
  }
}

// IPC: User accepts/rejects upgrade suggestion from renderer
ipcMain.handle('windytune-accept-upgrade', async (event, newModel) => {
  console.info(`[WindyTune] User accepted upgrade to ${newModel}`);
  _windyTuneSwitch(newModel, `Upgraded to ${newModel} for improved accuracy`);
  return { ok: true };
});

ipcMain.handle('windytune-undo-switch', async (event, oldModel) => {
  console.info(`[WindyTune] User undid model switch → reverting to ${oldModel}`);
  _windyTuneSwitch(oldModel, `Reverted to ${oldModel}`);
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════
// WS-routed batch transcription (fast path — model already loaded)
// ═══════════════════════════════════════════════════════════════════
async function _transcribeViaWS(wavPath) {
  const WebSocket = require('ws');
  const serverConfig = store.get('server', { host: '127.0.0.1', port: 9876 });
  const wsUrl = `ws://${serverConfig.host}:${serverConfig.port}`;

  const SAFE_FRAME = 45 * 1024 * 1024;   // stay safely under the server's 50MB frame limit
  const UPLOAD_CHUNK = 8 * 1024 * 1024;  // sub-frame chunk size for large recordings

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    let responded = false;

    // Self-renewing idle timeout. Long recordings on a slow CPU can take many
    // minutes to transcribe; a fixed 120s wrongly aborted them (and a >50MB blob
    // used to be rejected outright). We now give up only after a long stretch with
    // NO message from the server, resetting the clock on every message received.
    let timer = null;
    const IDLE_MS = 15 * 60 * 1000; // 15 min of total server silence => give up
    const fail = (err) => {
      if (responded) return;
      responded = true;
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      reject(err);
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(new Error('WS transcription timeout (no progress for 15m)')), IDLE_MS);
    };
    arm();

    ws.on('open', async () => {
      try {
        const audioData = await fsp.readFile(wavPath);
        const ext = (_path.extname(wavPath) || '.wav').slice(1) || 'wav';
        if (audioData.length <= SAFE_FRAME) {
          // Common path — unchanged: one command + one binary frame.
          ws.send(JSON.stringify({ action: 'transcribe_blob', language: 'auto', format: ext }));
          ws.send(audioData);
        } else {
          // Large recording — stream in sub-frame chunks so we never hit the 50MB
          // WS frame limit, then signal end. The server reassembles to disk and
          // transcribes the whole file (bounded RAM). This is what makes the
          // "unlimited recording" promise actually deliverable.
          ws.send(JSON.stringify({ action: 'transcribe_upload', language: 'auto', format: ext }));
          for (let off = 0; off < audioData.length; off += UPLOAD_CHUNK) {
            ws.send(audioData.subarray(off, Math.min(off + UPLOAD_CHUNK, audioData.length)));
          }
          ws.send(JSON.stringify({ action: 'transcribe_upload_end' }));
        }
      } catch (err) {
        fail(err);
      }
    });

    ws.on('message', (data) => {
      if (responded) return;
      arm(); // server is alive and working — extend the deadline
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'transcribe_result') {
          responded = true;
          if (timer) clearTimeout(timer);
          ws.close();
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg);
          }
        }
      } catch (_) { /* non-JSON message */ }
    });

    ws.on('error', (err) => fail(err));
  });
}

// ═══════════════════════════════════════════════════════════════════
// Path-based audio transcription (agent control surface)
// ═══════════════════════════════════════════════════════════════════
// Shared helper: transcribe any audio file at `audioPath` via ffmpeg →
// WebSocket-routed Python engine. Format auto-detection via ffmpeg's
// probe (drops the -f webm flag the legacy IPC uses) so .wav, .mp3,
// .m4a, .ogg, .flac, .webm etc. all work.
//
// Returns the same shape the IPC handler returns (text or full WS
// result depending on caller).
/**
 * Resolve an ABSOLUTE path to the ffmpeg binary for the transcription pipeline.
 *
 * GUI-launched macOS apps do NOT inherit the shell PATH (no /usr/local/bin or
 * /opt/homebrew/bin), so a bare `spawn('ffmpeg')` throws ENOENT even when
 * ffmpeg is installed for terminal use — the exact "Transcription failed:
 * spawn ffmpeg ENOENT" symptom. We must hand spawn an absolute path. Priority:
 *   1. wizard-installed copy (~/.windy-pro/bin, <userData>/bin) — writable
 *   2. in-app bundled ffmpeg (Resources/bundled/ffmpeg[-<arch>]) — always
 *      shipped + correct arch; the reliable hit in a packaged build. Arch
 *      suffix supports universal (multi-arch) builds.
 *   3. legacy mis-located paths, kept as harmless fallbacks
 *   4. common Homebrew/system locations (defensive, for the GUI-PATH case)
 *   5. bare 'ffmpeg' (PATH) — last resort
 */
function resolveFfmpegBin() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const home = path.join(os.homedir(), '.windy-pro');
  let userData = null;
  try { userData = app.getPath('userData'); } catch (_) {}
  const res = process.resourcesPath;
  const candidates = [
    path.join(home, 'bin', exe),
    userData && path.join(userData, 'bin', exe),
    res && path.join(res, 'bundled', `ffmpeg-${process.arch}`, exe),
    res && path.join(res, 'bundled', 'ffmpeg', exe),
    path.join(home, 'ffmpeg', exe),
    userData && path.join(userData, 'ffmpeg', exe),
    process.execPath && path.join(path.dirname(process.execPath), exe),
    '/opt/homebrew/bin/' + exe,
    '/usr/local/bin/' + exe,
    '/usr/bin/' + exe,
  ].filter(Boolean);
  for (const fp of candidates) {
    try { if (fs.existsSync(fp)) return fp; } catch (_) { /* ignore */ }
  }
  // No bundled or system ffmpeg found. Windows has no system ffmpeg, so the bare
  // fallback below ENOENTs at transcribe time — log loudly so a packaging regression
  // (missing bundled ffmpeg) is diagnosable instead of a silent per-recording failure.
  console.error('[ffmpeg] no bundled/system ffmpeg found; falling back to bare "ffmpeg" (will fail on Windows). checked: ' + candidates.join(', '));
  return 'ffmpeg';
}

async function _transcribeAudioFile(audioPath, opts = {}) {
  const tmpDir = os.tmpdir();
  const tmpId = crypto.randomBytes(16).toString('hex');
  const wavPath = path.join(tmpDir, `windy-agent-batch-${tmpId}.wav`);

  // Locate ffmpeg — GUI apps don't inherit shell PATH, so resolve an absolute path.
  const ffmpegBin = resolveFfmpegBin();

  try {
    await execFileAsync(ffmpegBin, [
      '-hide_banner', '-y',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', audioPath,                              // auto-detect input format
      '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', wavPath
    ], { timeout: 60000 });

    const wsStart = Date.now();
    const wsResult = await _transcribeViaWS(wavPath);
    const transcribeMs = Date.now() - wsStart;

    if (typeof _windyTuneRecord === 'function') {
      try { _windyTuneRecord(wsResult.elapsed_s, wsResult.audio_duration_s, wsResult.model); } catch (_) {}
    }

    return {
      ok: true,
      transcript: wsResult.text || '',
      transcribeMs,
      audioDurationSec: wsResult.audio_duration_s,
      modelUsed: wsResult.model,
      ratio: wsResult.ratio,
      via: 'ws',
    };
  } finally {
    try { fs.unlinkSync(wavPath); } catch (_) {}
  }
}

ipcMain.handle('batch-transcribe-local', async (event, base64Audio) => {
  // Top-level timeout: a wedged engine (model inference hang) can't freeze the UI
  // forever. Scale it with recording length so long dictations aren't killed mid-
  // transcribe — the old fixed 180s silently lost book-length recordings (the
  // "unlimited recording" promise). ~90s of budget per minute of opus audio covers
  // even the slowest engine on CPU; floored at 3 min for short clips, capped at 4 h.
  const approxBytes = (base64Audio?.length || 0) * 0.75;   // base64 ≈ 1.33× binary
  const approxMinutes = approxBytes / (1024 * 1024);        // opus ≈ 1 MB/min
  const dynTimeoutMs = Math.min(4 * 60 * 60 * 1000, Math.max(180000, Math.round(approxMinutes * 90000)));
  return withTimeout((async () => {
  console.info('[Batch Local] Starting transcription, audio size:', base64Audio?.length || 0, 'chars');
  const batchStartTime = Date.now();
  const tmpDir = os.tmpdir();
  // SEC-M8: Use crypto.randomBytes for unpredictable temp filenames
  const tmpId = crypto.randomBytes(16).toString('hex');
  const webmPath = path.join(tmpDir, `windy-batch-${tmpId}.webm`);
  const wavPath = path.join(tmpDir, `windy-batch-${tmpId}.wav`);

  try {
    // Save base64 audio to temp file
    const buffer = Buffer.from(base64Audio, 'base64');
    await fsp.writeFile(webmPath, buffer);
    console.info('[Batch Local] Saved webm:', webmPath, '— size:', buffer.length, 'bytes');

    // appDataDir is reused later in this handler (venv resolution); keep it.
    const appDataDir = app.getPath('userData');
    // Find ffmpeg — GUI apps don't inherit shell PATH, so resolve an absolute path.
    const ffmpegBin = resolveFfmpegBin();
    console.info('[Batch Local] Using ffmpeg:', ffmpegBin);

    // P0-1: Convert to WAV using async execFile (non-blocking)
    // Lenient flags handle chunked webm from MediaRecorder timeslice
    try {
      await execFileAsync(ffmpegBin, [
        '-hide_banner', '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-f', 'webm', '-i', webmPath,
        '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', wavPath
      ], { timeout: 30000 });
    } catch (ffmpegErr) {
      // If ffmpeg fails with file input, try stdin pipe as fallback
      console.warn('[Batch Local] FFmpeg file input failed, trying stdin pipe:', ffmpegErr.message?.slice(0, 100));
      await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn(ffmpegBin, [
          '-hide_banner', '-y',
          '-fflags', '+genpts+discardcorrupt',
          '-f', 'webm', '-i', 'pipe:0',
          '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', wavPath
        ]);
        let err = '';
        proc.stderr.on('data', (d) => { err += d.toString().slice(-300); });
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg stdin exit ${code}: ${err.slice(-150)}`)));
        proc.on('error', reject);
        // Kill after 25s if still running
        const killTimer = setTimeout(() => { try { proc.kill(); } catch(_){} reject(new Error('ffmpeg stdin timeout')); }, 25000);
        proc.on('close', () => clearTimeout(killTimer));
        proc.stdin.write(buffer);
        proc.stdin.end();
      });
    }
    console.info('[Batch Local] FFmpeg conversion done, wav:', wavPath);

    // ─── PRIMARY: WS-routed transcription (fast path) ───
    // Model is already loaded in the Python server — no cold start
    const transcribeStartTime = Date.now();
    try {
      const wsResult = await _transcribeViaWS(wavPath);
      const transcribeElapsed = ((Date.now() - transcribeStartTime) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);
      console.info(`[Batch Local] ⏱ WS transcription: ${transcribeElapsed}s (total pipeline: ${totalElapsed}s)`);
      console.info(`[Batch Local] 📊 Ratio: ${wsResult.ratio}x (${wsResult.elapsed_s}s transcribe / ${wsResult.audio_duration_s}s audio, model: ${wsResult.model})`);

      // Record timing for WindyTune adaptive logic
      _windyTuneRecord(wsResult.elapsed_s, wsResult.audio_duration_s, wsResult.model);

      return wsResult.text || '';
    } catch (wsErr) {
      console.warn(`[Batch Local] WS path failed (${wsErr.message}), falling back to standalone Python`);
    }

    // ─── FALLBACK: Standalone Python process (cold load) ───
    const appRoot = path.resolve(__dirname, '..', '..', '..');
    const venvPaths = process.platform === 'win32'
      ? [
        path.join(os.homedir(), '.windy-pro', 'venv', 'Scripts', 'python.exe'),
        path.join(appDataDir, 'venv', 'Scripts', 'python.exe'),
        path.join(appRoot, 'venv', 'Scripts', 'python.exe'),
        'python'
      ]
      : [
        path.join(os.homedir(), '.windy-pro', 'venv', 'bin', 'python3'),
        path.join(appRoot, 'venv', 'bin', 'python3'),
        path.join(appDataDir, 'venv', 'bin', 'python3'),
        '/usr/bin/python3'
      ];
    const pythonPathLocal = venvPaths.find(p => fs.existsSync(p)) || (process.platform === 'win32' ? 'python' : 'python3');
    console.info('[Batch Local] Using python (fallback):', pythonPathLocal);

    let modelName = store.get('engine.model') || 'base';
    // Resolve a model name to its on-disk dir. Lean Windy engines use canonical
    // ids (windy-*-ct2 → bundled/model/<id>/); legacy whisper names use the
    // faster-whisper-<name>/ scheme. Both the bundled (offline) and any
    // user-downloaded (~/.windy-pro/model) locations are checked.
    const dirFor = (m) => (/-ct2$/.test(m) ? m : `faster-whisper-${m}`);
    const userModelRoot = path.join(os.homedir(), '.windy-pro', 'model');
    const bundledModelRoot = process.resourcesPath ? path.join(process.resourcesPath, 'bundled', 'model') : '';
    const findModelDir = (m) => {
      const u = path.join(userModelRoot, dirFor(m));
      if (fs.existsSync(path.join(u, 'model.bin'))) return u;
      if (bundledModelRoot) {
        const b = path.join(bundledModelRoot, dirFor(m));
        if (fs.existsSync(path.join(b, 'model.bin'))) return b;
      }
      return null;
    };
    let resolvedDir = findModelDir(modelName);
    if (!resolvedDir && modelName !== 'base') {
      // Tank-proof: never hand a bare model name to faster-whisper for an unbundled
      // model — it would trigger a multi-GB HuggingFace download mid-transcribe and
      // hang. Fall back to the always-bundled `base` engine instead.
      console.warn(`[Batch Local] model "${modelName}" not present locally/bundled — falling back to bundled base`);
      resolvedDir = findModelDir('base');
      modelName = 'base';
    }
    const modelRef = resolvedDir ? resolvedDir.replace(/\\/g, '/') : modelName;
    console.info('[Batch Local] Model ref:', modelRef, '(configured model:', modelName, ')');
    const scriptPath = path.join(tmpDir, `windy-batch-transcribe-${tmpId}.py`);
    const scriptContent = [
      'import time',
      'from faster_whisper import WhisperModel',
      't0 = time.monotonic()',
      `model = WhisperModel(${JSON.stringify(modelRef)}, device="cpu", compute_type="int8")`,
      `segments, info = model.transcribe(${JSON.stringify(wavPath.replace(/\\/g, '/'))}, language=None, beam_size=5, condition_on_previous_text=True, vad_filter=False, no_speech_threshold=0.3)`,
      'text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())',
      'elapsed = round(time.monotonic() - t0, 2)',
      'print(text)',
      'import sys; print(f"__TIMING__:{elapsed}", file=sys.stderr)'
    ].join('\n');
    await fsp.writeFile(scriptPath, scriptContent);
    console.info('[Batch Local] Running Python transcription script (fallback)...');

    const { stdout, stderr } = await execFileAsync(pythonPathLocal, [scriptPath], {
      timeout: dynTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      // Force faster-whisper fully offline (matches the primary server spawn + translate_local.py).
      // Without these, an unresolved model dir here could trigger a HuggingFace fetch — a hang
      // and a phone-home that breaks the "fully offline / your voice stays local" guarantee.
      env: { ...process.env, KMP_DUPLICATE_LIB_OK: 'TRUE', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
    });

    // Extract timing from stderr
    const totalElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    let pyElapsed = 0;
    if (stderr) {
      const timingMatch = stderr.match(/__TIMING__:([\d.]+)/);
      if (timingMatch) pyElapsed = parseFloat(timingMatch[1]);
      const cleanStderr = stderr.replace(/__TIMING__:[\d.]+\n?/, '').trim();
      if (cleanStderr) console.warn('[Batch Local] Python stderr:', cleanStderr.substring(0, 500));
    }
    console.info(`[Batch Local] ⏱ Standalone transcription: ${pyElapsed}s (total pipeline: ${totalElapsed}s)`);

    try { await fsp.unlink(scriptPath); } catch (_) { }

    return stdout.trim();
  } catch (err) {
    console.error('[Batch Local] Error:', err.message);
    throw new Error(`Local transcription failed: ${err.message}`);
  } finally {
    // Cleanup temp files
    try { await fsp.unlink(webmPath); } catch (_) { }
    try { await fsp.unlink(wavPath); } catch (_) { }
  }
  })(), dynTimeoutMs, 'batch-transcribe-local');
});

ipcMain.handle('auto-paste-text', async (event, text) => {
  if (!text || !text.trim()) return false;

  try {
    const trimmed = text.trim();
    const pasteConfig = store.get('paste') || { strategy: 'auto', fallbackChain: [] };
    console.info(`[AutoPaste] Text length: ${trimmed.length} chars, config.strategy=${pasteConfig.strategy}`);

    // Tank rule: the transcript must NEVER be lost. Put it on the clipboard
    // FIRST — before any focus/permission step that might bail (e.g. missing
    // Accessibility) — so the user can always recover it with a manual Cmd+V
    // even when auto-injection can't run.
    try { clipboard.writeText(trimmed); } catch (_) { /* clipboard best-effort */ }

    // ── macOS PID activation (load-bearing focus prep) ──
    // Move focus to the tracked target app BEFORE paste fires. Without this,
    // macOS may have shifted focus to an Electron helper during transcription.
    if (process.platform === 'darwin' && global._lastFocusedPid) {
      console.info(`[AutoPaste] Activating tracked target: "${global._lastFocusedApp || 'unknown'}" (pid ${global._lastFocusedPid})`);
      try {
        execFileSync('osascript', ['-e',
          `tell application "System Events" to set frontmost of (first application process whose unix id is ${global._lastFocusedPid}) to true`
        ], { timeout: 2000 });
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn(`[AutoPaste] Activation failed: ${e.message} — trying blind paste`);
      }

      // ── Accessibility permission check (macOS only) ──
      const { systemPreferences } = require('electron');
      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        console.warn('[AutoPaste] Accessibility permission not granted — requesting...');
        systemPreferences.isTrustedAccessibilityClient(true);
        return false;
      }
    }

    // ── Run strategy chain via registry ──
    // 'auto' uses defaultFallbackChain() for the current platform, passing
    // the user's hotkey config so colliding strategies (e.g. Ctrl+Shift+V
    // keystroke when user's own pasteTranscript hotkey is the same) get
    // demoted to last-resort instead of silently failing.
    // Specific strategy name runs that one, falls through to config.fallbackChain on failure.
    let chain;
    if (pasteConfig.strategy === 'auto') {
      chain = (pasteConfig.fallbackChain && pasteConfig.fallbackChain.length > 0)
        ? pasteConfig.fallbackChain
        : pasteStrategies.defaultFallbackChain(store.get('hotkeys'));
    } else {
      chain = [pasteConfig.strategy, ...(pasteConfig.fallbackChain || [])];
    }
    console.info(`[AutoPaste] Strategy chain: ${chain.join(' → ')}`);

    const result = await pasteStrategies.autoExecute(trimmed, chain);

    if (result.ok) {
      console.info(`[AutoPaste] ✓ "${result.strategy}" succeeded (${trimmed.length} chars)`);
    } else {
      console.warn('[AutoPaste] All strategies failed:');
      for (const t of result.tried) {
        console.warn(`  - ${t.strategy}: ${t.ok ? 'OK' : t.error || 'failed'}`);
      }
    }
    return result.ok;

    // ── Legacy paths below (preserved for reference; never reached) ──
    if (false && process.platform === 'darwin') {
      // ── macOS auto-paste: TRACKER-BASED PID activation ──
      // The focus tracker continuously updates _lastFocusedPid during recording
      // and LOCKS it during batch processing (transcription). So at paste time,
      // _lastFocusedPid = the last app the user interacted with before the
      // transcription started. This is the most reliable target.
      //
      // We MUST actively activate this app by PID before sending Cmd+V, because
      // macOS may have shifted focus to an Electron helper process during batch
      // processing, even with focusable:false on our window.

      const targetPid = global._lastFocusedPid;
      const targetApp = global._lastFocusedApp || 'unknown';

      // ── Pre-flight: check Accessibility permission (required for keystrokes) ──
      const { systemPreferences } = require('electron');
      const hasAccess = systemPreferences.isTrustedAccessibilityClient(false);
      if (!hasAccess) {
        console.warn('[AutoPaste] Accessibility permission not granted — requesting...');
        systemPreferences.isTrustedAccessibilityClient(true);
        console.warn('[AutoPaste] Text on clipboard — use Cmd+V manually.');
        return false;
      }

      if (!targetPid) {
        // No tracked target — just send Cmd+V to whatever is focused
        console.warn('[AutoPaste] No tracked PID — sending Cmd+V to current focus');
        await new Promise(r => setTimeout(r, 100));
        try {
          execFileSync('/usr/local/bin/cliclick', ['kd:cmd', 't:v', 'ku:cmd'], { timeout: 2000 });
          console.info(`[AutoPaste] ✓ Pasted ${text.trim().length} chars via cliclick (blind)`);
          return true;
        } catch (_) {
          return false;
        }
      }

      // Step 1: Activate the TRACKED target app by PID
      console.info(`[AutoPaste] Activating tracked target: "${targetApp}" (pid ${targetPid})`);
      try {
        execFileSync('osascript', ['-e',
          `tell application "System Events" to set frontmost of (first application process whose unix id is ${targetPid}) to true`
        ], { timeout: 2000 });
      } catch (focusErr) {
        console.warn(`[AutoPaste] Activation failed: ${focusErr.message} — trying blind paste`);
      }

      // Step 2: Wait for focus to settle
      await new Promise(r => setTimeout(r, 200));

      // Step 3: Send Cmd+V
      let pasteOk = false;
      try {
        execFileSync('/usr/local/bin/cliclick', ['kd:cmd', 't:v', 'ku:cmd'], { timeout: 2000 });
        console.info(`[AutoPaste] ✓ Pasted ${text.trim().length} chars to "${targetApp}" (pid ${targetPid}) via cliclick`);
        pasteOk = true;
      } catch (cliErr) {
        console.warn(`[AutoPaste] cliclick failed: ${cliErr.message}`);
        try {
          execFileSync('osascript', ['-e',
            `tell application "System Events" to key code 9 using command down`
          ], { timeout: 3000 });
          console.info(`[AutoPaste] ✓ Pasted ${text.trim().length} chars to "${targetApp}" (pid ${targetPid}) via osascript`);
          pasteOk = true;
        } catch (osErr) {
          console.warn('[AutoPaste] Both methods failed — text on clipboard, use Cmd+V');
        }
      }
      return pasteOk;

    } else if (process.platform === 'linux') {
      // ── Linux auto-paste ──
      // Wayland: type the text directly via ydotool (bypass clipboard). The
      // Wayland clipboard is fragile under Mutter + 3rd-party clipboard
      // managers (GPaste, copyq) and frequently wedges; even when it works,
      // Wayland-native apps don't read X11 clipboard, so Ctrl+Shift+V on a
      // broken Wayland clipboard pastes nothing. Direct typing goes
      // /dev/uinput → kernel → Mutter → focused app, completely independent
      // of clipboard state. Slower for long text (~5ms/char) but rock-solid.
      // Falls back to Ctrl+Shift+V if typing fails (daemon dead, etc.).
      // X11: xdotool with opacity-hide for focus management.
      if (PLATFORM.isWayland) {
        const ydoSocket = _ydotoolSocket || `/tmp/ydotool-${process.getuid?.() ?? 1000}.socket`;
        const ydoEnv = { ...process.env, YDOTOOL_SOCKET: ydoSocket };

        // STRATEGY: detect target type and pick the fastest working path.
        //   XWayland target (xdotool sees a window name): clipboard + Ctrl+Shift+V — INSTANT
        //   Wayland-native target (xdotool sees nothing): ydotool type at max speed
        // Why this split: X11 clipboard works reliably (Electron's writeText set it
        // already), and XWayland apps read X11 clipboard. So Ctrl+Shift+V on those
        // is instant. Wayland-native apps read the Wayland clipboard, which is
        // fragile/broken on some Mutter versions — for those we type the text
        // directly (~1ms/char with -d 0 -H 0).
        let targetIsXWayland = false;
        try {
          const winName = execFileSync('xdotool', ['getactivewindow', 'getwindowname'],
            { timeout: 500, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          targetIsXWayland = winName.length > 0;
          console.info(`[AutoPaste] Target window: "${winName}" → ${targetIsXWayland ? 'XWayland' : 'Wayland-native'}`);
        } catch (_) {
          console.info('[AutoPaste] xdotool unavailable, assuming Wayland-native target');
        }

        if (targetIsXWayland) {
          // PATH A: clipboard already set by Electron writeText. Fire Ctrl+Shift+V — instant.
          const pasteSuccess = await new Promise((resolve) => {
            execFile('ydotool', ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
              { env: ydoEnv, timeout: 3000 }, (err) => {
                if (!err) return resolve(true);
                console.warn('[AutoPaste] ydotool key failed, trying xdotool:', err.message);
                exec('xdotool key --clearmodifiers ctrl+shift+v', { timeout: 3000 }, (err2) => {
                  if (!err2) return resolve(true);
                  exec('xdotool key --clearmodifiers ctrl+v', { timeout: 3000 }, (err3) => resolve(!err3));
                });
              });
          });
          if (pasteSuccess) {
            console.info(`[AutoPaste] ✓ Pasted ${trimmed.length} chars via Ctrl+Shift+V (XWayland)`);
            return true;
          }
          // Fall through to typing if keystroke fails
        }

        // PATH B: type the text directly via ydotool at maximum speed.
        // -d 0: zero delay between keys. -H 0: zero hold time per key.
        // Approximately 1-5ms per char on typical hardware (limited by /dev/uinput).
        const typeTimeout = Math.min(300000, Math.max(30000, trimmed.length * 30));
        const typeOk = await new Promise((resolve) => {
          execFile('ydotool', ['type', '-d', '0', '-H', '0', '--', trimmed],
            { env: ydoEnv, timeout: typeTimeout }, (err, stdout, stderr) => {
              if (err) {
                console.warn('[AutoPaste] ydotool type failed:', err.message, stderr || '');
                resolve(false);
              } else {
                console.info(`[AutoPaste] ✓ Typed ${trimmed.length} chars via ydotool (max-speed)`);
                resolve(true);
              }
            });
        });
        if (typeOk) return true;

        // Last-resort fallback: clipboard + keystroke combo
        console.warn('[AutoPaste] Typing failed, last-resort clipboard+keystroke');
        const pasteSuccess = await new Promise((resolve) => {
          execFile('ydotool', ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
            { env: ydoEnv, timeout: 3000 }, (err) => {
              if (!err) return resolve(true);
              exec('xdotool key --clearmodifiers ctrl+shift+v', { timeout: 3000 }, (err2) => {
                if (!err2) return resolve(true);
                exec('xdotool key --clearmodifiers ctrl+v', { timeout: 3000 }, (err3) => resolve(!err3));
              });
            });
        });
        if (!pasteSuccess) {
          console.warn('[AutoPaste] Paste injection failed on Wayland — text remains on clipboard');
        }
        return pasteSuccess;
      } else {
        // X11
        const wasAlwaysOnTop = mainWindow && !mainWindow.isDestroyed() && mainWindow.isAlwaysOnTop();
        const savedOpacity = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getOpacity() : 1;
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(false);
          mainWindow.setOpacity(0);
        }
        await new Promise(r => setTimeout(r, 200));
        await new Promise((resolve) => execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], { timeout: 5000 }, resolve));
        await new Promise(r => setTimeout(r, 100));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setOpacity(savedOpacity || 1);
          if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(true, 'normal');
        }
        return true;
      }

    } else {
      // ── Windows auto-paste ──
      await new Promise((resolve) => exec(
        'powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"',
        { timeout: 5000 }, resolve
      ));
      return true;
    }
  } catch (err) {
    console.error('[AutoPaste] Failed:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'normal');
    }
    return false;
  }
});

// ═══ History: Read archive files from disk ═══
ipcMain.handle('get-archive-history', async () => {
  const fs = require('fs');
  const configuredDir = store.get('engine.archiveFolder');
  const defaultDir = path.join(os.homedir(), 'Documents', 'WindyProArchive');
  const entries = [];

  // Scan both configured and default directories (if different)
  const dirsToScan = [configuredDir || defaultDir];
  if (configuredDir && configuredDir !== defaultDir && fs.existsSync(defaultDir)) {
    dirsToScan.push(defaultDir); // Also check default for un-migrated files
  }
  const seenIds = new Set(); // Dedup across folders

  try {
    for (const archiveDir of dirsToScan) {
      if (!fs.existsSync(archiveDir)) continue;

      // Walk {archiveDir}/{YYYY-MM-DD}/{HHMMSS}.md
      const dateDirs = fs.readdirSync(archiveDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      for (const dateDir of dateDirs.sort().reverse()) {
        const dirPath = path.join(archiveDir, dateDir);
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) continue;

        // Gather all files in this day directory for media matching
        const allFiles = fs.readdirSync(dirPath);
        const mdFiles = allFiles.filter(f => /^\d{6}\.md$/.test(f)).sort().reverse();
        const audioFiles = allFiles.filter(f => f.endsWith('.webm') && !f.includes('-video'));
        const videoFiles = allFiles.filter(f => f.endsWith('.webm') && f.includes('-video'));
        const consumedAudio = new Set(); // Track matched audio files
        const consumedVideo = new Set(); // Track matched video files

        // Helper: parse HHMMSS from filename to seconds-since-midnight
        const parseTimeKey = (fname) => {
          const base = fname.replace('.md', '').replace('.webm', '').replace('-video', '');
          if (!/^\d{6}$/.test(base)) return -1;
          return parseInt(base.substring(0, 2)) * 3600 +
            parseInt(base.substring(2, 4)) * 60 +
            parseInt(base.substring(4, 6));
        };

        for (const file of mdFiles) {
          const entryId = `archive-${dateDir}-${file}`;
          if (seenIds.has(entryId)) continue; // Skip duplicates from another scanned folder
          seenIds.add(entryId);

          const filePath = path.join(dirPath, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            let text = '';
            let wordCount = 0;
            let engine = 'local';
            let dateStr = '';

            // Extract metadata from frontmatter-like lines
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.startsWith('# ')) continue;
              // Handle both **Bold:** and bare Key: metadata formats
              const isMetaLine = (line.startsWith('**') && line.includes(':')) ||
                /^(Start|End|Words|Engine|Time|Date|Duration|App):\s/.test(line);
              if (isMetaLine) {
                if (line.includes('Words:')) {
                  const m = line.match(/Words:\s*(\d+)/);
                  if (m) wordCount = parseInt(m[1]);
                }
                if (line.includes('Start:') || line.includes('Time:')) {
                  const m = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
                  if (m) dateStr = m[1];
                }
                if (line.includes('Engine:')) {
                  const m = line.match(/Engine:\s*(\w+)/);
                  if (m) engine = m[1].toLowerCase();
                }
                continue;
              }
              if (line === '---' || line.trim() === '') continue;
              text = lines.slice(i).join('\n').trim();
              break;
            }

            // Fallback date from dir/file name
            if (!dateStr) {
              const timePart = file.replace('.md', '');
              dateStr = `${dateDir}T${timePart.substring(0, 2)}:${timePart.substring(2, 4)}:${timePart.substring(4, 6)}`;
            }

            if (!wordCount && text) {
              wordCount = text.split(/\s+/).filter(Boolean).length;
            }

            // Match media files by timestamp — nearest within ±120s
            const mdTime = parseTimeKey(file);
            let hasAudio = false, hasVideo = false, audioPath = '', videoPath = '';

            // Find closest audio file within window
            let bestAudioDist = Infinity, bestAudioIdx = -1;
            for (let ai = 0; ai < audioFiles.length; ai++) {
              if (consumedAudio.has(ai)) continue;
              const afTime = parseTimeKey(audioFiles[ai]);
              const dist = Math.abs(afTime - mdTime);
              if (afTime >= 0 && dist <= 120 && dist < bestAudioDist) {
                bestAudioDist = dist;
                bestAudioIdx = ai;
              }
            }
            if (bestAudioIdx !== -1) {
              hasAudio = true;
              audioPath = path.join(dirPath, audioFiles[bestAudioIdx]);
              consumedAudio.add(bestAudioIdx);
            }

            // Find closest video file within window
            let bestVideoDist = Infinity, bestVideoIdx = -1;
            for (let vi = 0; vi < videoFiles.length; vi++) {
              if (consumedVideo.has(vi)) continue;
              const vfTime = parseTimeKey(videoFiles[vi].replace('-video', ''));
              const dist = Math.abs(vfTime - mdTime);
              if (vfTime >= 0 && dist <= 120 && dist < bestVideoDist) {
                bestVideoDist = dist;
                bestVideoIdx = vi;
              }
            }
            if (bestVideoIdx !== -1) {
              hasVideo = true;
              videoPath = path.join(dirPath, videoFiles[bestVideoIdx]);
              consumedVideo.add(bestVideoIdx);
            }

            entries.push({
              date: dateStr,
              text,
              wordCount,
              engine,
              hasAudio,
              hasVideo,
              audioPath,
              videoPath,
              _source: 'archive',
              _archivePath: filePath,
              _id: entryId
            });
          } catch (e) {
            console.warn('[History] Failed to parse:', filePath, e.message);
          }
        }
      }
    } // end dirsToScan loop
  } catch (e) {
    console.error('[History] Archive scan error:', e.message);
  }

  return entries;
});

// ═══ History: Delete archive entry ═══
ipcMain.handle('delete-archive-entry', async (event, filePath) => {
  const fs = require('fs');
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid archive path');
  }

  // Security: path traversal guard — only allow deletion within archive folder
  const archiveBase = getArchiveFolder();
  const defaultBase = path.join(os.homedir(), 'Documents', 'WindyProArchive');
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(archiveBase);
  const resolvedDefault = path.resolve(defaultBase);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase &&
      !resolvedPath.startsWith(resolvedDefault + path.sep) && resolvedPath !== resolvedDefault) {
    console.warn('[Main] Blocked path traversal attempt:', filePath);
    throw new Error('Access denied: path outside archive folder');
  }

  try {
    fs.unlinkSync(resolvedPath);
    // Remove empty parent dir (only if still within archive base)
    const dir = path.dirname(resolvedPath);
    if (dir.startsWith(resolvedBase) && dir !== resolvedBase) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) fs.rmdirSync(dir);
    }
    return { deleted: true };
  } catch (e) {
    throw new Error(`Delete failed: ${e.message}`);
  }
});

// ── Account-server proxy base ─────────────────────────────────────
// Public Windy account-server. Routes mounted at /api/v1/* upstream.
// Overridable for staging/local dev via WINDY_ACCOUNT_API_URL env var
// (matches the existing WINDY_CLONE_API_URL pattern).
const ACCOUNT_API_DEFAULT_URL = 'https://windyword.ai/api/v1';

// ── Windy Word Cloud Storage helpers ──────────────────────────────
const CLOUD_STORAGE_DEFAULT_URL = 'https://windyword.ai/api/storage';

async function getCloudStorageToken() {
  const engine = store.get('engine', {});
  if (engine.cloudStorageToken) return engine.cloudStorageToken;

  // Auto-register/login with storage API using existing cloud credentials
  const email = engine.cloudEmail;
  // SEC-C1: Decrypt cloud password from safeStorage
  let password = null;
  try {
    const encB64 = store.get('engine.cloudPasswordEncrypted', '');
    if (encB64 && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(encB64, 'base64'));
    }
  } catch (_) { }
  if (!password) password = engine.cloudPassword || null; // Legacy plaintext fallback
  if (!email || !password) return null;

  const baseUrl = engine.cloudStorageUrl || CLOUD_STORAGE_DEFAULT_URL;
  const http = baseUrl.startsWith('https') ? require('https') : require('http');

  // Try login first, then register
  for (const endpoint of ['/auth/login', '/auth/register']) {
    try {
      const body = JSON.stringify({ email, password, deviceId: `windy-pro-${os.hostname()}` });
      const token = await new Promise((resolve, reject) => {
        const url = new URL(endpoint, baseUrl);
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.ok && parsed.token) resolve(parsed.token);
              else reject(new Error(parsed.error || 'Auth failed'));
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      store.set('engine.cloudStorageToken', token);
      store.set('auth.storageToken', token); // also save for sync manager
      console.info(`[CloudStorage] Authenticated via ${endpoint}`);
      return token;
    } catch (e) {
      if (endpoint === '/auth/register') console.error('[CloudStorage] Auth failed:', e.message);
    }
  }
  return null;
}

ipcMain.on('archive-transcript', async (event, payload) => {
  try {
    const route = payload?.route || store.get('engine.archiveRouteToday') || 'local';
    const cloud = { attempted: false, ok: false, error: null };

    // Local archive (for 'local', 'local_cloud', and as fallback)
    let res = { archived: false, files: [] };
    if (route !== 'cloud') {
      res = appendArchiveEntry(payload || {});
      if (!res.archived && route === 'local') {
        event.reply('archive-result', { ok: false, reason: 'skipped' });
        return;
      }
    }

    // WindyCloud upload
    if (route === 'cloud' || route === 'local_cloud') {
      cloud.attempted = true;
      const engine = store.get('engine', {});
      const cloudToken = await getCloudStorageToken();
      const cloudUrl = engine.cloudStorageUrl || CLOUD_STORAGE_DEFAULT_URL;

      if (!cloudToken) {
        cloud.error = 'Not logged in to WindyCloud (set email/password in Settings)';
      } else {
        try {
          const filesToUpload = res.files && res.files.length > 0 ? res.files : [];

          // If cloud-only and no local archive was done, create temp files from payload
          if (route === 'cloud' && filesToUpload.length === 0) {
            res = appendArchiveEntry(payload || {});
          }

          for (const f of res.files || []) {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fs.createReadStream(f));
            form.append('type', f.endsWith('.webm') || f.endsWith('.wav') ? 'audio' : 'transcript');
            form.append('sessionDate', new Date().toISOString().slice(0, 10));

            const http = cloudUrl.startsWith('https') ? require('https') : require('http');
            await new Promise((resolve, reject) => {
              const url = new URL('/files/upload', cloudUrl);
              const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: {
                  ...form.getHeaders(),
                  'Authorization': `Bearer ${cloudToken}`
                }
              }, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => {
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) resolve(parsed);
                    else reject(new Error(parsed.error || 'Upload failed'));
                  } catch (e) { reject(new Error(`HTTP ${resp.statusCode}: ${data.slice(0, 200)}`)); }
                });
              });
              req.on('error', reject);
              form.pipe(req);
            });
          }
          cloud.ok = true;
        } catch (e) {
          cloud.error = e.message;
          console.error('[Archive] Cloud upload failed:', e.message);
        }
      }
    }

    console.info('[Archive] Saved:', (res.files || []).join(', '), route, cloud.ok ? '+ cloud ✓' : '');
    event.reply('archive-result', { ok: true, ...res, route, cloud });
  } catch (err) {
    console.error('[Archive] Failed:', err.message);
    event.reply('archive-result', { ok: false, error: err.message });
  }
});

// Save audio recording to archive folder
ipcMain.handle('archive-audio', async (event, base64, timestamp) => {
  try {
    const archiveRoot = getArchiveFolder();
    // Use the recording's actual start timestamp if provided, otherwise fall back to now
    const now = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(now.getTime())) throw new Error('Invalid timestamp');
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeKey = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const dayDir = path.join(archiveRoot, dateKey);
    ensureDir(dayDir);
    const audioPath = path.join(dayDir, `${timeKey}.webm`);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(audioPath, buffer);
    console.info(`[Archive] Audio saved: ${audioPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return { ok: true, path: audioPath };
  } catch (err) {
    console.error('[Archive] Audio save failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// Save video recording to archive folder
ipcMain.handle('archive-video', async (event, base64, timestamp) => {
  try {
    const archiveRoot = getArchiveFolder();
    const now = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(now.getTime())) throw new Error('Invalid timestamp');
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeKey = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const dayDir = path.join(archiveRoot, dateKey);
    ensureDir(dayDir);
    const videoPath = path.join(dayDir, `${timeKey}-video.webm`);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(videoPath, buffer);
    console.info(`[Archive] Video saved: ${videoPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return { ok: true, path: videoPath };
  } catch (err) {
    console.error('[Archive] Video save failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// Read audio file from archive for playback
ipcMain.handle('read-archive-audio', async (event, filePath) => {
  try {
    const archiveRoot = getArchiveFolder();
    const defaultRoot = path.join(os.homedir(), 'Documents', 'WindyProArchive');
    // Security: path must be inside an archive folder (configured or default)
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(archiveRoot)) && !resolved.startsWith(path.resolve(defaultRoot))) {
      throw new Error('Path is outside archive folder');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('File not found');
    }
    const buffer = fs.readFileSync(resolved);
    return { ok: true, base64: buffer.toString('base64'), mimeType: 'audio/webm' };
  } catch (err) {
    console.error('[Archive] Audio read failed:', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('read-archive-video', async (event, filePath) => {
  try {
    const archiveRoot = getArchiveFolder();
    const defaultRoot = path.join(os.homedir(), 'Documents', 'WindyProArchive');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(archiveRoot)) && !resolved.startsWith(path.resolve(defaultRoot))) {
      throw new Error('Path is outside archive folder');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('File not found');
    }
    const buffer = fs.readFileSync(resolved);
    return { ok: true, base64: buffer.toString('base64'), mimeType: 'video/webm' };
  } catch (err) {
    console.error('[Archive] Video read failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// P0-2: Archive stats cache (30s TTL)
let _archiveStatsCache = null;
let _archiveStatsCacheTime = 0;
const ARCHIVE_STATS_CACHE_TTL = 30000;

ipcMain.handle('get-archive-stats', async () => {
  if (_archiveStatsCache && Date.now() - _archiveStatsCacheTime < ARCHIVE_STATS_CACHE_TTL) {
    return _archiveStatsCache;
  }
  try {
    const archiveRoot = getArchiveFolder();
    try { await fsp.access(archiveRoot); } catch { return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0, wpm: 0, streak: 0 }; }

    let totalFiles = 0, totalSize = 0, days = new Set();
    let audioBytes = 0, videoBytes = 0, totalWords = 0, totalSessions = 0, totalChars = 0, speakingMs = 0;

    const items = await fsp.readdir(archiveRoot);
    for (const item of items) {
      const itemPath = path.join(archiveRoot, item);
      const stat = await fsp.stat(itemPath);
      if (!stat.isDirectory()) continue;

      days.add(item);
      const files = await fsp.readdir(itemPath);
      for (const file of files) {
        totalFiles++;
        try {
          const fStat = await fsp.stat(path.join(itemPath, file));
          totalSize += fStat.size;
          if (file.endsWith('.webm') && file.includes('-video')) {
            videoBytes += fStat.size;
          } else if (file.endsWith('.webm') || file.endsWith('.wav')) {
            audioBytes += fStat.size;
          } else if (file.endsWith('.md') && file !== `${item}.md`) {
            totalSessions++;
            try {
              const content = await fsp.readFile(path.join(itemPath, file), 'utf-8');
              // Word count: prefer the authoritative "Words:" metadata (the real text count
              // written at archive time); fall back to counting the body for legacy entries.
              // (The old approach counted the Start/End/Words meta lines as text — inflated.)
              const wm = content.match(/^Words:\s*(\d+)/m);
              const body = content.includes('---') ? content.split('---').slice(1).join('---').trim() : content;
              totalWords += wm ? parseInt(wm[1], 10) : body.split(/\s+/).filter(Boolean).length;
              totalChars += body.length;
              // Speaking duration (for wpm) from Start/End metadata.
              const sm = content.match(/^Start:\s*(.+)$/m), em = content.match(/^End:\s*(.+)$/m);
              if (sm && em) { const dur = new Date(em[1]) - new Date(sm[1]); if (dur > 0 && dur < 3600000) speakingMs += dur; }
            } catch (_) { }
          }
        } catch (_) { }
      }
    }
    const audioHours = (audioBytes / 1024 / 16) / 3600;
    const videoHours = (videoBytes / 1024 / 100) / 3600;
    // wpm = total words / total speaking minutes (Wispr-style average dictation rate).
    const wpm = speakingMs > 0 ? Math.round(totalWords / (speakingMs / 60000)) : 0;
    // Current day-streak: consecutive days with >=1 dictation, counting back from today.
    // Today is optional (grace) — the streak only breaks once a full day is missed.
    const pad = (n) => String(n).padStart(2, '0');
    const keyOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    let streak = 0; const cursor = new Date();
    if (!days.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(keyOf(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    const result = {
      totalFiles, totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10,
      days: days.size,
      audioHours: Math.round(audioHours * 100) / 100,
      videoHours: Math.round(videoHours * 100) / 100,
      totalWords, totalSessions, totalChars, wpm, streak
    };
    _archiveStatsCache = result;
    _archiveStatsCacheTime = Date.now();
    return result;
  } catch (err) {
    return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0, error: err.message };
  }
});

// ═══ Agent-facing archive helpers ═══════════════════════════════════════
// Wraps the same get-archive-history + delete-archive-entry +
// read-archive-audio + read-archive-video on-disk format, but exposes
// opaque ids instead of filesystem paths (so agents can't smuggle paths
// into other endpoints). Used by HTTP endpoints in startWaylandControlServer.
//
// Entry id format: "arc:{YYYY-MM-DD}:{HHMMSS}.md"
// Resolves to {archiveRoot}/{YYYY-MM-DD}/{HHMMSS}.md

function _agentArchiveScan() {
  const configuredDir = store.get('engine.archiveFolder');
  const defaultDir = path.join(os.homedir(), 'Documents', 'WindyProArchive');
  const dirsToScan = [configuredDir || defaultDir];
  if (configuredDir && configuredDir !== defaultDir && fs.existsSync(defaultDir)) {
    dirsToScan.push(defaultDir);
  }
  const entries = [];
  const seenIds = new Set();

  for (const archiveDir of dirsToScan) {
    if (!fs.existsSync(archiveDir)) continue;
    let dateDirs;
    try { dateDirs = fs.readdirSync(archiveDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)); } catch { continue; }
    for (const dateDir of dateDirs.sort().reverse()) {
      const dirPath = path.join(archiveDir, dateDir);
      let allFiles;
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue;
        allFiles = fs.readdirSync(dirPath);
      } catch { continue; }
      const mdFiles = allFiles.filter(f => f.endsWith('.md') && f !== `${dateDir}.md`).sort().reverse();
      const audioFiles = allFiles.filter(f => f.endsWith('.webm') && !f.includes('-video'));
      const videoFiles = allFiles.filter(f => f.endsWith('.webm') && f.includes('-video'));

      for (const file of mdFiles) {
        const id = `arc:${dateDir}:${file}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const filePath = path.join(dirPath, file);
        let text = '', wordCount = 0, engine = 'local', dateStr = '';
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('# ')) continue;
            const isMeta = (line.startsWith('**') && line.includes(':')) || /^(Start|End|Words|Engine|Time|Date|Duration):\s/.test(line);
            if (isMeta) {
              const wm = line.match(/Words:\s*(\d+)/); if (wm) wordCount = parseInt(wm[1]);
              const dm = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/); if (dm && !dateStr) dateStr = dm[1];
              const em = line.match(/Engine:\s*(\w+)/); if (em) engine = em[1].toLowerCase();
              continue;
            }
            if (line === '---' || line.trim() === '') continue;
            text = lines.slice(i).join('\n').trim();
            break;
          }
        } catch (_) { continue; }
        if (!dateStr) {
          const base = file.replace('.md', '');
          if (/^\d{6}$/.test(base)) dateStr = `${dateDir}T${base.substring(0,2)}:${base.substring(2,4)}:${base.substring(4,6)}`;
        }
        if (!wordCount && text) wordCount = text.split(/\s+/).filter(Boolean).length;
        const base = file.replace('.md', '');
        const hasAudio = audioFiles.some(f => f.startsWith(base) && !f.includes('-video'));
        const hasVideo = videoFiles.some(f => f.startsWith(base));
        entries.push({ id, date: dateStr, text, wordCount, engine, hasAudio, hasVideo });
      }
    }
  }
  return entries;
}

function _agentResolveArchiveId(id) {
  // Returns { mdPath, audioPath, videoPath, dateDir, base } or null.
  // Strict parse: id must be "arc:YYYY-MM-DD:HHMMSS.md"
  const m = id && typeof id === 'string' && id.match(/^arc:(\d{4}-\d{2}-\d{2}):(\d{6}\.md)$/);
  if (!m) return null;
  const [, dateDir, mdName] = m;
  const base = mdName.replace('.md', '');

  // Try each archive dir until we find the entry — same dual-scan logic as scan
  const configuredDir = store.get('engine.archiveFolder');
  const defaultDir = path.join(os.homedir(), 'Documents', 'WindyProArchive');
  const dirsToTry = [configuredDir || defaultDir];
  if (configuredDir && configuredDir !== defaultDir && fs.existsSync(defaultDir)) {
    dirsToTry.push(defaultDir);
  }
  for (const archiveDir of dirsToTry) {
    const dirPath = path.join(archiveDir, dateDir);
    const mdPath = path.join(dirPath, mdName);
    if (!fs.existsSync(mdPath)) continue;
    // Find best-matching media by timestamp prefix
    let audioPath = null, videoPath = null;
    try {
      const files = fs.readdirSync(dirPath);
      const audio = files.find(f => f.startsWith(base) && f.endsWith('.webm') && !f.includes('-video'));
      const video = files.find(f => f.startsWith(base) && f.endsWith('.webm') && f.includes('-video'));
      if (audio) audioPath = path.join(dirPath, audio);
      if (video) videoPath = path.join(dirPath, video);
    } catch (_) {}
    return { mdPath, audioPath, videoPath, dateDir, base, archiveDir };
  }
  return null;
}

ipcMain.handle('export-soul-file', async () => {
  try {
    const archiveRoot = getArchiveFolder();
    if (!fs.existsSync(archiveRoot)) return { ok: false, error: 'No archive data found. Record some sessions first.' };

    const { dialog } = require('electron');
    const archiver = require('archiver');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Soul File',
      defaultPath: path.join(os.homedir(), 'Documents', `windy-soul-${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Export cancelled' };

    const output = fs.createWriteStream(result.filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(output);

    // Collect stats while adding files
    let totalFiles = 0, audioFiles = 0, videoFiles = 0, transcriptFiles = 0;
    let totalWords = 0, totalChars = 0;
    const days = [];

    const items = fs.readdirSync(archiveRoot);
    for (const item of items) {
      const itemPath = path.join(archiveRoot, item);
      if (!fs.statSync(itemPath).isDirectory()) continue;
      days.push(item);
      const files = fs.readdirSync(itemPath);
      for (const file of files) {
        const filePath = path.join(itemPath, file);
        archive.file(filePath, { name: `${item}/${file}` });
        totalFiles++;
        if (file.endsWith('.webm') && file.includes('-video')) videoFiles++;
        else if (file.endsWith('.webm') || file.endsWith('.wav')) audioFiles++;
        else if (file.endsWith('.md')) {
          transcriptFiles++;
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
            const text = textLines.join(' ').trim();
            totalWords += text.split(/\s+/).filter(Boolean).length;
            totalChars += text.length;
          } catch (_) { }
        }
      }
    }

    // Add manifest
    const manifest = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      appVersion: app.getVersion() || '1.6.1',
      stats: { totalFiles, audioFiles, videoFiles, transcriptFiles, totalWords, totalChars, days: days.length, dateRange: days.length ? { first: days[0], last: days[days.length - 1] } : null }
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();

    await new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); });
    const sizeMB = Math.round(fs.statSync(result.filePath).size / (1024 * 1024) * 10) / 10;
    return { ok: true, path: result.filePath, sizeMB, stats: manifest.stats };
  } catch (err) {
    console.error('[SoulExport]', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export-voice-clone', async () => {
  try {
    const archiveRoot = getArchiveFolder();
    if (!fs.existsSync(archiveRoot)) return { ok: false, error: 'No archive data found. Record some sessions first.' };

    const { dialog } = require('electron');
    const archiver = require('archiver');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export for Voice Cloning',
      defaultPath: path.join(os.homedir(), 'Documents', `windy-voice-clone-${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Export cancelled' };

    const output = fs.createWriteStream(result.filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(output);

    // Build CSV manifest for voice cloning (filename, transcript, date, estimated_duration_sec)
    const csvRows = ['filename,transcript,date,estimated_duration_sec'];
    let audioCount = 0;

    const items = fs.readdirSync(archiveRoot).sort();
    for (const day of items) {
      const dayPath = path.join(archiveRoot, day);
      if (!fs.statSync(dayPath).isDirectory()) continue;

      const files = fs.readdirSync(dayPath);
      // Find audio files (not video) and their matching transcripts
      const audioFiles = files.filter(f => (f.endsWith('.webm') || f.endsWith('.wav')) && !f.includes('-video'));
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const audioFile of audioFiles) {
        const audioPath = path.join(dayPath, audioFile);
        const audioStat = fs.statSync(audioPath);
        const estDurationSec = Math.round(audioStat.size / 1024 / 16); // ~16KB/s for opus

        // Archive the audio file into audio/ subfolder
        const destName = `audio/${day}_${audioFile}`;
        archive.file(audioPath, { name: destName });
        audioCount++;

        // Find matching transcript (same session timestamp prefix)
        let transcript = '';
        const prefix = audioFile.replace(/\.(webm|wav)$/, '').replace(/-audio$/, '');
        const matchingMd = mdFiles.find(m => m.startsWith(prefix));
        if (matchingMd) {
          try {
            const content = fs.readFileSync(path.join(dayPath, matchingMd), 'utf-8');
            const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
            transcript = textLines.join(' ').trim().replace(/"/g, '""'); // CSV-escape
          } catch (_) { }
        }

        csvRows.push(`"${destName}","${transcript}","${day}",${estDurationSec}`);
      }
    }

    // No audio means a useless empty zip — audio older than 7 days is auto-deleted.
    // Tear down the already-opened write stream so we don't leave a partial file behind.
    if (audioCount === 0) {
      try { output.destroy(); } catch (_) { }
      try { fs.unlinkSync(result.filePath); } catch (_) { }
      return { ok: false, error: 'No audio recordings found (audio older than 7 days is auto-deleted; re-record to export voice data).' };
    }

    // Add metadata CSV
    archive.append(csvRows.join('\n'), { name: 'metadata.csv' });

    // Add README for voice cloning services
    archive.append([
      '# Windy Word — Voice Clone Export',
      '',
      `Exported: ${new Date().toISOString()}`,
      `Total audio files: ${audioCount}`,
      '',
      '## File Structure',
      '- `audio/` — Audio recordings (WebM/Opus or WAV)',
      '- `metadata.csv` — Filename, transcript, date, estimated duration',
      '',
      '## Compatible With',
      '- ElevenLabs (upload audio + paste transcript)',
      '- Coqui TTS (use metadata.csv as training manifest)',
      '- Resemble.AI (import audio clips)',
      '- Tortoise TTS (place audio in training folder)',
      '',
      '## Tips',
      '- For best results, use clips between 5-30 seconds',
      '- Clean audio without background noise works best',
      '- More data = better clone quality (aim for 30+ minutes)',
    ].join('\n'), { name: 'README.md' });

    await archive.finalize();
    await new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); });
    const sizeMB = Math.round(fs.statSync(result.filePath).size / (1024 * 1024) * 10) / 10;
    return { ok: true, path: result.filePath, sizeMB, audioCount };
  } catch (err) {
    console.error('[VoiceCloneExport]', err.message);
    return { ok: false, error: err.message };
  }
});

// ═══ Wizard IPC Handlers ═══

ipcMain.handle('get-wizard-state', async () => {
  return store.get('wizard') || { completed: false, currentStep: 0, completedSteps: [] };
});

ipcMain.handle('set-wizard-state', async (event, state) => {
  const current = store.get('wizard') || {};
  store.set('wizard', { ...current, ...state });
  return { ok: true };
});

ipcMain.handle('detect-hardware', async () => {
  const result = {
    totalRAM: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    freeRAM: Math.round(os.freemem() / (1024 * 1024 * 1024)),
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    cpuCores: os.cpus().length,
    platform: process.platform,
    arch: process.arch,
    gpu: null,
    diskFreeGB: null
  };

  // Detect GPU — NVIDIA on Linux/Windows, Apple Metal/MPS on macOS
  if (process.platform === 'darwin') {
    // macOS: Apple Silicon gets MPS acceleration, Intel gets CPU only
    if (process.arch === 'arm64') {
      result.gpu = { name: 'Apple Silicon (Metal/MPS)', vramMB: 0, type: 'mps' };
    }
  } else {
    try {
      // SEC-M10: Use execFileSync with array args
      const gpuInfo = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000 }).toString().trim();
      if (gpuInfo) {
        const [name, vramMB] = gpuInfo.split(', ');
        result.gpu = { name: name.trim(), vramMB: parseInt(vramMB) || 0, type: 'cuda' };
      }
    } catch (_) {
      // No NVIDIA GPU or nvidia-smi not available
    }
  }

  // Check disk space
  try {
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
      const drive = homeDir.charAt(0);
      // SEC-M10: Validate drive letter is a single alpha char before interpolation
      if (!/^[a-zA-Z]$/.test(drive)) throw new Error('Invalid drive letter');
      const out = execFileSync('wmic', ['logicaldisk', 'where', `DeviceID='${drive}:'`, 'get', 'FreeSpace', '/value'], { timeout: 3000 }).toString();
      const match = out.match(/FreeSpace=(\d+)/);
      if (match) result.diskFreeGB = Math.round(parseInt(match[1]) / (1024 * 1024 * 1024));
    } else if (process.platform === 'darwin') {
      // macOS: df -g shows in GB (BSD df, no -B flag)
      // SEC-M10: Use execFileSync with array args
      const dfOut = execFileSync('df', ['-g', homeDir], { timeout: 3000 }).toString();
      const out = dfOut.split('\n').slice(-2)[0]?.split(/\s+/)[3] || '';
      result.diskFreeGB = parseInt(out) || null;
    } else {
      // Linux: df -BG shows in GB (GNU df)
      // SEC-M10: Use execFileSync with array args
      const dfOut = execFileSync('df', ['-BG', homeDir], { timeout: 3000 }).toString();
      const out = dfOut.split('\n').slice(-2)[0]?.split(/\s+/)[3] || '';
      result.diskFreeGB = parseInt(out) || null;
    }
  } catch (_) { }

  // Engine recommendation
  if (result.gpu && result.gpu.vramMB >= 6000) {
    result.recommendedEngine = 'windy-pro-engine';
    result.recommendation = `Your ${result.gpu.name} (${Math.round(result.gpu.vramMB / 1024)}GB VRAM) can run the best model. We recommend Windy Word Engine for maximum accuracy.`;
  } else if (result.gpu && result.gpu.vramMB >= 2000) {
    result.recommendedEngine = 'windy-core';
    result.recommendation = `Your ${result.gpu.name} has ${Math.round(result.gpu.vramMB / 1024)}GB VRAM. We recommend Windy Core for a great balance of speed and quality.`;
  } else if (result.totalRAM >= 16) {
    result.recommendedEngine = 'windy-edge-cpu';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Windy Edge (CPU) — high accuracy on CPU, no GPU needed.`;
  } else if (result.totalRAM >= 8) {
    result.recommendedEngine = 'windy-core-cpu';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Windy Core (CPU) — great balance of speed and quality for your hardware.`;
  } else {
    result.recommendedEngine = 'windy-nano-cpu';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Windy Nano (CPU) — ultra-light, runs great on any hardware.`;
  }

  return result;
});

ipcMain.handle('register-wizard-account', async (event, { email, password, name }) => {
  try {
    const https = require('https');
    const data = JSON.stringify({ email, password, name });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'windyword.ai',
        port: 443,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              // Store credentials
              store.set('engine.cloudStorageToken', result.token || '');
              store.set('engine.cloudEmail', email);
              // SEC-C1: Encrypt cloud password via safeStorage
              if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(password);
                store.set('engine.cloudPasswordEncrypted', encrypted.toString('base64'));
              }
              store.delete('engine.cloudPassword'); // Remove any plaintext
              resolve({ ok: true, token: result.token, user: result.user });
            } else {
              resolve({ ok: false, error: result.detail || result.message || 'Registration failed' });
            }
          } catch (e) {
            resolve({ ok: false, error: 'Invalid server response' });
          }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Connection timed out' }); });
      req.write(data);
      req.end();
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('setup-autostart', async (event, enable) => {
  try {
    if (process.platform === 'linux') {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'windy-pro.desktop');
      if (enable) {
        if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
        const appPath = process.execPath;
        // PLAT-B: Use absolute icon path (relative theme name 'windy-pro' won't resolve in most setups)
        const iconCandidates = [
          path.join(path.dirname(appPath), 'resources', 'app', 'assets', 'icon.png'),
          path.join(path.dirname(appPath), 'resources', 'assets', 'icon.png'),
          path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
        ];
        const iconPath = iconCandidates.find(p => fs.existsSync(p)) || 'windy-pro';
        const content = `[Desktop Entry]\nType=Application\nName=Windy Word\nExec=${appPath}\nIcon=${iconPath}\nComment=Voice-to-text transcription\nX-GNOME-Autostart-enabled=true\nStartupNotify=false\n`;
        fs.writeFileSync(desktopFile, content);
        return { ok: true };
      } else {
        if (fs.existsSync(desktopFile)) fs.unlinkSync(desktopFile);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Autostart only supported on Linux' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══ Stripe Payment IPC Handlers ═══

ipcMain.handle('create-checkout-session', async (event, priceId, email) => {
  try {
    const stripe = getStripe();
    if (!stripe) throw new Error('Payment system not configured. Please check Stripe API key in settings.');
    // Find the price config
    const priceConfig = Object.values(STRIPE_PRICES).find(p => p.id === priceId);
    if (!priceConfig) throw new Error('Invalid price ID');

    const machineId = os.hostname() + '-' + os.userInfo().username;
    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: priceConfig.mode,
      success_url: process.env.STRIPE_SUCCESS_URL || 'https://windyword.ai/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.STRIPE_CANCEL_URL || 'https://windyword.ai/payment-cancel',
      allow_promotion_codes: true,
      metadata: { deviceId: machineId, tier: priceConfig.tier }
    };
    if (email) sessionParams.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    console.info(`[Stripe] Checkout session created: ${session.id} for tier=${priceConfig.tier}`);
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[Stripe] Checkout session error:', err.message);
    return { ok: false, error: err.message };
  }
});


// --- Interactive single checkout window ---
let checkoutWindows = [];
const MAX_CHECKOUT_WINDOWS = 1;

ipcMain.handle('open-checkout-url', async (event, opts) => {
  checkoutWindows = checkoutWindows.filter(w => !w.isDestroyed());

  // Close any existing checkout window (single window mode)
  for (const w of checkoutWindows) {
    try { w.close(); } catch (_) { }
  }
  checkoutWindows = [];

  const { planUrls = {}, monthlyPlanUrls = {}, annualPlanUrls = {}, lifetimePlanUrls = {}, currentTier = 'free', initialTier = 'pro' } = opts;

  // Backwards compat: if old-style single URL passed
  if (opts.url && !Object.keys(planUrls).length) {
    planUrls[opts.upgradeTier || 'pro'] = opts.url;
  }

  const allPlans = [
    {
      key: 'free', name: 'Free', icon: '🌱',
      monthlyLabel: '$0', annualLabel: '$0', lifetimeLabel: '$0',
      period: 'forever', color: '#6B7280',
      desc: 'Perfect for trying it out. Limited to 1 language, 3 engines, and 2-minute recordings.'
    },
    {
      key: 'pro', name: 'Windy Word', icon: '⚡',
      monthlyLabel: '$4.99', annualLabel: '$49', lifetimeLabel: '$99',
      period: 'annual', color: '#22C55E',
      desc: 'Unlock all 15 AI engines, 99 languages, 15-min recordings, batch processing, and AI-powered LLM polish.'
    },
    {
      key: 'translate', name: 'Windy Ultra', icon: '🚀',
      monthlyLabel: '$8.99', annualLabel: '$79', lifetimeLabel: '$199',
      period: 'annual', color: '#3B82F6', recommended: true,
      desc: 'Everything in Pro PLUS 60-min recordings, real-time translation across 99 languages, and conversation mode.'
    },
    {
      key: 'translate_pro', name: 'Windy Max', icon: '👑',
      monthlyLabel: '$14.99', annualLabel: '$149', lifetimeLabel: '$299',
      period: 'annual', color: '#A855F7',
      desc: 'The ultimate: 60-min cloud recording, text-to-speech, medical/legal glossaries, and every feature unlocked.'
    }
  ];

  const featureDefs = [
    { key: 'maxEngines', label: 'AI Engines', tip: 'Number of transcription engines. More = better accuracy across accents and noise.' },
    { key: 'maxLanguages', label: 'Languages', tip: 'Free: 1, Paid: all 99 languages including rare dialects.' },
    { key: 'maxMinutes', label: 'Recording Length', tip: 'Maximum length of a single recording session. Free: 5 min. Pro: 30 min. Ultra: 60 min. Max: unlimited!' },
    { key: 'batchMode', label: 'Batch Mode', tip: 'Drag-drop a folder of recordings and transcribe them all at once.' },
    { key: 'llmPolish', label: 'LLM Polish', tip: 'AI fixes grammar, removes filler words, adds punctuation automatically.' },
    { key: 'translation', label: 'Real-time Translation', tip: 'Live speech translation across 99 language pairs.' },
    { key: 'tts', label: 'Text-to-Speech', tip: 'Convert transcripts to natural-sounding audio output.' },
    { key: 'glossaries', label: 'Medical/Legal Glossaries', tip: 'Specialized medical and legal terminology databases.' }
  ];

  const tiers = {
    free: { maxEngines: 3, maxLanguages: 1, maxMinutes: 5, batchMode: false, llmPolish: false, translation: false, tts: false, glossaries: false },
    pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: 15, batchMode: true, llmPolish: true, translation: false, tts: false, glossaries: false },
    translate: { maxEngines: 15, maxLanguages: 99, maxMinutes: 60, batchMode: true, llmPolish: true, translation: true, tts: false, glossaries: false },
    translate_pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: 'Unlimited', batchMode: true, llmPolish: true, translation: true, tts: true, glossaries: true }
  };

  // Encode data for embedding in HTML
  const DATA = JSON.stringify({ allPlans, featureDefs, tiers, monthlyPlanUrls, annualPlanUrls: Object.keys(annualPlanUrls).length ? annualPlanUrls : planUrls, lifetimePlanUrls, currentTier, initialTier });

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Choose Your Plan</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    'body{font-family:"Inter",system-ui,sans-serif;background:linear-gradient(135deg,#0F172A,#1E1B4B,#0F172A);color:#F1F5F9;min-height:100vh;overflow-x:hidden;}' +
    '.plan-strip{display:flex;gap:14px;padding:22px 28px 14px;justify-content:center;}' +
    '.plan-card{flex:1;max-width:180px;background:#1E293B;border:2px solid #334155;border-radius:12px;padding:14px 10px;text-align:center;position:relative;cursor:pointer;transition:all 0.3s ease;opacity:0.5;}' +
    '.plan-card:hover{opacity:0.8;transform:scale(1.02);}' +
    '.plan-card.selected{opacity:1;transform:scale(1.06);}' +
    '.plan-card.current{border-style:dashed;border-color:#FBBF24;opacity:0.85;}' +
    '.plan-card.unavailable{cursor:not-allowed;opacity:0.3;}' +
    '.plan-badge{position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#fff;padding:3px 12px;border-radius:10px;white-space:nowrap;text-transform:uppercase;letter-spacing:0.5px;}' +
    '.plan-icon{font-size:28px;margin-bottom:3px;}' +
    '.plan-name{font-size:14px;font-weight:700;transition:color 0.2s;}' +
    '.plan-price{font-size:24px;font-weight:800;color:#F1F5F9;}' +
    '.plan-period{font-size:11px;color:#64748B;text-transform:uppercase;}' +
    '.main{display:flex;min-height:calc(100vh - 90px);}' +
    '.left{flex:1.3;padding:18px 22px;display:flex;flex-direction:column;overflow-y:auto;}' +
    '.right{flex:0.7;background:linear-gradient(180deg,#1E293B,#0F172A);padding:24px 20px;display:flex;flex-direction:column;justify-content:center;align-items:center;border-left:1px solid #334155;}' +
    '.badge{display:inline-block;background:linear-gradient(135deg,#7C3AED,#EC4899);color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}' +
    'h1{font-size:24px;font-weight:800;margin-bottom:5px;background:linear-gradient(135deg,#A78BFA,#F472B6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;transition:all 0.3s;}' +
    '.subtitle{color:#94A3B8;font-size:14px;margin-bottom:12px;line-height:1.5;}' +
    '.highlight{color:#FBBF24;font-weight:600;}' +
    '.plan-name-display{font-size:22px;font-weight:800;text-align:center;margin-bottom:6px;letter-spacing:0.5px;text-shadow:0 0 20px rgba(255,255,255,0.15);}' +
    '.plan-desc{background:#1E293B;border:1px solid #334155;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#CBD5E1;line-height:1.5;transition:all 0.3s;}' +
    'table{width:100%;border-collapse:collapse;background:rgba(30,41,59,0.6);border-radius:10px;overflow:hidden;border:1px solid #334155;font-size:13px;}' +
    'th{padding:10px 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #334155;transition:all 0.3s;}' +
    'td{padding:8px 8px;border-bottom:1px solid #2D3748;color:#CBD5E1;text-align:center;transition:all 0.3s;font-size:13px;}' +
    'td.feature-label{text-align:left;font-weight:600;color:#F1F5F9;padding-left:12px;font-size:13px;}' +
    'td.selected-col{font-weight:700;color:#FFFFFF;font-size:14px;border-left:2px solid var(--sel-color,#22C55E);border-right:2px solid var(--sel-color,#22C55E);}' +
    'th.selected-col-head{font-weight:800;border-left:2px solid var(--sel-color,#22C55E);border-right:2px solid var(--sel-color,#22C55E);}' +
    '[title]{cursor:help;border-bottom:1px dotted #64748B;}' +
    '.urgency{background:linear-gradient(135deg,#7C3AED22,#EC489922);border:1px solid #7C3AED44;border-radius:8px;padding:10px 12px;margin-top:10px;text-align:center;font-size:13px;color:#C4B5FD;}' +
    '.cta-btn{display:inline-block;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:#fff;font-size:17px;font-weight:700;padding:15px 30px;border-radius:12px;border:none;cursor:pointer;text-decoration:none;transition:all 0.2s;box-shadow:0 4px 20px rgba(124,58,237,0.4);margin-bottom:10px;}' +
    '.cta-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,0.6);}' +
    '.cta-btn.disabled{opacity:0.4;cursor:not-allowed;transform:none;box-shadow:none;}' +
    '.price-tag{font-size:48px;font-weight:800;margin-bottom:2px;transition:all 0.3s;}' +
    '.price-sub{color:#CBD5E1;font-size:14px;margin-bottom:16px;transition:all 0.3s;}' +
    '.guarantee{color:#CBD5E1;font-size:12px;margin-top:8px;text-align:center;}' +
    '.trust-badges{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center;}' +
    '.trust-badge{background:#1E293B;border:1px solid #334155;border-radius:6px;padding:6px 10px;font-size:11px;color:#CBD5E1;}' +
    '.savings{border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;margin-bottom:10px;transition:all 0.3s;}' +
    '.plan-lifetime-teaser{margin-top:4px;padding:4px 8px;font-size:11px;font-weight:700;color:#FBBF24;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.25);border-radius:6px;cursor:pointer;text-align:center;transition:all 0.2s;}' +
    '.plan-lifetime-teaser:hover{background:rgba(251,191,36,0.2);border-color:rgba(251,191,36,0.5);transform:scale(1.02);}' +
    '@keyframes pulse-glow{0%,100%{box-shadow:0 0 8px rgba(34,197,94,0.3);}50%{box-shadow:0 0 20px rgba(34,197,94,0.6);}}' +
    '@keyframes sparkle{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.7;transform:scale(1.05);}}' +
    '@keyframes shimmer{0%{background-position:-200% center;}100%{background-position:200% center;}}' +
    '@keyframes gold-pulse{0%,100%{box-shadow:0 0 8px rgba(251,191,36,0.3),0 0 16px rgba(251,191,36,0.1);}50%{box-shadow:0 0 20px rgba(251,191,36,0.6),0 0 30px rgba(251,191,36,0.2);}}' +
    '.billing-selector{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 20px 10px;background:linear-gradient(180deg,#0F172A,#1E293B44);}' +
    '.billing-pill{padding:12px 20px;border-radius:12px;border:2px solid #334155;background:#1E293B;color:#CBD5E1;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.3s;text-align:center;min-width:130px;position:relative;}' +
    '.billing-pill:hover{border-color:#64748B;color:#F1F5F9;transform:translateY(-1px);}' +
    '.billing-pill.active-monthly{background:linear-gradient(135deg,#7C3AED22,#6D28D911);border-color:#7C3AED;color:#E9D5FF;}' +
    '.billing-pill.active-annual{background:linear-gradient(135deg,#22C55E22,#10B98111);border-color:#22C55E;color:#BBF7D0;animation:pulse-glow 2s ease-in-out infinite;}' +
    '.billing-pill.active-lifetime{background:linear-gradient(135deg,#FBBF2422,#F59E0B11);border-color:#FBBF24;color:#FEF3C7;animation:gold-pulse 2s ease-in-out infinite;}' +
    '.billing-pill .pill-label{font-size:11px;display:block;margin-top:3px;font-weight:500;letter-spacing:0.3px;}' +
    '.billing-pill .pill-label{color:#94A3B8;}' +
    '.billing-pill.active-monthly .pill-label{color:#C4B5FD;font-weight:600;}' +
    '.billing-pill.active-annual .pill-label{color:#86EFAC;font-weight:600;}' +
    '.billing-pill.active-lifetime .pill-label{color:#FDE68A;font-weight:600;}' +
    '.save-badge{font-size:12px;font-weight:800;padding:6px 14px;border-radius:20px;margin-left:8px;white-space:nowrap;animation:sparkle 1.5s ease-in-out infinite;letter-spacing:0.5px;text-transform:uppercase;}' +
    '.save-badge.b-monthly{background:#7C3AED33;color:#E9D5FF;border:1px solid #7C3AED55;}' +
    '.save-badge.b-annual{background:#22C55E33;color:#86EFAC;border:1px solid #22C55E55;}' +
    '.save-badge.b-lifetime{background:linear-gradient(135deg,#FBBF2444,#F59E0B33);color:#FDE68A;border:1px solid #FBBF2466;background-size:200% auto;animation:sparkle 1.5s ease-in-out infinite,shimmer 3s linear infinite;}' +
    '</style></head><body>' +
    '<div class="billing-selector">' +
    '<div class="billing-pill" data-billing="monthly" id="pillMonthly">📅 Monthly<span class="pill-label">Cancel anytime</span></div>' +
    '<div class="billing-pill active-annual" data-billing="annual" id="pillAnnual">⭐ Annual<span class="pill-label">Most popular &mdash; save 18%</span></div>' +
    '<div class="billing-pill" data-billing="lifetime" id="pillLifetime">💎 Lifetime<span class="pill-label">Pay once, own forever</span></div>' +
    '<span class="save-badge b-annual" id="saveBadge">✨ SAVE 18% vs MONTHLY</span>' +
    '</div>' +
    '<div class="plan-strip" id="planStrip"></div>' +
    '<div class="main"><div class="left">' +
    '<div class="badge" id="badgeText"></div>' +
    '<h1 id="heading"></h1>' +
    '<p class="subtitle">You\'re on <span class="highlight" id="currentPlanLabel"></span>. Click any plan above to compare:</p>' +
    '<div class="plan-desc" id="planDesc"></div>' +
    '<table><thead><tr id="tableHead"></tr></thead><tbody id="tableBody"></tbody></table>' +
    '<div class="urgency">🔥 <strong>2,400+ professionals</strong> upgraded this month · Your recordings deserve the best</div>' +
    '</div><div class="right">' +
    '<div class="plan-name-display" id="planNameDisplay"></div>' +
    '<div class="savings" id="savings"></div>' +
    '<div class="price-tag" id="priceTag"></div>' +
    '<div class="price-sub" id="priceSub"></div>' +
    '<a class="cta-btn" id="proceedBtn">🔒 Proceed to Secure Payment →</a>' +
    '<div class="guarantee">🛡️ 30-day money-back guarantee · Stripe secured</div>' +
    '<div class="trust-badges"><div class="trust-badge">🔒 256-bit SSL</div><div class="trust-badge">🏆 50K+ users</div><div class="trust-badge">⚡ Instant activation</div></div>' +
    '</div></div>' +
    '<script>window.onerror=function(m,s,l){document.body.innerHTML="<pre style=color:red;padding:20px>JS ERROR: "+m+"\\nLine: "+l+"</pre>";};' +
    'const D=' + DATA + ';' +
    'let selected=D.initialTier;' +
    'let billing="annual";' +
    'document.querySelectorAll(".billing-pill").forEach(pill=>{' +
    '  pill.addEventListener("click",function(){' +
    '    billing=this.dataset.billing;' +
    '    document.querySelectorAll(".billing-pill").forEach(p=>{p.classList.remove("active-monthly","active-annual","active-lifetime");});' +
    '    this.classList.add("active-"+billing);' +
    '    const badge=document.getElementById("saveBadge");' +
    '    badge.className="save-badge b-"+billing;' +
    '    if(billing==="monthly"){badge.textContent="FLEXIBLE - CANCEL ANYTIME";}' +
    '    else if(billing==="annual"){badge.textContent="SAVE 18% vs MONTHLY";}' +
    '    else{badge.textContent="BEST VALUE - PAY ONCE, OWN FOREVER";}' +
    '    render();' +
    '  });' +
    '});' +
    'function render(){' +
    '  const sp=D.allPlans.find(p=>p.key===selected)||D.allPlans[1];' +
    '  const ct=D.tiers[D.currentTier]||D.tiers.free;' +
    '  const st=D.tiers[selected]||D.tiers.pro;' +
    '  let newCount=0;' +
    '  D.featureDefs.forEach(f=>{' +
    '    if(typeof ct[f.key]==="boolean"){if(!ct[f.key]&&st[f.key])newCount++;}' +
    '    else{if(st[f.key]>ct[f.key])newCount++;}' +
    '  });' +
    '  document.getElementById("badgeText").textContent="🚀 "+newCount+" New Features Unlocked";' +
    '  document.getElementById("heading").textContent="Why "+sp.name+"?";' +
    '  document.getElementById("currentPlanLabel").textContent=D.allPlans.find(p=>p.key===D.currentTier)?.name||"Free";' +
    '  document.getElementById("planDesc").innerHTML="<strong style=\\"color:"+sp.color+"\\">"+sp.icon+" "+sp.name+":</strong> "+sp.desc;' +
    '  const priceKey=billing==="monthly"?"monthlyLabel":billing==="annual"?"annualLabel":"lifetimeLabel";' +
    '  document.getElementById("priceTag").textContent=sp[priceKey]||"$0";' +
    '  const periodMap={monthly:"per month · cancel anytime",annual:"per year · renews annually",lifetime:"one-time · yours forever"};' +
    '  document.getElementById("priceSub").textContent=sp.period==="forever"?"free forever":periodMap[billing];' +
    '  const urlMap={monthly:D.monthlyPlanUrls,annual:D.annualPlanUrls,lifetime:D.lifetimePlanUrls};' +
    '  const urls=urlMap[billing]||{};' +
    '  const hasUrl=!!urls[selected];' +
    '  const btn=document.getElementById("proceedBtn");' +
    '  const ctaMap={monthly:"🔒 Start Monthly Subscription →",annual:"🔒 Start Annual Plan →",lifetime:"🔒 Buy Lifetime Access →"};' +
    '  if(selected==="free"){btn.className="cta-btn disabled";btn.textContent="✓ This is your current plan";}' +
    '  else{btn.className="cta-btn";btn.textContent=ctaMap[billing];}' +
    '  const sav=document.getElementById("savings");' +
    '  document.getElementById("planNameDisplay").innerHTML=sp.icon+" "+sp.name;document.getElementById("planNameDisplay").style.color=sp.color;' +
    '  if(selected==="free"){sav.textContent="🌱 Free forever";sav.style.background="#6B728022";sav.style.color="#9CA3AF";sav.style.border="1px solid #6B728033";}' +
    '  else if(billing==="monthly"){sav.textContent="📅 Cancel anytime · no commitment";sav.style.background="#7C3AED22";sav.style.color="#C4B5FD";sav.style.border="1px solid #7C3AED33";}' +
    '  else if(billing==="annual"){sav.textContent="⭐ Save 18% vs monthly · most popular";sav.style.background="#10B98122";sav.style.color="#10B981";sav.style.border="1px solid #10B98133";}' +
    '  else{sav.textContent="💎 One-time · yours forever";sav.style.background="#FBBF2422";sav.style.color="#FBBF24";sav.style.border="1px solid #FBBF2433";}' +
    '  const strip=document.getElementById("planStrip");strip.innerHTML="";' +
    '  D.allPlans.forEach(p=>{' +
    '    const card=document.createElement("div");card.className="plan-card";' +
    '    if(p.key===selected)card.classList.add("selected");' +
    '    if(p.key===D.currentTier)card.classList.add("current");' +
    '    if(p.key===selected)card.style.borderColor=p.color,card.style.boxShadow="0 0 20px "+p.color+"44";' +
    '    card.innerHTML=(p.key===selected?"<div class=\\"plan-badge\\" style=\\"background:"+p.color+"\\">SELECTED</div>":"")' +
    '      +(p.key===D.currentTier&&p.key!==selected?"<div class=\\"plan-badge\\" style=\\"background:#6B7280\\">YOUR PLAN</div>":"")' +
    '      +(p.recommended&&p.key!==selected&&p.key!==D.currentTier?"<div class=\\"plan-badge\\" style=\\"background:#3B82F6\\">POPULAR</div>":"")' +
    '      +"<div class=\\"plan-icon\\">"+p.icon+"</div>"' +
    '      +"<div class=\\"plan-name\\" style=\\"color:"+(p.key===selected?p.color:p.key===D.currentTier?"#FBBF24":"#94A3B8")+"\\">"+p.name+"</div>"' +
    '      +"<div class=\\"plan-price\\">"+p[priceKey]+"</div>"' +
    '      +"<div class=\\"plan-period\\">"+(p.period==="forever"?"forever":billing==="monthly"?"/month":billing==="annual"?"/year":"one-time")+"</div>"+(billing!=="lifetime"&&p.lifetimeLabel&&p.period!=="forever"?"<div class=\\\"plan-lifetime-teaser\\\" onclick=\\\"event.stopPropagation();document.getElementById(\x27pillLifetime\x27).click();\\\">\uD83D\uDC8E "+p.lifetimeLabel+" lifetime</div>":"");' +
    '    card.addEventListener("click",()=>{selected=p.key;render();});' +
    '    strip.appendChild(card);' +
    '  });' +
    '  let headHtml="<th style=\\"text-align:left;padding:8px 10px;color:#CBD5E1;\\">Feature <span style=\\"font-size:10px;color:#94A3B8;\\">(hover for info)</span></th>";' +
    '  D.allPlans.forEach(p=>{' +
    '    const isSel=p.key===selected;const isCur=p.key===D.currentTier;' +
    '    headHtml+="<th style=\\"color:"+(isSel?p.color:isCur?"#FBBF24":"#CBD5E1")+";font-weight:"+(isSel?"800":"500")+";"+(isSel?"background:"+p.color+"30;":"")+"\\">"+p.name+(isCur?" ★":"")+"</th>";' +
    '  });document.getElementById("tableHead").innerHTML=headHtml;' +
    '  let bodyHtml="";' +
    '  D.featureDefs.forEach(f=>{' +
    '    bodyHtml+="<tr><td class=\\"feature-label\\" title=\\""+f.tip+"\\">"+f.label+"</td>";' +
    '    D.allPlans.forEach(p=>{' +
    '      const t=D.tiers[p.key]||D.tiers.free;const isSel=p.key===selected;' +
    '      const v=typeof t[f.key]==="boolean"?(t[f.key]?"✅":"❌"):(typeof t[f.key]==="string"?t[f.key]:t[f.key]+(f.key==="maxMinutes"?" min":""));' +
    '      bodyHtml+="<td class=\\""+(isSel?"selected-col":"")+"\\" style=\\""+(isSel?"background:"+sp.color+"30;--sel-color:"+sp.color+";":"")+"\\">"+v+"</td>";' +
    '    });bodyHtml+="</tr>";' +
    '  });document.getElementById("tableBody").innerHTML=bodyHtml;' +
    '}' +
    'document.getElementById("proceedBtn").addEventListener("click",function(e){' +
    '  e.preventDefault();' +
    '  const umap={monthly:D.monthlyPlanUrls,annual:D.annualPlanUrls,lifetime:D.lifetimePlanUrls};' +
    '  const urls2=umap[billing]||{};' +
    '  if(selected==="free"||!urls2[selected])return;' +
    '  window.location.href=urls2[selected];' +
    '});' +
    'render();' +
    '</script></body></html>';

  try {
    const checkoutWin = new BrowserWindow({
      width: 1140, height: 780, x: 100, y: 60,
      title: 'Choose Your Plan — Windy Word',
      autoHideMenuBar: true,
      // SEC-M11: Disable DevTools in packaged builds
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: true, partition: 'persist:checkout', devTools: !app.isPackaged }
    });
    // Write HTML to temp file to avoid data: URL encoding issues with emojis
    // SEC-M8: Use crypto random for unpredictable temp filename
    const tmpCheckoutPath = path.join(os.tmpdir(), 'windy-checkout-' + require('crypto').randomBytes(8).toString('hex') + '.html');
    require('fs').writeFileSync(tmpCheckoutPath, html, 'utf8');
    checkoutWin.loadFile(tmpCheckoutPath);
    checkoutWin.on('closed', () => { try { require('fs').unlinkSync(tmpCheckoutPath); } catch (_) { } });
    checkoutWin.focus();
    checkoutWindows = [checkoutWin];
    checkoutWin.on('closed', () => { checkoutWindows = checkoutWindows.filter(w => !w.isDestroyed()); });

    // Intercept payment-success and payment-cancel redirects
    checkoutWin.webContents.on('will-navigate', (navEvent, navUrl) => {
      if (navUrl.includes('/payment-success')) {
        navEvent.preventDefault();
        const successHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful!</title>' +
          '<style>*{margin:0;padding:0;box-sizing:border-box;}' +
          'body{font-family:"Inter",system-ui,sans-serif;background:linear-gradient(135deg,#0F172A,#1E1B4B);color:#F1F5F9;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;}' +
          '.card{max-width:500px;padding:40px;animation:fadeIn 0.6s ease;}' +
          '@keyframes fadeIn{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}' +
          '.check{font-size:80px;margin-bottom:16px;animation:pop 0.5s ease 0.3s both;}' +
          '@keyframes pop{from{transform:scale(0);}to{transform:scale(1);}}' +
          'h1{font-size:32px;font-weight:800;background:linear-gradient(135deg,#22C55E,#10B981);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px;}' +
          'p{color:#94A3B8;font-size:14px;line-height:1.6;margin-bottom:20px;}' +
          '.confetti{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;}' +
          '.confetti span{position:absolute;display:block;width:8px;height:8px;border-radius:2px;animation:fall 3s ease-in forwards;}' +
          '@keyframes fall{to{transform:translateY(110vh) rotate(720deg);opacity:0;}}' +
          '</style></head><body>' +
          '<div class="confetti" id="confetti"></div>' +
          '<div class="card">' +
          '<div class="check">✅</div>' +
          '<h1>Payment Successful!</h1>' +
          '<p>Welcome aboard! Your upgrade has been activated instantly.<br>You now have access to all premium features.</p>' +
          '<p style="font-size:12px;color:#64748B;">You can close this window. Your app will update automatically.</p>' +
          '</div>' +
          '<script>' +
          'const c=document.getElementById("confetti");const colors=["#22C55E","#3B82F6","#A855F7","#EC4899","#FBBF24","#F97316"];' +
          'for(let i=0;i<60;i++){const s=document.createElement("span");s.style.left=Math.random()*100+"%";s.style.top=-10+"px";' +
          's.style.background=colors[Math.floor(Math.random()*colors.length)];' +
          's.style.animationDelay=Math.random()*2+"s";s.style.animationDuration=(2+Math.random()*2)+"s";' +
          's.style.width=(4+Math.random()*8)+"px";s.style.height=(4+Math.random()*8)+"px";c.appendChild(s);}' +
          '</script></body></html>';
        checkoutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(successHtml));
        console.info('[Checkout] Payment success — showing confirmation page');
      } else if (navUrl.includes('/payment-cancel')) {
        navEvent.preventDefault();
        const cancelHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Cancelled</title>' +
          '<style>*{margin:0;padding:0;box-sizing:border-box;}' +
          'body{font-family:"Inter",system-ui,sans-serif;background:#0F172A;color:#F1F5F9;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;}' +
          '.card{max-width:400px;padding:40px;}' +
          'h1{font-size:24px;color:#EF4444;margin-bottom:10px;}' +
          'p{color:#94A3B8;font-size:14px;}' +
          '</style></head><body><div class="card">' +
          '<div style="font-size:60px;margin-bottom:12px;">😔</div>' +
          '<h1>Payment Cancelled</h1>' +
          '<p>No worries! You can upgrade anytime from the app. Your free account is still active.</p>' +
          '</div></body></html>';
        checkoutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(cancelHtml));
        console.info('[Checkout] Payment cancelled');
      }
    });

    console.info('[Main] Opened interactive checkout window');
    return { ok: true };
  } catch (e) {
    console.error('[Main] Checkout window failed:', e.message);
    return { ok: false, error: e.message };
  }
});


ipcMain.handle('check-payment-status', async (event, sessionId) => {
  try {
    const stripe = getStripe();
    if (!stripe) throw new Error('Payment system not configured.');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';
    const tier = session.metadata?.tier || 'pro';

    if (paid) {
      // Determine billing info
      const isSubscription = session.mode === 'subscription';
      const billingMode = isSubscription ? 'subscription' : 'lifetime';
      let expiresAt = null;
      let subscriptionId = null;
      if (isSubscription && session.subscription) {
        subscriptionId = session.subscription;
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          expiresAt = new Date(sub.current_period_end * 1000).toISOString();
        } catch (_) {
          // Fallback: 30 days from now
          expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }
      }

      // Update license in store
      store.set('license', {
        tier,
        email: session.customer_email || session.customer_details?.email || '',
        stripeSessionId: sessionId,
        subscriptionId,
        billingMode,
        purchasedAt: new Date().toISOString(),
        expiresAt,
        lastValidated: new Date().toISOString()
      });
      console.info(`[Stripe] Payment confirmed! Tier: ${tier}, Billing: ${billingMode}, Expires: ${expiresAt || 'never'}`);
      safeSend('license-updated', tier);
      // Trigger download wizard for the new tier
      showDownloadWizard(tier);
    }

    return { ok: true, paid, tier, status: session.payment_status };
  } catch (err) {
    console.error('[Stripe] Payment check error:', err.message);
    return { ok: false, error: 'Payment system error. Please try again or contact support.' };
  }
});

ipcMain.handle('get-current-tier', async () => {
  const license = store.get('license') || { tier: 'free' };
  const limits = getTierLimits(license.tier);
  // Include billingType for cloud processing gating (stored as billingMode from checkout)
  const billingType = license.billingMode || store.get('license.billingType') || null;
  const cloudSttEnabled = billingType !== 'lifetime' && license.tier !== 'free';
  return { tier: license.tier, billingType, cloudSttEnabled, limits, license };
});

ipcMain.handle('get-stripe-config', async () => {
  // Price IDs from env vars, with fallback to test-mode defaults
  return {
    pro: {
      monthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || 'price_1T60GeBXIOBasDQi4aitcq8O',
      annualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'price_1T5oYzBXIOBasDQibSlnIsPg',
      lifetimePriceId: process.env.STRIPE_PRO_LIFETIME_PRICE_ID || 'price_1T5oYzBXIOBasDQibSlnIsPg_life'
    },
    translate: {
      monthlyPriceId: process.env.STRIPE_ULTRA_MONTHLY_PRICE_ID || 'price_1T5oZJBXIOBasDQijBW23Gow',
      annualPriceId: process.env.STRIPE_ULTRA_ANNUAL_PRICE_ID || 'price_1T5oZJBXIOBasDQiHO0MtYS7',
      lifetimePriceId: process.env.STRIPE_ULTRA_LIFETIME_PRICE_ID || 'price_1T5oZJBXIOBasDQiHO0MtYS7_life'
    },
    translate_pro: {
      monthlyPriceId: process.env.STRIPE_MAX_MONTHLY_PRICE_ID || 'price_1T60H8BXIOBasDQiy5eorTWR',
      annualPriceId: process.env.STRIPE_MAX_ANNUAL_PRICE_ID || 'price_1T5oZ1BXIOBasDQinrz3VdvG',
      lifetimePriceId: process.env.STRIPE_MAX_LIFETIME_PRICE_ID || 'price_1T5oZ1BXIOBasDQinrz3VdvG_life'
    }
  };
});

ipcMain.handle('open-billing-portal', async () => {
  try {
    const stripe = getStripe();
    if (!stripe) throw new Error('Payment system not configured.');
    const license = store.get('license') || {};
    if (!license.stripeCustomerId) throw new Error('No Stripe customer found. Purchase a plan first.');
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: license.stripeCustomerId,
      return_url: process.env.STRIPE_RETURN_URL || 'https://windyword.ai/dashboard'
    });
    // SEC-06: Validate Stripe portal URL before opening
    if (isSafeURL(portalSession.url)) shell.openExternal(portalSession.url);
    return { ok: true, url: portalSession.url };
  } catch (err) {
    console.error('[Stripe] Billing portal error:', err.message);
    return { ok: false, error: 'Billing portal unavailable. Please try again later.' };
  }
});

// ═══ License Enforcement — Subscription Validation ═══
async function validateLicense() {
  const license = store.get('license');
  if (!license || license.tier === 'free') return; // No license to validate

  // Lifetime purchases never expire
  if (license.billingMode === 'lifetime' || !license.billingMode) {
    console.info('[License] Lifetime license — no validation needed');
    return;
  }

  // Check if subscription has expired locally first
  if (license.expiresAt) {
    const expiryDate = new Date(license.expiresAt);
    const now = new Date();
    const gracePeriod = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (now < expiryDate) {
      console.info(`[License] Subscription valid until ${license.expiresAt}`);
      return; // Still within subscription period
    }

    // Past expiry — check if within grace period
    if (now - expiryDate < gracePeriod) {
      console.warn('[License] Subscription expired but within 7-day grace period');
    }
  }

  // Try to validate with Stripe
  const stripe = getStripe();
  if (!stripe || !license.subscriptionId) {
    // No internet or no subscription ID — allow 7-day grace from last validation
    if (license.lastValidated) {
      const lastCheck = new Date(license.lastValidated);
      const daysSinceCheck = (Date.now() - lastCheck.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceCheck < 7) {
        console.warn(`[License] Offline — ${Math.round(daysSinceCheck)}d since last check, grace allowed`);
        return;
      }
    }
    // Grace period exceeded — downgrade
    console.warn('[License] Grace period exceeded — reverting to free tier');
    store.set('license.tier', 'free');
    safeSend('license-expired', { reason: 'grace_period_exceeded' });
    return;
  }

  try {
    const sub = await stripe.subscriptions.retrieve(license.subscriptionId);
    if (sub.status === 'active' || sub.status === 'trialing') {
      // Subscription active — extend local license
      store.set('license.expiresAt', new Date(sub.current_period_end * 1000).toISOString());
      store.set('license.lastValidated', new Date().toISOString());
      console.info(`[License] Subscription active, extended to ${new Date(sub.current_period_end * 1000).toISOString()}`);
    } else {
      // Subscription cancelled/past_due — downgrade
      console.warn(`[License] Subscription status: ${sub.status} — reverting to free tier`);
      store.set('license.tier', 'free');
      store.set('license.expiresAt', null);
      safeSend('license-expired', { reason: sub.status });
    }
  } catch (err) {
    console.error('[License] Stripe validation failed:', err.message);
    // Network error — allow grace period
    if (license.lastValidated) {
      const daysSinceCheck = (Date.now() - new Date(license.lastValidated).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceCheck > 7) {
        store.set('license.tier', 'free');
        safeSend('license-expired', { reason: 'validation_failed' });
      }
    }
  }
}

ipcMain.handle('validate-license', validateLicense);



// ═══ Model Download Manager & Wizard ═══

/**
 * Check which models are already downloaded (scan ~/.windy-pro/models/<model-id>/)
 */
function checkModelStatus() {
  const fs = require('fs');
  const models = {};
  const windyModelsDir = path.join(os.homedir(), '.windy-pro', 'models');

  for (const [name, info] of Object.entries(MODEL_MANIFEST.models)) {
    const modelPath = path.join(windyModelsDir, name);

    // Check if model directory exists and has content
    let downloaded = false;
    try {
      if (fs.existsSync(modelPath)) {
        // Check if directory has files (at least config.json or similar)
        const files = fs.readdirSync(modelPath);
        downloaded = files.length > 0;
      }
    } catch (_) { }

    models[name] = {
      ...info,
      downloaded,
      location: downloaded ? 'local' : null
    };
  }
  return models;
}

ipcMain.handle('check-model-status', async () => {
  const tier = store.get('license.tier') || 'free';
  const models = checkModelStatus();
  const allowedModels = MODEL_MANIFEST.tierModels[tier] || MODEL_MANIFEST.tierModels.free;
  return { tier, models, allowedModels };
});

/**
 * Download a specific model by spawning a Python subprocess
 * Returns a promise that resolves when download completes
 *
 * TODO [L4-P3 — Model Watermarking]: When the server-side LSB fingerprinting
 * pipeline is built, embed a per-user fingerprint into model weights before
 * upload to CDN. This will be platform-agnostic and happen at scale.
 * The desktop client does NOT need to watermark — it just downloads pre-
 * fingerprinted models. See MODEL_PROTECTION_SPEC.md Layer 4 for details.
 */
function downloadModel(modelName) {
  return new Promise((resolve, reject) => {
    const venvPython = path.join(os.homedir(), '.windy-pro', 'venv', 'bin', 'python');
    const pythonExe = require('fs').existsSync(venvPython) ? venvPython : 'python3';

    console.info(`[ModelDownload] Starting download: ${modelName}`);

    // Determine HuggingFace repo name (translation models use underscores)
    let repoName = modelName;
    if (modelName === 'windy-translate-spark') {
      repoName = 'windy-translate-spark';
    } else if (modelName === 'windy-translate-standard') {
      repoName = 'windy-translate-standard';
    }

    const localDir = path.join(os.homedir(), '.windy-pro', 'models', modelName);

    const proc = require('child_process').spawn(pythonExe, ['-c', `
import sys
import os
print(f"DOWNLOADING {sys.argv[0]}", flush=True)
try:
    from huggingface_hub import snapshot_download
    print("LOADING", flush=True)
    local_dir = ${JSON.stringify(localDir)}
    os.makedirs(local_dir, exist_ok=True)
    snapshot_download(${JSON.stringify('WindyLabs/' + repoName)}, local_dir=local_dir)
    print("DONE", flush=True)
except Exception as e:
    print(f"ERROR {e}", flush=True)
    sys.exit(1)
`], { stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          safeSend('model-download-progress', { model: modelName, status: line.trim() });
        }
      }
    });
    proc.stderr.on('data', (data) => {
      // HuggingFace downloads print progress to stderr
      const text = data.toString();
      if (text.includes('%')) {
        const match = text.match(/(\d+)%/);
        if (match && mainWindow && !mainWindow.isDestroyed()) {
          safeSend('model-download-progress', { model: modelName, percent: parseInt(match[1]) });
        }
      }
    });
    proc.on('close', (code) => {
      if (code === 0 && output.includes('DONE')) {
        console.info(`[ModelDownload] Completed: ${modelName}`);
        resolve(true);
      } else {
        console.error(`[ModelDownload] Failed: ${modelName} (exit ${code})`);
        reject(new Error(`Download failed for ${modelName}`));
      }
    });
    proc.on('error', (err) => reject(err));
  });
}

ipcMain.handle('download-models', async (event, modelNames) => {
  const results = {};
  for (const name of modelNames) {
    try {
      safeSend('model-download-progress', { model: name, status: 'STARTING', percent: 0 });
      await downloadModel(name);
      results[name] = { ok: true };
      safeSend('model-download-progress', { model: name, status: 'DONE', percent: 100 });
    } catch (err) {
      results[name] = { ok: false, error: err.message };
      safeSend('model-download-progress', { model: name, status: 'ERROR', error: err.message });
    }
  }
  return results;
});

/**
 * Show the Model Download Wizard popup
 */
function showDownloadWizard(newTier) {
  const models = checkModelStatus();
  const allowedModels = MODEL_MANIFEST.tierModels[newTier] || MODEL_MANIFEST.tierModels.free;
  const toDownload = allowedModels.filter(m => !models[m]?.downloaded);

  if (toDownload.length === 0) {
    console.info('[Wizard] All models already downloaded for tier:', newTier);
    safeSend('license-updated', newTier);
    return;
  }

  const tierNames = { free: 'Free', pro: 'Windy Word', translate: 'Windy Ultra', translate_pro: 'Windy Max' };
  const tierName = tierNames[newTier] || newTier;

  const totalBytes = toDownload.reduce((sum, m) => sum + (MODEL_MANIFEST.models[m]?.bytes || 0), 0);
  const totalSizeMB = Math.round(totalBytes / 1024 / 1024);

  const modelRows = allowedModels.map(m => {
    const info = MODEL_MANIFEST.models[m];
    const isDownloaded = models[m]?.downloaded;
    const needsDownload = toDownload.includes(m);
    return { key: m, label: info.label, size: info.size, desc: info.desc, downloaded: isDownloaded, needsDownload };
  });

  const DATA = JSON.stringify({ modelRows, toDownload, tierName, totalSizeMB });

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Downloading Engines</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    'body{font-family:"Inter",system-ui,sans-serif;background:linear-gradient(135deg,#0F172A,#1E1B4B,#0F172A);color:#F1F5F9;min-height:100vh;padding:30px;}' +
    '.header{text-align:center;margin-bottom:24px;}' +
    '.emoji{font-size:48px;margin-bottom:8px;}' +
    'h1{font-size:24px;font-weight:800;background:linear-gradient(135deg,#22C55E,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px;}' +
    '.subtitle{color:#94A3B8;font-size:13px;}' +
    '.model-list{max-width:500px;margin:0 auto 20px;}' +
    '.model-row{display:flex;align-items:center;gap:12px;background:#1E293B;border:1px solid #334155;border-radius:10px;padding:12px 16px;margin-bottom:8px;transition:all 0.3s;}' +
    '.model-row.done{border-color:#22C55E33;}' +
    '.model-row.active{border-color:#3B82F6;box-shadow:0 0 12px #3B82F644;}' +
    '.model-row.error{border-color:#EF444433;}' +
    '.model-icon{font-size:20px;width:28px;text-align:center;}' +
    '.model-info{flex:1;}' +
    '.model-name{font-size:13px;font-weight:600;color:#F1F5F9;}' +
    '.model-detail{font-size:11px;color:#64748B;}' +
    '.model-status{font-size:11px;font-weight:600;text-align:right;min-width:80px;}' +
    '.model-status.done{color:#22C55E;}' +
    '.model-status.downloading{color:#3B82F6;}' +
    '.model-status.queued{color:#64748B;}' +
    '.model-status.error{color:#EF4444;}' +
    '.progress-bar{width:100%;height:4px;background:#334155;border-radius:2px;margin-top:4px;overflow:hidden;}' +
    '.progress-fill{height:100%;background:linear-gradient(90deg,#3B82F6,#22C55E);border-radius:2px;transition:width 0.3s;width:0%;}' +
    '.overall{max-width:500px;margin:0 auto 16px;text-align:center;}' +
    '.overall-bar{width:100%;height:6px;background:#334155;border-radius:3px;overflow:hidden;margin:8px 0;}' +
    '.overall-fill{height:100%;background:linear-gradient(90deg,#7C3AED,#3B82F6,#22C55E);border-radius:3px;transition:width 0.5s;width:0%;}' +
    '.overall-text{font-size:11px;color:#94A3B8;}' +
    '.actions{text-align:center;margin-top:16px;}' +
    '.use-btn{background:linear-gradient(135deg,#22C55E,#16A34A);color:#fff;border:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;}' +
    '.use-btn:hover{transform:translateY(-2px);box-shadow:0 4px 20px #22C55E44;}' +
    '.done-msg{display:none;text-align:center;margin-top:20px;}' +
    '.done-msg.show{display:block;}' +
    '.done-msg h2{font-size:20px;color:#22C55E;margin-bottom:6px;}' +
    '.done-msg p{color:#94A3B8;font-size:12px;}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<div class="emoji">🚀</div>' +
    '<h1>Welcome to ' + tierName + '!</h1>' +
    '<p class="subtitle">Downloading your premium engines (~' + totalSizeMB + ' MB total)</p>' +
    '</div>' +
    '<div class="model-list" id="modelList"></div>' +
    '<div class="overall">' +
    '<div class="overall-bar"><div class="overall-fill" id="overallFill"></div></div>' +
    '<div class="overall-text" id="overallText">Preparing downloads…</div>' +
    '</div>' +
    '<div class="actions">' +
    '<button class="use-btn" id="useBtn" onclick="window.close()">✨ Use App Now — downloads continue in background</button>' +
    '</div>' +
    '<div class="done-msg" id="doneMsg">' +
    '<h2>✅ All Engines Ready!</h2>' +
    '<p>All premium engines are downloaded and ready. Close this window and enjoy!</p>' +
    '</div>' +
    '<script>' +
    'const D=' + DATA + ';' +
    'const states={};' +
    'D.modelRows.forEach(m=>states[m.key]=m.downloaded?"done":"queued");' +
    'function renderList(){' +
    '  const list=document.getElementById("modelList");list.innerHTML="";' +
    '  D.modelRows.forEach(m=>{' +
    '    const st=states[m.key]||"queued";const pct=states[m.key+"_pct"]||0;' +
    '    const cls="model-row "+(st==="done"?"done":st==="downloading"?"active":st==="error"?"error":"");' +
    '    const icon=st==="done"?"✅":st==="downloading"?"⬇️":st==="error"?"❌":"⏳";' +
    '    const statusCls="model-status "+(st==="done"?"done":st==="downloading"?"downloading":st==="error"?"error":"queued");' +
    '    const statusText=st==="done"?"Ready":st==="downloading"?pct+"%":st==="error"?"Failed":"Queued";' +
    '    let barHtml="";' +
    '    if(st==="downloading")barHtml="<div class=\\"progress-bar\\"><div class=\\"progress-fill\\" style=\\"width:"+pct+"%\\"></div></div>";' +
    '    list.innerHTML+="<div class=\\""+cls+"\\"><div class=\\"model-icon\\">"+icon+"</div>"' +
    '      +"<div class=\\"model-info\\"><div class=\\"model-name\\">"+m.label+" ("+m.key+")</div>"' +
    '      +"<div class=\\"model-detail\\">"+m.size+" — "+m.desc+"</div>"+barHtml+"</div>"' +
    '      +"<div class=\\""+statusCls+"\\">"+statusText+"</div></div>";' +
    '  });' +
    '  const doneCount=D.modelRows.filter(m=>states[m.key]==="done").length;' +
    '  const pct=Math.round(doneCount/D.modelRows.length*100);' +
    '  document.getElementById("overallFill").style.width=pct+"%";' +
    '  document.getElementById("overallText").textContent=doneCount+" of "+D.modelRows.length+" engines ready";' +
    '  if(D.toDownload.every(m=>states[m]==="done")){' +
    '    document.getElementById("doneMsg").classList.add("show");' +
    '    document.getElementById("useBtn").textContent="🎉 Close & Start Using Premium Engines";' +
    '  }' +
    '}' +
    'renderList();' +
    // Poll for status updates via title changes (simple IPC without preload)
    'setInterval(()=>{' +
    '  const t=document.title;' +
    '  if(t.startsWith("UPDATE:")){' +
    '    try{const u=JSON.parse(t.substring(7));' +
    '    if(u.model){' +
    '      if(u.status==="DONE")states[u.model]="done";' +
    '      else if(u.status==="ERROR")states[u.model]="error";' +
    '      else if(u.status==="STARTING"||u.status==="DOWNLOADING"||u.status==="LOADING"){states[u.model]="downloading";states[u.model+"_pct"]=u.percent||0;}' +
    '      else if(u.percent!==undefined){states[u.model]="downloading";states[u.model+"_pct"]=u.percent;}' +
    '      renderList();' +
    '    }}catch(_){}' +
    '    document.title="Downloading Engines";' +
    '  }' +
    '},200);' +
    '</script></body></html>';

  const wizardWin = new BrowserWindow({
    width: 580, height: 620, x: 200, y: 100,
    title: 'Downloading Engines',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: true }
  });
  wizardWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  wizardWin.focus();

  // Start downloading missing models sequentially
  (async () => {
    for (const modelName of toDownload) {
      // Send status update via title change (safe without preload)
      try {
        wizardWin.setTitle('UPDATE:' + JSON.stringify({ model: modelName, status: 'DOWNLOADING', percent: 0 }));
      } catch (_) { }

      try {
        await downloadModel(modelName);
        try {
          wizardWin.setTitle('UPDATE:' + JSON.stringify({ model: modelName, status: 'DONE', percent: 100 }));
        } catch (_) { }
      } catch (err) {
        try {
          wizardWin.setTitle('UPDATE:' + JSON.stringify({ model: modelName, status: 'ERROR' }));
        } catch (_) { }
        console.error(`[Wizard] Download failed for ${modelName}:`, err.message);
      }
    }
    console.info('[Wizard] All model downloads complete for tier:', newTier);
    safeSend('license-updated', newTier);
  })();
}

ipcMain.handle('show-download-wizard', async (event, tier) => {
  showDownloadWizard(tier || store.get('license.tier') || 'free');
  return { ok: true };
});

// ═══ Text Translation via AI (Groq/OpenAI) ═══
// Extracted to a named function so the HTTP control surface (/translate) can
// call the same path the IPC handler uses without duplicating the API logic.
async function translateViaAI(text, sourceLang, targetLang) {
  if (!text || !targetLang) return { ok: false, error: 'Missing text or target language' };

  const LANG_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
    ru: 'Russian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', hi: 'Hindi',
    auto: 'auto-detected'
  };
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;

  const groqKey = store.get('engine.groqApiKey', '') || process.env.GROQ_API_KEY || '';
  const openaiKey = store.get('engine.openaiApiKey', '') || process.env.OPENAI_API_KEY || '';
  const apiKey = groqKey || openaiKey;
  if (!apiKey) {
    return { ok: false, error: 'No AI API key configured. Add a Groq or OpenAI API key in Settings → Transcription Engine.' };
  }
  const isGroq = !!groqKey;
  const apiUrl = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
  const prompt = `Translate the following text from ${srcName} to ${tgtName}. Return ONLY the translated text, nothing else.\n\n${text}`;

  try {
    const https = require('https');
    const url = new URL(apiUrl);
    const postData = JSON.stringify({
      model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048,
    });
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              const translated = json.choices?.[0]?.message?.content?.trim();
              resolve({ ok: true, translatedText: translated, engine: isGroq ? 'groq' : 'openai', confidence: 0.95 });
            } catch (e) { reject(new Error('Failed to parse AI response')); }
          } else { reject(new Error(`AI API returned ${res.statusCode}: ${data.substring(0, 200)}`)); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('AI API timeout')); });
      req.write(postData);
      req.end();
    });
    console.info(`🌐 Text translation (${result.engine}): ${srcName}→${tgtName}`);
    return result;
  } catch (err) {
    console.error('[Translate] AI text translation failed:', err.message);
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('translate-text', async (event, text, sourceLang, targetLang) => {
  return translateViaAI(text, sourceLang, targetLang);
});

// ═══ Offline Translation via Local Pair Model ═══
ipcMain.handle('translate-offline', async (event, text, sourceLang, targetLang) => {
  if (!text || !targetLang) return { ok: false, error: 'Missing text or target language' };

  // Check if models are locked (grace period expired or license revoked)
  if (store.get('license.modelsLocked', false)) {
    return {
      ok: false,
      error: 'Models are locked. Please connect to the internet to verify your WindyWord license.',
      modelsLocked: true
    };
  }

  try {
    const mgr = getPairDownloadManager();
    const pairId = `${sourceLang}-${targetLang}`;
    const reversePairId = `${targetLang}-${sourceLang}`;

    // Check if pair is downloaded (try both directions)
    const downloaded = mgr.getDownloadedPairs();
    const hasPair = downloaded.includes(pairId) || downloaded.includes(reversePairId);
    if (!hasPair) {
      return { ok: false, error: `Translation pair ${pairId} not downloaded. Install it from the Marketplace.`, needsPair: true, pairId };
    }

    // Load the pair model (decrypted in memory)
    const actualPairId = downloaded.includes(pairId) ? pairId : reversePairId;
    const modelBuffer = await mgr.loadPairModel(actualPairId);
    if (!modelBuffer) {
      return { ok: false, error: 'Failed to load translation pair model' };
    }

    // Offline translation is handled by the pair engine
    // For now, return a structured response indicating the pair is available
    // The actual translation happens in the renderer via the loaded model
    return { ok: true, translatedText: text, engine: 'offline-pair', pairId: actualPairId, modelSize: modelBuffer.length };
  } catch (err) {
    console.error('[Translate] Offline translation failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// On-device translation — NLLB-200 (CTranslate2 + SentencePiece), fully offline.
// Spawns the venv python on the bundled translate_local.py with the bundled model
// (same offline-correct pattern as 'batch-transcribe-local'). No cloud, no API key.
// Shared by the 'translate-local' IPC and the mini-translate-speech text step.
async function nllbTranslate(text, sourceLang, targetLang) {
  if (!text || !targetLang) return { ok: false, error: 'Missing text or target language' };
  const tmpReq = path.join(os.tmpdir(), `windy-tr-${crypto.randomBytes(8).toString('hex')}.json`);
  try {
    const appDataDir = path.join(os.homedir(), '.windy-pro');
    const venvPy = process.platform === 'win32'
      ? path.join(appDataDir, 'venv', 'Scripts', 'python.exe')
      : path.join(appDataDir, 'venv', 'bin', 'python');
    const bundledRoot = process.resourcesPath ? path.join(process.resourcesPath, 'bundled') : null;
    const bundledPy = bundledRoot
      ? (process.platform === 'win32' ? path.join(bundledRoot, 'python', 'python.exe') : path.join(bundledRoot, 'python', 'bin', 'python3'))
      : null;
    const pythonPath = fs.existsSync(venvPy) ? venvPy : (bundledPy && fs.existsSync(bundledPy) ? bundledPy : 'python3');

    const modelDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled', 'model', 'nllb-200-600M')
      : path.join(__dirname, '..', '..', '..', 'extraResources', 'model', 'nllb-200-600M');
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'engine', 'translate_local.py')
      : path.join(__dirname, '..', '..', 'engine', 'translate_local.py');

    if (!fs.existsSync(path.join(modelDir, 'model.bin'))) {
      return { ok: false, error: 'On-device translation model is not installed.' };
    }
    fs.writeFileSync(tmpReq, JSON.stringify({
      model_dir: modelDir,
      items: [{ text, source: sourceLang || 'en', target: targetLang }],
    }));

    const { stdout } = await execFileAsync(pythonPath, [scriptPath, tmpReq], {
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', KMP_DUPLICATE_LIB_OK: 'TRUE' },
    });
    const parsed = JSON.parse(stdout.trim().split('\n').pop());
    if (!parsed.ok) return { ok: false, error: parsed.error || 'translation failed' };
    return { ok: true, translatedText: parsed.results?.[0]?.translatedText || '', engine: parsed.engine || 'nllb-local' };
  } catch (err) {
    console.error('[translate-local] error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tmpReq); } catch (_) {}
  }
}
ipcMain.handle('translate-local', (event, text, sourceLang, targetLang) => nllbTranslate(text, sourceLang, targetLang));

ipcMain.handle('apply-coupon', async (event, code) => {
  try {
    const stripe = getStripe();
    if (!stripe) throw new Error('Payment system not configured.');
    // Search for active promotion codes matching this code
    const promos = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    if (!promos.data.length) {
      return { ok: false, valid: false, error: 'Invalid or expired coupon code' };
    }
    const promo = promos.data[0];
    const coupon = promo.coupon;
    let discount = {};
    if (coupon.percent_off) {
      discount = { type: 'percent', value: coupon.percent_off, label: `${coupon.percent_off}% off` };
    } else if (coupon.amount_off) {
      discount = { type: 'amount', value: coupon.amount_off, label: `$${(coupon.amount_off / 100).toFixed(2)} off` };
    }
    return { ok: true, valid: true, discount, promoId: promo.id };
  } catch (err) {
    console.error('[Stripe] Coupon validation error:', err.message);
    return { ok: false, valid: false, error: err.message };
  }
});

// Get server config for WebSocket connection
ipcMain.handle('get-server-config', () => {
  return store.get('server');
});

// Minimize window
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

// Maximize / Restore window
ipcMain.on('maximize-window', () => {
  if (mainWindow) mainWindow.maximize();
});
ipcMain.on('unmaximize-window', () => {
  if (mainWindow) mainWindow.unmaximize();
});
// Custom video-expand fullscreen — paired with the History panel's expand
// button (history.js). On macOS uses setSimpleFullScreen so it works with the
// non-focusable main window without disturbing the recording focus invariant.
ipcMain.on('set-video-fullscreen', (event, on) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(!!on);
    else mainWindow.setFullScreen(!!on);
  } catch (e) { console.warn('[set-video-fullscreen]', e.message); }
});

ipcMain.handle('is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ── Song Identification (Chromaprint/AcoustID + AudD fallback) ──
// P2-3: execFile already imported at top level (line 79)
const https = require('https');
const http = require('http');

// Check if fpcalc is available
ipcMain.handle('check-fpcalc', async () => {
  return new Promise((resolve) => {
    execFile('fpcalc', ['-version'], (err) => {
      resolve(!err);
    });
  });
});

// Helper: HTTP GET as promise
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'WindyPro/1.6.0 (music identification)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Identify a song from a base64 data URL
ipcMain.handle('identify-song', async (event, { dataUrl, auddApiKey }) => {
  const tmpDir = require('os').tmpdir();
  // SEC-M8: Use crypto.randomBytes for unpredictable temp filenames
  const tmpFile = require('path').join(tmpDir, `windy_identify_${crypto.randomBytes(16).toString('hex')}.webm`);

  try {
    // Write data URL to temp file
    const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!base64Match) {

      return { error: 'Invalid audio format' };
    }
    const buffer = Buffer.from(base64Match[1], 'base64');
    require('fs').writeFileSync(tmpFile, buffer);


    // Method 1: Try fpcalc + AcoustID (free, no API key needed)
    try {

      const fingerprint = await new Promise((resolve, reject) => {
        execFile('fpcalc', ['-json', tmpFile], { timeout: 30000 }, (err, stdout, stderr) => {
          if (err) {
            console.error('[Identify] ❌ fpcalc error:', err.message);
            if (stderr) console.error('[Identify] fpcalc stderr:', stderr);
            return reject(err);
          }

          try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
        });
      });



      if (fingerprint && fingerprint.fingerprint && fingerprint.duration) {
        // Look up on AcoustID (free API — client ID is for open-source apps)
        const acoustUrl = `https://api.acoustid.org/v2/lookup?client=8XaBELgH&duration=${Math.round(fingerprint.duration)}&fingerprint=${encodeURIComponent(fingerprint.fingerprint)}&meta=recordings+releasegroups`;

        const acoustResult = await httpGet(acoustUrl);


        if (acoustResult.status === 'ok' && acoustResult.results && acoustResult.results.length > 0) {
          const best = acoustResult.results[0];

          if (best.recordings && best.recordings.length > 0) {
            const rec = best.recordings[0];
            const title = rec.title || 'Unknown Title';
            const artists = rec.artists ? rec.artists.map(a => a.name).join(', ') : 'Unknown Artist';
            const album = (rec.releasegroups && rec.releasegroups[0]) ? rec.releasegroups[0].title : '';
            const score = Math.round((best.score || 0) * 100);

            // Clean up temp file
            try { require('fs').unlinkSync(tmpFile); } catch (_) { }

            console.info(`[Identify] ✅ IDENTIFIED: ${artists} — ${title} (${score}% confidence)`);
            return {
              success: true,
              method: 'chromaprint',
              title,
              artist: artists,
              album,
              confidence: score,
              newName: `${artists} — ${title}`
            };
          } else {
            console.warn('[Identify] ⚠️ AcoustID returned results but no recordings in best match');
          }
        } else {
          console.warn('[Identify] ⚠️ AcoustID returned no matching results. Error:', acoustResult?.error?.message);
        }
      } else {
        console.warn('[Identify] ⚠️ fpcalc returned no fingerprint or duration');
      }
    } catch (fpcalcErr) {
      console.error('[Identify] ❌ fpcalc/AcoustID failed:', fpcalcErr.message);
    }

    // Method 2: AudD API fallback (requires API key)
    if (auddApiKey) {
      try {
        const FormData = require('form-data') || null;
        // Use Node.js https to POST to AudD
        const boundary = '----WindyPro' + Date.now();
        const audioData = require('fs').readFileSync(tmpFile);

        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="api_token"\r\n\r\n${auddApiKey}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="return"\r\n\r\napple_music,spotify\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
          audioData,
          Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);

        const auddResult = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: 'api.audd.io',
            path: '/',
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': body.length
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
          req.write(body);
          req.end();
        });

        if (auddResult.status === 'success' && auddResult.result) {
          const r = auddResult.result;
          try { require('fs').unlinkSync(tmpFile); } catch (_) { }
          return {
            success: true,
            method: 'audd',
            title: r.title || 'Unknown',
            artist: r.artist || 'Unknown',
            album: r.album || '',
            newName: `${r.artist || 'Unknown'} — ${r.title || 'Unknown'}`
          };
        }
      } catch (auddErr) {
        console.error('[Identify] AudD fallback failed:', auddErr.message);
      }
    }

    // Clean up
    try { require('fs').unlinkSync(tmpFile); } catch (_) { }
    return { error: 'Could not identify this song' };

  } catch (e) {
    try { require('fs').unlinkSync(tmpFile); } catch (_) { }
    return { error: e.message };
  }
});

// ═══ Mic Access Focus Restore ═══
// Renderer sends this IMMEDIATELY after getUserMedia succeeds.
// getUserMedia steals macOS focus → this restores it to the target app.
// Also fires a second restore 200ms later to catch AudioContext focus-steal.
ipcMain.on('mic-access-granted', () => {
  if (process.platform !== 'darwin' || !global._lastFocusedPid) return;
  // Don't steal focus to the target app when the user is ACTIVELY in the Windy window
  // (e.g. Settings open) — that's what shoved the window behind everything. Discriminator:
  // normal hotkey dictation keeps mainWindow focusable:false (getUserMedia momentarily
  // steals focus but isFocusable stays false → restore still runs, paste works); only the
  // Settings/UI path sets focusable:true, so isFocusable()&&isFocused() means "user is in Windy".
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocusable() && mainWindow.isFocused()) {
    console.info('[Focus] Windy window is active (Settings/UI) — skipping restore-to-target');
    return;
  }
  const targetPid = global._lastFocusedPid;
  const targetApp = global._lastFocusedApp;
  console.info(`[Focus] Mic access granted — restoring cursor to "${targetApp}" (pid ${targetPid})`);

  const restore = (label) => {
    execFile('osascript', ['-e',
      `tell application "System Events" to set frontmost of (first application process whose unix id is ${targetPid}) to true`
    ], { timeout: 1500 }, (err) => {
      if (!err) console.info(`[Focus] ✓ Cursor restored [${label}] to "${targetApp}" (pid ${targetPid})`);
    });
  };

  // Aggressive multi-pulse restore sequence:
  // - 0ms: Immediate (catches the getUserMedia steal)
  // - 150ms: Quick follow-up
  // - 400ms: AudioContext creation often steals focus here
  // - 800ms: Late AudioContext initialization catch
  // - 1500ms: Final safety net - ensures caret blink resumes
  // - 3000ms: Ultra-late catch for slow systems
  restore('immediate');
  setTimeout(() => restore('150ms'), 150);
  setTimeout(() => restore('400ms'), 400);
  setTimeout(() => restore('800ms'), 800);
  setTimeout(() => restore('1500ms'), 1500);
  setTimeout(() => restore('3000ms'), 3000);

  // ── Sustained focus keep-alive during recording ──
  // Every 5s, re-assert focus to keep the cursor blinking.
  // Some macOS apps lose caret blink if another process touches focus.
  if (global._focusKeepAlive) clearInterval(global._focusKeepAlive);
  const keepAliveStart = Date.now();
  global._focusKeepAlive = setInterval(() => {
    // Stop when recording + processing are done…
    if (!isRecording && !global._batchProcessing) {
      clearInterval(global._focusKeepAlive); global._focusKeepAlive = null; return;
    }
    // …or the instant the user is back in the Windy window (Settings/UI), so it can never
    // keep yanking focus away from a window the user is trying to use…
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocusable() && mainWindow.isFocused()) {
      clearInterval(global._focusKeepAlive); global._focusKeepAlive = null; return;
    }
    // …or after a 10-minute hard cap, so a stuck state can NEVER trap focus forever.
    if (Date.now() - keepAliveStart > 600000) {
      console.warn('[Focus] keepalive hit 10-min cap — stopping (safety)');
      clearInterval(global._focusKeepAlive); global._focusKeepAlive = null; return;
    }
    restore('keepalive');
  }, 5000);
});

// Batch transcription complete notification
ipcMain.on('batch-complete', (event, { wordCount }) => {
  // Sync main process state back to idle
  isRecording = false;
  global._batchProcessing = false; // Allow focus tracker to resume
  // Stop sustained focus keep-alive
  if (global._focusKeepAlive) {
    clearInterval(global._focusKeepAlive);
    global._focusKeepAlive = null;
  }
  // Update tray icon back to idle
  updateTrayIcon('idle');
  updateMiniState('idle');
  updateTrayMenu();
  if (tray) tray.setToolTip('Windy Word');

  // Show OS notification — ONLY for a real result. The batch teardown finally-block
  // also fires batch-complete with 0 (to clear the focus-keepalive state on every path);
  // without this gate that produced a spurious second "0 words captured" toast after
  // every successful transcription.
  if (wordCount > 0 && Notification.isSupported()) {
    const notification = new Notification({
      title: '✨ Transcription Ready!',
      body: `${wordCount} words captured and polished.`,
      silent: false
    });
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
  }
});

// Batch processing started — update tray to red
ipcMain.on('batch-processing', () => {
  isRecording = false; // Recording stopped, now processing
  global._batchProcessing = true; // Freeze focus tracker during processing
  updateTrayIcon('error'); // red = processing
  updateMiniState('processing');
  if (tray) tray.setToolTip('Windy Word — Processing transcription...');
});

// Recording failed in renderer — sync main state back to idle
ipcMain.on('recording-failed', () => {
  isRecording = false;
  global._batchProcessing = false;
  updateTrayMenu();
  updateTrayIcon('idle');
  updateMiniState('idle');
  if (tray) tray.setToolTip('Windy Word');
});

// Recording stopped via UI button (not hotkey) — sync main process state
// Keep _lastFocusedPid alive for async batch processing + auto-paste
ipcMain.on('recording-stopped', () => {
  isRecording = false;
  updateTrayMenu();
  updateTrayIcon('idle');
  updateMiniState('idle');
  if (tray) tray.setToolTip('Windy Word');
  console.info(`[Recording] Stopped via UI. PID preserved: "${global._lastFocusedApp || 'NONE'}" (pid ${global._lastFocusedPid || 'NONE'})`);
});

// Mirror of recording-stopped: the renderer notifies us when recording STARTS via the
// Record button (or mini button). Without this, main's isRecording stayed false after a
// button-start, so the ⌘⇧Space global hotkey's toggle flipped false→true and sent `true`
// — which the renderer (already recording) ignored, leaving recording stuck ON. Only sets
// isRecording=true; cannot regress the stop path.
ipcMain.on('recording-started', () => {
  isRecording = true;
  updateTrayMenu();
  updateTrayIcon('listening');
  updateMiniState('recording');
});

// Save file dialog
ipcMain.handle('save-file', async (event, { content, defaultName, defaultPath: dp, filters }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: dp || defaultName || 'transcript.txt',
      filters: filters || [{ name: 'Text', extensions: ['txt'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { ok: true, saved: true, path: result.filePath };
    }
    return { ok: false, saved: false };
  } catch (err) {
    console.error('[save-file] Error:', err.message);
    return { ok: false, saved: false, error: err.message };
  }
});

// Module-scope updater instance — assigned inside deferred startup setTimeout,
// read by install-update and check-for-updates handlers.
let updaterInstance = null;

ipcMain.handle('install-update', async () => {
  if (updaterInstance) {
    updaterInstance.installUpdate();
    return { ok: true };
  }
  return { ok: false, error: 'Updater not available' };
});

// Crash recovery — check for orphaned temp file
ipcMain.handle('check-crash-recovery', async () => {
  const tempFile = path.join(os.tmpdir(), 'windy_session.txt');
  if (fs.existsSync(tempFile)) {
    try {
      const content = fs.readFileSync(tempFile, 'utf-8');
      if (content.trim().length > 0) {
        return { found: true, content, path: tempFile };
      }
    } catch (e) { /* ignore read errors */ }
  }
  return { found: false };
});

ipcMain.handle('dismiss-crash-recovery', async () => {
  const tempFile = path.join(os.tmpdir(), 'windy_session.txt');
  try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
  return { success: true };
});

// App lifecycle

// ─── Global Security: Enforce navigation + permission policies on ALL webContents ───
app.on('web-contents-created', (event, contents) => {
  // Block navigation to non-local URLs (except checkout windows navigating to Stripe)
  contents.on('will-navigate', (navEvent, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      // Allow checkout windows (data: origin) to navigate to https (Stripe)
      const currentUrl = contents.getURL();
      if (parsed.protocol === 'https:' && (currentUrl.startsWith('data:') || currentUrl.includes('checkout.stripe.com'))) {
        console.info('[Security] Allowed checkout navigation to:', navigationUrl);
        return; // Allow
      }
      if (parsed.protocol !== 'file:') {
        console.warn('[Security] Blocked navigation to:', navigationUrl);
        navEvent.preventDefault();
      }
    } catch (e) {
      navEvent.preventDefault();
    }
  });

  // Block new window creation (popups)
  contents.setWindowOpenHandler(({ url }) => {
    // SEC-05: Validate URL before opening externally
    if (isSafeURL(url)) {
      shell.openExternal(url);
    } else {
      console.warn('[Security] Blocked window open:', url);
    }
    return { action: 'deny' };
  });
});

// Default permission handler — whitelist media + clipboard only
app.on('ready', () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ALLOWED = ['media', 'clipboard-read', 'clipboard-sanitized-write'];
    if (ALLOWED.includes(permission)) {
      callback(true);
    } else {
      console.warn('[Security] Denied permission:', permission);
      callback(false);
    }
  });
});

app.whenReady().then(async () => {
  _perfMark('app.whenReady()');

  // ── macOS microphone access (CRITICAL for dictation) ──────────────────────
  // The Chromium permission handler approves getUserMedia at the APP layer, but
  // that does NOT obtain the macOS OS-level (TCC) microphone grant. Without the
  // OS grant, CoreAudio hands the process SILENT audio — getUserMedia succeeds,
  // MediaRecorder records, but the result is empty ("No speech detected in
  // recording"). A signed app usually gets an automatic system prompt on first
  // device access; we must not rely on that. Explicitly ask the OS so the
  // permission dialog reliably appears on first run (and after updates).
  if (process.platform === 'darwin') {
    try {
      const { systemPreferences } = require('electron');
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.info('[Media] microphone access status at launch:', status);
      if (status !== 'granted') {
        systemPreferences.askForMediaAccess('microphone')
          .then((granted) => console.info('[Media] microphone access granted:', granted))
          .catch((e) => console.warn('[Media] askForMediaAccess(microphone) failed:', e?.message));
      }
      // Camera: do NOT pre-request at launch. Windy Word is a voice-to-text app, and an
      // unsolicited camera-permission dialog on first run reads as invasive to a
      // non-technical reader. Camera is only used by the opt-in "Save video recordings"
      // feature, so the OS prompt is deferred to first actual video use — getUserMedia
      // ({ video: true }) triggers the macOS TCC prompt naturally at that point. (Mic is
      // pre-requested above because an ungranted mic yields SILENT audio, a silent
      // failure; camera has no equivalent silent-failure mode.)
    } catch (e) {
      console.warn('[Media] media access check failed:', e?.message);
    }
  }

  // Clear file cache in dev mode to ensure fresh JS files
  if (process.argv.includes('--dev')) {
    try { await session.defaultSession.clearCache(); } catch (_) {}
  }
  // ═══════════════════════════════════════════════════════════════════
  // INSTALLATION WIZARD v2.0 — TurboTax-style 9-screen setup
  // Source: installer-v2/ (the ONLY wizard — there is no other)
  // WARNING: Do NOT load from installer/ — that is the DEPRECATED v1.
  //          v1 was archived on 27 Feb 2026. See DEPRECATED-installer-v1/
  // ═══════════════════════════════════════════════════════════════════
  const wizardPath = app.isPackaged
    ? path.join(process.resourcesPath, 'installer-v2', 'wizard-main')
    : path.join(__dirname, '..', '..', '..', 'installer-v2', 'wizard-main');
  const { InstallWizard } = require(wizardPath);
  const APP_DATA_DIR = path.join(os.homedir(), '.windy-pro');

  // When the book-launch fast path builds the engine venv on first run (async), defer
  // the initial Python-server start until the venv is ready (ensureEngineVenv restarts
  // it) — avoids a burst of failing bundled-Python attempts while pip runs.
  let deferPythonForVenv = false;
  if (InstallWizard.needsSetup(APP_DATA_DIR)) {
    // ── Book-launch fast path ─────────────────────────────────────────────────
    // The free Windy Word builds bundle every speech engine offline and have no
    // account/license/model-download, so the installer-v2 wizard's real job (pick +
    // download engines) is already done. Running its 10-screen flow on a launch-day
    // machine only adds failure surface (hardware scan, a paywall screen, a network
    // "install" step). When every engine this edition needs is already on disk, write
    // the same config.json the wizard's final step writes and boot straight in. The
    // in-app welcome panel (first-run.js) covers the only first-run touchpoint that
    // matters: the dictation hotkey + mic permission. installer-v2 is left fully
    // intact and simply never runs here. Reversible: nothing removed.
    try {
      const edition = require('./edition');
      const engines = Array.isArray(edition.ENGINES) ? edition.ENGINES : [];
      const userModelRoot = path.join(APP_DATA_DIR, 'model');
      const bundledModelRoot = process.resourcesPath
        ? path.join(process.resourcesPath, 'bundled', 'model') : '';
      const isBundled = (id) => {
        const dir = /-ct2$/.test(id) ? id : `faster-whisper-${id}`;
        if (fs.existsSync(path.join(userModelRoot, dir, 'model.bin'))) return true;
        return !!bundledModelRoot && fs.existsSync(path.join(bundledModelRoot, dir, 'model.bin'));
      };
      if (engines.length > 0 && engines.every(isBundled)) {
        fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(APP_DATA_DIR, 'config.json'), JSON.stringify({
          version: app.getVersion(),
          installedAt: new Date().toISOString(),
          models: engines,
          pairs: [],
          defaultModel: engines[0]
        }, null, 2));
        console.info(`[Main] Book-launch fast path: all ${engines.length} engines bundled — wizard skipped`);
      }
    } catch (e) {
      console.warn('[Main] Book-launch fast path skipped:', e.message);
    }
  }

  // Run the real installer-v2 wizard only if setup is STILL needed (i.e. engines must
  // be downloaded). The fast path above satisfies it for the bundled free builds.
  if (InstallWizard.needsSetup(APP_DATA_DIR)) {
    console.info('[Main] Wizard needed — launching setup wizard');
    // Load platform adapter for this OS
    let platformAdapter = null;
    try {
      const adapterPath = app.isPackaged
        ? path.join(process.resourcesPath, 'installer-v2', 'adapters')
        : path.join(__dirname, '..', '..', '..', 'installer-v2', 'adapters');
      const { getAdapter } = require(adapterPath);
      platformAdapter = getAdapter();
    } catch (e) {
      console.error('[Main] Platform adapter not loaded:', e.message);
    }
    const wizard = new InstallWizard({ platformAdapter });

    const completed = await wizard.show();
    console.info('[Main] Wizard completed:', completed);
    if (!completed) {
      app.quit();
      return;
    }
  }

  // Ensure the offline engine venv is healthy on EVERY launch — this is what self-heals a
  // venv left half-built by an interrupted/slow first run. It MUST run regardless of
  // config.json: needsSetup() only checks config.json (which is written before the async
  // build finishes), so gating this behind it would let an interrupted first build stay
  // bricked forever. Cheap no-op when the venv is already marked ready; returns true if a
  // (re)build started, in which case ensureEngineVenv() starts the server itself when ready.
  deferPythonForVenv = ensureEngineVenv(APP_DATA_DIR);
  if (!deferPythonForVenv) startPythonServer();
  createWindow();
  createTray();
  createMacOSMenu();  // macOS application menu bar (Cmd+Q, Cmd+H, Cmd+M, Edit menu)
  sanitizeHotkeys();  // Reset any accidentally-bound system shortcuts (e.g. Ctrl+V)
  startWaylandControlServer();  // Wayland: HTTP server on 127.0.0.1:18765 for GNOME-keybinding actions (no-op on other platforms)
  registerHotkeys();
  registerGnomeKeybindings();   // Wayland+GNOME: register hotkeys via gsettings → curl → control server (no-op on other platforms)
  startUserYdotoold();          // Wayland: spawn user-level ydotoold for paste injection (no-op on other platforms)
  _perfMark('Window + tray created');

  // ═══ macOS Continuous Focus Tracker (PID-based) ═══
  // Polls frontmost app every 500ms — tracks BOTH name and PID.
  // Window is non-focusable so we rarely capture ourselves, but we still
  // filter our own process tree to be safe.
  // KEEPS RUNNING during recording so user can move cursor freely.
  // Only pauses during batch processing (transcription) to lock paste target.
  if (process.platform === 'darwin') {
    global._lastFocusedApp = null;
    global._lastFocusedPid = null;
    global._focusGuardActive = false;
    const ourPid = process.pid;

    // Build set of our own PIDs (main + all Electron helper child processes)
    const _refreshOurPids = () => {
      try {
        const pgrepOut = execFileSync('pgrep', ['-P', String(ourPid)], { timeout: 500 }).toString().trim();
        pgrepOut.split('\n').forEach(p => { const n = parseInt(p, 10); if (n) global._ourPids.add(n); });
      } catch (_) { /* pgrep may fail if no children */ }
    };
    _refreshOurPids();
    // Re-scan child PIDs every 30s (new helper processes can spawn)
    setInterval(_refreshOurPids, 30000);

    global._focusTrackerInterval = setInterval(() => {
      // FREEZE during recording AND batch processing.
      // The PID captured just before recording starts is the paste target.
      // This is the proven approach — running the tracker during recording
      // causes rogue processes (e.g. this coding assistant) to corrupt the target.
      if (isRecording || global._batchProcessing) return;
      try {
        // Primary check: if any of OUR windows is focused, skip entirely.
        const { BrowserWindow } = require('electron');
        const focusedWin = BrowserWindow.getFocusedWindow();
        if (focusedWin) return; // Our app is focused — don't capture self

        // Query both name and PID of the frontmost process
        const result = execFileSync('osascript', ['-e',
          'tell application "System Events"\n' +
          '  set fp to first application process whose frontmost is true\n' +
          '  return (name of fp) & "|" & (unix id of fp)\n' +
          'end tell'
        ], { timeout: 1000 }).toString().trim();
        const sep = result.lastIndexOf('|');
        if (sep > 0) {
          const appName = result.substring(0, sep);
          const appPid = parseInt(result.substring(sep + 1), 10);
          // Skip our ENTIRE process tree (main + renderer + GPU + utility helpers)
          if (appPid && !global._ourPids.has(appPid)) {
            global._lastFocusedApp = appName;
            global._lastFocusedPid = appPid;
          }
        }
      } catch (_) { /* osascript timeout — skip this tick */ }
    }, 500); // 500ms = 2x faster for more responsive cursor tracking
    console.info(`[Focus] macOS PID-based focus tracker started (500ms poll, our pid=${ourPid}, tree pids=${[...global._ourPids].join(',')})`);
  }

  // macOS dark mode: forward system theme changes to renderer
  if (process.platform === 'darwin') {
    const sendTheme = () => {
      const isDark = nativeTheme.shouldUseDarkColors;
      safeSend('system-theme-changed', isDark ? 'dark' : 'light');
    };
    nativeTheme.on('updated', sendTheme);
    // Send initial theme after window loads
    mainWindow.webContents.on('did-finish-load', sendTheme);
  }

  // First-launch welcome: show 3-panel welcome on first run
  if (!store.get('hasSeenWelcome')) {
    mainWindow.webContents.on('did-finish-load', () => {
      safeSend('show-welcome');
    });
  }

  // IPC: dismiss welcome and mark as seen
  ipcMain.handle('dismiss-welcome', async () => {
    store.set('hasSeenWelcome', true);
    return { ok: true };
  });

  // ═══ Deferred startup tasks (non-critical — runs 3s after window appears) ═══
  // This keeps the window snappy: archive cleanup, license validation, model
  // migration, heartbeat, and update checks all run after first paint.
  // NOTE: updaterInstance is declared at module scope (before this function)
  // so that ipcMain.handle('install-update') can access it.
  setTimeout(() => {
    // Validate license (non-blocking)
    validateLicense().catch(e => console.error('[License] Validation error:', e.message));

    // Migrate unencrypted/legacy models to WMOD format (one-time, idempotent)
    migrateUnencryptedModels().catch(e => console.error('[Migration] Error:', e.message));

    // Start license heartbeat service
    try {
      const { HeartbeatService } = require('./heartbeat-service');
      const heartbeat = new HeartbeatService({
        store,
        safeStorage,
        retrieveLicenseToken,
        getDeviceFingerprint: () => getPairDownloadManager().getDeviceFingerprintHex(),
        appVersion: app.getVersion(),
        onLicenseLocked: () => {
          store.set('license.modelsLocked', true);
          safeSend('license-locked', { reason: 'grace_expired' });
          console.warn('[Heartbeat] Models locked — grace period expired');
        },
        onLicenseRestored: (tier) => {
          store.set('license.modelsLocked', false);
          store.set('license.tier', tier);
          // Reset download manager to pick up fresh key
          _pairDownloadManager = null;
          safeSend('license-restored', { tier });
          console.info('[Heartbeat] License restored — tier:', tier);
        },
        onLicenseRevoked: () => {
          store.set('license.modelsLocked', true);
          store.set('license.tier', 'free');
          // Delete all model files
          const pairsDir = path.join(app.getPath('userData'), 'translation-pairs');
          fsp.rm(pairsDir, { recursive: true, force: true }).catch(() => {});
          _pairDownloadManager = null;
          safeSend('license-revoked', { reason: 'revoked' });
          console.warn('[Heartbeat] License revoked — all models deleted');
        }
      });
      // Book-launch free build: license enforcement is OFF (edition.js), so the heartbeat
      // is never started — no phone-home, no offline-grace lockout, no revoke-delete.
      // The app must work forever, offline. Paid enforcement lives in a separate build only.
      if (require('./edition').LICENSE_ENFORCEMENT) {
        heartbeat.start();
      } else {
        console.info('[Main] License enforcement OFF (free book-launch build) — heartbeat not started');
      }
    } catch (e) {
      console.error('[Main] Heartbeat service skipped:', e.message);
    }

    // Auto-cleanup old archive media files (keeps transcripts forever)
    autoCleanupArchive();

    // Auto-update check (T16 — fail silently if no releases).
    // Skipped in the book-launch build: it's distributed via R2, not GitHub releases,
    // so checkForUpdates only 404s on latest-mac.yml and leaks an unhandled rejection
    // on every launch. Gated on the edition AUTO_UPDATE flag (reversible).
    try {
      if (require('./edition').AUTO_UPDATE === false) {
        console.info('[Main] Auto-updater disabled (book-launch build — distributed via R2, not GitHub releases)');
      } else {
        const { WindyUpdater } = require('./updater');
        updaterInstance = new WindyUpdater();
        Promise.resolve(updaterInstance.checkForUpdates()).catch((e) => console.warn('[Updater] check failed:', e?.message));
        // Periodic update check every 6 hours
        setInterval(() => {
          try { Promise.resolve(updaterInstance.checkForUpdates()).catch(() => {}); } catch (e) { /* silent */ }
        }, 6 * 60 * 60 * 1000);
      }
    } catch (e) {
      console.error('[Main] Auto-updater skipped:', e.message);
    }
    _perfMark('Deferred startup complete');
  }, 3000);

  // Manual update check from settings
  ipcMain.handle('check-for-updates', async () => {
    if (updaterInstance) {
      updaterInstance.forceCheck();
      return { ok: true };
    }
    return { ok: false, error: 'Updater not available' };
  });

  // Linux .deb in-app update: download + pkexec dpkg -i + restart
  ipcMain.handle('install-deb-update', async () => {
    const version = app.getVersion();
    const platform = process.platform;

    // Non-Linux: use electron-updater's built-in install
    if (platform !== 'linux') {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall();
      return { ok: true };
    }

    try {
      const https = require('https');
      const debUrl = `https://github.com/sneakyfree/windy-pro/releases/latest/download/windy-pro_${version}_amd64.deb`;
      const debPath = path.join(os.tmpdir(), 'windy-pro-update.deb');

      console.info(`[Updater] Downloading .deb from ${debUrl}...`);
      safeSend('update-toast', { message: '⬇️ Downloading update…', canRestart: false });

      // Download the .deb — follow redirects (GitHub returns 302)
      await new Promise((resolve, reject) => {
        const downloadWithRedirect = (url, depth = 0) => {
          if (depth > 5) return reject(new Error('Too many redirects'));
          const proto = url.startsWith('https') ? https : require('http');
          proto.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              return downloadWithRedirect(res.headers.location, depth + 1);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            }
            const file = fs.createWriteStream(debPath);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', reject);
          }).on('error', reject);
        };
        downloadWithRedirect(debUrl);
      });

      console.info(`[Updater] Downloaded to ${debPath}, installing with pkexec...`);
      safeSend('update-toast', { message: '🔐 Installing update (admin password required)…', canRestart: false });

      // Install with pkexec (graphical sudo prompt)
      // SEC-M10: Use execFileSync with array args for dpkg install
      const { execFileSync: execFileSyncDeb } = require('child_process');
      execFileSyncDeb('pkexec', ['dpkg', '-i', debPath], { timeout: 60000 });

      // Clean up and restart
      fs.unlinkSync(debPath);
      console.info('[Updater] .deb installed, restarting...');
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (err) {
      console.error('[Updater] .deb install failed:', err.message);
      // Fallback: try electron-updater's built-in
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall();
        return { ok: true, fallback: true };
      } catch (e) {
        return { ok: false, error: err.message };
      }
    }
  });

  app.on('activate', () => {
    // macOS: re-create window if dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on window close (keep in tray)
  // Only quit on explicit quit action
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  // Graceful Python server shutdown: SIGTERM → 3s → SIGKILL
  if (pythonProcess) {
    try {
      if (process.platform === 'win32') {
        // Windows: taskkill for clean shutdown
        spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t']);
      } else {
        pythonProcess.kill('SIGTERM');
        // Force kill after 3 seconds if still running
        const pid = pythonProcess.pid;
        setTimeout(() => {
          try { process.kill(pid, 'SIGKILL'); } catch (_) { /* already dead */ }
        }, 3000);
      }
    } catch (_) { /* ignore */ }
    pythonProcess = null;
  }
  // Unregister all hotkeys (only safe after app is ready)
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
  // Close the Wayland control server (Wayland-only; null on other platforms)
  if (_waylandControlServer) {
    try { _waylandControlServer.close(); } catch (_) { }
    _waylandControlServer = null;
  }
  // Stop the user-level ydotoold we spawned (if any)
  if (_ydotooldProc) {
    try { _ydotooldProc.kill(); } catch (_) { }
    _ydotooldProc = null;
  }
});
// ═══════════════════════════════════════════════════════════════════
// Wave 12 B4 — deep-link URL schemes
// ═══════════════════════════════════════════════════════════════════
//
// Register the four ecosystem URL schemes so macOS / Windows / Linux
// route `windypro://…`, `windychat://…`, `windyword://…`, `windyfly://…`
// to this Electron app. Runtime registration via
// setAsDefaultProtocolClient covers the dev `npm start` case where the
// .app bundle's Info.plist has not yet been generated by
// electron-builder; the build-time registration lives in package.json's
// `build.protocols` array and lands in CFBundleURLTypes on packaged
// macOS builds.
//
// Incoming links arrive on two different events depending on platform:
//   - macOS: `open-url` when the app is already running, or from argv
//            on cold-boot launch via "open windypro://…"
//   - Linux/Windows: `second-instance` with the URL in the additional
//                    argv array (because the OS launches a new process
//                    that immediately loses to the single-instance lock)
//
// Both paths funnel into handleDeepLink() which parses the URL and
// routes to the right renderer view. We deliberately DO NOT exec any
// code from the URL — only read its scheme + path + query and send a
// typed IPC to the renderer, which decides what to do with it.
const WINDY_PROTOCOL_SCHEMES = ['windypro', 'windychat', 'windyword', 'windyfly'];
for (const scheme of WINDY_PROTOCOL_SCHEMES) {
  try {
    // On dev (process.execPath === electron) Electron registers
    // correctly when given the current argv[1] hint. On packaged
    // builds the plist entry is authoritative and this call is a
    // no-op. Failure is non-fatal — log and continue so a missing
    // registration doesn't prevent the app from starting.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(scheme);
    }
  } catch (e) {
    console.warn(`[DeepLink] setAsDefaultProtocolClient(${scheme}) failed:`, e?.message || e);
  }
}

/**
 * Parse and route an incoming deep-link URL to the correct renderer view.
 * Safe to call with untrusted input — we only forward parsed fields to
 * the renderer via a typed IPC, never shell-exec or navigate to the URL.
 */
function handleDeepLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return;
  if (!WINDY_PROTOCOL_SCHEMES.some(s => rawUrl.startsWith(`${s}://`))) {
    console.warn('[DeepLink] Unknown scheme, ignoring:', rawUrl.slice(0, 40));
    return;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    console.warn('[DeepLink] Malformed URL, ignoring:', e?.message || e);
    return;
  }
  const payload = {
    scheme: parsed.protocol.replace(':', ''),   // 'windypro', 'windychat', ...
    host:   parsed.hostname,                     // 'room', 'hatch', 'settings'…
    path:   parsed.pathname,                     // everything after the host
    query:  Object.fromEntries(parsed.searchParams.entries()),
    url:    rawUrl,
  };
  console.info('[DeepLink] Routing', payload.scheme + '://' + payload.host + payload.path);

  // Focus the main window so the user actually sees whatever the
  // renderer does with the link.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('windy:deep-link', payload);
  } else {
    // App is still booting — queue the link for delivery once the
    // window is created. `createWindow()` drains this queue.
    pendingDeepLinks.push(payload);
  }
}
const pendingDeepLinks = [];

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Prevent multiple instances (with stale lock cleanup)
const gotLock = app.requestSingleInstanceLock();

// ═══════════════════════════════════════════
//  PREMIUM FEATURES — IPC Handlers
// ═══════════════════════════════════════════

// ─── Translation Memory (SQLite-backed) ───
const tmDbPath = path.join(os.homedir(), '.config', 'windy-pro', 'translation-memory.db');
let tmDb = null;

function getTMDb() {
  if (tmDb) return tmDb;
  try {
    const Database = require('better-sqlite3');
    ensureDir(path.dirname(tmDbPath));
    tmDb = new Database(tmDbPath);
    tmDb.exec(`
      CREATE TABLE IF NOT EXISTS translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        hits INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tm_lookup ON translations(source_lang, target_lang, source);
    `);
    return tmDb;
  } catch (err) {
    console.error('[TM] Database init error:', err.message);
    return null;
  }
}

ipcMain.handle('save-translation-memory', async (event, { source, target, sourceLang, targetLang }) => {
  const db = getTMDb();
  if (!db) return { success: false };
  try {
    const existing = db.prepare('SELECT id, hits FROM translations WHERE source = ? AND source_lang = ? AND target_lang = ?')
      .get(source.substring(0, 500), sourceLang, targetLang);
    if (existing) {
      db.prepare('UPDATE translations SET target = ?, hits = hits + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(target.substring(0, 2000), existing.id);
    } else {
      db.prepare('INSERT INTO translations (source, target, source_lang, target_lang) VALUES (?, ?, ?, ?)')
        .run(source.substring(0, 500), target.substring(0, 2000), sourceLang, targetLang);
    }
    return { success: true };
  } catch (err) {
    console.error('[TM] Save error:', err.message);
    return { success: false };
  }
});

ipcMain.handle('lookup-translation-memory', async (event, text, sourceLang, targetLang) => {
  const db = getTMDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT target AS translation, hits FROM translations WHERE source = ? AND source_lang = ? AND target_lang = ?')
      .get(text.substring(0, 500), sourceLang, targetLang);
    return row || null;
  } catch { return null; }
});

ipcMain.handle('get-translation-memory-stats', async () => {
  const db = getTMDb();
  if (!db) return { totalEntries: 0, topPairs: [], recentEntries: [] };
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM translations').get().count;
    const topPairs = db.prepare('SELECT source_lang, target_lang, COUNT(*) as count FROM translations GROUP BY source_lang, target_lang ORDER BY count DESC LIMIT 10').all();
    const recent = db.prepare('SELECT source, target, source_lang AS sourceLang, target_lang AS targetLang, hits, created_at FROM translations ORDER BY updated_at DESC LIMIT 50').all();
    return { totalEntries: total, topPairs, recentEntries: recent };
  } catch { return { totalEntries: 0, topPairs: [], recentEntries: [] }; }
});

ipcMain.handle('clear-translation-memory', async () => {
  const db = getTMDb();
  if (!db) return;
  try { db.prepare('DELETE FROM translations').run(); } catch { }
});

// ─── Voice Clone Management ───
const vcDbPath = path.join(os.homedir(), '.config', 'windy-pro', 'voice-clones.json');
const vcAudioDir = path.join(os.homedir(), '.config', 'windy-pro', 'voice-samples');

function loadVoiceClones() {
  try {
    ensureDir(vcAudioDir);
    if (fs.existsSync(vcDbPath)) return JSON.parse(fs.readFileSync(vcDbPath, 'utf8'));
    return { clones: [], activeId: null };
  } catch { return { clones: [], activeId: null }; }
}

function saveVoiceClones(data) {
  try {
    ensureDir(path.dirname(vcDbPath));
    fs.writeFileSync(vcDbPath, JSON.stringify(data, null, 2));
  } catch (err) { console.error('[VC] Save error:', err.message); }
}

ipcMain.handle('get-voice-clones', async () => loadVoiceClones());

ipcMain.handle('create-voice-clone', async (event, name, base64Audio, duration) => {
  const data = loadVoiceClones();
  const id = require('crypto').randomUUID();
  const audioPath = path.join(vcAudioDir, `${id}.webm`);
  ensureDir(vcAudioDir);
  fs.writeFileSync(audioPath, Buffer.from(base64Audio, 'base64'));
  const clone = { id, name, duration, audioPath, status: 'ready', created_at: new Date().toISOString() };
  data.clones.push(clone);
  saveVoiceClones(data);
  return { success: true, clone };
});

ipcMain.handle('delete-voice-clone', async (event, id) => {
  const data = loadVoiceClones();
  const clone = data.clones.find(c => c.id === id);
  if (clone?.audioPath && fs.existsSync(clone.audioPath)) {
    const resolved = path.resolve(clone.audioPath);
    if (resolved.startsWith(path.resolve(vcAudioDir))) {
      fs.unlinkSync(resolved);
    }
  }
  data.clones = data.clones.filter(c => c.id !== id);
  if (data.activeId === id) data.activeId = null;
  saveVoiceClones(data);
  return { success: true };
});

ipcMain.handle('set-active-voice-clone', async (event, id) => {
  const data = loadVoiceClones();
  data.activeId = id;
  saveVoiceClones(data);
  return { success: true };
});

ipcMain.handle('preview-voice-clone', async (event, id) => {
  const data = loadVoiceClones();
  const clone = data.clones.find(c => c.id === id);
  if (!clone?.audioPath || !fs.existsSync(clone.audioPath)) return { success: false };
  const audioData = fs.readFileSync(clone.audioPath).toString('base64');
  return { success: true, audioData, mimeType: 'audio/webm' };
});

ipcMain.handle('upload-voice-clone-file', async (event, name) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Voice Sample',
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'webm', 'ogg', 'm4a'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { success: false };
  const srcPath = result.filePaths[0];
  const data = loadVoiceClones();
  const id = require('crypto').randomUUID();
  const ext = path.extname(srcPath);
  const destPath = path.join(vcAudioDir, `${id}${ext}`);
  ensureDir(vcAudioDir);
  fs.copyFileSync(srcPath, destPath);
  const clone = { id, name, audioPath: destPath, status: 'ready', created_at: new Date().toISOString() };
  data.clones.push(clone);
  saveVoiceClones(data);
  return { success: true, clone };
});

// ─── Word→Clone wire (ADR-045 Phase 2) ───
// Submit a locally-recorded clone to Windy Clone's POST /api/v1/orders for
// ElevenLabs training. The clone metadata holds cloud_order_id + cloud_status
// so the UI can poll until ready. Override target via WINDY_CLONE_API_URL.

const CLONE_API_DEFAULT_URL = 'https://api.windyclone.ai';

// Shared implementation for the submit-voice-clone-to-cloud IPC handler AND
// the agent control surface HTTP endpoint (POST /clones/cloud/submit). The
// two callers want identical semantics — same auth, same audit fields written
// back to the local clones DB — so they go through one function rather than
// two slightly-divergent copies.
async function _submitVoiceCloneToCloud(cloneId) {
  try {
    const data = loadVoiceClones();
    const clone = data.clones.find(c => c.id === cloneId);
    if (!clone || !clone.audioPath || !fs.existsSync(clone.audioPath)) {
      return { ok: false, error: 'Clone audio not found.' };
    }
    if (clone.cloud_order_id) {
      return {
        ok: false,
        error: 'Already submitted to Windy Clone.',
        cloud_order_id: clone.cloud_order_id,
      };
    }
    const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
    if (!token) return { ok: false, error: 'Sign in to your Windy account first.' };

    const audioBytes = fs.readFileSync(clone.audioPath);
    const audioBase64 = audioBytes.toString('base64');
    const cloneApiUrl = process.env.WINDY_CLONE_API_URL || CLONE_API_DEFAULT_URL;
    const postData = JSON.stringify({
      provider_id: 'elevenlabs',
      clone_type: 'voice',
      audio_base64: audioBase64,
      audio_duration_seconds: clone.duration || null,
      sample_name: clone.name || null,
    });
    const url = new URL(`${cloneApiUrl}/api/v1/orders`);
    const https = require('https');
    const result = await new Promise((resolve) => {
      const req = https.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { /* non-JSON response */ }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', err => resolve({ statusCode: 0, body: { detail: err.message } }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 0, body: { detail: 'Request timed out' } });
      });
      req.write(postData);
      req.end();
    });

    if (result.statusCode === 200 && result.body?.order_id) {
      clone.cloud_order_id = result.body.order_id;
      clone.cloud_status = result.body.status || 'pending';
      clone.cloud_submitted_at = new Date().toISOString();
      saveVoiceClones(data);
      return { ok: true, order_id: result.body.order_id, status: clone.cloud_status };
    }
    return {
      ok: false,
      error: result.body?.detail || `Windy Clone returned HTTP ${result.statusCode}.`,
      statusCode: result.statusCode,
    };
  } catch (err) {
    console.error('[VC] submit-to-cloud error:', err && err.message);
    return { ok: false, error: err && err.message };
  }
}

ipcMain.handle('submit-voice-clone-to-cloud', async (event, cloneId) => _submitVoiceCloneToCloud(cloneId));

ipcMain.handle('get-cloud-clone-order-status', async (event, orderId) => {
  try {
    const token = store.get('auth.token', '') || store.get('auth.storageToken', '');
    if (!token) return { ok: false, error: 'Not signed in.' };
    const cloneApiUrl = process.env.WINDY_CLONE_API_URL || CLONE_API_DEFAULT_URL;
    const url = new URL(`${cloneApiUrl}/api/v1/orders/${encodeURIComponent(orderId)}`);
    const https = require('https');
    const result = await new Promise((resolve) => {
      const req = https.get({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { /* non-JSON */ }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', () => resolve({ statusCode: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0 }); });
    });
    if (result.statusCode === 200 && result.body) {
      // Mirror the latest status onto the local clone row so subsequent
      // loads of the manager show fresh state without re-polling.
      const data = loadVoiceClones();
      const clone = data.clones.find(c => c.cloud_order_id === orderId);
      if (clone) {
        clone.cloud_status = result.body.status;
        clone.cloud_progress = result.body.progress;
        clone.cloud_error_message = result.body.error_message || null;
        if (result.body.status === 'completed' || result.body.status === 'failed') {
          clone.cloud_completed_at = new Date().toISOString();
        }
        saveVoiceClones(data);
      }
      return {
        ok: true,
        status: result.body.status,
        progress: result.body.progress,
        error_message: result.body.error_message || null,
      };
    }
    return { ok: false, statusCode: result.statusCode };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Document Text Extraction ───
ipcMain.handle('extract-document-text', async (event, base64, ext) => {
  try {
    const buf = Buffer.from(base64, 'base64');
    if (ext === 'txt' || ext === 'md') {
      return { text: buf.toString('utf8') };
    }
    if (ext === 'html') {
      return { text: buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
    }
    if (ext === 'pdf') {
      const str = buf.toString('latin1');
      const textParts = [];
      const regex = /\(([^)]+)\)/g;
      let match;
      while ((match = regex.exec(str)) !== null) {
        if (match[1].length > 2 && /[a-zA-Z]/.test(match[1])) textParts.push(match[1]);
      }
      return { text: textParts.join(' ') || '[PDF text extraction — for best results, copy text from PDF]' };
    }
    if (ext === 'docx') {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(buf);
        const docXml = zip.readAsText('word/document.xml');
        return { text: docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
      } catch { return { text: '[DOCX extraction requires adm-zip package]' }; }
    }
    return { text: '' };
  } catch (err) {
    return { text: `[Error: ${err.message}]` };
  }
});

ipcMain.handle('browse-document-file', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Document',
      filters: [{ name: 'Documents', extensions: ['txt', 'md', 'html', 'pdf', 'docx', 'csv'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    // Binary formats: return file path for PDFs (renderer uses pdf.js or similar),
    // base64 for other binary formats like DOCX
    if (ext === '.pdf') {
      return { filePath, name: path.basename(filePath), ext, encoding: 'path' };
    }
    if (ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      return { data: buffer.toString('base64'), encoding: 'base64', name: path.basename(filePath), ext };
    }
    // Text formats (.txt, .md, .csv, .html): read as UTF-8
    const text = fs.readFileSync(filePath, 'utf8');
    return { text, name: path.basename(filePath) };
  } catch (err) {
    console.error('[browse-document-file] Error:', err.message);
    return { error: err.message };
  }
});

// ═══ Clone Data Bundle Management ═══
const bundlesDir = path.join(os.homedir(), '.config', 'windy-pro', 'clone-bundles');
const bundlesManifest = path.join(os.homedir(), '.config', 'windy-pro', 'clone-bundles.json');

function loadBundlesManifest() {
  try {
    ensureDir(bundlesDir);
    if (fs.existsSync(bundlesManifest)) return JSON.parse(fs.readFileSync(bundlesManifest, 'utf8'));
    return { bundles: [] };
  } catch { return { bundles: [] }; }
}

function saveBundlesManifest(data) {
  try {
    ensureDir(path.dirname(bundlesManifest));
    fs.writeFileSync(bundlesManifest, JSON.stringify(data, null, 2));
  } catch (err) { console.error('[Bundles] Save error:', err.message); }
}

ipcMain.handle('save-clone-bundle', async (event, bundleData) => {
  const data = loadBundlesManifest();
  const id = bundleData.bundle_id || require('crypto').randomUUID();
  const mediaPath = path.join(bundlesDir, `${id}.webm`);
  ensureDir(bundlesDir);

  // Save media file
  if (bundleData.mediaBase64) {
    fs.writeFileSync(mediaPath, Buffer.from(bundleData.mediaBase64, 'base64'));
  }

  const bundle = {
    bundle_id: id,
    duration_seconds: bundleData.duration_seconds || 0,
    audio: bundleData.audio || { format: 'opus', file: `${id}.webm` },
    video: bundleData.video || null,
    transcript: bundleData.transcript || { text: '', segments: [] },
    device: bundleData.device || { platform: 'desktop', app_version: '2.0' },
    sync_status: 'local',
    clone_training_ready: bundleData.clone_training_ready || false,
    file_path: mediaPath,
    file_size: bundleData.mediaBase64 ? Buffer.from(bundleData.mediaBase64, 'base64').length : 0,
    created_at: new Date().toISOString()
  };

  data.bundles.push(bundle);
  saveBundlesManifest(data);
  return { success: true, bundle_id: id };
});

ipcMain.handle('get-clone-bundles', async () => loadBundlesManifest());

ipcMain.handle('delete-clone-bundle', async (event, bundleId) => {
  const data = loadBundlesManifest();
  const bundle = data.bundles.find(b => b.bundle_id === bundleId);
  if (bundle?.file_path && fs.existsSync(bundle.file_path)) {
    const resolved = path.resolve(bundle.file_path);
    if (resolved.startsWith(path.resolve(bundlesDir))) {
      fs.unlinkSync(resolved);
    }
  }
  data.bundles = data.bundles.filter(b => b.bundle_id !== bundleId);
  saveBundlesManifest(data);
  return { success: true };
});

ipcMain.handle('play-clone-bundle', async (event, bundleId) => {
  const data = loadBundlesManifest();
  const bundle = data.bundles.find(b => b.bundle_id === bundleId);
  if (!bundle?.file_path || !fs.existsSync(bundle.file_path)) return { success: false };
  const audioData = fs.readFileSync(bundle.file_path).toString('base64');
  return { success: true, audioData, mimeType: bundle.video ? 'video/webm' : 'audio/webm', bundle };
});

ipcMain.handle('export-clone-bundles', async (event, bundleIds) => {
  const data = loadBundlesManifest();
  const selected = data.bundles.filter(b => bundleIds.includes(b.bundle_id));
  if (selected.length === 0) return { success: false };

  const result = await dialog.showSaveDialog({
    title: 'Export Clone Bundles',
    defaultPath: `clone-bundles-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return { success: false };

  const exportData = {
    exported_at: new Date().toISOString(),
    bundle_count: selected.length,
    bundles: selected.map(b => ({
      ...b,
      file_path: undefined, // Don't expose local paths
      mediaBase64: fs.existsSync(b.file_path) ? fs.readFileSync(b.file_path).toString('base64') : null
    }))
  };
  fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
  return { success: true, exportPath: result.filePath };
});

ipcMain.handle('start-clone-training', async (event, bundleIds) => {
  // Clone training is not yet available — offer export instead
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Windy Clone — Coming Soon',
    message: 'Clone training is coming soon!\n\nWould you like to export your selected bundles as a voice data package instead?\n\nYou can use the exported package with ElevenLabs, PlayHT, or any voice cloning service.',
    buttons: ['Export Package', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    // Directly invoke the export-clone-bundles handler logic
    const data = loadBundlesManifest();
    const selected = data.bundles.filter(b => bundleIds.includes(b.bundle_id));
    if (selected.length === 0) return { success: false, error: 'No bundles found' };

    const saveResult = await dialog.showSaveDialog({
      title: 'Export Clone Bundles',
      defaultPath: `clone-bundles-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (saveResult.canceled) return { success: false };

    const exportData = {
      exported_at: new Date().toISOString(),
      bundle_count: selected.length,
      bundles: selected.map(b => ({
        ...b,
        file_path: undefined,
        mediaBase64: fs.existsSync(b.file_path) ? fs.readFileSync(b.file_path).toString('base64') : null
      }))
    };
    fs.writeFileSync(saveResult.filePath, JSON.stringify(exportData, null, 2));
    return { success: true, exportPath: saveResult.filePath };
  }
  return { status: 'export_ready', message: 'Clone training coming soon. Use Export Clone Package to export your voice data.' };
});

// ═══ Auto-Sync IPC Handlers ═══
const syncStatePath = path.join(os.homedir(), '.config', 'windy-pro', 'sync-state.json');

ipcMain.handle('get-sync-state', async () => {
  try {
    if (fs.existsSync(syncStatePath)) return JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
    return { lastSync: 0, uploadQueue: [], devices: {} };
  } catch { return { lastSync: 0, uploadQueue: [], devices: {} }; }
});

ipcMain.handle('save-sync-state', async (event, state) => {
  try {
    ensureDir(path.dirname(syncStatePath));
    fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
    return { success: true };
  } catch { return { success: false }; }
});

ipcMain.handle('fetch-remote-bundles', async (event, since) => {
  try {
    const token = store.get('auth.storageToken', '') || store.get('auth.token', '');
    if (!token) return { bundles: [] };

    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      const req = https.get(`${CLOUD_STORAGE_DEFAULT_URL}/files`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve({ ok: false }); }
        });
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    });

    if (!data?.ok) return { bundles: [] };

    // Map cloud storage files to bundle format
    const bundles = (data.files || []).map(f => ({
      bundle_id: f.id,
      id: f.id,
      file_size: f.size,
      type: f.type,
      originalName: f.name,
      uploadedAt: f.uploadedAt,
      sessionDate: f.sessionDate,
      sync_status: 'cloud_synced'
    }));

    return { bundles, storageUsed: data.storageUsed, storageLimit: data.storageLimit };
  } catch { return { bundles: [] }; }
});

ipcMain.handle('download-remote-bundle', async (event, bundleId) => {
  try {
    const token = store.get('auth.storageToken', '') || store.get('auth.token', '');
    if (!token) return { success: false };

    const https = require('https');
    const chunks = [];
    const result = await new Promise((resolve, reject) => {
      const req = https.get(`${CLOUD_STORAGE_DEFAULT_URL}/files/${bundleId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
      }, (res) => {
        if (res.statusCode !== 200) return resolve({ success: false });
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ success: true, mediaBase64: buffer.toString('base64') });
        });
      });
      req.on('error', () => resolve({ success: false }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    });

    return result;
  } catch { return { success: false }; }
});

ipcMain.handle('upload-bundle-to-cloud', async (event, bundleData) => {
  try {
    const token = store.get('auth.storageToken', '') || store.get('auth.token', '');
    if (!token) return { success: false, error: 'Not authenticated' };

    const FormData = require('form-data');
    const form = new FormData();
    form.append('type', bundleData.type || 'transcript');

    if (bundleData.sessionDate) form.append('sessionDate', bundleData.sessionDate);
    if (bundleData.metadata) form.append('metadata', JSON.stringify(bundleData.metadata || {}));

    // Attach the file
    if (bundleData.file_path && fs.existsSync(bundleData.file_path)) {
      form.append('file', fs.createReadStream(bundleData.file_path));
    } else if (bundleData.buffer) {
      form.append('file', Buffer.from(bundleData.buffer), {
        filename: bundleData.filename || 'upload.bin',
        contentType: bundleData.contentType || 'application/octet-stream'
      });
    } else if (bundleData.text) {
      // Upload text content (transcript)
      form.append('file', Buffer.from(bundleData.text, 'utf-8'), {
        filename: bundleData.filename || 'transcript.txt',
        contentType: 'text/plain'
      });
    } else {
      return { success: false, error: 'No file data' };
    }

    const https = require('https');
    const url = new URL(`${CLOUD_STORAGE_DEFAULT_URL}/files/upload`);

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          ...form.getHeaders()
        },
        timeout: 60000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve({ success: false }); }
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Upload timeout' }); });
      form.pipe(req);
    });

    return result;
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('show-sync-notification', async (event, message) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    new Notification({ title: 'Windy Word Sync', body: message, icon: undefined }).show();
  }
  return { success: true };
});

ipcMain.handle('get-storage-stats', async () => {
  try {
    let localSize = 0;
    const manifest = loadBundlesManifest();
    for (const bundle of manifest.bundles) {
      if (bundle.file_path && fs.existsSync(bundle.file_path)) {
        localSize += fs.statSync(bundle.file_path).size;
      }
    }

    // Query live R2-backed cloud-storage API for cloud usage
    let cloudSize = 0;
    let cloudTier = 'free';
    let cloudLimit = 500 * 1024 * 1024;
    let cloudFileCount = 0;
    try {
      const storageToken = store.get('auth.storageToken', '') || store.get('auth.token', '');
      const storageUserId = store.get('auth.storageUserId', '');
      if (storageToken && storageUserId) {
        const https = require('https');
        const usageData = await new Promise((resolve) => {
          const req = https.get(`${CLOUD_STORAGE_DEFAULT_URL}/usage/${storageUserId}`, {
            headers: { 'Authorization': `Bearer ${storageToken}` },
            timeout: 5000
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch { resolve(null); }
            });
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => { req.destroy(); resolve(null); });
        });
        if (usageData?.ok) {
          cloudSize = usageData.usage.totalBytes || 0;
          cloudTier = usageData.usage.tier || 'free';
          cloudLimit = usageData.usage.limitBytes || cloudLimit;
          cloudFileCount = usageData.usage.fileCount || 0;
        }
      }
    } catch { /* cloud service unavailable */ }

    return {
      local: localSize,
      cloud: cloudSize,
      cloudTier,
      cloudLimit,
      cloudFileCount,
      bundleCount: manifest.bundles.length
    };
  } catch { return { local: 0, cloud: 0, bundleCount: 0 }; }
});

ipcMain.handle('delete-local-bundle-copy', async (event, bundleId) => {
  const manifest = loadBundlesManifest();
  const bundle = manifest.bundles.find(b => b.bundle_id === bundleId);
  if (!bundle?.file_path || !fs.existsSync(bundle.file_path)) return { freed: 0 };
  const resolved = path.resolve(bundle.file_path);
  if (!resolved.startsWith(path.resolve(bundlesDir))) return { freed: 0 };
  const size = fs.statSync(resolved).size;
  fs.unlinkSync(resolved);
  bundle.file_path = null;
  bundle.sync_status = 'cloud_only';
  saveBundlesManifest(manifest);
  return { freed: size };
});


if (!gotLock) {
  console.info('[Main] Another instance is running. Quitting.');
  app.quit();
} else {
  // Cold-boot case on Linux/Windows: the URL is in process.argv of the
  // first instance too. Scan once now so the link is queued before the
  // renderer loads; macOS uses open-url for this path and hits the
  // handler directly, which also queues via handleDeepLink().
  {
    const coldBootLink = process.argv.find(a =>
      typeof a === 'string' &&
      WINDY_PROTOCOL_SCHEMES.some(s => a.startsWith(`${s}://`)),
    );
    if (coldBootLink) handleDeepLink(coldBootLink);
  }

  app.on('second-instance', (_event, argv) => {
    // On Linux/Windows a "windypro://…" launch starts a second process
    // that immediately loses the single-instance lock — the URL is
    // handed to us here via argv. Scan for any of our schemes and
    // route through the same deep-link pipeline as macOS's open-url.
    const deepLink = (argv || []).find(a =>
      typeof a === 'string' &&
      WINDY_PROTOCOL_SCHEMES.some(s => a.startsWith(`${s}://`)),
    );
    if (deepLink) handleDeepLink(deepLink);

    // Focus existing window (always — this is also the "already
    // running, launch me again" path with no URL).
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
