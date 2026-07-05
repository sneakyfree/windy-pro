/**
 * Windy Word - Renderer Application
 * 
 * Handles:
 * - WebSocket connection to Python backend
 * - State indicator updates (The Green Strobe)
 * - Transcript display
 * - User interactions
 */

class WindyApp {
  constructor() {
    // ═══ A1: One-time engine migration (self-heal "opens on 1.5GB flagship") ═══
    // Early users could get windy_model pinned to the heavy pro-engine, forcing
    // every launch to load the 1.5GB flagship. Reset that pin to Auto (WindyTune
    // → lightweight bundled `base`) exactly once. Runs before any engine resolution.
    // Early testers thrashed engines (pro-engine 1.5GB, edge, etc.) and the app
    // would re-open on whatever heavy model was last pinned. The book-launch default
    // must be Auto (WindyTune → lightweight multilingual `base`). Reset any stale pin
    // to Auto exactly once; after that the user's own picks stick.
    try {
      if (localStorage.getItem('windy_engineDefaultV2') !== '1') {
        localStorage.setItem('windy_model', '');
        localStorage.setItem('windy_engine', 'windytune');
        localStorage.setItem('windy_engineDefaultV2', '1');
        console.info('[Migrate] reset engine pin to Auto (book-launch default)');
      }
    } catch (_) { /* localStorage unavailable — non-fatal */ }

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
    // Each Windy engine maps to its canonical lean CT2 model id (windy-*-ct2).
    // main.js resolves these to the bundled offline model dir of the same name —
    // NO legacy whisper-name translation (which mis-mapped Plus→large-v2 etc. and
    // could trigger a 3GB HuggingFace download). WindyTune (Auto) stays on the
    // always-bundled multilingual `base` for a rock-solid default. See BUNDLED_MODELS.
    this._engineModelMap = {
      'local': null, // auto-detect
      'windytune': 'base', // auto-pilot: bundled multilingual base — see BUNDLED_MODELS
      'windy-nano': 'windy-nano-ct2', 'windy-lite': 'windy-lite-ct2', 'windy-core': 'windy-core-ct2',
      'windy-edge': 'windy-edge-ct2', 'windy-plus': 'windy-plus-ct2', 'windy-turbo': 'windy-turbo-ct2',
      'windy-pro-engine': 'windy-pro-engine-ct2',
      'windy-nano-cpu': 'windy-nano-ct2', 'windy-lite-cpu': 'windy-lite-ct2', 'windy-core-cpu': 'windy-core-ct2',
      'windy-edge-cpu': 'windy-edge-ct2', 'windy-plus-cpu': 'windy-plus-ct2', 'windy-turbo-cpu': 'windy-turbo-ct2',
      'windy-pro-engine-cpu': 'windy-pro-engine-ct2',
      'windy-translate-spark': null, 'windy-translate-standard': null
    };

    // Web Speech API state (kept for future Chrome-tab relay)
    this.speechRecognition = null;
    this._streamingText = '';
    this._interimText = '';

    // API-based engine state
    this._apiMediaRecorder = null;
    this._apiAudioChunks = [];
    this.cloudUrl = (window.API_CONFIG || {}).wsUrl || 'wss://windyword.ai';
    this.cloudWs = null;
    this.cloudToken = null;
    this._usingCloud = false;  // When smart mode, tracks if currently using cloud

    // Audio capture state (B2.6)
    this.mediaStream = null;
    this.audioContext = null;
    this.audioProcessor = null;
    this.audioSource = null;

    // ═══ Mic pre-warming (Wayland focus protection) ═══
    // On Wayland+GNOME, a fresh getUserMedia() call activates Chromium's audio
    // device through XWayland, which Mutter sees as a focus request and
    // transfers keyboard focus to the Electron window — stealing the cursor
    // from the user's target app. By acquiring a MediaStream once at boot
    // and reusing it for every recording, we eliminate that focus steal.
    // The user's terminal cursor keeps blinking through the entire record cycle.
    // AudioContext is pre-warmed for the same reason (creation can also leak focus).
    this._prewarmedStream = null;
    this._prewarmedAudioCtx = null;
    this._prewarmedAnalyser = null;

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

    // Book-launch: WindyCloud isn't live — restrict the bottom-bar archive route to
    // local destinations (Local / Off) by dropping the cloud options. The folder
    // picker (⚙️) still lets users archive anywhere on disk. Reversible: the cloud
    // routes return when CLOUD_STORAGE is true in edition.js.
    if (this.archiveRouteSelect && window.windyAPI?.cloudStorage === false) {
      Array.from(this.archiveRouteSelect.options).forEach(opt => {
        if (opt.value === 'cloud' || opt.value === 'local_cloud') opt.remove();
      });
      if (['cloud', 'local_cloud'].includes(this.archiveRouteSelect.value)) {
        this.archiveRouteSelect.value = 'local';
      }
    }
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
    this.initAgentBridge();

    // One-time delegated listener for the always-present bottom export row.
    // The per-show rebind in _showExportButtons() captures a stale snapshot of
    // the text and leaves the buttons dead before the first transcription /
    // after Clear; this delegated handler always reads the live transcript.
    document.getElementById('exportButtons')?.addEventListener('click', (e) => {
      const b = e.target.closest('.export-btn');
      if (b) this._exportTranscript(this.getFullTranscript(), b.dataset.format);
    });

    // ── Offline Detection (global) ──
    this.isOffline = !navigator.onLine;
    window.addEventListener('online', () => { this.isOffline = false; this._updateOfflineUI(); });
    window.addEventListener('offline', () => { this.isOffline = true; this._updateOfflineUI(); });
    this._updateOfflineUI();

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

    // OLD in-app wizard DELETED 21Mar26 — installer-v2/screens/wizard.html is the ONLY wizard
    // First-run onboarding is handled by installer-v2, launched from main.js line 4860

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
      let route = settings?.archiveRouteToday || 'local';
      // Book-launch: a previously-saved cloud route is invalid (cloud options
      // removed) — fall back to local so the selector never ends up blank.
      if (window.windyAPI?.cloudStorage === false && (route === 'cloud' || route === 'local_cloud')) {
        route = 'local';
      }
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
      console.debug(`[Init] IPC: Engine=${this.transcriptionEngine}, CloudURL=${this.cloudUrl ? 'configured' : 'empty'}`);

      // Load transcription mode (auto / local_only / cloud_only).
      // Free/offline build (cloudStorage off): FORCE local-only and ignore any persisted
      // mode. An upgrader from a prior tiered build can carry a stale 'cloud_only' (or
      // 'auto') in settings/localStorage, which would otherwise win the `||` chain here and
      // silently connect to wss://windyword.ai on launch (see the cloud_only branch below) —
      // breaking the "your voice never leaves your device" promise. Only paid builds
      // (cloudStorage on) honor the saved mode.
      const _cloudDisabled = (window.windyAPI?.cloudStorage === false);
      this.transcriptionMode = _cloudDisabled
        ? 'local_only'
        : (settings?.transcriptionMode || localStorage.getItem('windy_transcriptionMode') || 'auto');
      console.debug(`[Init] Transcription mode: ${this.transcriptionMode}`);

      // Cloud-only mode: connect to cloud WebSocket immediately, skip local backend
      if (this.transcriptionMode === 'cloud_only' && this.cloudUrl) {
        this._usingCloud = true;
        this.connectCloudWS().then(() => {
          this.updateModelBadge('cloud', false);
          this.showReconnectToast('☁️ Cloud-only mode active');
        }).catch((err) => {
          console.warn('[Init] Cloud-only connect failed:', err.message);
          this._usingCloud = false;
          this.showReconnectToast('⚠️ Cloud unavailable. Falling back to local.');
        });
      }

      // Show current engine/model in status bar badge on startup
      // A1: Default to a BUNDLED model, never the non-bundled 'small'. When the
      // engine is WindyTune (Auto — the default), the loaded model must come from
      // the Auto path (_engineModelMap['windytune'] = 'base': fast + multilingual),
      // never a heavy saved pin — so a fresh/unpinned app never auto-loads pro-engine.
      const startupBadgeEngine = localStorage.getItem('windy_engine') || this.transcriptionEngine || 'windytune';
      const autoModel = (this._engineModelMap && this._engineModelMap['windytune']) || 'base';
      const savedModel = (startupBadgeEngine === 'windytune')
        ? autoModel
        : (settings?.model || localStorage.getItem('windy_model') || autoModel);
      const engineName = this.transcriptionEngine || 'local';
      if (this.transcriptionMode === 'cloud_only') {
        this.updateModelBadge('cloud', false);
      } else if (['groq', 'openai', 'deepgram', 'cloud', 'stream'].includes(engineName)) {
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

    // Sync with macOS system dark/light mode changes
    if (window.windyAPI?.onSystemThemeChanged) {
      window.windyAPI.onSystemThemeChanged((theme) => {
        const isLight = theme === 'light';
        document.body.classList.toggle('light-theme', isLight);
        localStorage.setItem('windy_theme', isLight ? 'light' : 'dark');
        const themeBtn2 = document.getElementById('themeQuickToggle');
        if (themeBtn2) themeBtn2.textContent = isLight ? '\u2600\ufe0f' : '\ud83c\udf19';
        const themeSelect = document.querySelector('#themeToggle');
        if (themeSelect) themeSelect.value = isLight ? 'light' : 'dark';
      });
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
      // SEC-03: Do NOT read password from localStorage — it should never be stored there
      localStorage.removeItem('windy_cloudPassword'); // Clean up any old stored password
      if (lsEngine) this.transcriptionEngine = lsEngine;
      if (lsCloudUrl) this.cloudUrl = lsCloudUrl;
      if (lsCloudToken) this.cloudToken = lsCloudToken;
      if (lsCloudEmail) this.cloudEmail = lsCloudEmail;
      console.debug(`[Init] Final: Engine=${this.transcriptionEngine}, CloudToken=${this.cloudToken ? 'present' : 'missing'}, CloudURL=${this.cloudUrl ? 'configured' : 'empty'}`);
    } catch (e) { console.warn('[Init] Settings load error:', e.message); }

    // Check for crash recovery via Electron IPC
    if (window.windyAPI?.checkCrashRecovery) {
      const recovery = await window.windyAPI.checkCrashRecovery();
      if (recovery.found) {
        this.showRecoveryBanner(recovery.content);
      }
    }

    // Ecosystem navigation toolbar
    if (typeof EcosystemNav !== 'undefined' && window.windyAPI?.ecosystemUI !== false) {
      this.ecosystemNav = new EcosystemNav(this);
    }

    // First-run welcome overlay (shows once on first launch)
    if (typeof FirstRunExperience !== 'undefined') {
      const firstRun = new FirstRunExperience(this);
      firstRun.show();
    }

    // Mic pre-warm (Linux/Wayland focus protection). Fire-and-forget — failure
    // is non-fatal; the recording path falls back to fresh getUserMedia.
    this._prewarmMic();
  }

  // ── Agent bridge (v1.3.0+) ──────────────────────────────────────────
  // Wires renderer-side state (effects-engine, localStorage, widget-engine)
  // to the HTTP agent control plane in main.js. Main sends a request on
  // 'agent:request' with {requestId, op, args}; this dispatcher routes by
  // op and replies on 'agent:reply' with {requestId, ok, ...result}.
  //
  // Op vocabulary:
  //   get_effects_state       → effects + master vol + custom sounds + packs
  //   list_effect_packs       → built-in pack catalog
  //   set_hook                → {hook, enabled?, volume?} per-stage write
  //   set_active_pack         → {packId} switch sound pack
  //   set_master_sfx_volume   → {volume:0-100} master volume + persist
  //   set_effect_mode         → {mode} silent/classic/surprise/custom/pack
  //   get_widget_state        → widget runtime + persisted state
  initAgentBridge() {
    if (!window.agentBridge?.onRequest) return;
    const reply = (requestId, result) => window.agentBridge.sendReply({ requestId, ...result });
    const validHooks = ['start', 'during', 'stop', 'process', 'warning', 'paste'];
    window.agentBridge.onRequest((req) => {
      const { requestId, op, args = {} } = req || {};
      if (!requestId) return;
      try {
        const fx = this.effectsEngine;
        switch (op) {
          case 'get_effects_state': {
            if (!fx) return reply(requestId, { ok: false, error: 'EffectsEngine not initialized' });
            let customSounds = {};
            try { customSounds = JSON.parse(localStorage.getItem('windy_customSounds') || '{}'); } catch (_) {}
            return reply(requestId, {
              ok: true,
              state: {
                mode: fx._mode,
                activePackId: fx._activePack?.id || fx._activePackId || null,
                activePackName: fx._activePack?.name || null,
                hookPoints: fx._hookPoints,
                favorites: fx._favorites || [],
                surpriseCategory: fx._surpriseCategory,
                dynamicScaling: fx._dynamicScaling,
                sfxMasterVolume: parseInt(localStorage.getItem('windy_sfxVolume') || '70', 10),
                customSounds,
                hookStages: validHooks,
              },
            });
          }
          case 'list_effect_packs': {
            if (!fx?.getPackList) return reply(requestId, { ok: false, error: 'EffectsEngine.getPackList unavailable' });
            return reply(requestId, {
              ok: true,
              packs: fx.getPackList(),
              activePackId: fx._activePack?.id || fx._activePackId || null,
            });
          }
          case 'set_hook': {
            if (!fx) return reply(requestId, { ok: false, error: 'EffectsEngine not initialized' });
            const { hook, enabled, volume } = args;
            if (!validHooks.includes(hook)) {
              return reply(requestId, { ok: false, error: `invalid hook "${hook}"; must be one of ${validHooks.join(', ')}` });
            }
            if (typeof enabled === 'boolean') fx.setHookEnabled(hook, enabled);
            if (typeof volume === 'number') fx.setHookVolume(hook, Math.max(0, Math.min(100, volume)));
            return reply(requestId, {
              ok: true,
              hook,
              enabled: fx._hookPoints[hook]?.enabled,
              volume: fx._hookPoints[hook]?.volume,
            });
          }
          case 'set_active_pack': {
            if (!fx) return reply(requestId, { ok: false, error: 'EffectsEngine not initialized' });
            const { packId } = args;
            if (!fx._packs?.[packId]) {
              return reply(requestId, { ok: false, error: `unknown pack "${packId}"`, available: Object.keys(fx._packs || {}) });
            }
            if (typeof fx.setActivePack === 'function') {
              fx.setActivePack(packId);
            } else {
              fx._activePack = fx._packs[packId];
              fx._activePackId = packId;
              fx._saveSettings?.();
            }
            return reply(requestId, {
              ok: true,
              activePackId: packId,
              activePackName: fx._packs[packId].name,
            });
          }
          case 'set_master_sfx_volume': {
            const v = Math.max(0, Math.min(100, parseInt(args.volume, 10)));
            if (!Number.isFinite(v)) return reply(requestId, { ok: false, error: 'volume (number 0-100) required' });
            localStorage.setItem('windy_sfxVolume', String(v));
            fx?.sound?.setMasterVolume?.(v / 100);
            return reply(requestId, { ok: true, masterVolume: v });
          }
          case 'set_effect_mode': {
            if (!fx) return reply(requestId, { ok: false, error: 'EffectsEngine not initialized' });
            const validModes = ['silent', 'classic', 'surprise', 'custom', 'pack'];
            if (!validModes.includes(args.mode)) {
              return reply(requestId, { ok: false, error: `invalid mode "${args.mode}"; must be one of ${validModes.join(', ')}` });
            }
            fx._mode = args.mode;
            fx._saveSettings?.();
            return reply(requestId, { ok: true, mode: args.mode });
          }
          case 'get_widget_state': {
            const we = this.widgetEngine || null;
            return reply(requestId, {
              ok: true,
              state: {
                widgetEnginePresent: !!we,
                widgetVisible: we?._visible !== undefined ? we._visible : null,
                tornadoSizeLS: localStorage.getItem('windy_tornadoSize'),
              },
            });
          }
          // Recording lifecycle verbs. toggleRecording() owns the mode/engine
          // dispatch (batch / api / stream) and the Wayland setFocusable
          // discipline — agents must NOT call startRecording() / stopRecording()
          // directly. The renderer is the source of truth for `isRecording`,
          // so idempotency checks happen here, not in main.js.
          case 'start_recording': {
            if (this.isRecording) {
              return reply(requestId, {
                ok: true,
                alreadyRecording: true,
                isRecording: true,
                state: this.currentState,
              });
            }
            try { this.toggleRecording(); }
            catch (e) { return reply(requestId, { ok: false, error: `toggleRecording threw: ${e.message}` }); }
            return reply(requestId, {
              ok: true,
              isRecording: this.isRecording,
              state: this.currentState,
              engine: localStorage.getItem('windy_engine') || this.transcriptionEngine,
              mode: localStorage.getItem('windy_recordingMode') || 'batch',
              note: 'Recording start is fire-and-forget; mic capture + WebSocket setup completes asynchronously. Poll GET /recording/state to confirm live state.',
            });
          }
          case 'stop_recording': {
            if (!this.isRecording) {
              return reply(requestId, {
                ok: true,
                alreadyStopped: true,
                isRecording: false,
                state: this.currentState,
              });
            }
            try { this.toggleRecording(); }
            catch (e) { return reply(requestId, { ok: false, error: `toggleRecording threw: ${e.message}` }); }
            return reply(requestId, {
              ok: true,
              isRecording: this.isRecording,
              state: this.currentState,
              note: 'Stop triggers the transcription + paste pipeline against the window that had focus at recording start.',
            });
          }
          // Source of truth for recording state. Wave W1's /recording/state
          // endpoint was reading main-process `isRecording` which is only
          // toggled by the legacy GNOME-keybinding path, not by the
          // agentBridge start_recording flow — leading to false negatives
          // when agents polled state after start_recording. This op returns
          // the renderer's true isRecording + currentState; main.js bridges
          // through it.
          case 'get_recording_status': {
            return reply(requestId, {
              ok: true,
              isRecording: !!this.isRecording,
              currentState: this.currentState || 'idle',
              engine: localStorage.getItem('windy_engine') || this.transcriptionEngine || null,
              mode: localStorage.getItem('windy_recordingMode') || 'batch',
            });
          }
          // enumerateDevices is read-only (no getUserMedia call) so it does
          // NOT trigger the Wayland focus-steal hazard from CLAUDE.md rule 2.
          // Device labels are hidden until mic permission has been granted at
          // least once — we surface that as a hint, not an error.
          case 'list_audio_devices': {
            Promise.all([
              navigator.mediaDevices.enumerateDevices(),
              window.windyAPI?.getSettings ? window.windyAPI.getSettings() : Promise.resolve(null),
            ]).then(([devices, settings]) => {
              const currentId = settings?.micDeviceId || 'default';
              const inputs = devices
                .filter((d) => d.kind === 'audioinput')
                .map((d) => ({
                  deviceId: d.deviceId,
                  label: d.label || '',
                  groupId: d.groupId,
                  isCurrent: d.deviceId === currentId,
                }));
              const labelsAvailable = inputs.some((d) => d.label.length > 0);
              reply(requestId, {
                ok: true,
                count: inputs.length,
                currentDeviceId: currentId,
                devices: inputs,
                labelsAvailable,
                hint: labelsAvailable
                  ? null
                  : 'Device labels are hidden because mic permission has not been granted yet. Start a recording once to unlock labels, then re-call. To switch device, use set_setting with path "engine.micDeviceId" and a known deviceId.',
              });
            }).catch((e) => reply(requestId, { ok: false, error: `enumerateDevices failed: ${e.message}` }));
            return;
          }
          default:
            return reply(requestId, { ok: false, error: `unknown op: ${op}` });
        }
      } catch (e) {
        return reply(requestId, { ok: false, error: e.message });
      }
    });
    console.info('[AgentBridge] renderer-side dispatcher armed');
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

    // Engine badge → manual override menu (WindyTune Auto, or pin any engine).
    this._setupEngineMenu();

    // UI-6: the translate menu's Quick-Translate <kbd> is static HTML ("Ctrl+Shift+T");
    // show the ⌘ modifier on macOS to match the real accelerator (⌘ = CommandOrControl).
    if (window.windyAPI?.platform === 'darwin') {
      const qt = document.getElementById('qtShortcut');
      if (qt) qt.textContent = '⌘+Shift+T';
    }

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

    // Marketplace tab
    const marketplaceBtn = document.getElementById('marketplaceBtn');
    if (marketplaceBtn) {
      marketplaceBtn.addEventListener('click', () => {
        if (!this.marketplacePanel) {
          this.marketplacePanel = typeof MarketplacePanel !== 'undefined' ? new MarketplacePanel(this) : null;
        }
        if (this.marketplacePanel) {
          this.marketplacePanel.toggle();
          marketplaceBtn.classList.toggle('active', this.marketplacePanel.isVisible);
        }
      });
    }

    // Controls pin/unpin toggle — chevron is in the status bar
    // Pinned = entire bottom panel always visible; Unpinned = hover to reveal
    const expandable = document.getElementById('bottomExpandable');
    const chevron = document.getElementById('controlsChevron');
    const miniRec = document.getElementById('miniRecordBtn');
    if (chevron && expandable) {
      // Restore saved state (default: pinned/open for new users)
      const isPinned = localStorage.getItem('windy_controlsPinned') !== 'false';
      if (isPinned) {
        expandable.classList.add('pinned');
        chevron.classList.add('pinned');
        chevron.textContent = '▾';
        if (miniRec) miniRec.style.display = 'none';
      } else {
        chevron.classList.add('collapsed');
        chevron.textContent = '▸';
        if (miniRec) miniRec.style.display = '';
      }

      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowPinned = !expandable.classList.contains('pinned');
        expandable.classList.toggle('pinned', nowPinned);
        chevron.classList.toggle('pinned', nowPinned);
        chevron.classList.toggle('collapsed', !nowPinned);
        chevron.textContent = nowPinned ? '▾' : '▸';
        chevron.setAttribute('aria-expanded', nowPinned);
        if (miniRec) miniRec.style.display = nowPinned ? 'none' : '';
        localStorage.setItem('windy_controlsPinned', nowPinned);
      });

      // Keyboard activation for chevron (Enter/Space)
      chevron.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          chevron.click();
        }
      });

      // Mini record button
      if (miniRec) {
        miniRec.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleRecording();
        });
      }
    }

    // Apply saved bottom-panel visibility modes
    this.applyPanelVisibility();
  }

  /**
   * Apply per-bar visibility modes from localStorage.
   * Each bar can be: "always" (pinned), "hover" (reveal on bottom hover), or "hidden".
   */
  applyPanelVisibility() {
    const map = {
      playback: document.getElementById('playbackSlot'),
      export: document.getElementById('exportBar'),
      controls: document.querySelector('.control-bar'),
    };
    const defaults = { playback: 'hover', export: 'hover', controls: 'always' };
    Object.entries(map).forEach(([key, el]) => {
      if (!el) return;
      el.classList.remove('panel-vis-hidden', 'panel-vis-hover');
      const mode = localStorage.getItem('windy_panelVis_' + key) || defaults[key];
      if (mode === 'hidden') el.classList.add('panel-vis-hidden');
      else if (mode === 'hover') el.classList.add('panel-vis-hover');
      // 'always' = no class, uses default layout
    });
  }

  /**
   * Apply a settings-catalog side-effect pushed from main after an
   * agent-initiated set_setting on a renderer-state path. Keeps localStorage
   * in sync AND applies the change live so the UI reflects it immediately.
   * Without this the catalog write would silently persist until next launch.
   */
  applySettingsSideEffect({ path, value }) {
    try {
      switch (path) {
        case 'appearance.theme': {
          const theme = value === 'light' ? 'light' : value === 'auto'
            ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
            : 'dark';
          localStorage.setItem('windy_theme', value);
          document.body.classList.toggle('light-theme', theme === 'light');
          break;
        }
        case 'analytics.enabled':
          localStorage.setItem('windy_analytics', value ? 'true' : 'false');
          break;
        case 'bottomPanel.playback':
        case 'bottomPanel.export':
        case 'bottomPanel.control': {
          // Catalog uses "control" (singular); legacy localStorage key is
          // "controls" (plural). Map it explicitly so we don't break either.
          const lsKey = path === 'bottomPanel.control' ? 'controls' : path.split('.')[1];
          localStorage.setItem('windy_panelVis_' + lsKey, value);
          this.applyPanelVisibility();
          break;
        }
        default:
          console.debug('[settings:apply-side-effect] unhandled path:', path);
      }
    } catch (e) {
      console.warn('[settings:apply-side-effect] failed:', e.message);
    }
  }

  /**
   * Bind IPC events from main process
   */
  bindIPCEvents() {
    // Settings catalog → renderer side-effect bridge
    if (window.windyAPI.onSettingsApplySideEffect) {
      window.windyAPI.onSettingsApplySideEffect((payload) => this.applySettingsSideEffect(payload));
    }
    // Toggle recording from hotkey
    window.windyAPI.onToggleRecording((shouldRecord) => {
      // Use the main process isRecording as the command (source of truth)
      // This prevents state desync between main and renderer
      this._hotkeyTriggered = true;
      if (shouldRecord && !this.isRecording) {
        // Main says START and renderer is idle → start
        this.toggleRecording();
      } else if (!shouldRecord && this.isRecording) {
        // Main says STOP and renderer is recording → stop
        this.toggleRecording();
      } else {
        // Already in sync — force resync main process if needed
        console.debug('[Toggle] Already in sync, isRecording:', this.isRecording);
      }
      this._hotkeyTriggered = false;
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

    // ═══ First-Launch Welcome Overlay ═══
    window.windyAPI.onShowWelcome?.(() => {
      this._showWelcomeOverlay();
    });

    // ═══ Keyboard Shortcuts Modal ═══
    window.windyAPI.onShowKeyboardShortcuts?.(() => {
      this._showKeyboardShortcutsModal();
    });

    // ═══ WindyTune Adaptive Model Notifications ═══
    window.windyAPI.onWindyTuneModelSwitched?.((data) => {
      console.info(`[WindyTune] Model switched: ${data.oldModel} → ${data.newModel}`);
      // Update the persistent badge via the branded formatter (⚡ WindyTune · <model>).
      this.updateModelBadge(data.newModel);
      // Show actionable toast with Undo option — this is the "switching engines"
      // notification the user sees (and a support breadcrumb).
      this._showWindyTuneToast(`⚡ ${data.message}`, data.canUndo ? data.oldModel : null);
    });

    window.windyAPI.onWindyTuneSuggestUpgrade?.((data) => {
      console.info(`[WindyTune] Upgrade suggested: ${data.currentModel} → ${data.suggestedModel}`);
      this._showWindyTuneUpgradeToast(data);
    });
  }

  /**
   * Show first-launch welcome 3-panel overlay
   */
  _showWelcomeOverlay() {
    if (document.getElementById('welcomeOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'welcomeOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Welcome to Windy Word');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);animation:fadeIn .3s ease';
    overlay.innerHTML = `
      <div style="background:#1e293b;border-radius:16px;padding:36px;max-width:460px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.5);position:relative">
        <div id="welcomePanels">
          <div class="welcome-panel" data-step="0">
            <div style="font-size:56px;margin-bottom:16px">🌪️</div>
            <h2 style="font-size:22px;color:#f1f5f9;margin-bottom:8px">Welcome to Windy Word</h2>
            <p style="color:#94a3b8;font-size:14px;line-height:1.6">The most powerful voice-to-text app on the planet. Offline-first, privacy-focused, and blazingly fast.</p>
          </div>
          <div class="welcome-panel" data-step="1" style="display:none">
            <div style="font-size:56px;margin-bottom:16px">🎤</div>
            <h2 style="font-size:22px;color:#f1f5f9;margin-bottom:8px">How to Record</h2>
            <p style="color:#94a3b8;font-size:14px;line-height:1.6">Click the <strong style="color:#22c55e">Record</strong> button or press <strong style="color:#60a5fa">${window.windyAPI?.platform === 'darwin' ? '⌘+Shift+Space' : 'Ctrl+Shift+Space'}</strong> to start recording. Speak naturally — Windy Word transcribes as you go.</p>
          </div>
          <div class="welcome-panel" data-step="2" style="display:none">
            <div style="font-size:56px;margin-bottom:16px">🌐</div>
            <h2 style="font-size:22px;color:#f1f5f9;margin-bottom:8px">Choose Your Language</h2>
            <p style="color:#94a3b8;font-size:14px;line-height:1.6">Windy Word supports 100+ languages. Head to <strong style="color:#60a5fa">Settings</strong> to pick your preferred language and AI model.</p>
          </div>
        </div>
        <div style="display:flex;justify-content:center;gap:8px;margin:20px 0 16px">
          <span class="welcome-dot active" data-dot="0" style="width:8px;height:8px;border-radius:50%;background:#60a5fa;cursor:pointer"></span>
          <span class="welcome-dot" data-dot="1" style="width:8px;height:8px;border-radius:50%;background:#334155;cursor:pointer"></span>
          <span class="welcome-dot" data-dot="2" style="width:8px;height:8px;border-radius:50%;background:#334155;cursor:pointer"></span>
        </div>
        <button id="welcomeNextBtn" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;padding:10px 32px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:transform .1s">Next</button>
      </div>`;
    document.body.appendChild(overlay);

    let currentStep = 0;
    const panels = overlay.querySelectorAll('.welcome-panel');
    const dots = overlay.querySelectorAll('.welcome-dot');
    const btn = overlay.querySelector('#welcomeNextBtn');

    const showStep = (step) => {
      panels.forEach((p, i) => p.style.display = i === step ? 'block' : 'none');
      dots.forEach((d, i) => { d.style.background = i === step ? '#60a5fa' : '#334155'; });
      btn.textContent = step === 2 ? 'Get Started' : 'Next';
      currentStep = step;
    };

    dots.forEach(d => d.addEventListener('click', () => showStep(parseInt(d.dataset.dot))));
    btn.addEventListener('click', () => {
      if (currentStep < 2) { showStep(currentStep + 1); }
      else {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .2s';
        setTimeout(() => overlay.remove(), 200);
        window.windyAPI?.dismissWelcome?.();
      }
    });

    // Escape key closes welcome overlay
    const welcomeEsc = (e) => {
      if (e.key === 'Escape') {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .2s';
        setTimeout(() => overlay.remove(), 200);
        window.windyAPI?.dismissWelcome?.();
        document.removeEventListener('keydown', welcomeEsc);
      }
    };
    document.addEventListener('keydown', welcomeEsc);

    // Focus the next button for keyboard users
    btn.focus();
  }

  /**
   * Show keyboard shortcuts modal
   */
  _showKeyboardShortcutsModal() {
    if (document.getElementById('shortcutsModal')) return;

    const isMac = window.windyAPI?.platform === 'darwin';
    const mod = isMac ? '⌘' : 'Ctrl';
    const overlay = document.createElement('div');
    overlay.id = 'shortcutsModal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    overlay.innerHTML = `
      <div style="background:#1e293b;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,.4)">
        <h2 style="font-size:18px;color:#f1f5f9;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          ⌨️ Keyboard Shortcuts
          <button id="closeShortcuts" style="background:none;border:none;color:#64748b;font-size:20px;cursor:pointer">&times;</button>
        </h2>
        <table style="width:100%;font-size:13px;color:#cbd5e1">
          <tr><td style="padding:6px 0">Toggle Recording</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+Shift+Space</kbd></td></tr>
          <tr><td style="padding:6px 0">Paste Transcript</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+Shift+V</kbd></td></tr>
          <tr><td style="padding:6px 0">Quick Translate</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+Shift+T</kbd></td></tr>
          <tr><td style="padding:6px 0">Show/Hide Window</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+Shift+W</kbd></td></tr>
          ${isMac ? '<tr><td style="padding:6px 0">New Recording</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">⌘+N</kbd></td></tr>' : ''}
          ${isMac ? '<tr><td style="padding:6px 0">Settings</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">⌘+,</kbd></td></tr>' : ''}
          <tr><td style="padding:6px 0">Zoom In</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+=</kbd></td></tr>
          <tr><td style="padding:6px 0">Zoom Out</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+-</kbd></td></tr>
          <tr><td style="padding:6px 0">Reset Zoom</td><td style="text-align:right"><kbd style="background:#0f172a;padding:2px 8px;border-radius:4px;font-size:12px">${mod}+0</kbd></td></tr>
        </table>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.style.opacity = '0'; overlay.style.transition = 'opacity .15s'; setTimeout(() => overlay.remove(), 150); };
    overlay.querySelector('#closeShortcuts').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    const config = await window.windyAPI.getServerConfig();
    const url = `ws://${config.host}:${config.port}`;

    this.setConnectionStatus('connecting');

    try {
      // Detach + close any prior socket before reopening, so reconnect loops don't leak
      // handlers/sockets (e.g. when the backend is briefly unavailable and we retry).
      if (this.ws) {
        try { this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null; } catch (_) {}
        try { this.ws.close(); } catch (_) {}
      }
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.debug('WebSocket connected');
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
        console.debug('WebSocket closed');
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
      console.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
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

  /**
   * Update UI when online/offline state changes.
   * Offline should feel like a MODE (airplane mode), not an error.
   */
  _updateOfflineUI() {
    const dot = this.connectionDot;
    const text = this.connectionText;
    if (this.isOffline) {
      if (dot) { dot.style.background = '#94A3B8'; dot.title = 'Offline'; }
      if (text) text.textContent = '✈️ Offline mode — local features work normally';
      this.showReconnectToast('✈️ You\'re offline. Recording, transcription, and local features work normally. Cloud features will resume when you reconnect.', true);
    } else {
      if (dot) { dot.style.background = ''; dot.title = 'Connected'; }
      if (text) text.textContent = 'Connected';
      // If we just came back online, show a brief "back online" toast
      if (this._wasOffline) {
        this.showReconnectToast('🟢 Back online — syncing cloud features...');
      }
    }
    this._wasOffline = this.isOffline;
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
   * WindyTune: show model-switch toast with optional Undo button
   */
  _showWindyTuneToast(message, undoModel) {
    const toast = document.getElementById('reconnectToast');
    if (!toast) return;

    if (undoModel) {
      toast.innerHTML = `${message} <button id="windytuneUndo" style="margin-left:8px;padding:2px 10px;border-radius:4px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);cursor:pointer;font-size:12px">Undo</button>`;
      toast.style.display = 'block';
      toast.classList.add('visible');

      const undoBtn = document.getElementById('windytuneUndo');
      if (undoBtn) {
        undoBtn.addEventListener('click', () => {
          window.windyAPI.windytuneUndoSwitch?.(undoModel);
          toast.classList.remove('visible');
          setTimeout(() => { toast.style.display = 'none'; }, 300);
        }, { once: true });
      }
    } else {
      toast.textContent = message;
      toast.style.display = 'block';
      toast.classList.add('visible');
    }

    clearTimeout(this._reconnectToastTimer);
    this._reconnectToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => { toast.style.display = 'none'; toast.innerHTML = ''; }, 300);
    }, 8000);
  }

  /**
   * WindyTune: show upgrade suggestion toast with Switch/Keep buttons
   */
  _showWindyTuneUpgradeToast(data) {
    const toast = document.getElementById('reconnectToast');
    if (!toast) return;

    toast.innerHTML = `🎯 ${data.message} ` +
      `<button id="windytuneAccept" style="margin-left:8px;padding:2px 10px;border-radius:4px;background:#00b894;color:#fff;border:none;cursor:pointer;font-size:12px">Switch Now</button>` +
      `<button id="windytuneKeep" style="margin-left:4px;padding:2px 10px;border-radius:4px;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);cursor:pointer;font-size:12px">Keep Current</button>`;
    toast.style.display = 'block';
    toast.classList.add('visible');

    document.getElementById('windytuneAccept')?.addEventListener('click', () => {
      window.windyAPI.windytuneAcceptUpgrade?.(data.suggestedModel);
      toast.classList.remove('visible');
      setTimeout(() => { toast.style.display = 'none'; toast.innerHTML = ''; }, 300);
    }, { once: true });

    document.getElementById('windytuneKeep')?.addEventListener('click', () => {
      toast.classList.remove('visible');
      setTimeout(() => { toast.style.display = 'none'; toast.innerHTML = ''; }, 300);
    }, { once: true });

    // Auto-dismiss after 15s (upgrade is not urgent)
    clearTimeout(this._reconnectToastTimer);
    this._reconnectToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => { toast.style.display = 'none'; toast.innerHTML = ''; }, 300);
    }, 15000);
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
        console.debug('Ack:', msg.action, msg.success);
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
        const _escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        pre.innerHTML = `<span style="color:#22C55E;font-size:11px;opacity:0.7">🔄 Recovered session:</span><br>${_escHtml(content).replace(/\n/g, '<br>')}`;
        this.transcriptContent.appendChild(pre);
        this.transcriptContent.scrollTop = this.transcriptContent.scrollHeight;
      }
      this.transcript.push({ text: content, recovered: true, timestamp: Date.now() });
      banner.remove();
      // Don't delete the file yet — let the user copy/save first
      console.info('[CrashRecovery] Text restored to transcript area');
    });

    // Dismiss: delete recovery file and remove banner
    document.getElementById('recoveryDismiss').addEventListener('click', async () => {
      if (window.windyAPI?.dismissCrashRecovery) {
        await window.windyAPI.dismissCrashRecovery();
      }
      banner.remove();
      console.info('[CrashRecovery] Dismissed and file deleted');
    });
  }

  _setArchiveRouteStatus(route) {
    if (route === 'off') {
      this.setArchiveStatus('Archive off (today)', 'warn');
    } else if (route === 'cloud') {
      this.setArchiveStatus('Route: WindyCloud', 'ok');
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

    // Format accelerator string for display — OS-aware. On macOS, CommandOrControl
    // maps to ⌘ (Command), NOT Ctrl. Showing "Ctrl" on a Mac is a lie that leaves
    // people mashing the wrong key and concluding the app is broken.
    const isMac = (window.windyAPI && window.windyAPI.platform === 'darwin');
    const fmt = (accel) => accel.replace(/CommandOrControl/gi, isMac ? '⌘' : 'Ctrl');

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

  // ── Manual engine override (status-bar badge menu) ───────────────────────
  // WindyTune auto-pilot is the default. Clicking the engine badge opens a menu
  // to pin any installed engine — or return to Auto. Pinning sets engine.engine
  // to a specific id, which makes WindyTune back off (it only auto-switches when
  // engine === 'windytune'). The safety valve for "WindyTune is stuck on a slow
  // model and won't come down." Reuses the proven switch path (updateSettings +
  // WS model hot-reload). Fastest → most accurate.
  // Engine catalog — id ↔ whisper model ↔ friendly name + size. Sizes/notes match
  // the website (TheVault). `model` lets the badge translate the raw whisper model
  // WindyTune is running (e.g. 'small') back into a real engine name (Windy Lite).
  get _engineLadder() {
    return [
      { id: 'windy-nano',       model: 'windy-nano-ct2',       name: 'Windy Nano',  size: '38 MB',  note: 'Fastest · lightest' },
      { id: 'windy-lite',       model: 'windy-lite-ct2',       name: 'Windy Lite',  size: '72 MB',  note: 'Fast · balanced' },
      { id: 'windy-core',       model: 'windy-core-ct2',       name: 'Windy Core',  size: '234 MB', note: 'Balanced everyday driver' },
      { id: 'windy-edge',       model: 'windy-edge-ct2',       name: 'Windy Edge',  size: '727 MB', note: 'High-accuracy workhorse · types in lowercase' },
      { id: 'windy-plus',       model: 'windy-plus-ct2',       name: 'Windy Plus',  size: '734 MB', note: 'Premium accuracy' },
      { id: 'windy-turbo',      model: 'windy-turbo-ct2',      name: 'Windy Turbo', size: '777 MB', note: 'State of the art · 99 languages · types in CAPS' },
      { id: 'windy-pro-engine', model: 'windy-pro-engine-ct2', name: 'Windy Word',  size: '1.5 GB', note: 'Flagship · most accurate' },
    ];
  }

  _setupEngineMenu() {
    const badge = document.getElementById('modelBadge');
    if (!badge) return;
    // Make the badge read + feel like a real button — it opens the engine menu.
    const REST = 'rgba(167,139,250,0.14)';
    const HOVER = 'rgba(167,139,250,0.28)';
    badge.style.cursor = 'pointer';
    badge.style.userSelect = 'none';
    badge.style.background = REST;
    badge.style.borderColor = 'rgba(167,139,250,0.55)';
    badge.style.padding = '3px 10px';
    badge.style.fontWeight = '600';
    badge.style.transition = 'background .15s, border-color .15s, transform .05s';
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-haspopup', 'menu');
    badge.addEventListener('mouseenter', () => { badge.style.background = HOVER; badge.style.borderColor = 'rgba(167,139,250,0.85)'; });
    badge.addEventListener('mouseleave', () => { badge.style.background = REST; badge.style.borderColor = 'rgba(167,139,250,0.55)'; });
    badge.addEventListener('mousedown', () => { badge.style.transform = 'scale(0.96)'; });
    badge.addEventListener('mouseup', () => { badge.style.transform = 'scale(1)'; });
    badge.addEventListener('click', (e) => { e.stopPropagation(); this._toggleEngineMenu(); });
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleEngineMenu(); }
    });
  }

  _toggleEngineMenu() {
    const existing = document.getElementById('engineMenu');
    if (existing) { existing.remove(); return; }
    const badge = document.getElementById('modelBadge');
    if (!badge) return;

    const current = localStorage.getItem('windy_engine') || 'windytune';
    const isAuto = current === 'windytune' || current === 'local';

    const menu = document.createElement('div');
    menu.id = 'engineMenu';
    menu.style.cssText =
      'position:fixed;z-index:100000;background:#11161f;border:1px solid #2a3340;' +
      'border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.55);padding:6px;' +
      'width:288px;max-height:72vh;overflow:auto;font-size:13px;';

    // Clear close (✕) affordance — top-right of the menu.
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'position:sticky;top:0;float:right;margin:-2px -2px 0 0;width:24px;height:24px;border:none;' +
      'background:rgba(255,255,255,0.06);color:#9aa6b2;border-radius:6px;cursor:pointer;' +
      'font-size:12px;line-height:1;z-index:1;';
    closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.16)'; closeBtn.style.color = '#fff'; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255,255,255,0.06)'; closeBtn.style.color = '#9aa6b2'; };
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); });
    menu.appendChild(closeBtn);

    const mkRow = (id, name, note, size, selected) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText =
        'display:flex;align-items:center;gap:10px;width:100%;text-align:left;' +
        'background:' + (selected ? 'rgba(245,158,11,0.12)' : 'transparent') + ';' +
        'border:1px solid ' + (selected ? 'rgba(245,158,11,0.35)' : 'transparent') + ';' +
        'border-radius:8px;padding:8px 10px;margin:2px 0;cursor:pointer;color:#e8edf2;';
      row.onmouseenter = () => { if (!selected) row.style.background = 'rgba(255,255,255,0.05)'; };
      row.onmouseleave = () => { if (!selected) row.style.background = 'transparent'; };
      row.innerHTML =
        '<span style="width:16px;flex:none;color:#F59E0B">' + (selected ? '✓' : '') + '</span>' +
        '<span style="flex:1">' +
          '<span style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
            '<span style="font-weight:600">' + name + '</span>' +
            (size ? '<span style="color:#8b97a5;font-size:11px;white-space:nowrap">' + size + '</span>' : '') +
          '</span>' +
          '<span style="display:block;color:#8b97a5;font-size:11px;margin-top:1px">' + note + '</span>' +
        '</span>';
      row.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); this.setEngine(id); });
      return row;
    };

    menu.appendChild(mkRow('windytune', '⚡ Auto — WindyTune', 'Picks the best engine for your machine', '', isAuto));

    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:#2a3340;margin:6px 4px;';
    menu.appendChild(divider);
    const hdr = document.createElement('div');
    hdr.textContent = 'Pin a specific engine';
    hdr.style.cssText = 'color:#6b7785;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:4px 10px 6px;';
    menu.appendChild(hdr);

    for (const e of this._engineLadder) {
      menu.appendChild(mkRow(e.id, e.name, e.note, e.size, !isAuto && current === e.id));
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'color:#6b7785;font-size:10px;padding:8px 10px 4px;border-top:1px solid #2a3340;margin-top:6px;';
    foot.textContent = 'Auto adapts to your hardware. Pin one for full control — Back to Auto anytime.';
    menu.appendChild(foot);

    document.body.appendChild(menu);

    // Position anchored to the badge (prefer above; flip below if no room).
    const r = badge.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    let top = r.top - mh - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - mh - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    const close = (ev) => {
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      if (ev.type === 'click' && menu.contains(ev.target)) return;
      menu.remove();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => {
      document.addEventListener('click', close, true);
      document.addEventListener('keydown', close, true);
    }, 0);
  }

  /**
   * Switch the transcription engine. engineId 'windytune' = Auto (re-enables
   * WindyTune); any other id pins that engine (WindyTune backs off). Persists to
   * the main store (engine.engine + engine.model) and hot-reloads the Python
   * model over the existing WS — the same mechanism WindyTune uses internally.
   */
  setEngine(engineId) {
    const isAuto = engineId === 'windytune';
    const model = (this._engineModelMap && this._engineModelMap[engineId]) || 'base';
    // ── Tank-proof guard ──────────────────────────────────────────────────
    // Only switch to a model that's actually bundled on the machine. Picking an
    // un-bundled engine would make faster-whisper start a silent multi-GB download
    // and the engine would appear to "hang" — the exact wobble we're killing.
    // The Reader edition ships all 7 lean engines offline, so the full ladder is
    // live; `base` is the always-present WindyTune default.
    const BUNDLED_MODELS = ['base',
      'windy-nano-ct2', 'windy-lite-ct2', 'windy-core-ct2', 'windy-edge-ct2',
      'windy-plus-ct2', 'windy-turbo-ct2', 'windy-pro-engine-ct2'];
    if (!isAuto && !BUNDLED_MODELS.includes(model)) {
      const eng = this._engineLadder.find(e => e.id === engineId);
      if (typeof this.showReconnectToast === 'function') {
        this.showReconnectToast(`⬇ ${eng ? eng.name : engineId}${eng?.size ? ' (' + eng.size + ')' : ''} ships in the full engine pack — coming soon. Keeping your current engine so nothing stalls.`);
      }
      return; // do NOT switch — prevents the silent download/hang
    }
    this.transcriptionEngine = engineId;
    try {
      if (window.windyAPI?.updateSettings) window.windyAPI.updateSettings({ engine: engineId, model });
    } catch (_) { /* settings persist best-effort */ }
    try {
      localStorage.setItem('windy_engine', engineId);
      if (model) localStorage.setItem('windy_model', model);
    } catch (_) { /* localStorage best-effort */ }
    // Hot-reload the model on the Python server (same message the settings panel
    // and WindyTune use). If the socket isn't open, the persisted setting applies
    // on the next connect.
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && model) {
        this.send('config', { config: { model } });
      }
    } catch (_) { /* ws best-effort */ }
    this.updateModelBadge(engineId);
    const label = isAuto
      ? 'Auto — WindyTune'
      : (this._engineLadder.find(e => e.id === engineId)?.name || engineId);
    if (typeof this.showReconnectToast === 'function') {
      this.showReconnectToast(isAuto
        ? '⚡ Back to Auto — WindyTune will pick the best engine for your machine'
        : `⚡ Engine pinned: ${label}`);
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
      'windy-nano': '⚡', 'windy-lite': '⚡', 'windy-core': '⚡', 'windy-edge': '⚡', 'windy-plus': '⚡', 'windy-turbo': '⚡', 'windy-pro-engine': '⚡',
      'windy-nano-cpu': '🛡️', 'windy-lite-cpu': '🛡️', 'windy-core-cpu': '🛡️', 'windy-edge-cpu': '🛡️', 'windy-plus-cpu': '🛡️', 'windy-turbo-cpu': '🛡️', 'windy-pro-engine-cpu': '🛡️',
      'windy-translate-spark': '🌍', 'windy-translate-standard': '🌍'
    };

    if (loading) {
      const icon = engineIcons[activeEngine] || '🏠';
      badge.textContent = `${icon} ${message || 'Loading...'}`;
      badge.classList.add('loading');
      return;
    }

    // WindyTune (Auto) + the manual engine ladder. Translate the raw whisper model
    // into a real engine NAME + size (e.g. model 'small' → "Windy Lite (72 MB)") so
    // the badge never shows an internal model name the user can't find in the menu.
    // Trailing ▾ signals the badge is a clickable engine switcher.
    {
      const ladder = this._engineLadder;
      const byId = {}, byModel = {};
      ladder.forEach(e => { byId[e.id] = e; byModel[e.model] = e; });
      const auto = activeEngine === 'windytune' || activeEngine === 'local';
      if (auto || (activeEngine in byId)) {
        let eng;
        if (auto) {
          // Reflect whichever model WindyTune is actually running (default small/Lite).
          const m = (modelName && byModel[modelName]) ? modelName
            : ((this._engineModelMap && this._engineModelMap['windytune']) || 'base');
          // WindyTune runs the bundled multilingual `base`, which has no ladder
          // entry — present it as the Core engine so the badge stays human-readable.
          eng = byModel[m] || byId['windy-core'];
        } else {
          eng = byId[activeEngine];
        }
        const label = eng ? `${eng.name} (${eng.size})` : 'engine';
        badge.textContent = (auto ? `⚡ WindyTune · ${label}` : `⚡ ${label}`) + ' ▾';
        badge.title = auto
          ? `WindyTune (auto) — currently running ${eng ? eng.name : 'an engine'}. Click to pin a specific engine.`
          : `Manual: ${eng ? eng.name : activeEngine}. Click to change or return to Auto.`;
        badge.classList.remove('loading');
        return;
      }
    }

    // Cloud API engines — always show engine name
    if (isCloudEngine && !isCustomEngine) {
      const icon = engineIcons[activeEngine] || '☁️';
      badge.textContent = `${icon} ${activeEngine}`;
      badge.title = `Engine: ${activeEngine}`;
      badge.classList.remove('loading');
      return;
    }

    // Custom named engine (windy-pro-engine, windy-core-cpu, etc.) — ALWAYS show engine name, never raw model
    if (isCustomEngine) {
      const icon = engineIcons[activeEngine] || '⚡';
      const engineModel = this._engineModelMap[activeEngine];
      const size = modelSizes[engineModel] || '';
      badge.textContent = size ? `${icon} ${activeEngine} (${size})` : `${icon} ${activeEngine}`;
      badge.title = size ? `Engine: ${activeEngine} (${size})` : `Engine: ${activeEngine}`;
      badge.classList.remove('loading');
      return;
    }

    // 'local' auto-detect == WindyTune auto mode: the engine is WindyTune and it
    // auto-picks the model. Brand the badge so the user ALWAYS sees that WindyTune
    // is active AND which model it's currently running — the value-prop made
    // visible, and a support signal ("what engine were you on?").
    const name = modelName || 'unknown';
    const size = modelSizes[name.toLowerCase()];
    const label = `WindyTune · ${name}`;
    badge.textContent = size ? `⚡ ${label} (${size})` : `⚡ ${label}`;
    badge.title = `WindyTune (auto) — currently running ${name}${size ? ' (' + size + ')' : ''}. `
      + `Switches models automatically for the best speed/accuracy on your hardware.`;
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

    // Determine transcription mode
    const tMode = this.transcriptionMode || localStorage.getItem('windy_transcriptionMode') || 'auto';

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
      'windy-nano': '⚡', 'windy-lite': '⚡', 'windy-core': '⚡', 'windy-edge': '⚡', 'windy-plus': '⚡', 'windy-turbo': '⚡', 'windy-pro-engine': '⚡',
      'windy-nano-cpu': '🛡️', 'windy-lite-cpu': '🛡️', 'windy-core-cpu': '🛡️', 'windy-edge-cpu': '🛡️', 'windy-plus-cpu': '🛡️', 'windy-turbo-cpu': '🛡️', 'windy-pro-engine-cpu': '🛡️',
      'windy-translate-spark': '🌍', 'windy-translate-standard': '🌍'
    };
    const engineIcon = engineIcons[activeEngine] || '🏠';

    if (msg.status === 'slow') {
      badge.textContent = `${engineIcon} ${displayName} ⚠️ slow`;
      badge.classList.add('loading');
      badge.title = `Performance ratio: ${msg.ratio}x (>1.0 = too slow)`;

      // Track slow streaks for WindyTune auto-pilot
      this._slowStreak = (this._slowStreak || 0) + 1;

      // WindyTune auto-downgrade is handled AUTHORITATIVELY in the main process
      // (_windyTuneRecord in main.js), which steps only through BUNDLED engines so it
      // can never select a non-bundled model and trigger an offline HuggingFace fetch.
      // The old renderer ladder here used raw whisper names (e.g. 'tiny') that aren't
      // bundled — it poisoned windy_model and showed a misleading toast. Removed.
      if (activeEngine === 'windytune' && this._slowStreak >= 3) {
        this._slowStreak = 0;
      }

      // Cloud failover logic — respects transcription mode setting
      if (tMode === 'local_only') {
        // Local only: never failover to cloud, just show suggestions
        const suggestions = [];
        const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';
        if (recordingMode !== 'batch') {
          suggestions.push('Switch to Batch mode for best accuracy');
        }
        const modelSizeMB = { 'large-v3': 2945, 'windy-pro-engine': 2945, 'turbo': 1544, 'windy-turbo': 1544, 'medium': 1444, 'windy-edge': 1444, 'small': 140, 'windy-lite': 140, 'base': 462, 'windy-core': 462, 'tiny': 73, 'windy-nano': 73 };
        const currentModelSize = modelSizeMB[msg.model] || 0;
        if (currentModelSize > 500) {
          suggestions.push('Try Windy Core (462MB, balanced)');
        } else if (currentModelSize > 150) {
          suggestions.push('Try Windy Lite (140MB) for faster dictation');
        }
        const tip = suggestions.length > 0 ? ` 💡 ${suggestions[0]}` : '';
        this.showReconnectToast(`⚠️ ${displayName} is struggling.${tip}`);
      } else if (tMode === 'auto' && msg.ratio > 2.0 && !this._usingCloud && this.cloudUrl) {
        // Auto mode: failover to cloud when performance_ratio > 2.0
        this._usingCloud = true;
        this.showReconnectToast('Switching to cloud for better performance...');
        this.connectCloudWS().then(() => {
          badge.textContent = `☁️🔒 cloud ✅`;
          badge.classList.remove('loading');
          this.showReconnectToast('☁️ Auto mode: switched to cloud transcription');
        }).catch(() => {
          this._usingCloud = false;
          this.showReconnectToast('⚠️ Cloud unavailable. Continuing local.');
        });
      } else if (this.transcriptionEngine === 'smart' && !this._usingCloud && this.cloudUrl) {
        // Legacy smart mode: auto-switch to cloud if struggling
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
        // Actionable performance suggestions (auto mode below threshold, or no cloud configured)
        const suggestions = [];
        const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';
        if (recordingMode !== 'batch') {
          suggestions.push('Switch to Batch mode for best accuracy');
        }
        const modelSizeMB = { 'large-v3': 2945, 'windy-pro-engine': 2945, 'turbo': 1544, 'windy-turbo': 1544, 'medium': 1444, 'windy-edge': 1444, 'small': 140, 'windy-lite': 140, 'base': 462, 'windy-core': 462, 'tiny': 73, 'windy-nano': 73 };
        const currentModelSize = modelSizeMB[msg.model] || 0;
        if (currentModelSize > 500) {
          suggestions.push('Try Windy Core (462MB, balanced)');
        } else if (currentModelSize > 150) {
          suggestions.push('Try Windy Lite (140MB) for faster dictation');
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
        console.debug('[Cloud] Token refreshed');
        return;
      }
    } catch (e) {
      console.warn('[Cloud] Token refresh failed:', e.message, '— using existing token');
    }
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
          console.debug('[Cloud] Authenticated via REST login');
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

    // Step 2: Connect WS and authenticate via first-message pattern (H2 fix: no token in query params)
    return new Promise((resolve, reject) => {
      const baseUrl = this.cloudUrl.replace(/\/$/, '') + '/ws/transcribe';
      console.debug('[Cloud] Connecting (token present)');
      this.cloudWs = new WebSocket(baseUrl);
      this.cloudWs.binaryType = 'arraybuffer';
      let startSent = false;
      let resolved = false;

      this.cloudWs.onopen = () => {
        console.debug('[Cloud] WebSocket opened, sending auth message');
        // Send token as first message instead of query parameter
        this.cloudWs.send(JSON.stringify({ action: 'auth', token: this.cloudToken }));
      };

      this.cloudWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.debug('[Cloud] <- ' + msg.type);

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
              console.debug('[Cloud] Got welcome, sending start...');
              this.cloudWs.send(JSON.stringify({ action: 'start' }));
            }
            // When server confirms listening, resolve
            if (msg.state === 'listening' && !resolved) {
              resolved = true;
              console.debug('[Cloud] Server is listening — ready for audio ✅');
              resolve();
            }
          } else if (msg.type === 'ack') {
            // Some server versions send ack instead of state:listening
            if (!resolved) {
              resolved = true;
              console.debug('[Cloud] Server acknowledged start ✅');
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
        console.debug(`[Cloud] Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
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
      } catch (e) { console.debug('[Cloud] WS send failed during disconnect:', e.message); }
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
        this.showReconnectToast('✈️ You\'re offline — recording locally. Cloud features will resume when you reconnect.');
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
      } catch (e) { console.debug('[Stream] SpeechRecognition.stop() error:', e.message); }
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
  //  Mic pre-warming (Wayland focus protection)
  // ═══════════════════════════════════════════════

  async _prewarmMic() {
    // Linux only. macOS uses _lastFocusedPid + osascript to recover focus;
    // Windows doesn't have this problem. On Linux (Wayland especially), the
    // first getUserMedia steals focus through XWayland → Mutter and there is
    // no API to give it back. So we acquire the stream once and never let go.
    if (window.windyAPI?.platform !== 'linux') return;
    if (this._prewarmedStream && this._prewarmedStream.active) return;
    try {
      const audioConstraints = {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      this._prewarmedStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // Pre-warm the AudioContext + analyser pipeline too. CLAUDE.md flags
      // AudioContext creation as a separate focus-steal source on Wayland.
      // Creating it once at boot and reusing it across recordings sidesteps that.
      this._prewarmedAudioCtx = new AudioContext();
      const source = this._prewarmedAudioCtx.createMediaStreamSource(this._prewarmedStream);
      this._prewarmedAnalyser = this._prewarmedAudioCtx.createAnalyser();
      this._prewarmedAnalyser.fftSize = 256;
      source.connect(this._prewarmedAnalyser);

      console.warn('[PreWarm] Mic + AudioContext cached at boot — Wayland focus protection active');
    } catch (e) {
      console.warn('[PreWarm] Failed to pre-warm (will fall back to fresh getUserMedia):', e.message);
      this._prewarmedStream = null;
      this._prewarmedAudioCtx = null;
      this._prewarmedAnalyser = null;
    }
  }

  // ═══════════════════════════════════════════════
  //  Batch Mode Recording
  // ═══════════════════════════════════════════════

  /**
   * Start batch recording — captures full audio, processes on stop.
   * Uses MediaRecorder for high-quality capture.
   */
  async startBatchRecording() {
    console.error('[Batch] ▶ startBatchRecording() entered');

    // ═══ INSTANT UI FEEDBACK ═══
    // Show green strobe IMMEDIATELY — don't wait for getUserMedia/IPC.
    // This eliminates the 1.5-2s perceived delay.
    this.isRecording = true;
    this.setState('listening');
    this.transcriptContent.contentEditable = 'false';

    try {
      // 0. Feature gating — check tier limits
      let tierLimits = null;
      try {
        if (window.windyAPI?.getCurrentTier) {
          const tierInfo = await window.windyAPI.getCurrentTier();
          tierLimits = tierInfo?.limits;
          if (tierLimits && !tierLimits.batchMode) {
            // Batch mode is now available on all tiers — no gate needed
          }
          // Recording length: UNLIMITED in the free book-launch build — no tier clamp and
          // no upgrade nag. (Removed the maxMinutes downgrade + upsell toast.)
        }
      } catch (e) { console.warn('[TierLimits] Failed to enforce plan limits:', e.message); }

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
      // Reuse the pre-warmed stream when possible (Linux/Wayland focus
      // protection). Fall back to fresh getUserMedia if no cache exists or
      // the user picked a non-default mic device.
      let stream;
      let usingPrewarmed = false;
      const wantsCustomDevice = !!audioConstraints.deviceId;
      if (this._prewarmedStream && this._prewarmedStream.active && !wantsCustomDevice) {
        stream = this._prewarmedStream;
        usingPrewarmed = true;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      }

      // ═══ FOCUS RESTORE ═══
      // getUserMedia just stole focus from the target app.
      // Tell main process to restore it NOW — cursor appears within ~100ms.
      // (No-op on Wayland when usingPrewarmed=true: nothing to restore.)
      if (!usingPrewarmed && window.windyAPI?.restoreFocus) {
        window.windyAPI.restoreFocus();
      }

      // 2. Use MediaRecorder to capture full audio
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      this._batchRecorder = new MediaRecorder(stream, { mimeType });
      this._batchChunks = [];

      this._batchRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this._batchChunks.push(e.data);
      };

      // 3. Record continuously (timeslice = 1000ms for reliable data capture)
      //    Without timeslice, Electron's MediaRecorder produces near-empty blobs
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
        // A2: Video is OPT-IN. The webcam getUserMedia(video), the video
        // MediaRecorder, AND the camera preview window are ALL gated behind
        // saveVideo === true. When settings.saveVideo is undefined/false,
        // videoEnabled stays false → no camera capture, no recording, and no
        // preview panel is shown during normal voice dictation.
        let videoEnabled = false;
        if (window.windyAPI) {
          const settings = await window.windyAPI.getSettings();
          videoEnabled = settings?.saveVideo === true;
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
            console.debug(`[Video] Camera confirmed: ${actualW}x${actualH} (${actualLabel})`);
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
          console.debug('[Batch] Video recording started (' + videoQuality + ', ' + videoMime + ')');

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

      // 4. Max-duration auto-stop — DISABLED for the free book-launch build: recording is
      //    UNLIMITED (the dictate-a-whole-book use case). The mic indicator signals recording
      //    health; long-session memory behavior is verified in launch hardening.
      //    (clone_capture was already unlimited via this same path.)
      const currentRecMode = localStorage.getItem('windy_recordingMode') || 'batch';

      // 5b. Voice level monitoring for mini widget strobe
      try {
        // Reuse the pre-warmed AudioContext when its source is the same stream.
        // Creating a fresh AudioContext on Wayland triggers another focus steal.
        if (usingPrewarmed && this._prewarmedAudioCtx && this._prewarmedAnalyser) {
          this._batchAudioCtx = this._prewarmedAudioCtx;
          this._batchAnalyser = this._prewarmedAnalyser;
        } else {
          this._batchAudioCtx = new AudioContext();
          const source = this._batchAudioCtx.createMediaStreamSource(stream);
          this._batchAnalyser = this._batchAudioCtx.createAnalyser();
          this._batchAnalyser.fftSize = 256;
          source.connect(this._batchAnalyser);
        }
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

      // 6. UI state (already set at top for instant feedback)
      // Only "own" the stream for cleanup if we acquired it this call.
      // Pre-warmed streams persist across recordings — don't stop their tracks.
      this._batchStream = usingPrewarmed ? null : stream;
      this.recordingStartedAt = new Date().toISOString();

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
          'No transcription model loaded — near-zero CPU<br>Unlimited local recording</span></p>';
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
      console.debug('[Batch] Recording started');
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
        // macOS never re-prompts once mic access is denied, so a vague transient toast
        // left the app silently non-functional with no way forward. Give an explicit,
        // per-OS recovery path and keep it on screen (persistent) until the next action.
        const p = (navigator.platform || '').toLowerCase();
        const where = p.includes('mac')
          ? 'System Settings ▸ Privacy & Security ▸ Microphone, then turn on Windy Word'
          : p.includes('win')
            ? 'Settings ▸ Privacy & security ▸ Microphone, then allow Windy Word'
            : 'your system Settings ▸ Privacy ▸ Microphone, then allow Windy Word';
        this.showReconnectToast(`🚫 Microphone access is blocked — Windy Word can't hear you. Enable it in ${where}, then press the shortcut again.`, true);
      } else {
        this.showReconnectToast('⚠️ Could not access the microphone. Make sure no other app is using it, then try again.');
      }
    }
  }

  /**
   * Stop batch recording and send audio for processing.
   */
  async stopBatchRecording() {
    console.error('[Batch] ⏹ stopBatchRecording() entered, recorder state:', this._batchRecorder?.state);
    // Clear timers
    clearTimeout(this._batchMaxTimer);
    clearTimeout(this._batchWarnTimer);

    // Stop voice level monitoring
    if (this._voiceLevelInterval) {
      clearInterval(this._voiceLevelInterval);
      this._voiceLevelInterval = null;
    }
    if (this._batchAudioCtx) {
      // Don't close the pre-warmed AudioContext — it persists across recordings
      // to avoid a focus-stealing recreation on Wayland.
      if (this._batchAudioCtx !== this._prewarmedAudioCtx) {
        try { this._batchAudioCtx.close(); } catch (_) { }
      }
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
        const chunkCount = this._batchChunks.length;
        const chunkSizes = this._batchChunks.map(c => c.size);
        const audioBlob = new Blob(this._batchChunks, { type: this._batchRecorder.mimeType });
        this._batchChunks = [];
        this._lastBatchBlob = audioBlob;  // Save for audio playback
        console.info(`[Batch] Audio blob: ${(audioBlob.size / 1024).toFixed(1)}KB from ${chunkCount} chunks (sizes: ${chunkSizes.map(s => (s/1024).toFixed(1)+'KB').join(', ')})`);

        // Notify main process that recording stopped (keeps isRecording in sync for UI-button stops)
        if (window.windyAPI?.notifyRecordingStopped) {
          window.windyAPI.notifyRecordingStopped();
        }

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
          console.debug(`[Batch] Video blob: ${(videoBlob.size / 1024).toFixed(0)}KB`);
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
          // Archive the audio + video via the PROVEN archiveAudio/archiveVideo
          // handlers. The old `archiveRecording` channel was never exposed in
          // preload (and had no main handler), so Clone Capture silently discarded
          // its recording. _saveAudioRecording/_saveVideoRecording reuse the same
          // base64 chunking + archive-audio/archive-video IPC the batch path uses.
          try {
            const cloneTs = new Date(this._batchStartTime || Date.now()).toISOString();
            if (audioBlob) await this._saveAudioRecording(audioBlob, cloneTs);
            if (videoBlob) await this._saveVideoRecording(videoBlob, cloneTs);
            console.info('[CloneCapture] Archived audio' + (videoBlob ? '+video' : '') + ':', durationStr);
          } catch (archErr) {
            console.warn('[CloneCapture] Archive error:', archErr.message);
          }
          return;
        }

        // ═══ A3: Too-short guard ═══
        // If the user only tapped the shortcut (recording < 600ms), there's no
        // real speech to transcribe — a sub-second clip often yields a stray
        // "v"/garbage. Skip transcribe/paste and tell the user to hold longer.
        const elapsedMs = (typeof performance !== 'undefined' ? performance.now() + performance.timeOrigin : Date.now()) - (this._batchStartTime || Date.now());
        if (elapsedMs < 600) {
          console.info(`[Batch] Too short (${Math.round(elapsedMs)}ms) — skipping transcribe/paste`);
          this.setState('idle');
          this.transcriptContent.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">⚠️ Too quick — hold the shortcut a moment longer.</p>';
          this.showReconnectToast('⚠️ Too quick — I did not catch that. Hold the shortcut a moment longer.');
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
            // Gate: Cloud Processing requires active subscription (not lifetime)
            if (window.windyAPI?.getCurrentTier) {
              const tierInfo = await window.windyAPI.getCurrentTier();
              if (tierInfo?.billingType === 'lifetime') {
                this.showReconnectToast('☁️ Cloud Processing requires an active subscription (Monthly or Annual). Lifetime plans include local engines only. Switch to a local engine in Settings.');
                return;
              }
            }
            // Use WindyPro Cloud batch endpoint
            result = await this._batchTranscribeCloud(audioBlob);
          } else if (engine === 'groq') {
            const groqKey = window.windyAPI ? await window.windyAPI.getApiKey('groqApiKey') : '';
            result = await this._transcribeWithApi('groq', groqKey, audioBlob);
          } else if (engine === 'openai') {
            const openaiKey = window.windyAPI ? await window.windyAPI.getApiKey('openaiApiKey') : '';
            result = await this._transcribeWithApi('openai', openaiKey, audioBlob);
          } else {
            // Unknown engine — default to local
            result = await this._batchTranscribeLocal(audioBlob);
          }

          // ═══ WindyTune: Auto-downgrade if batch took > 30s ═══
          const batchDuration = (Date.now() - batchStartMs) / 1000;
          console.debug(`[Batch] Transcription completed in ${batchDuration.toFixed(1)}s`);

          // WindyTune batch auto-downgrade is handled AUTHORITATIVELY in the main
          // process (_windyTuneRecord in main.js, invoked per batch at the WS result),
          // which steps only through BUNDLED engines. The old renderer ladder here used
          // raw whisper names (e.g. 'tiny') that aren't bundled offline — removed to
          // avoid poisoning windy_model, a misleading toast, and a failed model load.

          // Display polished result
          this._displayBatchResult(result);
        } catch (err) {
          console.error('[Batch] Transcription failed:', err);
          // Persist the recording even though transcription failed — otherwise a long
          // (dictate-a-whole-book) session is lost on any transcribe error. The SUCCESS
          // path saves in _displayBatchResult; this covers the FAILURE path only, so
          // there is no double-save. Best-effort + honestly gated on the save-audio pref.
          const recordingSaved = localStorage.getItem('windy_saveAudio') !== 'false' && !!audioBlob;
          if (recordingSaved) {
            try {
              const failTs = this.recordingStartedAt || new Date(this._batchStartTime || Date.now()).toISOString();
              await this._saveAudioRecording(audioBlob, failTs);
            } catch (saveErr) {
              console.warn('[Batch] Could not persist recording after failure:', saveErr.message);
            }
          }
          this.showReconnectToast(`⚠️ Processing failed: ${err.message}`);
          // Clear the processing spinner from transcript area
          this.transcriptContent.innerHTML = `<p style="color:#EF4444;text-align:center;padding:20px;">⚠️ Transcription failed<br><span style="font-size:12px;color:#888;">${err.message}${recordingSaved ? ' — your recording was saved.' : ''}</span></p>`;
          this.setState('error');
          setTimeout(() => this.setState('idle'), 3000);
        } finally {
          // Always clean up the processing effect interval
          clearInterval(this._processEffectInterval);
          // Always tell main the batch phase is over — even on error or early-return paths.
          // This clears global._batchProcessing so the macOS focus keepalive can stop;
          // without it (the old error path) the keepalive leaked and trapped the window.
          if (window.windyAPI?.notifyBatchComplete) {
            try { window.windyAPI.notifyBatchComplete(0); } catch (_) { }
          }
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
      // Convert blob to base64 and send to main process for transcription.
      // Chunked (8KB) conversion: a byte-by-byte `String.fromCharCode(uint8[i])`
      // loop here froze / OOM'd the renderer on long (dictate-a-whole-book)
      // recordings. This mirrors the proven chunking in _saveAudioRecording /
      // _saveVideoRecording; the base64 output is byte-identical, so the
      // 'batch-transcribe-local' IPC contract is unchanged.
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
        binary += String.fromCharCode.apply(null, chunk);
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
    const cloudUrl = (this.cloudUrl || localStorage.getItem('windy_cloudUrl') || (window.API_CONFIG || {}).baseUrl || 'https://windyword.ai')
      .replace('wss://', 'https://');

    if (!token) {
      throw new Error('Not signed in to WindyPro Cloud. Open Settings to sign in.');
    }

    console.debug(`[Batch] Uploading ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB to cloud`);

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
      // A3: also surface as a toast so the user notices the empty result.
      this.showReconnectToast('⚠️ No speech detected — try again, a little louder.');
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
          const pasteResult = await window.windyAPI.autoPasteText(text.trim());
          if (!pasteResult) {
            // Paste failed (no target PID or target not reachable)
            // Text is already archived and on clipboard — show toast and clear after brief delay
            console.warn('[AutoPaste] Paste returned false — text on clipboard and archived. Use Cmd+V to paste.');
            this.showReconnectToast('📋 Text copied to clipboard — use Cmd+V to paste');
            // Still clear after 3s since text is archived and on clipboard
            setTimeout(() => this.clearTranscript(), 3000);
          } else {
            // A3: paste succeeded — reassure the user the transcript is also on
            // the clipboard. The macOS paste keystroke can rarely drop Cmd and
            // type a literal "v"; since the real text is always on the clipboard
            // (tank rule), a stray "v" never means the app is broken.
            const pastedWords = text.trim().split(/\s+/).filter(Boolean).length;
            this.showReconnectToast(`✓ Pasted ${pastedWords} word${pastedWords === 1 ? '' : 's'} · also on clipboard (Cmd V if needed)`);
          }
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
          this.showReconnectToast('📋 Text on clipboard — use Cmd+V to paste manually');
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
      fetch((window.API_CONFIG || {}).analytics || 'https://windyword.ai/api/v1/analytics', {
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

    // P1-1: Revoke previous Blob URL to prevent memory leak
    if (this._lastPlaybackUrl) {
      URL.revokeObjectURL(this._lastPlaybackUrl);
      this._lastPlaybackUrl = null;
    }
    // Revoke previous video playback URL in parallel with the audio one.
    if (this._lastPlaybackVideoUrl) {
      URL.revokeObjectURL(this._lastPlaybackVideoUrl);
      this._lastPlaybackVideoUrl = null;
    }
    const audioUrl = URL.createObjectURL(blob);
    this._lastPlaybackUrl = audioUrl;
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
          console.debug(`[Video] Saved: ${result.path}`);
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

    // Additively inject a <video> when a screen/video recording was captured
    // for this session. Gated strictly on _lastVideoBlob so the audio-only
    // path is unchanged. Uses a separate object URL tracked + revoked in
    // parallel with _lastPlaybackUrl (see _saveAudioRecording).
    if (this._lastVideoBlob) {
      const videoUrl = URL.createObjectURL(this._lastVideoBlob);
      this._lastPlaybackVideoUrl = videoUrl;
      const video = document.createElement('video');
      video.controls = true;
      video.src = videoUrl;
      video.preload = 'metadata';
      video.style.cssText = 'flex:1;max-height:160px;border-radius:6px;';
      bar.appendChild(video);
    }

    // Insert into the persistent playback slot
    const slot = document.getElementById('playbackSlot');
    if (slot) {
      slot.innerHTML = '';
      slot.appendChild(bar);
    }
  }

  /**
   * Show export buttons after batch transcription.
   */
  _showExportButtons(text) {
    // Bind the always-present export buttons to the current transcript text
    const container = document.getElementById('exportButtons');
    if (!container) return;
    container.querySelectorAll('.export-btn').forEach(btn => {
      // Clone to remove old listeners
      const fresh = btn.cloneNode(true);
      fresh.addEventListener('click', () => this._exportTranscript(text, fresh.dataset.format));
      btn.parentNode.replaceChild(fresh, btn);
    });
  }

  /**
   * Export transcript in specified format.
   */
  async _exportTranscript(text, format) {
    if (!text || !text.trim()) {
      this.showReconnectToast('⚠️ Nothing to export yet');
      return;
    }
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

    // Delegate to the pure transcript-format module (extracted in P4
    // so the format helpers can be unit-tested without spinning up
    // the renderer). Keep the WindyDateUtils preference for Markdown
    // headers — module's default is plain toLocaleString.
    const fmt = window.WindyTranscriptFormat;
    let content, defaultName, filters;
    const now = new Date();
    defaultName = fmt ? fmt.defaultFilenameFor(format, now)
      : `transcript-${now.toISOString().slice(0, 19).replace(/:/g, '-')}.${format}`;

    if (format === 'txt') {
      content = fmt ? fmt.toTxt(text) : text;
      filters = [{ name: 'Text', extensions: ['txt'] }];
    } else if (format === 'md') {
      // Allow WindyDateUtils to override the Markdown header timestamp
      // when present (matches the pre-refactor wording).
      if (fmt) {
        if (window.WindyDateUtils) {
          // Inline path mirrors fmt.toMd with the alternate stamp.
          const safeText = typeof text === 'string' ? text : '';
          const stamp = WindyDateUtils.formatFull(now);
          const paragraphs = safeText.split(/\n+/).filter(p => p.trim());
          content = `# Transcript — ${stamp}\n\n${paragraphs.map(p => p.trim()).join('\n\n')}\n`;
        } else {
          content = fmt.toMd(text, now);
        }
      } else {
        content = `# Transcript — ${now.toLocaleString()}\n\n${text}\n`;
      }
      filters = [{ name: 'Markdown', extensions: ['md'] }];
    } else if (format === 'srt') {
      content = fmt ? fmt.toSrt(text) : text;
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
    const apiKey = window.windyAPI ? await window.windyAPI.getApiKey(keyMap[engine]) : '';
    if (!apiKey) {
      this.showReconnectToast(`⚠️ No ${engine} API key configured. Open Settings to add one.`);
      return;
    }

    try {
      // Reuse pre-warmed stream when available (Linux/Wayland focus protection).
      let stream;
      if (this._prewarmedStream && this._prewarmedStream.active) {
        stream = this._prewarmedStream;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
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
      console.debug(`[API] ${engine} recording started`);
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
    // M5: Stop proxy-based Deepgram stream if active
    if (this._dgUsingProxy && window.windyAPI?.deepgramStreamStop) {
      window.windyAPI.deepgramStreamStop();
      this._dgUsingProxy = false;
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
      // Offline-friendly error: don't show raw "Failed to fetch" / "NetworkError"
      if (err.name === 'TypeError' && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Network'))) {
        throw new Error('You\'re offline. Switch to a local engine in Settings, or try again when connected.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  /**
   * Start Deepgram real-time WebSocket streaming
   * M5: Uses IPC proxy to keep API key in main process — never exposed to renderer
   */
  async _startDeepgramStreaming(stream, apiKey) {
    const dgLang = localStorage.getItem('windy_language') || 'en';
    const dgDiarize = localStorage.getItem('windy_diarize') === 'true';

    // M5: Use main-process proxy if available (API key stays in main process)
    const useProxy = !!window.windyAPI?.deepgramStreamStart;

    if (useProxy) {
      const result = await window.windyAPI.deepgramStreamStart({ language: dgLang, diarize: dgDiarize });
      if (!result?.ok) {
        this.showReconnectToast(`⚠️ ${result?.error || 'Failed to start Deepgram stream'}`);
        return;
      }
      // Mark proxy mode so stopApiRecording uses the right cleanup
      this._dgUsingProxy = true;

      window.windyAPI.onDeepgramProxyOpen(() => {
        console.debug('[Deepgram] Proxy WebSocket connected');
        // Stream audio to Deepgram via main process
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
          }
          window.windyAPI.deepgramStreamSend(int16.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        this._dgAudioCtx = audioCtx;
        this._dgProcessor = processor;
        this._dgSource = source;
        this._dgStream = stream;
      });

      window.windyAPI.onDeepgramProxyMessage((dataStr) => {
        try {
          const data = JSON.parse(dataStr);
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
      });

      window.windyAPI.onDeepgramProxyError((msg) => {
        console.error('[Deepgram] Proxy error:', msg);
        this.showReconnectToast('⚠️ Stream engine connection error. Check API key.');
      });

      window.windyAPI.onDeepgramProxyClose(() => {
        console.debug('[Deepgram] Proxy WebSocket closed');
        if (this._dgProcessor) this._dgProcessor.disconnect();
        if (this._dgSource) this._dgSource.disconnect();
        if (this._dgAudioCtx) this._dgAudioCtx.close();
        if (this._dgStream) this._dgStream.getTracks().forEach(t => t.stop());
        if (this.isRecording) {
          this.isRecording = false;
          this.setState('idle');
          this.transcriptContent.contentEditable = 'true';
          if (this._streamingText.trim() && window.windyAPI?.archiveTranscript) {
            window.windyAPI.archiveTranscript(this._streamingText.trim(), 'deepgram');
          }
        }
      });
      return;
    }

    // Fallback: direct WebSocket (legacy — API key passed as sub-protocol)
    let dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${dgLang}&smart_format=true&interim_results=true&punctuate=true`;
    if (dgDiarize) dgUrl += '&diarize=true';
    this._dgUsingProxy = false;

    this._deepgramWs = new WebSocket(dgUrl, ['token', apiKey]);

    this._deepgramWs.onopen = () => {
      console.debug('[Deepgram] WebSocket connected');
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
      console.debug('[Deepgram] WebSocket closed');
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
    if (this._toggleLock) {
      console.error('[Toggle] BLOCKED by debounce lock');
      return;
    }
    this._toggleLock = true;
    setTimeout(() => { this._toggleLock = false; }, 500);

    const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
    const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';
    console.error(`[Toggle] isRecording=${this.isRecording}, engine=${engine}, mode=${recordingMode}, state=${this.currentState}`);

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
      // Tell main the recording STARTED so its isRecording flag tracks button-started
      // sessions — otherwise a ⌘⇧Space hotkey-stop is swallowed and recording sticks ON.
      try { window.windyAPI?.notifyRecordingStarted?.(); } catch (_) { }
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
        this.cloudUrl = (window.API_CONFIG || {}).wsUrl || 'wss://windyword.ai';
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
          console.debug('[Cloud] ✅ WS still open after audio capture started — streaming to cloud');
        } else {
          console.warn('[Cloud] ⚠️ WS closed during audio setup — falling back to local');
          this._usingCloud = false;
          this.send('start');
        }
      } else {
        // Send resolved whisper model config to Python server for custom engines
        const engineModel = this._engineModelMap?.[this.transcriptionEngine];
        if (engineModel) {
          this.send('config', { config: { model: engineModel } });
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
      // Phase 8: account creation moved out of wizard. After the user's
      // first successful transcription, surface a one-time "save your
      // sessions to the cloud" banner. Only the first final segment ever
      // triggers it; once dismissed (or accepted) it never reappears.
      try { this.maybeShowSignupBanner(msg); } catch (e) { /* never break record flow */ }
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
   * Phase 8: post-first-transcription cloud-account upsell.
   * Implementation moved to renderer/signup-banner.js so it can be
   * unit-tested in jsdom and E2E-tested in Playwright without launching
   * the full record/transcribe stack. This wrapper keeps the call site
   * in addTranscriptSegment unchanged.
   */
  maybeShowSignupBanner(msg) {
    // window.WindySignupBanner is loaded via index.html's <script> tag.
    // If it's missing for any reason (preload race, packaging bug),
    // fail silent — record flow is sacred.
    if (typeof window.WindySignupBanner === 'function') {
      window.WindySignupBanner(msg);
    }
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
