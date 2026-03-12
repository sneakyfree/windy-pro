/**
 * Windy Chat — Voice & Video Calling (Desktop)
 * K5: Video and Voice Calling (DNA Strand K)
 *
 * WebRTC calling with Matrix signaling:
 *   K5.1 1:1 Voice calls (m.call.invite / m.call.answer)
 *   K5.2 1:1 Video calls (camera, screen share)
 *   K5.3 Group calls (SFU via LiveKit/Jitsi)
 *   K5.4 Real-time translated subtitles (KILLER FEATURE)
 *   K5.5 Call history
 *   K5.6 Picture-in-Picture
 *
 * TURN server: Coturn (deployed in K1.1.1)
 * STUN server: Google STUN (stun:stun.l.google.com:19302)
 */

'use strict';

// ── Constants ──

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN servers added dynamically from Synapse (K1)
];

const CALL_TIMEOUT_MS = 30000;  // Auto-decline after 30 seconds
const SUBTITLE_FADE_MS = 5000;  // Subtitle fade-out after silence
const STT_BUFFER_MS = 2000;     // 2-second sliding window for STT

const CALL_STATES = {
  IDLE: 'idle',
  RINGING_OUTGOING: 'ringing_outgoing',
  RINGING_INCOMING: 'ringing_incoming',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ON_HOLD: 'on_hold',
  ENDED: 'ended',
};

// ── K5.1 & K5.2: WebRTC Call Manager ──

class CallManager {
  constructor(matrixClient) {
    this.matrixClient = matrixClient;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.state = CALL_STATES.IDLE;
    this.callType = null;       // 'voice' or 'video'
    this.callId = null;
    this.roomId = null;
    this.startTime = null;
    this.callTimeout = null;
    this.onStateChange = null;
    this.onRemoteStream = null;
    this.onSubtitle = null;

    // Subtitle system
    this.subtitleEngine = null;

    // Call quality monitoring
    this.qualityMonitor = null;
  }

  /**
   * Get TURN server credentials from Synapse.
   * Synapse provides time-limited TURN credentials via /_matrix/client/v3/voip/turnServer.
   */
  async getTurnServers() {
    try {
      const response = await this.matrixClient.turnServer();
      const servers = [...ICE_SERVERS];

      if (response && response.uris) {
        servers.push({
          urls: response.uris,
          username: response.username,
          credential: response.password,
        });
      }

      return servers;
    } catch (err) {
      console.warn('Failed to get TURN servers, using STUN only:', err.message);
      return ICE_SERVERS;
    }
  }

  /**
   * Start an outgoing call.
   * K5.1.1: Call Setup (WebRTC + Matrix Signaling)
   */
  async startCall(roomId, type = 'voice') {
    if (this.state !== CALL_STATES.IDLE) {
      throw new Error(`Cannot start call in state: ${this.state}`);
    }

    this.roomId = roomId;
    this.callType = type;
    this.callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._setState(CALL_STATES.RINGING_OUTGOING);

    try {
      // Get local media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: type === 'video' ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        } : false,
      });

      // Create peer connection
      const iceServers = await this.getTurnServers();
      this.peerConnection = new RTCPeerConnection({ iceServers });

      // Add local tracks
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Handle remote tracks
      this.peerConnection.ontrack = (event) => {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStream) this.onRemoteStream(this.remoteStream);

