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
        // Don't auto-download — let user choose
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        // Update events
        autoUpdater.on('checking-for-update', () => {
            console.log('[Updater] Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log(`[Updater] Update available: ${info.version}`);
            this.updateAvailable = true;
            this.promptUpdate(info);
        });

        autoUpdater.on('update-not-available', () => {
            console.log('[Updater] App is up to date.');
        });

        autoUpdater.on('download-progress', (progress) => {
            this.downloadProgress = Math.round(progress.percent);
            console.log(`[Updater] Download: ${this.downloadProgress}%`);
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log(`[Updater] Update downloaded: ${info.version}`);
            this.promptRestart(info);
        });

        autoUpdater.on('error', (error) => {
            console.error('[Updater] Error:', error.message);
        });
    }

    /**
     * Check for updates (call on app startup).
     * Only checks once per day to avoid spamming GitHub API.
     */
    checkForUpdates() {
        try {
            const store = new Store();
            const lastCheck = store.get('lastUpdateCheck', 0);
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (Date.now() - lastCheck < oneDayMs) {
                console.log('[Updater] Skipping — checked within last 24h');
                return;
            }
            store.set('lastUpdateCheck', Date.now());
            autoUpdater.checkForUpdates();
        } catch (error) {
            console.log('[Updater] Check failed (offline?):', error.message);
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
            console.log('[Updater] Force check failed:', error.message);
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
}

module.exports = { WindyUpdater };
