/**
 * Windy Pro — Video Recording with Webcam
 * Camera selection, live preview, simultaneous audio+video recording,
 * Clone training bundle output, synced subtitle playback
 */

class VideoRecordingManager {
    constructor() {
        this.videoStream = null;
        this.audioStream = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.duration = 0;
        this.timer = null;
        this.selectedCamera = 'none';
        this.selectedMic = '';
        this.videoQuality = '720p';
        this.autoRecordVideo = false;
        this.transcriptSegments = [];
        this.recordingStartTime = 0;
    }

    static QUALITY_PRESETS = {
        '480p': { width: 854, height: 480, frameRate: 24 },
        '720p': { width: 1280, height: 720, frameRate: 30 },
        '1080p': { width: 1920, height: 1080, frameRate: 30 },
    };

    async render(container) {
        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        const mics = devices.filter(d => d.kind === 'audioinput');

        container.innerHTML = `
      <div class="vr-manager" id="video-recording-manager">
        <div class="vr-header">
          <h2>🎬 Video Recording</h2>
          <p class="vr-subtitle">Record video + audio for digital clone training</p>
          <button class="conv-close-btn" id="vr-close">✕</button>
        </div>

        <!-- Device Selection -->
        <div class="vr-devices">
          <div class="vr-device-row">
            <label>📷 Camera</label>
            <select id="vr-camera-select" class="conv-lang-select">
              <option value="none">No Camera</option>
              ${cameras.map(c => `<option value="${c.deviceId}">${c.label || 'Camera ' + c.deviceId.slice(0, 4)}</option>`).join('')}
              <option value="phone">📱 Phone Camera (linked)</option>
            </select>
          </div>
          <div class="vr-device-row">
            <label>🎤 Microphone</label>
            <select id="vr-mic-select" class="conv-lang-select">
              ${mics.map(m => `<option value="${m.deviceId}">${m.label || 'Mic ' + m.deviceId.slice(0, 4)}</option>`).join('')}
            </select>
          </div>
          <div class="vr-device-row">
            <label>📐 Quality</label>
            <select id="vr-quality" class="conv-lang-select">
              <option value="480p">480p (light)</option>
              <option value="720p" selected>720p (recommended)</option>
              <option value="1080p">1080p (HD)</option>
            </select>
          </div>
        </div>

        <!-- Preview + Recording Area -->
        <div class="vr-preview-area">
          <div class="vr-video-container" id="vr-video-container">
            <video id="vr-preview" autoplay muted playsinline></video>
            <div class="vr-no-camera" id="vr-no-camera">
              <span>📷</span>
              <p>Select a camera to preview</p>
            </div>
            <div class="vr-recording-indicator" id="vr-rec-indicator" style="display:none">
              <span class="vr-rec-dot"></span> REC
            </div>
          </div>
          <div class="vr-controls">
            <div class="vr-timer" id="vr-timer">0:00:00</div>
            <button class="vr-record-btn" id="vr-record-btn">
              <span id="vr-record-icon">⏺</span>
              <span id="vr-record-label">Start Recording</span>
            </button>
            <div class="vr-waveform" id="vr-audio-wave"></div>
          </div>
        </div>

        <!-- Playback Area (after recording) -->
        <div class="vr-playback" id="vr-playback" style="display:none">
          <h3>📼 Recording Complete</h3>
          <div class="vr-playback-container">
            <video id="vr-playback-video" controls></video>
            <div class="vr-subtitles" id="vr-subtitles"></div>
          </div>
          <div class="vr-bundle-info" id="vr-bundle-info"></div>
          <div class="vr-playback-actions">
            <button class="doc-action-btn" id="vr-save-bundle">💾 Save Clone Bundle</button>
            <button class="doc-action-btn" id="vr-discard">🗑️ Discard</button>
            <button class="doc-action-btn" id="vr-new-recording">🔄 New Recording</button>
          </div>
        </div>

        <!-- Settings -->
        <div class="vr-settings-section">
          <label class="vr-toggle">
            <input type="checkbox" id="vr-auto-record" ${this.autoRecordVideo ? 'checked' : ''} />
            <span>Auto-record video when transcribing</span>
          </label>
        </div>
      </div>
    `;

        this.bindEvents(container);
        // Auto-start preview if camera was selected
        if (this.selectedCamera !== 'none') {
            this.startPreview();
        }
    }

