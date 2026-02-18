/**
 * Windy Pro - Renderer Application
 * 
 * Handles:
 * - WebSocket connection to Python backend
 * - State indicator updates (The Green Strobe)
 * - Transcript display
 * - User interactions
 */

class WindyApp {
  constructor() {
    // State
    this.isRecording = false;
    this.currentState = 'idle';
    this.transcript = [];
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;

    // Audio capture state (B2.6)
    this.mediaStream = null;
    this.audioContext = null;
    this.audioProcessor = null;
    this.audioSource = null;

    // DOM Elements
    this.stateIndicator = document.getElementById('stateIndicator');
    this.stateGlow = document.getElementById('stateGlow');
    this.stateLabel = document.getElementById('stateLabel');
    this.transcriptContent = document.getElementById('transcriptContent');
    this.transcriptScroll = document.getElementById('transcriptScroll');
    this.recordBtn = document.getElementById('recordBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.copyBtn = document.getElementById('copyBtn');
    this.pasteBtn = document.getElementById('pasteBtn');
    this.connectionDot = document.getElementById('connectionDot');
    this.connectionText = document.getElementById('connectionText');
    this.closeBtn = document.getElementById('closeBtn');
    this.minimizeBtn = document.getElementById('minimizeBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.audioMeterContainer = document.getElementById('audioMeterContainer');
    this.audioMeterBar = document.getElementById('audioMeterBar');

    // Initialize
    this.init();
  }

  async init() {
    this.settingsPanel = new SettingsPanel(this);
    this.vaultPanel = new VaultPanel(this);
    this.bindEvents();
    this.bindIPCEvents();
    await this.connect();

    // Check for crash recovery via Electron IPC
    if (window.windyAPI?.checkCrashRecovery) {
      const recovery = await window.windyAPI.checkCrashRecovery();
      if (recovery.found) {
        this.showRecoveryBanner(recovery.content);
      }
    }
  }

  /**
   * Bind DOM events
   */
  bindEvents() {
    // Record button
    this.recordBtn.addEventListener('click', () => this.toggleRecording());

    // Clear button
    this.clearBtn.addEventListener('click', () => this.clearTranscript());

    // Copy button
    this.copyBtn.addEventListener('click', () => this.copyTranscript());

    // Paste button
    this.pasteBtn.addEventListener('click', () => this.pasteTranscript());

    // Window controls
    this.closeBtn.addEventListener('click', () => window.close());
    this.minimizeBtn.addEventListener('click', () => {
      if (window.windyAPI?.minimize) {
        window.windyAPI.minimize();
      }
    });
    this.settingsBtn.addEventListener('click', () => {
      this.settingsPanel.toggle();
    });
  }

  /**
   * Bind IPC events from main process
   */
  bindIPCEvents() {
    // Toggle recording from hotkey
    window.windyAPI.onToggleRecording((isRecording) => {
      this.isRecording = isRecording;
      if (isRecording) {
        this.startRecording();
      } else {
        this.stopRecording();
      }
    });

    // Request transcript for paste
    window.windyAPI.onRequestTranscript(() => {
      const text = this.getFullTranscript();
      window.windyAPI.sendTranscriptForPaste(text);
    });

    // State change from main process
    window.windyAPI.onStateChange((state) => {
      this.setState(state);
    });
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    const config = await window.windyAPI.getServerConfig();
    const url = `ws://${config.host}:${config.port}`;

    this.setConnectionStatus('connecting');

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.setConnectionStatus('connected');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.setConnectionStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.setConnectionStatus('error');
      };

    } catch (error) {
      console.error('Connection failed:', error);
      this.setConnectionStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.setState(msg.state);
        break;

      case 'transcript':
        this.addTranscriptSegment(msg);
        break;

      case 'ack':
        console.log('Ack:', msg.action, msg.success);
        break;

      case 'error':
        console.error('Server error:', msg.message);
        break;

      case 'pong':
        // Latency check
        break;

      case 'recovery_available':
        // T19: Show crash recovery banner
        this.showRecoveryBanner(msg.text);
        break;
    }
  }

