/**
 * Windy Pro v2.0 — Account Manager
 * Handles user authentication, device registration (5-device limit),
 * license verification, and tier detection.
 * 
 * API endpoint: https://api.windyword.ai/v1
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Production: const API_BASE = 'https://api.windyword.ai/v1';
const API_BASE = process.env.ACCOUNT_API || 'http://localhost:8098/v1';
const MAX_DEVICES = 5;

class AccountManager {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.configPath = path.join(appDataDir, 'account.json');
    this.account = this._loadAccount();
  }

  /**
   * Register a new account
   */
  async register(name, email, password) {
    const response = await this._apiPost('/auth/register', {
      name,
      email,
      password,
      deviceId: this.getDeviceId(),
      deviceName: this.getDeviceName(),
      platform: process.platform
    });

    if (response.error) {
      throw new Error(response.error);
    }

    this.account = {
      userId: response.userId,
      email,
      name,
      token: response.token,
      refreshToken: response.refreshToken,
      tier: response.tier || 'free',
      devices: response.devices || [],
      deviceId: this.getDeviceId(),
      createdAt: new Date().toISOString()
    };

    this._saveAccount();
    return this.account;
  }

  /**
   * Login with existing account
   */
  async login(email, password) {
    const response = await this._apiPost('/auth/login', {
      email,
      password,
      deviceId: this.getDeviceId(),
      deviceName: this.getDeviceName(),
      platform: process.platform
    });

    if (response.error) {
      throw new Error(response.error);
    }

    this.account = {
      userId: response.userId,
      email,
      name: response.name,
      token: response.token,
      refreshToken: response.refreshToken,
      tier: response.tier || 'free',
      devices: response.devices || [],
      deviceId: this.getDeviceId(),
      lastLogin: new Date().toISOString()
    };

    this._saveAccount();
    return this.account;
  }

  /**
   * Create a free-tier offline account (no server needed)
   */
  createFreeAccount() {
    this.account = {
      userId: `local-${this.getDeviceId().slice(0, 12)}`,
      email: null,
      name: 'Free User',
      token: null,
      tier: 'free',
      devices: [{ id: this.getDeviceId(), name: this.getDeviceName(), platform: process.platform }],
      deviceId: this.getDeviceId(),
      offline: true,
      createdAt: new Date().toISOString()
    };

    this._saveAccount();
    return this.account;
  }

  /**
   * Check if device is registered (within 5-device limit)
   */
  async checkDevice() {
    if (!this.account?.token) return { ok: true, offline: true };

    try {
      const response = await this._apiGet('/auth/devices', this.account.token);

      if (response.devices) {
        this.account.devices = response.devices;
        this._saveAccount();

        const thisDevice = response.devices.find(d => d.id === this.getDeviceId());
        if (thisDevice) {
          return { ok: true, devices: response.devices };
        }

        // Not registered — check limit
        if (response.devices.length >= MAX_DEVICES) {
          return {
            ok: false,
            reason: 'device-limit',
            devices: response.devices,
            message: `You've reached the ${MAX_DEVICES}-device limit. Remove a device from your account to add this one.`
          };
        }

        // Register this device
        const regResponse = await this._apiPost('/auth/devices/register', {
          deviceId: this.getDeviceId(),
          deviceName: this.getDeviceName(),
          platform: process.platform
        }, this.account.token);

        return { ok: !regResponse.error, devices: regResponse.devices || response.devices };
      }

      return { ok: true };
    } catch (e) {
      // Offline — allow anyway
      return { ok: true, offline: true };
    }
  }

  /**
   * Remove a device from the account
   */
  async removeDevice(deviceId) {
    if (!this.account?.token) throw new Error('Not logged in');

    const response = await this._apiPost('/auth/devices/remove', {
      deviceId
    }, this.account.token);

    if (response.devices) {
      this.account.devices = response.devices;
      this._saveAccount();
    }

    return response;
  }

  /**
   * Get current tier
   */
  getTier() {
    return this.account?.tier || 'free';
  }

  /**
   * Get auth token for model downloads
   */
  getToken() {
    return this.account?.token || null;
  }

  /**
   * Fetch the extended identity view (including provisioned products:
   * mailbox, chat handle, cloud quota) for the currently-authenticated
   * user. Used by the wizard Complete screen.
   *
   * Returns null for offline / free-tier accounts (no token to present).
   */
  async getIdentity() {
    if (!this.account?.token) return null;
    // /api/v1/identity/* isn't aliased under /v1 the way /auth/* is, so
    // reach it through the API root directly.
    const rootUrl = API_BASE.replace(/\/v1\/?$/, '');
    return this._apiRequestAbsolute(
      'GET',
      `${rootUrl}/api/v1/identity/me`,
      null,
      this.account.token,
    );
  }

  /**
   * Check if logged in
   */
  isLoggedIn() {
    return !!(this.account?.token || this.account?.offline);
  }

  /**
   * Refresh auth token
   */
  async refreshAuth() {
    if (!this.account?.refreshToken) return false;

    try {
      const response = await this._apiPost('/auth/refresh', {
        refreshToken: this.account.refreshToken,
        deviceId: this.getDeviceId()
      });

      if (response.token) {
        this.account.token = response.token;
        if (response.refreshToken) this.account.refreshToken = response.refreshToken;
        if (response.tier) this.account.tier = response.tier;
        this._saveAccount();
        return true;
      }
    } catch (e) { console.debug('[Account] Token refresh error:', e.message); }

    return false;
  }

  /**
   * Generate unique device ID based on hardware
   */
  getDeviceId() {
    const data = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || '',
      os.totalmem().toString(),
      // MAC address of first non-internal interface
      ...Object.values(os.networkInterfaces())
        .flat()
        .filter(i => !i.internal && i.mac !== '00:00:00:00:00:00')
        .map(i => i.mac)
        .slice(0, 1)
    ].join('|');

    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  /**
   * Human-readable device name
   */
  getDeviceName() {
    const platformNames = {
      linux: 'Linux',
      darwin: 'macOS',
      win32: 'Windows',
      android: 'Android'
    };
    const platform = platformNames[process.platform] || process.platform;
    return `${os.hostname()} (${platform})`;
  }

  /**
   * Logout
   */
  logout() {
    this.account = null;
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
    }
  }

  // ─── Internal ───

  _loadAccount() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
    } catch (e) { console.debug('[Account] Token load error:', e.message); }
    return null;
  }

  _saveAccount() {
    fs.mkdirSync(this.appDataDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.account, null, 2));
  }

  _apiPost(endpoint, body, token = null) {
    return this._apiRequest('POST', endpoint, body, token);
  }

  _apiGet(endpoint, token = null) {
    return this._apiRequest('GET', endpoint, null, token);
  }

  _apiRequestAbsolute(method, fullUrl, body, token) {
    return this._apiRequestInternal(method, new URL(fullUrl), body, token);
  }

  _apiRequest(method, endpoint, body, token) {
    return this._apiRequestInternal(method, new URL(`${API_BASE}${endpoint}`), body, token);
  }

  _apiRequestInternal(method, url, body, token) {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WindyPro/2.0'
        }
      };

      if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: 'Invalid response from server' });
          }
        });
      });

      req.on('error', (err) => {
        // Network errors — resolve with error object so caller can handle gracefully
        resolve({ error: err.message, offline: true });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timeout', offline: true });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

module.exports = { AccountManager };
