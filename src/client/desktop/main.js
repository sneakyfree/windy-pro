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

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { CursorInjector } = require('./injection/injector');

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
    }
  }
});

let mainWindow = null;
let tray = null;
let isRecording = false;

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
  const hotkeys = store.get('hotkeys');

  // Toggle recording
  globalShortcut.register(hotkeys.toggleRecording, () => {
    toggleRecording();
  });

  // Paste transcript
  globalShortcut.register(hotkeys.pasteTranscript, () => {
    pasteTranscript();
  });

  // Show/hide window
  globalShortcut.register(hotkeys.showHide, () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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

    try {
      await injector.inject(transcript);
    } catch (error) {
      console.error('Injection failed:', error.message);
      mainWindow.webContents.send('injection-error', error.message);
    }

    setTimeout(() => {
      const newState = isRecording ? 'listening' : 'idle';
      mainWindow.webContents.send('state-change', newState);
      updateTrayIcon(newState);
    }, 200);
  }
});

// Check injection permissions
ipcMain.handle('check-injection-permissions', async () => {
  return injector.checkPermissions();
});

// Update settings
ipcMain.on('update-settings', (event, settings) => {
  if (settings.hotkeys) {
    // Unregister old hotkeys
    globalShortcut.unregisterAll();
    store.set('hotkeys', settings.hotkeys);
    registerHotkeys();
  }
  if (settings.server) {
    store.set('server', settings.server);
  }
  if (settings.appearance) {
    store.set('appearance', settings.appearance);
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(settings.appearance.alwaysOnTop);
      mainWindow.setOpacity(settings.appearance.opacity);
    }
  }
});

// Get settings
ipcMain.handle('get-settings', () => {
  return {
    hotkeys: store.get('hotkeys'),
    server: store.get('server'),
    appearance: store.get('appearance')
  };
});

// Get server config for WebSocket connection
ipcMain.handle('get-server-config', () => {
  return store.get('server');
});

// App lifecycle

app.whenReady().then(async () => {
  // First-run setup wizard (Phase 3: B4)
  const { InstallerWizard } = require('../../../installer/installer-wizard');
  if (InstallerWizard.needsSetup()) {
    const wizard = new InstallerWizard();
    const installed = await wizard.show();
    if (!installed) {
      // User closed wizard without completing — quit
      app.quit();
      return;
    }
  }

  createWindow();
  createTray();
  registerHotkeys();

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
  // Unregister all hotkeys
  globalShortcut.unregisterAll();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
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
