/**
 * Windy Pro — Real-time Conversation Mode
 * Split-pane live interpreter: Language A ↔ Language B
 * Two mic buttons, real-time transcription + translation between panes
 */

class ConversationMode {
    constructor() {
        this.isActive = false;
        this.langA = 'en';
        this.langB = 'es';
        this.transcriptA = [];
        this.transcriptB = [];
        this.recordingA = false;
        this.recordingB = false;
        this.mediaRecorderA = null;
        this.mediaRecorderB = null;
        this.streamA = null;
        this.streamB = null;
        this.container = null;
    }

    // ─── Language Options ────────────────
    static LANGUAGES = [
        { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' }, { code: 'pt', name: 'Portuguese' },
        { code: 'zh', name: 'Chinese' }, { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' }, { code: 'ar', name: 'Arabic' },
        { code: 'ru', name: 'Russian' }, { code: 'hi', name: 'Hindi' },
        { code: 'tr', name: 'Turkish' }, { code: 'nl', name: 'Dutch' },
        { code: 'pl', name: 'Polish' }, { code: 'sv', name: 'Swedish' },
        { code: 'th', name: 'Thai' }, { code: 'vi', name: 'Vietnamese' },
        { code: 'uk', name: 'Ukrainian' }, { code: 'cs', name: 'Czech' },
    ];

    render(container) {
        this.container = container;
        container.innerHTML = `
      <div class="conv-mode" id="conversation-mode">
        <div class="conv-header">
          <h2>🎙️ Conversation Mode</h2>
          <p class="conv-subtitle">Live interpreter — speak alternately in two languages</p>
          <button class="conv-close-btn" id="conv-close">✕</button>
        </div>
        <div class="conv-panes">
          <!-- Left Pane: Language A -->
          <div class="conv-pane conv-pane-a">
            <div class="conv-pane-header">
              <select id="conv-lang-a" class="conv-lang-select">
                ${ConversationMode.LANGUAGES.map(l =>
            `<option value="${l.code}" ${l.code === this.langA ? 'selected' : ''}>${l.name}</option>`
        ).join('')}
              </select>
              <span class="conv-pane-badge" id="conv-badge-a">Speaker A</span>
            </div>
            <div class="conv-transcript" id="conv-transcript-a"></div>
            <div class="conv-controls">
              <button class="conv-mic-btn" id="conv-mic-a" data-side="a">
                <span class="conv-mic-icon">🎤</span>
                <span class="conv-mic-label">Hold to Speak</span>
              </button>
              <div class="conv-waveform" id="conv-wave-a"></div>
            </div>
          </div>

          <!-- Divider with swap button -->
          <div class="conv-divider">
            <button class="conv-swap-btn" id="conv-swap" title="Swap languages">⇄</button>
          </div>

          <!-- Right Pane: Language B -->
          <div class="conv-pane conv-pane-b">
            <div class="conv-pane-header">
              <select id="conv-lang-b" class="conv-lang-select">
                ${ConversationMode.LANGUAGES.map(l =>
            `<option value="${l.code}" ${l.code === this.langB ? 'selected' : ''}>${l.name}</option>`
        ).join('')}
              </select>
              <span class="conv-pane-badge" id="conv-badge-b">Speaker B</span>
            </div>
            <div class="conv-transcript" id="conv-transcript-b"></div>
            <div class="conv-controls">
              <button class="conv-mic-btn" id="conv-mic-b" data-side="b">
                <span class="conv-mic-icon">🎤</span>
                <span class="conv-mic-label">Hold to Speak</span>
              </button>
              <div class="conv-waveform" id="conv-wave-b"></div>
            </div>
          </div>
        </div>
        <div class="conv-footer">
          <button class="conv-export-btn" id="conv-export">📋 Export Transcript</button>
          <button class="conv-clear-btn" id="conv-clear">🗑️ Clear</button>
        </div>
      </div>
    `;

        this.bindEvents();
    }

    bindEvents() {
        // Language selectors
        document.getElementById('conv-lang-a').addEventListener('change', e => { this.langA = e.target.value; });
        document.getElementById('conv-lang-b').addEventListener('change', e => { this.langB = e.target.value; });

        // Swap languages
        document.getElementById('conv-swap').addEventListener('click', () => {
            [this.langA, this.langB] = [this.langB, this.langA];
            document.getElementById('conv-lang-a').value = this.langA;
            document.getElementById('conv-lang-b').value = this.langB;
        });

        // Press-and-hold mic buttons
        ['a', 'b'].forEach(side => {
            const btn = document.getElementById(`conv-mic-${side}`);
            btn.addEventListener('mousedown', () => this.startRecording(side));
            btn.addEventListener('mouseup', () => this.stopRecording(side));
            btn.addEventListener('mouseleave', () => this.stopRecording(side));
            btn.addEventListener('touchstart', e => { e.preventDefault(); this.startRecording(side); });
            btn.addEventListener('touchend', e => { e.preventDefault(); this.stopRecording(side); });
        });

        // Close
        document.getElementById('conv-close').addEventListener('click', () => this.close());

        // Export
        document.getElementById('conv-export').addEventListener('click', () => this.exportTranscript());

        // Clear
        document.getElementById('conv-clear').addEventListener('click', () => {
            this.transcriptA = [];
            this.transcriptB = [];
            document.getElementById('conv-transcript-a').innerHTML = '';
            document.getElementById('conv-transcript-b').innerHTML = '';
        });
    }

    async startRecording(side) {
        if ((side === 'a' && this.recordingA) || (side === 'b' && this.recordingB)) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            const chunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: 'audio/webm' });
                await this.processAudio(side, blob);
            };

