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

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, dialog, Notification } = require('electron');

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
      archiveFolder: path.join(os.homedir(), 'Documents', 'WindyProArchive'),
      dropboxEnabled: false,
      dropboxAccessToken: '',
      dropboxFolder: '/WindyProArchive',
      dropboxLastTestAt: '',
      googleEnabled: false,
      googleAccessToken: '',
      googleFolderId: '',
      googleLastTestAt: ''
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

async function uploadFileToDropbox(localPath, remotePath, accessToken) {
  const https = require('https');
  const content = fs.readFileSync(localPath);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'content.dropboxapi.com',
      path: '/2/files/upload',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: remotePath,
          mode: 'overwrite',
          autorename: false,
          mute: true,
          strict_conflict: false
        }),
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length
      }
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, body });
        } else {
          reject(new Error(`Dropbox upload failed ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(content);
    req.end();
  });
}

async function uploadFileToGoogleDrive(localPath, filename, accessToken, folderId = '') {
  const https = require('https');
  const content = fs.readFileSync(localPath);
  const boundary = 'windypro_' + Date.now();
  const metadata = {
    name: filename,
    ...(folderId ? { parents: [folderId] } : {})
  };
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([preamble, content, ending]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let resp = '';
      res.on('data', (d) => { resp += d.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, body: resp });
        } else {
          reject(new Error(`Google upload failed ${res.statusCode}: ${resp}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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

ipcMain.handle('test-dropbox-connection', async () => {
  try {
    const engine = store.get('engine', {});
    if (!engine.dropboxAccessToken) return { ok: false, error: 'Missing Dropbox token' };
    const tmp = path.join(os.tmpdir(), `windy_dropbox_test_${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'Windy Pro Dropbox connection test', 'utf-8');
    const base = (engine.dropboxFolder || '/WindyProArchive').replace(/\/$/, '');
    await uploadFileToDropbox(tmp, `${base}/_connection_test.txt`, engine.dropboxAccessToken);
    try { fs.unlinkSync(tmp); } catch (_) { }
    const ts = new Date().toISOString();
    store.set('engine.dropboxLastTestAt', ts);
    return { ok: true, testedAt: ts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('test-google-connection', async () => {
  try {
    const engine = store.get('engine', {});
    if (!engine.googleAccessToken) return { ok: false, error: 'Missing Google token' };
    const tmp = path.join(os.tmpdir(), `windy_google_test_${Date.now()}.md`);
    fs.writeFileSync(tmp, '# Windy Pro Google Drive connection test\n', 'utf-8');
    await uploadFileToGoogleDrive(
      tmp,
      '_connection_test.md',
      engine.googleAccessToken,
      engine.googleFolderId || ''
    );
    try { fs.unlinkSync(tmp); } catch (_) { }
    const ts = new Date().toISOString();
    store.set('engine.googleLastTestAt', ts);
    return { ok: true, testedAt: ts };
  } catch (e) {
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

      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md')).sort().reverse();
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Parse the .md file: title line, metadata, then text
          const lines = content.split('\n');
          let text = '';
          let wordCount = 0;
          let engine = 'local';
          let dateStr = '';

          // Extract metadata from frontmatter-like lines
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('# ')) continue; // title
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
            // Everything after metadata is transcript text
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

          entries.push({
            date: dateStr,
            text,
            wordCount,
            engine,
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

ipcMain.on('archive-transcript', async (event, payload) => {
  try {
    const route = payload?.route || store.get('engine.archiveRouteToday') || 'local';
    const res = appendArchiveEntry(payload || {});
    if (!res.archived) {
      event.reply('archive-result', { ok: false, reason: 'skipped' });
      return;
    }

    const cloud = {
      dropbox: { attempted: false, ok: false, error: null },
      google: { attempted: false, ok: false, error: null }
    };
    const engine = store.get('engine', {});

    if (route === 'local_dropbox') {
      cloud.dropbox.attempted = true;
      if (!engine.dropboxEnabled || !engine.dropboxAccessToken) {
        cloud.dropbox.error = 'Dropbox not configured';
      } else {
        try {
          const base = (engine.dropboxFolder || '/WindyProArchive').replace(/\/$/, '');
          for (const f of res.files) {
            const rel = path.relative(getArchiveFolder(), f).replace(/\\/g, '/');
            const remotePath = `${base}/${rel}`;
            await uploadFileToDropbox(f, remotePath, engine.dropboxAccessToken);
          }
          cloud.dropbox.ok = true;
        } catch (e) {
          cloud.dropbox.error = e.message;
        }
      }
    }

    if (route === 'local_google') {
      cloud.google.attempted = true;
      if (!engine.googleEnabled || !engine.googleAccessToken) {
        cloud.google.error = 'Google Drive not configured';
      } else {
        try {
          for (const f of res.files) {
            const rel = path.relative(getArchiveFolder(), f).replace(/\\/g, '_');
            await uploadFileToGoogleDrive(
              f,
              `WindyPro_${rel}`,
              engine.googleAccessToken,
              engine.googleFolderId || ''
            );
          }
          cloud.google.ok = true;
        } catch (e) {
          cloud.google.error = e.message;
        }
      }
    }

    console.log('[Archive] Saved:', res.files.join(', '));
    event.reply('archive-result', { ok: true, ...res, route, cloud });
  } catch (err) {
    console.error('[Archive] Failed:', err.message);
    event.reply('archive-result', { ok: false, error: err.message });
  }
});

// Save audio recording to archive folder
ipcMain.handle('archive-audio', async (event, base64) => {
  try {
    const archiveRoot = getArchiveFolder();
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeKey = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const dayDir = path.join(archiveRoot, dateKey);
    ensureDir(dayDir);
    const audioPath = path.join(dayDir, `${timeKey}.webm`);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(audioPath, buffer);
    console.log(`[Archive] Audio saved: ${audioPath} (${(buffer.length/1024).toFixed(0)}KB)`);
    return { ok: true, path: audioPath };
  } catch (err) {
    console.error('[Archive] Audio save failed:', err.message);
    return { ok: false, error: err.message };
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
  // First-run setup wizard (Phase 3: B4)
  const installerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'installer', 'installer-wizard')
    : path.join(__dirname, '..', '..', '..', 'installer', 'installer-wizard');
  const { InstallerWizard } = require(installerPath);
  if (InstallerWizard.needsSetup()) {
    const wizard = new InstallerWizard();
    const installed = await wizard.show();
    if (!installed) {
      // User closed wizard without completing — quit
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
