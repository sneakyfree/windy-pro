/**
 * Windy Pro — History Panel (slide-panel style)
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
            local: '🏠', cloud: '☁️', stream: '🎙️',
            smart: '🧠'
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

        // 3. Merge BOTH sources — archive entries enrich with media links,
        //    localStorage fills in sessions not yet archived or from a different folder.
        //    Deduplicate by timestamp proximity (within 30s = same session).
        const archiveDates = new Set(archive.map(e => new Date(e.date).getTime()));
        const uniqueLocal = local.filter(l => {
            const lt = new Date(l.date).getTime();
            for (const at of archiveDates) {
                if (Math.abs(lt - at) < 30000) return false; // duplicate
            }
            return true;
        });
        const merged = [...archive, ...uniqueLocal];

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
                 placeholder="Search transcripts…" aria-label="Search transcripts" title="Search through all your transcripts by keyword">
        </div>
        <div class="history-actions-row" style="position:relative;">
          <button class="history-action-btn" id="historyExportAll" title="Export transcripts">📤 Export ▾</button>
          <div class="export-dropdown" id="exportDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:999;margin-top:4px;background:var(--bg-secondary,#1a1f26);border:1px solid var(--bg-tertiary,#30363d);border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
            <div style="font-size:10px;color:var(--text-tertiary,#8b949e);padding:4px 8px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Save to</div>
            <button class="export-option" data-export="save-txt" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;color:var(--text-primary,#e6edf3);font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;">📁 Choose folder… <span style="color:var(--text-tertiary,#8b949e);font-size:10px;margin-left:auto;">.txt</span></button>
            <button class="export-option" data-export="save-srt" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;color:var(--text-primary,#e6edf3);font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;">📁 Choose folder… <span style="color:var(--text-tertiary,#8b949e);font-size:10px;margin-left:auto;">.srt subtitles</span></button>
            <button class="export-option" data-export="save-md" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;color:var(--text-primary,#e6edf3);font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;">📁 Choose folder… <span style="color:var(--text-tertiary,#8b949e);font-size:10px;margin-left:auto;">.md</span></button>
            <div style="border-top:1px solid var(--bg-tertiary,#30363d);margin:4px 0;"></div>
            <div style="font-size:10px;color:var(--text-tertiary,#8b949e);padding:4px 8px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Quick actions</div>
            <button class="export-option" data-export="clipboard" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;color:var(--text-primary,#e6edf3);font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;">📋 Copy all to clipboard</button>
            <button class="export-option" data-export="email" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;color:var(--text-primary,#e6edf3);font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;">📧 Email transcripts</button>
          </div>
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
      <div class="history-footer" style="padding:8px 12px;border-top:1px solid var(--bg-tertiary,#21262d);text-align:center;">
        <div style="font-size:11px;color:var(--text-secondary,#6B7280);margin-bottom:6px;">
          🗂️ Audio/video auto-cleaned after 7 days · Transcripts kept forever
        </div>
        <button id="historyOpenPortal" style="background:none;border:1px solid var(--color-primary,#7C3AED);color:var(--color-primary,#7C3AED);padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:500;" title="Open web portal for full history">
          🌐 View all history in Web Portal →
        </button>
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
                const d = new Date(item.date);
                const time = this._formatDate(d);
                const icon = this.engineIcons[item.engine] || '📝';
                // Strip metadata lines (Start:/End:/Words:) from preview
                let cleanText = (item.text || '').replace(/^(Start|End|Words|Recording):.*$/gm, '').trim();
                let preview = cleanText.replace(/\n/g, ' ').substring(0, 80);
                if (preview.length >= 80) preview += '…';

                // Highlight search matches
                if (searchQuery) {
                    preview = this._highlightText(preview, searchQuery);
                }

                // Media indicator badges
                const mediaBadges = this._renderMediaBadges(item);

                html += `<div class="history-entry ${isExpanded ? 'expanded' : ''}" data-id="${this._escapeHtml(String(id))}">
          <div class="history-entry-header">
            <span class="history-time" title="Recording date & time">${time}</span>
            <span class="history-preview" title="Click to expand/collapse this session">${preview}</span>
            <span class="history-badges">
              ${mediaBadges}
              <span class="history-wc" title="Word count for this session">${item.wordCount || 0}w</span>
              <span class="history-engine" title="Transcription engine used">${icon}</span>
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

        // If expanded entry has audio/video, load the players
        if (this.expandedId) {
            const item = this.filteredEntries.find(e => (e._id || e.date) === this.expandedId);
            if (item?.hasVideo && item.videoPath) {
                // Video has muxed audio — just play the video
                this._loadVideoPlayer(item.videoPath);
            } else if (item?.hasAudio && item.audioPath) {
                // Audio only — play separate audio
                this._loadAudioPlayer(item.audioPath);
            }
        }
    }

    _renderMediaBadges(item) {
        let badges = '<span class="history-media-badges">';
        badges += '<span class="media-badge media-text" title="Has transcript">📝</span>';
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

        // Readable date header at top
        const d = new Date(item.date);
        const dateHeader = this._formatDate(d, true);

        let audioSection = '';
        // Only show separate audio player if there's no video
        // (video files now contain muxed audio for perfect lip sync)
        if (item.hasAudio && item.audioPath && !(item.hasVideo && item.videoPath)) {
            audioSection = `
    <div class="history-audio-player" id="historyAudioPlayer">
      <div class="audio-loading">\ud83c\udfa4 Loading audio\u2026</div>
    </div>`;
        }
        let videoSection = '';
        if (item.hasVideo && item.videoPath) {
            videoSection = `
    <div class="history-video-player" id="historyVideoPlayer" title="Video recording with muxed audio — click play to watch">
      <div class="audio-loading">\ud83c\udfac Loading video\u2026</div>
    </div>`;
        }
        // Per-asset delete buttons (only show what exists)
        let deleteButtons = '';
        if (item._archivePath) deleteButtons += '\n    <button class="history-exp-btn history-danger" data-action="delete-text" title="Permanently delete the transcript text file for this session">🗑️ Text</button>';
        if (item.hasAudio && item.audioPath) deleteButtons += '\n    <button class="history-exp-btn history-danger" data-action="delete-audio" title="Permanently delete the audio recording for this session">🗑️ Audio</button>';
        if (item.hasVideo && item.videoPath) deleteButtons += '\n    <button class="history-exp-btn history-danger" data-action="delete-video" title="Permanently delete the video recording for this session">🗑️ Video</button>';
        deleteButtons += '\n    <button class="history-exp-btn history-danger-all" data-action="delete-all" title="Permanently delete ALL files (text, audio, video) for this session">🗑️ Delete All</button>';

        return `<div class="history-expanded">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
    <div class="history-date-header" style="font-size:12px;color:#888;padding:4px 0;" title="Date and time this session was recorded">\ud83d\udcc5 ${this._escapeHtml(dateHeader)}</div>
    <button class="history-exp-btn" data-action="collapse" title="Collapse this session" style="padding:2px 10px;font-size:11px;">▲ Close</button>
  </div>
  ${videoSection}
  ${audioSection}
  <div class="history-full-text" title="Full transcript text — select to copy portions"> ${fullText}</div>
  <div class="history-expanded-actions">
    <button class="history-exp-btn" data-action="copy" title="Copy transcript text to clipboard">\ud83d\udccb Copy</button>
    <button class="history-exp-btn" data-action="export-txt" title="Download transcript as a plain text file">\ud83d\udcbe .txt</button>
    <button class="history-exp-btn" data-action="export-md" title="Download transcript as a Markdown file">\ud83d\udcdd .md</button>
  </div>
  <div class="history-expanded-actions" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
    ${deleteButtons}
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

    async _loadVideoPlayer(videoPath) {
        const container = this.panel?.querySelector('#historyVideoPlayer');
        if (!container) return;

        try {
            if (this._activeVideoUrl) {
                URL.revokeObjectURL(this._activeVideoUrl);
                this._activeVideoUrl = null;
            }

            if (!window.windyAPI?.readArchiveVideo) {
                container.innerHTML = '<div class="audio-error">Video playback not available</div>';
                return;
            }

            const result = await window.windyAPI.readArchiveVideo(videoPath);
            if (!result?.ok || !result.base64) {
                container.innerHTML = '<div class="audio-error">Failed to load video</div>';
                return;
            }

            const binaryStr = atob(result.base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: result.mimeType || 'video/webm' });
            this._activeVideoUrl = URL.createObjectURL(blob);

            container.innerHTML = `
    <div class="video-player-wrapper">
      <span class="video-label">🎬 Recording</span>
      <video controls preload="metadata" class="history-video-el">
        <source src="${this._activeVideoUrl}" type="${result.mimeType || 'video/webm'}">
        Your browser does not support video playback.
      </video>
    </div>`;
        } catch (err) {
            console.warn('[History] Video load error:', err.message);
            container.innerHTML = '<div class="audio-error">Video load error</div>';
        }
    }

    /**
     * Link audio and video player playback — play/pause/seek one mirrors the other.
     * Video plays muted; audio comes from the audio player.
     * Uses a lock timeout to prevent infinite event loops from programmatic play/pause.
     */
    _syncAVPlayers() {
        const audio = this.panel?.querySelector('.history-audio-el');
        const video = this.panel?.querySelector('.history-video-el');
        if (!audio || !video) return;

        // Mute video — audio player provides the sound
        video.muted = true;

        let locked = false;
        const withLock = (fn) => {
            if (locked) return;
            locked = true;
            fn();
            // Hold lock for 150ms to let async events settle
            setTimeout(() => { locked = false; }, 150);
        };

        audio.addEventListener('play', () => withLock(() => {
            video.currentTime = audio.currentTime;
            video.play().catch(() => { });
        }));
        audio.addEventListener('pause', () => withLock(() => {
            video.pause();
        }));
        audio.addEventListener('seeked', () => withLock(() => {
            video.currentTime = audio.currentTime;
        }));

        video.addEventListener('play', () => withLock(() => {
            audio.currentTime = video.currentTime;
            audio.play().catch(() => { });
        }));
        video.addEventListener('pause', () => withLock(() => {
            audio.pause();
        }));
        video.addEventListener('seeked', () => withLock(() => {
            audio.currentTime = video.currentTime;
        }));

        // Add a small label indicating sync
        const wrapper = video.closest('.video-player-wrapper');
        if (wrapper) {
            const label = wrapper.querySelector('.video-label');
            if (label) label.textContent = '🎬 Recording (synced with audio)';
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

    /**
     * Format date like: Feb 28, 2026 5:07pm EST
     * @param {Date} d
     * @param {boolean} long - if true, use full month name
     */
    _formatDate(d, long = false) {
        const month = d.toLocaleString([], { month: long ? 'long' : 'short' });
        const day = d.getDate();
        const year = d.getFullYear();
        let hours = d.getHours();
        const mins = d.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;
        // Get timezone abbreviation
        const tz = d.toLocaleTimeString([], { timeZoneName: 'short' }).split(' ').pop();
        return `${month} ${day}, ${year} ${hours}:${mins}${ampm} ${tz}`;
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

        // Export dropdown
        const exportBtn = this.panel.querySelector('#historyExportAll');
        const exportDropdown = this.panel.querySelector('#exportDropdown');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportDropdown.style.display = exportDropdown.style.display === 'none' ? 'block' : 'none';
        });
        // Close dropdown on outside click
        document.addEventListener('click', () => { exportDropdown.style.display = 'none'; });
        exportDropdown.addEventListener('click', (e) => e.stopPropagation());

        // Export options
        exportDropdown.querySelectorAll('.export-option').forEach(btn => {
            btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--bg-tertiary, #21262d)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
            btn.addEventListener('click', async () => {
                exportDropdown.style.display = 'none';
                const action = btn.dataset.export;
                if (action === 'save-txt') this._exportToFile('txt');
                else if (action === 'save-srt') this._exportToFile('srt');
                else if (action === 'save-md') this._exportToFile('md');
                else if (action === 'clipboard') this._exportToClipboard();
                else if (action === 'email') this._exportToEmail();
            });
        });

        // View in Portal button
        const portalBtn = this.panel.querySelector('#historyOpenPortal');
        if (portalBtn) {
            portalBtn.addEventListener('mouseenter', () => { portalBtn.style.background = 'var(--color-primary, #7C3AED)'; portalBtn.style.color = '#fff'; });
            portalBtn.addEventListener('mouseleave', () => { portalBtn.style.background = 'none'; portalBtn.style.color = 'var(--color-primary, #7C3AED)'; });
            portalBtn.addEventListener('click', () => {
                window.windyAPI.openExternalUrl((window.API_CONFIG || {}).dashboard || 'https://windypro.thewindstorm.uk/dashboard');
            });
        }

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
                // Cleanup audio/video when collapsing
                if (this.expandedId === id) {
                    if (this._activeAudioUrl) {
                        URL.revokeObjectURL(this._activeAudioUrl);
                        this._activeAudioUrl = null;
                    }
                    if (this._activeVideoUrl) {
                        URL.revokeObjectURL(this._activeVideoUrl);
                        this._activeVideoUrl = null;
                    }
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
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const entryEl = btn.closest('.history-entry');
                const id = entryEl.dataset.id;
                const item = this.filteredEntries.find(e => (e._id || e.date) === id);
                if (!item) return;

                if (action === 'collapse') {
                    // Clean up media blob URLs
                    if (this._activeAudioUrl) { URL.revokeObjectURL(this._activeAudioUrl); this._activeAudioUrl = null; }
                    if (this._activeVideoUrl) { URL.revokeObjectURL(this._activeVideoUrl); this._activeVideoUrl = null; }
                    this.expandedId = null;
                    this.displayedCount = 0;
                    this._renderEntries();
                    return;
                }

                if (action === 'copy') {
                    navigator.clipboard.writeText(item.text || '');
                    btn.textContent = '✅ Copied';
                    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
                } else if (action === 'export-txt') {
                    this._downloadFile(item.text, 'transcript.txt', 'text/plain');
                } else if (action === 'export-md') {
                    const md = `# Transcript\n\n${item.text}\n`;
                    this._downloadFile(md, 'transcript.md', 'text/markdown');
                } else if (action === 'delete-text') {
                    if (confirm('Delete the transcript text for this session? This cannot be undone.')) {
                        await this._deleteAsset(item, 'text', btn);
                    }
                } else if (action === 'delete-audio') {
                    if (confirm('Delete the audio recording for this session? This cannot be undone.')) {
                        await this._deleteAsset(item, 'audio', btn);
                    }
                } else if (action === 'delete-video') {
                    if (confirm('Delete the video recording for this session? This cannot be undone.')) {
                        await this._deleteAsset(item, 'video', btn);
                    }
                } else if (action === 'delete-all') {
                    if (confirm('Delete this ENTIRE session (text + audio + video)? This cannot be undone.')) {
                        this._deleteEntry(item, entryEl);
                    }
                } else if (action === 'delete') {
                    if (confirm('Delete this entry? This cannot be undone.')) {
                        this._deleteEntry(item, entryEl);
                    }
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

        // Remove text, audio, video files from disk
        if (item._archivePath && window.windyAPI?.deleteArchiveEntry) {
            try { await window.windyAPI.deleteArchiveEntry(item._archivePath); } catch (_) { }
        }
        if (item.audioPath && window.windyAPI?.deleteArchiveEntry) {
            try { await window.windyAPI.deleteArchiveEntry(item.audioPath); } catch (_) { }
        }
        if (item.videoPath && window.windyAPI?.deleteArchiveEntry) {
            try { await window.windyAPI.deleteArchiveEntry(item.videoPath); } catch (_) { }
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

    async _deleteAsset(item, type, btn) {
        let filePath = null;
        if (type === 'text') filePath = item._archivePath;
        else if (type === 'audio') filePath = item.audioPath;
        else if (type === 'video') filePath = item.videoPath;

        if (!filePath || !window.windyAPI?.deleteArchiveEntry) return;

        try {
            await window.windyAPI.deleteArchiveEntry(filePath);
            btn.textContent = '✅ Deleted';
            btn.disabled = true;

            // Update item flags
            if (type === 'text') {
                item._archivePath = null;
                item.text = '[Transcript deleted]';
            } else if (type === 'audio') {
                item.hasAudio = false;
                item.audioPath = '';
            } else if (type === 'video') {
                item.hasVideo = false;
                item.videoPath = '';
            }

            // Re-render to update badges
            this.displayedCount = 0;
            this._renderEntries();
        } catch (e) {
            btn.textContent = '❌ Failed';
            console.warn('[History] Delete asset failed:', e.message);
        }
    }

    // ─── Enhanced Export Methods ─────────────────────────────────

    _buildExportContent(format) {
        const entries = this.filteredEntries;
        if (!entries.length) return null;
        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'txt') {
            let content = 'WINDY PRO — TRANSCRIPT HISTORY\n';
            content += `Exported: ${new Date().toLocaleString()}\n`;
            content += `Total: ${entries.length} recordings\n`;
            content += '═'.repeat(50) + '\n\n';
            entries.forEach((item, i) => {
                const date = new Date(item.date).toLocaleString();
                content += `[${i + 1}] ${date} — ${item.wordCount || 0} words (${item.engine || 'unknown'})\n`;
                content += (item.text || '(no transcript)') + '\n\n';
                content += '—'.repeat(40) + '\n\n';
            });
            return { content, filename: `windy-transcripts-${dateStr}.txt`, type: 'text/plain' };
        }

        if (format === 'srt') {
            let content = '';
            let counter = 1;
            entries.forEach(item => {
                const d = new Date(item.date);
                const start = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')},000`;
                const endD = new Date(d.getTime() + Math.max((item.wordCount || 10) * 300, 5000));
                const end = `${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}:${String(endD.getSeconds()).padStart(2, '0')},000`;
                content += `${counter}\n${start} --> ${end}\n${item.text || ''}\n\n`;
                counter++;
            });
            return { content, filename: `windy-transcripts-${dateStr}.srt`, type: 'text/srt' };
        }

        if (format === 'md') {
            let content = '# Windy Pro — Transcript History\n\n';
            content += `> Exported: ${new Date().toLocaleString()} · ${entries.length} recordings\n\n`;
            entries.forEach(item => {
                const date = new Date(item.date).toLocaleString();
                content += `## ${date} (${item.wordCount || 0}w · ${item.engine || 'unknown'})\n\n${item.text}\n\n---\n\n`;
            });
            return { content, filename: `windy-transcripts-${dateStr}.md`, type: 'text/markdown' };
        }

        return null;
    }

    async _exportToFile(format) {
        const data = this._buildExportContent(format);
        if (!data) return;

        // Use Electron's native save dialog — user can pick ANY location (USB, SSD, network drive)
        try {
            const filterMap = {
                txt: { name: 'Text Files', extensions: ['txt'] },
                srt: { name: 'Subtitle Files', extensions: ['srt'] },
                md: { name: 'Markdown Files', extensions: ['md'] }
            };
            const result = await window.windyAPI.saveFile({
                defaultPath: data.filename,
                filters: [filterMap[format] || filterMap.txt],
                content: data.content
            });
            if (result?.saved) {
                this._showExportToast(`✅ Saved to ${result.path || 'chosen location'}`);
            }
        } catch (err) {
            // Fallback to browser download
            this._downloadFile(data.content, data.filename, data.type);
            this._showExportToast('📥 Downloaded to default folder');
        }
    }

    _exportToClipboard() {
        const data = this._buildExportContent('txt');
        if (!data) return;
        navigator.clipboard.writeText(data.content);
        this._showExportToast('📋 All transcripts copied to clipboard!');
    }

    _exportToEmail() {
        const data = this._buildExportContent('txt');
        if (!data) return;
        // Truncate for mailto URL limit (~2000 chars)
        const body = data.content.length > 1800
            ? data.content.substring(0, 1800) + '\n\n… (truncated — use Save to File for full export)'
            : data.content;
        const subject = `Windy Pro Transcripts — ${new Date().toLocaleDateString()}`;
        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.windyAPI.openExternalUrl(mailto);
        this._showExportToast('📧 Opening email client…');
    }

    _showExportToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#22C55E;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
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
