/**
 * Windy Pro - Auto Updater
 * Checks for updates on startup and prompts user to install.
 * 
 * Uses GitHub Releases as the update source.
 * 
 * DNA Strand: FEAT-068
 */

const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow, Notification } = require('electron');
const Store = require('electron-store');

class WindyUpdater {
    constructor() {
        this.updateAvailable = false;
        this.downloadProgress = 0;

        this.configure();
    }

    configure() {
        // Auto-download and install on quit
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        // GitHub releases feed
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'sneakyfree',
            repo: 'windy-pro'
        });

        // Update events
        autoUpdater.on('checking-for-update', () => {
            console.info('[Updater] Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            console.info(`[Updater] Update available: ${info.version}`);
            this.updateAvailable = true;
            // Non-intrusive toast — send to renderer
            this._sendToast(`🔄 Windy Pro v${info.version} is downloading in the background…`);
        });

        autoUpdater.on('update-not-available', () => {
            console.info('[Updater] App is up to date.');
        });

        autoUpdater.on('download-progress', (progress) => {
            this.downloadProgress = Math.round(progress.percent);
            console.info(`[Updater] Download: ${this.downloadProgress}%`);
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.info(`[Updater] Update downloaded: ${info.version}`);
            this._sendToast(`✅ Windy Pro v${info.version} is ready. Restart to update.`, true);
        });

        autoUpdater.on('error', (error) => {
            console.error('[Updater] Error:', error.message);
        });
    }

    /**
     * Send non-intrusive toast to renderer
     */
    _sendToast(message, canRestart = false) {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send('update-toast', { message, canRestart });
        }
    }

    /**
     * Check for updates (call on app startup).
     * Only checks once per day to avoid spamming GitHub API.
     */
    checkForUpdates() {
        try {
            const store = new Store();
            const lastCheck = store.get('lastUpdateCheck', 0);
            const sixHoursMs = 6 * 60 * 60 * 1000;
            if (Date.now() - lastCheck < sixHoursMs) {
                
                return;
            }
            store.set('lastUpdateCheck', Date.now());
            autoUpdater.checkForUpdates();
        } catch (error) {
            console.error('[Updater] Check failed (offline?):', error.message);
        }
    }

    /**
     * Force check (from settings button), ignores daily limit.
     */
    forceCheck() {
        try {
            const store = new Store();
            store.set('lastUpdateCheck', Date.now());
            autoUpdater.checkForUpdates();
        } catch (error) {
            console.error('[Updater] Force check failed:', error.message);
        }
    }

    /**
     * Prompt user about available update
     */
    async promptUpdate(info) {
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Available',
            message: `Windy Pro v${info.version} is available.`,
            detail: 'Would you like to download and install it?',
            buttons: ['Download', 'Later'],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    }

    /**
     * Prompt user to restart after download
     */
    async promptRestart(info) {
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Ready',
            message: `Windy Pro v${info.version} has been downloaded.`,
            detail: 'Restart now to apply the update?',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    }

    /**
     * Install downloaded update immediately (quit and install)
     */
    installUpdate() {
        console.info('[Updater] Installing update and restarting...');
        autoUpdater.quitAndInstall();
    }
}

module.exports = { WindyUpdater };
