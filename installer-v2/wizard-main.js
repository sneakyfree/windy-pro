/**
 * Windy Pro v2.0 — Installation Wizard (Main Process)
 * Electron main process that orchestrates the full install.
 * 
 * This is the shared core that all platform wizards use.
 * Platform-specific adapters handle dependency installation.
 * 
 * ARCHITECTURE NOTE (M1): Some adapter pip installs use execSync which
 * blocks the Node event loop. This is intentional for sequential dependency
 * ordering but means the UI cannot update during long pip installs.
 * A future refactor should use exec() with streaming output for all
 * pip operations. For now, DependencyInstaller._exec is async and
 * handles the heavy lifting.
 */

const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { HardwareDetector } = require('./core/hardware-detect');
const { ENGINE_CATALOG, ENGINE_FAMILIES, getTotalSize, formatSize } = require('./core/models');
const { StorageAwareEngines } = require('./core/storage-aware-models');
const { recommend, estimateDownloadTime } = require('./core/windytune');
const { INSTALL_STEP_MESSAGES, getRandomLoadingMessage } = require('./core/brand-content');
const { DownloadManager } = require('./core/download-manager');
const { AccountManager } = require('./core/account-manager');
const { CleanSlate } = require('./core/clean-slate');
const { DependencyInstaller } = require('./core/dependency-installer');
const { BundledAssets } = require('./core/bundled-assets');
const { wizardLog, getLogPath, withTimeout } = require('./core/wizard-logger');

// Per-step fail-fast budgets. These are diagnostic ceilings — every step
// already self-imposes shorter timeouts on its own subprocesses. If any of
// these trips, the log line `✗ TIMEOUT after Nms in: <label>` is the
// debugging anchor: it identifies exactly which await never returned.
const TIMEOUT_CLEAN_SLATE = 60_000;       // 60s for prior-install removal
const TIMEOUT_DEPS_INSTALL = 600_000;     // 10min for full dep cocktail (legacy slow path)
const TIMEOUT_DEPS_FAST_PATH = 180_000;   // 3min for bundled fast-path (uv/pip from wheels)
const TIMEOUT_HARDWARE_SCAN = 30_000;     // 30s — incl. 8s network speedtest
const TIMEOUT_DOWNLOAD_MODELS = 30 * 60_000; // 30min for largest model + slow networks
const TIMEOUT_PLATFORM_VERIFY = 30_000;
const TIMEOUT_PLATFORM_PERMS = 60_000;

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const ENGINES_DIR = path.join(APP_DIR, 'engines');
const PAIRS_DIR = path.join(APP_DIR, 'pairs');

// Load full pair catalog for download naming
let PAIR_CATALOG = [];
try {
  const catalogPath = path.join(__dirname, '..', 'shared', 'pair-catalog.json');
  if (fs.existsSync(catalogPath)) {
    PAIR_CATALOG = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  }
} catch (_) { /* pair catalog optional */ }

/**
 * Allowlist check for Stripe Checkout URLs. SEC-WIZARD-1.
 *
 * Stripe Checkout sessions live at:
 *   https://checkout.stripe.com/c/pay/...        (current)
 *   https://checkout.stripe.com/pay/...          (legacy)
 *   https://billing.stripe.com/p/session/...     (Stripe Billing portal)
 *
 * Refuses anything else, including http://, file://, javascript:, or
 * lookalike hosts (e.g. `https://checkout.stripe.com.evil.example/`).
 */
function _isAllowedStripeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.hostname === 'checkout.stripe.com' || u.hostname === 'billing.stripe.com';
  } catch (_) {
    return false;
  }
}

/**
 * Auto-detect Linux distro and return the appropriate platform adapter
 */
function getLinuxAdapter() {
  if (process.platform !== 'linux') return null;
  let osRelease = '';
  try { osRelease = fs.readFileSync('/etc/os-release', 'utf-8'); } catch (_) { }

  if (/debian|ubuntu|mint|pop|elementary|zorin|kali|raspbian/i.test(osRelease)) {
    const { LinuxDebianAdapter } = require('./adapters/linux-debian');
    return new LinuxDebianAdapter();
  } else if (/fedora|rhel|centos|rocky|alma|amazon|oracle/i.test(osRelease)) {
    const { LinuxFedoraAdapter } = require('./adapters/linux-fedora');
    return new LinuxFedoraAdapter();
  } else if (/arch|manjaro|endeavour|garuda|artix/i.test(osRelease)) {
    const { LinuxArchAdapter } = require('./adapters/linux-arch');
    return new LinuxArchAdapter();
  } else {
    const { LinuxUniversalAdapter } = require('./adapters/linux-universal');
    return new LinuxUniversalAdapter();
  }
}

