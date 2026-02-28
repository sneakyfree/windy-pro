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

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, dialog, Notification, shell } = require('electron');

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
let tray = null;
let isRecording = false;
let pythonProcess = null;
let pythonRestartCount = 0;
const MAX_PYTHON_RESTARTS = 3;

// ═══ Stripe Payment Integration ═══
// Secret key loaded from environment or electron-store (NEVER hardcode in source)
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

    // Auto-restart on unexpected exit (code != 0 and not quitting)
    if (code !== 0 && !app.isQuitting && pythonRestartCount < MAX_PYTHON_RESTARTS) {
      pythonRestartCount++;
      console.log(`[Python] Auto-restarting (attempt ${pythonRestartCount}/${MAX_PYTHON_RESTARTS})...`);
      setTimeout(() => startPythonServer(), 1000);
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
      preload: path.join(__dirname, 'preload.js')
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
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getArchiveFolder()
  });
  if (result.canceled || !result.filePaths?.length) return { canceled: true };
  const selected = result.filePaths[0];
  store.set('engine.archiveFolder', selected);
  return { canceled: false, path: selected };
});

ipcMain.on('open-archive-folder', () => {
  const folder = getArchiveFolder();
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
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
    // Small delay to let the app window hide, then paste at cursor
    await new Promise(r => setTimeout(r, 200));
    // Simulate Ctrl+V at current cursor position
    if (process.platform === 'linux') {
      require('child_process').execSync('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 });
    } else if (process.platform === 'darwin') {
      require('child_process').execSync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', { timeout: 5000 });
    } else {
      // Windows — use PowerShell
      require('child_process').execSync('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"', { timeout: 5000 });
    }
    return true;
  } catch (err) {
    console.error('[AutoPaste] Failed:', err.message);
    return false;
  }
});

// ═══ History: Read archive files from disk ═══
ipcMain.handle('get-archive-history', async () => {
  const fs = require('fs');
  const archiveDir = store.get('engine.archiveFolder') || path.join(os.homedir(), 'Documents', 'WindyProArchive');
  const entries = [];

  try {
    if (!fs.existsSync(archiveDir)) return entries;

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

      // Helper: parse HHMMSS from filename to seconds-since-midnight
      const parseTimeKey = (fname) => {
        const base = fname.replace('.md', '').replace('.webm', '').replace('-video', '');
        if (!/^\d{6}$/.test(base)) return -1;
        return parseInt(base.substring(0, 2)) * 3600 +
          parseInt(base.substring(2, 4)) * 60 +
          parseInt(base.substring(4, 6));
      };

      for (const file of mdFiles) {
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
            if (line.startsWith('**') && line.includes(':')) {
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

          // Match media files by timestamp proximity (±30 seconds)
          const mdTime = parseTimeKey(file);
          let hasAudio = false, hasVideo = false, audioPath = '', videoPath = '';

          for (const af of audioFiles) {
            const afTime = parseTimeKey(af);
            if (afTime >= 0 && Math.abs(afTime - mdTime) <= 30) {
              hasAudio = true;
              audioPath = path.join(dirPath, af);
              break;
            }
          }
          for (const vf of videoFiles) {
            const vfTime = parseTimeKey(vf.replace('-video', ''));
            if (vfTime >= 0 && Math.abs(vfTime - mdTime) <= 30) {
              hasVideo = true;
              videoPath = path.join(dirPath, vf);
              break;
            }
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
            _id: `archive-${dateDir}-${file}`
          });
        } catch (e) {
          console.warn('[History] Failed to parse:', filePath, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[History] Archive scan error:', e.message);
  }

  return entries;
});

// ═══ History: Delete archive entry ═══
ipcMain.handle('delete-archive-entry', async (event, filePath) => {
  const fs = require('fs');
  if (!filePath || !filePath.includes('WindyProArchive')) {
    throw new Error('Invalid archive path');
  }
  try {
    fs.unlinkSync(filePath);
    // Remove empty parent dir
    const dir = path.dirname(filePath);
    const remaining = fs.readdirSync(dir);
    if (remaining.length === 0) fs.rmdirSync(dir);
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
    // Security: path must be inside the archive folder
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(archiveRoot))) {
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

// ═══ Archive Stats & Export IPC Handlers ═══

ipcMain.handle('get-archive-stats', async () => {
  try {
    const archiveRoot = getArchiveFolder();
    if (!fs.existsSync(archiveRoot)) return { totalFiles: 0, totalSizeMB: 0, days: 0 };
    let totalFiles = 0, totalSize = 0, days = new Set();
    const items = fs.readdirSync(archiveRoot);
    for (const item of items) {
      const itemPath = path.join(archiveRoot, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        days.add(item);
        const files = fs.readdirSync(itemPath);
        for (const file of files) {
          totalFiles++;
          try { totalSize += fs.statSync(path.join(itemPath, file)).size; } catch (_) { }
        }
      }
    }
    return { totalFiles, totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10, days: days.size };
  } catch (err) {
    return { totalFiles: 0, totalSizeMB: 0, days: 0, error: err.message };
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

ipcMain.handle('apply-coupon', async (event, code) => {
  try {
    const stripe = getStripe();
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
