/**
 * Windy Pro — Auto-Sync Receiver & Offline Queue
 * Polls cloud for new bundles, downloads automatically,
 * queues desktop uploads for retry, sync dashboard UI,
 * storage management, download progress + resume
 */

class AutoSyncManager {
    constructor() {
        this.pollInterval = null;
        this.pollFrequencyMs = 5 * 60 * 1000; // 5 minutes
        this.isOnline = navigator.onLine;
        this.syncInProgress = false;
        this.downloadQueue = [];
        this.uploadQueue = [];
        this.lastSyncTimestamp = 0;
        this.devices = new Map();
        this.storageStats = { local: 0, cloud: 0, bundleCount: 0 };
        this.downloadProgress = new Map(); // bundleId -> { loaded, total, percent }
    }

    // ═══ Initialize ═══
    async init() {
        // Load saved state
        try {
            const state = await window.windyAPI.getSyncState();
            this.lastSyncTimestamp = state?.lastSync || 0;
            this.uploadQueue = state?.uploadQueue || [];
            this.devices = new Map(Object.entries(state?.devices || {}));
        } catch { /* fresh state */ }

        // Network listeners
        window.addEventListener('online', () => { this.isOnline = true; this.processQueues(); });
        window.addEventListener('offline', () => { this.isOnline = false; });

        // Start polling
        this.startPolling();

        // Process any queued uploads from before
        if (this.isOnline && this.uploadQueue.length > 0) {
            this.processQueues();
        }
    }

