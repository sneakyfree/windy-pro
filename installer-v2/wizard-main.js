/**
 * Windy Pro v2.0 — Installation Wizard (Main Process)
 * Electron main process that orchestrates the full install.
 * 
 * This is the shared core that all platform wizards use.
 * Platform-specific adapters handle dependency installation.
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

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const ENGINES_DIR = path.join(APP_DIR, 'engines');

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
          preload: path.join(__dirname, 'wizard-preload.js')
        }
      });

      this.window.loadFile(path.join(__dirname, 'screens', 'wizard.html'));
      this.window.setMenuBarVisibility(false);

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

      this.window.on('closed', () => {
        this.window = null;
        resolve(true);
      });
    });
  }

  setupIPC() {
    // ─── Prior Version Check ───
    ipcMain.handle('wizard-check-prior-install', async () => {
      const cleanSlate = new CleanSlate({ preserveModels: true });
      const detection = cleanSlate._detect();
      return detection;
    });

    // ─── Hardware Scan ───
    ipcMain.handle('wizard-scan-hardware', async () => {
      this.hardware = await this.detector.detect();
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

      return {
        hardware: this.hardware,
        recommendation: this.recommendation,
        models: annotatedModels,
        storageState // includes freeStorage, recommendedModels, modelStatuses, downloadEstimate
      };
    });

    // ─── Model Selection (set all) ───
    ipcMain.handle('wizard-select-models', async (event, modelIds) => {
      this.selectedEngines = Array.isArray(modelIds) ? modelIds : [modelIds];
      const result = this.storageEngines.setSelectedModels(this.selectedEngines);
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
      const models = this.selectedEngines.length > 0 ? this.selectedEngines : this.recommendation?.recommended || ['windy-stt-lite-ct2'];
      console.log('[InstallWizard] Starting install for models:', models);

      try {
        // ═══ Phase 0: CLEAN SLATE — Remove any prior installation ═══
        this.sendProgress({
          percent: 1,
          message: '🧹 Checking for prior Windy Pro installation...',
          detail: 'Ensuring a clean start — removing any old files, processes, or configs'
        });
        console.log('[InstallWizard] Phase 0: Clean Slate');

        const cleanSlate = new CleanSlate({
          preserveModels: true, // Don't re-download gigabytes of models
          onProgress: (pct) => this.sendProgress({ percent: 1 + pct * 0.04 }),
          onLog: (msg) => console.log(msg)
        });
        const cleanResult = await cleanSlate.run();

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
        this.sendProgress({
          percent: 5,
          message: INSTALL_STEP_MESSAGES['check-deps']?.title || '🌪️ Preparing the Windy Ecosystem',
          detail: INSTALL_STEP_MESSAGES['check-deps']?.detail || 'Installing Python, ffmpeg, audio tools, and everything you need...'
        });
        console.log('[InstallWizard] Phase 1: Dependencies (bundled-first strategy)');

        const depInstaller = new DependencyInstaller({
          onLog: (msg) => console.log(msg),
          onProgress: (pct) => {
            this.sendProgress({
              percent: 5 + pct * 0.19, // 5% to 24%
              message: '🌪️ Installing dependencies...',
              detail: `${pct}% complete`
            });
          }
        });

        const depResult = await depInstaller.installAll();
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

        await this.downloadManager.downloadModels(
          models,
          // Per-model progress callback
          (modelId, progress) => {
            const modelInfo = ENGINE_CATALOG.find(m => m.id === modelId);
            const modelName = modelInfo?.shortName || modelInfo?.name || modelId;
            const modelSize = modelInfo ? formatSize(modelInfo.sizeMB) : '?';
            this.sendProgress({
              percent: modelStart + (progress / 100) * modelRange * 0.8,
              message: `${INSTALL_STEP_MESSAGES['download-model']?.title || 'Downloading'} — ${modelName}`,
              detail: `Downloading ${modelName} (${modelSize})`,
            });
          },
          // Overall progress callback
          (overallPercent, completed, total) => {
            this.sendProgress({
              percent: modelStart + (overallPercent / 100) * modelRange,
              detail: `Model ${completed} of ${total} complete`,
            });
          }
        );

        // Phase 3: Verify
        this.sendProgress({
          percent: 92,
          message: INSTALL_STEP_MESSAGES['verify'].title,
          detail: INSTALL_STEP_MESSAGES['verify'].detail
        });

        if (this.platformAdapter) {
          await this.platformAdapter.verify();
        }

        // Phase 4: Permissions
        this.sendProgress({
          percent: 96,
          message: INSTALL_STEP_MESSAGES['permissions'].title,
          detail: INSTALL_STEP_MESSAGES['permissions'].detail
        });

        if (this.platformAdapter) {
          await this.platformAdapter.requestPermissions();
        }

        // Done!
        this.sendProgress({
          percent: 100,
          message: INSTALL_STEP_MESSAGES['complete'].title,
          detail: INSTALL_STEP_MESSAGES['complete'].detail
        });

        // Write config.json to mark installation as complete
        const configPath = path.join(APP_DIR, 'config.json');
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
          version: '0.5.0',
          installedAt: new Date().toISOString(),
          models: models,
          defaultModel: models[0] || 'edge-pulse'
        }, null, 2));

        return { success: true, models };

      } catch (error) {
        return { success: false, error: error.message };
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
      // TODO: Integrate with account server for actual purchase
      // For now, store the selection locally
      try {
        const configPath = path.join(APP_DIR, 'translate-config.json');
        fs.writeFileSync(configPath, JSON.stringify({
          tier, // 'translate' ($79) or 'translate-pro' ($149) or 'deferred'
          purchasedAt: tier === 'deferred' ? null : new Date().toISOString(),
          deferredAt: tier === 'deferred' ? new Date().toISOString() : null
        }, null, 2));
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
    const fs = require('fs');
    const configPath = path.join(appDataDir, 'config.json');
    return !fs.existsSync(configPath);
  }
}

module.exports = { InstallWizard, getLinuxAdapter };
