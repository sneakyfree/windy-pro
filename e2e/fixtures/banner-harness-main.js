// Minimal Electron harness for E2E-testing the signup banner.
//
// Loads e2e/fixtures/banner-harness.html in a BrowserWindow with no
// preload, no app.js, no engine — just enough to let
// signup-banner.js do its thing inside a real Electron renderer.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const HARNESS_HTML = process.env.WINDY_HARNESS_PATH ||
  path.join(__dirname, 'banner-harness.html');

// Force a per-process unique userData dir so localStorage / cookies
// don't leak between consecutive test runs. Electron's default
// userData lives at ~/Library/Application Support/Electron, which
// IGNORES the test's tmpHome HOME override — leftover localStorage
// from a previous test would cause maybeShowSignupBanner to early-out
// on the "already shown" guard.
const userDataDir = process.env.WINDY_HARNESS_USERDATA ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'windy-harness-userdata-'));
app.setPath('userData', userDataDir);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: {
      // Tests use page.evaluate() against the renderer; no preload needed.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(HARNESS_HTML);
  win.once('ready-to-show', () => win.show());
});

app.on('window-all-closed', () => app.quit());
