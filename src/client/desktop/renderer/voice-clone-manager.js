/**
 * Windy Word — Voice Clone Management
 * Feature 7: Record samples, upload, list clones, preview, delete, select active.
 *
 * Word→Clone wire (ADR-045 Phase 2): each clone can be submitted to Windy
 * Clone (api.windyclone.ai) for ElevenLabs training. The cloud_order_id
 * lives on the local clone record; we poll for status every 20s while it
 * is non-terminal so the UI surfaces progress without manual reload.
 */

const CLOUD_STATUS_TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const CLOUD_POLL_INTERVAL_MS = 20_000;

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
        this._cloudPollTimer = null;
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

        <!-- Windy Clone integration -->
        <div class="vc-cloud-info" style="background:rgba(163,230,53,0.08); border:1px solid rgba(163,230,53,0.2); border-radius:12px; padding:16px; margin:16px 0;">
          <p style="color:#A3E635; font-weight:700; margin:0 0 6px 0;">Windy Clone — submit for training</p>
          <p style="color:#9CA3AF; font-size:13px; margin:0;">
            Record at least 30 seconds of clear audio, then click "Submit to Windy Clone"
            on the clone card below. Windy Clone trains a voice model via ElevenLabs and
            surfaces it back here when ready (usually 1–3 minutes).
          </p>
        </div>

        <!-- Clone List -->
        <div class="vc-section">
          <h3>Your Voice Clones (${this.clones.length})</h3>
          <div class="vc-clone-list" id="vc-clone-list">
            ${this.clones.length === 0 ? '<p class="vc-empty">Your voice clones will appear here once you record or upload a sample.</p>' :
                this.clones.map(clone => `
                <div class="vc-clone-card ${clone.id === this.activeCloneId ? 'vc-active' : ''}" data-id="${clone.id}">
                  <div class="vc-clone-info">
                    <span class="vc-clone-name">${clone.name || 'Unnamed Clone'}</span>
                    <span class="vc-clone-meta">${clone.duration || '?'}s sample · Created ${window.WindyDateUtils ? WindyDateUtils.formatDateOnly(new Date(clone.created_at || Date.now())) : new Date(clone.created_at || Date.now()).toLocaleDateString()}</span>
                    <span class="vc-clone-status">${this.renderLocalStatus(clone)}</span>
                    ${this.renderCloudStatus(clone)}
                  </div>
                  <div class="vc-clone-actions">
                    ${!clone.cloud_order_id ? `<button class="vc-action-btn vc-submit-cloud" data-id="${clone.id}" title="Submit to Windy Clone">Submit</button>` : ''}
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
        this.schedulePolling(container);
    }

    renderLocalStatus(clone) {
        if (clone.status === 'ready') return '✅ Local';
        if (clone.status === 'processing') return '⏳ Processing';
        return '❌ ' + (clone.status || 'Unknown');
    }

    renderCloudStatus(clone) {
        if (!clone.cloud_order_id) {
            return '<span class="vc-cloud-badge vc-cloud-not-submitted">Not submitted</span>';
        }
        const status = clone.cloud_status || 'pending';
        const progress = clone.cloud_progress != null ? ` ${clone.cloud_progress}%` : '';
        const label = {
            pending: '⏳ Queued',
            uploading: '⏳ Uploading',
            training: '⏳ Training' + progress,
            completed: '✅ Ready in Windy Clone',
            failed: '❌ Failed',
            cancelled: 'Cancelled',
            awaiting_upstream: '⏳ Awaiting upstream',
        }[status] || `⏳ ${status}`;
        const errMsg = clone.cloud_error_message
            ? `<span class="vc-cloud-error" title="${this._escape(clone.cloud_error_message)}"> · why?</span>`
            : '';
        return `<span class="vc-cloud-badge vc-cloud-${status}">${label}${errMsg}</span>`;
    }

    _escape(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    schedulePolling(container) {
        // Always clear; we may have stopped polling because the last
        // outstanding order finished.
        if (this._cloudPollTimer) {
            clearInterval(this._cloudPollTimer);
            this._cloudPollTimer = null;
        }
        const pending = this.clones.filter(
            c => c.cloud_order_id && !CLOUD_STATUS_TERMINAL.has(c.cloud_status || 'pending')
        );
        if (pending.length === 0) return;

        this._cloudPollTimer = setInterval(async () => {
            let anyChanged = false;
            for (const clone of this.clones) {
                if (!clone.cloud_order_id) continue;
                if (CLOUD_STATUS_TERMINAL.has(clone.cloud_status || 'pending')) continue;
                try {
                    const res = await window.windyAPI.getCloudCloneOrderStatus(clone.cloud_order_id);
                    if (res?.ok && res.status && res.status !== clone.cloud_status) {
                        clone.cloud_status = res.status;
                        clone.cloud_progress = res.progress;
                        clone.cloud_error_message = res.error_message || null;
                        anyChanged = true;
                    }
                } catch (err) {
                    this._log.warn && this._log.warn('poll', err);
                }
            }
            if (anyChanged) this.render(container);
        }, CLOUD_POLL_INTERVAL_MS);
    }

    bindEvents(container) {
        // Close — clear the poll timer too so a closed panel doesn't keep
        // hitting the Clone API in the background.
        document.getElementById('vc-close').addEventListener('click', () => {
            if (this._cloudPollTimer) {
                clearInterval(this._cloudPollTimer);
                this._cloudPollTimer = null;
            }
            container.innerHTML = '';
        });

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

        // Submit-to-cloud (ADR-045 Phase 2)
        container.querySelectorAll('.vc-submit-cloud').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'Submitting…';
                try {
                    const res = await window.windyAPI.submitVoiceCloneToCloud(btn.dataset.id);
                    if (res?.ok) {
                        const clone = this.clones.find(c => c.id === btn.dataset.id);
                        if (clone) {
                            clone.cloud_order_id = res.order_id;
                            clone.cloud_status = res.status || 'pending';
                            clone.cloud_submitted_at = new Date().toISOString();
                        }
                    } else {
                        alert(`Submit failed: ${res?.error || 'unknown error'}`);
                        btn.disabled = false;
                        btn.textContent = 'Submit';
                    }
                } catch (err) {
                    this._log.error('submitCloud', err);
                    alert('Submit failed. See logs.');
                    btn.disabled = false;
                    btn.textContent = 'Submit';
                }
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
