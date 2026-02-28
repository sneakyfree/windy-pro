/**
 * Windy Pro — History Panel (Wispr Flow-style)
 *
 * Full-height panel with date grouping, search, expand/collapse,
 * stats header, media indicators, audio playback, and lazy loading
 * from both localStorage + disk archives.
 */
class HistoryPanel {
    constructor(app) {
        this.app = app;
        this.panel = null;
        this.isOpen = false;
        this.allEntries = [];
        this.filteredEntries = [];
        this.displayedCount = 0;
        this.batchSize = 50;
        this.expandedId = null;
        this.searchTimeout = null;
        this.totalWords = 0;
        this.totalRecordings = 0;
        this._activeAudioUrl = null; // Track blob URL for cleanup
        this.engineIcons = {
            local: '🏠', cloud: '☁️', deepgram: '🎙️',
            groq: '⚡', openai: '🌐', stream: '📝'
        };
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    async open() {
        if (this.panel) this.panel.remove();
        this.panel = document.createElement('div');
        this.panel.className = 'history-panel';
        this.panel.innerHTML = this._buildSkeleton();
        document.getElementById('app').appendChild(this.panel);

        // Trigger slide-in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this.panel.classList.add('open'));
        });

        this.isOpen = true;
        this._bindCoreEvents();

