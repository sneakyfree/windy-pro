/**
 * Windy Pro - Installer Wizard
 * TurboTax-style 6-screen setup wizard for first-run experience.
 * 
 * DNA Strand: B4.5
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const { HardwareDetector, ModelSelector } = require('./hardware-detect');
const { DependencyInstaller } = require('./dependency-installer');

// Model catalog with sizes, pros, cons
const MODEL_CATALOG = [
    {
        id: 'tiny',
        name: 'Tiny',
        size_gb: 0.15,
        ram_gb: 2,
        description: 'Lightning fast. Works on any machine.',
        pros: ['Instant response', 'Runs on old/low-RAM machines', 'No GPU needed'],
        cons: ['Lower accuracy', 'Struggles with accents & technical terms'],
        best_for: 'Quick notes, simple dictation',
        badge: null
    },
    {
        id: 'base',
        name: 'Base',
        size_gb: 0.29,
        ram_gb: 4,
        description: 'Best balance of speed and accuracy for most people.',
        pros: ['Good accuracy', 'Fast on most machines', 'No GPU needed'],
        cons: ['Occasional errors on fast speech'],
        best_for: 'Everyday use, emails, documents',
        badge: '⭐ Recommended'
    },
    {
        id: 'small',
        name: 'Small',
        size_gb: 0.97,
        ram_gb: 8,
        description: 'Noticeably better accuracy. Still runs without a GPU.',
        pros: ['Strong accuracy', 'Handles accents well', 'Good for technical content'],
        cons: ['Needs 8GB+ RAM', 'Slightly slower'],
        best_for: 'Technical dictation, coding, meetings',
        badge: null
    },
    {
        id: 'medium',
        name: 'Medium',
        size_gb: 3.1,
        ram_gb: 16,
        description: 'Near-perfect accuracy. GPU recommended.',
        pros: ['Near-professional accuracy', 'Handles all accents', 'Excellent with jargon'],
        cons: ['Needs 16GB+ RAM or GPU', '3GB download'],
        best_for: 'Power users, content creators, professionals',
        badge: '🚀 Power User'
    },
    {
        id: 'large-v3',
        name: 'Large',
        size_gb: 6.2,
        ram_gb: 24,
        description: 'Professional broadcast quality. GPU strongly recommended.',
        pros: ['Best-in-class accuracy', 'Handles any language or accent', 'Indistinguishable from human transcription'],
        cons: ['Requires GPU or very fast CPU', '6GB download', 'Slower on CPU-only'],
        best_for: 'Broadcast, legal, medical, multilingual',
        badge: '💎 Professional'
    }
];

/**
 * Measure connection speed by downloading a small test file
 * Returns speed in MB/s
 */
async function measureConnectionSpeed() {
    return new Promise((resolve) => {
        const testUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
        const startTime = Date.now();
        let bytesReceived = 0;
        const timeout = setTimeout(() => resolve(1.0), 8000); // default 1 MB/s if slow

        const req = https.get(testUrl, (res) => {
            res.on('data', (chunk) => {
                bytesReceived += chunk.length;
                // After 500KB sample, extrapolate
                if (bytesReceived >= 512 * 1024) {
                    clearTimeout(timeout);
                    req.destroy();
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speedMBps = (bytesReceived / (1024 * 1024)) / elapsed;
                    resolve(Math.max(0.1, speedMBps));
                }
            });
            res.on('error', () => { clearTimeout(timeout); resolve(1.0); });
        });
        req.on('error', () => { clearTimeout(timeout); resolve(1.0); });
    });
}

/**
 * Format download time estimate
 */
function formatDownloadTime(sizeGb, speedMBps) {
    const sizeMB = sizeGb * 1024;
    const seconds = sizeMB / speedMBps;
    if (seconds < 60) return `~${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
    return `~${(seconds / 3600).toFixed(1)} hr`;
}

class InstallerWizard {
    constructor() {
        this.window = null;
        this.detector = new HardwareDetector();
        this.installer = new DependencyInstaller();
        this.hardware = null;
        this.recommendation = null;
        this.selectedModels = []; // now supports multiple
        this.connectionSpeed = null;
    }

    /**
     * Show the installer wizard window
     * @returns {Promise<boolean>} true if installation completed
     */
    async show() {
        return new Promise((resolve) => {
            this.window = new BrowserWindow({
                width: 640,
                height: 740,
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
        // Hardware scan + connection speed test (run in parallel)
        ipcMain.handle('installer-scan-hardware', async () => {
            const [hardware, connectionSpeed] = await Promise.all([
                this.detector.detect(),
                measureConnectionSpeed()
            ]);

            this.hardware = hardware;
            this.connectionSpeed = connectionSpeed;
            this.recommendation = ModelSelector.recommend(hardware);

            // Annotate model catalog with download estimates and hardware compatibility
            const annotatedModels = MODEL_CATALOG.map(model => ({
                ...model,
                download_time: formatDownloadTime(model.size_gb, connectionSpeed),
                download_speed_mbps: Math.round(connectionSpeed * 10) / 10,
                hardware_ok: hardware.ram >= model.ram_gb,
                recommended: model.id === this.recommendation.model
            }));

            return {
                hardware,
                recommendation: this.recommendation,
                models: annotatedModels,
                connectionSpeedMBps: Math.round(connectionSpeed * 10) / 10
            };
        });

        // Select models (supports array for multi-select)
        ipcMain.handle('installer-select-models', async (event, modelIds) => {
            if (Array.isArray(modelIds) && modelIds.length > 0) {
                this.selectedModels = modelIds;
            } else if (typeof modelIds === 'string') {
                this.selectedModels = [modelIds];
            } else {
                this.selectedModels = [this.recommendation?.model || 'base'];
            }
            return { models: this.selectedModels };
        });

        // Legacy single-model select (backwards compat)
        ipcMain.handle('installer-select-model', async (event, modelName) => {
            this.selectedModels = [modelName || this.recommendation?.model || 'base'];
            return { model: this.selectedModels[0] };
        });

        // Run installation (installs all selected models in sequence)
        ipcMain.handle('installer-install', async () => {
            const models = this.selectedModels.length > 0
                ? this.selectedModels
                : [this.recommendation?.model || 'base'];

            this.installer.setProgressCallback((step, percent, message) => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.webContents.send('installer-progress', { step, percent, message });
                }
            });

            try {
                // Install Python deps once
                await this.installer.installDependencies();

                // Download each selected model
                for (let i = 0; i < models.length; i++) {
                    const model = models[i];
                    const modelInfo = MODEL_CATALOG.find(m => m.id === model);
                    const label = modelInfo?.name || model;

                    if (this.window && !this.window.isDestroyed()) {
                        this.window.webContents.send('installer-progress', {
                            step: 'model',
                            percent: Math.round((i / models.length) * 80) + 10,
                            message: `Downloading ${label} model (${i + 1} of ${models.length})...`,
                            modelIndex: i,
                            modelCount: models.length
                        });
                    }

                    await this.installer.downloadModel(model);
                }

                // Set first selected model as default active
                await this.installer.setDefaultModel(models[0]);

                return { success: true, models };
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

        // Get model catalog (for in-app model manager)
        ipcMain.handle('get-model-catalog', async () => {
            const speed = this.connectionSpeed || 1.0;
            return MODEL_CATALOG.map(m => ({
                ...m,
                download_time: formatDownloadTime(m.size_gb, speed)
            }));
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

module.exports = { InstallerWizard, MODEL_CATALOG, formatDownloadTime };
