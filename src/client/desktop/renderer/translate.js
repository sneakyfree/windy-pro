/**
 * Windy Pro — Real-time Speech Translation Panel
 *
 * Features:
 * - Press-and-hold mic button with animated waveform
 * - Source / target language dropdowns
 * - Live transcript with confidence badges
 * - Translated audio playback
 * - Offline badge when backend is unreachable
 */

class TranslatePanel {
    constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.isRecording = false;
        this.isOnline = true;
        this.languages = [];
        this.history = [];
        this.offlineQueue = [];
        this._healthInterval = null;

        // Audio capture
        this._stream = null;
        this._audioCtx = null;
        this._analyser = null;
        this._recorder = null;
        this._chunks = [];

        // Waveform
        this._canvas = null;
        this._canvasCtx = null;
        this._animFrame = null;

        this._build();
        this._bindEvents();
        this._startHealthCheck();
    }

    // ─── Build DOM ────────────────────────────────────────────────

    _build() {
        const panel = document.createElement('div');
        panel.className = 'translate-panel';
        panel.id = 'translatePanel';
        panel.innerHTML = `
      <div class="translate-header">
        <h2>🌐 Translate</h2>
        <span class="translate-offline-badge" id="translateOfflineBadge" style="display:none;">⚡ Offline</span>
        <button class="translate-close-btn" id="translateCloseBtn">×</button>
      </div>

      <div class="translate-body">
        <!-- Language selectors -->
        <div class="translate-lang-row">
          <select id="translateSourceLang" class="translate-lang-select" title="Source language">
            <option value="auto">🔍 Auto-detect</option>
          </select>
          <button class="translate-swap-btn" id="translateSwapBtn" title="Swap languages">⇄</button>
          <select id="translateTargetLang" class="translate-lang-select" title="Target language">
            <option value="es">🇪🇸 Spanish</option>
          </select>
        </div>

        <!-- Waveform + mic button -->
        <div class="translate-mic-area">
          <canvas id="translateWaveform" class="translate-waveform" width="280" height="64"></canvas>
          <button class="translate-mic-btn" id="translateMicBtn" title="Hold to record">
            <span class="translate-mic-icon">🎤</span>
          </button>
          <div class="translate-mic-hint">Hold to speak</div>
          <div class="translate-speech-hint" id="translateSpeechHint" 
               style="font-size:11px;color:#9CA3AF;margin-top:4px;text-align:center;">
            🎙️ Speak in any language → translates to <strong>your selected target</strong>
          </div>
        </div>

        <!-- Text input alternative -->
        <div class="translate-text-input-row">
          <textarea id="translateTextInput" class="translate-text-input"
            placeholder="Or type text to translate…" rows="2"></textarea>
          <button class="translate-text-btn" id="translateTextBtn" title="Translate text">→</button>
        </div>

        <!-- Result area -->
        <div class="translate-result" id="translateResult">
          <div class="translate-source-text" id="translateSourceText"></div>
          <div class="translate-divider"></div>
          <div class="translate-target-text" id="translateTargetText"></div>
          <div class="translate-confidence" id="translateConfidence"></div>
          <div class="translate-actions">
            <button class="translate-action-btn" id="translateCopyBtn" title="Copy translation">📋</button>
            <button class="translate-action-btn" id="translateFavBtn" title="Save to favorites">⭐</button>
            <button class="translate-action-btn" id="translatePlayBtn" title="Play audio">🔊</button>
          </div>
        </div>
        <audio id="translateAudio" style="display:none;"></audio>

        <!-- History -->
        <div class="translate-history-header">
          <span>Recent</span>
        </div>
        <div class="translate-history" id="translateHistory"></div>
      </div>
    `;

        document.body.appendChild(panel);
        this._panel = panel;

        // Cache DOM refs
        this._sourceLang = document.getElementById('translateSourceLang');
        this._targetLang = document.getElementById('translateTargetLang');
        this._micBtn = document.getElementById('translateMicBtn');
        this._canvas = document.getElementById('translateWaveform');
        this._canvasCtx = this._canvas.getContext('2d');
        this._sourceText = document.getElementById('translateSourceText');
        this._targetText = document.getElementById('translateTargetText');
        this._confidence = document.getElementById('translateConfidence');
        this._resultArea = document.getElementById('translateResult');
        this._textInput = document.getElementById('translateTextInput');
        this._historyEl = document.getElementById('translateHistory');
        this._offlineBadge = document.getElementById('translateOfflineBadge');
        this._audioEl = document.getElementById('translateAudio');
    }

    // ─── Events ───────────────────────────────────────────────────

    _bindEvents() {
        // Close
        document.getElementById('translateCloseBtn').addEventListener('click', () => this.close());

        // Swap languages
        document.getElementById('translateSwapBtn').addEventListener('click', () => {
            const src = this._sourceLang.value;
            const tgt = this._targetLang.value;
            if (src !== 'auto') {
                this._sourceLang.value = tgt;
                this._targetLang.value = src;
            }
        });

        // Press-and-hold mic
        this._micBtn.addEventListener('mousedown', (e) => { e.preventDefault(); this._startSpeechCapture(); });
        this._micBtn.addEventListener('mouseup', () => this._stopSpeechCapture());
        this._micBtn.addEventListener('mouseleave', () => { if (this.isRecording) this._stopSpeechCapture(); });
        // Touch support
        this._micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this._startSpeechCapture(); });
        this._micBtn.addEventListener('touchend', () => this._stopSpeechCapture());

        // Text translate
        document.getElementById('translateTextBtn').addEventListener('click', () => this._translateText());
        this._textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._translateText(); }
        });

        // Copy
        document.getElementById('translateCopyBtn').addEventListener('click', () => {
            const text = this._targetText.textContent;
            if (text) {
                navigator.clipboard.writeText(text);
                document.getElementById('translateCopyBtn').textContent = '✓';
                setTimeout(() => { document.getElementById('translateCopyBtn').textContent = '📋'; }, 1000);
            }
        });

        // Favorite
        document.getElementById('translateFavBtn').addEventListener('click', () => this._saveFavorite());

        // Play audio
        document.getElementById('translatePlayBtn').addEventListener('click', () => {
            if (this._audioEl.src) {
                this._audioEl.play().catch(() => { });
            }
        });
    }

    // ─── Open / Close ─────────────────────────────────────────────

    open() {
        this._panel.classList.add('open');
        this.isOpen = true;
        this._loadLanguages();
        this._loadHistory();
    }

    close() {
        this._panel.classList.remove('open');
        this.isOpen = false;
        if (this.isRecording) this._stopSpeechCapture();
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    // ─── Language Loading ─────────────────────────────────────────

    async _loadLanguages() {
        if (this.languages.length > 0) return;
        try {
            const resp = await fetch('https://windypro.thewindstorm.uk/api/v1/translate/languages');
            if (!resp.ok) throw new Error('Failed to load languages');
            const data = await resp.json();
            this.languages = data.languages || [];
            this._populateDropdowns();
        } catch (err) {
            console.warn('[Translate] Could not load languages, using defaults:', err.message);
            this.languages = [
                { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' },
                { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
                { code: 'pt', name: 'Portuguese' }, { code: 'it', name: 'Italian' },
                { code: 'zh', name: 'Chinese' }, { code: 'ja', name: 'Japanese' },
                { code: 'ko', name: 'Korean' }, { code: 'ar', name: 'Arabic' },
                { code: 'hi', name: 'Hindi' }, { code: 'ru', name: 'Russian' },
            ];
            this._populateDropdowns();
        }
    }

    _populateDropdowns() {
        // Source (with auto-detect)
        this._sourceLang.innerHTML = '<option value="auto">🔍 Auto-detect</option>';
        // Target
        this._targetLang.innerHTML = '';

        for (const lang of this.languages) {
            const srcOpt = document.createElement('option');
            srcOpt.value = lang.code;
            srcOpt.textContent = lang.name;
            this._sourceLang.appendChild(srcOpt);

            const tgtOpt = document.createElement('option');
            tgtOpt.value = lang.code;
            tgtOpt.textContent = lang.name;
            this._targetLang.appendChild(tgtOpt);
        }

        // Default target to Spanish
        this._targetLang.value = 'es';
    }

    // ─── Speech Capture ───────────────────────────────────────────

    async _startSpeechCapture() {
        if (this.isRecording) return;
        this.isRecording = true;
        this._micBtn.classList.add('recording');
        this._chunks = [];

        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
            });

            // Waveform analyser
            this._audioCtx = new AudioContext({ sampleRate: 16000 });
            const source = this._audioCtx.createMediaStreamSource(this._stream);
            this._analyser = this._audioCtx.createAnalyser();
            this._analyser.fftSize = 256;
            source.connect(this._analyser);
            this._drawWaveform();

            // MediaRecorder for blob
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus' : 'audio/webm';
            this._recorder = new MediaRecorder(this._stream, { mimeType });
            this._recorder.ondataavailable = (e) => {
                if (e.data.size > 0) this._chunks.push(e.data);
            };
            this._recorder.start(250); // 250ms chunks for progress
        } catch (err) {
            console.error('[Translate] Mic access failed:', err);
            this.isRecording = false;
            this._micBtn.classList.remove('recording');
        }
    }

    async _stopSpeechCapture() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this._micBtn.classList.remove('recording');

        // Stop waveform
        if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
        this._clearWaveform();

        // Stop recorder
        if (this._recorder && this._recorder.state !== 'inactive') {
            await new Promise(resolve => {
                this._recorder.onstop = resolve;
                this._recorder.stop();
            });
        }

        // Stop mic
        if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
        if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }

        // Send audio for translation
        if (this._chunks.length > 0) {
            const blob = new Blob(this._chunks, { type: 'audio/webm' });
            await this._translateSpeech(blob);
        }
    }

    // ─── Waveform Drawing ─────────────────────────────────────────

    _drawWaveform() {
        if (!this.isRecording || !this._analyser) return;

        const bufLen = this._analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        this._analyser.getByteFrequencyData(data);

        const w = this._canvas.width;
        const h = this._canvas.height;
        const ctx = this._canvasCtx;

        // Clear with fading trail
        ctx.fillStyle = 'rgba(31, 41, 55, 0.4)';
        ctx.fillRect(0, 0, w, h);

        // Draw frequency bars
        const barCount = 32;
        const barGap = 2;
        const barW = (w - barGap * (barCount - 1)) / barCount;
        const step = Math.floor(bufLen / barCount);

        for (let i = 0; i < barCount; i++) {
            const val = data[i * step] / 255;
            const barH = Math.max(2, val * h * 0.9);

            // Green gradient based on intensity
            const intensity = Math.round(120 + val * 135);
            ctx.fillStyle = `rgba(34, ${intensity}, 94, ${0.6 + val * 0.4})`;

            const x = i * (barW + barGap);
            const y = (h - barH) / 2;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, 2);
            ctx.fill();
        }

        this._animFrame = requestAnimationFrame(() => this._drawWaveform());
    }

    _clearWaveform() {
        const ctx = this._canvasCtx;
        ctx.fillStyle = 'rgba(31, 41, 55, 1)';
        ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    }

    // ─── Translation API Calls ────────────────────────────────────

    async _translateSpeech(audioBlob) {
        const targetLang = this._targetLang.value;
        const isTargetEnglish = targetLang === 'en';
        this._sourceText.textContent = 'Translating speech…';
        this._targetText.textContent = '';
        this._confidence.innerHTML = '';
        this._resultArea.classList.add('visible');

        // ── Step 1: Whisper transcribes/translates speech → English text ──
        let englishText = '';
        try {
            const config = await window.windyAPI.getServerConfig();
            const wsUrl = `ws://${config.host}:${config.port}`;
            const ws = new WebSocket(wsUrl);

            englishText = await new Promise((resolve, reject) => {
                let timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error('Translation timed out'));
                }, 30000);

                ws.onopen = async () => {
                    try {
                        ws.send(JSON.stringify({
                            action: 'translate_blob',
                            language: this._sourceLang.value === 'auto' ? 'auto' : this._sourceLang.value
                        }));
                        const arrayBuf = await audioBlob.arrayBuffer();
                        ws.send(arrayBuf);
                    } catch (e) {
                        clearTimeout(timeout);
                        reject(new Error('Failed to send audio: ' + e.message));
                    }
                };

                ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'translate_result') {
                        clearTimeout(timeout);
                        ws.close();
                        if (msg.error) {
                            reject(new Error(msg.error));
                        } else {
                            resolve(msg.text || '');
                        }
                    }
                };

                ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('Local engine not running'));
                };
            });
        } catch (localErr) {
            console.warn('[Translate] Whisper unavailable:', localErr.message);
            this._sourceText.textContent = '⚠️ Translation unavailable';
            this._targetText.textContent = 'Start the Windy Pro engine to enable speech translation.';
            return;
        }

        if (!englishText || !englishText.trim()) {
            this._sourceText.textContent = '🎙️ (no speech detected)';
            this._targetText.textContent = 'Try speaking more clearly or holding the mic button longer.';
            return;
        }

        // ── If target is English, we're done ──
        if (isTargetEnglish) {
            this._showResult({
                sourceText: `🎙️ You spoke`,
                translatedText: englishText,
                confidence: 0.92,
                engine: 'local-whisper'
            });
            this._confidence.innerHTML += `
                <span class="confidence-badge" style="background:#3B82F620;color:#3B82F6;border:1px solid #3B82F640;margin-left:6px;">
                    🏠 Translated locally by Whisper
                </span>
            `;
            return;
        }

        // ── Step 2: English → target language via text translation API ──
        this._sourceText.textContent = `🎙️ Heard: "${englishText}"`;
        this._targetText.textContent = `Translating to ${this._getLanguageName(targetLang)}…`;

        try {
            const token = localStorage.getItem('windy_cloudToken') || '';
            const body = JSON.stringify({
                text: englishText,
                sourceLang: 'en',
                targetLang: targetLang
            });
            let resp = await fetch('https://windypro.thewindstorm.uk/api/v1/translate/text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body
            });

            // Retry without token on auth failure
            if (resp.status === 401 || resp.status === 403) {
                resp = await fetch('https://windypro.thewindstorm.uk/api/v1/translate/text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
            }

            if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
            const data = await resp.json();
            const translated = data.translatedText || data.translated || '';

            if (translated && !translated.startsWith('[')) {
                this._showResult({
                    sourceText: `🎙️ Heard (English): "${englishText}"`,
                    translatedText: translated,
                    confidence: data.confidence || 0.9,
                    engine: data.engine || 'ai'
                });
                this._confidence.innerHTML += `
                    <span class="confidence-badge" style="background:#3B82F620;color:#3B82F6;border:1px solid #3B82F640;margin-left:6px;">
                        🏠 Speech by Whisper · 🌐 Text by ${data.engine === 'groq' ? 'Groq AI' : data.engine === 'openai' ? 'OpenAI' : 'AI'}
                    </span>
                `;
                return;
            }
        } catch (textErr) {
            console.warn('[Translate] Text translation API failed:', textErr.message);
        }

        // ── Fallback: show English result with note ──
        this._showResult({
            sourceText: `🎙️ Heard (English)`,
            translatedText: englishText,
            confidence: 0.92,
            engine: 'local-whisper'
        });
        this._confidence.innerHTML += `
            <span class="confidence-badge" style="background:#EAB30820;color:#EAB308;border:1px solid #EAB30840;margin-left:6px;">
                ⚠️ Text translation unavailable — showing English from Whisper
            </span>
        `;
    }

    /** Get human-readable language name from code */
    _getLanguageName(code) {
        const names = {
            en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
            pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
            ru: 'Russian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', hi: 'Hindi'
        };
        return names[code] || code.toUpperCase();
    }

    async _translateText() {
        const text = this._textInput.value.trim();
        if (!text) return;

        this._sourceText.textContent = text;
        this._targetText.textContent = 'Translating…';
        this._confidence.innerHTML = '';
        this._resultArea.classList.add('visible');

        // Try offline first if backend is down
        if (!this.isOnline) {
            try {
                const result = await window.windyAPI.translateOffline(text, this._sourceLang.value, this._targetLang.value);
                if (result && result.translated) {
                    this._showResult({ text, translatedText: result.translated, confidence: result.confidence || 0.7, offline: true });
                    return;
                }
            } catch (e) {
                console.warn('[Translate] Offline fallback failed:', e);
            }
            this._targetText.textContent = '⚠️ Offline — translation queued';
            this.offlineQueue.push({ type: 'text', text, sourceLang: this._sourceLang.value, targetLang: this._targetLang.value });
            return;
        }

        try {
            const token = localStorage.getItem('windy_cloudToken') || '';
            const body = JSON.stringify({ text, sourceLang: this._sourceLang.value, targetLang: this._targetLang.value });
            let resp = await fetch('https://windypro.thewindstorm.uk/api/v1/translate/text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body
            });

            // Retry without token on auth failure
            if (resp.status === 401 || resp.status === 403) {
                console.warn('[Translate] Auth failed, retrying without token');
                localStorage.removeItem('windy_cloudToken');
                resp = await fetch('https://windypro.thewindstorm.uk/api/v1/translate/text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
            }

            if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
            const data = await resp.json();
            this._showResult(data);
        } catch (err) {
            console.error('[Translate] Text translation failed:', err);
            // Clear and helpful message
            this._sourceText.textContent = text;
            this._targetText.textContent = '';
            this._confidence.innerHTML = `
                <span class="confidence-badge" style="background:#3B82F620;color:#60A5FA;border:1px solid #3B82F640;font-size:12px;padding:8px 12px;line-height:1.4;display:block;">
                    💡 <strong>Text-to-text translation</strong> requires a cloud connection.<br>
                    For local translation, use the <strong>🎤 mic button</strong> above — speak in any language and Whisper will translate to English locally, no internet needed!
                </span>
            `;
        }
    }

    // ─── Display Result ───────────────────────────────────────────

    _showResult(data) {
        this._sourceText.textContent = data.text || data.sourceText || '';
        this._targetText.textContent = data.translatedText || '';
        this._resultArea.classList.add('visible');

        // Track translation ID for favorites
        this._lastTranslationId = data.id || null;

        // Confidence badge
        const conf = data.confidence || 0;
        if (conf > 0) {
            const pct = Math.round(conf * 100);
            let color = '#22C55E'; // green
            if (conf < 0.7) color = '#EF4444'; // red
            else if (conf < 0.9) color = '#EAB308'; // yellow

            this._confidence.innerHTML = `
        <span class="confidence-badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">
          ${pct}% confidence${data.offline ? ' · Offline' : ''}
        </span>
      `;
        }

        // Audio playback — support base64 audio data from API or direct URL
        if (data.audioData) {
            const audioBytes = atob(data.audioData);
            const arr = new Uint8Array(audioBytes.length);
            for (let i = 0; i < audioBytes.length; i++) arr[i] = audioBytes.charCodeAt(i);
            const blob = new Blob([arr], { type: 'audio/mp3' });
            this._audioEl.src = URL.createObjectURL(blob);
            this._audioEl.play().catch(() => { });
        } else if (data.audioUrl) {
            this._audioEl.src = data.audioUrl;
        }

        // Prepend to history view
        this._addHistoryItem(data);
    }

    // ─── Favorites ────────────────────────────────────────────────

    async _saveFavorite() {
        const btn = document.getElementById('translateFavBtn');
        const translationId = this._lastTranslationId;
        if (!translationId) { btn.textContent = '⚠️'; setTimeout(() => { btn.textContent = '⭐'; }, 1000); return; }

        try {
            const token = localStorage.getItem('windy_cloudToken') || '';
            await fetch('https://windypro.thewindstorm.uk/api/v1/user/favorites', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ translationId })
            });
            btn.textContent = '⭐✓';
            setTimeout(() => { btn.textContent = '⭐'; }, 1500);
        } catch (err) {
            console.warn('[Translate] Save favorite failed:', err);
            btn.textContent = '⚠️';
            setTimeout(() => { btn.textContent = '⭐'; }, 1000);
        }
    }

    // ─── History ──────────────────────────────────────────────────

    async _loadHistory() {
        try {
            const token = localStorage.getItem('windy_cloudToken') || '';
            const resp = await fetch('https://windypro.thewindstorm.uk/api/v1/user/history?limit=10', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (!resp.ok) return;
            const data = await resp.json();
            this.history = data.translations || [];
            this._renderHistory();
        } catch (err) {
            console.warn('[Translate] History load failed:', err.message);
        }
    }

    _addHistoryItem(data) {
        this._lastTranslationId = data.id || null;
        this.history.unshift({
            source_text: data.text || data.sourceText,
            translated_text: data.translatedText,
            source_lang: this._sourceLang.value,
            target_lang: this._targetLang.value,
            confidence: data.confidence,
            created_at: new Date().toISOString()
        });
        if (this.history.length > 20) this.history.pop();
        this._renderHistory();
    }

    _renderHistory() {
        this._historyEl.innerHTML = '';
        for (const item of this.history.slice(0, 8)) {
            const div = document.createElement('div');
            div.className = 'translate-history-item';
            const srcPreview = (item.source_text || '').substring(0, 40);
            const tgtPreview = (item.translated_text || '').substring(0, 40);
            div.innerHTML = `
        <div class="th-source">${this._escapeHtml(srcPreview)}${srcPreview.length < (item.source_text || '').length ? '…' : ''}</div>
        <div class="th-target">${this._escapeHtml(tgtPreview)}${tgtPreview.length < (item.translated_text || '').length ? '…' : ''}</div>
      `;
            div.addEventListener('click', () => {
                this._sourceText.textContent = item.source_text || '';
                this._targetText.textContent = item.translated_text || '';
                this._resultArea.classList.add('visible');
            });
            this._historyEl.appendChild(div);
        }
    }

    _escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ─── Health Check / Online Status ─────────────────────────────

    _startHealthCheck() {
        this._checkHealth();
        this._healthInterval = setInterval(() => this._checkHealth(), 30000);
    }

    async _checkHealth() {
        try {
            const resp = await fetch('https://windypro.thewindstorm.uk/health', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
            this._setOnline(resp.ok);
        } catch {
            this._setOnline(false);
        }
    }

    _setOnline(online) {
        const wasOffline = !this.isOnline;
        this.isOnline = online;
        this._offlineBadge.style.display = online ? 'none' : 'inline-block';

        // Flush queue when coming back online
        if (online && wasOffline && this.offlineQueue.length > 0) {
            this._flushOfflineQueue();
        }
    }

    async _flushOfflineQueue() {
        console.log(`[Translate] Flushing ${this.offlineQueue.length} queued translations`);
        const queue = [...this.offlineQueue];
        this.offlineQueue = [];
        for (const item of queue) {
            try {
                if (item.type === 'text') {
                    const token = localStorage.getItem('windy_cloudToken') || '';
                    await fetch('https://windypro.thewindstorm.uk/api/v1/translate/text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                        body: JSON.stringify({ text: item.text, sourceLang: item.sourceLang, targetLang: item.targetLang })
                    });
                }
                // Speech blobs can't be easily re-sent after page lifecycle, skip them
            } catch (err) {
                console.warn('[Translate] Queue flush failed for item:', err.message);
            }
        }
    }
}
