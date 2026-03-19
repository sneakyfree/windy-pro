/**
 * Windy Pro — License Heartbeat Service (Layer 2)
 *
 * Validates the user's license at regular intervals to ensure models
 * are only accessible to active, paying users.
 *
 * - Runs every 48 hours via setInterval
 * - Checks on startup if lastCheckTime > 48 hours ago
 * - Tiered offline grace periods (Free: 24h, Pro: 7d, Ultra: 14d, Max/Marco Polo: 30d)
 * - On grace expiry: lock models (wipe key from memory)
 * - On re-verification: unlock models
 * - On revoked license: delete all model files
 *
 * DNA Strand: L6 (Model Protection Layer 2)
 */

'use strict';

const https = require('https');

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const HEARTBEAT_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 hours

// Tiered grace periods in hours
const GRACE_PERIODS = {
  free:           24,       // 24 hours
  pro:            168,      // 7 days
  translate:      336,      // 14 days (Ultra)
  translate_pro:  720,      // 30 days (Max)
  marco_polo:     720       // 30 days
};

// Heartbeat endpoint — configurable via env for local testing
const HEARTBEAT_URL = process.env.WINDY_HEARTBEAT_URL
  || 'https://api.windyword.com/v1/license/heartbeat';

class HeartbeatService {
  /**
   * @param {object} opts
   * @param {object} opts.store — electron-store instance
   * @param {object} opts.safeStorage — Electron safeStorage module
   * @param {Function} opts.retrieveLicenseToken — returns plaintext license token
   * @param {Function} opts.getDeviceFingerprint — returns 64-char hex fingerprint
   * @param {string} opts.appVersion — app version string
   * @param {Function} opts.onLicenseLocked — called when grace period expires
   * @param {Function} opts.onLicenseRestored — called(tier) on successful re-verification
   * @param {Function} opts.onLicenseRevoked — called when license is revoked
   */
  constructor(opts) {
    this.store = opts.store;
    this.safeStorage = opts.safeStorage;
    this.retrieveLicenseToken = opts.retrieveLicenseToken;
    this.getDeviceFingerprint = opts.getDeviceFingerprint;
    this.appVersion = opts.appVersion || '1.0.0';
    this.onLicenseLocked = opts.onLicenseLocked || (() => {});
    this.onLicenseRestored = opts.onLicenseRestored || (() => {});
    this.onLicenseRevoked = opts.onLicenseRevoked || (() => {});
    this._timer = null;
  }

  /**
   * Start the heartbeat service.
   * Checks immediately if lastCheck > 48h ago, then schedules repeating checks.
   */
  start() {
    // Check if overdue
    const lastCheck = this.store.get('heartbeat.lastCheckTime', 0);
    const elapsed = Date.now() - lastCheck;

    if (elapsed >= HEARTBEAT_INTERVAL_MS || lastCheck === 0) {
      this._log('info', 'Overdue check — running immediately');
      this.check().catch(e => this._log('error', `Startup check failed: ${e.message}`));
    } else {
      this._log('info', `Last check ${Math.round(elapsed / 3600000)}h ago — next in ${Math.round((HEARTBEAT_INTERVAL_MS - elapsed) / 3600000)}h`);
    }

    // Schedule recurring checks
    this._timer = setInterval(() => {
      this.check().catch(e => this._log('error', `Periodic check failed: ${e.message}`));
    }, HEARTBEAT_INTERVAL_MS);

    this._log('info', 'Heartbeat service started (48h interval)');
  }

  /**
   * Stop the heartbeat service.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Perform a single heartbeat check.
   * POST to the heartbeat endpoint with license token + device fingerprint.
   */
  async check() {
    const token = this.retrieveLicenseToken();
    const tier = this.store.get('license.tier', 'free');

    if (!token || token === 'free') {
      this._log('info', 'No license token — skipping heartbeat (free tier)');
      this._checkGracePeriod(tier);
      return;
    }

    try {
      const result = await this._postHeartbeat(token);

      if (result.valid) {
        // License valid — update last check time and tier
        this.store.set('heartbeat.lastCheckTime', Date.now());
        this.store.set('heartbeat.graceStartTime', 0); // Reset grace

        if (result.tier && result.tier !== tier) {
          this._log('info', `Tier updated: ${tier} → ${result.tier}`);
          this.store.set('license.tier', result.tier);
        }

        // If models were locked, restore them
        if (this.store.get('license.modelsLocked', false)) {
          this._log('info', 'Re-verification success — unlocking models');
          this.onLicenseRestored(result.tier || tier);
        }

        this._log('info', `Heartbeat OK — tier: ${result.tier || tier}`);
      } else {
        // License invalid
        this._log('warn', `License invalid: ${result.reason || 'unknown'}`);

        if (result.reason === 'revoked') {
          this.onLicenseRevoked();
          return;
        }

        // Start grace countdown if not already started
        this._checkGracePeriod(tier);
      }
    } catch (err) {
      // Network error — use grace period
      this._log('warn', `Heartbeat request failed: ${err.message} — using grace period`);
      this._checkGracePeriod(tier);
    }
  }

  /**
   * Check if the offline grace period has expired for the given tier.
   * If expired, lock models. If not, log remaining time.
   */
  _checkGracePeriod(tier) {
    const graceHours = GRACE_PERIODS[tier] || GRACE_PERIODS.free;
    const graceMs = graceHours * 60 * 60 * 1000;

    // Use last successful check as grace start, or explicit grace start
    let graceStart = this.store.get('heartbeat.graceStartTime', 0);
    if (!graceStart) {
      graceStart = this.store.get('heartbeat.lastCheckTime', Date.now());
      this.store.set('heartbeat.graceStartTime', graceStart);
    }

    const elapsed = Date.now() - graceStart;
    const remaining = graceMs - elapsed;

    if (remaining <= 0) {
      // Grace expired — lock models
      if (!this.store.get('license.modelsLocked', false)) {
        this._log('warn', `Grace period expired (${graceHours}h for ${tier}) — locking models`);
        this.onLicenseLocked();
      }
    } else {
      const remainingHours = Math.round(remaining / 3600000);
      this._log('info', `Offline grace: ${remainingHours}h remaining (${graceHours}h total for ${tier})`);
    }
  }

  /**
   * POST to the heartbeat endpoint.
   * @param {string} token — license bearer token
   * @returns {Promise<{valid: boolean, tier?: string, graceHours?: number, reason?: string}>}
   */
  _postHeartbeat(token) {
    return new Promise((resolve, reject) => {
      const url = new URL(HEARTBEAT_URL);
      const fingerprint = this.getDeviceFingerprint();

      const postData = JSON.stringify({
        timestamp: new Date().toISOString()
      });

      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': `Bearer ${token}`,
          'X-Device-Fingerprint': fingerprint,
          'X-App-Version': this.appVersion,
          'X-Platform': 'desktop-electron'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON response from heartbeat'));
            }
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            // Token invalid or revoked
            resolve({ valid: false, reason: 'revoked' });
          } else {
            reject(new Error(`Heartbeat HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Heartbeat request timeout'));
      });
      req.write(postData);
      req.end();
    });
  }

  _log(level, msg) {
    const ts = new Date().toISOString();
    const prefix = `[Heartbeat ${ts}]`;
    if (level === 'error') console.error(`${prefix} ${msg}`);
    else if (level === 'warn') console.warn(`${prefix} ${msg}`);
    else console.log(`${prefix} ${msg}`);
  }
}

module.exports = { HeartbeatService };
