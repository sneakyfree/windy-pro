// Prevent EPIPE crashes when stdout/stderr pipe breaks
process.stdout?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

// Global crash handler — log to ~/.config/windy-pro/crash.log
const _fs = require('fs');
const _path = require('path');
const _os = require('os');
const crashLogPath = _path.join(_os.homedir(), '.config', 'windy-pro', 'crash.log');

function writeCrashLog(type, err) {
  try {
    const dir = _path.dirname(crashLogPath);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    // Redact API keys from error messages
    let msg = String(err?.stack || err?.message || err);
    msg = msg.replace(/Bearer\s+\S+/gi, 'Bearer ***REDACTED***');
    msg = msg.replace(/sk-[a-zA-Z0-9]+/g, 'sk-***');
    msg = msg.replace(/key[_-]?[a-zA-Z0-9]{10,}/gi, 'KEY_REDACTED');
    const entry = `[${new Date().toISOString()}] ${type}: ${msg}\n`;
    _fs.appendFileSync(crashLogPath, entry);
  } catch (_) { }
}

process.on('uncaughtException', (err) => {
  writeCrashLog('UncaughtException', err);
  console.error('[CRASH]', err.message);
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('UnhandledRejection', reason);
  console.error('[REJECTION]', String(reason));
});
/**
 * Windy Pro - Electron Main Process
 * 
 * Creates a floating, always-on-top window with:
 * - System tray integration
 * - Global hotkeys
 * - WebSocket connection to Python backend
 * 
 * DNA Strand: B1.1
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, dialog, Notification, shell, session } = require('electron');

// Fix: bake in --no-sandbox for Linux AppImage (chrome-sandbox SUID issue)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}
// Enable Web Speech API support
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
const path = require('path');
const Store = require('electron-store');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { CursorInjector } = require('./injection/injector');
const { WindyUpdater } = require('./updater');

// Safe IPC send — guards against disposed render frames
function safeSend(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Cursor injection module
const injector = new CursorInjector();

// Persistent settings storage
const store = new Store({
  defaults: {
    hotkeys: {
      toggleRecording: 'CommandOrControl+Shift+Space',
      pasteTranscript: 'CommandOrControl+Shift+V',
      showHide: 'CommandOrControl+Shift+W'
    },
    window: {
      width: 400,
      height: 300,
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
    engine: {
      model: 'base',
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
let tray = null;
let isRecording = false;
let pythonProcess = null;
let pythonRestartCount = 0;
const MAX_PYTHON_RESTARTS = 3;

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
            // Persist to electron-store so it works on subsequent launches without .env
            if (m[1] === 'STRIPE_SECRET_KEY') store.set('stripe.secretKey', m[2].trim());
          }
        }
        break;
      }
    }
  } catch (_) { }
})();
// Secret key: env var → electron-store → empty
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || store.get('stripe.secretKey', '');
const STRIPE_PRICES = {
  pro: { id: 'price_1T5oYzBXIOBasDQibSlnIsPg', mode: 'payment', tier: 'pro', amount: 4900 },
  translate: { id: 'price_1T5oZJBXIOBasDQiHO0MtYS7', mode: 'payment', tier: 'translate', amount: 7900 },
  translate_monthly: { id: 'price_1T5oZJBXIOBasDQijBW23Gow', mode: 'subscription', tier: 'translate', amount: 799 },
  translate_pro: { id: 'price_1T5oZ1BXIOBasDQinrz3VdvG', mode: 'payment', tier: 'translate_pro', amount: 14900 }
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
    free: { maxEngines: 3, maxLanguages: 1, maxMinutes: 5, batchMode: false, llmPolish: false, translation: false, tts: false, glossaries: false },
    pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: 30, batchMode: true, llmPolish: true, translation: false, tts: false, glossaries: false },
    translate: { maxEngines: 15, maxLanguages: 99, maxMinutes: 30, batchMode: true, llmPolish: true, translation: true, tts: false, glossaries: false },
    translate_pro: { maxEngines: 15, maxLanguages: 99, maxMinutes: 30, batchMode: true, llmPolish: true, translation: true, tts: true, glossaries: true }
  };
  return tiers[tier] || tiers.free;
}

function getArchiveFolder() {
  return store.get('engine.archiveFolder') || path.join(os.homedir(), 'Documents', 'WindyProArchive');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendArchiveEntry({ text, startedAt, endedAt }) {
  const engine = store.get('engine', {});
  if (!engine.autoArchive || !engine.archiveLocalEnabled || !text || !text.trim()) return { archived: false };

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
  const meta = `Start: ${start.toISOString()}\nEnd: ${end.toISOString()}\nWords: ${safeText.split(/\s+/).filter(Boolean).length}`;

  const wrote = [];

  if (mode === 'chunk' || mode === 'both') {
    const chunkPath = path.join(dayDir, `${timeKey}.md`);
    const chunk = `# Windy Pro Dictation\n\n${meta}\n\n---\n\n${safeText}\n`;
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
}

/**
 * Start the Python WebSocket server as a child process
 */
