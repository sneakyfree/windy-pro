/**
 * Windy Pro — Voice Clone Management
 * Feature 7: Record samples, upload, list clones, preview, delete, select active
 */

class VoiceCloneManager {
    constructor() {
        this._log = createLogger('VoiceCloneManager');
        this.clones = [];
        this.activeCloneId = null;
        this.recorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.recordingDuration = 0;
        this.recordTimer = null;
    }

    async render(container) {
        // Load existing clones
        try {
            const result = await window.windyAPI.getVoiceClones();
            this.clones = result?.clones || [];
            this.activeCloneId = result?.activeId || null;
        } catch { /* no clones API */ }

        container.innerHTML = `
      <div class="vc-manager">
        <div class="vc-header">
          <h2>🎭 Voice Clone Manager</h2>
          <p class="vc-subtitle">Create AI voice clones for natural-sounding translations</p>
          <button class="conv-close-btn" id="vc-close">✕</button>
        </div>

        <!-- Record New Clone -->
        <div class="vc-section">
          <h3>Record New Voice Sample</h3>
          <p class="vc-hint">Record 30–60 seconds of clear speech for best results</p>
          <input type="text" id="vc-name" class="vc-input" placeholder="Clone name (e.g. My Voice)" maxlength="64" />
          <div class="vc-record-area">
            <button class="vc-record-btn" id="vc-record-btn">
              <span id="vc-record-icon">🎤</span>
              <span id="vc-record-label">Start Recording</span>
            </button>
            <div class="vc-timer" id="vc-timer">0:00</div>
            <div class="vc-waveform" id="vc-waveform"></div>
          </div>
          <div class="vc-upload-alt">
            <button class="doc-action-btn" id="vc-upload-file">📁 Upload Audio File</button>
          </div>
        </div>

        <!-- Clone List -->
        <div class="vc-section">
          <h3>Your Voice Clones (${this.clones.length})</h3>
          <div class="vc-clone-list" id="vc-clone-list">
            ${this.clones.length === 0 ? '<p class="vc-empty">No voice clones yet. Record a sample above to get started!</p>' :
                this.clones.map(clone => `
                <div class="vc-clone-card ${clone.id === this.activeCloneId ? 'vc-active' : ''}" data-id="${clone.id}">
                  <div class="vc-clone-info">
                    <span class="vc-clone-name">${clone.name || 'Unnamed Clone'}</span>
                    <span class="vc-clone-meta">${clone.duration || '?'}s sample · Created ${window.WindyDateUtils ? WindyDateUtils.formatDateOnly(new Date(clone.created_at || Date.now())) : new Date(clone.created_at || Date.now()).toLocaleDateString()}</span>
                    <span class="vc-clone-status">${clone.status === 'ready' ? '✅ Ready' : clone.status === 'processing' ? '⏳ Processing' : '❌ ' + (clone.status || 'Unknown')}</span>
                  </div>
                  <div class="vc-clone-actions">
                    <button class="vc-action-btn vc-preview" data-id="${clone.id}" title="Preview">▶️</button>
                    <button class="vc-action-btn vc-activate" data-id="${clone.id}" title="${clone.id === this.activeCloneId ? 'Active' : 'Set Active'}">
                      ${clone.id === this.activeCloneId ? '⭐' : '☆'}
                    </button>
                    <button class="vc-action-btn vc-delete" data-id="${clone.id}" title="Delete">🗑️</button>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>

        <!-- Settings -->
        <div class="vc-section">
          <h3>TTS Settings</h3>
          <div class="vc-settings-row">
            <label>Speed</label>
            <input type="range" id="vc-speed" min="0.5" max="2.0" step="0.1" value="1.0" />
            <span id="vc-speed-val">1.0x</span>
          </div>
          <div class="vc-settings-row">
            <label>Pitch</label>
            <input type="range" id="vc-pitch" min="0.5" max="2.0" step="0.1" value="1.0" />
            <span id="vc-pitch-val">1.0x</span>
          </div>
        </div>
      </div>
    `;

        this.bindEvents(container);
    }

    bindEvents(container) {
        // Close
        document.getElementById('vc-close').addEventListener('click', () => container.innerHTML = '');

        // Record toggle
        document.getElementById('vc-record-btn').addEventListener('click', () => {
            this.isRecording ? this.stopRecording() : this.startRecording();
        });

        // Upload file
        document.getElementById('vc-upload-file').addEventListener('click', async () => {
            const name = document.getElementById('vc-name').value.trim() || 'Voice Clone';
            // Validate clone name
            if (typeof Validators !== 'undefined') {
                const nv = Validators.cloneName(name);
                if (!nv.valid) { alert(nv.error); return; }
            }
            try {
                const result = await window.windyAPI.uploadVoiceCloneFile(name);
                if (result?.success) {
                    this.clones.push(result.clone);
                    this.render(container);
                }
            } catch (err) { this._log.error('uploadFile', err); }
        });

        // Preview / Activate / Delete
        container.querySelectorAll('.vc-preview').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await window.windyAPI.previewVoiceClone(btn.dataset.id);
                } catch { /* preview failed */ }
            });
        });

        container.querySelectorAll('.vc-activate').forEach(btn => {
            btn.addEventListener('click', async () => {
                this.activeCloneId = btn.dataset.id;
                try {
                    await window.windyAPI.setActiveVoiceClone(btn.dataset.id);
                } catch { /* activate failed */ }
                this.render(container);
            });
        });

        container.querySelectorAll('.vc-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this voice clone? This cannot be undone.')) return;
                try {
                    await window.windyAPI.deleteVoiceClone(btn.dataset.id);
                    this.clones = this.clones.filter(c => c.id !== btn.dataset.id);
                } catch { /* delete failed */ }
                this.render(container);
            });
        });

        // Speed / Pitch sliders
        document.getElementById('vc-speed').addEventListener('input', e => {
            document.getElementById('vc-speed-val').textContent = `${e.target.value}x`;
        });
        document.getElementById('vc-pitch').addEventListener('input', e => {
            document.getElementById('vc-pitch-val').textContent = `${e.target.value}x`;
        });
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 44100, channelCount: 1 } });
            this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            this.recordedChunks = [];
            this.recordingDuration = 0;

            this.recorder.ondataavailable = e => { if (e.data.size > 0) this.recordedChunks.push(e.data); };
            this.recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                this.processRecording();
            };

            this.recorder.start(500);
            this.isRecording = true;

            document.getElementById('vc-record-icon').textContent = '⏹️';
            document.getElementById('vc-record-label').textContent = 'Stop Recording';
            document.getElementById('vc-record-btn').classList.add('recording');

            this.recordTimer = setInterval(() => {
                this.recordingDuration++;
                const min = Math.floor(this.recordingDuration / 60);
                const sec = this.recordingDuration % 60;
                document.getElementById('vc-timer').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
            }, 1000);

            // Waveform visualization
            const ctx = new AudioContext();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const waveEl = document.getElementById('vc-waveform');

            const draw = () => {
                if (!this.isRecording) { ctx.close(); waveEl.innerHTML = ''; return; }
                analyser.getByteFrequencyData(data);
                waveEl.innerHTML = Array.from(data).slice(0, 20).map(v =>
                    `<div class="conv-bar" style="height:${Math.max(2, v / 255 * 30)}px;background:#22C55E"></div>`
                ).join('');
                requestAnimationFrame(draw);
            };
            draw();

        } catch (err) {
            this._log.error('startRecording', err);
        }
    }

    stopRecording() {
        if (this.recorder && this.recorder.state !== 'inactive') {
            this.recorder.stop();
        }
        this.isRecording = false;
        clearInterval(this.recordTimer);

        document.getElementById('vc-record-icon').textContent = '🎤';
        document.getElementById('vc-record-label').textContent = 'Start Recording';
        document.getElementById('vc-record-btn').classList.remove('recording');
    }

    async processRecording() {
        const name = document.getElementById('vc-name').value.trim() || `Voice Clone ${this.clones.length + 1}`;
        // Validate clone name
        if (typeof Validators !== 'undefined') {
            const nv = Validators.cloneName(name);
            if (!nv.valid) { alert(nv.error); return; }
        }
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });

        // Convert to base64
        const reader = new FileReader();
        const base64 = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });

        try {
            const result = await window.windyAPI.createVoiceClone(name, base64, this.recordingDuration);
            if (result?.clone) {
                this.clones.push(result.clone);
                // Re-render the clone list
                const container = document.querySelector('.vc-manager')?.parentElement;
                if (container) this.render(container);
            }
        } catch (err) {
            this._log.error('processRecording', err);
        }
    }
}

window.VoiceCloneManager = VoiceCloneManager;