        // Start subtitle engine on remote audio (K5.4)
        if (this.subtitleEngine) {
          this.subtitleEngine.attachStream(this.remoteStream);
        }
      };

      // ICE candidate handling
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendMatrixEvent('m.call.candidates', {
            call_id: this.callId,
            candidates: [event.candidate.toJSON()],
            version: 1,
          });
        }
      };

      // Connection state monitoring
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection.connectionState;
        if (state === 'connected') {
          this._setState(CALL_STATES.CONNECTED);
          this.startTime = Date.now();
          this._startQualityMonitor();
        } else if (state === 'failed' || state === 'disconnected') {
          this.endCall('connection_failed');
        }
      };

      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      await this._sendMatrixEvent('m.call.invite', {
        call_id: this.callId,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
        version: 1,
        lifetime: CALL_TIMEOUT_MS,
      });

      // Auto-decline timeout
      this.callTimeout = setTimeout(() => {
        if (this.state === CALL_STATES.RINGING_OUTGOING) {
          this.endCall('no_answer');
        }
      }, CALL_TIMEOUT_MS);

      console.log(`📞 Outgoing ${type} call: ${this.callId}`);

    } catch (err) {
      this._setState(CALL_STATES.IDLE);
      this._cleanup();
      throw err;
    }
  }

  /**
   * Answer an incoming call.
   * K5.1.1: Callee accepts → m.call.answer event
   */
  async answerCall(callEvent) {
    if (this.state !== CALL_STATES.RINGING_INCOMING) {
      throw new Error('No incoming call to answer');
    }

    this._setState(CALL_STATES.CONNECTING);

    try {
      const { call_id, offer } = callEvent.content;
      this.callId = call_id;

      // Determine call type from SDP
      this.callType = offer.sdp.includes('m=video') ? 'video' : 'voice';

      // Get local media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: this.callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });

      // Create peer connection
      const iceServers = await this.getTurnServers();
      this.peerConnection = new RTCPeerConnection({ iceServers });

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      this.peerConnection.ontrack = (event) => {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStream) this.onRemoteStream(this.remoteStream);
        if (this.subtitleEngine) this.subtitleEngine.attachStream(this.remoteStream);
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendMatrixEvent('m.call.candidates', {
            call_id: this.callId,
            candidates: [event.candidate.toJSON()],
            version: 1,
          });
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        if (this.peerConnection.connectionState === 'connected') {
          this._setState(CALL_STATES.CONNECTED);
          this.startTime = Date.now();
          this._startQualityMonitor();
        }
      };

      // Set remote description and create answer
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      await this._sendMatrixEvent('m.call.answer', {
        call_id: this.callId,
        answer: { type: answer.type, sdp: answer.sdp },
        version: 1,
      });

      console.log(`📞 Answered ${this.callType} call: ${this.callId}`);

    } catch (err) {
      this._setState(CALL_STATES.IDLE);
      this._cleanup();
      throw err;
    }
  }

  /**
   * Handle incoming call event.
   * K5.1.2: Incoming Call UI
   */
  handleIncomingCall(callEvent) {
    if (this.state !== CALL_STATES.IDLE) {
      // Already in a call — reject with busy
      this._sendMatrixEvent('m.call.hangup', {
        call_id: callEvent.content.call_id,
        reason: 'user_busy',
        version: 1,
      });
      return { accepted: false, reason: 'busy' };
    }

    this._setState(CALL_STATES.RINGING_INCOMING);
    this.roomId = callEvent.room_id;

    // Auto-decline timeout
    this.callTimeout = setTimeout(() => {
      if (this.state === CALL_STATES.RINGING_INCOMING) {
        this.declineCall('timeout');
      }
    }, CALL_TIMEOUT_MS);

    return {
      accepted: null,  // Awaiting user action
      callId: callEvent.content.call_id,
      callType: callEvent.content.offer.sdp.includes('m=video') ? 'video' : 'voice',
      caller: callEvent.sender,
    };
  }

  /**
   * Decline an incoming call.
   */
  declineCall(reason = 'user_declined') {
    if (this.callTimeout) clearTimeout(this.callTimeout);

    this._sendMatrixEvent('m.call.hangup', {
      call_id: this.callId,
      reason,
      version: 1,
    });

    this._setState(CALL_STATES.IDLE);
    this._cleanup();
  }

  /**
   * End current call.
   */
  endCall(reason = 'user_hangup') {
    if (this.callTimeout) clearTimeout(this.callTimeout);

    const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

    this._sendMatrixEvent('m.call.hangup', {
      call_id: this.callId,
      reason,
      version: 1,
    });

    console.log(`📞 Call ended: ${this.callId} (${formatDuration(duration)})`);

    // Add to call history
    CallHistory.addEntry({
      callId: this.callId,
      roomId: this.roomId,
      type: this.callType,
      direction: this.state === CALL_STATES.RINGING_OUTGOING ? 'outgoing' : 'incoming',
      duration,
      endReason: reason,
      timestamp: Date.now(),
    });

    this._setState(CALL_STATES.ENDED);
    this._cleanup();
    this._setState(CALL_STATES.IDLE);
  }

  // ── K5.1.3: In-Call Controls ──

  /** Toggle microphone mute. */
  toggleMute() {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true = muted
    }
    return false;
  }

  /** Toggle camera on/off. */
  toggleCamera() {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }

  /** Toggle hold. */
  toggleHold() {
    if (this.state === CALL_STATES.CONNECTED) {
      this._setState(CALL_STATES.ON_HOLD);
      this.localStream?.getTracks().forEach(t => { t.enabled = false; });
      return true;
    } else if (this.state === CALL_STATES.ON_HOLD) {
      this._setState(CALL_STATES.CONNECTED);
      this.localStream?.getTracks().forEach(t => { t.enabled = true; });
      return false;
    }
    return false;
  }

  /** Get call duration in seconds. */
  getDuration() {
    if (!this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  // ── K5.2.3: Screen Sharing ──

  /**
   * Start screen sharing (replaces camera track).
   */
  async startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { max: 15 } },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = this.peerConnection.getSenders().find(s =>
        s.track?.kind === 'video'
      );

      if (sender) {
        await sender.replaceTrack(screenTrack);
      }

      screenTrack.onended = () => this.stopScreenShare();

      console.log('🖥️ Screen sharing started');
      return true;
    } catch (err) {
      console.error('Screen share error:', err);
      return false;
    }
  }

  /**
   * Stop screen sharing (restore camera).
   */
  async stopScreenShare() {
    if (!this.localStream) return;

    const cameraTrack = this.localStream.getVideoTracks()[0];
    const sender = this.peerConnection.getSenders().find(s =>
      s.track?.kind === 'video'
    );

    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }

    console.log('🖥️ Screen sharing stopped');
  }

  // ── Internal ──

  _setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state);
  }

  async _sendMatrixEvent(type, content) {
    if (this.matrixClient && this.roomId) {
      try {
        await this.matrixClient.sendEvent(this.roomId, type, content);
      } catch (err) {
        console.error(`Failed to send ${type}:`, err);
      }
    }
  }

  _cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.qualityMonitor) {
      clearInterval(this.qualityMonitor);
      this.qualityMonitor = null;
    }
    if (this.subtitleEngine) {
      this.subtitleEngine.stop();
    }
    this.remoteStream = null;
    this.callId = null;
    this.startTime = null;
  }

  // ── K5.1.4: Call Quality Monitoring ──

  _startQualityMonitor() {
    this.qualityMonitor = setInterval(async () => {
      if (!this.peerConnection) return;

      try {
        const stats = await this.peerConnection.getStats();
        let packetsLost = 0;
        let packetsReceived = 0;
        let roundTripTime = 0;

        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            packetsLost = report.packetsLost || 0;
            packetsReceived = report.packetsReceived || 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = report.currentRoundTripTime * 1000 || 0;
          }
        });

        const lossRate = packetsReceived > 0
          ? (packetsLost / (packetsLost + packetsReceived)) * 100
          : 0;

        const quality = lossRate < 2 && roundTripTime < 150 ? 'excellent'
          : lossRate < 5 && roundTripTime < 300 ? 'good'
          : 'poor';

        this.networkQuality = { quality, lossRate, roundTripTime };
      } catch {
        // Stats not available
      }
    }, 5000);
  }
}