function startPythonServer() {
  const serverConfig = store.get('server');
  const appDataDir = path.join(os.homedir(), '.windy-pro');
  const venvPython = process.platform === 'win32'
    ? path.join(appDataDir, 'venv', 'Scripts', 'python.exe')
    : path.join(appDataDir, 'venv', 'bin', 'python');

  const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', '..');
  const serverModule = app.isPackaged ? 'engine.server' : 'src.engine.server';

  console.log(`[Python] Starting server with: ${pythonPath}`);
  console.log(`[Python] cwd: ${projectRoot}, module: ${serverModule}`);

  // Kill any stale process on the server port before spawning
  const port = serverConfig.port || 9876;
  try {
    if (process.platform === 'win32') {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do taskkill /PID %a /F 2>nul`, { stdio: 'pipe', timeout: 5000 });
    } else {
      const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`, { timeout: 5000 }).toString().trim();
      if (pids) {
        for (const pid of pids.split('\n')) {
          if (pid.trim()) {
            console.log(`[Python] Killing stale process ${pid} on port ${port}`);
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
    console.log(`[Performance] Using "${modelSize}" model — runtime monitoring will check if it keeps up`);
  }

  pythonProcess = spawn(pythonPath, [
    '-m', serverModule,
    '--host', serverConfig.host,
    '--port', String(serverConfig.port),
    '--model', modelSize
  ], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  pythonProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`[Python] ${msg}`);
    // Detect server ready
    if (msg.includes('Waiting for connections') || msg.includes('Server running')) {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        safeSend('python-loading', false);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Python] Server exited with code ${code}`);
    pythonProcess = null;

    // Auto-restart on unexpected exit with exponential backoff
    if (code !== 0 && !app.isQuitting && pythonRestartCount < MAX_PYTHON_RESTARTS) {
      pythonRestartCount++;
      const delay = 3000 * pythonRestartCount; // 3s, 6s, 9s...
      console.log(`[Python] Auto-restarting in ${delay}ms (attempt ${pythonRestartCount}/${MAX_PYTHON_RESTARTS})...`);
      setTimeout(() => startPythonServer(), delay);
    } else if (code !== 0 && pythonRestartCount >= MAX_PYTHON_RESTARTS) {
      console.error('[Python] Max restarts reached. Server will not restart.');
      if (mainWindow) {
        safeSend('state-change', 'error');
        safeSend('python-loading', false);
      }
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

  mainWindow = new BrowserWindow({
    width: windowConfig.width,
    height: windowConfig.height,
    x: windowConfig.x,
    y: windowConfig.y,

    // Floating window properties
    alwaysOnTop: appearance.alwaysOnTop,
    frame: false,           // Frameless for custom UI
    transparent: true,      // Allow CSS transparency for strobe effect
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,

    // Minimum size
    minWidth: 250,
    minHeight: 150,

    // Web preferences
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required'
    },

    // Visual
    backgroundColor: '#00000000',  // Transparent
    hasShadow: true,
    opacity: appearance.opacity,

    // Platform specific
    titleBarStyle: 'hidden',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // CSP Headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' ws://127.0.0.1:* wss://*.thewindstorm.uk https://*.thewindstorm.uk https://api.deepgram.com https://api.groq.com https://api.openai.com wss://api.deepgram.com; " +
          "img-src 'self' data:; " +
          "media-src 'self' blob:;"
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
    // Only forward errors, not debug spam — prevents EPIPE on stdout
    if (level >= 2) {  // 2 = warning, 3 = error
      try { console.log(`[Renderer] ${message}`); } catch (_) { }
    }
  });

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
function saveWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  store.set('window', bounds);
}

/**
 * Create system tray
 */
function createTray() {
  // Create tray icon (green circle for now, will be replaced with proper icon)
  const iconSize = process.platform === 'darwin' ? 16 : 32;
  const icon = createTrayIcon('idle', iconSize);

  tray = new Tray(icon);
  tray.setToolTip('Windy Pro - Click to show');

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
      label: '📜 History',
      click: () => {
        mainWindow.show();
        safeSend('open-history');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Windy Pro',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
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
  const winSize = tornadoSize + 4;
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

  // Forward state + size after load
  miniWindow.webContents.on('did-finish-load', () => {
    updateMiniState(isRecording ? 'recording' : 'idle');
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('mini-resize', tornadoSize);

      // Linux: can't do transparent, so round it visually with CSS border-radius
      // (setShape breaks mouse events). The dark bg is styled in mini-widget.html.
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
ipcMain.on('mini-move', (event, { dx, dy }) => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    const [x, y] = miniWindow.getPosition();
    const nx = x + dx, ny = y + dy;
    miniWindow.setPosition(nx, ny);
    store.set('tornadoX', nx);
    store.set('tornadoY', ny);
  }
});

// Forward voice levels from renderer to mini widget
let _voiceLevelLogCount = 0;
ipcMain.on('voice-level', (event, level) => {
  if (_voiceLevelLogCount < 5 && level > 0.05) {
    console.log(`[VoiceLevel→Mini] level=${level.toFixed(3)} miniWindow=${!!miniWindow}`);
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

// ═══════════════════════════════════════════
//  VIDEO PREVIEW WINDOW (independent, draggable)
// ═══════════════════════════════════════════

let videoWindow = null;

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

// Show video preview
ipcMain.handle('show-video-preview', async () => {
  const win = createVideoWindow();
  win.show();
  return { ok: true };
});

// Relay video frames from main renderer to video preview window
ipcMain.on('video-frame-to-preview', (event, dataUrl) => {
  if (videoWindow && !videoWindow.isDestroyed() && !videoWindow.webContents.isDestroyed()) {
    videoWindow.webContents.send('video-frame', dataUrl);
  }
});

// Relay recording state to video preview window
ipcMain.on('recording-state-to-preview', (event, state) => {
  if (videoWindow && !videoWindow.isDestroyed() && !videoWindow.webContents.isDestroyed()) {
    videoWindow.webContents.send('recording-state', state);
  }
});

// Hide video preview (only on close button or explicit dismiss)
ipcMain.handle('hide-video-preview', async () => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('stop-camera');
    videoWindow.hide();
  }
  return { ok: true };
});

// Resize video preview
ipcMain.on('resize-video-preview', (event, w, h) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.setSize(Math.round(w), Math.round(h));
  }
});

// Resize + reposition (for corners that need position adjustment)
ipcMain.on('resize-move-video-preview', (event, w, h, x, y) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (x !== null && y !== null) {
      videoWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: rw, height: rh });
    } else if (x !== null) {
      const bounds = videoWindow.getBounds();
      videoWindow.setBounds({ x: Math.round(x), y: bounds.y, width: rw, height: rh });
    } else if (y !== null) {
      const bounds = videoWindow.getBounds();
      videoWindow.setBounds({ x: bounds.x, y: Math.round(y), width: rw, height: rh });
    } else {
      videoWindow.setSize(rw, rh);
    }
  }
});

// ═══ Main-process mouse polling for resize (bypasses Electron pointer capture limits) ═══
let resizeInterval = null;
ipcMain.on('start-resize-video', (event, corner, startScreenX, startScreenY, startW, startH, startWinX, startWinY) => {
  if (resizeInterval) clearInterval(resizeInterval);
  const { screen } = require('electron');
  resizeInterval = setInterval(() => {
    if (!videoWindow || videoWindow.isDestroyed()) { clearInterval(resizeInterval); resizeInterval = null; return; }
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - startScreenX;
    let newW, newX, newY;
    switch (corner) {
      case 'br':
        newW = Math.max(160, Math.min(800, startW + dx));
        break;
      case 'bl':
        newW = Math.max(160, Math.min(800, startW - dx));
        newX = startWinX + (startW - newW);
        break;
      case 'tr':
        newW = Math.max(160, Math.min(800, startW + dx));
        break;
      case 'tl':
        newW = Math.max(160, Math.min(800, startW - dx));
        newX = startWinX + (startW - newW);
        break;
    }
    const newH = Math.round(newW * 9 / 16);
    if (corner === 'tr' || corner === 'tl') {
      newY = startWinY + (startH - newH);
    }
    const rw = Math.round(newW);
    const rh = Math.round(newH);
    if (newX !== undefined && newY !== undefined) {
      videoWindow.setBounds({ x: Math.round(newX), y: Math.round(newY), width: rw, height: rh });
    } else if (newX !== undefined) {
      const b = videoWindow.getBounds();
      videoWindow.setBounds({ x: Math.round(newX), y: b.y, width: rw, height: rh });
    } else if (newY !== undefined) {
      const b = videoWindow.getBounds();
      videoWindow.setBounds({ x: b.x, y: Math.round(newY), width: rw, height: rh });
    } else {
      videoWindow.setSize(rw, rh);
    }
    // Send size back to renderer for label
    try { videoWindow.webContents.send('resize-feedback', rw, rh); } catch (_) { }
  }, 16); // ~60fps
});

ipcMain.on('stop-resize-video', () => {
  if (resizeInterval) { clearInterval(resizeInterval); resizeInterval = null; }
});

// Close video preview
ipcMain.on('close-video-preview', () => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('stop-camera');
    videoWindow.hide();
  }
});

// ═══════════════════════════════════════════
//  FONT SIZE CONTROL
// ═══════════════════════════════════════════

ipcMain.handle('get-font-size', async () => {
  return store.get('appearance.fontSize') || 100;
});

ipcMain.handle('set-font-size', async (event, percent) => {
  const clamped = Math.max(70, Math.min(150, percent));
  store.set('appearance.fontSize', clamped);
  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('font-size-changed', clamped);
  }
  return clamped;
});

// ═══════════════════════════════════════════
//  MINI TRANSLATE WINDOW (floating quick-translate)
// ═══════════════════════════════════════════

function showMiniTranslateWindow() {
  if (miniTranslateWindow && !miniTranslateWindow.isDestroyed()) {
    miniTranslateWindow.show();
    miniTranslateWindow.focus();
    return;
  }

  miniTranslateWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: '#1F2937',
    minWidth: 300,
    minHeight: 200,
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
    miniTranslateWindow.hide();
  }
});

// Mini-translate IPC text translation
ipcMain.handle('mini-translate-text', async (event, text, sourceLang, targetLang) => {
  const https = require('https');
  const token = store.get('license.cloudToken') || '';
  const postData = JSON.stringify({ text, sourceLang, targetLang });

  return new Promise((resolve, reject) => {
    const req = https.request('https://windypro.thewindstorm.uk/api/v1/translate/text', {
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
          reject(new Error('Invalid response'));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
});

/**
 * Register global hotkeys
 */
function registerHotkeys() {
  if (!app.isReady()) return;
  const hotkeys = store.get('hotkeys');

  // Toggle recording
  const regToggle = globalShortcut.register(hotkeys.toggleRecording, () => {
    toggleRecording();
  });
  console.log(`[Hotkey] Toggle recording (${hotkeys.toggleRecording}): ${regToggle ? 'OK' : 'FAILED'}`);

  // Paste transcript
  const regPaste = globalShortcut.register(hotkeys.pasteTranscript, () => {
    pasteTranscript();
  });
  console.log(`[Hotkey] Paste transcript (${hotkeys.pasteTranscript}): ${regPaste ? 'OK' : 'FAILED'}`);

  // Show/hide window — three-state cycle: Full Window → Tornado → Hidden → Full Window
  const regShow = globalShortcut.register(hotkeys.showHide, () => {
    const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    const miniVisible = miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible();

    if (mainVisible) {
      // State 1 → State 2: Full window → Tornado
      mainWindow.hide();
      showMiniWidget();
    } else if (miniVisible) {
      // State 2 → State 3: Tornado → Hidden (everything gone)
      miniWindow.hide();
    } else {
      // State 3 → State 1: Hidden → Full window
      mainWindow.show();
      mainWindow.focus();
    }
  });
  console.log(`[Hotkey] Show/Hide (${hotkeys.showHide}): ${regShow ? 'OK' : 'FAILED'}`);

  // Quick Translate hotkey (Ctrl+Shift+T)
  const regTranslate = globalShortcut.register('CommandOrControl+Shift+T', () => {
    showMiniTranslateWindow();
  });
  console.log(`[Hotkey] Quick Translate (Ctrl+Shift+T): ${regTranslate ? 'OK' : 'FAILED'}`);
}

/**
 * Toggle recording state
 */
function toggleRecording() {
  isRecording = !isRecording;
  safeSend('toggle-recording', isRecording);
  updateTrayMenu();
  updateTrayIcon(isRecording ? 'listening' : 'idle');

  // Update mini widget state if it's visible (don't force-show it)
  updateMiniState(isRecording ? 'recording' : 'idle');

  // Update tray icon color based on state
  if (tray) {
    tray.setToolTip(isRecording ? 'Windy Pro - Recording...' : 'Windy Pro');
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
  if (transcript && transcript.trim()) {
    safeSend('state-change', 'injecting');
    updateTrayIcon('injecting');

    // Hide Windy Pro window so focus returns to the previous app
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }

    // Small delay to let the OS switch focus
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      await injector.inject(transcript);
    } catch (error) {
      console.error('Injection failed:', error.message);
      safeSend('injection-error', error.message);
    }

    // Show window again after paste WITHOUT stealing focus
    // so the user can proofread and hit Enter in their chat app
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.showInactive();  // Show without taking focus
      }
      const newState = isRecording ? 'listening' : 'idle';
      safeSend('state-change', newState);
      updateTrayIcon(newState);
    }, 500);
  }
});

// Check injection permissions
ipcMain.handle('check-injection-permissions', async () => {
  return injector.checkPermissions();
});

// Update settings — accepts flat keys from renderer and routes to correct store namespace
ipcMain.on('update-settings', (event, settings) => {
  const appearanceKeys = ['alwaysOnTop', 'opacity'];
  const serverKeys = ['host', 'port'];
  const hotkeyKeys = ['toggleRecording', 'pasteTranscript', 'showHide'];

  for (const [key, value] of Object.entries(settings)) {
    if (appearanceKeys.includes(key)) {
      store.set(`appearance.${key}`, key === 'opacity' ? value / 100 : value);
      if (key === 'alwaysOnTop' && mainWindow) mainWindow.setAlwaysOnTop(value);
      if (key === 'opacity' && mainWindow) mainWindow.setOpacity(value / 100);
    } else if (serverKeys.includes(key)) {
      store.set(`server.${key}`, value);
    } else if (hotkeyKeys.includes(key)) {
      store.set(`hotkeys.${key}`, value);
      if (app.isReady()) {
        globalShortcut.unregisterAll();
        registerHotkeys();
      }
    } else {
      // Engine settings (model, device, language, vibeEnabled, micDeviceId)
      store.set(`engine.${key}`, value);
    }
  }
});

// Get app version from package.json
ipcMain.handle('get-app-version', () => app.getVersion());

// Get settings — returns flat keys for the renderer
ipcMain.handle('get-settings', () => {
  return {
    ...store.get('appearance'),
    ...store.get('server'),
    ...store.get('engine', {}),
    hotkeys: store.get('hotkeys')
  };
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
        console.log(`[Archive] Migrated ${copied} files from ${oldFolder} to ${selected}`);
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

ipcMain.handle('open-external-url', async (event, url) => {
  console.log('[Main] open-external-url called with:', url);
  // Security: validate URL with URL parser — reject non-https schemes
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      console.warn('[Main] Blocked non-https external URL:', url);
      return { ok: false, error: 'Only HTTPS URLs are allowed' };
    }
  } catch (e) {
    console.warn('[Main] Invalid URL:', url);
    return { ok: false, error: 'Invalid URL' };
  }

  // Use Electron's shell.openExternal — avoids spawn/exec injection risk
  try {
    await shell.openExternal(url);
    console.log('[Main] ✅ Opened URL via shell.openExternal');
    return { ok: true };
  } catch (e) {
    console.error('[Main] ❌ shell.openExternal failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('batch-transcribe-local', async (event, base64Audio) => {
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');

  const tmpDir = os.tmpdir();
  const webmPath = `${tmpDir}/windy-batch-${Date.now()}.webm`;
  const wavPath = `${tmpDir}/windy-batch-${Date.now()}.wav`;

  try {
    // Save base64 audio to temp file
    const buffer = Buffer.from(base64Audio, 'base64');
    fs.writeFileSync(webmPath, buffer);

    // Find ffmpeg — check bundled location (.windy-pro), userData, then PATH
    const path = require('path');
    const os = require('os');
    const appDataDir = app.getPath('userData');
    const homeDataDir = path.join(os.homedir(), '.windy-pro');
    let ffmpegCmd = 'ffmpeg';
    const ffmpegExeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegSearchPaths = [
      path.join(homeDataDir, 'ffmpeg', ffmpegExeName),
      path.join(appDataDir, 'ffmpeg', ffmpegExeName),
      path.join(path.dirname(process.execPath), ffmpegExeName),
    ];
    for (const fp of ffmpegSearchPaths) {
      if (fs.existsSync(fp)) {
        ffmpegCmd = `"${fp}"`;
        break;
      }
    }

    // Convert to WAV using ffmpeg
    const devnull = process.platform === 'win32' ? '2>NUL' : '2>/dev/null';
    execSync(`${ffmpegCmd} -y -i "${webmPath}" -ar 16000 -ac 1 -acodec pcm_s16le "${wavPath}" ${devnull}`);

    // Find the Python venv — check multiple locations
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
    const pythonPath = venvPaths.find(p => fs.existsSync(p)) || (process.platform === 'win32' ? 'python' : 'python3');
    console.log('[Batch] Using python:', pythonPath);

    // Run faster-whisper transcription via temp script
    const modelName = store.get('engine.model') || 'base';
    // Check for bundled model first
    const localModelDir = path.join(os.homedir(), '.windy-pro', 'model', `faster-whisper-${modelName}`);
    let bundledModelDir = '';
    if (process.resourcesPath) {
      bundledModelDir = path.join(process.resourcesPath, 'bundled', 'model', `faster-whisper-${modelName}`);
    }
    let modelRef = `"${modelName}"`;
    if (fs.existsSync(path.join(localModelDir, 'model.bin'))) {
      modelRef = `"${localModelDir.replace(/\\/g, '/')}"`;
    } else if (bundledModelDir && fs.existsSync(path.join(bundledModelDir, 'model.bin'))) {
      modelRef = `"${bundledModelDir.replace(/\\/g, '/')}"`;
    }
    const scriptPath = `${tmpDir}/windy-batch-transcribe-${Date.now()}.py`;
    const scriptContent = [
      'from faster_whisper import WhisperModel',
      `model = WhisperModel(${modelRef}, device="cpu", compute_type="int8")`,
      `segments, info = model.transcribe("${wavPath.replace(/\\/g, '/')}", language="en", beam_size=5, condition_on_previous_text=True, vad_filter=True, no_speech_threshold=0.6)`,
      'text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())',
      'print(text)'
    ].join('\n');
    fs.writeFileSync(scriptPath, scriptContent);

    const result = execSync(`${pythonPath} "${scriptPath}"`, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    });

    try { fs.unlinkSync(scriptPath); } catch (_) { }

    return result.toString().trim();
  } catch (err) {
    console.error('[Batch Local] Error:', err.message);
    throw new Error(`Local transcription failed: ${err.message}`);
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(webmPath); } catch (_) { }
    try { fs.unlinkSync(wavPath); } catch (_) { }
  }
});

ipcMain.handle('auto-paste-text', async (event, text) => {
  if (!text || !text.trim()) return false;
  try {
    const { clipboard } = require('electron');
    clipboard.writeText(text.trim());

    // Briefly hide the window so the previously-active app regains focus
    const wasAlwaysOnTop = mainWindow && mainWindow.isAlwaysOnTop();
    if (mainWindow && mainWindow.isVisible()) {
      if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(false);
      mainWindow.hide();
    }
    // Wait for the previous app to regain focus
    await new Promise(r => setTimeout(r, 400));

    // Simulate Ctrl+V at current cursor position in the now-active app
    if (process.platform === 'linux') {
      require('child_process').execSync('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 });
    } else if (process.platform === 'darwin') {
      require('child_process').execSync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', { timeout: 5000 });
    } else {
      // Windows — use PowerShell
      require('child_process').execSync('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"', { timeout: 5000 });
    }

    // Re-show the window WITHOUT stealing focus so the user can hit Enter in their app
    await new Promise(r => setTimeout(r, 300));
    if (mainWindow) {
      mainWindow.showInactive();  // showInactive = don't steal focus from the target app
      if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(true);
    }
    console.log(`[AutoPaste] Pasted ${text.trim().length} chars to cursor, window re-shown (inactive)`);
    return true;
  } catch (err) {
    // On failure, still re-show the window
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
    console.error('[AutoPaste] Failed:', err.message);
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
        const mdFiles = allFiles.filter(f => f.endsWith('.md') && f !== `${dateDir}.md`).sort().reverse();
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
                /^(Start|End|Words|Engine|Time|Date|Duration):\s/.test(line);
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
  const archiveBase = store.get('archiveFolder') || path.join(os.homedir(), 'Windy Pro');
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(archiveBase);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
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

// ── Windy Pro Cloud Storage helpers ──────────────────────────────
const CLOUD_STORAGE_DEFAULT_URL = 'http://192.168.4.126:8099'; // OC5 iMac

async function getCloudStorageToken() {
  const engine = store.get('engine', {});
  if (engine.cloudStorageToken) return engine.cloudStorageToken;

  // Auto-register/login with storage API using existing cloud credentials
  const email = engine.cloudEmail;
  const password = engine.cloudPassword;
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
      console.log(`[CloudStorage] Authenticated via ${endpoint}`);
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

    // Windy Pro Cloud upload
    if (route === 'cloud' || route === 'local_cloud') {
      cloud.attempted = true;
      const engine = store.get('engine', {});
      const cloudToken = await getCloudStorageToken();
      const cloudUrl = engine.cloudStorageUrl || CLOUD_STORAGE_DEFAULT_URL;

      if (!cloudToken) {
        cloud.error = 'Not logged in to Windy Pro Cloud (set email/password in Settings)';
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

    console.log('[Archive] Saved:', (res.files || []).join(', '), route, cloud.ok ? '+ cloud ✓' : '');
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
    console.log(`[Archive] Audio saved: ${audioPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
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
    console.log(`[Archive] Video saved: ${videoPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
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

// ═══ Archive Stats & Export IPC Handlers ═══

ipcMain.handle('get-archive-stats', async () => {
  try {
    const archiveRoot = getArchiveFolder();
    if (!fs.existsSync(archiveRoot)) return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0 };
    let totalFiles = 0, totalSize = 0, days = new Set();
    let audioBytes = 0, videoBytes = 0, totalWords = 0, totalSessions = 0, totalChars = 0;
    const items = fs.readdirSync(archiveRoot);
    for (const item of items) {
      const itemPath = path.join(archiveRoot, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        days.add(item);
        const files = fs.readdirSync(itemPath);
        for (const file of files) {
          totalFiles++;
          try {
            const fSize = fs.statSync(path.join(itemPath, file)).size;
            totalSize += fSize;
            if (file.endsWith('.webm') && file.includes('-video')) {
              videoBytes += fSize;
            } else if (file.endsWith('.webm') || file.endsWith('.wav')) {
              audioBytes += fSize;
            } else if (file.endsWith('.md') && file !== `${item}.md`) {
              totalSessions++;
              try {
                const content = fs.readFileSync(path.join(itemPath, file), 'utf-8');
                // Strip frontmatter lines (starting with #, **, ---)
                const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
                const text = textLines.join(' ').trim();
                const words = text.split(/\s+/).filter(Boolean).length;
                totalWords += words;
                totalChars += text.length;
              } catch (_) { }
            }
          } catch (_) { }
        }
      }
    }
    // Estimate hours from file sizes (opus webm ~16KB/s, video ~100KB/s)
    const audioHours = (audioBytes / 1024 / 16) / 3600;
    const videoHours = (videoBytes / 1024 / 100) / 3600;
    return {
      totalFiles, totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10,
      days: days.size,
      audioHours: Math.round(audioHours * 100) / 100,
      videoHours: Math.round(videoHours * 100) / 100,
      totalWords, totalSessions, totalChars
    };
  } catch (err) {
    return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0, error: err.message };
  }
});

ipcMain.handle('export-soul-file', async () => {
  // TODO: Full soul file export (transcripts + voice data + metadata)
  return { ok: false, error: 'Soul File Export coming in v0.7.0' };
});

ipcMain.handle('export-voice-clone', async () => {
  // TODO: Export audio recordings formatted for voice cloning services
  return { ok: false, error: 'Voice Clone Export coming in v0.7.0' };
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

  // Detect NVIDIA GPU
  try {
    const { execSync } = require('child_process');
    const gpuInfo = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
    if (gpuInfo) {
      const [name, vramMB] = gpuInfo.split(', ');
      result.gpu = { name: name.trim(), vramMB: parseInt(vramMB) || 0, type: 'cuda' };
    }
  } catch (_) {
    // No NVIDIA GPU or nvidia-smi not available
  }

  // Check disk space
  try {
    const { execSync } = require('child_process');
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
      const drive = homeDir.charAt(0);
      const out = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`, { timeout: 3000 }).toString();
      const match = out.match(/FreeSpace=(\d+)/);
      if (match) result.diskFreeGB = Math.round(parseInt(match[1]) / (1024 * 1024 * 1024));
    } else {
      const out = execSync(`df -BG "${homeDir}" | tail -1 | awk '{print $4}'`, { timeout: 3000 }).toString().trim();
      result.diskFreeGB = parseInt(out) || null;
    }
  } catch (_) { }

  // Engine recommendation
  if (result.gpu && result.gpu.vramMB >= 6000) {
    result.recommendedEngine = 'core-ultra';
    result.recommendation = `Your ${result.gpu.name} (${Math.round(result.gpu.vramMB / 1024)}GB VRAM) can run the best model. We recommend Core Ultra for maximum accuracy.`;
  } else if (result.gpu && result.gpu.vramMB >= 2000) {
    result.recommendedEngine = 'core-standard';
    result.recommendation = `Your ${result.gpu.name} has ${Math.round(result.gpu.vramMB / 1024)}GB VRAM. We recommend Core Standard for a great balance of speed and quality.`;
  } else if (result.totalRAM >= 16) {
    result.recommendedEngine = 'edge-standard';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Edge Standard — great accuracy on CPU, no GPU needed.`;
  } else if (result.totalRAM >= 8) {
    result.recommendedEngine = 'edge-pulse';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Edge Pulse — fast and light, perfect for your hardware.`;
  } else {
    result.recommendedEngine = 'edge-spark';
    result.recommendation = `Your system has ${result.totalRAM}GB RAM. We recommend Edge Spark — ultra-light, runs great on any hardware.`;
  }

  return result;
});

ipcMain.handle('register-wizard-account', async (event, { email, password, name }) => {
  try {
    const https = require('http');
    const data = JSON.stringify({ email, password, name });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: '192.168.4.126',
        port: 8099,
        path: '/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
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
              store.set('engine.cloudPassword', password);
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
        const content = `[Desktop Entry]\nType=Application\nName=Windy Pro\nExec=${appPath}\nIcon=windy-pro\nComment=Voice-to-text transcription\nX-GNOME-Autostart-enabled=true\nStartupNotify=false\n`;
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
      success_url: 'https://windypro.thewindstorm.uk/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://windypro.thewindstorm.uk/payment-cancel',
      allow_promotion_codes: true,
      metadata: { deviceId: machineId, tier: priceConfig.tier }
    };
    if (email) sessionParams.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    console.log(`[Stripe] Checkout session created: ${session.id} for tier=${priceConfig.tier}`);
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[Stripe] Checkout session error:', err.message);
    return { ok: false, error: err.message };
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
      // Update license in store
      store.set('license', {
        tier,
        email: session.customer_email || session.customer_details?.email || '',
        stripeSessionId: sessionId,
        purchasedAt: new Date().toISOString(),
        expiresAt: session.mode === 'subscription' ? null : null // one-time = never expires
      });
      console.log(`[Stripe] Payment confirmed! Tier upgraded to: ${tier}`);
    }

    return { ok: true, paid, tier, status: session.payment_status };
  } catch (err) {
    console.error('[Stripe] Payment check error:', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-current-tier', async () => {
  const license = store.get('license') || { tier: 'free' };
  const limits = getTierLimits(license.tier);
  return { tier: license.tier, limits, license };
});

// ═══ Text Translation via AI (Groq/OpenAI) ═══
ipcMain.handle('translate-text', async (event, text, sourceLang, targetLang) => {
  if (!text || !targetLang) return { ok: false, error: 'Missing text or target language' };

  const LANG_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
    ru: 'Russian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', hi: 'Hindi',
    auto: 'auto-detected'
  };
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;

  // Try Groq first, then OpenAI
  const groqKey = store.get('engine.groqApiKey', '') || process.env.GROQ_API_KEY || '';
  const openaiKey = store.get('engine.openaiApiKey', '') || process.env.OPENAI_API_KEY || '';

  const apiKey = groqKey || openaiKey;
  if (!apiKey) {
    return { ok: false, error: 'No AI API key configured. Add a Groq or OpenAI API key in Settings → Transcription Engine.' };
  }

  const isGroq = !!groqKey;
  const apiUrl = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

  const prompt = `Translate the following text from ${srcName} to ${tgtName}. Return ONLY the translated text, nothing else.\n\n${text}`;

  try {
    const https = require('https');
    const url = new URL(apiUrl);
    const postData = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
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
            } catch (e) {
              reject(new Error('Failed to parse AI response'));
            }
          } else {
            reject(new Error(`AI API returned ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('AI API timeout')); });
      req.write(postData);
      req.end();
    });

    console.log(`🌐 Text translation (${result.engine}): ${srcName}→${tgtName}`);
    return result;
  } catch (err) {
    console.error('[Translate] AI text translation failed:', err.message);
    return { ok: false, error: err.message };
  }
});

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

// Batch transcription complete notification
ipcMain.on('batch-complete', (event, { wordCount }) => {
  // Update tray icon back to idle
  updateTrayIcon('idle');
  updateMiniState('idle');
  updateTrayMenu();

  // Show OS notification
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: '✨ Transcription Ready!',
      body: `${wordCount || 0} words captured and polished.`,
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
  updateTrayIcon('error'); // red = processing
  updateMiniState('processing');
  if (tray) tray.setToolTip('Windy Pro — Processing transcription...');
});

// Recording failed in renderer — sync main state back to idle
ipcMain.on('recording-failed', () => {
  isRecording = false;
  updateTrayMenu();
  updateTrayIcon('idle');
  updateMiniState('idle');
  if (tray) tray.setToolTip('Windy Pro');
});

// Save file dialog
ipcMain.handle('save-file', async (event, { content, defaultName, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'transcript.txt',
    filters: filters || [{ name: 'Text', extensions: ['txt'] }]
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  }
  return { ok: false };
});

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
  // Block navigation to non-local URLs
  contents.on('will-navigate', (navEvent, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    if (parsed.protocol !== 'file:') {
      console.warn('[Security] Blocked navigation to:', navigationUrl);
      navEvent.preventDefault();
    }
  });

  // Block new window creation (popups)
  contents.setWindowOpenHandler(({ url }) => {
    // Allow https links via shell.openExternal instead
    if (url.startsWith('https://')) {
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
  console.log('[Main] needsSetup:', InstallWizard.needsSetup(APP_DATA_DIR));
  if (InstallWizard.needsSetup(APP_DATA_DIR)) {
    console.log('[Main] Wizard needed — launching setup wizard');
    // Load platform adapter for this OS
    let platformAdapter = null;
    try {
      const adapterPath = app.isPackaged
        ? path.join(process.resourcesPath, 'installer-v2', 'adapters')
        : path.join(__dirname, '..', '..', '..', 'installer-v2', 'adapters');
      const { getAdapter } = require(adapterPath);
      platformAdapter = getAdapter();
    } catch (e) {
      console.log('[Main] Platform adapter not loaded:', e.message);
    }
    const wizard = new InstallWizard({ platformAdapter });
    console.log('[Main] Wizard created, showing...');
    const completed = await wizard.show();
    console.log('[Main] Wizard completed:', completed);
    if (!completed) {
      app.quit();
      return;
    }
  }

  startPythonServer();
  createWindow();
  createTray();
  registerHotkeys();

  // Auto-update check (T16 — fail silently if no releases)
  let updaterInstance = null;
  try {
    updaterInstance = new WindyUpdater();
    updaterInstance.checkForUpdates();
    // Periodic update check every 6 hours
    setInterval(() => {
      try { updaterInstance.checkForUpdates(); } catch (e) { /* silent */ }
    }, 6 * 60 * 60 * 1000);
  } catch (e) {
    console.log('[Main] Auto-updater skipped:', e.message);
  }

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
      const debPath = '/tmp/windy-pro-update.deb';

      console.log(`[Updater] Downloading .deb from ${debUrl}...`);
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

      console.log(`[Updater] Downloaded to ${debPath}, installing with pkexec...`);
      safeSend('update-toast', { message: '🔐 Installing update (admin password required)…', canRestart: false });

      // Install with pkexec (graphical sudo prompt)
      const { execSync } = require('child_process');
      execSync(`pkexec dpkg -i "${debPath}"`, { timeout: 60000 });

      // Clean up and restart
      fs.unlinkSync(debPath);
      console.log('[Updater] .deb installed, restarting...');
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
  const result = await dialog.showOpenDialog({
    title: 'Select Document',
    filters: [{ name: 'Documents', extensions: ['txt', 'md', 'html', 'pdf', 'docx', 'csv'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const text = fs.readFileSync(filePath, 'utf8');
  return { text, name: path.basename(filePath) };
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
  // Stub: call account server API
  try {
    const settings = store.get('server', {});
    const token = store.get('auth.token', '');
    const baseUrl = settings.url || 'http://localhost:8098';
    const res = await require('node-fetch')(`${baseUrl}/api/v1/clone/start-training`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ bundle_ids: bundleIds })
    });
    return await res.json();
  } catch (err) {
    // Fallback: return stub job ID
    return { jobId: require('crypto').randomUUID(), status: 'queued', message: 'Training queued (offline mode)' };
  }
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
    const settings = store.get('server', {});
    const token = store.get('auth.token', '');
    const baseUrl = settings.url || 'http://localhost:8098';
    const res = await require('node-fetch')(`${baseUrl}/api/v1/recordings/list?since=${encodeURIComponent(since)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
  } catch { return { bundles: [] }; }
});

ipcMain.handle('download-remote-bundle', async (event, bundleId) => {
  try {
    const settings = store.get('server', {});
    const token = store.get('auth.token', '');
    const baseUrl = settings.url || 'http://localhost:8098';
    const res = await require('node-fetch')(`${baseUrl}/api/v1/recordings/${bundleId}/video`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return { success: false };
    const buffer = await res.buffer();
    return { success: true, mediaBase64: buffer.toString('base64') };
  } catch { return { success: false }; }
});

ipcMain.handle('upload-bundle-to-cloud', async (event, bundleData) => {
  try {
    const settings = store.get('server', {});
    const token = store.get('auth.token', '');
    const baseUrl = settings.url || 'http://localhost:8098';

    const FormData = require('form-data');
    const form = new FormData();
    form.append('bundle_id', bundleData.bundle_id);
    form.append('duration_seconds', String(bundleData.duration_seconds || 0));
    form.append('has_video', String(!!bundleData.video));
    form.append('transcript_text', bundleData.transcript?.text || '');
    form.append('clone_training_ready', String(!!bundleData.clone_training_ready));
    form.append('device_platform', 'desktop');

    if (bundleData.file_path && fs.existsSync(bundleData.file_path)) {
      form.append('media', fs.createReadStream(bundleData.file_path));
    }

    const res = await require('node-fetch')(`${baseUrl}/api/v1/recordings/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, ...form.getHeaders() },
      body: form
    });
    return await res.json();
  } catch { return { success: false }; }
});

ipcMain.handle('show-sync-notification', async (event, message) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    new Notification({ title: 'Windy Pro Sync', body: message, icon: undefined }).show();
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
    return {
      local: localSize,
      cloud: 0, // Would come from API
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
  console.log('[Main] Another instance is running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
