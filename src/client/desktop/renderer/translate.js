/**
 * Windy Word — Real-time Speech Translation Panel
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
        this._log = createLogger('TranslatePanel');
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
        // Health check starts on open(), not on construction (avoids CSP spam when panel is closed)
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
            placeholder="Or type text to translate…" rows="2" maxlength="10000"></textarea>
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
            } else {
                // Can't swap into an auto target (target has no auto option) — hint the user
                const hint = document.getElementById('translateSpeechHint');
                if (hint) {
                    const prev = hint.innerHTML;
                    hint.innerHTML = '↔️ Pick a source language to swap';
                    setTimeout(() => { hint.innerHTML = prev; }, 2000);
                }
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

        // Play audio (Web Speech API TTS)
        document.getElementById('translatePlayBtn').addEventListener('click', () => {
            this._speakLastTranslation();
        });
    }

    // ─── Open / Close ─────────────────────────────────────────────

    open() {
        this._panel.classList.add('open');
        this.isOpen = true;
        this._loadLanguages();
        this._loadHistory();
        this._renderFavorites();
        // Start health check only when panel is open
        if (!this._healthInterval) this._startHealthCheck();
    }

    close() {
        this._panel.classList.remove('open');
        this.isOpen = false;
        if (this.isRecording) this._stopSpeechCapture();
        // P2-4: Clear health check interval when panel is closed
        if (this._healthInterval) {
            clearInterval(this._healthInterval);
            this._healthInterval = null;
        }
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    // ─── Language Loading ─────────────────────────────────────────

    async _loadLanguages() {
        if (this.languages.length > 0) return;
        // Don't attempt a network fetch when offline — use the bundled fallback directly
        if (!navigator.onLine) {
            this._log.debug('_loadLanguages', 'offline — using fallback language list');
            this._useFallbackLanguages();
            return;
        }
        try {
            const resp = await fetch(window.API_CONFIG.languages);
            if (!resp.ok) throw new Error('Failed to load languages');
            const data = await resp.json();
            this.languages = data.languages || [];
            this._populateDropdowns();
        } catch (err) {
            this._log.warn('_loadLanguages', `could not load languages: ${err.message}`);
            this._useFallbackLanguages();
        }
    }

    _useFallbackLanguages() {
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
            this._log.error('_startSpeechCapture', err);
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
            this._log.warn('_translateSpeech', `Whisper unavailable: ${localErr.message}`);
            this._sourceText.textContent = '⚠️ Translation unavailable';
            this._targetText.textContent = 'Start the Windy Word engine to enable speech translation.';
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
            const result = await window.windyAPI.translateLocal(englishText, 'en', targetLang);

            if (result?.ok && result.translatedText) {
                this._showResult({
                    sourceText: `🎙️ Heard (English): "${englishText}"`,
                    translatedText: result.translatedText,
                    confidence: result.confidence || 0.9,
                    engine: result.engine || 'ai'
                });
                const engineLabel = result.engine === 'groq' ? 'Groq AI' : result.engine === 'openai' ? 'OpenAI' : 'AI';
                this._confidence.innerHTML += `
                    <span class="confidence-badge" style="background:#3B82F620;color:#3B82F6;border:1px solid #3B82F640;margin-left:6px;">
                        🏠 Speech by Whisper · 🌐 Text by ${engineLabel}
                    </span>
                `;
                return;
            } else {
                throw new Error(result?.error || 'Translation returned no result');
            }
        } catch (textErr) {
            this._log.warn('_translateSpeech', `text translation failed: ${textErr.message}`);
            var textErrMessage = textErr.message;
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
                ⚠️ On-device translation engine unavailable — try restarting the app. ${this._escapeHtml(textErrMessage || '')}
            </span>
        `;

        // L5 TRIGGER 1: Check if a local pair engine could help
        this._showPairUpsellIfNeeded('en', targetLang);
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

        // Validate text length
        if (typeof Validators !== 'undefined') {
            const tv = Validators.translateText(text);
            if (!tv.valid) {
                this._targetText.textContent = '⚠️ ' + tv.error;
                this._resultArea.classList.add('visible');
                return;
            }
        }

        this._sourceText.textContent = text;
        this._targetText.textContent = 'Translating…';
        this._confidence.innerHTML = '';
        this._resultArea.classList.add('visible');

        // ── On-device NLLB translation — works online OR offline, no API key ──
        try {
            const result = await window.windyAPI.translateLocal(text, this._sourceLang.value, this._targetLang.value);
            if (result?.ok && result.translatedText) {
                this._showResult({
                    text,
                    translatedText: result.translatedText,
                    confidence: 0.9,
                    engine: result.engine || 'nllb-local'
                });
                this._confidence.innerHTML = `
                    <span class="confidence-badge" style="background:#3B82F620;color:#3B82F6;border:1px solid #3B82F640;">
                        🏠 Translated on-device by NLLB
                    </span>
                `;
                // Auto-detect honesty: typed text has no language detection. When the
                // source is 'auto', the local engine assumes English — say so plainly
                // rather than silently mislabeling the source language.
                if (this._sourceLang.value === 'auto') {
                    this._confidence.innerHTML += `
                    <span class="confidence-badge" style="background:#EAB30820;color:#EAB308;border:1px solid #EAB30840;margin-left:6px;">
                        ℹ️ assumed English source (typed text isn't auto-detected)
                    </span>
                `;
                }
                return;
            } else {
                throw new Error(result?.error || 'Translation failed');
            }
        } catch (err) {
            this._log.error('_translateText', err);
            this._sourceText.textContent = text;
            this._targetText.textContent = '';
            this._confidence.innerHTML = `
                <span class="confidence-badge" style="background:#EAB30820;color:#EAB308;border:1px solid #EAB30840;font-size:12px;padding:8px 12px;line-height:1.4;display:block;">
                    ⚠️ <strong>On-device translation engine unavailable</strong> — try restarting the app.<br>
                    ${this._escapeHtml(err.message || 'Translation failed')}
                </span>
            `;

            // L5 TRIGGER 1: Check if a local pair engine could help
            this._showPairUpsellIfNeeded(this._sourceLang.value, this._targetLang.value);
        }
    }

    // ─── Display Result ───────────────────────────────────────────

    _showResult(data) {
        this._sourceText.textContent = data.text || data.sourceText || '';
        this._targetText.textContent = data.translatedText || '';
        this._resultArea.classList.add('visible');

        // Track translation for favorites and TTS playback
        this._lastTranslationId = data.id || null;
        this._lastTranslatedText = data.translatedText || '';
        this._lastTargetLang = this._targetLang.value;

        // Language label above translation
        const langName = this._getLanguageName(this._lastTargetLang);
        const langFlag = this._getLanguageFlag(this._lastTargetLang);
        this._targetText.innerHTML = `
            <div style="font-size:11px;color:#9CA3AF;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                <span>${langFlag} ${langName}</span>
                <button onclick="window._translatePanel._speakLastTranslation()" style="background:none;border:none;cursor:pointer;font-size:16px;padding:0;" title="Listen in ${langName}">🔊</button>
            </div>
            <div>${data.translatedText || ''}</div>
        `;

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

        // Reflect whether this result is already a saved favorite.
        const favBtn = document.getElementById('translateFavBtn');
        if (favBtn) {
            const srcText = (this._sourceText.textContent || '').trim();
            const tgtText = (this._lastTranslatedText || '').trim();
            if (this._isFavorited(srcText, tgtText)) {
                favBtn.classList.add('favorited');
                favBtn.textContent = '⭐';
            } else {
                favBtn.classList.remove('favorited');
                favBtn.textContent = '⭐';
            }
        }

        // Prepend to history view
        this._addHistoryItem(data);
    }

    // ─── Text-to-Speech (Web Speech API) ──────────────────────────

    _speakLastTranslation() {
        if (!this._lastTranslatedText) return;
        this._speakText(this._lastTranslatedText, this._lastTargetLang);
    }

    _speakText(text, langCode) {
        // Stop any current speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);

        // Map language codes to BCP 47 tags for better voice matching
        const langMap = {
            en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
            pt: 'pt-BR', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA',
            ru: 'ru-RU', pl: 'pl-PL', nl: 'nl-NL', sv: 'sv-SE', hi: 'hi-IN'
        };
        utterance.lang = langMap[langCode] || langCode;
        utterance.rate = 0.9; // Slightly slower for clarity
        utterance.pitch = 1;

        // Try to find a voice for this language
        const voices = window.speechSynthesis.getVoices();
        const matchingVoice = voices.find(v => v.lang.startsWith(langCode)) ||
            voices.find(v => v.lang.startsWith(utterance.lang));
        if (matchingVoice) utterance.voice = matchingVoice;

        // Visual feedback on play button
        const playBtn = document.getElementById('translatePlayBtn');
        if (playBtn) {
            playBtn.textContent = '⏹️';
            utterance.onend = () => { playBtn.textContent = '🔊'; };
            utterance.onerror = () => { playBtn.textContent = '🔊'; };
        }

        window.speechSynthesis.speak(utterance);
    }

    /** Get flag emoji for a language code */
    _getLanguageFlag(code) {
        const flags = {
            en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹',
            pt: '🇧🇷', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷', ar: '🇸🇦',
            ru: '🇷🇺', pl: '🇵🇱', nl: '🇳🇱', sv: '🇸🇪', hi: '🇮🇳'
        };
        return flags[code] || '🌐';
    }

    // ─── Favorites ────────────────────────────────────────────────

    // Favorites are stored entirely locally (offline-first, no cloud). Each entry:
    // { source, target, sourceText, translatedText, ts }. Capped at FAV_MAX.
    static get FAV_MAX() { return 50; }

    _loadFavorites() {
        try {
            const stored = localStorage.getItem('windy_translateFavorites');
            return stored ? (JSON.parse(stored) || []) : [];
        } catch (e) {
            this._log.warn('_loadFavorites', `restore failed: ${e.message}`);
            return [];
        }
    }

    _persistFavorites(favs) {
        try {
            localStorage.setItem('windy_translateFavorites', JSON.stringify(favs.slice(0, TranslatePanel.FAV_MAX)));
        } catch (e) {
            this._log.warn('_persistFavorites', `persist failed: ${e.message}`);
        }
    }

    /** Is the currently-shown translation already a saved favorite? */
    _isFavorited(sourceText, translatedText) {
        return this._loadFavorites().some(f =>
            f.sourceText === sourceText && f.translatedText === translatedText);
    }

    _saveFavorite() {
        const btn = document.getElementById('translateFavBtn');
        // Capture from the live result panel — not a non-existent _lastTranslatedText.
        const sourceText = (this._sourceText.textContent || '').trim();
        const translatedText = (this._lastTranslatedText || this._targetText.textContent || '').trim();
        if (!translatedText) {
            btn.textContent = '⚠️';
            setTimeout(() => { btn.textContent = '⭐'; }, 1000);
            return;
        }

        const source = this._sourceLang.value;
        const target = this._lastTargetLang || this._targetLang.value;
        let favs = this._loadFavorites();

        const idx = favs.findIndex(f =>
            f.sourceText === sourceText && f.translatedText === translatedText);
        if (idx >= 0) {
            // Toggle off — un-favorite.
            favs.splice(idx, 1);
            this._persistFavorites(favs);
            btn.textContent = '⭐';
            btn.classList.remove('favorited');
        } else {
            favs.unshift({ source, target, sourceText, translatedText, ts: Date.now() });
            this._persistFavorites(favs);
            btn.textContent = '⭐✓';
            btn.classList.add('favorited');
            setTimeout(() => { btn.textContent = '⭐'; }, 1500);
        }
        this._renderFavorites();
    }

    /** Render saved favorites at the top of the RECENT area, reusing history styling. */
    _renderFavorites() {
        if (!this._historyEl) return;
        // Clear any prior favorites block, then re-render history fresh below it.
        const favs = this._loadFavorites();
        // Re-render history first (clears the container), then prepend favorites.
        this._renderHistory();
        if (favs.length === 0) return;

        const wrap = document.createElement('div');
        wrap.id = 'translateFavorites';
        const header = document.createElement('div');
        header.className = 'translate-history-subheader';
        header.style.cssText = 'font-size:11px;color:#9CA3AF;margin:4px 0;display:flex;justify-content:space-between;align-items:center;';
        header.innerHTML = '<span>⭐ Favorites</span>';
        wrap.appendChild(header);

        for (const item of favs.slice(0, 8)) {
            const div = document.createElement('div');
            div.className = 'translate-history-item favorite';
            const srcPreview = (item.sourceText || '').substring(0, 40);
            const tgtPreview = (item.translatedText || '').substring(0, 40);
            div.innerHTML = `
        <div class="th-source">${this._escapeHtml(srcPreview)}${srcPreview.length < (item.sourceText || '').length ? '…' : ''}</div>
        <div class="th-target">${this._escapeHtml(tgtPreview)}${tgtPreview.length < (item.translatedText || '').length ? '…' : ''}</div>
      `;
            div.addEventListener('click', () => {
                this._sourceText.textContent = item.sourceText || '';
                this._targetText.textContent = item.translatedText || '';
                this._resultArea.classList.add('visible');
            });
            wrap.appendChild(div);
        }
        // Insert favorites block above the history items.
        this._historyEl.insertBefore(wrap, this._historyEl.firstChild);
    }

    // ─── History ──────────────────────────────────────────────────

    async _loadHistory() {
        // Seed from persisted local history so RECENT survives app restart
        if (this.history.length === 0) {
            try {
                const stored = localStorage.getItem('windy_translateHistory');
                if (stored) this.history = JSON.parse(stored) || [];
            } catch (e) {
                this._log.warn('_loadHistory', `restore failed: ${e.message}`);
            }
        }

        // Don't attempt network fetch when offline — show cached history
        if (!navigator.onLine) {
            this._log.debug('_loadHistory', 'offline — using cached history');
            this._renderHistory();
            return;
        }
        try {
            const token = localStorage.getItem('windy_cloudToken') || '';
            const resp = await fetch(`${window.API_CONFIG.userHistory}?limit=10`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (!resp.ok) return;
            const data = await resp.json();
            this.history = data.translations || [];
            this._renderHistory();
        } catch (err) {
            this._log.warn('_loadHistory', `load failed: ${err.message}`);
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
        try {
            localStorage.setItem('windy_translateHistory', JSON.stringify(this.history.slice(0, 20)));
        } catch (e) {
            this._log.warn('_addHistoryItem', `persist failed: ${e.message}`);
        }
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
            const resp = await fetch(window.API_CONFIG.health, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
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
        this._log.entry('_flushOfflineQueue', { count: this.offlineQueue.length });
        const queue = [...this.offlineQueue];
        this.offlineQueue = [];
        for (const item of queue) {
            try {
                if (item.type === 'text') {
                    const token = localStorage.getItem('windy_cloudToken') || '';
                    await fetch(window.API_CONFIG.translateText, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                        body: JSON.stringify({ text: item.text, sourceLang: item.sourceLang, targetLang: item.targetLang })
                    });
                }
                // Speech blobs can't be easily re-sent after page lifecycle, skip them
            } catch (err) {
                this._log.warn('_flushOfflineQueue', `item failed: ${err.message}`);
            }
        }
    }

    // ─── L5 TRIGGER 1: Pair-Not-Found Upsell ─────────────────────

    /**
     * Check if a local translation pair exists for the given language pair.
     * If not, show an inline purchase card below the translation result.
     */
    async _showPairUpsellIfNeeded(srcLang, tgtLang) {
        if (!srcLang || !tgtLang || srcLang === 'auto') return;

        // Remove any existing upsell card
        const existing = document.getElementById('translateUpsellCard');
        if (existing) existing.remove();

        try {
            const api = window.windyAPI || {};
            const [downloaded, catalogData] = await Promise.all([
                api.pairListDownloaded?.() || [],
                api.pairCatalog?.() || {}
            ]);

            // Normalize pair IDs to check: en-es, es-en
            const pairId1 = `${srcLang}-${tgtLang}`;
            const pairId2 = `${tgtLang}-${srcLang}`;
            const hasLocal = downloaded.includes(pairId1) || downloaded.includes(pairId2);

            if (hasLocal) return; // Already downloaded

            // Find matching pair in catalog
            const pairs = catalogData.pairs || {};
            const catalogEntry = pairs[pairId1] || pairs[pairId2];
            if (!catalogEntry) return; // Not available in catalog

            const srcFlag = this._getLanguageFlag(srcLang);
            const tgtFlag = this._getLanguageFlag(tgtLang);
            const srcName = this._getLanguageName(srcLang);
            const tgtName = this._getLanguageName(tgtLang);
            const sizeMB = catalogEntry.sizeMB || '???';
            const quality = catalogEntry.quality === 'production' ? '⭐⭐⭐ Good' : '⭐⭐ Functional';

            const card = document.createElement('div');
            card.className = 'upsell-card';
            card.id = 'translateUpsellCard';
            card.innerHTML = `
                <button class="upsell-card-dismiss" title="Dismiss">×</button>
                <div class="upsell-card-title">${tgtFlag} ${srcName.toUpperCase()}↔${tgtName} engine needed</div>
                <div class="upsell-card-desc">
                    Download once, translate offline forever · ${quality} · ${sizeMB} MB
                </div>
                <div class="upsell-card-actions">
                    <button class="upsell-card-btn primary" id="upsellDownloadBtn">Download for $6.99</button>
                    <button class="upsell-card-btn secondary" id="upsellCloudBtn">Use Cloud Instead</button>
                </div>
            `;

            this._resultArea.appendChild(card);

            // Dismiss
            card.querySelector('.upsell-card-dismiss').addEventListener('click', () => card.remove());

            // Download action
            card.querySelector('#upsellDownloadBtn').addEventListener('click', async () => {
                card.querySelector('#upsellDownloadBtn').textContent = '⏳ Downloading…';
                card.querySelector('#upsellDownloadBtn').disabled = true;
                try {
                    const pairId = catalogEntry.id || pairId1;
                    const result = await api.pairDownload(pairId);
                    if (result?.success) {
                        card.innerHTML = '<div class="upsell-card-title">✅ Engine downloaded! Retry your translation.</div>';
                        setTimeout(() => card.remove(), 3000);
                    } else {
                        card.querySelector('#upsellDownloadBtn').textContent = 'Download for $6.99';
                        card.querySelector('#upsellDownloadBtn').disabled = false;
                    }
                } catch (_) {
                    card.querySelector('#upsellDownloadBtn').textContent = 'Download for $6.99';
                    card.querySelector('#upsellDownloadBtn').disabled = false;
                }
            });

            // Cloud fallback — just dismiss
            card.querySelector('#upsellCloudBtn').addEventListener('click', () => card.remove());
        } catch (err) {
            // Non-fatal — upsell is optional
            this._log.debug('_showPairUpsellIfNeeded', `upsell check failed: ${err.message}`);
        }
    }
}

