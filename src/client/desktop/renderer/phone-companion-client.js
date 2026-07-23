/**
 * Windy Word — WiFi Phone Companion (renderer client)
 *
 * Desktop side of the QR + WebRTC phone pairing. Main process hosts the LAN
 * server and relays signaling (windyAPI.phoneCompanion); this client owns the
 * RTCPeerConnection, exposes the phone's MediaStream to the pickers and the
 * recording paths ('phone:wifi'), and renders the connect overlay.
 *
 * The main window is focusable:false on every platform by design — the
 * overlay uses only click targets, nothing here needs keyboard focus, and
 * nothing here touches window focus/visibility.
 */

class PhoneCompanionClient {
  constructor() {
    this.connected = false;
    this.stream = null;
    this.label = null;
    this.hasVideo = false;
    this.pc = null;
    this._listeners = [];
    this._overlay = null;
    if (window.windyAPI?.phoneCompanion) {
      window.windyAPI.phoneCompanion.onEvent((payload) => this._onEvent(payload));
    }
  }

  /** Subscribe to {kind: 'connected'|'disconnected'|'label'} changes. */
  onChange(cb) { this._listeners.push(cb); }
  _emit(evt) { for (const cb of this._listeners) { try { cb(evt); } catch { /* listener error */ } } }