// ── K5.4: Real-Time Translated Subtitles ──

class SubtitleEngine {
  /**
   * Real-time translated subtitles for video calls.
   *
   * Architecture:
   *   Remote audio → local STT (Whisper) → translate → render subtitle
   *   ALL processing on LOCAL device — zero cloud, zero data leak
   *   ~1.5s latency target
   */
  constructor(translateFn, srcLang, tgtLang) {
    this.translateFn = translateFn;
    this.srcLang = srcLang;
    this.tgtLang = tgtLang;
    this.audioContext = null;
    this.analyser = null;
    this.processor = null;
    this.sourceNode = null;
    this.isActive = false;
    this.onSubtitle = null;
    this.lastSubtitleTime = 0;
    this.vadActive = false;
  }

  /**
   * Attach to a remote media stream and start processing.
   * K5.4.2: Audio Routing for STT
   */
  attachStream(remoteStream) {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(remoteStream);
      this.sourceNode = source;

      // Analyser for VAD (Voice Activity Detection)
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      // ScriptProcessor for audio capture (read-only, doesn't affect playback)
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor = processor;
      this.audioBuffer = [];
      this.bufferDuration = 0;

      processor.onaudioprocess = (e) => {
        if (!this.isActive) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // VAD: check if speech is present
        const rms = Math.sqrt(
          inputData.reduce((sum, x) => sum + x * x, 0) / inputData.length
        );

        if (rms > 0.01) { // Speech threshold
          this.vadActive = true;
          this.audioBuffer.push(new Float32Array(inputData));
          this.bufferDuration += inputData.length / this.audioContext.sampleRate;

          // Process when buffer reaches 2 seconds
          if (this.bufferDuration >= STT_BUFFER_MS / 1000) {
            this._processBuffer();
          }
        } else if (this.vadActive && this.audioBuffer.length > 0) {
          // Silence detected after speech — process remaining buffer
          this._processBuffer();
          this.vadActive = false;
        }
      };

      source.connect(processor);
      processor.connect(this.audioContext.destination);

      this.isActive = true;
      console.log('🎬 Subtitle engine started');

    } catch (err) {
      console.error('Subtitle engine error:', err);
    }
  }

  /**
   * Process the audio buffer: STT → translate → render.
   */
  async _processBuffer() {
    if (this.audioBuffer.length === 0) return;

    const buffer = this.audioBuffer.slice();
    this.audioBuffer = [];
    this.bufferDuration = 0;

    try {
      // Step 1: Local STT (Whisper)
      // In production: send buffer to local Whisper server via WebSocket
      const transcript = await this._performSTT(buffer);
      if (!transcript) return;

      // Step 2: Local translate
      const translated = await this.translateFn(transcript, this.srcLang, this.tgtLang);

      // Step 3: Emit subtitle
      if (this.onSubtitle) {
        this.onSubtitle({
          original: transcript,
          translated,
          srcLang: this.srcLang,
          tgtLang: this.tgtLang,
          timestamp: Date.now(),
        });
      }

      this.lastSubtitleTime = Date.now();

    } catch (err) {
      console.error('Subtitle processing error:', err);
    }
  }

  /**
   * STT stub — connect to local Whisper in production.
   */
  async _performSTT(_audioBuffer) {
    // Stub: in production, encode buffer to WAV/Opus and send to
    // local Whisper server for transcription
    return null;
  }

  /** Stop the subtitle engine. */
  stop() {
    this.isActive = false;
    // Disconnect audio nodes to prevent memory leaks
    if (this.processor) {
      try { this.processor.disconnect(); } catch { /* already disconnected */ }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* already disconnected */ }
      this.sourceNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* already disconnected */ }
      this.analyser = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.audioBuffer = [];
    console.log('🎬 Subtitle engine stopped');
  }

  /** Toggle subtitles on/off. */
  toggle() {
    this.isActive = !this.isActive;
    return this.isActive;
  }
}

