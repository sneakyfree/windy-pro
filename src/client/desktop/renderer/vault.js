/**
 * Windy Pro - Vault Panel (Transcript History Browser)
 * 
 * Slide-in panel for browsing, searching, and exporting
 * past transcription sessions from the local SQLite vault.
 * 
 * DNA Strand: FEAT-066
 */

class VaultPanel {
    constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.sessions = [];
        this.currentSession = null;
        this.panel = null;
        this.init();
    }

    init() {
        this.panel = document.createElement('div');
        this.panel.id = 'vaultPanel';
        this.panel.className = 'vault-panel';
        this.panel.innerHTML = `
      <div class="vault-header">
        <h3>📜 Prompt Vault</h3>
        <button class="vault-close" id="vaultCloseBtn">✕</button>
      </div>
      <div class="vault-search">
        <input type="text" id="vaultSearchInput" placeholder="Search transcripts..." />
        <button class="vault-search-btn" id="vaultSearchBtn">🔍</button>
      </div>
      <div class="vault-body" id="vaultBody">
        <div class="vault-list" id="vaultList">
          <div class="vault-empty">No sessions yet. Start recording!</div>
        </div>
        <div class="vault-detail" id="vaultDetail" style="display:none;">
          <div class="vault-detail-header">
            <button class="vault-back" id="vaultBackBtn">← Back</button>
            <div class="vault-detail-actions">
              <button class="vault-action-btn" id="vaultExportTxt" title="Export TXT">📄</button>
              <button class="vault-action-btn" id="vaultExportMd" title="Export Markdown">📝</button>
              <button class="vault-action-btn vault-delete" id="vaultDeleteBtn" title="Delete">🗑️</button>
            </div>
          </div>
          <div class="vault-detail-meta" id="vaultDetailMeta"></div>
          <div class="vault-detail-content" id="vaultDetailContent"></div>
        </div>
      </div>
    `;
        document.body.appendChild(this.panel);
        this.bindEvents();
    }

    bindEvents() {
        this.panel.querySelector('#vaultCloseBtn').addEventListener('click', () => this.close());
        this.panel.querySelector('#vaultBackBtn').addEventListener('click', () => this.showList());
        this.panel.querySelector('#vaultSearchBtn').addEventListener('click', () => this.search());

        const searchInput = this.panel.querySelector('#vaultSearchInput');
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.search();
        });

        // Export buttons
        this.panel.querySelector('#vaultExportTxt').addEventListener('click', () => this.exportSession('txt'));
        this.panel.querySelector('#vaultExportMd').addEventListener('click', () => this.exportSession('md'));
        this.panel.querySelector('#vaultDeleteBtn').addEventListener('click', () => this.deleteSession());
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    async open() {
        this.panel.classList.add('open');
        this.isOpen = true;
        await this.loadSessions();
    }

    close() {
        this.panel.classList.remove('open');
        this.isOpen = false;
    }

    async loadSessions() {
        if (!this.app.ws || this.app.ws.readyState !== WebSocket.OPEN) {
            this.showEmptyState('Not connected to server');
            return;
        }

        // Request session list via WebSocket
        this.app.ws.send(JSON.stringify({ action: 'vault_list', limit: 100 }));

        // Listen for response (one-shot)
        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'vault_list') {
                    this.sessions = msg.sessions || [];
                    this.renderSessionList();
                    this.app.ws.removeEventListener('message', handler);
                }
            } catch (e) { }
        };
        this.app.ws.addEventListener('message', handler);
    }

    renderSessionList() {
        const list = this.panel.querySelector('#vaultList');

        if (!this.sessions.length) {
            this.showEmptyState('No sessions yet. Start recording!');
            return;
        }

        list.innerHTML = this.sessions.map(s => {
            const date = new Date(s.started_at);
            const dateStr = date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            const duration = s.duration_s ? `${Math.floor(s.duration_s / 60)}m ${Math.floor(s.duration_s % 60)}s` : 'In progress';
            const words = s.word_count || 0;

            return `
        <div class="vault-session-card" data-id="${s.id}">
          <div class="vault-session-date">${dateStr}</div>
          <div class="vault-session-stats">
            <span>⏱ ${duration}</span>
            <span>📝 ${words} words</span>
          </div>
        </div>
      `;
        }).join('');

        // Click handlers
        list.querySelectorAll('.vault-session-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.dataset.id);
                this.openSession(id);
            });
        });
    }

    async openSession(sessionId) {
        this.currentSession = sessionId;

        this.app.ws.send(JSON.stringify({ action: 'vault_get', session_id: sessionId }));

        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'vault_get' && msg.session) {
                    this.renderSessionDetail(msg.session);
                    this.app.ws.removeEventListener('message', handler);
                }
            } catch (e) { }
        };
        this.app.ws.addEventListener('message', handler);
    }

    renderSessionDetail(session) {
        const detail = this.panel.querySelector('#vaultDetail');
        const list = this.panel.querySelector('#vaultList');

        list.style.display = 'none';
        detail.style.display = 'block';

        // Meta
        const meta = this.panel.querySelector('#vaultDetailMeta');
        const date = new Date(session.started_at);
        meta.innerHTML = `
      <div class="vault-meta-row">${date.toLocaleString()}</div>
      <div class="vault-meta-row">${session.word_count || 0} words · ${session.segment_count || 0} segments</div>
    `;

        // Content
        const content = this.panel.querySelector('#vaultDetailContent');
        if (session.segments && session.segments.length) {
            content.innerHTML = session.segments.map(seg => {
                const time = this.formatTime(seg.start_time);
                return `<div class="vault-segment">
          <span class="vault-timestamp">[${time}]</span> ${seg.text}
        </div>`;
            }).join('');
        } else {
            content.innerHTML = '<div class="vault-empty">No segments recorded.</div>';
        }
    }

    showList() {
        this.panel.querySelector('#vaultDetail').style.display = 'none';
        this.panel.querySelector('#vaultList').style.display = 'block';
        this.currentSession = null;
    }

    async search() {
        const query = this.panel.querySelector('#vaultSearchInput').value.trim();
        if (!query) {
            await this.loadSessions();
            return;
        }

        this.app.ws.send(JSON.stringify({ action: 'vault_search', query }));

        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'vault_search') {
                    this.renderSearchResults(msg.results || []);
                    this.app.ws.removeEventListener('message', handler);
                }
            } catch (e) { }
        };
        this.app.ws.addEventListener('message', handler);
    }

    renderSearchResults(results) {
        const list = this.panel.querySelector('#vaultList');

        if (!results.length) {
            list.innerHTML = '<div class="vault-empty">No results found.</div>';
            return;
        }

        list.innerHTML = results.map(r => `
      <div class="vault-search-result">
        <div class="vault-search-text">${r.text}</div>
        <div class="vault-search-meta">Session #${r.session_id} · ${this.formatTime(r.start_time)}</div>
      </div>
    `).join('');
    }

    async exportSession(format) {
        if (!this.currentSession) return;

        this.app.ws.send(JSON.stringify({
            action: 'vault_export',
            session_id: this.currentSession,
            format
        }));

        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'vault_export' && msg.content) {
                    // Copy to clipboard
                    navigator.clipboard.writeText(msg.content).then(() => {
                        this.showToast(`Exported as ${format.toUpperCase()} — copied to clipboard!`);
                    });
                    this.app.ws.removeEventListener('message', handler);
                }
            } catch (e) { }
        };
        this.app.ws.addEventListener('message', handler);
    }

    async deleteSession() {
        if (!this.currentSession) return;
        if (!confirm('Delete this session permanently?')) return;

        this.app.ws.send(JSON.stringify({
            action: 'vault_delete',
            session_id: this.currentSession
        }));

        this.showList();
        await this.loadSessions();
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'vault-toast';
        toast.textContent = message;
        this.panel.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    showEmptyState(message) {
        this.panel.querySelector('#vaultList').innerHTML =
            `<div class="vault-empty">${message}</div>`;
    }

    formatTime(seconds) {
        if (!seconds && seconds !== 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}
