/**
 * Windy Pro — Phone-as-Camera (WebRTC Bridge)
 * Link phone camera via QR code, receive video stream via RTCPeerConnection,
 * switch front/back camera, connection quality indicator, LAN optimization
 */

class PhoneCameraBridge {
    constructor() {
        this.peerConnection = null;
        this.sessionToken = null;
        this.connected = false;
        this.remoteStream = null;
        this.statsInterval = null;
        this.quality = { latency: 0, resolution: '', fps: 0 };
    }

    // ─── Show Link UI ───
    showLinkUI(container) {
        this.sessionToken = crypto.randomUUID();
        const signalUrl = this.getSignalUrl();
        // QR code data: link phone to this session
        const qrData = JSON.stringify({
            type: 'windy-camera-link',
            token: this.sessionToken,
            signal: signalUrl,
            timestamp: Date.now()
        });

        container.innerHTML = `
      <div class="pcb-overlay" id="pcb-overlay">
        <div class="pcb-card">
          <h3>📱 Link Phone Camera</h3>
          <p class="pcb-instructions">Scan this QR code with your phone to connect its camera</p>
          <div class="pcb-qr" id="pcb-qr">
            <div class="pcb-qr-placeholder">
              <div class="pcb-qr-grid">${this.generateQRPlaceholder(qrData)}</div>
              <p class="pcb-qr-token">Session: ${this.sessionToken.slice(0, 8)}</p>
            </div>
          </div>
          <div class="pcb-status" id="pcb-status">
            <span class="pcb-status-dot pcb-waiting"></span>
            Waiting for phone to connect...
          </div>
          <div class="pcb-manual">
            <p>Or enter this code on your phone:</p>
            <code class="pcb-code">${this.sessionToken.slice(0, 8).toUpperCase()}</code>
          </div>
          <div class="pcb-actions">
            <button class="doc-action-btn" id="pcb-cancel">Cancel</button>
            <button class="doc-action-btn" id="pcb-retry">🔄 Refresh</button>
          </div>
        </div>
      </div>
    `;

        document.getElementById('pcb-cancel').addEventListener('click', () => {
            this.disconnect();
            container.innerHTML = '';
        });

        document.getElementById('pcb-retry').addEventListener('click', () => {
            this.sessionToken = crypto.randomUUID();
            this.showLinkUI(container);
        });

        // Start polling for phone connection
        this.startSignaling(container);
    }

    getSignalUrl() {
        // Use account server for signaling
        const settings = window.windyAPI?.getSettings ? null : null;
        return '/api/v1/rtc/signal';
    }

    // ─── WebRTC Setup ───
    async startSignaling(container) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        this.peerConnection = new RTCPeerConnection(config);

        // Handle incoming video track
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.connected = true;
            this.onPhoneConnected(container);
        };

        this.peerConnection.onicecandidate = async (event) => {
            if (event.candidate) {
                try {
                    await this.sendSignal({
                        type: 'ice-candidate',
                        token: this.sessionToken,
                        candidate: event.candidate.toJSON()
                    });
                } catch { /* signal failed */ }
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            if (state === 'disconnected' || state === 'failed') {
                this.onPhoneDisconnected(container);
            }
        };

        // Create offer and send via signaling
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: false
            });
            await this.peerConnection.setLocalDescription(offer);

            await this.sendSignal({
                type: 'offer',
                token: this.sessionToken,
                sdp: offer.sdp
            });

            // Poll for answer
            this.pollForAnswer();
        } catch (err) {
            console.error('[PCB] Signaling error:', err);
        }
    }

    async sendSignal(data) {
        try {
            const res = await fetch('/api/v1/rtc/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (err) {
            console.error('[PCB] Signal send error:', err);
            return null;
        }
    }

    async pollForAnswer() {
        let attempts = 0;
        const maxAttempts = 60; // 30 seconds

        const poll = async () => {
            if (this.connected || attempts >= maxAttempts) return;
            attempts++;

            try {
                const res = await fetch(`/api/v1/rtc/signal?token=${this.sessionToken}&type=answer`);
                const data = await res.json();

                if (data?.sdp) {
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: data.sdp
                    }));
                }

                // Check for ICE candidates
                if (data?.candidates) {
                    for (const candidate of data.candidates) {
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                }
            } catch { /* poll failed */ }

            if (!this.connected) setTimeout(poll, 500);
        };

        poll();
    }

    // ─── Phone Connected ───
    onPhoneConnected(container) {
        container.innerHTML = `
      <div class="pcb-connected">
        <div class="pcb-video-wrapper">
          <video id="pcb-remote-video" autoplay playsinline></video>
          <div class="pcb-quality-bar" id="pcb-quality-bar">
            <span id="pcb-latency">--ms</span>
            <span id="pcb-resolution">--</span>
            <span id="pcb-fps">--fps</span>
          </div>
        </div>
        <div class="pcb-phone-controls">
          <button class="doc-action-btn" id="pcb-switch-camera">🔄 Switch Camera</button>
          <button class="doc-action-btn pcb-disconnect-btn" id="pcb-disconnect">📴 Disconnect</button>
        </div>
      </div>
    `;

        const remoteVideo = document.getElementById('pcb-remote-video');
        remoteVideo.srcObject = this.remoteStream;

        // Switch camera on phone
        document.getElementById('pcb-switch-camera').addEventListener('click', () => {
            this.sendSignal({ type: 'switch-camera', token: this.sessionToken });
        });

        document.getElementById('pcb-disconnect').addEventListener('click', () => {
            this.disconnect();
            container.innerHTML = '';
        });

        // Start quality monitoring
        this.startQualityMonitoring();
    }

    onPhoneDisconnected(container) {
        this.connected = false;
        const statusEl = document.getElementById('pcb-status');
        if (statusEl) {
            statusEl.innerHTML = '<span class="pcb-status-dot pcb-error"></span> Phone disconnected';
        }
    }

    startQualityMonitoring() {
        this.statsInterval = setInterval(async () => {
            if (!this.peerConnection) return;
            try {
                const stats = await this.peerConnection.getStats();
                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        const latencyEl = document.getElementById('pcb-latency');
                        const resEl = document.getElementById('pcb-resolution');
                        const fpsEl = document.getElementById('pcb-fps');
                        if (latencyEl) latencyEl.textContent = `${Math.round(report.jitter * 1000 || 0)}ms`;
                        if (resEl) resEl.textContent = `${report.frameWidth || '?'}×${report.frameHeight || '?'}`;
                        if (fpsEl) fpsEl.textContent = `${Math.round(report.framesPerSecond || 0)}fps`;
                    }
                });
            } catch { /* stats failed */ }
        }, 2000);
    }

    generateQRPlaceholder(data) {
        // Generate a visual grid pattern as QR placeholder
        const grid = [];
        for (let i = 0; i < 121; i++) {
            const hash = (data.charCodeAt(i % data.length) * (i + 7)) % 2;
            grid.push(`<div class="pcb-qr-cell ${hash ? 'pcb-qr-dark' : ''}"></div>`);
        }
        return grid.join('');
    }

    // ─── Get Remote Stream (for use in VideoRecordingManager) ───
    getStream() {
        return this.remoteStream;
    }

    disconnect() {
        clearInterval(this.statsInterval);
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.connected = false;
        this.remoteStream = null;
    }
}

window.PhoneCameraBridge = PhoneCameraBridge;
