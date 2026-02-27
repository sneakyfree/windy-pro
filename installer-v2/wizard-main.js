/**
 * Windy Pro v2.0 — Installation Wizard (Main Process)
 * Electron main process that orchestrates the full install.
 * 
 * This is the shared core that all platform wizards use.
 * Platform-specific adapters handle dependency installation.
 */

const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const { HardwareDetector } = require('./core/hardware-detect');
const { MODEL_CATALOG, MODEL_FAMILIES, getTotalSize, formatSize } = require('./core/models');
const { recommend, estimateDownloadTime } = require('./core/windytune');
const { INSTALL_STEP_MESSAGES, getRandomLoadingMessage } = require('./core/brand-content');

class InstallWizard {
  constructor(opts = {}) {
    this.window = null;
    this.detector = new HardwareDetector();
    this.hardware = null;
    this.recommendation = null;
    this.selectedModels = [];
    this.platformAdapter = opts.platformAdapter || null; // Injected per platform
  }

  /**
   * Show the wizard window
   */
  async show() {
    return new Promise((resolve) => {
      this.window = new BrowserWindow({
        width: 700,
        height: 820,
        minWidth: 600,
        minHeight: 700,
        resizable: true,
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

      this.setupIPC();

      this.window.on('closed', () => {
        this.window = null;
        resolve(true);
      });
    });
  }

  setupIPC() {
    // ─── Hardware Scan ───
    ipcMain.handle('wizard-scan-hardware', async () => {
      this.hardware = await this.detector.detect();
      this.recommendation = recommend(this.hardware);

      // Annotate models with hardware compatibility
      const annotatedModels = MODEL_CATALOG.map(m => ({
        ...m,
        hardwareOk: this.hardware.ram.totalGB >= m.ramGB,
        familyInfo: MODEL_FAMILIES[m.family]
      }));

      return {
        hardware: this.hardware,
        recommendation: this.recommendation,
        models: annotatedModels
      };
    });

    // ─── Model Selection ───
    ipcMain.handle('wizard-select-models', async (event, modelIds) => {
      this.selectedModels = Array.isArray(modelIds) ? modelIds : [modelIds];
      return { selected: this.selectedModels };
    });

    // ─── Install ───
    ipcMain.handle('wizard-install', async () => {
      const models = this.selectedModels.length > 0 ? this.selectedModels : this.recommendation?.recommended || ['edge-spark'];

      try {
        // Phase 1: Dependencies
        this.sendProgress({
          percent: 2,
          message: INSTALL_STEP_MESSAGES['check-deps'].title,
          detail: INSTALL_STEP_MESSAGES['check-deps'].detail
        });

        if (this.platformAdapter) {
          // Install Python environment
          this.sendProgress({
            percent: 5,
            message: INSTALL_STEP_MESSAGES['install-python'].title,
            detail: INSTALL_STEP_MESSAGES['install-python'].detail
          });
          await this.platformAdapter.installPython((pct) => {
            this.sendProgress({ percent: 5 + pct * 0.1 });
          });

          // Install ffmpeg
          this.sendProgress({
            percent: 15,
            message: INSTALL_STEP_MESSAGES['install-ffmpeg'].title,
            detail: INSTALL_STEP_MESSAGES['install-ffmpeg'].detail
          });
          await this.platformAdapter.installFfmpeg((pct) => {
            this.sendProgress({ percent: 15 + pct * 0.05 });
          });

          // Install CUDA if NVIDIA GPU
          if (this.hardware?.gpu?.nvidia) {
            this.sendProgress({
              percent: 20,
              message: INSTALL_STEP_MESSAGES['install-cuda'].title,
              detail: INSTALL_STEP_MESSAGES['install-cuda'].detail
            });
            await this.platformAdapter.installCuda((pct) => {
              this.sendProgress({ percent: 20 + pct * 0.05 });
            });
          }
        }

        // Phase 2: Download models (this is the long part — 25% to 90%)
        const modelRange = 65; // 25% to 90%
        const modelStart = 25;

        for (let i = 0; i < models.length; i++) {
          const modelId = models[i];
          const modelInfo = MODEL_CATALOG.find(m => m.id === modelId);
          const modelName = modelInfo?.shortName || modelInfo?.name || modelId;
          const modelSize = modelInfo ? formatSize(modelInfo.sizeMB) : '?';

          const basePercent = modelStart + (i / models.length) * modelRange;
          const modelShare = modelRange / models.length;

          this.sendProgress({
            percent: basePercent,
            message: `${INSTALL_STEP_MESSAGES['download-model'].title} — ${modelName}`,
            detail: `Downloading ${modelName} (${modelSize}) · Model ${i + 1} of ${models.length}`,
            modelId,
            modelPercent: 0
          });

          // Simulate download (replace with real download in platform adapter)
          if (this.platformAdapter) {
            await this.platformAdapter.downloadModel(modelId, modelInfo, (pct) => {
              this.sendProgress({
                percent: basePercent + (pct / 100) * modelShare,
                modelId,
                modelPercent: pct
              });
            });
          } else {
            // Simulation for testing
            for (let p = 0; p <= 100; p += 5) {
              await new Promise(r => setTimeout(r, 100));
              this.sendProgress({
                percent: basePercent + (p / 100) * modelShare,
                modelId,
                modelPercent: p
              });
            }
          }

          this.sendProgress({ modelId, modelDone: true });
        }

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

        return { success: true, models };

      } catch (error) {
        return { success: false, error: error.message };
      }
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

module.exports = { InstallWizard };