  // ─── Connect overlay (QR) ────────────────────────────────────────────────
  /** intent: 'camera' pre-enables camera sharing on the phone page. */
  async openConnectOverlay(intent) {
    this.closeOverlay();
    this._intent = intent || 'mic';
    const session = await window.windyAPI.phoneCompanion.createSession(this._intent);
    const overlay = document.createElement('div');
    overlay.id = 'pcwOverlay';
    overlay.className = 'pcw-overlay';
    if (session.error) {
      overlay.innerHTML = `
        <div class="pcw-card">
          <h3>📱 Connect a phone</h3>
          <p class="pcw-status pcw-err">${session.message || 'Could not start the phone link.'}</p>
          <button class="pcw-btn" id="pcwCancel">Close</button>
        </div>`;
    } else {
      overlay.innerHTML = `
        <div class="pcw-card">
          <h3>📱 Connect a phone</h3>
          <p class="pcw-sub">Scan with your phone's camera — no app needed.<br>
          Phone and computer must be on the same WiFi.</p>
          <div class="pcw-qr">${session.qrSvg}</div>
          <p class="pcw-url">${session.url}</p>
          <p class="pcw-sub pcw-dim">Your phone's browser will warn about the connection being
          private-but-unverified — that's this computer's own local certificate. Tap
          Advanced&nbsp;→&nbsp;Continue. Nothing leaves your WiFi.</p>
          <p class="pcw-status" id="pcwStatus">Waiting for your phone…</p>
          <button class="pcw-btn" id="pcwCancel">Cancel</button>
        </div>`;
    }
    document.body.appendChild(overlay);
    this._overlay = overlay;
    overlay.querySelector('#pcwCancel')?.addEventListener('click', () => this.closeOverlay());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeOverlay(); });
    // Nothing arriving usually means an OLD tab on the phone (looks alive,
    // connected to nothing — the 7-23 zombie). Nudge after 45s.
    setTimeout(() => {
      if (this._overlay === overlay && !this.connected) {
        this._setOverlayStatus('Still waiting… On the phone: scan THIS QR (an old tab won\'t work) and tap "Start streaming".');
      }
    }, 45000);
  }

  closeOverlay() {
    this._overlay?.remove();
    this._overlay = null;
  }

  _setOverlayStatus(text, cls) {
    const el = this._overlay?.querySelector('#pcwStatus');
    if (el) { el.textContent = text; el.className = 'pcw-status' + (cls ? ' ' + cls : ''); }
  }

  // ─── Events from main ────────────────────────────────────────────────────
  _onEvent(payload) {
    switch (payload.kind) {
      case 'from-phone': this._onSignal(payload.msg || {}); break;
      case 'connected':
        this.label = payload.label || this.label || 'Phone';
        this._setOverlayStatus('📶 ' + this.label + ' connected — starting stream…', 'pcw-ok');
        break;
      case 'socket-closed':
        // Screen lock / WiFi blip — the server holds the session for a grace
        // window and the phone auto-resumes. Don't tear down yet.
        this._setOverlayStatus('Connection hiccup — waiting for the phone…');
        break;
      case 'resumed':
        this._setOverlayStatus('📶 ' + (this.label || 'Phone') + ' reconnected', 'pcw-ok');
        break;
      case 'disconnected':
        this._teardown();
        break;
      default: break;
    }
  }

  async _onSignal(msg) {
    try {
      if (msg.type === 'hello') {
        this.label = String(msg.label || 'Phone').slice(0, 40);
        this.hasVideo = !!msg.hasVideo;
        this._emit({ kind: 'label', label: this.label });
        if (this._intent === 'camera' && !this.hasVideo) {
          // They wanted a camera but the phone is sending audio only — say so
          // NOW, in the overlay, instead of recording black video later.
          this._setOverlayStatus('⚠️ ' + this.label + ' is sharing audio only — turn ON "Also share camera" on the phone, then tap Start again.', 'pcw-err');
        }
      } else if (msg.type === 'offer') {
        // Phone (re)offers — fresh or after a resume. Replace any old pc.
        try { this.pc?.close(); } catch { /* noop */ }
        this.pc = new RTCPeerConnection({ iceServers: [] }); // same LAN — host candidates only
        this.pc.ontrack = (e) => {
          this.stream = e.streams[0] || new MediaStream([e.track]);
          this._setOverlayStatus('📶 ' + (this.label || 'Phone') + ' found — starting stream…');
          if (this.connected) this._attachKeepaliveSink(); // renegotiation replaced the stream
        };
        // 'connected' only when media is actually flowing (ontrack fires at SDP
        // time, while ICE is still connecting — recording then would capture
        // zero bytes). connectionState 'connected' == packets on the wire.
        this.pc.onconnectionstatechange = () => {
          if (this.pc?.connectionState === 'connected' && this.stream && !this.connected) {
            this.connected = true;
            this._attachKeepaliveSink();
            this._emit({ kind: 'connected', label: this.label, hasVideo: this.hasVideo });
            if (this._intent === 'camera' && !this.hasVideo) {
              // They wanted a camera but the phone sent audio only — keep the
              // overlay open with instructions instead of recording black later.
              this._setOverlayStatus('⚠️ ' + (this.label || 'Phone') + ' connected with mic ONLY — turn ON "Also share camera" on the phone and tap Start again to add video.', 'pcw-err');
            } else {
              const media = this.hasVideo ? 'mic + camera' : 'mic';
              this._setOverlayStatus('✅ ' + (this.label || 'Phone') + ' is live (' + media + ') — you can close this window', 'pcw-ok');
              // Give the user a beat to read the success state, then tidy up.
              setTimeout(() => this.closeOverlay(), 1800);
            }
          }
        };
        this.pc.onicecandidate = (e) => {
          if (e.candidate) window.windyAPI.phoneCompanion.toPhone({ type: 'ice', candidate: e.candidate.toJSON() });
        };
        await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        window.windyAPI.phoneCompanion.toPhone({ type: 'answer', sdp: answer.sdp });
      } else if (msg.type === 'ice' && msg.candidate) {
        try { await this.pc?.addIceCandidate(msg.candidate); } catch { /* late candidate */ }
      } else if (msg.type === 'bye') {
        window.windyAPI.phoneCompanion.endSession();
        this._teardown();
      }
    } catch (err) {
      console.warn('[PhoneCompanion] signaling error:', err.message);
      this._setOverlayStatus('Connection error — try a fresh QR code', 'pcw-err');
    }
  }

  /**
   * Chromium only decodes remote WebRTC media while an active consumer exists —
   * without one, MediaRecorder and track clones capture ZERO bytes (proven in
   * e2e/phone-companion-loopback.js). A hidden playing <video> pins decoding
   * for the whole session so the recording paths always get real frames.
   */
  _attachKeepaliveSink() {
    this._removeKeepaliveSink();
    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.style.position = 'fixed';
    vid.style.top = '-9999px';
    vid.style.width = '2px';
    vid.srcObject = this.stream;
    document.body.appendChild(vid);
    vid.play().catch(() => { /* autoplay of muted video is allowed */ });
    this._sinkEl = vid;
  }

  _removeKeepaliveSink() {
    this._sinkEl?.remove();
    this._sinkEl = null;
  }

  _teardown() {
    if (!this.connected && !this.pc) return; // idempotent
    try { this.pc?.close(); } catch { /* noop */ }
    this.pc = null;
    this.stream = null;
    this._removeKeepaliveSink();
    const wasConnected = this.connected;
    this.connected = false;
    this._setOverlayStatus('📴 Phone disconnected', 'pcw-err');
    if (wasConnected) this._emit({ kind: 'disconnected', label: this.label });
  }

  /** User-initiated disconnect (picker/overlay). */
  disconnect() {
    window.windyAPI.phoneCompanion.endSession();
    this._teardown();
  }
}

window.phoneCompanion = window.windyAPI?.phoneCompanion ? new PhoneCompanionClient() : null;
