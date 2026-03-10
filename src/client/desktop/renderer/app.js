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
    this.transcriptionEngine = 'local';  // 'local' | 'cloud' | 'stream' | 'smart'

    // Engine name → model mapping (UI names → actual models)
    this._engineModelMap = {
      'local': null, // auto-detect
      'windytune': 'small', // auto-pilot: starts with small, auto-adjusts
      'windy-stt-nano': 'tiny', 'windy-stt-lite': 'small', 'windy-stt-core': 'base',
      'windy-stt-edge': 'medium', 'windy-stt-plus': 'large-v2', 'windy-stt-turbo': 'large-v3',
      'windy-stt-pro': 'large-v3-turbo',
      'windy-stt-nano-cpu': 'tiny', 'windy-stt-lite-cpu': 'small', 'windy-stt-core-cpu': 'base',
      'windy-stt-edge-cpu': 'medium', 'windy-stt-plus-cpu': 'large-v2', 'windy-stt-turbo-cpu': 'large-v3',
      'windy-stt-pro-cpu': 'large-v3-turbo',
      'windy-translate-spark': null, 'windy-translate-standard': null
    };

    // Web Speech API state (kept for future Chrome-tab relay)
    this.speechRecognition = null;
    this._streamingText = '';
    this._interimText = '';

    // API-based engine state
    this._apiMediaRecorder = null;
    this._apiAudioChunks = [];
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
    this.archiveOpenBtn = document.getElementById('archiveOpenBtn');
    this.archiveChangeBtn = document.getElementById('archiveChangeBtn');
    this.archivePathLabel = document.getElementById('archivePathLabel');
    this.connectionDot = document.getElementById('connectionDot');
    this.connectionText = document.getElementById('connectionText');
    this.archiveStatus = document.getElementById('archiveStatus');
    this.closeBtn = document.getElementById('closeBtn');
    this.minimizeBtn = document.getElementById('minimizeBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.audioMeterContainer = document.getElementById('audioMeterContainer');
    this.audioMeterBar = document.getElementById('audioMeterBar');

    // Live transcript debounce (100ms = max 10 updates/sec)
    this._lastTranscriptUpdate = 0;
    this._transcriptUpdateTimer = null;

    // Screen reader live region
    this._srAnnouncer = document.getElementById('srAnnouncer');
    if (!this._srAnnouncer) {
      this._srAnnouncer = document.createElement('div');
      this._srAnnouncer.id = 'srAnnouncer';
      this._srAnnouncer.setAttribute('role', 'status');
      this._srAnnouncer.setAttribute('aria-live', 'polite');
      this._srAnnouncer.className = 'sr-only';
      document.body.appendChild(this._srAnnouncer);
    }

    // Cloud Sync (H4)
    this.cloudSync = typeof WindySync !== 'undefined' ? new WindySync(this) : null;

    // Initialize
    this.init();
  }

  async init() {
    // ── Strand I: Effects Engine (pure observer, zero impact on recording) ──
    // MUST be initialized BEFORE SettingsPanel so settings can wire up to it
    try {
      this.effectsEngine = typeof EffectsEngine !== 'undefined' ? new EffectsEngine() : null;
      this.widgetEngine = typeof WidgetEngine !== 'undefined' ? new WidgetEngine() : null;
    } catch (_) {
      this.effectsEngine = null;
      this.widgetEngine = null;
    }

    this.settingsPanel = new SettingsPanel(this);
    this.vaultPanel = new VaultPanel(this);
    this.historyPanel = new HistoryPanel(this);
    this.translatePanel = typeof TranslatePanel !== 'undefined' ? new TranslatePanel(this) : null;
    window._translatePanel = this.translatePanel; // Expose for inline TTS onclick
    this.bindEvents();
    this.bindIPCEvents();

    // ── Crash Recovery Detection (Repair 1.1) ──
    if (window.windyAPI?.checkCrashRecovery) {
      try {
        const recovery = await window.windyAPI.checkCrashRecovery();
        if (recovery.found && recovery.content) {
          const wordCount = recovery.content.trim().split(/\s+/).length;
          this._showRecoveryBanner(recovery.content, wordCount);
        }
      } catch (e) {
        console.warn('[CrashRecovery] Check failed:', e.message);
      }
    }

    // First-run wizard (v2 — 6-step onboarding)
    const wizard = new SetupWizard(this);
    wizard.show();  // Will no-op if already completed

    // What's New popup (shows once per version)
    const changelog = new ChangelogPopup();
    changelog.show();

    // Only auto-connect to local backend if a local engine is selected
    // Cloud/WindyTune engines don't need the Python backend at startup
    const startupEngine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'windytune';
    const needsLocalBackend = !['cloud', 'windytune'].includes(startupEngine);
    if (needsLocalBackend) {
      await this.connect();
    } else {
      // Show "Connected" in status bar without attempting WebSocket
      this.setConnectionStatus('connected');
    }

    // Load UI behavior settings
    if (window.windyAPI?.getSettings) {
      const settings = await window.windyAPI.getSettings();
      this.livePreview = settings?.livePreview !== false;
      const route = settings?.archiveRouteToday || 'local';
      if (this.archiveRouteSelect) this.archiveRouteSelect.value = route;
      this._setArchiveRouteStatus(route);

      // Show archive path
      this._archiveFolder = settings?.archiveFolder || null;
      this._updateArchivePathLabel();

      // ── Dynamic Keyboard Shortcuts on main screen ──
      this._populateShortcutDisplay(settings?.hotkeys);

      // Load cloud transcription settings at startup
      // Key is 'engine' not 'transcriptionEngine' (matches saveSetting('engine', val))
      if (settings?.engine) this.transcriptionEngine = settings.engine;
      if (settings?.cloudUrl) this.cloudUrl = settings.cloudUrl;
      if (settings?.cloudToken) this.cloudToken = settings.cloudToken;
      if (settings?.cloudEmail) this.cloudEmail = settings.cloudEmail;
      if (settings?.cloudPassword) this.cloudPassword = settings.cloudPassword;
      console.log(`[Init] IPC: Engine=${this.transcriptionEngine}, CloudURL=${this.cloudUrl ? '✅' : '❌ empty'}`);

      // Show current engine/model in status bar badge on startup
      const savedModel = settings?.model || localStorage.getItem('windy_model') || 'small';
      const engineName = this.transcriptionEngine || 'local';
      if (['groq', 'openai', 'deepgram', 'cloud', 'stream'].includes(engineName)) {
        this.updateModelBadge(engineName, false);
      } else {
        this.updateModelBadge(savedModel, false);
      }
    }

    // Font size: apply saved preference
    if (window.windyAPI?.getFontSize) {
      const fontSize = await window.windyAPI.getFontSize();
      this._applyFontSize(fontSize);
    }

    // Restore saved theme
    const savedTheme = localStorage.getItem('windy_theme') || 'dark';
    document.body.classList.toggle('light-theme', savedTheme === 'light');

    // Quick theme toggle button in title bar
    const themeBtn = document.getElementById('themeQuickToggle');
    if (themeBtn) {
      themeBtn.textContent = savedTheme === 'light' ? '\u2600\ufe0f' : '\ud83c\udf19';
      themeBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-theme');
        const newTheme = isLight ? 'light' : 'dark';
        localStorage.setItem('windy_theme', newTheme);
        themeBtn.textContent = isLight ? '\u2600\ufe0f' : '\ud83c\udf19';
        // Sync settings dropdown if open
        const themeSelect = document.querySelector('#themeToggle');
        if (themeSelect) themeSelect.value = newTheme;
      });
    }
    if (window.windyAPI?.onFontSizeChange) {
      window.windyAPI.onFontSizeChange((percent) => this._applyFontSize(percent));
    }

    // Keyboard shortcuts: Ctrl+= (zoom in), Ctrl+- (zoom out), Ctrl+0 (reset)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this._changeFontSize(10);
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        this._changeFontSize(-10);
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        this._setFontSize(100);
      }
    });

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

    // History button
    const histBtn = document.getElementById('historyBtn');
    if (histBtn) {
      histBtn.addEventListener('click', () => {
        if (!this.historyPanel) this.historyPanel = new HistoryPanel(this);
        this.historyPanel.toggle();
      });
    }

    // Translate discovery menu
    const translateBtn = document.getElementById('translateBtn');
    const translateMenu = document.getElementById('translateMenu');
    const openStudio = document.getElementById('openStudio');
    const openQuickTranslate = document.getElementById('openQuickTranslate');

    if (translateBtn && translateMenu) {
      translateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const visible = translateMenu.style.display !== 'none';
        translateMenu.style.display = visible ? 'none' : 'block';
      });

      // Open Translate Studio (embedded panel)
      openStudio?.addEventListener('click', () => {
        translateMenu.style.display = 'none';
        if (this.translatePanel) this.translatePanel.toggle();
      });

      // Open Quick Translate (popup window)
      openQuickTranslate?.addEventListener('click', () => {
        translateMenu.style.display = 'none';
        if (window.windyAPI?.openMiniTranslate) {
          window.windyAPI.openMiniTranslate();
        } else if (window.electronAPI?.send) {
          window.electronAPI.send('open-mini-translate');
        }
      });

      // Click outside to close menu
      document.addEventListener('click', () => {
        translateMenu.style.display = 'none';
      });
    }

    // Paste button
    this.pasteBtn.addEventListener('click', () => this.pasteTranscript());

    // Today archive route
    this.archiveRouteSelect?.addEventListener('change', () => {
      const route = this.archiveRouteSelect.value;
      if (window.windyAPI?.updateSettings) {
        window.windyAPI.updateSettings({ archiveRouteToday: route });
      }
      this._setArchiveRouteStatus(route);
    });

    // Archive folder buttons
    this.archiveOpenBtn?.addEventListener('click', () => {
      if (window.windyAPI?.openArchiveFolder) {
        window.windyAPI.openArchiveFolder();
      }
    });

    this.archiveChangeBtn?.addEventListener('click', async () => {
      if (window.windyAPI?.chooseArchiveFolder) {
        const result = await window.windyAPI.chooseArchiveFolder();
        if (result && !result.canceled && result.path) {
          this._archiveFolder = result.path;
          this._updateArchivePathLabel();
        }
      }
    });

    this.archivePathLabel?.addEventListener('click', () => {
      if (window.windyAPI?.openArchiveFolder) {
        window.windyAPI.openArchiveFolder();
      }
    });

    // Window controls
    this.closeBtn.addEventListener('click', () => window.close());

    // ═══ SFX Volume Slider ═══
    this._sfxVolume = parseInt(localStorage.getItem('windy_sfxVolume') || '70', 10) / 100;
    const sfxIcon = document.getElementById('sfxVolumeIcon');
    const sfxPopup = document.getElementById('sfxVolumePopup');
    const sfxSlider = document.getElementById('sfxVolumeSlider');
    const sfxLabel = document.getElementById('sfxVolumeLabel');
    if (sfxSlider) {
      sfxSlider.value = Math.round(this._sfxVolume * 100);
      if (sfxLabel) sfxLabel.textContent = `${sfxSlider.value}%`;
      if (sfxIcon) sfxIcon.textContent = this._sfxVolume === 0 ? '🔇' : '🔊';
    }
    if (sfxIcon && sfxPopup) {
      sfxIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = sfxPopup.classList.toggle('visible');
        if (isVisible) {
          const rect = sfxIcon.getBoundingClientRect();
          sfxPopup.style.left = `${rect.left + rect.width / 2 - 24}px`;
          sfxPopup.style.top = `${rect.top - 130}px`;
        }
      });
      document.addEventListener('click', (e) => {
        if (!sfxPopup.contains(e.target) && e.target !== sfxIcon) {
          sfxPopup.classList.remove('visible');
        }
      });
    }
    if (sfxSlider) {
      sfxSlider.addEventListener('input', () => {
        const val = parseInt(sfxSlider.value, 10);
        this._sfxVolume = val / 100;
        if (sfxLabel) sfxLabel.textContent = `${val}%`;
        if (sfxIcon) sfxIcon.textContent = val === 0 ? '🔇' : '🔊';
        localStorage.setItem('windy_sfxVolume', String(val));
        // Sync with EffectsEngine
        if (this.effectsEngine) this.effectsEngine.setMasterVolume(val / 100);
      });
    }
    this.minimizeBtn.addEventListener('click', () => {
      if (window.windyAPI?.minimize) {
        window.windyAPI.minimize();
      }
    });

    // Maximize / Restore toggle
    const maxBtn = document.getElementById('maximizeBtn');
    if (maxBtn) {
      maxBtn.addEventListener('click', async () => {
        if (window.windyAPI?.isMaximized) {
          const isMax = await window.windyAPI.isMaximized();
          if (isMax) {
            window.windyAPI.unmaximize();
            maxBtn.textContent = '□';
            maxBtn.title = 'Maximize';
          } else {
            window.windyAPI.maximize();
            maxBtn.textContent = '⧉';
            maxBtn.title = 'Restore';
          }
        }
      });
    }
    this.settingsBtn.addEventListener('click', () => {
      this.settingsPanel.toggle();
    });

    // Controls collapse toggle — chevron is in the status bar
    const collapsible = document.getElementById('controlsCollapsible');
    const chevron = document.getElementById('controlsChevron');
    const miniRec = document.getElementById('miniRecordBtn');
    if (chevron && collapsible) {
      // Restore saved state
      const saved = localStorage.getItem('windy_controlsCollapsed') === 'true';
      if (saved) {
        collapsible.classList.add('collapsed');
        chevron.classList.add('collapsed');
        if (miniRec) miniRec.style.display = '';
      }

      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = collapsible.classList.toggle('collapsed');
        chevron.classList.toggle('collapsed', isCollapsed);
        if (miniRec) miniRec.style.display = isCollapsed ? '' : 'none';
        localStorage.setItem('windy_controlsCollapsed', isCollapsed);
      });

      // Mini record button
      if (miniRec) {
        miniRec.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleRecording();
        });
      }
    }
  }

  /**
   * Bind IPC events from main process
   */
  bindIPCEvents() {
    // Toggle recording from hotkey
    window.windyAPI.onToggleRecording((isRecording) => {
      // Mark as hotkey-triggered so toggleRecording skips the blip
      // (AudioContext creation steals window focus on Linux)
      this._hotkeyTriggered = true;
      this.toggleRecording();
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

    window.windyAPI.onOpenVault?.(() => {
      this.vaultPanel.toggle();
    });

    window.windyAPI.onOpenHistory?.(() => {
      this.historyPanel.toggle();
    });

    // Auto-update toast (non-intrusive)
    window.windyAPI.onUpdateToast?.((payload) => {
      this.showReconnectToast(payload.message);
    });

    // Archive result badge updates
    window.windyAPI.onArchiveResult?.((res) => {
      const route = this.archiveRouteSelect?.value || 'local';
      if (res?.ok) {
        if (route === 'cloud') {
          this.setArchiveStatus(res?.cloud?.ok ? 'Cloud ✓' : 'Cloud upload failed', res?.cloud?.ok ? 'ok' : 'warn');
        } else if (route === 'local_cloud') {
          const cloudOk = res?.cloud?.ok;
          this.setArchiveStatus(cloudOk ? 'Archived local ✓ · Cloud ✓' : 'Archived local ✓ · Cloud failed', cloudOk ? 'ok' : 'warn');
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
        this.hideBackendErrorOverlay();
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
      // Subtle status bar update instead of yellow banner
      const connText = document.getElementById('connectionText');
      if (connText) connText.textContent = `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`;
      setTimeout(() => this.connect(), delay);
    } else {
      // Don't show blocking overlay — just update status bar
      const connText = document.getElementById('connectionText');
      if (connText) connText.textContent = 'Local engine unavailable';
      this.setConnectionStatus('disconnected');
    }
  }

  /**
   * Show full-screen error overlay when backend is unreachable
   */
  showBackendErrorOverlay() {
    // Don't create duplicates
    if (document.querySelector('.backend-error-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'backend-error-overlay';
    overlay.innerHTML = `
      <div class="backend-error-card">
        <span class="error-icon">⚠️</span>
        <h2>AI Engine Not Available</h2>
        <p>The Python AI backend could not be reached.<br>
           Run the installer again to set up the engine, or check that the backend is running.</p>
        <button class="retry-btn" id="backendRetryBtn">Retry Connection</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#backendRetryBtn').addEventListener('click', () => {
      this.reconnectAttempts = 0;
      this.hideBackendErrorOverlay();
      this.connect();
    });
  }

  /**
   * Remove the backend error overlay (e.g. on successful reconnection)
   */
  hideBackendErrorOverlay() {
    const overlay = document.querySelector('.backend-error-overlay');
    if (overlay) overlay.remove();
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
        console.debug('[handleMessage] transcript:', msg.text, 'partial:', msg.partial);
        this.addTranscriptSegment(msg);
        break;

      case 'ack':
        console.log('Ack:', msg.action, msg.success);
        // Update model badge from start ack — but preserve engine name if custom engine selected
        if (msg.action === 'start' && msg.model) {
          const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
          const isCustomEngine = this._engineModelMap && engine in this._engineModelMap && engine !== 'local';
          this.updateModelBadge(isCustomEngine ? engine : msg.model);
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
    try {
      const ws = this.getActiveWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, ...data }));
      }
    } catch (err) {
      console.warn('[IPC] send() failed:', err.message);
    }
  }

  /**
   * Set visual state
   */
  setState(state) {
    this.currentState = state;

    // Stop processing beep loop when no longer processing
    if (state !== 'buffering') {
      try { clearInterval(this._processEffectInterval); } catch (_) { }
    }

    // Remove all state classes
    this.stateIndicator.classList.remove('idle', 'listening', 'buffering', 'error', 'injecting');

    // Add current state class
    this.stateIndicator.classList.add(state);

    // Reset voice-driven strobe overrides when leaving listening state
    if (state !== 'listening' && this.stateGlow) {
      this.stateGlow.style.animation = '';
      this.stateGlow.style.transform = '';
      this.stateGlow.style.opacity = '';
    }

    // Update label
    const labels = {
      idle: 'Ready',
      listening: 'Recording',
      buffering: 'Processing',
      error: 'Error',
      injecting: 'Pasting'
    };
    this.stateLabel.textContent = labels[state] || state;

    // Screen reader announcement
    const announcements = {
      listening: 'Recording started',
      buffering: 'Processing transcription',
      idle: 'Ready',
      error: 'An error occurred',
      injecting: 'Pasting transcript'
    };
    if (this._srAnnouncer && announcements[state]) {
      this._srAnnouncer.textContent = announcements[state];
    }

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
    const miniRec = document.getElementById('miniRecordBtn');
    if (state === 'listening') {
      this.recordBtn.classList.add('recording');
      this.recordBtn.querySelector('.label').textContent = 'Stop';
      if (miniRec) { miniRec.classList.add('recording'); miniRec.textContent = '⏹️'; }
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.label').textContent = 'Record';
      if (miniRec) { miniRec.classList.remove('recording'); miniRec.textContent = '🎤'; }
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
   * Crash Recovery Banner — shown when orphaned windy_session.txt is found
   * Offers Restore (loads text into transcript) or Dismiss (deletes file)
   */
  _showRecoveryBanner(content, wordCount) {
    const banner = document.createElement('div');
    banner.id = 'crashRecoveryBanner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: linear-gradient(135deg, #0f172a 0%, #1a2332 100%);
      border-bottom: 2px solid #22C55E;
      padding: 14px 20px; display: flex; align-items: center;
      gap: 12px; animation: slideDown 0.3s ease-out;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    `;
    banner.innerHTML = `
      <span style="font-size:20px">🔄</span>
      <span style="flex:1;color:#E2E8F0;font-size:13px">
        <strong>Previous session recovered</strong> — ${wordCount.toLocaleString()} words found
      </span>
      <button id="recoveryRestore" style="
        background:#22C55E; color:#0B0F1A; border:none; padding:6px 14px;
        border-radius:6px; font-weight:600; font-size:12px; cursor:pointer;
      ">Restore</button>
      <button id="recoveryDismiss" style="
        background:transparent; color:#94A3B8; border:1px solid #334155;
        padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer;
      ">Dismiss</button>
    `;

    // Add slide animation
    const style = document.createElement('style');
    style.textContent = `@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`;
    document.head.appendChild(style);
    document.body.appendChild(banner);

    // Restore: load recovered text into transcript
    document.getElementById('recoveryRestore').addEventListener('click', () => {
      if (this.transcriptContent) {
        const pre = document.createElement('div');
        pre.className = 'transcript-segment recovered';
        pre.innerHTML = `<span style="color:#22C55E;font-size:11px;opacity:0.7">🔄 Recovered session:</span><br>${content.replace(/\n/g, '<br>')}`;
        this.transcriptContent.appendChild(pre);
        this.transcriptContent.scrollTop = this.transcriptContent.scrollHeight;
      }
      this.transcript.push({ text: content, recovered: true, timestamp: Date.now() });
      banner.remove();
      // Don't delete the file yet — let the user copy/save first
      console.log('[CrashRecovery] Text restored to transcript area');
    });

    // Dismiss: delete recovery file and remove banner
    document.getElementById('recoveryDismiss').addEventListener('click', async () => {
      if (window.windyAPI?.dismissCrashRecovery) {
        await window.windyAPI.dismissCrashRecovery();
      }
      banner.remove();
      console.log('[CrashRecovery] Dismissed and file deleted');
    });
  }

  _setArchiveRouteStatus(route) {
    if (route === 'off') {
      this.setArchiveStatus('Archive off (today)', 'warn');
    } else if (route === 'cloud') {
      this.setArchiveStatus('Route: Windy Pro Cloud', 'ok');
    } else if (route === 'local_cloud') {
      this.setArchiveStatus('Route: Local + Cloud', 'ok');
    } else {
      this.setArchiveStatus('Archive route: Local', 'ok');
    }
  }

  /**
   * Populate the keyboard shortcuts display on the main screen
   * Shows actual user hotkeys, with 'custom' badge if changed from defaults
   */
  _populateShortcutDisplay(hotkeys) {
    const defaults = {
      toggleRecording: 'CommandOrControl+Shift+Space',
      pasteTranscript: 'CommandOrControl+Shift+V',
      showHide: 'CommandOrControl+Shift+W',
      quickTranslate: 'CommandOrControl+Shift+T'
    };

    const actual = {
      toggleRecording: hotkeys?.toggleRecording || defaults.toggleRecording,
      pasteTranscript: hotkeys?.pasteTranscript || defaults.pasteTranscript,
      showHide: hotkeys?.showHide || defaults.showHide,
      quickTranslate: hotkeys?.quickTranslate || defaults.quickTranslate
    };

    // Format accelerator string for display
    const fmt = (accel) => accel
      .replace(/CommandOrControl/gi, 'Ctrl')
      .replace(/\+/g, '+');

    const customBadge = ' <span style="color:#A78BFA;font-size:10px;font-weight:600;vertical-align:middle;margin-left:4px;background:rgba(167,139,250,0.15);padding:1px 5px;border-radius:4px;">✦ custom</span>';

    const rows = [
      {
        id: 'shortcutRow_toggle',
        key: 'toggleRecording',
        label: '<span style="color:#22C55E;font-weight:600;">Start</span> / <span style="color:#EF4444;font-weight:600;">Stop</span> recording'
      },
      {
        id: 'shortcutRow_paste',
        key: 'pasteTranscript',
        label: '<span style="color:#4ECDC4;font-weight:600;">Paste</span> transcript to cursor'
      },
      {
        id: 'shortcutRow_showHide',
        key: 'showHide',
        label: '<span style="color:#F7DC6F;font-weight:600;">Show / Hide</span> app window'
      },
      {
        id: 'shortcutRow_quickTranslate',
        key: 'quickTranslate',
        label: '<span style="color:#6366F1;font-weight:600;">Quick Translate</span> pop-up'
      }
    ];

    for (const row of rows) {
      const el = document.getElementById(row.id);
      if (!el) continue;
      const isCustom = actual[row.key] !== defaults[row.key];
      el.innerHTML = `<kbd>${fmt(actual[row.key])}</kbd> — ${row.label}${isCustom ? customBadge : ''}`;
    }
  }

  _updateArchivePathLabel() {
    if (!this.archivePathLabel) return;
    if (this._archiveFolder) {
      // Show shortened path (last 2 segments)
      const parts = this._archiveFolder.replace(/\\/g, '/').split('/');
      const short = parts.length > 2 ? '…/' + parts.slice(-2).join('/') : this._archiveFolder;
      this.archivePathLabel.textContent = short;
      this.archivePathLabel.title = this._archiveFolder;
    } else {
      this.archivePathLabel.textContent = '~/Documents/WindyProArchive';
      this.archivePathLabel.title = 'Default: ~/Documents/WindyProArchive';
    }
  }

  /**
   * Update model badge in status bar
   */
  updateModelBadge(modelName, loading = false, message = '') {
    const badge = document.getElementById('modelBadge');
    if (!badge) return;

    // Model sizes for user reference
    const modelSizes = {
      'tiny': '0.07GB', 'tiny.en': '0.07GB',
      'base': '0.14GB', 'base.en': '0.14GB',
      'small': '0.5GB', 'small.en': '0.5GB',
      'medium': '1.5GB', 'medium.en': '1.5GB',
      'large': '3.1GB', 'large-v1': '3.1GB', 'large-v2': '3.1GB', 'large-v3': '3.1GB',
      'turbo': '1.6GB'
    };

    // Determine the active engine (from localStorage or instance)
    const activeEngine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'local';

    // Check if a custom named engine is selected (not 'local', 'cloud', or cloud API engines)
    const cloudEngines = ['stream', 'cloud', 'smart'];
    const isCustomEngine = this._engineModelMap && activeEngine in this._engineModelMap && activeEngine !== 'local';
    const isCloudEngine = cloudEngines.includes(activeEngine);

    // Engine-specific icons
    const engineIcons = {
      stream: '🎙️', cloud: '☁️🔒', smart: '🧠',
      'windy-stt-nano': '⚡', 'windy-stt-lite': '⚡', 'windy-stt-core': '⚡', 'windy-stt-edge': '⚡', 'windy-stt-plus': '⚡', 'windy-stt-turbo': '⚡', 'windy-stt-pro': '⚡',
      'windy-stt-nano-cpu': '🛡️', 'windy-stt-lite-cpu': '🛡️', 'windy-stt-core-cpu': '🛡️', 'windy-stt-edge-cpu': '🛡️', 'windy-stt-plus-cpu': '🛡️', 'windy-stt-turbo-cpu': '🛡️', 'windy-stt-pro-cpu': '🛡️',
      'windy-translate-spark': '🌍', 'windy-translate-standard': '🌍'
    };

    if (loading) {
      const icon = engineIcons[activeEngine] || '🏠';
      badge.textContent = `${icon} ${message || 'Loading...'}`;
      badge.classList.add('loading');
      return;
    }

    // Cloud API engines — always show engine name
    if (isCloudEngine && !isCustomEngine) {
      const icon = engineIcons[activeEngine] || '☁️';
      badge.textContent = `${icon} ${activeEngine}`;
      badge.title = `Engine: ${activeEngine}`;
      badge.classList.remove('loading');
      return;
    }

    // Custom named engine (windy-stt-pro, windy-stt-core-cpu, etc.) — ALWAYS show engine name, never raw model
    if (isCustomEngine) {
      const icon = engineIcons[activeEngine] || '⚡';
      const engineModel = this._engineModelMap[activeEngine];
      const size = modelSizes[engineModel] || '';
      badge.textContent = size ? `${icon} ${activeEngine} (${size})` : `${icon} ${activeEngine}`;
      badge.title = size ? `Engine: ${activeEngine} (${size})` : `Engine: ${activeEngine}`;
      badge.classList.remove('loading');
      return;
    }

    // 'local' auto-detect — show whatever the Python server reports
    const icon = '🏠';
    const name = modelName || 'unknown';
    const size = modelSizes[name.toLowerCase()];
    badge.textContent = size ? `${icon} ${name} (${size})` : `${icon} ${name}`;
    badge.title = size ? `Model: ${name} (${size})` : `Model: ${name}`;
    badge.classList.remove('loading');
  }

  // ═══ Font Size Control ═══

  _applyFontSize(percent) {
    this._currentFontSize = percent;
    // Use Electron webFrame zoom for proper layout scaling (no cutoff)
    if (window.windyAPI?.setZoomFactor) {
      window.windyAPI.setZoomFactor(percent / 100);
    } else {
      // Fallback for non-Electron
      document.body.style.fontSize = `${percent}%`;
    }
  }

  _changeFontSize(delta) {
    const current = this._currentFontSize || 100;
    this._setFontSize(current + delta);
  }

  _setFontSize(percent) {
    const clamped = Math.max(70, Math.min(150, percent));
    this._applyFontSize(clamped);
    if (window.windyAPI?.setFontSize) window.windyAPI.setFontSize(clamped);
    this.showReconnectToast(`🔤 Font size: ${clamped}%`);
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

    // Use engine name if a custom engine is selected
    const activeEngine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'local';
    const isCustomEngine = this._engineModelMap && activeEngine in this._engineModelMap && activeEngine !== 'local';
    const displayName = isCustomEngine ? activeEngine : msg.model;
    const engineIcons = {
      'windy-stt-nano': '⚡', 'windy-stt-lite': '⚡', 'windy-stt-core': '⚡', 'windy-stt-edge': '⚡', 'windy-stt-plus': '⚡', 'windy-stt-turbo': '⚡', 'windy-stt-pro': '⚡',
      'windy-stt-nano-cpu': '🛡️', 'windy-stt-lite-cpu': '🛡️', 'windy-stt-core-cpu': '🛡️', 'windy-stt-edge-cpu': '🛡️', 'windy-stt-plus-cpu': '🛡️', 'windy-stt-turbo-cpu': '🛡️', 'windy-stt-pro-cpu': '🛡️',
      'windy-translate-spark': '🌍', 'windy-translate-standard': '🌍'
    };
    const engineIcon = engineIcons[activeEngine] || '🏠';

    if (msg.status === 'slow') {
      badge.textContent = `${engineIcon} ${displayName} ⚠️ slow`;
      badge.classList.add('loading');
      badge.title = `Performance ratio: ${msg.ratio}x (>1.0 = too slow)`;

      // Track slow streaks for WindyTune auto-pilot
      this._slowStreak = (this._slowStreak || 0) + 1;

      // WindyTune auto-pilot: auto-downgrade after 3 consecutive slow chunks
      if (activeEngine === 'windytune' && this._slowStreak >= 3) {
        const modelOrder = ['large-v3', 'turbo', 'medium.en', 'medium', 'small', 'base', 'tiny'];
        const currentModel = this._engineModelMap?.[activeEngine] || msg.model;
        const idx = modelOrder.indexOf(currentModel);
        if (idx >= 0 && idx < modelOrder.length - 1) {
          const nextModel = modelOrder[idx + 1];
          this._engineModelMap['windytune'] = nextModel;
          localStorage.setItem('windy_model', nextModel);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send('config', { model: nextModel });
          }
          this.showReconnectToast(`🌪️ WindyTune: Auto-switched to ${nextModel} for better speed`);
          this._slowStreak = 0;
        }
      }

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
      } else {
        // Actionable performance suggestions
        const suggestions = [];
        const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';
        if (recordingMode !== 'batch') {
          suggestions.push('Switch to Batch mode for best accuracy');
        }
        const modelSizeMB = { 'large-v3': 2945, 'windy-stt-pro': 2945, 'turbo': 1544, 'windy-stt-turbo': 1544, 'medium': 1444, 'windy-stt-edge': 1444, 'small': 140, 'windy-stt-lite': 140, 'base': 462, 'windy-stt-core': 462, 'tiny': 73, 'windy-stt-nano': 73 };
        const currentModelSize = modelSizeMB[msg.model] || 0;
        if (currentModelSize > 500) {
          suggestions.push('Try Windy STT Core (462MB, balanced)');
        } else if (currentModelSize > 150) {
          suggestions.push('Try Windy STT Lite (140MB) for faster dictation');
        }
        const tip = suggestions.length > 0 ? ` 💡 ${suggestions[0]}` : '';
        this.showReconnectToast(`⚠️ ${displayName} is struggling.${tip}`);
      }
    } else {
      badge.textContent = `${engineIcon} ${displayName} ✅`;
      badge.classList.remove('loading');
      badge.title = `Performance ratio: ${msg.ratio}x (keeping up)`;
      this._slowStreak = 0; // Reset slow streak on good performance
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

  // ═══════════════════════════════════════════════
  //  Web Speech API (Stream Engine)
  // ═══════════════════════════════════════════════

  /**
   * Start streaming speech recognition using the Web Speech API (Google).
   * Provides real-time interim + final results with excellent accuracy.
   */
  async startStreamRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showReconnectToast('⚠️ Web Speech API not supported. Falling back to local.');
      this.transcriptionEngine = 'local';
      return this.startRecording();
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang = 'en-US';
    this.speechRecognition.maxAlternatives = 1;
    this._streamingText = '';
    this._interimText = '';

    this.speechRecognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Append final results
      if (finalTranscript) {
        this._streamingText += finalTranscript;
        // Add as a transcript segment for copy/paste/archive
        this.transcript.push({
          text: finalTranscript.trim(),
          partial: false,
          start: 0,
          end: 0,
          confidence: 1.0,
          words: []
        });
        this.updateWordCount();
      }
      this._interimText = interimTranscript;

      // Render the full text + interim
      this._renderStreamTranscript();
    };

    this.speechRecognition.onerror = (event) => {
      console.error('[Stream] Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        this.showReconnectToast('🚫 Microphone access denied.');
        this.stopStreamRecognition();
      } else if (event.error === 'no-speech') {
        // Normal — just means silence. Don't stop.
      } else if (event.error === 'network') {
        this.showReconnectToast('⚠️ Network error — check internet connection.');
      }
    };

    this.speechRecognition.onend = () => {
      // Auto-restart if still recording (Web Speech API stops after silence)
      if (this.isRecording) {
        try {
          this.speechRecognition.start();
        } catch (e) {
          console.warn('[Stream] Could not restart:', e);
        }
      }
    };

    try {
      this.speechRecognition.start();
      this.isRecording = true;
      this.recordingStartedAt = new Date().toISOString();
      this.transcriptContent.contentEditable = 'false';

      // Clear placeholder
      const placeholder = this.transcriptContent.querySelector('.placeholder');
      if (placeholder) placeholder.remove();

      this.setState('listening');
      this.updateModelBadge('stream', false);
      console.log('[Stream] Web Speech API started — streaming to Google');
    } catch (err) {
      console.error('[Stream] Failed to start:', err);
      this.showReconnectToast('⚠️ Could not start speech recognition. Falling back to local.');
      this.transcriptionEngine = 'local';
      this.startRecording();
    }
  }

  /**
   * Stop streaming speech recognition
   */
  stopStreamRecognition() {
    if (this.speechRecognition) {
      this.isRecording = false; // Set BEFORE abort so onend doesn't restart
      try {
        this.speechRecognition.stop();
      } catch (_) { }
      this.speechRecognition = null;
    }
    this._interimText = '';
    // Final render without interim text
    this._renderStreamTranscript();
    this.setState('idle');

    // Enable editing
    if (this.transcript.length > 0 || this.transcriptContent.textContent.trim()) {
      this.transcriptContent.contentEditable = 'true';
    }

    // Archive the transcript
    if (this._streamingText.trim() && window.windyAPI?.archiveTranscript) {
      const route = this.archiveRouteSelect?.value || 'local';
      if (route !== 'off') {
        window.windyAPI.archiveTranscript({
          text: this._streamingText.trim(),
          startedAt: this.recordingStartedAt,
          endedAt: new Date().toISOString(),
          route
        });
      }
    }
    this.recordingStartedAt = null;
  }

  /**
   * Render the stream transcript (final + interim) into the transcript area
   */
  _renderStreamTranscript() {
    // Remove placeholder
    const placeholder = this.transcriptContent.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    // Get or create paragraph
    let para = this.transcriptContent.querySelector('.transcript-para');
    if (!para) {
      para = document.createElement('p');
      para.className = 'transcript-para';
      this.transcriptContent.appendChild(para);
    }

    // Keep pasted blocks
    const pastedBlocks = Array.from(para.querySelectorAll('.pasted-text'));
    para.innerHTML = '';
    pastedBlocks.forEach(block => para.appendChild(block));

    // Add final text
    if (this._streamingText) {
      const finalSpan = document.createElement('span');
      finalSpan.className = 'final-text';
      finalSpan.textContent = this._streamingText;
      para.appendChild(finalSpan);
    }

    // Add interim text (gray, will be replaced)
    if (this._interimText) {
      const interimSpan = document.createElement('span');
      interimSpan.className = 'partial-text';
      interimSpan.style.opacity = '0.5';
      interimSpan.textContent = this._interimText;
      para.appendChild(interimSpan);
    }

    // Scroll to bottom
    this.transcriptScroll.scrollTop = this.transcriptScroll.scrollHeight;
  }

  // ═══════════════════════════════════════════════
  //  Batch Mode Recording
  // ═══════════════════════════════════════════════

  /**
   * Start batch recording — captures full audio, processes on stop.
   * Uses MediaRecorder for high-quality capture.
   */
  async startBatchRecording() {
    try {
      // 0. Feature gating — check tier limits
      let tierLimits = null;
      try {
        if (window.windyAPI?.getCurrentTier) {
          const tierInfo = await window.windyAPI.getCurrentTier();
          tierLimits = tierInfo?.limits;
          if (tierLimits && !tierLimits.batchMode) {
            this.showReconnectToast('⚡ Batch mode requires Pro. Upgrade in Settings → Your Plan.');
            // Fall through anyway — allow basic recording but with shorter limit
          }
          // Override max recording with tier limit
          if (tierLimits?.maxMinutes) {
            const currentMax = parseInt(localStorage.getItem('windy_maxRecordingMin') || '10');
            if (currentMax > tierLimits.maxMinutes) {
              localStorage.setItem('windy_maxRecordingMin', String(tierLimits.maxMinutes));
              this.showReconnectToast(`⚡ Free plan: max ${tierLimits.maxMinutes} min. Upgrade for 30 min.`);
            }
          }
        }
      } catch (_) { }

      // 1. Get mic access
      const audioConstraints = {
        channelCount: 1,
        sampleRate: 16000,
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // 2. Use MediaRecorder to capture full audio
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      this._batchRecorder = new MediaRecorder(stream, { mimeType });
      this._batchChunks = [];

      this._batchRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this._batchChunks.push(e.data);
      };

      // 3. Record continuously (timeslice = 1000ms for smooth data flow)
      this._batchRecorder.start(1000);
      this._batchStartTime = Date.now();

      // 3b. Video capture (if enabled in settings)
      this._videoRecorder = null;
      this._videoChunks = [];
      this._videoStream = null;

      // Show recording status badges
      const recStatus = document.getElementById('recordingStatus');
      const audioBadge = document.getElementById('audioBadge');
      const videoBadge = document.getElementById('videoBadge');
      if (recStatus) recStatus.style.display = 'flex';
      if (audioBadge) { audioBadge.classList.add('active'); audioBadge.textContent = '🎤 Audio ✓'; }

      try {
        let videoEnabled = false;
        if (window.windyAPI) {
          const settings = await window.windyAPI.getSettings();
          videoEnabled = !!settings?.saveVideo;
        }
        if (videoEnabled) {
          if (videoBadge) { videoBadge.style.display = 'inline-flex'; videoBadge.textContent = '🎬 Video…'; }
          const qualityMap = { '480p': { width: 640, height: 480 }, '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } };
          let videoQuality = '720p';
          if (window.windyAPI) {
            const settings = await window.windyAPI.getSettings();
            videoQuality = settings?.videoQuality || '720p';
          }
          const vq = qualityMap[videoQuality] || qualityMap['720p'];
          this._videoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: vq.width }, height: { ideal: vq.height }, frameRate: { ideal: 30 } }
          });

          // ═══ Camera resolution check: warn if hardware < requested ═══
          const vTrack = this._videoStream.getVideoTracks()[0];
          const actualSettings = vTrack?.getSettings();
          const actualW = actualSettings?.width || 0;
          const actualH = actualSettings?.height || 0;
          const requestedH = vq.height;
          if (actualH > 0 && actualH < requestedH) {
            // Camera hardware can't deliver what user selected
            const actualLabel = actualH >= 1080 ? '1080p' : actualH >= 720 ? '720p' : actualH >= 480 ? '480p' : actualH + 'p';
            console.warn(`[Video] Camera actual: ${actualW}x${actualH} (${actualLabel}), requested: ${videoQuality}`);
            this._showToast(`⚠️ Camera max: ${actualLabel} — recording at ${actualLabel} (you selected ${videoQuality})`, 'warning', 8000);
          } else if (actualH > 0) {
            const actualLabel = actualH >= 2160 ? '4K' : actualH >= 1080 ? '1080p' : actualH >= 720 ? '720p' : actualH >= 480 ? '480p' : actualH + 'p';
            console.log(`[Video] Camera confirmed: ${actualW}x${actualH} (${actualLabel})`);
          }

          // Mux audio tracks into video stream for perfect lip sync
          const combinedStream = new MediaStream([
            ...this._videoStream.getVideoTracks(),
            ...stream.getAudioTracks() // audio from mic stream captured earlier
          ]);
          const videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
              ? 'video/webm;codecs=vp8,opus'
              : 'video/webm';
          this._videoRecorder = new MediaRecorder(combinedStream, { mimeType: videoMime });
          this._videoRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this._videoChunks.push(e.data);
          };
          this._videoRecorder.start(1000);
          console.log('[Batch] Video recording started (' + videoQuality + ', ' + videoMime + ')');

          // Show independent video preview window and start frame forwarding
          if (window.windyAPI?.showVideoPreview) {
            window.windyAPI.showVideoPreview();
            this._startVideoFrameForwarding(this._videoStream);
            // Tell the preview we're recording
            if (window.windyAPI.sendRecordingState) {
              window.windyAPI.sendRecordingState('recording');
            }
          }

          // Update video badge to active
          if (videoBadge) { videoBadge.classList.add('active'); videoBadge.textContent = '🎬 Video ✓'; }
        }
      } catch (videoErr) {
        console.warn('[Batch] Video capture not available:', videoErr.message);
        // Show camera denial toast
        this.showReconnectToast('📹 Camera access denied — video won\'t be saved for this recording');
        // Mark video badge as failed
        if (videoBadge) {
          videoBadge.style.display = 'inline-flex';
          videoBadge.classList.add('failed');
          videoBadge.textContent = '🎬 Video ✗';
          videoBadge.title = videoErr.message;
        }
        this._videoRecorder = null;
        this._videoChunks = [];
        if (this._videoStream) {
          this._videoStream.getTracks().forEach(t => t.stop());
          this._videoStream = null;
        }
      }

      // 4. Set up max duration auto-stop (skip for clone_capture — unlimited)
      const currentRecMode = localStorage.getItem('windy_recordingMode') || 'batch';
      if (currentRecMode !== 'clone_capture') {
        const maxMin = parseInt(localStorage.getItem('windy_maxRecordingMin') || '10');
        this._batchMaxTimer = setTimeout(() => {
          this.showReconnectToast('⏰ Max recording time reached. Processing...');
          this.stopBatchRecording();
        }, maxMin * 60 * 1000);

        // 5. Warning at 30s before max
        if (maxMin * 60 > 30) {
          this._batchWarnTimer = setTimeout(() => {
            this.showReconnectToast(`⏰ ${maxMin} min limit in 30 seconds...`);
          }, (maxMin * 60 - 30) * 1000);
        }
      }

      // 5b. Voice level monitoring for mini widget strobe
      try {
        this._batchAudioCtx = new AudioContext();
        const source = this._batchAudioCtx.createMediaStreamSource(stream);
        this._batchAnalyser = this._batchAudioCtx.createAnalyser();
        this._batchAnalyser.fftSize = 256;
        source.connect(this._batchAnalyser);
        const dataArray = new Uint8Array(this._batchAnalyser.frequencyBinCount);

        const timeDomainData = new Uint8Array(this._batchAnalyser.fftSize);
        this._voiceLevelInterval = setInterval(() => {
          if (!this._batchAnalyser) return;
          this._batchAnalyser.getByteTimeDomainData(timeDomainData);
          // Calculate RMS from time domain (more reliable for voice)
          let sumSquares = 0;
          for (let i = 0; i < timeDomainData.length; i++) {
            const normalized = (timeDomainData[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / timeDomainData.length);
          // Amplify and clamp to 0-1
          const level = Math.min(rms * 4, 1.0);
          // Send to main process for mini widget
          if (window.windyAPI?.sendVoiceLevel) {
            window.windyAPI.sendVoiceLevel(level);
          }
          // Apply voice level to main app green strobe
          if (this.stateGlow && this.currentState === 'listening') {
            const glowOpacity = 0.15 + level * 0.7; // 0.15 base → up to 0.85 at peak
            const glowScale = 1.0 + level * 0.15;   // subtle size pulse
            this.stateGlow.style.opacity = glowOpacity;
            this.stateGlow.style.transform = `scale(${glowScale})`;
            this.stateGlow.style.animation = 'none'; // override CSS strobe — we're driving it live
          }
        }, 50); // 20 updates/sec for smooth strobe
      } catch (e) {
        console.warn('[Batch] Voice level monitor failed:', e.message);
      }

      // 6. UI state
      this.isRecording = true;
      this.setState('listening');
      this._batchStream = stream;
      this.recordingStartedAt = new Date().toISOString();
      this.transcriptContent.contentEditable = 'false';

      // Clear placeholder
      const placeholder = this.transcriptContent.querySelector('.placeholder');
      if (placeholder) placeholder.remove();

      // Show appropriate recording hint based on mode
      const recMode = localStorage.getItem('windy_recordingMode') || 'batch';
      if (recMode === 'clone_capture') {
        this.transcriptContent.innerHTML = '<p class="batch-recording-hint" style="text-align:center;padding:20px;">' +
          '<span style="font-size:24px;">🧬</span><br>' +
          '<span style="color:#22C55E;font-weight:700;">Clone Capture Active</span><br>' +
          '<span style="color:#888;font-size:12px;">Recording audio + video for digital twin archive<br>' +
          'No transcription model loaded — near-zero CPU<br>Unlimited recording</span></p>';
        this.updateModelBadge('🧬 clone capture', false);
      } else {
        this.transcriptContent.innerHTML = '<p class="batch-recording-hint" style="color:#888;text-align:center;padding:20px;">🎙️ Recording... text will appear when you stop</p>';
        // Show actual engine/model in badge during batch recording
        const batchEngine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'local';
        const batchModel = localStorage.getItem('windy_model') || 'small';
        if (['groq', 'openai', 'deepgram', 'cloud', 'stream'].includes(batchEngine)) {
          this.updateModelBadge(batchEngine, false);
        } else {
          this.updateModelBadge(batchModel, false);
        }
      }
      this.startSessionTimer();
      console.log('[Batch] Recording started');
    } catch (err) {
      console.warn('[Batch] Failed to start:', err.message || err);
      // Full cleanup on start failure
      clearTimeout(this._batchMaxTimer);
      clearTimeout(this._batchWarnTimer);
      if (this._batchStream) {
        this._batchStream.getTracks().forEach(t => t.stop());
        this._batchStream = null;
      }
      this._batchRecorder = null;
      this._batchChunks = [];
      this.isRecording = false;
      this.setState('idle');
      // Tell main process recording failed so it can sync state
      if (window.windyAPI?.notifyRecordingFailed) {
        window.windyAPI.notifyRecordingFailed();
      }
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.showReconnectToast('🚫 Microphone access denied. Check system permissions.');
      } else {
        this.showReconnectToast('⚠️ Could not access microphone.');
      }
    }
  }

  /**
   * Stop batch recording and send audio for processing.
   */
  async stopBatchRecording() {
    // Clear timers
    clearTimeout(this._batchMaxTimer);
    clearTimeout(this._batchWarnTimer);

    // Stop voice level monitoring
    if (this._voiceLevelInterval) {
      clearInterval(this._voiceLevelInterval);
      this._voiceLevelInterval = null;
    }
    if (this._batchAudioCtx) {
      try { this._batchAudioCtx.close(); } catch (_) { }
      this._batchAudioCtx = null;
      this._batchAnalyser = null;
    }

    this.isRecording = false;
    this.stopSessionTimer();

    if (!this._batchRecorder || this._batchRecorder.state === 'inactive') {
      this.setState('idle');
      return;
    }

    return new Promise((resolve) => {
      this._batchRecorder.onstop = async () => {
        // Stop mic
        if (this._batchStream) {
          this._batchStream.getTracks().forEach(t => t.stop());
          this._batchStream = null;
        }

        // Build audio blob
        const audioBlob = new Blob(this._batchChunks, { type: this._batchRecorder.mimeType });
        this._batchChunks = [];
        this._lastBatchBlob = audioBlob;  // Save for audio playback

        // Build video blob if video was captured
        let videoBlob = null;
        if (this._videoRecorder && this._videoChunks.length > 0) {
          try {
            if (this._videoRecorder.state !== 'inactive') {
              this._videoRecorder.stop();
            }
          } catch (_) { }
          videoBlob = new Blob(this._videoChunks, { type: this._videoRecorder?.mimeType || 'video/webm' });
          this._videoChunks = [];
          console.log(`[Batch] Video blob: ${(videoBlob.size / 1024).toFixed(0)}KB`);
        }
        // Stop video stream tracks
        if (this._videoStream) {
          this._videoStream.getTracks().forEach(t => t.stop());
          this._videoStream = null;
        }
        this._videoRecorder = null;
        this._lastVideoBlob = videoBlob;

        // Switch video preview to standby mode (don't hide — user may want it persistent)
        this._stopVideoFrameForwarding();
        if (window.windyAPI?.sendRecordingState) {
          window.windyAPI.sendRecordingState('standby');
        }

        // Hide recording status badges
        const recStatus = document.getElementById('recordingStatus');
        const audioBadge = document.getElementById('audioBadge');
        const videoBadge = document.getElementById('videoBadge');
        if (recStatus) recStatus.style.display = 'none';
        if (audioBadge) audioBadge.classList.remove('active', 'failed');
        if (videoBadge) { videoBadge.style.display = 'none'; videoBadge.classList.remove('active', 'failed'); }

        // Show processing state
        // ═══ Clone Capture mode: skip transcription, just archive ═══
        const currentMode = localStorage.getItem('windy_recordingMode') || 'batch';
        if (currentMode === 'clone_capture') {
          const durationSec = Math.round((Date.now() - (this._batchStartTime || Date.now())) / 1000);
          const durationStr = durationSec >= 3600
            ? `${Math.floor(durationSec / 3600)}h ${Math.floor((durationSec % 3600) / 60)}m`
            : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
          this.setState('idle');
          this.transcriptContent.innerHTML = `<div class="placeholder" style="text-align:center;">
            <div style="font-size:24px;margin-bottom:8px;">🧬</div>
            <div style="font-weight:700;margin-bottom:6px;">Clone Capture Complete</div>
            <div style="font-size:12px;opacity:0.8;">${durationStr} of audio${videoBlob ? ' + video' : ''} archived</div>
            <div style="font-size:11px;opacity:0.6;margin-top:4px;">Data saved to your Soul File archive for future processing</div>
          </div>`;
          // Archive the audio + video
          if (window.windyAPI?.archiveRecording) {
            try {
              const audioArr = await audioBlob.arrayBuffer();
              const payload = { audio: Array.from(new Uint8Array(audioArr)), mimeType: audioBlob.type };
              if (videoBlob) {
                const videoArr = await videoBlob.arrayBuffer();
                payload.video = Array.from(new Uint8Array(videoArr));
                payload.videoMimeType = videoBlob.type;
              }
              payload.mode = 'clone_capture';
              await window.windyAPI.archiveRecording(payload);
              console.log('[CloneCapture] Archived successfully:', durationStr);
            } catch (archErr) {
              console.warn('[CloneCapture] Archive error:', archErr.message);
            }
          }
          return;
        }

        // Show processing state (batch modes only)
        this.setState('buffering');
        // Strand I: trigger process effect (first beep + repeating loop)
        try {
          if (this.effectsEngine) this.effectsEngine.trigger('process');
          // Start repeating processing beep loop
          clearInterval(this._processEffectInterval);
          const processIntervalSec = parseInt(localStorage.getItem('windy_processInterval') || '10', 10);
          const processIntervalMs = Math.max(1000, processIntervalSec * 1000);
          this._processEffectInterval = setInterval(() => {
            try { if (this.effectsEngine) this.effectsEngine.trigger('process'); } catch (_) { }
          }, processIntervalMs);
        } catch (_) { }
        this.transcriptContent.innerHTML = '<p class="batch-processing-indicator"><span class="processing-spinner"></span> Processing your recording...<br><span style="font-size:12px;color:#888;">This may take a moment for longer recordings</span></p>';

        // Notify tray
        if (window.windyAPI?.notifyBatchProcessing) {
          try { window.windyAPI.notifyBatchProcessing(); } catch (_) { }
        }

        try {
          // Choose engine
          const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
          let result;

          // ═══ WindyTune: Time batch transcription for auto-tuning ═══
          const batchStartMs = Date.now();

          if (engine === 'local' || (this._engineModelMap && engine in this._engineModelMap)) {
            // Process locally via the Python WebSocket server (includes all named engines)
            result = await this._batchTranscribeLocal(audioBlob);
          } else if (engine === 'cloud') {
            // Use WindyPro Cloud batch endpoint
            result = await this._batchTranscribeCloud(audioBlob);
          } else if (engine === 'groq') {
            result = await this._transcribeWithApi('groq', localStorage.getItem('windy_groqApiKey'), audioBlob);
          } else if (engine === 'openai') {
            result = await this._transcribeWithApi('openai', localStorage.getItem('windy_openaiApiKey'), audioBlob);
          } else {
            // Unknown engine — default to local
            result = await this._batchTranscribeLocal(audioBlob);
          }

          // ═══ WindyTune: Auto-downgrade if batch took > 10s ═══
          const batchDuration = (Date.now() - batchStartMs) / 1000;
          console.log(`[Batch] Transcription completed in ${batchDuration.toFixed(1)}s`);

          if (engine === 'windytune' && batchDuration > 10) {
            const modelOrder = ['large-v3', 'turbo', 'medium.en', 'medium', 'small', 'base', 'tiny'];
            const currentModel = this._engineModelMap?.[engine] || localStorage.getItem('windy_model') || 'small';
            const idx = modelOrder.indexOf(currentModel);
            if (idx >= 0 && idx < modelOrder.length - 1) {
              const nextModel = modelOrder[idx + 1];
              this._engineModelMap['windytune'] = nextModel;
              localStorage.setItem('windy_model', nextModel);
              if (this.ws?.readyState === WebSocket.OPEN) {
                this.send('config', { model: nextModel });
              }
              this.showReconnectToast(`🌪️ WindyTune: ${batchDuration.toFixed(1)}s latency → switching from ${currentModel} to ${nextModel} for speed`);
            }
          }

          // Display polished result
          this._displayBatchResult(result);
        } catch (err) {
          console.error('[Batch] Transcription failed:', err);
          this.showReconnectToast(`⚠️ Processing failed: ${err.message}`);
          this.setState('error');
          setTimeout(() => this.setState('idle'), 3000);
        }

        resolve();
      };

      this._batchRecorder.stop();
    });
  }

  /**
   * Start forwarding video frames from the camera stream to the preview window.
   * Uses a hidden video + canvas to capture frames at low FPS (avoiding opening camera twice).
   */
  _startVideoFrameForwarding(videoStream) {
    this._stopVideoFrameForwarding(); // cleanup any existing

    const video = document.createElement('video');
    video.srcObject = videoStream;
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    document.body.appendChild(video);
    video.play().catch(() => { });

    // Wait for video metadata so we know the actual camera dimensions
    const startCapture = () => {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;

      // Send the real camera resolution to the preview window
      if (window.windyAPI?.sendVideoFrame) {
        // Use a special 'resolution' message
        window.windyAPI.sendVideoFrame('resolution:' + vw + 'x' + vh);
      }

      // Scale down to max 320px wide while preserving aspect ratio
      const scale = Math.min(320 / vw, 1);
      const cw = Math.round(vw * scale);
      const ch = Math.round(vh * scale);

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');

      this._frameCanvas = canvas;

      // Capture and send frames at ~10fps
      this._frameInterval = setInterval(() => {
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          ctx.drawImage(video, 0, 0, cw, ch);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          if (window.windyAPI?.sendVideoFrame) {
            window.windyAPI.sendVideoFrame(dataUrl);
          }
        }
      }, 100);
    };

    this._frameVideo = video;

    if (video.readyState >= video.HAVE_METADATA) {
      startCapture();
    } else {
      video.addEventListener('loadedmetadata', startCapture, { once: true });
    }
  }

  _stopVideoFrameForwarding() {
    if (this._frameInterval) {
      clearInterval(this._frameInterval);
      this._frameInterval = null;
    }
    if (this._frameVideo) {
      this._frameVideo.srcObject = null;
      this._frameVideo.remove();
      this._frameVideo = null;
    }
    this._frameCanvas = null;
  }

  /**
   * Upload audio blob to WindyPro Cloud batch endpoint.
   * Includes a 5-minute timeout for long recordings.
   */
  async _batchTranscribeLocal(audioBlob) {
    // Save audio blob to temp file, then use IPC to have main process
    // run ffmpeg + faster-whisper on it directly (avoids AudioContext crashes)
    try {
      // Convert blob to base64 and send to main process for transcription
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      // Use IPC to transcribe via main process (which has fs access)
      if (window.windyAPI?.batchTranscribeLocal) {
        const result = await window.windyAPI.batchTranscribeLocal(base64);
        return result || '';
      } else {
        throw new Error('Local batch transcription not available — update required');
      }
    } catch (err) {
      throw new Error(`Local batch failed: ${err.message}`);
    }
  }

  async _batchTranscribeCloud(audioBlob) {
    const token = this.cloudToken || localStorage.getItem('windy_cloudToken');
    const cloudUrl = (this.cloudUrl || localStorage.getItem('windy_cloudUrl') || 'https://windypro.thewindstorm.uk')
      .replace('wss://', 'https://');

    if (!token) {
      throw new Error('Not signed in to WindyPro Cloud. Open Settings to sign in.');
    }

    console.log(`[Batch] Uploading ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB to cloud`);

    // AbortController for timeout (5 min for long recordings)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      // Build query params for language & diarization
      const lang = localStorage.getItem('windy_language') || 'en';
      const diarize = localStorage.getItem('windy_diarize') === 'true';
      const params = new URLSearchParams({ language: lang });
      if (diarize) params.append('diarize', 'true');

      const response = await fetch(`${cloudUrl}/api/v1/transcribe/batch?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: audioBlob,
        signal: controller.signal
      });

      if (!response.ok) {
        const errRaw = await response.text();
        // Strip HTML error pages — show only meaningful message
        let errMsg = errRaw;
        if (errRaw.includes('<html') || errRaw.includes('<!DOCTYPE')) {
          const titleMatch = errRaw.match(/<title>([^<]+)<\/title>/i);
          errMsg = titleMatch ? titleMatch[1] : `HTTP ${response.status}`;
        }
        if (errMsg.length > 120) errMsg = errMsg.substring(0, 120) + '...';
        throw new Error(`Cloud error ${response.status}: ${errMsg}`);
      }

      const data = await response.json();
      return data.text || data.raw_text || '';
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Cloud processing timed out (5 min). Try a shorter recording or a different engine.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Display the polished batch transcription result.
   */
  async _displayBatchResult(text) {
    if (!text || !text.trim()) {
      this.transcriptContent.innerHTML = '<p style="color:#888;text-align:center;">No speech detected in recording.</p>';
      this.setState('idle');
      return;
    }

    // Split into paragraphs (respect existing line breaks, or add them every ~3 sentences)
    const paragraphs = text.split(/\n+/).filter(p => p.trim());

    // Build formatted HTML
    let html = '';
    paragraphs.forEach(p => {
      html += `<p class="transcript-para" style="margin:0 0 12px 0;line-height:1.5;">${p.trim()}</p>`;
    });

    this.transcriptContent.innerHTML = html;
    this.transcriptContent.contentEditable = 'true';

    // Add export buttons bar
    this._showExportButtons(text.trim());

    // Update transcript array for copy/paste
    this.transcript = [{ text: text.trim(), partial: false, start: 0, end: 0, confidence: 1, words: [] }];
    this.updateWordCount();
    this.setState('idle');

    // Auto-paste at cursor if enabled (default: ON)
    const autoPaste = localStorage.getItem('windy_autoPaste') !== 'false';
    if (autoPaste && text.trim() && window.windyAPI?.autoPasteText) {
      // Small delay to let processing UI finish
      setTimeout(async () => {
        try {
          // Sound feedback: use default beep only if effects engine is in default mode or unavailable
          const fxPasteMode = this.effectsEngine?._mode;
          if (!fxPasteMode || fxPasteMode === 'default' || fxPasteMode === 'silent') {
            this._playPasteBlip();
          }
          await window.windyAPI.autoPasteText(text.trim());
          // Strand I: trigger paste effect with word count for dynamic scaling
          try { if (this.effectsEngine) this.effectsEngine.trigger('paste', { wordCount: text.trim().split(/\s+/).length }); } catch (_) { }
          // Only clear if "Clear after paste" is checked (stored in electron-store, not localStorage)
          let clearAfterPaste = true;
          if (window.windyAPI?.getSettings) {
            try {
              const settings = await window.windyAPI.getSettings();
              clearAfterPaste = settings.clearOnPaste !== false;
            } catch (_) { }
          }
          if (clearAfterPaste) {
            this.clearTranscript();
          }
        } catch (err) {
          console.warn('[AutoPaste] Failed, use Ctrl+Shift+V to paste manually');
        }
      }, 500);
    }

    // Notify tray: batch complete
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (window.windyAPI?.notifyBatchComplete) {
      try { window.windyAPI.notifyBatchComplete(wordCount); } catch (_) { }
    }

    // Capture timestamp NOW before async saves — it gets nulled later
    const savedStartedAt = this.recordingStartedAt;

    // Save to history
    this._saveToHistory(text.trim(), wordCount, savedStartedAt);

    // Opt-in analytics (never transcript content)
    this._sendAnalytics({ wordCount });

    // Save audio recording if enabled
    if (this._lastBatchBlob) {
      await this._saveAudioRecording(this._lastBatchBlob, savedStartedAt);
    }

    // Save video recording if captured
    if (this._lastVideoBlob) {
      await this._saveVideoRecording(this._lastVideoBlob, savedStartedAt);
      this._lastVideoBlob = null;
    }

    // Archive transcript text (unless "Snapchat mode" — save text disabled)
    const saveText = localStorage.getItem('windy_saveText') !== 'false';
    if (saveText && window.windyAPI?.archiveTranscript) {
      const route = this.archiveRouteSelect?.value || 'local';
      if (route !== 'off') {
        window.windyAPI.archiveTranscript({
          text: text.trim(),
          startedAt: savedStartedAt,
          endedAt: new Date().toISOString(),
          route
        });
      }
    }
    // ═══ H4: Cloud Sync — upload recording to account server ═══
    const archiveRoute = this.archiveRouteSelect?.value || 'local';
    if (this.cloudSync && (archiveRoute === 'windy-cloud' || archiveRoute === 'both')) {
      const durationSec = savedStartedAt
        ? Math.round((Date.now() - new Date(savedStartedAt).getTime()) / 1000)
        : 0;
      this.cloudSync.uploadRecording({
        transcript: text.trim(),
        wordCount,
        durationSeconds: durationSec,
        engine: localStorage.getItem('windy_engine') || 'local',
        mode: localStorage.getItem('windy_recordingMode') || 'batch',
        recordedAt: savedStartedAt || new Date().toISOString()
      }).catch(err => console.warn('[CloudSync] Upload failed:', err.message));
    }
    this.recordingStartedAt = null;
  }

  /**
   * Save transcript to local history (localStorage, last 20).
   */
  _saveToHistory(text, wordCount, startedAt) {
    try {
      const history = JSON.parse(localStorage.getItem('windy_history') || '[]');
      const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'local';
      history.unshift({
        id: Date.now(),
        text,
        wordCount,
        engine,
        date: startedAt || new Date().toISOString()
      });
      // Keep last 20
      while (history.length > 20) history.pop();
      localStorage.setItem('windy_history', JSON.stringify(history));
    } catch (_) { }
  }

  /**
   * Save audio recording blob for playback.
   */
  /**
   * Send anonymous usage analytics (opt-in only).
   * Never sends transcript content.
   * @param {{ wordCount: number }} data
   */
  _sendAnalytics(data) {
    try {
      if (localStorage.getItem('windy_analytics') !== 'true') return;
      const payload = {
        engine: localStorage.getItem('windy_engine') || 'local',
        mode: localStorage.getItem('windy_recordingMode') || 'batch',
        language: localStorage.getItem('windy_language') || 'en',
        wordCount: data.wordCount || 0,
        durationSec: this._sessionSeconds || 0,
        ts: new Date().toISOString()
      };
      fetch('https://windypro.thewindstorm.uk/api/v1/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => { }); // Fire and forget
    } catch (_) { }
  }

  /**
   * Save audio recording blob for playback.
   */
  async _saveAudioRecording(blob, timestamp) {
    const saveAudio = localStorage.getItem('windy_saveAudio') !== 'false';
    if (!saveAudio || !blob) return;

    // Create object URL for in-session playback
    const audioUrl = URL.createObjectURL(blob);
    this._showPlaybackBar(audioUrl);

    // Save to disk archive alongside transcripts
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      // Chunked base64 conversion to avoid stack overflow on large recordings
      let base64 = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
        base64 += String.fromCharCode.apply(null, chunk);
      }
      base64 = btoa(base64);
      if (window.windyAPI?.archiveAudio) {
        await window.windyAPI.archiveAudio(base64, timestamp);
      }
    } catch (e) {
      console.warn('[Audio] Failed to save recording:', e.message);
    }
  }

  /**
   * Save video recording blob to archive.
   */
  async _saveVideoRecording(blob, timestamp) {
    if (!blob || blob.size === 0) return;

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      // Chunked base64 conversion
      let base64 = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
        base64 += String.fromCharCode.apply(null, chunk);
      }
      base64 = btoa(base64);
      if (window.windyAPI?.archiveVideo) {
        const result = await window.windyAPI.archiveVideo(base64, timestamp);
        if (result?.ok) {
          console.log(`[Video] Saved: ${result.path}`);
        }
      }
    } catch (e) {
      console.warn('[Video] Failed to save recording:', e.message);
    }
  }

  /**
   * Show a small audio playback bar below the transcript.
   */
  _showPlaybackBar(audioUrl) {
    // Remove existing playback bar
    const existing = document.getElementById('batchPlaybackBar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'batchPlaybackBar';
    bar.className = 'playback-bar';
    bar.innerHTML = `
      <span class="playback-label">🔊 Recording</span>
      <audio controls src="${audioUrl}" preload="metadata" style="flex:1;height:28px;"></audio>
    `;

    // Insert after transcript container
    const container = document.getElementById('transcriptContainer');
    if (container) {
      container.parentNode.insertBefore(bar, container.nextSibling);
    }
  }

  /**
   * Show export buttons after batch transcription.
   */
  _showExportButtons(text) {
    // Remove existing
    const existing = document.getElementById('exportBar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'exportBar';
    bar.className = 'export-bar';
    const collapsed = localStorage.getItem('windy_exportCollapsed') === 'true';
    bar.innerHTML = `
      <div class="export-toggle" id="exportToggle" title="Toggle export options">
        <span class="export-chevron ${collapsed ? '' : 'open'}">${collapsed ? '▸' : '▾'}</span> Export
      </div>
      <div class="export-buttons ${collapsed ? 'collapsed' : ''}" id="exportButtons">
        <button class="export-btn" data-format="copy" title="Copy to clipboard">📋 Copy</button>
        <button class="export-btn" data-format="txt" title="Save as plain text">📄 .txt</button>
        <button class="export-btn" data-format="md" title="Save as Markdown">📝 .md</button>
        <button class="export-btn" data-format="srt" title="Save as subtitles">📊 .srt</button>
      </div>
    `;

    // Insert before control bar
    const controlBar = document.querySelector('.control-bar');
    if (controlBar) {
      controlBar.parentNode.insertBefore(bar, controlBar);
    }

    // Toggle collapse
    bar.querySelector('#exportToggle').addEventListener('click', () => {
      const btns = bar.querySelector('#exportButtons');
      const chev = bar.querySelector('.export-chevron');
      const isCollapsed = btns.classList.toggle('collapsed');
      chev.textContent = isCollapsed ? '▸' : '▾';
      chev.classList.toggle('open', !isCollapsed);
      localStorage.setItem('windy_exportCollapsed', isCollapsed);
    });

    // Bind click handlers
    bar.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', () => this._exportTranscript(text, btn.dataset.format));
    });
  }

  /**
   * Export transcript in specified format.
   */
  async _exportTranscript(text, format) {
    if (format === 'copy') {
      // Use navigator clipboard
      try {
        await navigator.clipboard.writeText(text);
        this.showReconnectToast('📋 Copied to clipboard!');
      } catch (_) {
        this.showReconnectToast('⚠️ Copy failed.');
      }
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    let content, defaultName, filters;

    if (format === 'txt') {
      content = text;
      defaultName = `transcript-${timestamp}.txt`;
      filters = [{ name: 'Text', extensions: ['txt'] }];
    } else if (format === 'md') {
      const paragraphs = text.split(/\n+/).filter(p => p.trim());
      content = `# Transcript — ${new Date().toLocaleString()}\n\n${paragraphs.map(p => p.trim()).join('\n\n')}\n`;
      defaultName = `transcript-${timestamp}.md`;
      filters = [{ name: 'Markdown', extensions: ['md'] }];
    } else if (format === 'srt') {
      // Generate SRT from text — split into ~10s chunks
      const words = text.split(/\s+/);
      const chunkSize = 15; // words per subtitle
      let srt = '';
      for (let i = 0, idx = 1; i < words.length; i += chunkSize, idx++) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        const startSec = Math.floor(i / 2.5);
        const endSec = Math.floor(Math.min(i + chunkSize, words.length) / 2.5);
        const startTime = this._formatSrtTime(startSec);
        const endTime = this._formatSrtTime(endSec);
        srt += `${idx}\n${startTime} --> ${endTime}\n${chunk}\n\n`;
      }
      content = srt.trim();
      defaultName = `transcript-${timestamp}.srt`;
      filters = [{ name: 'Subtitles', extensions: ['srt'] }];
    }

    if (window.windyAPI?.saveFile) {
      const result = await window.windyAPI.saveFile({ content, defaultName, filters });
      if (result?.ok) {
        this.showReconnectToast(`✅ Saved to ${result.path.split('/').pop()}`);
      }
    } else {
      // Fallback: download link
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Format seconds to SRT time format (HH:MM:SS,mmm).
   */
  _formatSrtTime(secs) {
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${h}:${m}:${s},000`;
  }

  // ═══════════════════════════════════════════════
  //  API-based Engines (Deepgram, Groq, OpenAI)
  // ═══════════════════════════════════════════════

  /**
   * Start recording for API-based transcription.
   * Records audio via MediaRecorder, sends chunks to the API.
   */
  async startApiRecording(engine) {
    // Get API key
    const keyMap = { deepgram: 'deepgramApiKey', groq: 'groqApiKey', openai: 'openaiApiKey' };
    const apiKey = localStorage.getItem('windy_' + keyMap[engine]) || '';
    if (!apiKey) {
      this.showReconnectToast(`⚠️ No ${engine} API key configured. Open Settings to add one.`);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._apiAudioChunks = [];
      this._streamingText = '';
      this.isRecording = true;
      this.recordingStartedAt = new Date().toISOString();
      this.transcriptContent.contentEditable = 'false';

      // Clear placeholder
      const placeholder = this.transcriptContent.querySelector('.placeholder');
      if (placeholder) placeholder.remove();

      // For Deepgram: use WebSocket streaming for real-time results
      if (engine === 'deepgram') {
        await this._startDeepgramStreaming(stream, apiKey);
      } else {
        // For Groq/OpenAI: batch per chunk using MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm';
        this._apiMediaRecorder = new MediaRecorder(stream, { mimeType });

        this._apiMediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this._apiAudioChunks.push(event.data);
          }
        };

        this._apiMediaRecorder.onstop = async () => {
          // Process accumulated audio
          if (this._apiAudioChunks.length > 0) {
            const audioBlob = new Blob(this._apiAudioChunks, { type: mimeType });
            this.setState('buffering');
            // Strand I: trigger process effect (first beep + repeating loop)
            try {
              if (this.effectsEngine) this.effectsEngine.trigger('process');
              clearInterval(this._processEffectInterval);
              const pSec = parseInt(localStorage.getItem('windy_processInterval') || '10', 10);
              this._processEffectInterval = setInterval(() => {
                try { if (this.effectsEngine) this.effectsEngine.trigger('process'); } catch (_) { }
              }, Math.max(1000, pSec * 1000));
            } catch (_) { }
            try {
              const text = await this._transcribeWithApi(engine, apiKey, audioBlob);
              if (text && text.trim()) {
                this._streamingText += (this._streamingText ? ' ' : '') + text.trim();
                this.transcript.push({ text: text.trim(), partial: false, start: 0, end: 0, confidence: 1.0, words: [] });
                this._renderStreamTranscript();
                this.updateWordCount();
              }
            } catch (err) {
              console.error(`[${engine}] Transcription failed:`, err);
              this.showReconnectToast(`⚠️ ${engine} error: ${err.message}`);
            }
          }
          this.setState('idle');
          stream.getTracks().forEach(t => t.stop());

          // Archive
          if (this._streamingText.trim() && window.windyAPI?.archiveTranscript) {
            const route = this.archiveRouteSelect?.value || 'local';
            if (route !== 'off') {
              window.windyAPI.archiveTranscript({
                text: this._streamingText.trim(),
                startedAt: this.recordingStartedAt,
                endedAt: new Date().toISOString(),
                route
              });
            }
          }
          this.transcriptContent.contentEditable = 'true';
          this.recordingStartedAt = null;
        };

        // For Groq/OpenAI: record in 5-second chunks for progressive transcription
        this._apiMediaRecorder.start(5000);

        // Process chunks as they arrive (progressive transcription)
        this._apiChunkInterval = setInterval(async () => {
          if (this._apiAudioChunks.length > 0 && this.isRecording) {
            const chunks = this._apiAudioChunks.splice(0);
            const blob = new Blob(chunks, { type: mimeType });
            try {
              const text = await this._transcribeWithApi(engine, apiKey, blob);
              if (text && text.trim()) {
                this._streamingText += (this._streamingText ? ' ' : '') + text.trim();
                this.transcript.push({ text: text.trim(), partial: false, start: 0, end: 0, confidence: 1.0, words: [] });
                this._renderStreamTranscript();
                this.updateWordCount();
              }
            } catch (err) {
              console.error(`[${engine}] Chunk transcription failed:`, err);
            }
          }
        }, 6000); // Process every 6s (giving 1s buffer after 5s chunks)
      }

      this.setState('listening');
      this.updateModelBadge(engine, false);
      console.log(`[API] ${engine} recording started`);
    } catch (err) {
      console.error(`[API] Failed to start ${engine}:`, err);
      this.showReconnectToast(`⚠️ Could not access microphone.`);
      this.isRecording = false;
    }
  }

  /**
   * Stop API-based recording
   */
  stopApiRecording() {
    this.isRecording = false;
    if (this._apiChunkInterval) {
      clearInterval(this._apiChunkInterval);
      this._apiChunkInterval = null;
    }
    if (this._deepgramWs) {
      this._deepgramWs.close();
      this._deepgramWs = null;
    }
    if (this._apiMediaRecorder && this._apiMediaRecorder.state !== 'inactive') {
      this._apiMediaRecorder.stop(); // triggers onstop handler
    } else {
      this.setState('idle');
      this.transcriptContent.contentEditable = 'true';
    }
    this._apiMediaRecorder = null;
  }

  /**
   * Transcribe audio blob with Groq or OpenAI API.
   * @param {string} engine - 'groq' or 'openai'
   * @param {string} apiKey - API key
   * @param {Blob} audioBlob - Audio data
   * @returns {Promise<string>} Transcribed text
   */
  async _transcribeWithApi(engine, apiKey, audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', engine === 'groq' ? 'whisper-large-v3' : 'whisper-1');
    formData.append('language', localStorage.getItem('windy_language') || 'en');

    const urls = {
      groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
      openai: 'https://api.openai.com/v1/audio/transcriptions'
    };

    // 30-second timeout for API calls
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30 * 1000);

    try {
      const response = await fetch(urls[engine], {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const err = await response.text();
        if (response.status >= 500) {
          throw new Error('Processing failed — try again or switch to a different engine.');
        }
        throw new Error(`${response.status}: ${err}`);
      }

      const data = await response.json();
      return data.text || '';
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('API request timed out (30s). Try again or use a different engine.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  /**
   * Start Deepgram real-time WebSocket streaming
   */
  async _startDeepgramStreaming(stream, apiKey) {
    const dgLang = localStorage.getItem('windy_language') || 'en';
    const dgDiarize = localStorage.getItem('windy_diarize') === 'true';
    let dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${dgLang}&smart_format=true&interim_results=true&punctuate=true`;
    if (dgDiarize) dgUrl += '&diarize=true';

    this._deepgramWs = new WebSocket(dgUrl, ['token', apiKey]);

    this._deepgramWs.onopen = () => {
      console.log('[Deepgram] WebSocket connected');
      // Stream audio to Deepgram
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (this._deepgramWs && this._deepgramWs.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const int16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
          }
          this._deepgramWs.send(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      this._dgAudioCtx = audioCtx;
      this._dgProcessor = processor;
      this._dgSource = source;
      this._dgStream = stream;
    };

    this._deepgramWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.channel?.alternatives?.[0]) {
          const alt = data.channel.alternatives[0];
          const text = alt.transcript;
          if (text) {
            if (data.is_final) {
              this._streamingText += (this._streamingText ? ' ' : '') + text;
              this.transcript.push({ text: text.trim(), partial: false, start: 0, end: 0, confidence: alt.confidence || 1, words: [] });
              this._interimText = '';
              this.updateWordCount();
            } else {
              this._interimText = text;
            }
            this._renderStreamTranscript();
          }
        }
      } catch (err) {
        console.error('[Deepgram] Parse error:', err);
      }
    };

    this._deepgramWs.onerror = (err) => {
      console.error('[Deepgram] WebSocket error:', err);
      this.showReconnectToast('⚠️ Stream engine connection error. Check API key.');
    };

    this._deepgramWs.onclose = () => {
      console.log('[Deepgram] WebSocket closed');
      // Clean up audio pipeline
      if (this._dgProcessor) this._dgProcessor.disconnect();
      if (this._dgSource) this._dgSource.disconnect();
      if (this._dgAudioCtx) this._dgAudioCtx.close();
      if (this._dgStream) this._dgStream.getTracks().forEach(t => t.stop());

      if (this.isRecording) {
        this.isRecording = false;
        this.setState('idle');
        this.transcriptContent.contentEditable = 'true';
        // Archive
        if (this._streamingText.trim() && window.windyAPI?.archiveTranscript) {
          const route = this.archiveRouteSelect?.value || 'local';
          if (route !== 'off') {
            window.windyAPI.archiveTranscript({
              text: this._streamingText.trim(),
              startedAt: this.recordingStartedAt,
              endedAt: new Date().toISOString(),
              route
            });
          }
        }
        this.recordingStartedAt = null;
      }
    };
  }

  /**
   * Toggle recording state
   * Debounced to prevent double-tap races (e.g. rapid Ctrl+Shift+Space)
   */
  /** Play a short blip sound for start/stop/paste feedback.
   *  Reuses a single AudioContext to avoid focus-steal on Linux.
   */
  _playBlip(frequency = 880, duration = 0.08) {
    try {
      if (this._sfxVolume === 0) return;
      if (!this._blipAudioCtx || this._blipAudioCtx.state === 'closed') {
        this._blipAudioCtx = new AudioContext();
      }
      const ctx = this._blipAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = frequency;
      osc.type = 'sine';
      const vol = (this._sfxVolume ?? 0.7) * 0.3;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (_) { }
  }

  /** Play a rising sweep blip for paste confirmation */
  _playPasteBlip() {
    try {
      if (this._sfxVolume === 0) return;
      if (!this._blipAudioCtx || this._blipAudioCtx.state === 'closed') {
        this._blipAudioCtx = new AudioContext();
      }
      const ctx = this._blipAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.12);
      const vol = (this._sfxVolume ?? 0.7) * 0.25;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (_) { }
  }

  toggleRecording() {
    // Debounce guard: ignore rapid toggles within 500ms
    if (this._toggleLock) return;
    this._toggleLock = true;
    setTimeout(() => { this._toggleLock = false; }, 500);

    const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
    const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';

    if (this.isRecording) {
      // Sound feedback: use default beeps only if effects engine is in default mode or unavailable
      const fxMode = this.effectsEngine?._mode;
      if (!fxMode || fxMode === 'default' || fxMode === 'silent') {
        this._playBlip(440, 0.1);
      }
      // Strand I: trigger stop effect (pure observer, safe to fail)
      try { if (this.effectsEngine) this.effectsEngine.trigger('stop'); } catch (_) { }
      // Strand I: stop "during" effect interval
      clearInterval(this._duringEffectInterval);
      if (this._batchRecorder) {
        this.stopBatchRecording();
      } else if (['deepgram', 'groq', 'openai'].includes(engine) && this._apiMediaRecorder) {
        this.stopApiRecording();
      } else if (engine === 'stream' && this.speechRecognition) {
        this.stopStreamRecognition();
      } else {
        this.stopRecording();
      }
    } else {
      // Sound feedback: use default beeps only if effects engine is in default mode or unavailable
      const fxMode2 = this.effectsEngine?._mode;
      if (!fxMode2 || fxMode2 === 'default' || fxMode2 === 'silent') {
        this._playBlip(880, 0.08);
      }
      // Strand I: random widget rotation on each recording start
      try {
        const widgetMode = localStorage.getItem('windy_widgetMode');
        if (widgetMode === 'random-stock' && this.widgetEngine) {
          const stockIds = Object.keys(WidgetEngine.STOCK_WIDGETS);
          const rand = stockIds[Math.floor(Math.random() * stockIds.length)];
          this.widgetEngine.setWidget(rand);
        } else if (widgetMode === 'random-custom' && this.widgetEngine) {
          try {
            const customs = JSON.parse(localStorage.getItem('windy_customWidgets') || '[]');
            if (customs.length > 0) {
              const rand = customs[Math.floor(Math.random() * customs.length)];
              this.widgetEngine.setWidget('custom', rand);
            }
          } catch (_) { }
        }
      } catch (_) { }
      // Strand I: trigger start effect (pure observer, safe to fail)
      try { if (this.effectsEngine) this.effectsEngine.trigger('start'); } catch (_) { }
      // Strand I: start "during" effect interval (configurable, default 5s)
      try {
        clearInterval(this._duringEffectInterval);
        const duringIntervalSec = parseInt(localStorage.getItem('windy_duringInterval') || '5', 10);
        const duringIntervalMs = Math.max(1000, duringIntervalSec * 1000);
        this._duringEffectInterval = setInterval(() => {
          if (this.isRecording) {
            try { this.effectsEngine.trigger('during'); } catch (_) { }
          } else {
            clearInterval(this._duringEffectInterval);
          }
        }, duringIntervalMs);
      } catch (_) { }
      if (recordingMode === 'batch' || recordingMode === 'clone_capture') {
        this.startBatchRecording();
      } else if (['deepgram', 'groq', 'openai'].includes(engine)) {
        this.startApiRecording(engine);
      } else if (engine === 'stream') {
        this.startStreamRecognition();
      } else {
        this.startRecording();
      }
    }
    // Clear hotkey flag
    this._hotkeyTriggered = false;
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
        // Send resolved whisper model config to Python server for custom engines
        const engineModel = this._engineModelMap?.[this.transcriptionEngine];
        if (engineModel) {
          this.send('config', { model: engineModel });
        }
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
    // Only remove hotkey placeholder if there's actual content to show
    if (this.transcript.length > 0) {
      const placeholder = this.transcriptContent.querySelector('.placeholder');
      if (placeholder) placeholder.remove();
    } else {
      return; // Nothing to render — keep placeholder visible
    }

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
    console.debug('[addTranscript] text:', msg.text, 'partial:', msg.partial, 'livePreview:', this.livePreview, 'state:', this.currentState);
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
    this.transcriptContent.innerHTML = `<div class="placeholder" id="shortcutsPlaceholder">
      <div style="margin-bottom:8px;font-weight:600;opacity:0.9;">⌨️ Keyboard Shortcuts</div>
      <div id="shortcutRow_toggle" style="margin:4px 0;"></div>
      <div id="shortcutRow_paste" style="margin:4px 0;"></div>
      <div id="shortcutRow_showHide" style="margin:4px 0;"></div>
      <div id="shortcutRow_quickTranslate" style="margin:4px 0;"></div>
      <div style="margin:4px 0;"><kbd>Ctrl + / −</kbd> — <span style="color:#A78BFA;font-weight:600;">Zoom</span> in / out &nbsp; <kbd>Ctrl+0</kbd> Reset</div>
    </div>`;
    // Re-populate with user's actual hotkeys
    if (window.windyAPI?.getSettings) {
      window.windyAPI.getSettings().then(s => this._populateShortcutDisplay(s?.hotkeys));
    }
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

    // Paste confirmation beep (rising sweep)
    this._playPasteBlip();

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
