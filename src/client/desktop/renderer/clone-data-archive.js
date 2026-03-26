/**
 * Windy Pro — Clone Data Archive
 * Browse recording bundles, filter, bulk export, storage stats,
 * start clone training
 */

class CloneDataArchive {
    constructor() {
        this.bundles = [];
        this.filters = { hasVideo: null, dateFrom: null, dateTo: null, syncedFromMobile: null };
        this.selectedBundles = new Set();
    }

    async render(container) {
        // Load bundles from main process
        try {
            const result = await window.windyAPI.getCloneBundles();
            this.bundles = result?.bundles || [];
        } catch { this.bundles = []; }

        const stats = this.computeStats();

        container.innerHTML = `
      <div class="cda-archive" id="clone-data-archive">
        <div class="cda-header">
          <h2>🧬 Clone Data Archive</h2>
          <p class="cda-subtitle">Recording bundles for digital clone training</p>
          <button class="conv-close-btn" id="cda-close">✕</button>
        </div>

        <!-- Storage Stats -->
        <div class="cda-stats">
          <div class="tm-stat">
            <span class="tm-stat-value">${stats.totalBundles}</span>
            <span class="tm-stat-label">Bundles</span>
          </div>
          <div class="tm-stat">
            <span class="tm-stat-value">${stats.totalDuration}</span>
            <span class="tm-stat-label">Total Duration</span>
          </div>
          <div class="tm-stat">
            <span class="tm-stat-value">${stats.localStorage}</span>
            <span class="tm-stat-label">Local Storage</span>
          </div>
          <div class="tm-stat">
            <span class="tm-stat-value">${stats.videoBundles}</span>
            <span class="tm-stat-label">With Video</span>
          </div>
          <div class="tm-stat">
            <span class="tm-stat-value">${stats.trainingReady}</span>
            <span class="tm-stat-label">Training Ready</span>
          </div>
        </div>

        <!-- Filters -->
        <div class="cda-filters">
          <select id="cda-filter-type" class="conv-lang-select">
            <option value="all">All Types</option>
            <option value="video">🎬 Has Video</option>
            <option value="audio">🎤 Audio Only</option>
          </select>
          <select id="cda-filter-date" class="conv-lang-select">
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
          <select id="cda-filter-source" class="conv-lang-select">
            <option value="all">All Sources</option>
            <option value="desktop">💻 Desktop</option>
            <option value="mobile">📱 Synced from Mobile</option>
          </select>
          <button class="doc-action-btn" id="cda-select-all">☑ Select All</button>
        </div>

        <!-- Bundle List -->
        <div class="cda-bundle-list" id="cda-bundle-list">
          ${this.bundles.length === 0 ? '<p class="cda-empty">No recording bundles yet. Start recording to build your clone data!</p>' :
                this.bundles.map(b => this.renderBundleCard(b)).join('')
            }
        </div>

        <!-- Actions -->
        <div class="cda-actions">
          <button class="doc-action-btn" id="cda-export-selected">📦 Export Selected (ZIP)</button>
          <button class="doc-action-btn cda-training-btn" id="cda-start-training">🧠 Start Clone Training</button>
          <span class="cda-selected-count" id="cda-selected-count">${this.selectedBundles.size} selected</span>
        </div>
      </div>
    `;

        this.bindEvents(container);
    }

