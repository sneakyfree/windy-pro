// Settings catalog — single source of truth for the agent-discoverable
// surface of Windy Word's electron-store. Each entry describes a setting:
// what it does, valid values, side effects of changing it, whether it can
// be written by agents at all.
//
// To add a new agent-controllable setting:
//   1. Add an entry below with a clear description, type, and (if applicable)
//      validation hints.
//   2. If the setting has a runtime side effect (hot-reload an engine,
//      re-register hotkeys, repaint UI), wire the side effect into
//      applySideEffects() at the bottom.
//   3. That's it — list_settings, describe_setting, and set_setting pick it
//      up automatically.
//
// Settings NOT in the catalog are accessible only via the low-level
// get_config / set_config endpoints — by design, since they have no agent-
// safe schema.

const ACCELERATOR = /^(?:(?:CommandOrControl|Control|Ctrl|Cmd|Command|Alt|Shift|Super|Meta)\+)+(?:[A-Za-z0-9]|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|F[0-9]{1,2})$/;

// type: enum, boolean, number, string, accelerator, filepath, array
// sensitivity: writable (default) | readonly
// tags: optional array of capability tags an agent can filter on
//        (e.g. 'voice-clone', 'archive', 'paste', 'hotkey', 'ui', 'lifecycle')
const CATALOG = {
  // ── Transcription engine ────────────────────────────────────────────────
  'engine.model': {
    type: 'enum',
    enum: ['tiny', 'base', 'small', 'medium', 'large-v3'],
    description: 'Active Whisper transcription model. Smaller = faster but less accurate.',
    default: 'small',
    sideEffect: 'Hot-reloads the running Python engine over WebSocket. No app restart.',
    restartRequired: false,
    tags: ['transcription'],
  },
  'engine.engine': {
    type: 'enum',
    enum: ['local', 'windytune', 'cloud'],
    description: 'Transcription engine. "local" uses bundled Whisper. "windytune" auto-tunes the model based on recent latency. "cloud" routes to the WindyMail STT.',
    default: 'local',
    restartRequired: false,
  },
  'engine.clearOnPaste': {
    type: 'boolean',
    description: 'Clear the transcript buffer after a successful paste. When false, transcripts accumulate.',
    default: true,
    restartRequired: false,
  },
  'engine.livePreview': {
    type: 'boolean',
    description: 'Show partial transcripts in the main window as the user speaks (vs. only the final result).',
    default: true,
    restartRequired: false,
  },
  'engine.autoArchive': {
    type: 'boolean',
    description: 'Automatically archive every transcript to disk + cloud (per archiveMode). Master switch for voice-clone training-data accumulation — when off, no audio is retained for downstream voice-clone ingestion.',
    default: true,
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.archiveMode': {
    type: 'enum',
    enum: ['local', 'cloud', 'both', 'off'],
    description: 'Where archived transcripts go. "off" disables archiving even if autoArchive=true. "local" or "both" required for InstaBio voice-clone ingestion (it polls the local archiveFolder).',
    default: 'both',
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.archiveFolder': {
    type: 'filepath',
    description: 'Local directory for archived transcripts (audio/video/text). Must be writable. This is the source location InstaBio reads for voice-clone training data — see project_instabio_voice_clone_data memory for the ingestion contract (audio dirs without DB rows are deliberately retained).',
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.saveVideo': {
    type: 'boolean',
    description: 'Record video from the webcam during transcription (in addition to audio). Affects Windy Clone training data, not voice-only clone.',
    default: true,
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.audioQuality': {
    type: 'enum',
    enum: ['lossless', 'high', 'medium', 'low'],
    description: 'Audio encoding quality for archived recordings. Voice-clone training works best with "lossless" or "high"; lower qualities cut clone fidelity meaningfully.',
    default: 'lossless',
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.videoQuality': {
    type: 'enum',
    enum: ['1080p', '720p', '480p', '240p'],
    description: 'Video resolution for archived recordings.',
    default: '720p',
    restartRequired: false,
    tags: ['archive'],
  },
  'engine.vibeEnabled': {
    type: 'boolean',
    description: 'Enable "vibe" — Windy Word\'s mood/tone analysis on each transcript. Affects post-processing of transcripts before they\'re archived for voice-clone training.',
    default: true,
    restartRequired: false,
    tags: ['transcription', 'voice-clone'],
  },
  'engine.diarize': {
    type: 'boolean',
    description: 'Speaker diarization — segment transcripts by speaker. Voice-clone training benefits from diarization (cleaner per-speaker audio) but works without it.',
    default: true,
    restartRequired: false,
    tags: ['transcription', 'voice-clone'],
  },
  'engine.micDeviceId': {
    type: 'string',
    description: 'Microphone device id ("default", a specific id from the audio device enumeration, or "phone:wifi" for a phone paired via the WiFi phone companion). If the selected device is unavailable at record time, capture falls back to the OS default microphone without failing the recording; a WiFi phone dropping mid-recording hot-swaps to the default mic with the recording uninterrupted.',
    default: 'default',
    restartRequired: false,
  },
  'engine.cameraDeviceId': {
    type: 'string',
    description: 'Camera device id for video recordings ("default", a specific id from the video device enumeration, or "phone:wifi" for a phone paired via the WiFi phone companion). Covers any OS-visible camera: built-in, USB, capture cards, and phone cameras exposed by the OS (e.g. iPhone Continuity Camera on macOS). If the selected device is unavailable at record time, capture falls back to the OS default camera without failing the recording; a camera dying mid-recording finalizes the partial video while audio continues.',
    default: 'default',
    restartRequired: false,
    tags: ['archive'],
  },
  'engine.language': {
    type: 'string',
    description: 'Whisper transcription language. ISO 639-1 code (e.g. "en", "es", "fr", "ja", "zh", "ar", "hi", "de", "pt", "ko", "ru", "it", "nl", "pl", "tr", "sv", "vi", "th") — or "auto" to let Whisper detect per-utterance. Hot-swappable; the live Python engine reconfigures over WebSocket without app restart.',
    default: 'en',
    sideEffect: 'Hot-reloads the running Python engine over WebSocket — sends {action:"config", config:{language: <value>}} to the bundled transcription engine. No app restart.',
    restartRequired: false,
    tags: ['transcription'],
  },

  // ── Paste ───────────────────────────────────────────────────────────────
  'paste.strategy': {
    type: 'string',
    description: 'Active paste strategy. "auto" uses the resolved fallback chain. Specific strategy name (e.g. "wtype", "ydotool_type") forces that one. Get the catalog from list_paste_strategies.',
    default: 'auto',
    restartRequired: false,
  },
  'paste.fallbackChain': {
    type: 'array',
    description: 'Ordered list of paste strategies to try when strategy="auto". Empty array means use the platform default chain.',
    default: [],
    restartRequired: false,
  },

  // ── Hotkeys ─────────────────────────────────────────────────────────────
  'hotkeys.toggleRecording': {
    type: 'accelerator',
    description: 'Global hotkey to start / stop voice recording.',
    default: 'CommandOrControl+Shift+Space',
    sideEffect: 'Re-registers all global shortcuts.',
    restartRequired: false,
  },
  'hotkeys.pasteTranscript': {
    type: 'accelerator',
    description: 'Global hotkey to paste the most recent transcript into the focused window.',
    default: 'CommandOrControl+Shift+V',
    sideEffect: 'Re-registers all global shortcuts.',
    restartRequired: false,
  },
  'hotkeys.pasteClipboard': {
    type: 'accelerator',
    description: 'Global hotkey to paste the system clipboard (for screenshots, copied text, etc.) via simulated Ctrl+V.',
    default: 'CommandOrControl+Shift+B',
    sideEffect: 'Re-registers all global shortcuts.',
    restartRequired: false,
  },
  'hotkeys.showHide': {
    type: 'accelerator',
    description: 'Global hotkey to cycle the Windy Word window: full → tornado mini-widget → hidden → full.',
    default: 'CommandOrControl+Shift+W',
    sideEffect: 'Re-registers all global shortcuts.',
    restartRequired: false,
  },
  'hotkeys.quickTranslate': {
    type: 'accelerator',
    description: 'Global hotkey to open the Quick Translate mini-window.',
    default: 'CommandOrControl+Shift+T',
    sideEffect: 'Re-registers all global shortcuts.',
    restartRequired: false,
  },

  // ── Appearance ──────────────────────────────────────────────────────────
  'appearance.alwaysOnTop': {
    type: 'boolean',
    description: 'Keep the Windy Word window above all others.',
    default: true,
    restartRequired: false,
  },
  'appearance.opacity': {
    type: 'number',
    min: 0.1,
    max: 1.0,
    description: 'Window opacity (0.1 = mostly transparent, 1.0 = fully opaque).',
    default: 1.0,
    restartRequired: false,
  },
  'appearance.theme': {
    type: 'enum',
    enum: ['dark', 'light', 'auto'],
    description: 'UI color theme. "dark" / "light" force one mode; "auto" follows the OS appearance. Renderer applies the light-theme body class and persists to localStorage (windy_theme).',
    default: 'dark',
    sideEffect: 'Renderer applies light-theme body class + writes localStorage.windy_theme on the next IPC tick.',
    restartRequired: false,
    tags: ['ui'],
  },

  // ── Analytics / telemetry ────────────────────────────────────────────────
  'analytics.enabled': {
    type: 'boolean',
    description: 'Help-improve-Windy-Word opt-in for anonymous usage stats (engine, duration, mode, language — never transcript content). Off by default. Renderer reads localStorage.windy_analytics.',
    default: false,
    sideEffect: 'Renderer writes localStorage.windy_analytics on the next IPC tick.',
    restartRequired: false,
    tags: ['ui'],
  },

  // ── Bottom panel visibility ──────────────────────────────────────────────
  // Each row (playback / export / control) independently controls how it
  // appears in the main app: "always" pins it open, "hover" reveals it when
  // the cursor approaches the bottom edge, "hidden" never shows it. Renderer
  // reads localStorage.windy_panelVis_<key> with key in {playback, export,
  // controls} — note the legacy "controls" plural for the third one.
  'bottomPanel.playback': {
    type: 'enum',
    enum: ['always', 'hover', 'hidden'],
    description: 'Visibility mode for the playback-bar row in the main app. "hover" (default) reveals it when the cursor is near the bottom; "always" pins it open; "hidden" never shows it.',
    default: 'hover',
    sideEffect: 'Renderer toggles panel-vis-hidden / panel-vis-hover classes and persists to localStorage.windy_panelVis_playback.',
    restartRequired: false,
    tags: ['ui'],
  },
  'bottomPanel.export': {
    type: 'enum',
    enum: ['always', 'hover', 'hidden'],
    description: 'Visibility mode for the export-row in the main app. "hover" (default) reveals it when the cursor is near the bottom; "always" pins it open; "hidden" never shows it.',
    default: 'hover',
    sideEffect: 'Renderer toggles panel-vis-* classes and persists to localStorage.windy_panelVis_export.',
    restartRequired: false,
    tags: ['ui'],
  },
  'bottomPanel.control': {
    type: 'enum',
    enum: ['always', 'hover', 'hidden'],
    description: 'Visibility mode for the control-bar row in the main app. "always" (default) keeps it pinned open; "hover" reveals it on bottom-edge hover; "hidden" never shows it. Note: persists to localStorage.windy_panelVis_controls (legacy plural).',
    default: 'always',
    sideEffect: 'Renderer toggles panel-vis-* classes and persists to localStorage.windy_panelVis_controls.',
    restartRequired: false,
    tags: ['ui'],
  },

  // ── Archive (extended) ──────────────────────────────────────────────────
  'engine.archiveLocalEnabled': {
    type: 'boolean',
    description: 'Whether the local archive path receives copies (separate from cloud archive). Required for InstaBio voice-clone ingestion which polls the local archiveFolder. Lets users keep training audio locally even when archiveMode="cloud".',
    default: true,
    restartRequired: false,
    tags: ['archive', 'voice-clone'],
  },
  'engine.archiveRouteToday': {
    type: 'enum',
    enum: ['local', 'cloud', 'both'],
    description: 'Override archiveMode for today\'s session — useful when triaging an upload-bandwidth-constrained recording day.',
    default: 'local',
    restartRequired: false,
  },
  'engine.pasteClipboard': {
    type: 'accelerator',
    description: 'Alternative accelerator binding for the paste-clipboard action (distinct from hotkeys.pasteClipboard which is the canonical registration). Kept for backward compatibility with older configs.',
    default: 'CommandOrControl+Shift+P',
    restartRequired: false,
  },

  // ── Window geometry ─────────────────────────────────────────────────────
  'window.x': {
    type: 'number',
    description: 'Main window x position in screen pixels. Persisted across launches.',
    restartRequired: false,
  },
  'window.y': {
    type: 'number',
    description: 'Main window y position in screen pixels.',
    restartRequired: false,
  },
  'window.width': {
    type: 'number',
    min: 200,
    max: 4000,
    description: 'Main window width in pixels.',
    restartRequired: false,
  },
  'window.height': {
    type: 'number',
    min: 200,
    max: 4000,
    description: 'Main window height in pixels.',
    restartRequired: false,
  },

  // ── Server / connectivity ───────────────────────────────────────────────
  'server.host': {
    type: 'string',
    description: 'Bind host for the bundled Python transcription engine. Almost never needs to change.',
    default: '127.0.0.1',
    restartRequired: true,
  },
  'server.port': {
    type: 'number',
    min: 1024,
    max: 65535,
    description: 'Port for the bundled Python transcription engine.',
    default: 9876,
    restartRequired: true,
  },

  // ── Read-only / informational ───────────────────────────────────────────
  'license.tier': {
    type: 'enum',
    enum: ['free', 'pro', 'lifetime', 'team'],
    description: 'License tier. Managed by the account server — do not write directly.',
    sensitivity: 'readonly',
  },
  'license.email': {
    type: 'string',
    description: 'Licensed user email. Managed by the account server.',
    sensitivity: 'readonly',
  },
  'license.modelsLocked': {
    type: 'boolean',
    description: 'Whether premium models (medium, large-v3) are locked behind a paid tier on this install.',
    sensitivity: 'readonly',
  },
  'license.purchasedAt': {
    type: 'string',
    description: 'ISO timestamp of when the license was purchased. Empty string if never purchased.',
    sensitivity: 'readonly',
  },
  'license.expiresAt': {
    type: 'string',
    description: 'ISO timestamp of license expiry. Null for non-expiring tiers (free, lifetime).',
    sensitivity: 'readonly',
  },
  'license.stripeSessionId': {
    type: 'string',
    description: 'Stripe checkout session id from the original purchase. For support cross-reference.',
    sensitivity: 'readonly',
  },
  'wizard.completed': {
    type: 'boolean',
    description: 'Whether the first-run setup wizard has completed. Internal state — managed by the wizard flow.',
    sensitivity: 'readonly',
  },
  'hasSeenWelcome': {
    type: 'boolean',
    description: 'Whether the user has dismissed the initial welcome screen. Internal state.',
    sensitivity: 'readonly',
  },
  'lastUpdateCheck': {
    type: 'number',
    description: 'Unix milliseconds of the last electron-updater check. Internal state.',
    sensitivity: 'readonly',
    tags: ['lifecycle'],
  },

  // ── Video preview window geometry ───────────────────────────────────────
  'videoWindow.x': {
    type: 'number',
    description: 'Video preview window x position. Persisted across launches.',
    restartRequired: false,
    tags: ['ui', 'geometry'],
  },
  'videoWindow.y': {
    type: 'number',
    description: 'Video preview window y position.',
    restartRequired: false,
    tags: ['ui', 'geometry'],
  },
  'videoWindow.width': {
    type: 'number',
    min: 100,
    max: 2000,
    description: 'Video preview window width in pixels.',
    restartRequired: false,
    tags: ['ui', 'geometry'],
  },
  'videoWindow.height': {
    type: 'number',
    min: 100,
    max: 2000,
    description: 'Video preview window height in pixels.',
    restartRequired: false,
    tags: ['ui', 'geometry'],
  },

  // ── Tornado mini-widget position + customization ────────────────────
  'tornadoX': {
    type: 'number',
    description: 'Tornado mini-widget x position (the small recording-state indicator that shows when the main window is hidden).',
    restartRequired: false,
    tags: ['ui', 'geometry', 'widget'],
  },
  'tornadoY': {
    type: 'number',
    description: 'Tornado mini-widget y position.',
    restartRequired: false,
    tags: ['ui', 'geometry', 'widget'],
  },
  'tornadoSize': {
    type: 'number',
    min: 30,
    max: 200,
    description: 'Tornado mini-widget diameter in pixels. Default 56. Larger sizes are more visible but cover more screen.',
    default: 56,
    restartRequired: false,
    tags: ['ui', 'widget'],
  },
  'widgetSettings': {
    type: 'array',
    description: 'Mini-widget appearance + behavior settings object (size, alwaysOnTop, click-through, theme variants). Free-form — agents writing this should describe_setting first to see the current shape.',
    restartRequired: false,
    tags: ['ui', 'widget'],
  },
  'widgetData': {
    type: 'array',
    description: 'Mini-widget runtime data (last-displayed transcript fragments, indicator state). Internal — agents normally do not need to write this.',
    restartRequired: false,
    sensitivity: 'readonly',
    tags: ['ui', 'widget', 'lifecycle'],
  },

  // ── Lifecycle / wizard state (readonly) ─────────────────────────────────
  'wizard.currentStep': {
    type: 'number',
    description: 'Index of the most-recently-completed wizard step (99 = wizard fully complete). Internal state — managed by the wizard flow.',
    sensitivity: 'readonly',
    tags: ['lifecycle'],
  },
  'wizard.completedSteps': {
    type: 'array',
    description: 'Array of wizard step ids that have been completed. Internal state.',
    sensitivity: 'readonly',
    tags: ['lifecycle'],
  },
  'heartbeat.graceStartTime': {
    type: 'number',
    description: 'Unix milliseconds when the license heartbeat grace period began (for offline-tolerance). Internal state.',
    sensitivity: 'readonly',
    tags: ['lifecycle', 'license'],
  },
};