class InstallWizard {
  constructor(opts = {}) {
    this.window = null;
    this.detector = new HardwareDetector();
    this.hardware = null;
    this.recommendation = null;
    this.selectedEngines = [];
    this.storageEngines = new StorageAwareEngines();
    this.platformAdapter = opts.platformAdapter || (process.platform === 'linux' ? getLinuxAdapter() : null);
    this.downloadManager = new DownloadManager(ENGINES_DIR);
    this.accountManager = new AccountManager(APP_DIR);
  }

  /**
   * Show the wizard window
   */
  async show() {
    return new Promise((resolve) => {
      // Adapt to screen size — never exceed 90% of display
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
      const winW = Math.min(1100, Math.round(screenW * 0.9));
      const winH = Math.min(900, Math.round(screenH * 0.9));

      this.window = new BrowserWindow({
        width: winW,
        height: winH,
        minWidth: 600,
        minHeight: 500,
        maxWidth: screenW,
        maxHeight: screenH,
        resizable: true,
        maximizable: true,
        center: true,
        frame: true,
        title: 'Windy Pro — Setup',
        backgroundColor: '#0A0E1A',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true, // SEC-M1: Enable renderer sandbox
          preload: path.join(__dirname, 'wizard-preload.js')
        }
      });

      this.window.loadFile(path.join(__dirname, 'screens', 'wizard.html'));
      this.window.setMenuBarVisibility(false);

      // Phase 4 verification needs the wizard renderer to call getUserMedia
      // (1-second mic capture for amplitude check). Without an explicit
      // permission handler Electron defaults to "deny" for sandboxed
      // renderers loading file://, which would break the mic verify step.
      try {
        this.window.webContents.session.setPermissionRequestHandler(
          (webContents, permission, callback) => {
            // Only the wizard window is allowed media access here, and only
            // for the mic+audioCapture permissions. Everything else: deny.
            if (permission === 'media' || permission === 'audioCapture') {
              return callback(true);
            }
            return callback(false);
          }
        );
      } catch (e) {
        console.warn('[Wizard] Could not register permission handler:', e.message);
      }

      // Debug: log when page finishes loading
      this.window.webContents.on('did-finish-load', () => {
        console.log('[Wizard] Page loaded successfully');
      });
      this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.log(`[Wizard] Page failed to load: ${errorCode} ${errorDescription}`);
      });
      this.window.webContents.on('render-process-gone', (event, details) => {
        console.log(`[Wizard] Renderer crashed: ${details.reason} (exitCode: ${details.exitCode})`);
      });
      this.window.webContents.on('console-message', (event, level, message) => {
        console.log(`[Wizard:Console] ${message}`);
      });

      this.setupIPC();