    renderBundleCard(bundle) {
        const hasVideo = !!bundle.video;
        const duration = this.formatDuration(bundle.duration_seconds || 0);
        const date = window.WindyDateUtils ? WindyDateUtils.formatDateOnly(new Date(bundle.created_at || Date.now())) : new Date(bundle.created_at || Date.now()).toLocaleDateString();
        const size = bundle.file_size ? `${(bundle.file_size / 1048576).toFixed(1)} MB` : '?';
        const segments = bundle.transcript?.segments?.length || 0;
        const selected = this.selectedBundles.has(bundle.bundle_id);

        return `
      <div class="cda-bundle-card ${selected ? 'cda-selected' : ''}" data-id="${bundle.bundle_id}">
        <div class="cda-bundle-thumb">
          ${hasVideo ? '<div class="cda-thumb-video">🎬</div>' : '<div class="cda-thumb-audio">🎤</div>'}
          <span class="cda-thumb-duration">${duration}</span>
        </div>
        <div class="cda-bundle-info">
          <div class="cda-bundle-title">${bundle.transcript?.text?.substring(0, 80) || 'Untitled recording'}${(bundle.transcript?.text?.length || 0) > 80 ? '...' : ''}</div>
          <div class="cda-bundle-meta">
            <span>${date}</span>
            <span>💾 ${size}</span>
            <span>📝 ${segments} segments</span>
            <span>${bundle.device?.platform === 'mobile' ? '📱 Mobile' : '💻 Desktop'}</span>
            <span class="cda-training-badge">${bundle.clone_training_ready ? '✅ Ready' : '⚠️ Not ready'}</span>
          </div>
        </div>
        <div class="cda-bundle-actions">
          <input type="checkbox" class="cda-bundle-check" data-id="${bundle.bundle_id}" ${selected ? 'checked' : ''} />
          <button class="vc-action-btn cda-play-btn" data-id="${bundle.bundle_id}" title="Play">▶️</button>
          <button class="vc-action-btn cda-delete-btn" data-id="${bundle.bundle_id}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
    }

    bindEvents(container) {
        document.getElementById('cda-close').addEventListener('click', () => container.innerHTML = '');

        // Filters
        ['cda-filter-type', 'cda-filter-date', 'cda-filter-source'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });

        // Select all
        document.getElementById('cda-select-all').addEventListener('click', () => {
            const allIds = this.getFilteredBundles().map(b => b.bundle_id);
            if (this.selectedBundles.size === allIds.length) {
                this.selectedBundles.clear();
            } else {
                allIds.forEach(id => this.selectedBundles.add(id));
            }
            this.render(container);
        });

        // Bundle selection checkboxes
        container.querySelectorAll('.cda-bundle-check').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) this.selectedBundles.add(cb.dataset.id);
                else this.selectedBundles.delete(cb.dataset.id);
                document.getElementById('cda-selected-count').textContent = `${this.selectedBundles.size} selected`;
            });
        });

        // Play buttons
        container.querySelectorAll('.cda-play-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await window.windyAPI.playCloneBundle(btn.dataset.id);
                } catch { /* playback failed */ }
            });
        });

        // Delete buttons
        container.querySelectorAll('.cda-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this recording bundle?')) return;
                try {
                    await window.windyAPI.deleteCloneBundle(btn.dataset.id);
                    this.bundles = this.bundles.filter(b => b.bundle_id !== btn.dataset.id);
                    this.selectedBundles.delete(btn.dataset.id);
                    this.render(container);
                } catch { /* delete failed */ }
            });
        });

        // Export ZIP
        document.getElementById('cda-export-selected').addEventListener('click', async () => {
            const ids = Array.from(this.selectedBundles);
            if (ids.length === 0) { alert('Select bundles to export'); return; }
            try {
                await window.windyAPI.exportCloneBundles(ids);
            } catch (err) { console.error('[CDA] Export error:', err); }
        });

        // Start training
        document.getElementById('cda-start-training').addEventListener('click', async () => {
            const readyBundles = this.bundles.filter(b => b.clone_training_ready);
            if (readyBundles.length < 3) {
                alert(`Need at least 3 training-ready bundles. You have ${readyBundles.length}.`);
                return;
            }
            try {
                const result = await window.windyAPI.startCloneTraining(readyBundles.map(b => b.bundle_id));
                if (result?.jobId) {
                    alert(`Training started! Job ID: ${result.jobId}`);
                }
            } catch (err) { console.error('[CDA] Training error:', err); }
        });
    }

    applyFilters() {
        const typeFilter = document.getElementById('cda-filter-type').value;
        const dateFilter = document.getElementById('cda-filter-date').value;
        const sourceFilter = document.getElementById('cda-filter-source').value;

        const filtered = this.getFilteredBundles(typeFilter, dateFilter, sourceFilter);
        const listEl = document.getElementById('cda-bundle-list');
        if (listEl) {
            listEl.innerHTML = filtered.length === 0
                ? '<p class="cda-empty">No bundles match the current filters</p>'
                : filtered.map(b => this.renderBundleCard(b)).join('');
        }
    }

    getFilteredBundles(type = 'all', date = 'all', source = 'all') {
        return this.bundles.filter(b => {
            if (type === 'video' && !b.video) return false;
            if (type === 'audio' && b.video) return false;
            if (source === 'desktop' && b.device?.platform !== 'desktop') return false;
            if (source === 'mobile' && b.device?.platform !== 'mobile') return false;
            if (date !== 'all') {
                const bDate = new Date(b.created_at || 0);
                const now = new Date();
                if (date === 'today' && bDate.toDateString() !== now.toDateString()) return false;
                if (date === 'week') {
                    const weekAgo = new Date(now - 7 * 86400000);
                    if (bDate < weekAgo) return false;
                }
                if (date === 'month') {
                    const monthAgo = new Date(now - 30 * 86400000);
                    if (bDate < monthAgo) return false;
                }
            }
            return true;
        });
    }

    computeStats() {
        const totalSeconds = this.bundles.reduce((sum, b) => sum + (b.duration_seconds || 0), 0);
        const totalBytes = this.bundles.reduce((sum, b) => sum + (b.file_size || 0), 0);
        return {
            totalBundles: this.bundles.length,
            totalDuration: this.formatDuration(totalSeconds),
            localStorage: totalBytes > 0 ? `${(totalBytes / 1048576).toFixed(0)} MB` : '0 MB',
            videoBundles: this.bundles.filter(b => !!b.video).length,
            trainingReady: this.bundles.filter(b => b.clone_training_ready).length
        };
    }

    formatDuration(seconds) {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }
}

window.CloneDataArchive = CloneDataArchive;