            mediaRecorder.start(250);
            if (side === 'a') { this.mediaRecorderA = mediaRecorder; this.streamA = stream; this.recordingA = true; }
            else { this.mediaRecorderB = mediaRecorder; this.streamB = stream; this.recordingB = true; }

            const btn = document.getElementById(`conv-mic-${side}`);
            btn.classList.add('recording');
            btn.querySelector('.conv-mic-label').textContent = 'Recording...';

            this.startWaveform(side, stream);
        } catch (err) {
            console.error('[ConvMode] Mic error:', err);
        }
    }

    stopRecording(side) {
        const rec = side === 'a' ? this.mediaRecorderA : this.mediaRecorderB;
        if (!rec || rec.state === 'inactive') return;
        rec.stop();
        if (side === 'a') { this.recordingA = false; this.mediaRecorderA = null; }
        else { this.recordingB = false; this.mediaRecorderB = null; }

        const btn = document.getElementById(`conv-mic-${side}`);
        btn.classList.remove('recording');
        btn.querySelector('.conv-mic-label').textContent = 'Hold to Speak';
        this.stopWaveform(side);
    }

    async processAudio(side, blob) {
        const sourceLang = side === 'a' ? this.langA : this.langB;
        const targetLang = side === 'a' ? this.langB : this.langA;

        // Convert blob to base64
        const reader = new FileReader();
        const base64 = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });

        // Add "transcribing" indicator
        const transcriptEl = document.getElementById(`conv-transcript-${side}`);
        const otherTranscriptEl = document.getElementById(`conv-transcript-${side === 'a' ? 'b' : 'a'}`);
        const pendingEl = document.createElement('div');
        pendingEl.className = 'conv-entry conv-pending';
        pendingEl.textContent = '⏳ Transcribing...';
        transcriptEl.appendChild(pendingEl);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;

        try {
            // Transcribe locally
            const result = await window.windyAPI.batchTranscribeLocal(base64);
            const text = result?.text || result?.transcript || '';

            if (!text.trim()) {
                pendingEl.remove();
                return;
            }

            // Show original text
            pendingEl.className = 'conv-entry conv-original';
            pendingEl.textContent = text;
            const timestamp = window.WindyDateUtils ? WindyDateUtils.formatTime(new Date()) : new Date().toLocaleTimeString();
            (side === 'a' ? this.transcriptA : this.transcriptB).push({ text, lang: sourceLang, time: timestamp });

            // Translate to other language
            const translated = await window.windyAPI.translateOffline(text, sourceLang, targetLang);
            const translatedText = translated?.text || translated || text;

            // Show translation in the other pane
            const transEl = document.createElement('div');
            transEl.className = 'conv-entry conv-translated';
            const _esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            transEl.innerHTML = `<span class="conv-trans-badge">🌍 ${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}</span> ${_esc(translatedText)}`;
            otherTranscriptEl.appendChild(transEl);
            otherTranscriptEl.scrollTop = otherTranscriptEl.scrollHeight;

            // Store in translation memory
            if (window.windyAPI.saveTranslationMemory) {
                window.windyAPI.saveTranslationMemory({ source: text, target: translatedText, sourceLang, targetLang });
            }
        } catch (err) {
            pendingEl.textContent = '❌ ' + (err.message || 'Transcription failed');
            pendingEl.className = 'conv-entry conv-error';
        }
    }

    startWaveform(side, stream) {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);

        const waveEl = document.getElementById(`conv-wave-${side}`);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
            if (!(side === 'a' ? this.recordingA : this.recordingB)) { ctx.close(); return; }
            analyser.getByteFrequencyData(data);
            const bars = Array.from(data).slice(0, 16).map(v =>
                `<div class="conv-bar" style="height:${Math.max(3, v / 255 * 40)}px"></div>`
            ).join('');
            waveEl.innerHTML = bars;
            requestAnimationFrame(draw);
        };
        draw();
    }

    stopWaveform(side) {
        const waveEl = document.getElementById(`conv-wave-${side}`);
        if (waveEl) waveEl.innerHTML = '';
    }

    exportTranscript() {
        const lines = [];
        const allEntries = [
            ...this.transcriptA.map(e => ({ ...e, speaker: 'A' })),
            ...this.transcriptB.map(e => ({ ...e, speaker: 'B' })),
        ];
        allEntries.forEach(e => {
            lines.push(`[${e.time}] Speaker ${e.speaker} (${e.lang.toUpperCase()}): ${e.text}`);
        });
        const content = lines.join('\n') || 'No conversation recorded.';
        if (window.windyAPI?.saveFile) {
            window.windyAPI.saveFile({ content, defaultName: `conversation-${Date.now()}.txt` });
        }
    }

    close() {
        this.stopRecording('a');
        this.stopRecording('b');
        if (this.container) this.container.innerHTML = '';
        this.isActive = false;
    }
}

// Export for use in app.js
window.ConversationMode = ConversationMode;