  /**
   * Send command to server
   */
  send(action, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, ...data }));
    }
  }

  /**
   * Set visual state
   */
  setState(state) {
    this.currentState = state;

    // Remove all state classes
    this.stateIndicator.classList.remove('idle', 'listening', 'buffering', 'error', 'injecting');

    // Add current state class
    this.stateIndicator.classList.add(state);

    // Update label
    const labels = {
      idle: 'Ready',
      listening: 'Recording',
      buffering: 'Processing',
      error: 'Error',
      injecting: 'Pasting'
    };
    this.stateLabel.textContent = labels[state] || state;

    // Update record button
    if (state === 'listening') {
      this.recordBtn.classList.add('recording');
      this.recordBtn.querySelector('.label').textContent = 'Stop';
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.label').textContent = 'Record';
    }
  }

  /**
   * Set connection status
   */
  setConnectionStatus(status) {
    this.connectionDot.classList.remove('connected', 'connecting', 'error');

    switch (status) {
      case 'connected':
        this.connectionDot.classList.add('connected');
        this.connectionText.textContent = 'Connected';
        break;
      case 'connecting':
        this.connectionDot.classList.add('connecting');
        this.connectionText.textContent = 'Connecting...';
        break;
      case 'disconnected':
        this.connectionText.textContent = 'Disconnected';
        break;
      case 'error':
        this.connectionDot.classList.add('error');
        this.connectionText.textContent = 'Connection Error';
        break;
    }
  }

  /**
   * Toggle recording state
   */
  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  /**
   * Start recording — captures audio and streams to server
   * INVARIANT: Green strobe ONLY shows after mic access confirmed (FEAT-053)
   */
  async startRecording() {
    this.isRecording = true;

    // Clear placeholder if exists
    const placeholder = this.transcriptContent.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    try {
      // Start audio capture FIRST — only show green strobe if mic works
      await this.startAudioCapture();
      this.send('start');
      this.setState('listening');
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      this.isRecording = false;
      this.setState('error');
      // Briefly show error then return to idle
      setTimeout(() => this.setState('idle'), 2000);
    }
  }

  /**
   * Stop recording
   */
  stopRecording() {
    this.isRecording = false;
    this.stopAudioCapture();
    this.send('stop');
    this.setState('idle');
  }

  // ═══════════════════════════════════════════════
  //  Audio Capture Pipeline (B2.6)
  // ═══════════════════════════════════════════════

  /**
   * FEAT-028: Request mic access via getUserMedia
   * FEAT-029: Create AudioContext + ScriptProcessorNode
   * FEAT-030: Downsample to 16kHz mono
   * FEAT-031: Convert Float32 → Int16 PCM
   * FEAT-032: Stream binary via WebSocket
   * FEAT-033: Feed audio level meter
   */
  async startAudioCapture() {
    // T20: Use saved mic device if set
    const audioConstraints = {
      channelCount: 1,          // mono
      sampleRate: 16000,        // Whisper expects 16kHz
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    if (window.windyAPI) {
      const settings = await window.windyAPI.getSettings();
      if (settings && settings.micDeviceId && settings.micDeviceId !== 'default') {
        audioConstraints.deviceId = { exact: settings.micDeviceId };
      }
    }

    // B2.6.1: Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });

    // B2.6.2: Create AudioContext at 16kHz
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Use AudioWorklet (modern) with ScriptProcessorNode fallback (deprecated)
    try {
      await this.audioContext.audioWorklet.addModule('audio-processor.js');
      this.audioProcessor = new AudioWorkletNode(this.audioContext, 'windy-audio-processor');
      this.audioProcessor.port.onmessage = (e) => {
        const int16Buffer = e.data;
        // B2.6.5: Stream as binary via WebSocket
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(int16Buffer);
        }
      };
      // Wire: mic → worklet
      this.audioSource.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);

      // Level meter via AnalyserNode (separate path)
      this._analyser = this.audioContext.createAnalyser();
      this._analyser.fftSize = 2048;
      this.audioSource.connect(this._analyser);
      this._levelInterval = setInterval(() => {
        const data = new Float32Array(this._analyser.fftSize);
        this._analyser.getFloatTimeDomainData(data);
        this.updateAudioMeter(data);
      }, 100);
    } catch (workletErr) {
      console.warn('[Audio] AudioWorklet unavailable, falling back to ScriptProcessorNode:', workletErr.message);
      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.audioProcessor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        this.updateAudioMeter(float32);
        const int16 = this.float32ToInt16(float32);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(int16.buffer);
        }
      };
      this.audioSource.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
    }

    // Show audio meter
    this.audioMeterContainer.style.display = 'block';
  }

  /**
   * Stop audio capture and release resources
   */
  stopAudioCapture() {
    // Disconnect audio nodes
    if (this._levelInterval) {
      clearInterval(this._levelInterval);
      this._levelInterval = null;
    }
    if (this._analyser) {
      this._analyser.disconnect();
      this._analyser = null;
    }
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      if (this.audioProcessor.onaudioprocess) this.audioProcessor.onaudioprocess = null;
      if (this.audioProcessor.port) this.audioProcessor.port.onmessage = null;
      this.audioProcessor = null;
    }
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    // Close AudioContext
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Release mic
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Hide audio meter
    this.audioMeterContainer.style.display = 'none';
    this.audioMeterBar.style.width = '0%';
  }

  /**
   * Convert Float32 audio samples to Int16 PCM
   * Whisper expects 16-bit PCM at 16kHz mono
   */
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /**
   * Update the audio level meter with current RMS level
   */
  updateAudioMeter(float32Array) {
    let sum = 0;
    for (let i = 0; i < float32Array.length; i++) {
      sum += float32Array[i] * float32Array[i];
    }
    const rms = Math.sqrt(sum / float32Array.length);
    // Scale RMS (0-1, usually 0-0.3) to percentage (0-100)
    const level = Math.min(100, rms * 300);
    this.audioMeterBar.style.width = `${level}%`;
  }

  /**
   * Add transcript segment to display
   * Appends text inline as one continuous block (not separate lines)
   */
  addTranscriptSegment(msg) {
    // Remove any existing partial text
    const existingPartial = this.transcriptContent.querySelector('.partial-text');
    if (existingPartial) {
      existingPartial.remove();
    }

    // Get or create the continuous transcript paragraph
    let para = this.transcriptContent.querySelector('.transcript-para');
    if (!para) {
      para = document.createElement('p');
      para.className = 'transcript-para';
      this.transcriptContent.appendChild(para);
    }

    if (msg.partial) {
      // Partial text — show in gray, will be replaced
      const span = document.createElement('span');
      span.className = 'partial-text';
      span.textContent = msg.text;
      para.appendChild(span);
    } else {
      // Final text — append permanently with a space separator
      if (para.childNodes.length > 0) {
        // Add space between segments
        const lastNode = para.lastChild;
        if (lastNode && !lastNode.classList?.contains('partial-text')) {
          para.appendChild(document.createTextNode(' '));
        }
      }
      const span = document.createElement('span');
      span.className = 'final-text';
      span.textContent = msg.text;
      para.appendChild(span);

      // Store non-partial segments
      this.transcript.push(msg);
    }

    // Auto-scroll to bottom
    this.transcriptScroll.scrollTop = this.transcriptScroll.scrollHeight;
  }

  /**
   * Format time in seconds to MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get full transcript text
   */
  getFullTranscript() {
    return this.transcript.map(s => s.text).join(' ');
  }

  /**
   * Clear transcript
   */
  clearTranscript() {
    this.transcript = [];
    this.transcriptContent.innerHTML = '<div class="placeholder">Press <kbd>Ctrl+Shift+Space</kbd> or click Record to start</div>';
  }

  /**
   * Copy transcript to clipboard
   */
  copyTranscript() {
    const text = this.getFullTranscript();
    if (text) {
      navigator.clipboard.writeText(text);
      // Visual feedback
      this.copyBtn.querySelector('.icon').textContent = '✓';
      setTimeout(() => {
        this.copyBtn.querySelector('.icon').textContent = '📋';
      }, 1000);
    }
  }

  /**
   * Paste transcript to cursor
   */
  async pasteTranscript() {
    const text = this.getFullTranscript();
    if (!text) return;
    
    window.windyAPI.sendTranscriptForPaste(text);
    
    // After paste: either clear or gray-out based on setting
    const settings = await window.windyAPI.getSettings();
    const clearOnPaste = settings && settings.clearOnPaste;
    
    if (clearOnPaste) {
      // Clear everything
      this.clearTranscript();
    } else {
      // Gray-out pasted text so user knows it's been sent
      const para = this.transcriptContent.querySelector('.transcript-para');
      if (para) {
        // Wrap all current content in a pasted-text container
        const pastedDiv = document.createElement('div');
        pastedDiv.className = 'pasted-text';
        // Move all children from para into pastedDiv
        while (para.firstChild) {
          pastedDiv.appendChild(para.firstChild);
        }
        para.appendChild(pastedDiv);
      }
      // Clear the transcript array so next recording starts fresh
      // but the grayed-out text remains visible for scrollback
      this.transcript = [];
    }
  }

  /**
   * T19: Show crash recovery banner
   * @param {string} text - Recovered transcript text
   */
  showRecoveryBanner(text) {
    if (!text || !text.trim()) return;

    const banner = document.createElement('div');
    banner.className = 'recovery-banner';
    banner.innerHTML = `
      <span class="recovery-icon">🔄</span>
      <span class="recovery-text">Previous session recovered</span>
      <button class="recovery-restore" id="recoveryRestore">Restore</button>
      <button class="recovery-dismiss" id="recoveryDismiss">✕</button>
    `;

    const window_el = document.querySelector('.window');
    window_el.insertBefore(banner, window_el.firstChild);

    banner.querySelector('#recoveryRestore').addEventListener('click', () => {
      // Split recovered text into segments and display
      const lines = text.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        this.addTranscriptSegment({
          text: line.trim(),
          is_partial: false,
          start_time: 0,
          end_time: 0
        });
      });
      banner.remove();
      if (window.windyAPI?.dismissCrashRecovery) window.windyAPI.dismissCrashRecovery();
    });

    banner.querySelector('#recoveryDismiss').addEventListener('click', () => {
      banner.remove();
      if (window.windyAPI?.dismissCrashRecovery) window.windyAPI.dismissCrashRecovery();
    });
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WindyApp();
});