// Validate a value against a catalog entry. Returns null on success,
// or an error message string on failure.
function validate(path, value) {
  const entry = CATALOG[path];
  if (!entry) return `unknown setting: ${path}. Use list_settings to discover available paths, or set_config for paths outside the catalog.`;
  if (entry.sensitivity === 'readonly') return `setting "${path}" is read-only (managed by ${path.startsWith('license.') ? 'the account server' : 'Windy Word internals'}).`;

  switch (entry.type) {
    case 'enum':
      if (!entry.enum.includes(value)) {
        return `value must be one of: ${entry.enum.join(', ')} (got ${JSON.stringify(value)}).`;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `value must be a boolean (got ${typeof value}).`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `value must be a finite number (got ${JSON.stringify(value)}).`;
      if (entry.min !== undefined && value < entry.min) return `value must be ≥ ${entry.min} (got ${value}).`;
      if (entry.max !== undefined && value > entry.max) return `value must be ≤ ${entry.max} (got ${value}).`;
      break;
    case 'string':
      if (typeof value !== 'string') return `value must be a string (got ${typeof value}).`;
      break;
    case 'accelerator':
      if (typeof value !== 'string' || !ACCELERATOR.test(value)) {
        return `value must be an Electron accelerator string (e.g. "CommandOrControl+Shift+Space"). got ${JSON.stringify(value)}.`;
      }
      break;
    case 'filepath':
      if (typeof value !== 'string' || value.length === 0) return `value must be a non-empty filepath string.`;
      break;
    case 'array':
      if (!Array.isArray(value)) return `value must be an array (got ${typeof value}).`;
      break;
    default:
      return `catalog entry has unknown type "${entry.type}" — bug in catalog.js`;
  }
  return null;
}

// Build a list-friendly view of the catalog (without validator functions
// or other non-serializable internals — currently catalog is plain data so
// JSON.stringify works fine, but this gives a stable shape).
function listCatalog(opts = {}) {
  let entries = Object.entries(CATALOG);
  if (opts.tag) {
    entries = entries.filter(([, e]) => Array.isArray(e.tags) && e.tags.includes(opts.tag));
  }
  return entries.map(([path, entry]) => ({
    path,
    type: entry.type,
    description: entry.description,
    ...(entry.enum ? { enum: entry.enum } : {}),
    ...(entry.min !== undefined ? { min: entry.min } : {}),
    ...(entry.max !== undefined ? { max: entry.max } : {}),
    ...(entry.default !== undefined ? { default: entry.default } : {}),
    ...(entry.sideEffect ? { sideEffect: entry.sideEffect } : {}),
    ...(entry.tags ? { tags: entry.tags } : {}),
    restartRequired: !!entry.restartRequired,
    sensitivity: entry.sensitivity || 'writable',
  }));
}

function allTags() {
  const tags = new Set();
  for (const e of Object.values(CATALOG)) {
    if (Array.isArray(e.tags)) e.tags.forEach((t) => tags.add(t));
  }
  return [...tags].sort();
}

function describe(path) {
  const entry = CATALOG[path];
  if (!entry) return null;
  return {
    path,
    ...entry,
    restartRequired: !!entry.restartRequired,
    sensitivity: entry.sensitivity || 'writable',
  };
}

module.exports = { CATALOG, validate, listCatalog, describe, allTags };