      // Tell the renderer when our window regains focus. Phase 4
      // verify screen uses this to re-probe permissions automatically
      // after the user comes back from System Settings — no need for
      // the user to click "Re-check".
      this.window.on('focus', () => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('wizard-window-focus');
        }
      });

      this.window.on('closed', () => {
        this.window = null;
        resolve(true);
      });
    });
  }

  setupIPC() {
    // ─── Prior Version Check ───
    ipcMain.handle('wizard-check-prior-install', async () => {
      wizardLog('IPC wizard-check-prior-install ENTRY');
      try {
        const cleanSlate = new CleanSlate({ preserveModels: true });
        const detection = cleanSlate._detect();
        wizardLog(`IPC wizard-check-prior-install EXIT: found=${detection.found}`);
        return detection;
      } catch (e) {
        wizardLog(`IPC wizard-check-prior-install THREW: ${e.message}`);
        throw e;
      }
    });

    // ─── Hardware Scan ───
    ipcMain.handle('wizard-scan-hardware', async () => {
      wizardLog('IPC wizard-scan-hardware ENTRY');
      // Network speedtest in HardwareDetector hits speed.cloudflare.com with
      // its own 8s timeout, but we still bound the whole scan in case any
      // subprocess (e.g. system_profiler on first boot) wedges.
      this.hardware = await withTimeout(
        this.detector.detect(),
        TIMEOUT_HARDWARE_SCAN,
        'HardwareDetector.detect'
      );
      wizardLog(`IPC wizard-scan-hardware: detected ram=${this.hardware?.ram?.totalGB}GB cores=${this.hardware?.cpu?.cores} arch=${this.hardware?.cpu?.arch} disk=${this.hardware?.disk?.freeGB}GB`);
      this.recommendation = recommend(this.hardware);

      // Initialize storage-aware model system with detected hardware
      this.storageEngines.loadHardwareProfile(this.hardware);
      const storageState = this.storageEngines.getInitialState();

      // Auto-select recommended models based on storage/RAM
      this.selectedEngines = storageState.recommendedModels;

      // Annotate models with hardware compatibility
      const annotatedModels = ENGINE_CATALOG.map(m => ({
        ...m,
        hardwareOk: this.hardware.ram.totalGB >= m.ramGB,
        familyInfo: ENGINE_FAMILIES[m.family]
      }));

      wizardLog(`IPC wizard-scan-hardware EXIT: ${annotatedModels.length} models annotated, ${storageState?.recommendedModels?.length || 0} pre-selected`);
      return {
        hardware: this.hardware,
        recommendation: this.recommendation,
        models: annotatedModels,
        storageState // includes freeStorage, recommendedModels, modelStatuses, downloadEstimate
      };
    });

    // ─── Model Selection (set all) ───
    ipcMain.handle('wizard-select-models', async (event, modelIds) => {
      wizardLog(`IPC wizard-select-models ENTRY: ${(Array.isArray(modelIds) ? modelIds : [modelIds]).join(',')}`);
      this.selectedEngines = Array.isArray(modelIds) ? modelIds : [modelIds];
      const result = this.storageEngines.setSelectedModels(this.selectedEngines);
      wizardLog(`IPC wizard-select-models EXIT: selected=${this.selectedEngines.length}`);
      return { selected: this.selectedEngines, ...result };
    });

    // ─── Model Toggle (check/uncheck individual model) ───
    ipcMain.handle('wizard-toggle-model', async (event, modelId, selected) => {
      const result = this.storageEngines.toggleModel(modelId, selected);
      this.selectedEngines = [...this.storageEngines.selectedModelIds];
      return { selected: this.selectedEngines, ...result };
    });

    // ─── Account ───
    ipcMain.handle('wizard-login', async (event, email, password) => {
      try {
        const account = await this.accountManager.login(email, password);
        return { success: true, account: { email: account.email, name: account.name, tier: account.tier } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('wizard-register', async (event, name, email, password) => {
      try {
        const account = await this.accountManager.register(name, email, password);
        return { success: true, account: { email: account.email, name: account.name, tier: account.tier } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('wizard-free-account', async () => {
      const account = this.accountManager.createFreeAccount();
      return { success: true, account: { name: account.name, tier: account.tier } };
    });

    // ─── Install ───
    ipcMain.handle('wizard-install', async () => {
      wizardLog('═══════════ wizard-install IPC handler ENTRY ═══════════');
      wizardLog(`log file location: ${getLogPath()}`);
      const models = this.selectedEngines.length > 0 ? this.selectedEngines : this.recommendation?.recommended || ['windy-lite-ct2'];
      wizardLog('selected models:', models);
      console.log('[InstallWizard] Starting install for models:', models);

      try {
        // ═══ Phase 0: CLEAN SLATE — Remove any prior installation ═══
        wizardLog('Phase 0: about to call sendProgress(percent: 1)');
        this.sendProgress({
          percent: 1,
          message: '🧹 Checking for prior Windy Pro installation...',
          detail: 'Ensuring a clean start — removing any old files, processes, or configs'
        });
        wizardLog('Phase 0: sendProgress returned. Constructing CleanSlate...');
        console.log('[InstallWizard] Phase 0: Clean Slate');

        const cleanSlate = new CleanSlate({
          preserveModels: true, // Don't re-download gigabytes of models
          onProgress: (pct) => {
            wizardLog(`  cleanSlate.onProgress(${pct})`);
            this.sendProgress({ percent: 1 + pct * 0.04 });
          },
          onLog: (msg) => { wizardLog(`  cleanSlate: ${msg}`); console.log(msg); }
        });
        wizardLog('Phase 0: CleanSlate constructed. Calling cleanSlate.run() with timeout...');
        const cleanResult = await withTimeout(
          cleanSlate.run(),
          TIMEOUT_CLEAN_SLATE,
          'CleanSlate.run'
        );
        wizardLog('Phase 0: cleanSlate.run() returned:', { wasClean: cleanResult.wasClean, removedCount: cleanResult.removed?.length, errorCount: cleanResult.errors?.length });

        if (!cleanResult.wasClean) {
          console.log(`[InstallWizard] Removed prior installation: ${cleanResult.removed.join(', ')}`);
          this.sendProgress({
            percent: 5,
            message: '🧹 Prior installation removed!',
            detail: `Cleaned: ${cleanResult.removed.length} items. ${cleanResult.preserved.length} models preserved.`
          });
        } else {
          console.log('[InstallWizard] No prior installation found — clean slate confirmed');
        }

        // ═══ Phase 1: Dependencies (using bundled assets + new installer) ═══
        wizardLog('Phase 1: starting dependencies (bundled-first)');
        this.sendProgress({
          percent: 5,
          message: INSTALL_STEP_MESSAGES['check-deps']?.title || '🌪️ Preparing the Windy Ecosystem',
          detail: INSTALL_STEP_MESSAGES['check-deps']?.detail || 'Installing Python, ffmpeg, audio tools, and everything you need...'
        });
        console.log('[InstallWizard] Phase 1: Dependencies (bundled-first strategy)');

        const depInstaller = new DependencyInstaller({
          onLog: (msg) => { wizardLog(`  depInstaller: ${msg}`); console.log(msg); },
          onProgress: (pct) => {
            wizardLog(`  depInstaller.onProgress(${pct})`);
            this.sendProgress({
              percent: 5 + pct * 0.19, // 5% to 24%
              message: '🌪️ Installing dependencies...',
              detail: `${pct}% complete`
            });
          }
        });
        wizardLog('Phase 1: DependencyInstaller constructed. Calling installAll() with timeout...');

        // Use the larger legacy budget when bundled assets aren't present
        // (since legacy hits brew/apt which can take minutes), but the
        // bundled fast-path label is used for the typical happy path.
        const depTimeout = (new BundledAssets()).hasBundledPython() && (new BundledAssets()).hasBundledWheels()
          ? TIMEOUT_DEPS_FAST_PATH
          : TIMEOUT_DEPS_INSTALL;
        wizardLog(`Phase 1: timeout budget = ${depTimeout}ms (${depTimeout === TIMEOUT_DEPS_FAST_PATH ? 'fast-path' : 'legacy'})`);
        const depResult = await withTimeout(
          depInstaller.installAll(),
          depTimeout,
          'DependencyInstaller.installAll'
        );
        wizardLog('Phase 1: installAll() returned:', { success: depResult.success, errorCount: depResult.errors?.length });
        if (!depResult.success) {
          console.log('[InstallWizard] Some deps failed but continuing:', depResult.errors);
          this.sendProgress({
            percent: 24,
            message: '⚠️ Some dependencies had issues — continuing with available tools',
            detail: depResult.errors.join('; ')
          });
        } else {
          console.log('[InstallWizard] All dependencies installed successfully');
          this.sendProgress({ percent: 24, message: '✅ All dependencies installed!' });
        }

        console.log('[InstallWizard] Phase 2: Download models');
        // Phase 2: Download models (this is the long part — 25% to 90%)
        const modelRange = 65; // 25% to 90%
        const modelStart = 25;
        const token = this.accountManager.getToken();

        // Track download start time for ETA calculation
        const downloadStart = Date.now();
        let completedModels = 0;

        wizardLog(`Phase 2: starting downloadManager.downloadModels with timeout ${TIMEOUT_DOWNLOAD_MODELS}ms`);
        await withTimeout(this.downloadManager.downloadModels(
          models,
          // Per-model progress callback
          (modelId, progress) => {
            const modelInfo = ENGINE_CATALOG.find(m => m.id === modelId);
            const pairInfo = !modelInfo ? PAIR_CATALOG.find(p => p.id === modelId) : null;
            const modelName = modelInfo?.shortName || modelInfo?.name || (pairInfo ? `${pairInfo.sourceName}↔${pairInfo.targetName}` : modelId);
            const modelSize = modelInfo ? formatSize(modelInfo.sizeMB) : (pairInfo ? formatSize(pairInfo.sizeMB) : '?');

            // Calculate ETA based on elapsed time and overall progress
            const elapsed = (Date.now() - downloadStart) / 1000;
            const overallPct = modelStart + (progress / 100) * modelRange * 0.8 / models.length + (completedModels / models.length * modelRange);
            let eta = '';
            if (overallPct > 2 && elapsed > 3) {
              const remaining = (elapsed / overallPct) * (100 - overallPct);
              if (remaining < 60) eta = `~${Math.ceil(remaining)}s remaining`;
              else if (remaining < 3600) eta = `~${Math.ceil(remaining / 60)}m remaining`;
              else eta = `~${(remaining / 3600).toFixed(1)}h remaining`;
            }

            this.sendProgress({
              percent: modelStart + (completedModels / models.length * modelRange) + (progress / 100) * (modelRange / models.length),
              message: `${INSTALL_STEP_MESSAGES['download-model']?.title || 'Downloading'} — ${modelName}`,
              detail: `Downloading ${modelName} (${modelSize}) — ${Math.round(progress)}%`,
              modelId: modelId,
              modelPercent: progress,
              eta: eta,
            });

            // When this model hits 100%, mark it done
            if (progress >= 100) {
              completedModels++;
              this.sendProgress({
                modelId: modelId,
                modelDone: true,
                percent: modelStart + (completedModels / models.length * modelRange),
                detail: `Model ${completedModels} of ${models.length} complete`,
              });
            }
          },
          // Overall progress callback
          (overallPercent, completed, total) => {
            const elapsed = (Date.now() - downloadStart) / 1000;
            const pct = modelStart + (overallPercent / 100) * modelRange;
            let eta = '';
            if (pct > 2 && elapsed > 3) {
              const remaining = (elapsed / pct) * (100 - pct);
              if (remaining < 60) eta = `~${Math.ceil(remaining)}s remaining`;
              else if (remaining < 3600) eta = `~${Math.ceil(remaining / 60)}m remaining`;
              else eta = `~${(remaining / 3600).toFixed(1)}h remaining`;
            }
            this.sendProgress({
              percent: pct,
              detail: `Model ${completed} of ${total} complete`,
              eta: eta,
            });
          }
        ), TIMEOUT_DOWNLOAD_MODELS, 'DownloadManager.downloadModels');
        wizardLog('Phase 2: downloadModels complete');

        // Phase 3: Verify
        this.sendProgress({
          percent: 92,
          message: INSTALL_STEP_MESSAGES['verify']?.title || '🔍 Verifying Installation',
          detail: INSTALL_STEP_MESSAGES['verify']?.detail || 'Checking all components are working...'
        });

        if (this.platformAdapter) {
          wizardLog('Phase 3: platformAdapter.verify() with timeout');
          await withTimeout(
            this.platformAdapter.verify(),
            TIMEOUT_PLATFORM_VERIFY,
            'platformAdapter.verify'
          );
          wizardLog('Phase 3: verify done');
        }

        // Phase 4: Permissions
        this.sendProgress({
          percent: 96,
          message: INSTALL_STEP_MESSAGES['permissions']?.title || '🔐 Setting up permissions',
          detail: INSTALL_STEP_MESSAGES['permissions']?.detail || 'Configuring system access...'
        });

        if (this.platformAdapter) {
          wizardLog('Phase 4: platformAdapter.requestPermissions() with timeout');
          await withTimeout(
            this.platformAdapter.requestPermissions(),
            TIMEOUT_PLATFORM_PERMS,
            'platformAdapter.requestPermissions'
          );
          wizardLog('Phase 4: permissions done');
        }

        // Done!
        this.sendProgress({
          percent: 100,
          message: INSTALL_STEP_MESSAGES['complete']?.title || '🎉 Installation Complete!',
          detail: INSTALL_STEP_MESSAGES['complete']?.detail || 'Windy Pro is ready to use.'
        });

        // Write config.json to mark installation as complete
        const configPath = path.join(APP_DIR, 'config.json');
        fs.mkdirSync(APP_DIR, { recursive: true });
        // Read version from package.json rather than hardcoding
        let appVersion = '0.5.0';
        try {
          const pkgPath = path.join(__dirname, '..', 'package.json');
          if (fs.existsSync(pkgPath)) {
            appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || appVersion;
          }
        } catch (_) { /* use default */ }
        // Separate pairs from engines for config
        const pairModels = models.filter(m => m.startsWith('windy-pair-'));
        const engineModels = models.filter(m => !m.startsWith('windy-pair-'));
        fs.writeFileSync(configPath, JSON.stringify({
          version: appVersion,
          installedAt: new Date().toISOString(),
          models: engineModels,
          pairs: pairModels,
          defaultModel: engineModels[0] || 'windy-lite-ct2'
        }, null, 2));

        wizardLog('═══════════ wizard-install handler EXIT (success) ═══════════');
        return { success: true, models };

      } catch (error) {
        wizardLog('═══════════ wizard-install handler THREW ═══════════');
        wizardLog(`error: ${error.message}`);
        wizardLog(`stack: ${error.stack || '(no stack)'}`);
        console.error('[InstallWizard] Install failed:', error);
        // Surface a user-friendly error to the wizard UI
        const userMessage = this._friendlyError(error);
        this.sendProgress({
          percent: -1,
          message: '❌ Installation failed',
          detail: userMessage
        });
        return { success: false, error: userMessage };
      }
    });

    // ─── Language Profile ───
    ipcMain.handle('wizard-save-language-profile', async (event, languages) => {
      try {
        const profilePath = path.join(APP_DIR, 'language-profile.json');
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.writeFileSync(profilePath, JSON.stringify({
          languages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, null, 2));
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // ─── Translation Tier ───
    ipcMain.handle('wizard-purchase-translate', async (event, tier) => {
      try {
        // Store selection locally regardless of API result
        const configPath = path.join(APP_DIR, 'translate-config.json');
        fs.writeFileSync(configPath, JSON.stringify({
          tier, // 'translate' (Ultra) or 'translate_pro' (Max) or 'deferred'
          purchasedAt: tier === 'deferred' ? null : new Date().toISOString(),
          deferredAt: tier === 'deferred' ? new Date().toISOString() : null
        }, null, 2));

        // If user chose a paid tier, attempt to create Stripe checkout
        if (tier !== 'deferred' && tier !== 'free') {
          const API_BASE = process.env.ACCOUNT_API || 'https://windyword.ai';
          const token = this.accountManager.getToken();

          // Map wizard tier keys to price IDs
          const priceMap = {
            translate: process.env.STRIPE_ULTRA_ANNUAL_PRICE_ID || 'price_1T5oZJBXIOBasDQiHO0MtYS7',
            translate_pro: process.env.STRIPE_MAX_ANNUAL_PRICE_ID || 'price_1T5oZ1BXIOBasDQinrz3VdvG'
          };
          const priceId = priceMap[tier];

          if (priceId) {
            try {
              const res = await fetch(`${API_BASE}/api/v1/payments/create-checkout`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ priceId, tier }),
                signal: AbortSignal.timeout(10000)
              });
              const data = await res.json();
              // SEC-WIZARD-1 (MED): API response is trusted by the
              // wizard but a compromised account-server (or MITM'd
              // response) could return data.url as `javascript:…`
              // or a `file://` URL, which shell.openExternal would
              // happily open. Hard-restrict to HTTPS Stripe Checkout
              // hosts — anything else is a misconfiguration or attack.
              if (data.url && _isAllowedStripeUrl(data.url)) {
                const { shell } = require('electron');
                await shell.openExternal(data.url);
                return { success: true, checkoutUrl: data.url };
              }
              if (data.url) {
                wizardLog(`SEC-WIZARD-1: refused checkout URL with disallowed host: ${data.url.slice(0, 80)}`);
              }
            } catch (apiErr) {
              console.warn('[Wizard] Stripe checkout failed (user can upgrade later):', apiErr.message);
            }
          }
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // ─── Open External URL (for Stripe checkout) ───
    ipcMain.handle('wizard-open-external', async (event, url) => {
      const { shell } = require('electron');
      if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
        return true;
      }
      return false;
    });

    // ─── Complete (close wizard) ───
    ipcMain.handle('wizard-complete', async () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return true;
    });

    // ═════════════════════════════════════════════════════════════════════
    // Phase 4: Permission verification loops
    //
    // Don't trust "the user clicked Allow" — actually verify the OS gave
    // us the access we need. For mic, the renderer side runs a 1-second
    // getUserMedia capture and checks RMS amplitude (calls back here only
    // for status reporting). For accessibility, only the main process can
    // probe via osascript.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Probe macOS Accessibility permission by attempting a no-op keystroke
     * via System Events. If accessibility is NOT granted, osascript exits
     * non-zero with a message containing "1002" or "not allowed". Returns
     * { status: 'granted'|'denied'|'unknown', message }.
     *
     * Why this is sufficient: the only thing Windy Pro needs Accessibility
     * for is keystroke injection (paste-to-cursor). If System Events lets
     * us issue a keystroke at all, paste-to-cursor will work.
     */
    ipcMain.handle('wizard-verify-accessibility', async () => {
      wizardLog('IPC wizard-verify-accessibility ENTRY');
      if (process.platform !== 'darwin') {
        // No equivalent permission on Windows / Linux — caller should
        // verify the paste tool itself works (separate Phase 6 check).
        wizardLog('IPC wizard-verify-accessibility EXIT: not applicable on this platform');
        return { status: 'granted', message: 'Not required on this platform' };
      }
      try {
        const { exec } = require('child_process');
        const result = await new Promise((resolve) => {
          exec(
            `osascript -e 'tell application "System Events" to keystroke ""' 2>&1`,
            { timeout: 8000 },
            (err, stdout, stderr) => {
              const out = `${stdout || ''}${stderr || ''}`;
              if (!err) {
                resolve({ status: 'granted', message: 'Accessibility granted' });
              } else if (/not allowed|1002|1043|assistive access/i.test(out)) {
                resolve({ status: 'denied', message: out.trim().slice(0, 200) });
              } else {
                resolve({ status: 'unknown', message: out.trim().slice(0, 200) });
              }
            }
          );
        });
        wizardLog(`IPC wizard-verify-accessibility EXIT: ${result.status}`);
        return result;
      } catch (e) {
        wizardLog(`IPC wizard-verify-accessibility THREW: ${e.message}`);
        return { status: 'unknown', message: e.message };
      }
    });

    /**
     * Get the OS-reported microphone authorisation status. The renderer
     * owns the actual amplitude probe (getUserMedia + AudioContext); this
     * handler just lets the wizard show the right message before/after.
     */
    ipcMain.handle('wizard-mic-status', async () => {
      wizardLog('IPC wizard-mic-status ENTRY');
      if (process.platform === 'darwin') {
        try {
          const { systemPreferences } = require('electron');
          const status = systemPreferences.getMediaAccessStatus('microphone');
          wizardLog(`IPC wizard-mic-status EXIT: ${status}`);
          return { status };
        } catch (e) {
          return { status: 'unknown', error: e.message };
        }
      }
      // On Linux/Windows the OS-level status is unreliable — let the
      // renderer probe getUserMedia and report.
      return { status: 'check-needed' };
    });

    /**
     * Open the OS Settings deep-link for the requested permission. The
     * wizard then re-runs verification when its window regains focus.
     *
     * `which` ∈ { 'microphone', 'accessibility' }
     */
    ipcMain.handle('wizard-open-perm-settings', async (event, which) => {
      wizardLog(`IPC wizard-open-perm-settings: ${which}`);
      const { exec } = require('child_process');
      try {
        if (process.platform === 'darwin') {
          const urls = {
            microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
            accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
          };
          const url = urls[which];
          if (!url) return { ok: false, error: `unknown permission: ${which}` };
          exec(`open "${url}"`);
        } else if (process.platform === 'win32') {
          const urls = {
            microphone: 'ms-settings:privacy-microphone',
            accessibility: 'ms-settings:easeofaccess-keyboard',
          };
          exec(`start ${urls[which] || 'ms-settings:privacy'}`);
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    // ═════════════════════════════════════════════════════════════════════
    // Phase 6: Linux paste tooling (xdotool/ydotool/wl-clipboard/xclip).
    // Only relevant on Linux — handlers are still registered everywhere
    // so the renderer can probe and get a clean "not applicable" reply
    // from the same code path.
    // ═════════════════════════════════════════════════════════════════════
    const pasteVerify = require('./core/paste-verify');

    ipcMain.handle('wizard-paste-detect', async () => {
      wizardLog('IPC wizard-paste-detect ENTRY');
      const r = await pasteVerify.detect();
      wizardLog(`IPC wizard-paste-detect EXIT: applicable=${r.applicable} ready=${r.ready} session=${r.session}`);
      return r;
    });

    ipcMain.handle('wizard-paste-install', async () => {
      wizardLog('IPC wizard-paste-install ENTRY');
      const r = await pasteVerify.install();
      wizardLog(`IPC wizard-paste-install EXIT: ok=${r.ok} requiresReLogin=${r.requiresReLogin}`);
      return r;
    });

    ipcMain.handle('wizard-paste-test-inject', async () => {
      wizardLog('IPC wizard-paste-test-inject ENTRY');
      const r = await pasteVerify.injectTestKeystroke();
      wizardLog(`IPC wizard-paste-test-inject EXIT: ok=${r.ok}`);
      return r;
    });

    // ─── Cancel (abort downloads and close) ───
    ipcMain.handle('wizard-cancel', async () => {
      this.downloadManager.abort();
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return true;
    });
  }

  /**
   * Send progress to renderer
   */
  sendProgress(data) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('wizard-progress', data);
    }
  }

  /**
   * Check if first-run setup is needed
   */
  static needsSetup(appDataDir) {
    const configPath = path.join(appDataDir, 'config.json');
    return !fs.existsSync(configPath);
  }

  /**
   * Convert raw errors into user-friendly messages
   */
  _friendlyError(error) {
    const msg = error.message || String(error);

    // Wizard-internal fail-fast timeouts. The label tells the user (and
    // support) exactly which step never completed — ten times more useful
    // than a silent spinner.
    if (error && error.timedOut && error.label) {
      return `Setup got stuck while running "${error.label}" (no progress in ${Math.round(error.timeoutMs / 1000)}s). The full diagnostic log is at ${getLogPath()} — please share that file with support.`;
    }

    // Network errors
    if (msg.includes('No internet connection') || msg.includes('ENOTFOUND') || msg.includes('ENETUNREACH')) {
      return 'No internet connection detected. Please connect to the internet and try again.';
    }
    if (msg.includes('Network timeout') || msg.includes('ETIMEDOUT') || msg.includes('ESOCKETTIMEDOUT')) {
      return 'Network connection timed out. Please check your internet connection and try again.';
    }
    if (msg.includes('Too many redirects')) {
      return 'A download server is misconfigured. Please try again later.';
    }
    if (msg.includes('HTTP 4') || msg.includes('HTTP 5')) {
      return `A download server returned an error (${msg}). Please try again later.`;
    }

    // Disk errors
    if (msg.includes('ENOSPC') || msg.includes('no space left')) {
      return 'Not enough disk space to complete the installation. Please free up space and try again.';
    }

    // Permission errors
    if (msg.includes('EACCES') || msg.includes('permission denied') || msg.includes('EPERM')) {
      return 'Permission denied. Try running the installer with administrator/sudo privileges.';
    }

    // Python/pip errors
    if (msg.includes('Could not install Python')) {
      return 'Could not install Python automatically. Please install Python 3.9+ manually and try again.';
    }
    if (msg.includes('pip') && msg.includes('install')) {
      return `A Python package failed to install: ${msg.substring(0, 200)}`;
    }

    // Generic fallback — truncate very long error messages
    if (msg.length > 300) {
      return msg.substring(0, 300) + '…';
    }
    return msg;
  }
}

module.exports = { InstallWizard, getLinuxAdapter };
