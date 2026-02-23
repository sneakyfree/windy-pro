/**
 * Windy Pro — Transcript History Panel
 * Shows last 20 transcripts, click to load, export, clear.
 */
class HistoryPanel {
    constructor(app) {
        this.app = app;
        this.panel = null;
        this.isOpen = false;
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    open() {
        if (this.panel) this.panel.remove();
        this.panel = document.createElement('div');
        this.panel.className = 'history-panel open';
        this.panel.innerHTML = this._buildHTML();
        document.getElementById('app').appendChild(this.panel);
        this._bindEvents();
        this.isOpen = true;
    }

    close() {
        if (this.panel) {
            this.panel.classList.remove('open');
            setTimeout(() => { this.panel.remove(); this.panel = null; }, 300);
        }
        this.isOpen = false;
    }

    _getHistory() {
        try {
            return JSON.parse(localStorage.getItem('windy_history') || '[]');
        } catch (_) {
            return [];
        }
    }

    _buildHTML() {
        const history = this._getHistory();
        const engineIcons = { local: '🏠', cloud: '☁️', deepgram: '🎙️', groq: '⚡', openai: '🌐', stream: '📝' };

        let listHTML = '';
        if (history.length === 0) {
            listHTML = '<div class="history-empty">No transcripts yet.<br>Record something to get started!</div>';
        } else {
            history.forEach((item, i) => {
                const date = new Date(item.date);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                const icon = engineIcons[item.engine] || '📝';
                const preview = (item.text || '').substring(0, 60).replace(/\n/g, ' ');
                listHTML += `
          <div class="history-item" data-index="${i}">
            <div class="history-item-header">
              <span class="history-date">${dateStr} ${timeStr}</span>
              <span class="history-meta">${icon} ${item.wordCount || 0}w</span>
            </div>
            <div class="history-preview">${preview}${preview.length >= 60 ? '…' : ''}</div>
          </div>
        `;
            });
        }

        return `
      <div class="history-header">
        <h3>📜 History</h3>
        <button class="history-close" id="historyClose">✕</button>
      </div>
      <div class="history-actions">
        <button class="history-action-btn" id="historyExport">📥 Export All</button>
        <button class="history-action-btn history-danger" id="historyClear">🗑️ Clear</button>
      </div>
      <div class="history-body">${listHTML}</div>
    `;
    }

    _bindEvents() {
        this.panel.querySelector('#historyClose').addEventListener('click', () => this.close());

        // Click to load transcript
        this.panel.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                const history = this._getHistory();
                if (history[idx]) {
                    this.app._displayBatchResult(history[idx].text);
                    this.close();
                }
            });
        });

        // Export all
        this.panel.querySelector('#historyExport').addEventListener('click', () => {
            const history = this._getHistory();
            if (!history.length) return;
            let content = '# Windy Pro — Transcript History\n\n';
            history.forEach(item => {
                const date = new Date(item.date).toLocaleString();
                content += `## ${date} (${item.wordCount}w · ${item.engine})\n\n${item.text}\n\n---\n\n`;
            });
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `windy-pro-history-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Clear history
        this.panel.querySelector('#historyClear').addEventListener('click', () => {
            if (confirm('Clear all transcript history?')) {
                localStorage.removeItem('windy_history');
                this.close();
                this.open(); // Reopen with empty state
            }
        });
    }
}