    // ═══ Background Polling ═══
    startPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => this.checkForNewBundles(), this.pollFrequencyMs);
        // Also check immediately
        this.checkForNewBundles();
    }

    stopPolling() {
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    }

    async checkForNewBundles() {
        if (!this.isOnline || this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            const since = new Date(this.lastSyncTimestamp || 0).toISOString();
            const result = await window.windyAPI.fetchRemoteBundles(since);
            const remoteBundles = result?.bundles || [];

            if (remoteBundles.length === 0) {
                this.syncInProgress = false;
                return;
            }

            // Filter out bundles we already have locally
            const localBundles = await window.windyAPI.getCloneBundles();
            const localIds = new Set((localBundles?.bundles || []).map(b => b.bundle_id));
            const newBundles = remoteBundles.filter(b => !localIds.has(b.bundle_id || b.id));

            if (newBundles.length > 0) {
                // Queue downloads
                this.downloadQueue.push(...newBundles);

                // Notify user via system tray
                const deviceNames = [...new Set(newBundles.map(b => b.device_name || b.device_platform || 'device'))];
                await window.windyAPI.showSyncNotification(
                    `${newBundles.length} new recording${newBundles.length > 1 ? 's' : ''} synced from ${deviceNames.join(', ')}`
                );

                // Start downloading
                await this.processDownloads();

                // Update device tracking
                for (const bundle of newBundles) {
                    const deviceId = bundle.device_id || 'unknown';
                    this.devices.set(deviceId, {
                        name: bundle.device_name || bundle.device_platform || 'Unknown Device',
                        platform: bundle.device_platform || 'unknown',
                        lastSync: new Date().toISOString(),
                        bundleCount: (this.devices.get(deviceId)?.bundleCount || 0) + 1
                    });
                }
            }

            this.lastSyncTimestamp = Date.now();
            await this.saveSyncState();
        } catch (err) {
            console.error('[AutoSync] Poll error:', err);
        }

        this.syncInProgress = false;
    }

    // ═══ Download Manager ═══
    async processDownloads() {
        while (this.downloadQueue.length > 0 && this.isOnline) {
            const bundle = this.downloadQueue[0];
            try {
                await this.downloadBundle(bundle);
                this.downloadQueue.shift(); // Remove from queue on success
            } catch (err) {
                console.error(`[AutoSync] Download failed for ${bundle.bundle_id}:`, err);
                // Keep in queue for retry
                break;
            }
        }
    }

    async downloadBundle(bundle) {
        const bundleId = bundle.bundle_id || bundle.id;
        this.downloadProgress.set(bundleId, { loaded: 0, total: bundle.file_size || 0, percent: 0 });

        try {
            const result = await window.windyAPI.downloadRemoteBundle(bundleId, (loaded, total) => {
                this.downloadProgress.set(bundleId, {
                    loaded, total,
                    percent: total > 0 ? Math.round((loaded / total) * 100) : 0
                });
            });

            if (result?.success) {
                this.downloadProgress.set(bundleId, { loaded: bundle.file_size, total: bundle.file_size, percent: 100 });
                // Save locally
                await window.windyAPI.saveCloneBundle({
                    ...bundle,
                    sync_status: 'cloud_synced',
                    mediaBase64: result.mediaBase64
                });
            }
        } finally {
            setTimeout(() => this.downloadProgress.delete(bundleId), 3000);
        }
    }

    // ═══ Upload Queue (Offline Support) ═══
    async queueUpload(bundleData) {
        this.uploadQueue.push({
            ...bundleData,
            queued_at: new Date().toISOString(),
            retries: 0,
            max_retries: 5
        });
        await this.saveSyncState();

        if (this.isOnline) {
            this.processQueues();
        }
    }

    async processQueues() {
        // Process upload queue
        const pendingUploads = [...this.uploadQueue];
        for (let i = 0; i < pendingUploads.length; i++) {
            const item = pendingUploads[i];
            if (item.retries >= item.max_retries) {
                this.uploadQueue = this.uploadQueue.filter(u => u.bundle_id !== item.bundle_id);
                continue;
            }

            try {
                await window.windyAPI.uploadBundleToCloud(item);
                this.uploadQueue = this.uploadQueue.filter(u => u.bundle_id !== item.bundle_id);
            } catch {
                item.retries++;
            }
        }
        await this.saveSyncState();
    }

    // ═══ Sync State Persistence ═══
    async saveSyncState() {
        try {
            await window.windyAPI.saveSyncState({
                lastSync: this.lastSyncTimestamp,
                uploadQueue: this.uploadQueue,
                devices: Object.fromEntries(this.devices)
            });
        } catch { /* persist failed */ }
    }

    // ═══ Storage Management ═══
    async getStorageStats() {
        try {
            const stats = await window.windyAPI.getStorageStats();
            this.storageStats = stats || { local: 0, cloud: 0, bundleCount: 0 };
            return this.storageStats;
        } catch { return this.storageStats; }
    }

    async deleteLocalCopies(bundleIds) {
        let freed = 0;
        for (const id of bundleIds) {
            try {
                const result = await window.windyAPI.deleteLocalBundleCopy(id);
                if (result?.freed) freed += result.freed;
            } catch { /* delete failed */ }
        }
        return freed;
    }

    // ═══ Sync Dashboard UI ═══
    async renderDashboard(container) {
        const stats = await this.getStorageStats();
        const localBundles = await window.windyAPI.getCloneBundles();
        const bundles = localBundles?.bundles || [];

        const cloudUsedPct = stats.cloudLimit > 0 ? Math.min(100, Math.round((stats.cloud / stats.cloudLimit) * 100)) : 0;
        const tierLabel = { free: 'Free', pro: 'Pro', translate: 'Translate', 'translate-pro': 'Translate Pro' }[stats.cloudTier] || 'Free';
        const barColor = cloudUsedPct >= 90 ? '#ff4444' : cloudUsedPct >= 70 ? '#ffaa00' : '#00cc66';

        container.innerHTML = `
      <div class="sync-dashboard" id="sync-dashboard">
        <div class="sync-header">
          <h2>🔄 Sync Dashboard</h2>
          <div class="sync-status-bar">
            <span class="sync-dot ${this.isOnline ? 'sync-online' : 'sync-offline'}"></span>
            <span>${this.isOnline ? 'Online' : 'Offline'}</span>
            <span class="sync-last">Last sync: ${this.lastSyncTimestamp ? new Date(this.lastSyncTimestamp).toLocaleString() : 'Never'}</span>
          </div>
          <button class="conv-close-btn" id="sync-close">✕</button>
        </div>

        <!-- Cloud Storage Usage Bar -->
        <div class="sync-storage-bar" style="margin:12px 0;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-weight:600;font-size:13px;">☁️ Windy Pro Storage</span>
            <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;background:rgba(0,200,100,0.15);color:#00cc66;">${tierLabel}</span>
          </div>
          <div style="width:100%;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
            <div style="width:${cloudUsedPct}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.5s ease;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;opacity:0.6;">
            <span>${this.formatBytes(stats.cloud)} / ${this.formatBytes(stats.cloudLimit)}</span>
            <span>${cloudUsedPct}% used${stats.cloudFileCount ? ` · ${stats.cloudFileCount} files` : ''}</span>
          </div>
          ${stats.cloudTier === 'free' || !stats.cloudTier ? `
            <button id="sync-upgrade-btn" style="margin-top:8px;width:100%;padding:8px;border:none;border-radius:8px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-weight:600;font-size:12px;cursor:pointer;">
              ⬆️ Upgrade for More Storage
            </button>
          ` : ''}
        </div>

        <!-- Storage Stats -->
        <div class="sync-storage">
          <div class="tm-stat"><span class="tm-stat-value">${this.formatBytes(stats.local)}</span><span class="tm-stat-label">Local Storage</span></div>
          <div class="tm-stat"><span class="tm-stat-value">${this.formatBytes(stats.cloud)}</span><span class="tm-stat-label">Cloud Storage</span></div>
          <div class="tm-stat"><span class="tm-stat-value">${stats.bundleCount || bundles.length}</span><span class="tm-stat-label">Total Bundles</span></div>
          <div class="tm-stat"><span class="tm-stat-value">${this.uploadQueue.length}</span><span class="tm-stat-label">Pending Uploads</span></div>
          <div class="tm-stat"><span class="tm-stat-value">${this.downloadQueue.length}</span><span class="tm-stat-label">Pending Downloads</span></div>
        </div>

        <!-- Connected Devices -->
        <div class="sync-section">
          <h3>📱 Connected Devices</h3>
          <div class="sync-device-list" id="sync-device-list">
            ${this.devices.size === 0 ? '<p class="sync-empty">No devices synced yet</p>' :
                Array.from(this.devices.entries()).map(([id, dev]) => `
                <div class="sync-device-card">
                  <span class="sync-device-icon">${dev.platform === 'ios' ? '📱' : dev.platform === 'android' ? '📱' : '💻'}</span>
                  <div class="sync-device-info">
                    <span class="sync-device-name">${dev.name}</span>
                    <span class="sync-device-meta">Last sync: ${new Date(dev.lastSync).toLocaleString()} · ${dev.bundleCount} bundles</span>
                  </div>
                </div>
              `).join('')}
          </div>
        </div>

        <!-- File Sync Status -->
        <div class="sync-section" style="max-height:200px;overflow-y:auto;">
          <h3>📂 Files (${bundles.length})</h3>
          ${bundles.slice(0, 20).map(b => {
            const icon = b.sync_status === 'cloud_synced' ? '☁️✅' : b.sync_status === 'cloud_only' ? '☁️' : '💾';
            const label = b.sync_status === 'cloud_synced' ? 'Synced' : b.sync_status === 'cloud_only' ? 'Cloud Only' : 'Local';
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span>${icon}</span>
              <span style="flex:1;opacity:0.8;">${b.bundle_id?.slice(0, 12) || 'unknown'}...</span>
              <span style="font-size:11px;opacity:0.5;">${label}</span>
              <span style="font-size:11px;opacity:0.4;">${b.duration_seconds ? Math.round(b.duration_seconds) + 's' : ''}</span>
            </div>`;
          }).join('')}
          ${bundles.length > 20 ? `<p style="font-size:11px;opacity:0.4;text-align:center;margin-top:4px;">+ ${bundles.length - 20} more</p>` : ''}
        </div>

        <!-- Download Progress -->
        <div class="sync-section" id="sync-downloads" style="display:${this.downloadProgress.size > 0 ? 'block' : 'none'}">
          <h3>⬇️ Downloads</h3>
          ${Array.from(this.downloadProgress.entries()).map(([id, p]) => `
            <div class="sync-progress-item">
              <span>${id.slice(0, 8)}...</span>
              <div class="doc-progress-bar"><div class="doc-progress-fill" style="width:${p.percent}%"></div></div>
              <span>${p.percent}%</span>
            </div>
          `).join('')}
        </div>

        <!-- Upload Queue -->
        <div class="sync-section" id="sync-uploads" style="display:${this.uploadQueue.length > 0 ? 'block' : 'none'}">
          <h3>⬆️ Upload Queue</h3>
          ${this.uploadQueue.map(u => `
            <div class="sync-queue-item">
              <span>${u.bundle_id?.slice(0, 8) || '?'}...</span>
              <span class="sync-queue-meta">${u.retries > 0 ? `Retry ${u.retries}/${u.max_retries}` : 'Pending'}</span>
              <span>${new Date(u.queued_at).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>

        <!-- Storage Management -->
        <div class="sync-section">
          <h3>💾 Storage Management</h3>
          <div class="sync-storage-actions">
            <button class="doc-action-btn" id="sync-clean-local">🧹 Clean Local Copies of Cloud-Synced Bundles</button>
            <button class="doc-action-btn" id="sync-force-sync">🔄 Force Sync Now</button>
            <button class="doc-action-btn" id="sync-retry-uploads">🔁 Retry Failed Uploads</button>
          </div>
        </div>
      </div>
    `;

        this.bindDashboardEvents(container);
    }

    bindDashboardEvents(container) {
        document.getElementById('sync-close').addEventListener('click', () => container.innerHTML = '');

        // Upgrade button (only exists for free tier)
        const upgradeBtn = document.getElementById('sync-upgrade-btn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => {
                window.windyAPI.openExternalUrl('https://windypro.thewindstorm.uk/upgrade');
            });
        }

        document.getElementById('sync-clean-local').addEventListener('click', async () => {
            const localBundles = await window.windyAPI.getCloneBundles();
            const cloudSynced = (localBundles?.bundles || []).filter(b => b.sync_status === 'cloud_synced');
            if (cloudSynced.length === 0) { alert('No cloud-synced bundles to clean.'); return; }
            if (!confirm(`Delete local copies of ${cloudSynced.length} cloud-synced bundles?`)) return;
            const freed = await this.deleteLocalCopies(cloudSynced.map(b => b.bundle_id));
            alert(`Freed ${this.formatBytes(freed)} of local storage`);
            this.renderDashboard(container);
        });

        document.getElementById('sync-force-sync').addEventListener('click', async () => {
            await this.checkForNewBundles();
            this.renderDashboard(container);
        });

        document.getElementById('sync-retry-uploads').addEventListener('click', async () => {
            this.uploadQueue.forEach(u => u.retries = 0);
            await this.processQueues();
            this.renderDashboard(container);
        });
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
    }
}

window.AutoSyncManager = AutoSyncManager;
