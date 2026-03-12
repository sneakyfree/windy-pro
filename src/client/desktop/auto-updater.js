/**
 * Windy Pro — Auto-Updater (B1.1)
 * 
 * Checks for updates on startup and periodically.
 * Uses a simple GitHub Releases/custom endpoint check pattern.
 * 
 * For Electron apps: integrates with electron-updater when available.
 * For standalone installs: downloads and prompts for manual update.
 */

const { app, dialog, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const log = require('./logger')('AutoUpdater');

class AutoUpdater {
    constructor(options = {}) {
        this.currentVersion = options.version || app?.getVersion?.() || '1.0.0';
        this.updateUrl = options.updateUrl || 'https://windypro.thewindstorm.uk/api/v1/updates/check';
        this.checkInterval = options.checkInterval || 4 * 3600 * 1000; // 4 hours
        this.autoDownload = options.autoDownload !== false;
        this._timer = null;
        this._checking = false;
        this._onUpdate = options.onUpdate || null;
    }

    /**
     * Start periodic update checks
     */
    start() {
        // Check on startup (after a short delay to avoid blocking)
        setTimeout(() => this.checkForUpdates(), 10000);
        // Schedule periodic checks
        this._timer = setInterval(() => this.checkForUpdates(), this.checkInterval);
    }

    /**
     * Stop update checks
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /**
     * Check for updates
     * Returns { available, version, url, releaseNotes } or null
     */
    async checkForUpdates() {
        if (this._checking) return null;
        this._checking = true;

        try {
            const platform = process.platform === 'darwin' ? 'mac' :
                process.platform === 'win32' ? 'win' : 'linux';
            const arch = process.arch;
            const url = `${this.updateUrl}?v=${this.currentVersion}&platform=${platform}&arch=${arch}`;

            const data = await this._httpGet(url);
            const update = JSON.parse(data);

            if (update.available && this._isNewer(update.version)) {
                log.state('checkForUpdates', `update available: v${update.version}`);

                if (this._onUpdate) {
                    this._onUpdate(update);
                } else {
                    this._showUpdateDialog(update);
                }

                return update;
            }

            log.exit('checkForUpdates', { upToDate: true });
            return null;
        } catch (err) {
            log.warn('checkForUpdates', `check failed: ${err.message}`);
            return null;
        } finally {
            this._checking = false;
        }
    }

    /**
     * Compare semver versions
     */
    _isNewer(remoteVersion) {
        const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
        const [rMajor, rMinor, rPatch] = parse(remoteVersion);
        const [cMajor, cMinor, cPatch] = parse(this.currentVersion);

        if (rMajor > cMajor) return true;
        if (rMajor === cMajor && rMinor > cMinor) return true;
        if (rMajor === cMajor && rMinor === cMinor && rPatch > cPatch) return true;
        return false;
    }

    /**
     * Show native update dialog
     */
    _showUpdateDialog(update) {
        const options = {
            type: 'info',
            title: 'Windy Pro Update Available',
            message: `Version ${update.version} is available!`,
            detail: update.releaseNotes || 'Bug fixes and improvements.',
            buttons: ['Download & Install', 'Later'],
            defaultId: 0,
            cancelId: 1
        };

        dialog.showMessageBox(options).then(({ response }) => {
            if (response === 0) {
                // SEC-B: Only allow HTTPS download URLs — block file://, javascript:, etc.
                if (update.downloadUrl && update.downloadUrl.startsWith('https://')) {
                    shell.openExternal(update.downloadUrl);
                } else if (update.downloadUrl) {
                    log.warn('_showUpdateDialog', `Blocked non-HTTPS download URL: ${update.downloadUrl}`);
                }
            }
        }).catch(() => { });
    }

    /**
     * Simple HTTPS GET
     */
    _httpGet(url) {
        return new Promise((resolve, reject) => {
            https.get(url, { timeout: 10000 }, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }
}

module.exports = { AutoUpdater };
