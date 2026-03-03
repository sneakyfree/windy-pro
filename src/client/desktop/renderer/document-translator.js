/**
 * Windy Pro — Document & Batch Translation
 * Feature 2: Drag-drop PDF/DOCX/TXT → translate → output new file
 * Feature 3: Paste CSV/phrases → translate all → export CSV
 */

class DocumentTranslator {
    constructor() {
        this.sourceLang = 'auto';
        this.targetLang = 'es';
        this.isProcessing = false;
    }

    static LANGUAGES = [
        { code: 'auto', name: 'Auto-Detect' },
        { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' }, { code: 'pt', name: 'Portuguese' },
        { code: 'zh', name: 'Chinese' }, { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' }, { code: 'ar', name: 'Arabic' },
        { code: 'ru', name: 'Russian' }, { code: 'hi', name: 'Hindi' },
        { code: 'tr', name: 'Turkish' }, { code: 'nl', name: 'Dutch' },
        { code: 'pl', name: 'Polish' }, { code: 'sv', name: 'Swedish' },
    ];

    render(container) {
        container.innerHTML = `
      <div class="doc-translator" id="doc-translator">
        <div class="doc-header">
          <h2>📄 Document & Batch Translation</h2>
          <button class="conv-close-btn" id="doc-close">✕</button>
        </div>

        <div class="doc-tabs">
          <button class="doc-tab active" data-tab="document">📄 Document</button>
          <button class="doc-tab" data-tab="batch">📋 Batch</button>
        </div>

        <div class="doc-lang-bar">
          <select id="doc-source-lang" class="conv-lang-select">
            ${DocumentTranslator.LANGUAGES.map(l =>
            `<option value="${l.code}" ${l.code === this.sourceLang ? 'selected' : ''}>${l.name}</option>`
        ).join('')}
          </select>
          <span class="doc-arrow">→</span>
          <select id="doc-target-lang" class="conv-lang-select">
            ${DocumentTranslator.LANGUAGES.filter(l => l.code !== 'auto').map(l =>
            `<option value="${l.code}" ${l.code === this.targetLang ? 'selected' : ''}>${l.name}</option>`
        ).join('')}
          </select>
        </div>

        <!-- Document Tab -->
        <div class="doc-panel" id="doc-panel-document">
          <div class="doc-dropzone" id="doc-dropzone">
            <div class="doc-dropzone-content">
              <span class="doc-dropzone-icon">📂</span>
              <p>Drag & drop a file here</p>
              <p class="doc-dropzone-hint">Supports: PDF, DOCX, TXT, MD, HTML</p>
              <button class="doc-browse-btn" id="doc-browse">Browse Files</button>
            </div>
          </div>
          <div class="doc-progress" id="doc-progress" style="display:none">
            <div class="doc-progress-bar"><div class="doc-progress-fill" id="doc-progress-fill"></div></div>
            <p id="doc-progress-text">Translating...</p>
          </div>
          <div class="doc-result" id="doc-result" style="display:none">
            <textarea id="doc-result-text" class="doc-result-textarea" readonly></textarea>
            <div class="doc-result-actions">
              <button class="doc-action-btn" id="doc-copy">📋 Copy</button>
              <button class="doc-action-btn" id="doc-save">💾 Save As File</button>
            </div>
          </div>
        </div>

        <!-- Batch Tab -->
        <div class="doc-panel" id="doc-panel-batch" style="display:none">
          <textarea id="batch-input" class="doc-batch-input" placeholder="Paste phrases here — one per line, or CSV format:&#10;hello&#10;goodbye&#10;thank you"></textarea>
          <div class="doc-batch-actions">
            <button class="doc-action-btn" id="batch-translate">🌍 Translate All</button>
            <button class="doc-action-btn" id="batch-export" style="display:none">📥 Export CSV</button>
          </div>
          <div class="doc-batch-results" id="batch-results" style="display:none">
            <table class="doc-batch-table">
              <thead><tr><th>Source</th><th>Translation</th></tr></thead>
              <tbody id="batch-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

        this.bindEvents(container);
    }

    bindEvents(container) {
        // Tabs
        container.querySelectorAll('.doc-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                container.querySelectorAll('.doc-panel').forEach(p => p.style.display = 'none');
                document.getElementById(`doc-panel-${tab.dataset.tab}`).style.display = 'block';
            });
        });

        // Language selectors
        document.getElementById('doc-source-lang').addEventListener('change', e => { this.sourceLang = e.target.value; });
        document.getElementById('doc-target-lang').addEventListener('change', e => { this.targetLang = e.target.value; });

        // Drag & drop
        const dropzone = document.getElementById('doc-dropzone');
        dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', e => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
        });

        // Browse button
        document.getElementById('doc-browse').addEventListener('click', () => {
            if (window.windyAPI?.browseDocumentFile) {
                window.windyAPI.browseDocumentFile().then(result => {
                    if (result?.text) this.translateDocument(result.text, result.name);
                });
            }
        });

        // Copy / Save
        document.getElementById('doc-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(document.getElementById('doc-result-text').value);
        });
        document.getElementById('doc-save').addEventListener('click', () => {
            const text = document.getElementById('doc-result-text').value;
            window.windyAPI?.saveFile({ content: text, defaultName: `translated-${Date.now()}.txt` });
        });

        // Batch translate
        document.getElementById('batch-translate').addEventListener('click', () => this.batchTranslate());
        document.getElementById('batch-export').addEventListener('click', () => this.exportBatchCSV());

        // Close
        document.getElementById('doc-close').addEventListener('click', () => container.innerHTML = '');
    }

    async handleFile(file) {
        const name = file.name;
        const ext = name.split('.').pop().toLowerCase();

        if (!['txt', 'md', 'html', 'csv', 'pdf', 'docx'].includes(ext)) {
            alert('Unsupported file type. Use: PDF, DOCX, TXT, MD, HTML');
            return;
        }

        let text = '';
        if (['txt', 'md', 'html', 'csv'].includes(ext)) {
            text = await file.text();
            if (ext === 'html') {
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                text = doc.body.textContent || '';
            }
        } else {
            // For PDF/DOCX, send to main process for extraction
            const reader = new FileReader();
            const b64 = await new Promise(resolve => {
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(file);
            });
            try {
                const result = await window.windyAPI.extractDocumentText(b64, ext);
                text = result?.text || '';
            } catch {
                text = `[Could not extract text from ${ext.toUpperCase()} — try TXT or MD format]`;
            }
        }

        if (text.trim()) {
            this.translateDocument(text, name);
        }
    }

    async translateDocument(text, filename) {
        document.getElementById('doc-dropzone').style.display = 'none';
        document.getElementById('doc-progress').style.display = 'block';
        document.getElementById('doc-result').style.display = 'none';

        // Split into chunks for progress reporting
        const lines = text.split('\n');
        const chunkSize = 10;
        const chunks = [];
        for (let i = 0; i < lines.length; i += chunkSize) {
            chunks.push(lines.slice(i, i + chunkSize).join('\n'));
        }

        const translated = [];
        for (let i = 0; i < chunks.length; i++) {
            const pct = Math.round(((i + 1) / chunks.length) * 100);
            document.getElementById('doc-progress-fill').style.width = `${pct}%`;
            document.getElementById('doc-progress-text').textContent = `Translating... ${pct}% (${i + 1}/${chunks.length} chunks)`;

            try {
                const result = await window.windyAPI.translateOffline(chunks[i], this.sourceLang === 'auto' ? 'en' : this.sourceLang, this.targetLang);
                translated.push(result?.text || result || chunks[i]);
            } catch {
                translated.push(chunks[i]); // fallback to original
            }
        }

        const fullTranslation = translated.join('\n');
        document.getElementById('doc-progress').style.display = 'none';
        document.getElementById('doc-result').style.display = 'block';
        document.getElementById('doc-result-text').value = fullTranslation;

        // Save to translation memory
        if (window.windyAPI.saveTranslationMemory) {
            window.windyAPI.saveTranslationMemory({
                source: text.substring(0, 200), target: fullTranslation.substring(0, 200),
                sourceLang: this.sourceLang, targetLang: this.targetLang
            });
        }
    }

    async batchTranslate() {
        const input = document.getElementById('batch-input').value.trim();
        if (!input) return;

        const phrases = input.split('\n').filter(l => l.trim());
        const tbody = document.getElementById('batch-tbody');
        tbody.innerHTML = '';
        document.getElementById('batch-results').style.display = 'block';
        document.getElementById('batch-export').style.display = 'inline-block';

        this.batchData = [];

        for (const phrase of phrases) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${phrase}</td><td class="batch-translating">⏳ Translating...</td>`;
            tbody.appendChild(row);

            try {
                const result = await window.windyAPI.translateOffline(phrase, this.sourceLang === 'auto' ? 'en' : this.sourceLang, this.targetLang);
                const translated = result?.text || result || phrase;
                row.cells[1].textContent = translated;
                row.cells[1].className = '';
                this.batchData.push({ source: phrase, translation: translated });
            } catch {
                row.cells[1].textContent = '❌ Failed';
                row.cells[1].className = 'batch-error';
                this.batchData.push({ source: phrase, translation: 'ERROR' });
            }
        }
    }

    exportBatchCSV() {
        if (!this.batchData?.length) return;
        const csv = 'Source,Translation\n' + this.batchData.map(r =>
            `"${r.source.replace(/"/g, '""')}","${r.translation.replace(/"/g, '""')}"`
        ).join('\n');
        window.windyAPI?.saveFile({ content: csv, defaultName: `batch-translation-${Date.now()}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    }
}

window.DocumentTranslator = DocumentTranslator;