// ── K5.5: Call History ──

class CallHistory {
  static entries = [];

  static addEntry(entry) {
    CallHistory.entries.unshift({
      ...entry,
      id: `hist_${Date.now()}`,
    });

    // Keep last 100 entries
    if (CallHistory.entries.length > 100) {
      CallHistory.entries = CallHistory.entries.slice(0, 100);
    }

    console.log(`📋 Call history: ${entry.direction} ${entry.type} (${formatDuration(entry.duration)})`);
  }

  static getEntries(filter = 'all') {
    if (filter === 'all') return CallHistory.entries;
    return CallHistory.entries.filter(e => {
      switch (filter) {
        case 'missed': return e.endReason === 'no_answer' && e.direction === 'incoming';
        case 'incoming': return e.direction === 'incoming';
        case 'outgoing': return e.direction === 'outgoing';
        default: return true;
      }
    });
  }

  static getMissedCount() {
    return CallHistory.entries.filter(e =>
      e.endReason === 'no_answer' && e.direction === 'incoming'
    ).length;
  }
}

// ── K5.6: Picture-in-Picture (Desktop) ──

class PictureInPicture {
  /**
   * Enter PiP mode with the remote video.
   * Desktop: frameless always-on-top mini-window
   */
  static async enter(videoElement) {
    try {
      if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
        await videoElement.requestPictureInPicture();
        console.log('🖼️ Entered Picture-in-Picture');
        return true;
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
    return false;
  }

  static async exit() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return true;
      }
    } catch (err) {
      console.error('PiP exit error:', err);
    }
    return false;
  }

  static isActive() {
    return !!document.pictureInPictureElement;
  }
}

// ── Utility ──

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Exports ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CallManager,
    SubtitleEngine,
    CallHistory,
    PictureInPicture,
    CALL_STATES,
    ICE_SERVERS,
  };
}
