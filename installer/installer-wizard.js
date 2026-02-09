/**
 * Windy Pro - Installer Wizard
 * TurboTax-style 6-screen setup wizard for first-run experience.
 * 
 * DNA Strand: B4.5
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { HardwareDetector, ModelSelector } = require('./hardware-detect');
const { DependencyInstaller } = require('./dependency-installer');

class InstallerWizard {
    constructor() {
        this.window = null;
        this.detector = new HardwareDetector();
        this.installer = new DependencyInstaller();
        this.hardware = null;
        this.recommendation = null;
        this.selectedModel = null;
    }

    /**
     * Show the installer wizard window
     * @returns {Promise<boolean>} true if installation completed
     */
    async show() {
        return new Promise((resolve) => {
            this.window = new BrowserWindow({
                width: 560,
                height: 440,
                resizable: false,
                frame: true,
                center: true,
                title: 'Windy Pro Setup',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'installer-preload.js')
                }
            });

            this.window.loadFile(path.join(__dirname, 'screens', 'installer.html'));
            this.window.setMenuBarVisibility(false);

            this.setupIPC();

            this.window.on('closed', () => {
                this.window = null;
                resolve(this.installer.isInstalled());
            });
        });
    }

    setupIPC() {
        // Hardware scan
        ipcMain.handle('installer-scan-hardware', async () => {
            this.hardware = await this.detector.detect();
            this.recommendation = ModelSelector.recommend(this.hardware);
            return { hardware: this.hardware, recommendation: this.recommendation };
        });

        // Select model
        ipcMain.handle('installer-select-model', async (event, modelName) => {
            this.selectedModel = modelName || this.recommendation.model;
            return { model: this.selectedModel };
        });

        // Run installation
        ipcMain.handle('installer-install', async () => {
            const model = this.selectedModel || this.recommendation?.model || 'base';

            this.installer.setProgressCallback((step, percent, message) => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.webContents.send('installer-progress', { step, percent, message });
                }
            });

            try {
                await this.installer.installAll(model);
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        // Check permissions
        ipcMain.handle('installer-check-permissions', async () => {
            return this.installer.checkPermissions();
        });

        // Complete — close wizard
        ipcMain.handle('installer-complete', async () => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.close();
            }
            return true;
        });
    }

    /**
     * Check if first-run setup is needed
     */
    static needsSetup() {
        const installer = new DependencyInstaller();
        return !installer.isInstalled();
    }
}

module.exports = { InstallerWizard };
