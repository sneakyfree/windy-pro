/**
 * Windy Pro — Cloud Sync Module (H4)
 *
 * Handles uploading recordings from the desktop app to the Windy Pro
 * account server. Integrates with the existing archive flow.
 *
 * Features:
 * - Login/register from desktop settings
 * - Auto-upload recordings after archiving
 * - Offline queue with retry logic
 * - Sync status badges in the UI
 */

class WindySync {
    constructor(app) {
        this.app = app;
        this.baseUrl = localStorage.getItem('windy_cloud_api_url') || 'https://windypro.thewindstorm.uk';
        this.token = localStorage.getItem('windy_cloud_token') || null;
        this.refreshToken = localStorage.getItem('windy_cloud_refresh') || null;
        this.user = null;
        this.syncEnabled = localStorage.getItem('windy_cloud_sync') !== 'false';
        this.syncFrequency = localStorage.getItem('windy_sync_frequency') || 'immediate'; // immediate|hourly|daily|manual
        this.queue = JSON.parse(localStorage.getItem('windy_sync_queue') || '[]');
        this._processing = false;
        this._retryDelay = 10000; // Base retry delay: 10s
        this._maxRetries = 5;
        this._syncProgress = { current: 0, total: 0 };

        // Load user from storage
        try {
            this.user = JSON.parse(localStorage.getItem('windy_cloud_user'));
        } catch (_) { }

        // Process queue based on frequency
        if (this.queue.length > 0 && this.syncFrequency === 'immediate') {
            setTimeout(() => this._processQueue(), 5000);
        }

        // Schedule periodic sync if not immediate
        if (this.syncFrequency === 'hourly') {
            setInterval(() => this._processQueue(), 3600000);
        } else if (this.syncFrequency === 'daily') {
            setInterval(() => this._processQueue(), 86400000);
        }
    }

    // ═══════════════════════════════════════════════
    // Auth
    // ═══════════════════════════════════════════════
    get isLoggedIn() {
        if (!this.token) return false;
        try {
            const parts = this.token.split('.');
            if (parts.length !== 3) return false;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload.exp && payload.exp > Date.now() / 1000;
        } catch {
            return false;
        }
    }

    async login(email, password) {
        const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        this.token = data.token;
        this.refreshToken = data.refreshToken;
        this.user = data.user;
        this._saveCredentials();
        return data.user;
    }