    bindEvents(container) {
        document.getElementById('vr-close').addEventListener('click', () => { this.cleanup(); container.innerHTML = ''; });

        document.getElementById('vr-camera-select').addEventListener('change', e => {
            this.selectedCamera = e.target.value;
            if (this.selectedCamera === 'phone') {
                // Trigger phone-as-camera flow
                if (window.PhoneCameraBridge) {
                    const bridge = new PhoneCameraBridge();
                    bridge.showLinkUI(document.getElementById('vr-video-container'));
                }
            } else if (this.selectedCamera !== 'none') {
                this.startPreview();
            } else {
                this.stopPreview();
            }
        });

        document.getElementById('vr-mic-select').addEventListener('change', e => { this.selectedMic = e.target.value; });
        document.getElementById('vr-quality').addEventListener('change', e => { this.videoQuality = e.target.value; });
        document.getElementById('vr-auto-record').addEventListener('change', e => { this.autoRecordVideo = e.target.checked; });

        document.getElementById('vr-record-btn').addEventListener('click', () => {
            this.isRecording ? this.stopRecording() : this.startRecording();
        });

        document.getElementById('vr-save-bundle').addEventListener('click', () => this.saveBundle());
        document.getElementById('vr-discard').addEventListener('click', () => this.discardRecording(container));
        document.getElementById('vr-new-recording').addEventListener('click', () => this.render(container));
    }

