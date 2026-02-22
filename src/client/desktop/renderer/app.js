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
    this.livePreview = true;
    this.recordingStartedAt = null;
    this._sessionTimerInterval = null;
    this._sessionStartTime = null;

    // Cloud transcription state
    this.transcriptionEngine = 'local';  // 'local' | 'cloud' | 'smart'
    this.cloudUrl = 'wss://windypro.thewindstorm.uk';
    this.cloudWs = null;
    this.cloudToken = null;
    this._usingCloud = false;  // When smart mode, tracks if currently using cloud

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
    this.archiveRouteSelect = document.getElementById('archiveRouteSelect');
    this.connectionDot = document.getElementById('connectionDot');
    this.connectionText = document.getElementById('connectionText');
    this.archiveStatus = document.getElementById('archiveStatus');
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

    // Load UI behavior settings
    if (window.windyAPI?.getSettings) {
      const settings = await window.windyAPI.getSettings();
      this.livePreview = settings?.livePreview !== false;
      const route = settings?.archiveRouteToday || 'local';
      if (this.archiveRouteSelect) this.archiveRouteSelect.value = route;
      if (route === 'off') {
        this.setArchiveStatus('Archive off (today)', 'warn');
      } else if (route === 'local_dropbox') {
        this.setArchiveStatus('Route: Local + Dropbox', 'ok');
      } else if (route === 'local_google') {
        this.setArchiveStatus('Route: Local + Google', 'ok');
      } else {
        this.setArchiveStatus('Archive route: Local', 'ok');
      }

      // Load cloud transcription settings at startup
      // Key is 'engine' not 'transcriptionEngine' (matches saveSetting('engine', val))
      if (settings?.engine) this.transcriptionEngine = settings.engine;
      if (settings?.cloudUrl) this.cloudUrl = settings.cloudUrl;
      if (settings?.cloudToken) this.cloudToken = settings.cloudToken;
      if (settings?.cloudEmail) this.cloudEmail = settings.cloudEmail;
      if (settings?.cloudPassword) this.cloudPassword = settings.cloudPassword;
      console.log(`[Init] IPC: Engine=${this.transcriptionEngine}, CloudURL=${this.cloudUrl ? '✅' : '❌ empty'}`);
    }

    // Fallback: also check localStorage for cloud settings (always available)
    // localStorage ALWAYS overrides defaults since it reflects user's most recent Settings choice
    try {
      const lsEngine = localStorage.getItem('windy_engine');
      const lsCloudUrl = localStorage.getItem('windy_cloudUrl');
      const lsCloudToken = localStorage.getItem('windy_cloudToken');
      const lsCloudEmail = localStorage.getItem('windy_cloudEmail');
      const lsCloudPassword = localStorage.getItem('windy_cloudPassword');
      if (lsEngine) this.transcriptionEngine = lsEngine;
      if (lsCloudUrl) this.cloudUrl = lsCloudUrl;
      if (lsCloudToken) this.cloudToken = lsCloudToken;
      if (lsCloudEmail) this.cloudEmail = lsCloudEmail;
      if (lsCloudPassword) this.cloudPassword = lsCloudPassword;
      console.log(`[Init] Final: Engine=${this.transcriptionEngine}, CloudToken=${this.cloudToken ? '✅' : '❌'}, CloudURL=${this.cloudUrl ? '✅' : '❌ empty'}`);
    } catch (_) { }

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

    // Today archive route
    this.archiveRouteSelect?.addEventListener('change', () => {
      const route = this.archiveRouteSelect.value;
      if (window.windyAPI?.updateSettings) {
        window.windyAPI.updateSettings({ archiveRouteToday: route });
      }
      if (route === 'off') {
        this.setArchiveStatus('Archive off (today)', 'warn');
      } else if (route === 'local_dropbox') {
        this.setArchiveStatus('Route: Local + Dropbox', 'ok');
      } else if (route === 'local_google') {
        this.setArchiveStatus('Route: Local + Google', 'ok');
      } else {
        this.setArchiveStatus('Archive route: Local', 'ok');
      }
    });

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

    // Request transcript for paste (global hotkey path)
    // Reuse pasteTranscript() so behavior matches clicking the Paste button:
    // - sends current transcript
    // - then clear/gray-out based on setting
    window.windyAPI.onRequestTranscript(() => {
      this.pasteTranscript();
    });

    // State change from main process
    window.windyAPI.onStateChange((state) => {
      this.setState(state);
    });

    // Archive result badge updates
    window.windyAPI.onArchiveResult?.((res) => {
      const route = this.archiveRouteSelect?.value || 'local';
      if (res?.ok) {
        if (route === 'local_dropbox') {
          if (res?.cloud?.dropbox?.ok) {
            this.setArchiveStatus('Archived local ✓ · Dropbox ✓', 'ok');
          } else {
            this.setArchiveStatus('Archived local ✓ · Dropbox failed', 'warn');
          }
        } else if (route === 'local_google') {
          if (res?.cloud?.google?.ok) {
            this.setArchiveStatus('Archived local ✓ · Google ✓', 'ok');
          } else {
            this.setArchiveStatus('Archived local ✓ · Google failed', 'warn');
          }
        } else {
          this.setArchiveStatus('Archived local ✓', 'ok');
        }
      } else if (res?.reason === 'skipped') {
        this.setArchiveStatus('Archive skipped', 'warn');
      } else {
        this.setArchiveStatus('Archive failed', 'error');
      }
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
        const parsed = JSON.parse(event.data);
        console.error('[WS] Received:', parsed.type, parsed.text || '');
        this.handleMessage(parsed);
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
      this.showReconnectToast(`Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), delay);
    } else {
      this.showReconnectToast('Connection lost. Please restart.', true);
    }
  }

  showReconnectToast(message, persistent = false) {
    const toast = document.getElementById('reconnectToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    toast.classList.add('visible');
    if (!persistent) {
      clearTimeout(this._reconnectToastTimer);
      this._reconnectToastTimer = setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
      }, 5000);
    }
  }

  hideReconnectToast() {
    const toast = document.getElementById('reconnectToast');
    if (toast) {
      toast.classList.remove('visible');
      setTimeout(() => { toast.style.display = 'none'; }, 300);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.setState(msg.state);
        // Update model badge on loading state
        if (msg.state === 'loading' && msg.message) {
          this.updateModelBadge(null, true, msg.message);
        }
        break;

      case 'transcript':
        console.error('[handleMessage] transcript:', msg.text, 'partial:', msg.partial);
        this.addTranscriptSegment(msg);
        break;

      case 'ack':
        console.log('Ack:', msg.action, msg.success);
        // Update model badge from start ack
        if (msg.action === 'start' && msg.model) {
          this.updateModelBadge(msg.model);
        }
        // Update model badge from config ack
        if (msg.action === 'config' && msg.applied?.model_reloaded) {
          this.updateModelBadge(msg.applied.model);
        }
        if (msg.action === 'stop' && msg.success && msg.transcript && window.windyAPI?.archiveTranscript) {
          const route = this.archiveRouteSelect?.value || 'local';
          if (route === 'off') {
            this.setArchiveStatus('Archive off (today)', 'warn');
            this.recordingStartedAt = null;
            break;
          }
          const endedAt = new Date().toISOString();
          window.windyAPI.archiveTranscript({
            text: msg.transcript,
            startedAt: this.recordingStartedAt,
            endedAt,
            route
          });
          this.recordingStartedAt = null;
        }
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

      case 'performance':
        this.handlePerformanceFeedback(msg);
        break;
    }
  }

  /**
   * Send command to server
   */
  send(action, data = {}) {
    const ws = this.getActiveWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, ...data }));
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

    // Session timer management
    if (state === 'listening') {
      this.startSessionTimer();
    } else if (state === 'idle' || state === 'error') {
      this.stopSessionTimer();
    }

    // In strobe-only mode, reveal accumulated text when recording cycle finishes
    if (!this.livePreview && state === 'idle') {
      this.renderStoredTranscript();
    }

    // Update record button
    if (state === 'listening') {
      this.recordBtn.classList.add('recording');
      this.recordBtn.querySelector('.label').textContent = 'Stop';
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.label').textContent = 'Record';
    }
  }

  startSessionTimer() {
    this._sessionStartTime = Date.now();
    const timerEl = document.getElementById('sessionTimer');
    if (!timerEl) return;
    timerEl.textContent = '00:00';
    timerEl.style.display = 'inline';
    if (this._sessionTimerInterval) clearInterval(this._sessionTimerInterval);
    this._sessionTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._sessionStartTime) / 1000);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  stopSessionTimer() {
    if (this._sessionTimerInterval) {
      clearInterval(this._sessionTimerInterval);
      this._sessionTimerInterval = null;
    }
    const timerEl = document.getElementById('sessionTimer');
    if (timerEl) timerEl.style.display = 'none';
  }

  updateWordCount() {
    const wordCountEl = document.getElementById('wordCount');
    if (!wordCountEl) return;
    const text = this.transcript.map(t => t.text).join(' ');
    const count = text.trim() ? text.trim().split(/\s+/).length : 0;
    wordCountEl.textContent = count > 0 ? `${count} word${count !== 1 ? 's' : ''}` : '';
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

  setArchiveStatus(text, level = 'ok') {
    if (!this.archiveStatus) return;
    this.archiveStatus.textContent = text;
    this.archiveStatus.classList.remove('ok', 'warn', 'error');
    this.archiveStatus.classList.add(level);
  }

  /**
   * Update model badge in status bar
   */
  updateModelBadge(modelName, loading = false, message = '') {
    const badge = document.getElementById('modelBadge');
    if (!badge) return;
    // Use engine-aware icon
    const icon = this._usingCloud ? '☁️🔒' : this.transcriptionEngine === 'cloud' ? '☁️🔒' : this.transcriptionEngine === 'smart' ? '🧠' : '🏠';
    if (loading) {
      badge.textContent = `${icon} ${message || 'Loading...'}`;
      badge.classList.add('loading');
    } else {
      badge.textContent = `${icon} ${modelName || 'unknown'}`;
      badge.classList.remove('loading');
    }
  }

  /**
   * Handle runtime performance feedback from server
   */
  handlePerformanceFeedback(msg) {
    const badge = document.getElementById('modelBadge');
    if (!badge) return;

    // Skip local performance badge updates when cloud is active
    if (this._usingCloud) {
      badge.textContent = '☁️🔒 cloud ✅';
      badge.classList.remove('loading');
      return;
    }

    const engineIcon = '🏠';

    if (msg.status === 'slow') {
      badge.textContent = `${engineIcon} ${msg.model} ⚠️ slow`;
      badge.classList.add('loading');
      badge.title = `Performance ratio: ${msg.ratio}x (>1.0 = too slow)`;

      // Smart mode: auto-switch to cloud if struggling for 2+ chunks
      if (this.transcriptionEngine === 'smart' && !this._usingCloud && this.cloudUrl) {
        this._usingCloud = true;
        this.connectCloudWS().then(() => {
          badge.textContent = `☁️🔒 cloud ✅`;
          badge.classList.remove('loading');
          this.showReconnectToast('🧠 Smart mode: switched to cloud for better performance 🔒');
        }).catch(() => {
          this._usingCloud = false;
          this.showReconnectToast('⚠️ Cloud unavailable. Continuing local.');
        });
      } else if (msg.recommend) {
        this.showReconnectToast(`⚠️ "${msg.model}" is too slow for real-time. Try switching to "${msg.recommend}" in Settings.`);
      }
    } else {
      badge.textContent = `${engineIcon} ${msg.model} ✅`;
      badge.classList.remove('loading');
      badge.title = `Performance ratio: ${msg.ratio}x (keeping up)`;
    }
  }

  /**
   * Get the active WebSocket for audio streaming.
   * Routes to cloud WS when in cloud mode or smart mode with cloud active.
   */
  getActiveWs() {
    if (this.transcriptionEngine === 'cloud' || (this.transcriptionEngine === 'smart' && this._usingCloud)) {
      // Try cloud WS, fall back to local if not connected
      if (this.cloudWs && this.cloudWs.readyState === WebSocket.OPEN) {
        return this.cloudWs;
      }
      // Cloud not available — fall back to local silently
      return this.ws;
    }
    return this.ws;
  }

  /**
   * Get the HTTPS API base URL from the WSS cloud URL
   */
  get cloudApiBase() {
    if (!this.cloudUrl) return '';
    return this.cloudUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
  }

  /**
   * Refresh cloud token by re-authenticating before WS connection
   */
  async refreshCloudToken() {
    if (!this.cloudToken || !this.cloudApiBase) return;
    try {
      // Try token refresh first
      const res = await fetch(this.cloudApiBase + '/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.cloudToken })
      });
      if (res.ok) {
        const data = await res.json();
        this.cloudToken = data.token;
        console.log('[Cloud] Token refreshed ✅');
        return;
      }
    } catch (_) { }
    console.warn('[Cloud] Token refresh failed, using existing token');
  }

  /**
   * Connect to cloud transcription WebSocket
   */
  async connectCloudWS() {
    if (!this.cloudUrl) throw new Error('No cloud URL configured');

    // Step 1: Get a fresh token via REST login (if we have email/password)
    if (this.cloudEmail && this.cloudPassword) {
      try {
        const apiBase = this.cloudUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
        const res = await fetch(apiBase + '/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: this.cloudEmail, password: this.cloudPassword })
        });
        if (res.ok) {
          const data = await res.json();
          this.cloudToken = data.token;
          console.log('[Cloud] Got fresh token via REST login');
          if (window.windyAPI) {
            window.windyAPI.updateSettings({ cloudToken: data.token });
          }
        }
      } catch (e) {
        console.warn('[Cloud] REST login failed (CORS?), using stored token:', e.message);
      }
    }

    if (!this.cloudToken) {
      throw new Error('No cloud token available. Please sign in first.');
    }

    // Step 2: Connect WS with token as query param (Veron 1 protocol)
    return new Promise((resolve, reject) => {
      const baseUrl = this.cloudUrl.replace(/\/$/, '') + '/ws/transcribe';
      const url = baseUrl + '?token=' + encodeURIComponent(this.cloudToken);
      console.log(`[Cloud] Connecting to ${baseUrl} (with token query param)`);
      this.cloudWs = new WebSocket(url);
      this.cloudWs.binaryType = 'arraybuffer';
      let startSent = false;
      let resolved = false;

      this.cloudWs.onopen = () => {
        console.log('[Cloud] WebSocket opened');
      };

      this.cloudWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('[Cloud] ← ' + msg.type + ':', JSON.stringify(msg).substring(0, 200));

          if (msg.type === 'transcript') {
            // Cloud uses 'is_partial', local uses 'partial' — normalize
            if (msg.is_partial !== undefined && msg.partial === undefined) {
              msg.partial = msg.is_partial;
            }
            this.handleMessage(msg);
          } else if (msg.type === 'state') {
            // After receiving welcome state, send start command
            if (!startSent && (msg.state === 'idle' || msg.authenticated)) {
              startSent = true;
              console.log('[Cloud] Got welcome, sending start...');
              this.cloudWs.send(JSON.stringify({ action: 'start' }));
            }
            // When server confirms listening, resolve
            if (msg.state === 'listening' && !resolved) {
              resolved = true;
              console.log('[Cloud] Server is listening — ready for audio ✅');
              resolve();
            }
          } else if (msg.type === 'ack') {
            // Some server versions send ack instead of state:listening
            if (!resolved) {
              resolved = true;
              console.log('[Cloud] Server acknowledged start ✅');
              resolve();
            }
          } else if (msg.type === 'error') {
            console.error('[Cloud] Error:', msg.message);
            if (!resolved) {
              resolved = true;
              reject(new Error(msg.message));
            }
          }
        } catch (_) {
          // Binary data — ignore
        }
      };

      this.cloudWs.onerror = (err) => {
        console.error('[Cloud] WebSocket error:', err);
        if (!resolved) { resolved = true; reject(err); }
      };

      this.cloudWs.onclose = (event) => {
        console.log(`[Cloud] Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
        if (this._cloudPingInterval) {
          clearInterval(this._cloudPingInterval);
          this._cloudPingInterval = null;
        }
        this.cloudWs = null;
        this._usingCloud = false;
        if (!resolved) { resolved = true; reject(new Error(`Cloud WS closed: ${event.code}`)); }
      };

      // Keepalive pings to prevent Cloudflare tunnel from dropping idle WS
      this._cloudPingInterval = setInterval(() => {
        if (this.cloudWs?.readyState === WebSocket.OPEN) {
          this.cloudWs.send(JSON.stringify({ action: 'ping' }));
        }
      }, 15000);

      // Timeout — 5 seconds
      setTimeout(() => {
        if (this.cloudWs?.readyState !== WebSocket.OPEN) {
          this.cloudWs?.close();
          reject(new Error('Cloud connection timed out'));
        }
      }, 5000);
    });
  }

  /**
   * Disconnect cloud WebSocket
   */
  disconnectCloudWS() {
    if (this.cloudWs) {
      try {
        this.cloudWs.send(JSON.stringify({ action: 'stop' }));
      } catch (_) { }
      this.cloudWs.close();
      this.cloudWs = null;
      this._usingCloud = false;
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

    // Lock transcript editing during recording
    this.transcriptContent.contentEditable = 'false';

    // Clear placeholder if exists
    const placeholder = this.transcriptContent.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    try {
      // Reload cloud settings from localStorage (they may have been saved after init)
      const lsToken = localStorage.getItem('windy_cloudToken');
      const lsUrl = localStorage.getItem('windy_cloudUrl');
      const lsEngine = localStorage.getItem('windy_engine');
      if (lsToken) this.cloudToken = lsToken;
      if (lsUrl) this.cloudUrl = lsUrl;
      if (lsEngine) this.transcriptionEngine = lsEngine;

      // If cloud mode, attempt cloud WS connection first
      // Use default URL if not explicitly set
      if (this.transcriptionEngine === 'cloud' && !this.cloudUrl) {
        this.cloudUrl = 'wss://windypro.thewindstorm.uk';
      }
      console.warn(`[Record] engine=${this.transcriptionEngine}, cloudUrl="${this.cloudUrl}", cloudToken=${this.cloudToken ? 'exists' : 'MISSING'}`);
      if (this.transcriptionEngine === 'cloud' && this.cloudUrl && this.cloudUrl.startsWith('wss://')) {
        try {
          await this.connectCloudWS();
          this._usingCloud = true;
          this.updateModelBadge('cloud', false);
        } catch (err) {
          console.warn('[Cloud] Connection failed, falling back to local:', err.message);
          this._usingCloud = false;
          this.showReconnectToast('⚠️ Cloud unavailable — using local transcription.');
        }
      } else if (this.transcriptionEngine === 'cloud') {
        // No cloud URL set — use local with a hint
        this.showReconnectToast('☁️ Cloud mode selected but no URL configured. Using local.');
      }

      // Start audio capture FIRST — only show green strobe if mic works
      await this.startAudioCapture();
      this.recordingStartedAt = new Date().toISOString();

      // Verify cloud WS is still alive after audio capture started
      if (this._usingCloud) {
        if (this.cloudWs && this.cloudWs.readyState === WebSocket.OPEN) {
          console.log('[Cloud] ✅ WS still open after audio capture started — streaming to cloud');
        } else {
          console.warn('[Cloud] ⚠️ WS closed during audio setup — falling back to local');
          this._usingCloud = false;
          this.send('start');
        }
      } else {
        this.send('start');
      }
      this.setState('listening');
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      this.recordingStartedAt = null;
      this.isRecording = false;
      this.setState('error');
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

    // Enable transcript editing after stop
    if (this.transcript.length > 0 || this.transcriptContent.textContent.trim()) {
      this.transcriptContent.contentEditable = 'true';
    }
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
        // B2.6.5: Stream as binary via active WebSocket (local or cloud)
        const activeWs = this.getActiveWs();
        if (activeWs && activeWs.readyState === WebSocket.OPEN) {
          activeWs.send(int16Buffer);
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
        const activeWs = this.getActiveWs();
        if (activeWs && activeWs.readyState === WebSocket.OPEN) {
          activeWs.send(int16.buffer);
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
   * Rebuild transcript paragraph from stored final segments.
   */
  renderStoredTranscript() {
    const placeholder = this.transcriptContent.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    // Remove transient partial text
    const existingPartial = this.transcriptContent.querySelector('.partial-text');
    if (existingPartial) existingPartial.remove();

    let para = this.transcriptContent.querySelector('.transcript-para');
    if (!para) {
      para = document.createElement('p');
      para.className = 'transcript-para';
      this.transcriptContent.appendChild(para);
    }

    // Keep any already-pasted archive blocks; rebuild only final live text spans
    const pastedBlocks = Array.from(para.querySelectorAll('.pasted-text'));
    para.innerHTML = '';
    pastedBlocks.forEach(block => para.appendChild(block));

    this.transcript.forEach((segment, idx) => {
      if (para.childNodes.length > 0) para.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'final-text';
      span.textContent = segment.text;
      para.appendChild(span);
    });

    this.transcriptScroll.scrollTop = this.transcriptScroll.scrollHeight;
  }

  /**
   * Add transcript segment to display
   * Appends text inline as one continuous block (not separate lines)
   */
  addTranscriptSegment(msg) {
    console.error('[addTranscript] text:', msg.text, 'partial:', msg.partial, 'livePreview:', this.livePreview, 'state:', this.currentState);
    // Always retain final segments for copy/paste reliability
    if (!msg.partial) {
      this.transcript.push(msg);
    }

    // In strobe-only mode, suppress live rendering while recording/buffering
    if (!this.livePreview && (this.currentState === 'listening' || this.currentState === 'buffering')) {
      if (!msg.partial) this.updateWordCount();
      return;
    }

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
        const lastNode = para.lastChild;
        if (lastNode && !lastNode.classList?.contains('partial-text')) {
          para.appendChild(document.createTextNode(' '));
        }
      }
      const span = document.createElement('span');
      span.className = 'final-text';
      span.textContent = msg.text;
      para.appendChild(span);
      this.updateWordCount();
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
    // If user has edited the transcript via contentEditable, read from DOM
    if (this.transcriptContent.isContentEditable) {
      return this.transcriptContent.textContent.trim();
    }
    return this.transcript.map(s => s.text).join(' ');
  }

  /**
   * Clear transcript
   */
  clearTranscript() {
    this.transcript = [];
    this.transcriptContent.innerHTML = `<div class="placeholder">
      <div style="margin-bottom:8px;font-weight:600;opacity:0.9;">⌨️ Keyboard Shortcuts</div>
      <div style="margin:4px 0;"><kbd>Ctrl+Shift+Space</kbd> — <span style="color:#22C55E;font-weight:600;">Start</span> recording</div>
      <div style="margin:4px 0;"><kbd>Ctrl+Shift+Space</kbd> — <span style="color:#EF4444;font-weight:600;">Stop</span> recording</div>
      <div style="margin:4px 0;"><kbd>Ctrl+Shift+V</kbd> — <span style="color:#4ECDC4;font-weight:600;">Paste</span> transcript to cursor</div>
      <div style="margin:4px 0;"><kbd>Ctrl+Shift+W</kbd> — <span style="color:#F7DC6F;font-weight:600;">Show / Hide</span> app window</div>
    </div>`;
    this.transcriptContent.contentEditable = 'false';
    this.updateWordCount();
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
      // === CLEAR MODE ===
      // Reset everything — transcript array, DOM, contentEditable, word count
      this.clearTranscript();
    } else {
      // === GRAY MODE ===
      // Gray-out pasted text so user knows it's been sent
      const para = this.transcriptContent.querySelector('.transcript-para');
      if (para) {
        const pastedDiv = document.createElement('div');
        pastedDiv.className = 'pasted-text';
        while (para.firstChild) {
          pastedDiv.appendChild(para.firstChild);
        }
        para.appendChild(pastedDiv);
      }
      // Clear transcript array so next recording starts fresh
      // but grayed-out text remains visible for scrollback
      this.transcript = [];
      // Disable editing — paste is a session boundary
      this.transcriptContent.contentEditable = 'false';
      this.updateWordCount();
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
