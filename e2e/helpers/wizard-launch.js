// Helper for launching the wizard inside a Playwright-electron test.
//
// Each test gets:
//   - A fresh tmpdir as $HOME (so ~/.windy-pro/ is empty, matching first run)
//   - The wizard launched via test-wizard.js (no --real, so platform
//     adapters don't try to install brew or apt-get during a test)
//   - A handle to the wizard BrowserWindow's renderer (the "page")
//   - An afterEach that closes the app cleanly so the next test starts
//     from zero
//
// Why fresh $HOME per test:
//   The wizard's CleanSlate phase + DependencyInstaller both write to
//   $HOME/.windy-pro/. Without isolation, test #2 would see the venv
//   that test #1 created and skip half the install path.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron');
const WIZARD_ENTRY = path.join(REPO_ROOT, 'installer-v2', 'test-wizard.js');

/**
 * Launch the wizard with a clean tmpdir as HOME.
 *
 * @param {object} opts
 * @param {boolean} [opts.real=false]   Pass --real to test-wizard.js (rare;
 *                                       avoid in CI — runs platform adapters)
 * @param {object}  [opts.env={}]       Extra env vars merged into the launch
 * @returns {Promise<{ app, page, tmpHome, cleanup }>}
 */
async function launchWizard(opts = {}) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-e2e-home-'));

  const args = [WIZARD_ENTRY];
  if (opts.real) args.push('--real');

  // The test-wizard.js launcher uses Electron's `app` API, which expects
  // to BE Electron — so we point Playwright at the local electron binary
  // and pass our entry as argv.
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args,
    env: {
      ...process.env,
      HOME: tmpHome,
      // Defeat Electron's GPU sandbox on Linux CI (headless runners
      // don't have a real GPU and the sandbox blocks the launch).
      ELECTRON_DISABLE_SANDBOX: '1',
      // Make the wizard log to a path we can introspect from tests.
      // wizard-logger.js honors XDG_STATE_HOME on Linux and falls back
      // to ~/Library/Logs on macOS — both are now under tmpHome.
      XDG_STATE_HOME: path.join(tmpHome, '.local', 'state'),
      ...(opts.env || {}),
    },
  });

  // The wizard creates its BrowserWindow async during app.whenReady().
  // Wait for the first window before returning a page handle.
  const page = await app.firstWindow();

  // Verify the wizard HTML actually loaded — surfaces preload bridge
  // errors immediately instead of waiting for a per-test selector miss.
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    tmpHome,
    async cleanup() {
      try { await app.close(); } catch (_) { /* already closed */ }
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) { /* leave it */ }
    },
  };
}

/**
 * Read the wizard log file for assertions (e.g. confirm a specific
 * step completed without timing out).
 */
function readWizardLog(tmpHome) {
  const candidates = [
    path.join(tmpHome, 'Library', 'Logs', 'Windy Pro', 'wizard-install.log'),
    path.join(tmpHome, '.local', 'state', 'windy-pro', 'logs', 'wizard-install.log'),
    path.join(tmpHome, 'AppData', 'Local', 'Windy Pro', 'Logs', 'wizard-install.log'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  }
  return '';
}

module.exports = { launchWizard, readWizardLog };