        // Load data
        await this._loadAllEntries();
        this._renderEntries();
    }

    close() {
        // Cleanup audio blob URL
        if (this._activeAudioUrl) {
            URL.revokeObjectURL(this._activeAudioUrl);
            this._activeAudioUrl = null;
        }
        if (this.panel) {
            this.panel.classList.remove('open');
            setTimeout(() => {
                if (this.panel) { this.panel.remove(); this.panel = null; }
            }, 300);
        }
        this.isOpen = false;
        this.expandedId = null;
    }

    /* ═══════════════════════════
       Data Loading
       ═══════════════════════════ */

    async _loadAllEntries() {
        // 1. localStorage entries
        const local = this._getLocalHistory();

        // 2. Disk archive entries (via IPC)
        let archive = [];
        try {
            if (window.windyAPI?.getArchiveHistory) {
                archive = await window.windyAPI.getArchiveHistory();
            }
        } catch (e) {
            console.warn('[History] Archive load failed:', e.message);
        }

        // 3. Merge + deduplicate (by timestamp within 2s)
        const merged = [...local];
        const localTimes = new Set(local.map(e => Math.floor(new Date(e.date).getTime() / 2000)));
        for (const a of archive) {
            const key = Math.floor(new Date(a.date).getTime() / 2000);
            if (!localTimes.has(key)) {
                merged.push(a);
            }
        }

        // 4. Sort newest first
        merged.sort((a, b) => new Date(b.date) - new Date(a.date));

        this.allEntries = merged;
        this.filteredEntries = merged;
        this.displayedCount = 0;

        // 5. Stats
        this.totalWords = merged.reduce((s, e) => s + (e.wordCount || 0), 0);
        this.totalRecordings = merged.length;
        this._updateStats();
    }

    _getLocalHistory() {
        try {
            return JSON.parse(localStorage.getItem('windy_history') || '[]');
        } catch (_) {
            return [];
        }
    }

    /* ═══════════════════════════
       Rendering
       ═══════════════════════════ */

    _buildSkeleton() {
        return `
      <div class="history-header">
        <div class="history-title-row">
          <h3>📜 History</h3>
          <button class="history-close" id="historyClose" aria-label="Close history">✕</button>
        </div>
        <div class="history-stats" id="historyStats">
          <span class="stat-words">—</span>
          <span class="stat-sep">·</span>
          <span class="stat-count">—</span>
        </div>
        <div class="history-search-row">
          <input type="text" class="history-search" id="historySearch"
                 placeholder="Search transcripts…" aria-label="Search transcripts">
        </div>
        <div class="history-actions-row">
          <button class="history-action-btn" id="historyExportAll">📥 Export All</button>
          <button class="history-action-btn history-danger" id="historyClearAll">🗑️ Clear Local</button>
        </div>
      </div>
      <div class="history-body" id="historyBody">
        <div class="history-skeleton">
          <div class="skeleton-line" style="width:100%"></div>
          <div class="skeleton-line" style="width:80%"></div>
          <div class="skeleton-line" style="width:60%"></div>
          <div class="skeleton-line" style="width:90%"></div>
          <div class="skeleton-line" style="width:70%"></div>
        </div>
      </div>
    `;
    }

    _updateStats() {
        const statsEl = this.panel?.querySelector('#historyStats');
        if (!statsEl) return;
        const wk = this.totalWords >= 1000
            ? (this.totalWords / 1000).toFixed(1) + 'K'
            : this.totalWords;
        statsEl.querySelector('.stat-words').textContent = `${wk} words`;
        statsEl.querySelector('.stat-count').textContent = `${this.totalRecordings} recordings`;
    }

    _renderEntries() {
        const body = this.panel?.querySelector('#historyBody');
        if (!body) return;

        const entries = this.filteredEntries;
        if (entries.length === 0) {
            body.innerHTML = `<div class="history-empty">
        ${this.allEntries.length === 0
                    ? 'No transcripts yet.<br>Record something to get started!'
                    : 'No results found.'}
      </div>`;
            return;
        }

        // Determine how many to show
        const end = Math.min(this.displayedCount + this.batchSize, entries.length);
        const toRender = entries.slice(0, end);
        this.displayedCount = end;

        // Group by date
        const groups = this._groupByDate(toRender);
        const searchQuery = (this.panel?.querySelector('#historySearch')?.value || '').trim().toLowerCase();

        let html = '';
        for (const [label, items] of groups) {
            html += `<div class="history-date-group">
        <div class="history-date-label">${this._escapeHtml(label)}</div>`;
            for (const item of items) {
                const id = item._id || item.date;
                const isExpanded = this.expandedId === id;
                const time = new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const icon = this.engineIcons[item.engine] || '📝';
                let preview = (item.text || '').replace(/\n/g, ' ').substring(0, 80);
                if (preview.length >= 80) preview += '…';

                // Highlight search matches
                if (searchQuery) {
                    preview = this._highlightText(preview, searchQuery);
                }

                // Media indicator badges
                const mediaBadges = this._renderMediaBadges(item);

                html += `<div class="history-entry ${isExpanded ? 'expanded' : ''}" data-id="${this._escapeHtml(String(id))}">
          <div class="history-entry-header">
            <span class="history-time">${time}</span>
            <span class="history-preview">${preview}</span>
            <span class="history-badges">
              ${mediaBadges}
              <span class="history-wc">${item.wordCount || 0}w</span>
              <span class="history-engine">${icon}</span>
            </span>
          </div>
          ${isExpanded ? this._renderExpanded(item) : ''}
        </div>`;
            }
            html += '</div>';
        }

        // Load more button
        if (end < entries.length) {
            html += `<button class="history-load-more" id="historyLoadMore">
        Load more (${entries.length - end} remaining)
      </button>`;
        }

        body.innerHTML = html;
        this._bindEntryEvents();

        // If expanded entry has audio, load the audio player
        if (this.expandedId) {
            const item = this.filteredEntries.find(e => (e._id || e.date) === this.expandedId);
            if (item?.hasAudio && item.audioPath) {
                this._loadAudioPlayer(item.audioPath);
            }
        }
    }

    _renderMediaBadges(item) {
        let badges = '<span class="history-media-badges">';
        badges += '<span class="media-badge" title="Has transcript">📝</span>';
        if (item.hasAudio) {
            badges += '<span class="media-badge media-audio" title="Has audio recording">🎤</span>';
        }
        if (item.hasVideo) {
            badges += '<span class="media-badge media-video" title="Has video recording">🎬</span>';
        }
        badges += '</span>';
        return badges;
    }

    _renderExpanded(item) {
        const fullText = this._escapeHtml(item.text || '').replace(/\n/g, '<br>');
        let audioSection = '';
        if (item.hasAudio && item.audioPath) {
            audioSection = `
        <div class="history-audio-player" id="historyAudioPlayer">
          <div class="audio-loading">🎤 Loading audio…</div>
        </div>`;
        }
        return `<div class="history-expanded">
      ${audioSection}
      <div class="history-full-text">${fullText}</div>
      <div class="history-expanded-actions">
        <button class="history-exp-btn" data-action="copy">📋 Copy</button>
        <button class="history-exp-btn" data-action="export-txt">💾 .txt</button>
        <button class="history-exp-btn" data-action="export-md">📝 .md</button>
        <button class="history-exp-btn history-danger" data-action="delete">🗑️ Delete</button>
      </div>
    </div>`;
    }

    async _loadAudioPlayer(audioPath) {
        const container = this.panel?.querySelector('#historyAudioPlayer');
        if (!container) return;

        try {
            // Cleanup previous blob URL
            if (this._activeAudioUrl) {
                URL.revokeObjectURL(this._activeAudioUrl);
                this._activeAudioUrl = null;
            }

            if (!window.windyAPI?.readArchiveAudio) {
                container.innerHTML = '<div class="audio-error">Audio playback not available</div>';
                return;
            }

            const result = await window.windyAPI.readArchiveAudio(audioPath);
            if (!result?.ok || !result.base64) {
                container.innerHTML = '<div class="audio-error">Failed to load audio</div>';
                return;
            }

            // Convert base64 to blob URL
            const binaryStr = atob(result.base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: result.mimeType || 'audio/webm' });
            this._activeAudioUrl = URL.createObjectURL(blob);

            container.innerHTML = `
        <div class="audio-player-wrapper">
          <span class="audio-label">🎤 Recording</span>
          <audio controls preload="metadata" class="history-audio-el">
            <source src="${this._activeAudioUrl}" type="${result.mimeType || 'audio/webm'}">
            Your browser does not support audio playback.
          </audio>
        </div>`;
        } catch (err) {
            console.warn('[History] Audio load error:', err.message);
            container.innerHTML = '<div class="audio-error">Audio load error</div>';
        }
    }

    _groupByDate(entries) {
        const groups = new Map();
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const todayStr = today.toDateString();
        const yesterdayStr = yesterday.toDateString();

        for (const entry of entries) {
            const d = new Date(entry.date);
            const ds = d.toDateString();
            let label;
            if (ds === todayStr) {
                label = 'TODAY';
            } else if (ds === yesterdayStr) {
                label = 'YESTERDAY';
            } else {
                label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(entry);
        }
        return groups;
    }

    _highlightText(text, query) {
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ═══════════════════════════
       Events
       ═══════════════════════════ */

    _bindCoreEvents() {
        // Close button
        this.panel.querySelector('#historyClose').addEventListener('click', () => this.close());

        // Search with debounce
        const searchInput = this.panel.querySelector('#historySearch');
        searchInput.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => this._onSearch(), 300);
        });

        // Export all
        this.panel.querySelector('#historyExportAll').addEventListener('click', () => this._exportAll());

        // Clear local
        this.panel.querySelector('#historyClearAll').addEventListener('click', () => {
            if (confirm('Clear local transcript history? Archive files on disk will not be affected.')) {
                localStorage.removeItem('windy_history');
                this.allEntries = this.allEntries.filter(e => e._source === 'archive');
                this.filteredEntries = [...this.allEntries];
                this.totalRecordings = this.allEntries.length;
                this.totalWords = this.allEntries.reduce((s, e) => s + (e.wordCount || 0), 0);
                this._updateStats();
                this.displayedCount = 0;
                this._renderEntries();
            }
        });

        // Scroll for lazy load
        const body = this.panel.querySelector('#historyBody');
        body.addEventListener('scroll', () => {
            if (body.scrollTop + body.clientHeight >= body.scrollHeight - 100) {
                if (this.displayedCount < this.filteredEntries.length) {
                    this._renderEntries();
                }
            }
        });
    }

    _bindEntryEvents() {
        // Click entry header to expand/collapse
        this.panel.querySelectorAll('.history-entry-header').forEach(header => {
            header.addEventListener('click', () => {
                const entry = header.closest('.history-entry');
                const id = entry.dataset.id;
                // Cleanup audio when collapsing
                if (this.expandedId === id && this._activeAudioUrl) {
                    URL.revokeObjectURL(this._activeAudioUrl);
                    this._activeAudioUrl = null;
                }
                this.expandedId = (this.expandedId === id) ? null : id;
                this._renderEntries();
            });
        });

        // Load more
        const loadMore = this.panel.querySelector('#historyLoadMore');
        if (loadMore) {
            loadMore.addEventListener('click', () => this._renderEntries());
        }

        // Expanded action buttons
        this.panel.querySelectorAll('.history-exp-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const entryEl = btn.closest('.history-entry');
                const id = entryEl.dataset.id;
                const item = this.filteredEntries.find(e => (e._id || e.date) === id);
                if (!item) return;

                if (action === 'copy') {
                    navigator.clipboard.writeText(item.text || '');
                    btn.textContent = '✅ Copied';
                    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
                } else if (action === 'export-txt') {
                    this._downloadFile(item.text, 'transcript.txt', 'text/plain');
                } else if (action === 'export-md') {
                    const md = `# Transcript\n\n${item.text}\n`;
                    this._downloadFile(md, 'transcript.md', 'text/markdown');
                } else if (action === 'delete') {
                    this._deleteEntry(item, entryEl);
                }
            });
        });
    }

    _onSearch() {
        const query = (this.panel?.querySelector('#historySearch')?.value || '').trim().toLowerCase();
        if (!query) {
            this.filteredEntries = [...this.allEntries];
        } else {
            this.filteredEntries = this.allEntries.filter(e =>
                (e.text || '').toLowerCase().includes(query)
            );
        }
        this.displayedCount = 0;
        this.expandedId = null;
        this._renderEntries();
    }

    async _deleteEntry(item, entryEl) {
        // Animate out
        entryEl.style.opacity = '0';
        entryEl.style.transform = 'translateX(20px)';
        await new Promise(r => setTimeout(r, 200));

        // Remove from local storage
        try {
            const local = this._getLocalHistory();
            const filtered = local.filter(e => e.date !== item.date);
            localStorage.setItem('windy_history', JSON.stringify(filtered));
        } catch (_) { }

        // Remove from disk archive if applicable
        if (item._archivePath && window.windyAPI?.deleteArchiveEntry) {
            try {
                await window.windyAPI.deleteArchiveEntry(item._archivePath);
            } catch (e) {
                console.warn('[History] Failed to delete archive file:', e.message);
            }
        }

        // Remove from in-memory lists
        this.allEntries = this.allEntries.filter(e => e !== item);
        this.filteredEntries = this.filteredEntries.filter(e => e !== item);
        this.totalRecordings = this.allEntries.length;
        this.totalWords = this.allEntries.reduce((s, e) => s + (e.wordCount || 0), 0);
        this._updateStats();
        this.expandedId = null;
        this.displayedCount = 0;
        this._renderEntries();
    }

    _exportAll() {
        const entries = this.filteredEntries;
        if (!entries.length) return;
        let content = '# Windy Pro — Transcript History\n\n';
        entries.forEach(item => {
            const date = new Date(item.date).toLocaleString();
            content += `## ${date} (${item.wordCount || 0}w · ${item.engine || 'unknown'})\n\n${item.text}\n\n---\n\n`;
        });
        this._downloadFile(content, `windy-history-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
    }

    _downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}
