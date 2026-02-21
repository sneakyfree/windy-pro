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

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, dialog } = require('electron');

// Fix: bake in --no-sandbox for Linux AppImage (chrome-sandbox SUID issue)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}
const path = require('path');
const Store = require('electron-store');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { CursorInjector } = require('./injection/injector');
const { WindyUpdater } = require('./updater');

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
    mainWindow.webContents.send('python-loading', true);
  }

  pythonProcess = spawn(pythonPath, [
    '-m', serverModule,
    '--host', serverConfig.host,
    '--port', String(serverConfig.port)
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
      if (mainWindow) mainWindow.webContents.send('python-loading', false);
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
        mainWindow.webContents.send('state-change', 'error');
        mainWindow.webContents.send('python-loading', false);
      }
    }
  });

  pythonProcess.on('error', (err) => {
    console.error(`[Python] Failed to start: ${err.message}`);
    if (mainWindow) {
      mainWindow.webContents.send('state-change', 'error');
      mainWindow.webContents.send('python-loading', false);
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
    { type: 'separator' },
    {
      label: '⚙️ Settings',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('open-settings');
      }
    },
    {
      label: '📋 Open Vault',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('open-vault');
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

  // Show/hide window
  const regShow = globalShortcut.register(hotkeys.showHide, () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
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
  mainWindow.webContents.send('toggle-recording', isRecording);
  updateTrayMenu();
  updateTrayIcon(isRecording ? 'listening' : 'idle');

  // Update tray icon color based on state
  if (tray) {
    tray.setToolTip(isRecording ? 'Windy Pro - Recording...' : 'Windy Pro');
  }
}

/**
 * Paste current transcript to cursor position
 */
function pasteTranscript() {
  mainWindow.webContents.send('request-transcript');
}

// IPC Handlers

// Get transcript and paste it via cursor injection
ipcMain.on('transcript-for-paste', async (event, transcript) => {
  if (transcript && transcript.trim()) {
    mainWindow.webContents.send('state-change', 'injecting');
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
      mainWindow.webContents.send('injection-error', error.message);
    }

    // Show window again after paste WITHOUT stealing focus
    // so the user can proofread and hit Enter in their chat app
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.showInactive();  // Show without taking focus
      }
      const newState = isRecording ? 'listening' : 'idle';
      mainWindow.webContents.send('state-change', newState);
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

// Get server config for WebSocket connection
ipcMain.handle('get-server-config', () => {
  return store.get('server');
});

// Minimize window
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
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
  try {
    const updater = new WindyUpdater();
    updater.checkForUpdates();
  } catch (e) {
    console.log('[Main] Auto-updater skipped:', e.message);
  }

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