    async startPreview() {
        try {
            const preset = VideoRecordingManager.QUALITY_PRESETS[this.videoQuality];
            this.videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: this.selectedCamera !== 'none' ? { exact: this.selectedCamera } : undefined,
                    width: { ideal: preset.width },
                    height: { ideal: preset.height },
                    frameRate: { ideal: preset.frameRate }
                }
            });
            const preview = document.getElementById('vr-preview');
            preview.srcObject = this.videoStream;
            document.getElementById('vr-no-camera').style.display = 'none';
            preview.style.display = 'block';
        } catch (err) {
            console.error('[VR] Preview error:', err);
        }
    }

    stopPreview() {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(t => t.stop());
            this.videoStream = null;
        }
        const preview = document.getElementById('vr-preview');
        if (preview) { preview.srcObject = null; preview.style.display = 'none'; }
        const noCam = document.getElementById('vr-no-camera');
        if (noCam) noCam.style.display = 'flex';
    }

    async startRecording() {
        try {
            // Get audio stream
            const audioConstraints = this.selectedMic
                ? { deviceId: { exact: this.selectedMic }, sampleRate: 44100, channelCount: 1 }
                : { sampleRate: 44100, channelCount: 1 };
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

            // Combine video + audio if camera active
            let combinedStream;
            if (this.videoStream) {
                combinedStream = new MediaStream([
                    ...this.videoStream.getVideoTracks(),
                    ...this.audioStream.getAudioTracks()
                ]);
            } else {
                combinedStream = this.audioStream;
            }

            this.mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: this.videoStream ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus'
            });
            this.recordedChunks = [];
            this.transcriptSegments = [];
            this.recordingStartTime = Date.now();

            this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.recordedChunks.push(e.data); };
            this.mediaRecorder.onstop = () => this.onRecordingStopped();
            this.mediaRecorder.start(1000);

            this.isRecording = true;
            this.duration = 0;
            this.timer = setInterval(() => {
                this.duration++;
                const h = Math.floor(this.duration / 3600);
                const m = Math.floor((this.duration % 3600) / 60);
                const s = this.duration % 60;
                document.getElementById('vr-timer').textContent = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }, 1000);

            document.getElementById('vr-record-icon').textContent = '⏹';
            document.getElementById('vr-record-label').textContent = 'Stop Recording';
            document.getElementById('vr-record-btn').classList.add('recording');
            document.getElementById('vr-rec-indicator').style.display = 'flex';

            // Audio waveform
            this.startAudioWaveform(this.audioStream);

            // Start transcription in background
            this.startLiveTranscription(this.audioStream);

        } catch (err) {
            console.error('[VR] Record error:', err);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        clearInterval(this.timer);
        this.stopAudioStream();

        document.getElementById('vr-record-icon').textContent = '⏺';
        document.getElementById('vr-record-label').textContent = 'Start Recording';
        document.getElementById('vr-record-btn').classList.remove('recording');
        const ind = document.getElementById('vr-rec-indicator');
        if (ind) ind.style.display = 'none';
    }

    stopAudioStream() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(t => t.stop());
            this.audioStream = null;
        }
    }

    onRecordingStopped() {
        const hasVideo = this.videoStream !== null;
        const mimeType = hasVideo ? 'video/webm' : 'audio/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Build bundle data
        this.currentBundle = {
            bundle_id: crypto.randomUUID(),
            duration_seconds: this.duration,
            audio: { format: 'opus', file: 'recording.webm' },
            video: hasVideo ? {
                format: 'vp9',
                resolution: this.videoQuality,
                file: 'recording.webm',
                camera: this.selectedCamera === 'phone' ? 'phone' : 'webcam'
            } : null,
            transcript: {
                text: this.transcriptSegments.map(s => s.text).join(' '),
                segments: this.transcriptSegments
            },
            device: {
                platform: 'desktop',
                app_version: '2.0'
            },
            sync_status: 'local',
            clone_training_ready: this.transcriptSegments.length > 0 && this.duration > 10,
            blob,
            url
        };

        // Show playback
        document.getElementById('vr-playback').style.display = 'block';
        const playbackVideo = document.getElementById('vr-playback-video');
        playbackVideo.src = url;

        // Subtitles
        const subsEl = document.getElementById('vr-subtitles');
        if (this.transcriptSegments.length > 0) {
            subsEl.innerHTML = this.transcriptSegments.map(s =>
                `<div class="vr-sub-entry"><span class="vr-sub-time">${this.formatTime(s.start)}</span> <span class="vr-sub-text">${s.text}</span></div>`
            ).join('');

            // Sync subtitles with playback
            playbackVideo.addEventListener('timeupdate', () => {
                const t = playbackVideo.currentTime;
                subsEl.querySelectorAll('.vr-sub-entry').forEach((el, i) => {
                    const seg = this.transcriptSegments[i];
                    el.classList.toggle('vr-sub-active', t >= seg.start && t < seg.end);
                });
            });
        } else {
            subsEl.innerHTML = '<p class="vr-sub-empty">No transcript segments captured</p>';
        }

        // Bundle info
        document.getElementById('vr-bundle-info').innerHTML = `
      <div class="vr-bundle-stats">
        <span>⏱️ ${this.formatTime(this.duration)}</span>
        <span>💾 ${(blob.size / 1048576).toFixed(1)} MB</span>
        <span>📝 ${this.transcriptSegments.length} segments</span>
        <span>${hasVideo ? '🎬 Video' : '🎤 Audio only'}</span>
        <span>${this.currentBundle.clone_training_ready ? '✅ Training ready' : '⚠️ Too short for training'}</span>
      </div>
    `;
    }

    async saveBundle() {
        if (!this.currentBundle) return;

        // Convert blob to base64
        const reader = new FileReader();
        const base64 = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(this.currentBundle.blob);
        });

        try {
            const result = await window.windyAPI.saveCloneBundle({
                ...this.currentBundle,
                blob: undefined, url: undefined,
                mediaBase64: base64
            });
            if (result?.success) {
                document.getElementById('vr-bundle-info').innerHTML += '<p class="vr-saved">✅ Bundle saved to clone data archive</p>';
            }
        } catch (err) {
            console.error('[VR] Save bundle error:', err);
        }
    }

    discardRecording(container) {
        if (this.currentBundle?.url) URL.revokeObjectURL(this.currentBundle.url);
        this.currentBundle = null;
        this.render(container);
    }

    startAudioWaveform(stream) {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const waveEl = document.getElementById('vr-audio-wave');

        const draw = () => {
            if (!this.isRecording) { ctx.close(); if (waveEl) waveEl.innerHTML = ''; return; }
            analyser.getByteFrequencyData(data);
            if (waveEl) {
                waveEl.innerHTML = Array.from(data).slice(0, 20).map(v =>
                    `<div class="conv-bar" style="height:${Math.max(2, v / 255 * 35)}px"></div>`
                ).join('');
            }
            requestAnimationFrame(draw);
        };
        draw();
    }

    async startLiveTranscription(stream) {
        // Periodically capture audio chunks for transcription
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        let audioBuffer = [];
        let lastTranscriptionTime = 0;

        processor.onaudioprocess = (e) => {
            if (!this.isRecording) { processor.disconnect(); audioCtx.close(); return; }
            audioBuffer.push(new Float32Array(e.inputBuffer.getChannelData(0)));

            // Transcribe every 5 seconds of audio
            const now = Date.now();
            if (now - lastTranscriptionTime > 5000 && audioBuffer.length > 0) {
                lastTranscriptionTime = now;
                const combined = this.mergeFloat32Arrays(audioBuffer);
                audioBuffer = [];
                this.transcribeChunk(combined, (now - this.recordingStartTime) / 1000);
            }
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
    }

    mergeFloat32Arrays(arrays) {
        const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    async transcribeChunk(audioData, timeOffset) {
        // Convert Float32 to WAV-like base64
        const buffer = new ArrayBuffer(audioData.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        const blob = new Blob([buffer], { type: 'audio/pcm' });
        const reader = new FileReader();
        const base64 = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });

        try {
            const result = await window.windyAPI.batchTranscribeLocal(base64);
            const text = result?.text || result?.transcript || '';
            if (text.trim()) {
                this.transcriptSegments.push({
                    start: Math.max(0, timeOffset - 5),
                    end: timeOffset,
                    text: text.trim(),
                    confidence: result?.confidence || 0.85
                });
            }
        } catch { /* transcription failed for chunk */ }
    }

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    cleanup() {
        this.stopRecording();
        this.stopPreview();
        if (this.currentBundle?.url) URL.revokeObjectURL(this.currentBundle.url);
    }
}

window.VideoRecordingManager = VideoRecordingManager;