    async register(email, password, name) {
        const res = await fetch(`${this.baseUrl}/api/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        this.token = data.token;
        this.user = data.user;
        this._saveCredentials();
        return data.user;
    }

    logout() {
        // Best-effort server logout
        if (this.token) {
            fetch(`${this.baseUrl}/api/v1/auth/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            }).catch(() => { });
        }
        this.token = null;
        this.refreshToken = null;
        this.user = null;
        localStorage.removeItem('windy_cloud_token');
        localStorage.removeItem('windy_cloud_refresh');
        localStorage.removeItem('windy_cloud_user');
    }

    async _refreshAuth() {
        if (!this.refreshToken) return false;
        try {
            const res = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.refreshToken })
            });
            if (!res.ok) { this.logout(); return false; }

            const data = await res.json();
            this.token = data.token;
            this.refreshToken = data.refreshToken;
            this.user = data.user;
            this._saveCredentials();
            return true;
        } catch {
            return false;
        }
    }

    _saveCredentials() {
        if (this.token) localStorage.setItem('windy_cloud_token', this.token);
        if (this.refreshToken) localStorage.setItem('windy_cloud_refresh', this.refreshToken);
        if (this.user) localStorage.setItem('windy_cloud_user', JSON.stringify(this.user));
    }

    async _authedFetch(path, options = {}) {
        // Try with current token
        if (!this.isLoggedIn) {
            const refreshed = await this._refreshAuth();
            if (!refreshed) throw new Error('Not authenticated');
        }

        let res = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...(options.headers || {})
            }
        });

        // If 401, try refresh once
        if (res.status === 401) {
            const refreshed = await this._refreshAuth();
            if (!refreshed) throw new Error('Session expired');
            res = await fetch(`${this.baseUrl}${path}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`,
                    ...(options.headers || {})
                }
            });
        }

        return res;
    }

    // ═══════════════════════════════════════════════
    // Upload Recording
    // ═══════════════════════════════════════════════
    async uploadRecording({ transcript, wordCount, durationSeconds, engine, mode, recordedAt }) {
        if (!this.isLoggedIn || !this.syncEnabled) return null;

        const payload = {
            transcript: transcript || '',
            wordCount: wordCount || 0,
            durationSeconds: durationSeconds || 0,
            engine: engine || 'local',
            mode: mode || 'batch',
            recordedAt: recordedAt || new Date().toISOString()
        };

        try {
            const res = await this._authedFetch('/api/v1/recordings', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                console.debug('[CloudSync] Recording uploaded:', data.id);
                this._showSyncToast('☁️ Synced to cloud');
                return data.id;
            } else {
                throw new Error(`Upload failed: ${res.status}`);
            }
        } catch (err) {
            console.warn('[CloudSync] Upload failed, queueing:', err.message);
            this._queueRecording(payload);
            this._showSyncToast('⏳ Queued for sync');
            return null;
        }
    }

    // ═══════════════════════════════════════════════
    // Offline Queue
    // ═══════════════════════════════════════════════
    _queueRecording(payload) {
        if (this.queue.length >= 500) {
            console.warn('[CloudSync] Queue full (500 max). Dropping oldest.');
            this.queue.shift();
        }
        this.queue.push({ payload, attempts: 0, queuedAt: new Date().toISOString() });
        localStorage.setItem('windy_sync_queue', JSON.stringify(this.queue));
    }

    async _processQueue() {
        if (this._processing || !this.isLoggedIn || this.queue.length === 0) return;
        this._processing = true;
        this._syncProgress = { current: 0, total: this.queue.length };

        const succeeded = [];
        for (let i = 0; i < this.queue.length; i++) {
            const item = this.queue[i];
            this._syncProgress.current = i + 1;
            this._showSyncToast(`☁️ Uploading ${i + 1} of ${this.queue.length}...`);

            if (item.attempts >= this._maxRetries) {
                console.warn('[CloudSync] Max retries reached, dropping item');
                succeeded.push(i);
                continue;
            }

            try {
                const res = await this._authedFetch('/api/v1/recordings', {
                    method: 'POST',
                    body: JSON.stringify(item.payload)
                });
                if (res.ok) {
                    succeeded.push(i);
                    console.debug('[CloudSync] Queue item synced');
                } else {
                    item.attempts++;
                }
            } catch {
                item.attempts++;
            }
        }

        // Remove succeeded items
        this.queue = this.queue.filter((_, i) => !succeeded.includes(i));
        localStorage.setItem('windy_sync_queue', JSON.stringify(this.queue));
        this._processing = false;
        this._syncProgress = { current: 0, total: 0 };

        if (this.queue.length > 0) {
            // Exponential backoff: 10s, 20s, 40s, 80s, 160s (capped at 5 min)
            const maxAttempts = Math.max(...this.queue.map(q => q.attempts));
            const delay = Math.min(this._retryDelay * Math.pow(2, maxAttempts), 300000);
            console.debug(`[CloudSync] ${this.queue.length} items remaining, retrying in ${delay / 1000}s`);
            setTimeout(() => this._processQueue(), delay);
        } else {
            this._showSyncToast('☁️ All recordings synced!');
        }
    }

    /**
     * Manual sync trigger — for "Sync Now" button
     */
    async syncNow() {
        if (this.queue.length === 0) {
            this._showSyncToast('✅ Already synced');
            return;
        }
        // Reset attempt counts for manual retry
        this.queue.forEach(item => { item.attempts = 0; });
        localStorage.setItem('windy_sync_queue', JSON.stringify(this.queue));
        await this._processQueue();
    }

    /**
     * Set sync frequency: 'immediate' | 'hourly' | 'daily' | 'manual'
     */
    setSyncFrequency(freq) {
        this.syncFrequency = freq;
        localStorage.setItem('windy_sync_frequency', freq);
    }

    // ═══════════════════════════════════════════════
    // Dashboard Stats (from cloud)
    // ═══════════════════════════════════════════════
    async getStats() {
        if (!this.isLoggedIn) return null;
        try {
            const res = await this._authedFetch('/api/v1/recordings/stats');
            if (res.ok) return (await res.json()).stats;
        } catch (_) { }
        return null;
    }

    // ═══════════════════════════════════════════════
    // UI Helpers
    // ═══════════════════════════════════════════════
    _showSyncToast(msg) {
        if (this.app?._showToast) {
            this.app._showToast(msg, 'info', 2000);
        } else {
            console.debug('[CloudSync]', msg);
        }
    }

    getSyncStatus() {
        if (!this.isLoggedIn) return { icon: '❌', label: 'Not signed in' };
        if (this._processing) return { icon: '🔄', label: `Uploading ${this._syncProgress.current} of ${this._syncProgress.total}...` };
        if (this.queue.length > 0) return { icon: '⏳', label: `${this.queue.length} pending` };
        return { icon: '☁️', label: 'Synced' };
    }
}

// Export for use in app.js
if (typeof module !== 'undefined') module.exports = WindySync;
if (typeof window !== 'undefined') window.WindySync = WindySync;
