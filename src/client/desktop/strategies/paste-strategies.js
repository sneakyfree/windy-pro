/**
 * Windy Word — Paste Strategy Registry
 *
 * The full catalog of "how to inject text into the focused window" across
 * every OS / display server / compositor combination we care about.
 *
 * Each strategy is a self-contained module with:
 *   - capability metadata (platforms, requirements, speed, reliability)
 *   - detect(): can this strategy run on the current system?
 *   - paste(text, opts): perform the paste; return true on success
 *
 * The registry is agent-controllable: every strategy is exposed via the
 * Wayland control server HTTP API (and, in a follow-up, the MCP server).
 * A user's local AI agent can list strategies, test them, and persist the
 * winner to config.paste.strategy.
 *
 * 12 strategies cover ~99% of voice-to-text users on Electron-supported OSes.
 * Mobile (iOS/Android) is a separate app architecture, not in this registry.
 *
 * Q&A status: each strategy carries a `status` field — 'verified' means it has
 * been confirmed working in the wild; 'untested' means the code exists but
 * needs validation on its target platform.
 */

const { execFile, spawn } = require('child_process');
const { existsSync } = require('fs');
const { clipboard } = require('electron');

// ── Helpers ──────────────────────────────────────────────────────────────
function hasBinary(name) {
  try {
    const { execSync } = require('child_process');
    execSync(`command -v ${name}`, { stdio: 'pipe', timeout: 500 });
    return true;
  } catch (_) {
    return false;
  }
}

function getYdoEnv() {
  const uid = process.getuid?.() ?? 1000;
  const socket = process.env.YDOTOOL_SOCKET || `/tmp/ydotool-${uid}.socket`;
  return { ...process.env, YDOTOOL_SOCKET: socket };
}

/**
 * Detect whether the currently focused window is an XWayland app or
 * a Wayland-native app. Used by strategies that need to know whether
 * their keystroke will read X11 or Wayland clipboard.
 * Returns: 'xwayland' | 'wayland-native' | 'unknown'
 */
function detectTargetType() {
  try {
    const { execSync } = require('child_process');
    const winName = execSync('xdotool getactivewindow getwindowname 2>/dev/null',
      { timeout: 500, encoding: 'utf-8' }).trim();
    return winName.length > 0 ? 'xwayland' : 'wayland-native';
  } catch (_) {
    return 'unknown';
  }
}

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ ok: !err, err, stdout, stderr });
    });
  });
}

// ── Strategy definitions ─────────────────────────────────────────────────
const strategies = [
  // ═══════════════════════════════════════════════════════════════════════
  // macOS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'osascript_cmd_v',
    label: 'macOS osascript Cmd+V',
    platforms: ['darwin'],
    displayServers: [],
    compositors: [],
    requires: [],
    speed: 'fast',
    reliability: 'high',
    status: 'verified',
    description: 'Sends Cmd+V via osascript System Events. Default macOS path, works for most apps. Requires text on clipboard.',
    needsClipboard: true,
    detect: async () => process.platform === 'darwin',
    paste: async (text) => {
      // System Events sometimes drops the synthetic Command modifier with the
      // `keystroke "v" using command down` form — especially right after an app
      // activation or while the user's physical Cmd+Shift+V is still releasing —
      // typing a bare literal "v" instead of pasting. `key code 9` (the physical V
      // key) + the explicit `using {command down}` brace form holds the modifier
      // reliably; the brief settle lets a held hotkey modifier release first.
      await new Promise(r => setTimeout(r, 150));
      const { ok } = await execFilePromise('osascript', ['-e',
        'tell application "System Events" to key code 9 using {command down}'
      ], { timeout: 3000 });
      return ok;
    },
  },
  {
    name: 'cliclick_t_v',
    label: 'macOS cliclick paste',
    platforms: ['darwin'],
    displayServers: [],
    compositors: [],
    requires: ['cliclick'],
    speed: 'instant',
    reliability: 'high',
    status: 'untested',
    description: 'cliclick is faster and more reliable than osascript. Install: brew install cliclick.',
    needsClipboard: true,
    detect: async () => process.platform === 'darwin' &&
      (existsSync('/usr/local/bin/cliclick') || existsSync('/opt/homebrew/bin/cliclick')),
    paste: async (text) => {
      const { ok } = await execFilePromise('cliclick', ['kd:cmd', 't:v', 'ku:cmd'], { timeout: 3000 });
      return ok;
    },
  },
  {
    name: 'macos_ax_insert',
    label: 'macOS Accessibility direct insert',
    platforms: ['darwin'],
    displayServers: [],
    compositors: [],
    requires: ['accessibility-permission'],
    speed: 'instant',
    reliability: 'medium',
    status: 'stub',
    description: 'Insert text directly via AXUIElement SetValue. Bypasses keystroke simulation. Stub — needs native module.',
    needsClipboard: false,
    detect: async () => false, // not implemented
    paste: async () => false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Windows
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'sendkeys_ctrl_v',
    label: 'Windows PowerShell SendKeys',
    platforms: ['win32'],
    displayServers: [],
    compositors: [],
    requires: [],
    speed: 'fast',
    reliability: 'medium',
    status: 'untested',
    description: 'Default Windows path. Some apps (UAC dialogs, some games) ignore it. Requires text on clipboard.',
    needsClipboard: true,
    detect: async () => process.platform === 'win32',
    paste: async (text) => {
      const { ok } = await execFilePromise('powershell', ['-NoProfile', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ], { timeout: 5000 });
      return ok;
    },
  },
  {
    name: 'windows_ui_automation',
    label: 'Windows UI Automation TextPattern',
    platforms: ['win32'],
    displayServers: [],
    compositors: [],
    requires: [],
    speed: 'instant',
    reliability: 'high',
    status: 'stub',
    description: 'Direct text insertion via UI Automation TextPattern. Bypasses keystroke. Stub — needs native module.',
    needsClipboard: false,
    detect: async () => false, // not implemented
    paste: async () => false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Linux X11
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'xdotool_keystroke_ctrl_v',
    label: 'Linux X11 xdotool Ctrl+V',
    platforms: ['linux'],
    displayServers: ['x11'],
    compositors: [],
    requires: ['xdotool'],
    speed: 'instant',
    reliability: 'high',
    status: 'verified',
    description: 'X11 standard. Fires Ctrl+V keystroke; receiver reads X11 clipboard. Works for any X11 app.',
    needsClipboard: true,
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'x11' && hasBinary('xdotool'),
    paste: async (text) => {
      const { ok } = await execFilePromise('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], { timeout: 3000 });
      return ok;
    },
  },
  {
    name: 'xdotool_type',
    label: 'Linux X11 xdotool type',
    platforms: ['linux'],
    displayServers: ['x11'],
    compositors: [],
    requires: ['xdotool'],
    speed: 'fast',
    reliability: 'high',
    status: 'verified',
    description: 'Types text directly via X11 XTest. Bypasses clipboard. Works on any X11 focused widget.',
    needsClipboard: false,
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'x11' && hasBinary('xdotool'),
    paste: async (text) => {
      const timeout = Math.min(300000, Math.max(30000, text.length * 30));
      const { ok } = await execFilePromise('xdotool', ['type', '--delay', '1', '--', text], { timeout });
      return ok;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Linux Wayland
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'wtype',
    label: 'Linux Wayland wtype (virtual keyboard)',
    platforms: ['linux'],
    displayServers: ['wayland'],
    compositors: ['wlroots', 'kde-plasma-6', 'mutter-49+'],
    requires: ['wtype'],
    speed: 'instant',
    reliability: 'high',
    status: 'untested',
    description: 'Wayland-native typing via virtual-keyboard protocol. Talks directly to the compositor. Fastest path on supported compositors. Install: sudo dnf install wtype / sudo apt install wtype.',
    needsClipboard: false,
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' && hasBinary('wtype'),
    paste: async (text) => {
      const timeout = Math.min(300000, Math.max(30000, text.length * 30));
      const { ok } = await execFilePromise('wtype', ['--', text], { timeout });
      return ok;
    },
  },
  {
    name: 'ydotool_type',
    label: 'Linux Wayland ydotool type (/dev/uinput)',
    platforms: ['linux'],
    displayServers: ['wayland'],
    compositors: [],
    requires: ['ydotool', 'ydotoold-daemon'],
    speed: 'fast',
    reliability: 'high',
    status: 'verified',
    description: 'Types via /dev/uinput kernel injection. Works on any focused Wayland or XWayland target. ~1-5ms per char.',
    needsClipboard: false,
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' && hasBinary('ydotool'),
    paste: async (text) => {
      const env = getYdoEnv();
      // 100ms focus-settle: Mutter sometimes finalizes XWayland focus
      // a few ms after the user's app says it's ready. Without this,
      // the first ydotool keystroke can hit a focus-transition gap and
      // get dropped (KeyPress lost, KeyRelease delivered, first char gone).
      await new Promise(r => setTimeout(r, 100));
      // Chunk long texts with drain pauses. One uninterrupted `ydotool type`
      // of thousands of chars produces uinput events faster than a busy GTK
      // client can drain its Wayland event queue — the compositor's socket
      // send hits EAGAIN and the client aborts with "Error flushing display".
      // Single-process terminals lose EVERY window when that happens (all
      // Ptyxis terminals died at once on 2026-07-12 from 2.4k/5.5k-char
      // pastes). Split on code points, not UTF-16 units, so surrogate pairs
      // (emoji) never get cut in half.
      const CHUNK_CHARS = 500;
      const DRAIN_PAUSE_MS = 150;
      const chars = Array.from(text);
      for (let i = 0; i < chars.length; i += CHUNK_CHARS) {
        const part = chars.slice(i, i + CHUNK_CHARS).join('');
        const timeout = Math.min(300000, Math.max(30000, part.length * 30));
        // -d 1 -H 1 (1ms between keys, 1ms hold): kernel-friendly throughput
        // without dropping events on busy systems. Still ~2ms per char.
        const { ok } = await execFilePromise('ydotool', ['type', '-d', '1', '-H', '1', '--', part], { env, timeout });
        if (!ok) return false;
        if (i + CHUNK_CHARS < chars.length) await new Promise(r => setTimeout(r, DRAIN_PAUSE_MS));
      }
      return true;
    },
  },
  {
    name: 'ydotool_keystroke_ctrl_shift_v',
    label: 'Linux Wayland ydotool Ctrl+Shift+V (XWayland targets only)',
    platforms: ['linux'],
    displayServers: ['wayland'],
    compositors: [],
    requires: ['ydotool', 'ydotoold-daemon'],
    speed: 'instant',
    reliability: 'high',
    status: 'verified',
    description: 'Fires Ctrl+Shift+V via /dev/uinput. Auto-returns false on Wayland-native targets (where the keystroke would read the unreliable Wayland clipboard). Works great on XWayland targets reading the X11 clipboard.',
    needsClipboard: true,
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' && hasBinary('ydotool'),
    paste: async (text) => {
      // Gate by target type: this strategy only works when the focused window
      // is XWayland (reads X11 clipboard). For Wayland-native targets, return
      // false so the chain falls through to typing.
      const targetType = detectTargetType();
      if (targetType !== 'xwayland') {
        console.info(`[Strategy:ydotool_keystroke] Target is ${targetType}, skipping (would need working Wayland clipboard)`);
        return false;
      }
      const env = getYdoEnv();
      // 29=KEY_LEFTCTRL 42=KEY_LEFTSHIFT 47=KEY_V
      const { ok } = await execFilePromise('ydotool',
        ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
        { env, timeout: 3000 });
      return ok;
    },
  },
  {
    name: 'wlcopy_then_ctrl_shift_v',
    label: 'Linux Wayland wl-copy + Ctrl+Shift+V',
    platforms: ['linux'],
    displayServers: ['wayland'],
    compositors: [],
    requires: ['wl-clipboard', 'ydotool'],
    speed: 'instant',
    reliability: 'medium',
    status: 'verified',
    description: 'Writes via wl-copy AND X11 clipboard, then fires Ctrl+Shift+V. Covers both Wayland-native and XWayland targets. Brittle when Mutter clipboard is wedged — falls through to next strategy on wl-copy timeout.',
    needsClipboard: true, // we also want X11 clipboard set so XWayland targets work
    detect: async () => process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' &&
      hasBinary('wl-copy') && hasBinary('ydotool'),
    paste: async (text) => {
      // Step 1: wl-copy with strict timeout
      const wlOk = await new Promise((resolve) => {
        const proc = spawn('wl-copy', [], {
          env: { ...process.env },
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 800,
        });
        let resolved = false;
        const done = (v) => { if (!resolved) { resolved = true; resolve(v); } };
        proc.stdin.write(text);
        proc.stdin.end();
        setTimeout(() => done(false), 600); // strict — if it hangs, abort
        proc.on('close', (code) => done(code === 0));
        proc.on('error', () => done(false));
      });
      if (!wlOk) return false;
      // Step 2: Ctrl+Shift+V via ydotool
      const env = getYdoEnv();
      const { ok } = await execFilePromise('ydotool',
        ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
        { env, timeout: 3000 });
      return ok;
    },
  },
  {
    name: 'atspi_insert',
    label: 'Linux AT-SPI accessibility insert',
    platforms: ['linux'],
    displayServers: ['x11', 'wayland'],
    compositors: [],
    requires: ['python3-pyatspi'],
    speed: 'instant',
    reliability: 'medium',
    status: 'stub',
    description: 'Inserts text via AT-SPI EditableText interface. Works on accessible widgets across X11 and Wayland. Stub — needs Python helper.',
    needsClipboard: false,
    detect: async () => false, // not implemented
    paste: async () => false,
  },
];

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get full catalog metadata. Used by the HTTP API / MCP / Settings UI.
 */
function listStrategies() {
  return strategies.map(s => ({
    name: s.name,
    label: s.label,
    platforms: s.platforms,
    displayServers: s.displayServers,
    compositors: s.compositors,
    requires: s.requires,
    speed: s.speed,
    reliability: s.reliability,
    status: s.status,
    description: s.description,
    needsClipboard: s.needsClipboard,
  }));
}

/**
 * Get strategies that could potentially run on the current system (passed detect()).
 */
async function detectAvailable() {
  const results = [];
  for (const s of strategies) {
    try {
      const ok = await s.detect();
      if (ok) results.push(s.name);
    } catch (_) { /* skip */ }
  }
  return results;
}

/**
 * Find a strategy by name. Returns null if not found.
 */
function getStrategy(name) {
  return strategies.find(s => s.name === name) || null;
}

/**
 * Set the X11 clipboard via Electron's API (works on all OSes for X11/macOS/Windows clipboard).
 * Strategies that have needsClipboard=true rely on this being set before paste() is called.
 */
function setClipboard(text) {
  try {
    clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Clipboard courtesy-restore ────────────────────────────────────────────
// AutoPaste puts the transcript on BOTH clipboards (Electron/X11 via
// setClipboard, Wayland via the wl-copy strategies) so keystroke strategies
// can work. Without a restore, every dictation squats on the user's
// clipboard: whatever they copied before dictating is gone, and Ctrl+Shift+V
// keeps pasting the transcript instead (bit Grant between-terminal copy/paste
// on 2026-07-12). Snapshot both clipboards before the paste and put them back
// RESTORE_MS after the winning strategy fired — the target app reads the
// clipboard at keystroke time, so 2s later the transcript has long since
// landed. A newer autoExecute cancels any pending restore so back-to-back
// dictations can't resurrect a stale clipboard between wl-copy and the paste
// keystroke.
const RESTORE_MS = 2000;
let _pendingRestore = null;

function _cancelPendingRestore() {
  if (_pendingRestore) { clearTimeout(_pendingRestore); _pendingRestore = null; }
}

async function _snapshotClipboards() {
  const snap = { x11: null, wayland: null };
  try { snap.x11 = clipboard.readText() || null; } catch (_) { /* clipboard unavailable */ }
  if (process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' &&
      hasBinary('wl-paste')) {
    // Strict timeout: wl-paste blocks forever when the clipboard owner is
    // unresponsive; losing the snapshot is fine, hanging the paste is not.
    const { ok, stdout } = await execFilePromise('wl-paste', ['-n', '-t', 'text'], { timeout: 500 });
    if (ok && stdout) snap.wayland = stdout;
  }
  return snap;
}

function _wlCopy(text) {
  try {
    if (text === null) {
      spawn('wl-copy', ['--clear'], { stdio: 'ignore' }).on('error', () => {});
      return;
    }
    const proc = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', () => {});
    proc.stdin.write(text);
    proc.stdin.end();
  } catch (_) { /* best-effort */ }
}

// Put the snapshot back — but ONLY on sides where the clipboard still holds
// OUR transcript. If the user copied something new in the meantime, their
// copy wins; blindly restoring would clobber it, which is the exact bug this
// feature exists to prevent. A side whose snapshot was empty gets cleared
// rather than left holding the transcript.
async function _restoreClipboards(snap, transcript) {
  let touched = false;
  try {
    if (clipboard.readText() === transcript) {
      if (snap.x11) clipboard.writeText(snap.x11); else clipboard.clear();
      touched = true;
    }
  } catch (_) { /* best-effort */ }
  if (process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' &&
      hasBinary('wl-paste')) {
    const { ok, stdout } = await execFilePromise('wl-paste', ['-n', '-t', 'text'], { timeout: 500 });
    if (ok && stdout === transcript) {
      _wlCopy(snap.wayland);
      touched = true;
    }
  }
  if (touched) console.info('[Clipboard] Restored pre-dictation clipboard contents');
}

function _scheduleClipboardRestore(snap, transcript) {
  _cancelPendingRestore();
  _pendingRestore = setTimeout(() => {
    _pendingRestore = null;
    _restoreClipboards(snap, transcript);
  }, RESTORE_MS);
}

/**
 * Execute a single strategy. Handles clipboard prep for strategies that need it.
 * Returns { ok, strategy, error? }.
 */
async function executeStrategy(name, text) {
  const s = getStrategy(name);
  if (!s) return { ok: false, strategy: name, error: 'strategy not found' };
  const available = await s.detect();
  if (!available) return { ok: false, strategy: name, error: 'detect() returned false (requirements not met)' };

  // Clipboard prep leaks: if we set the clipboard for a strategy that then
  // FAILS, the transcript squats on the user's clipboard with no keystroke
  // ever consuming it (this clobbered Grant's copy/paste on every dictation
  // when wlcopy_then_ctrl_shift_v was failing silently, 2026-07-12). Snapshot
  // first and restore immediately on failure so a failed attempt is invisible.
  let prepSnap = null;
  if (s.needsClipboard) {
    prepSnap = await _snapshotClipboards();
    setClipboard(text);
    await new Promise(r => setTimeout(r, 50)); // small settle
  }
  try {
    const ok = await s.paste(text);
    if (!ok && prepSnap) await _restoreClipboards(prepSnap, text);
    return { ok: !!ok, strategy: name };
  } catch (e) {
    if (prepSnap) await _restoreClipboards(prepSnap, text);
    return { ok: false, strategy: name, error: e?.message || String(e) };
  }
}

/**
 * Test a strategy with a tiny dummy paste. Used by agents to discover what works.
 * Note: this WILL inject the test string into the focused window. Caller should warn user.
 */
async function testStrategy(name) {
  return await executeStrategy(name, 'wtest');
}

/**
 * Auto: run through a list of candidates in priority order until one succeeds.
 * Returns { ok, strategy, tried }. Also records the attempt in history.
 */
async function autoExecute(text, candidates, opts = {}) {
  const tried = [];
  const startedAt = Date.now();
  // A new paste supersedes any restore still pending from the previous one —
  // otherwise the old timer could fire between this paste's clipboard write
  // and its keystroke, pasting stale content.
  _cancelPendingRestore();
  const restoreWanted = opts.restoreClipboard !== false;
  const snap = restoreWanted ? await _snapshotClipboards() : null;
  for (const name of candidates) {
    const result = await executeStrategy(name, text);
    tried.push({ strategy: name, ok: result.ok, error: result.error });
    if (result.ok) {
      if (snap) _scheduleClipboardRestore(snap, text);
      _recordHistory({
        ts: startedAt,
        elapsedMs: Date.now() - startedAt,
        textLength: text.length,
        textHash: _hashShort(text),
        candidates,
        tried,
        winner: name,
        targetType: detectTargetType(),
        outcome: 'ok',
      });
      return { ok: true, strategy: name, tried };
    }
  }
  _recordHistory({
    ts: startedAt,
    elapsedMs: Date.now() - startedAt,
    textLength: text.length,
    textHash: _hashShort(text),
    candidates,
    tried,
    winner: null,
    targetType: detectTargetType(),
    outcome: 'all_failed',
  });
  return { ok: false, strategy: null, tried };
}

// ── Circular history buffer (last 50 paste attempts) ─────────────────────
const _history = [];
const HISTORY_MAX = 50;

function _hashShort(s) {
  // Tiny non-crypto hash for log identification — last-N chars + length signature.
  // We don't log the actual text (privacy).
  if (!s) return 'empty';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `${s.length}c-${(h >>> 0).toString(16).slice(-6)}`;
}

function _recordHistory(entry) {
  _history.push(entry);
  if (_history.length > HISTORY_MAX) _history.shift();
}

function getHistory(limit = 20) {
  return _history.slice(-limit).reverse();
}

function clearHistory() {
  _history.length = 0;
}

/**
 * Strategies that fire Ctrl+Shift+V as a keystroke. If the user's own
 * pasteTranscript hotkey is also Ctrl+Shift+V, these strategies will be
 * swallowed by the compositor's global-hotkey handler (Mutter routes the
 * keystroke back to Windy's /paste-transcript action) — the V never reaches
 * the focused window. We detect this collision and demote the affected
 * strategies in the chain.
 */
const CTRL_SHIFT_V_STRATEGIES = ['ydotool_keystroke_ctrl_shift_v', 'wlcopy_then_ctrl_shift_v'];

function _normalizeAccel(s) {
  return (s || '').toLowerCase().replace(/commandorcontrol/g, 'ctrl').replace(/\s/g, '');
}

function _hasCtrlShiftVCollision(hotkeysCfg) {
  const paste = _normalizeAccel(hotkeysCfg?.pasteTranscript);
  return paste === 'ctrl+shift+v';
}

/**
 * Build a default fallback chain for the current platform. Accepts an
 * optional hotkeys config so we can detect collisions and demote unsafe
 * strategies (e.g. Ctrl+Shift+V keystroke when the user's own paste hotkey
 * is the same combo on Wayland+GNOME).
 */
function defaultFallbackChain(hotkeysCfg) {
  const os = process.platform;
  const ds = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  if (os === 'darwin') {
    return ['cliclick_t_v', 'osascript_cmd_v'];
  }
  if (os === 'win32') {
    return ['windows_ui_automation', 'sendkeys_ctrl_v'];
  }
  // linux
  if (ds === 'wayland') {
    const collision = _hasCtrlShiftVCollision(hotkeysCfg);
    if (collision) {
      // User's hotkey = Ctrl+Shift+V (the default). Compositor will intercept
      // any ydotool-fired Ctrl+Shift+V and route to Windy's own paste-transcript
      // action — the V never reaches the focused window. Put typing strategies
      // first; demote keystroke strategies to last-resort (they only work for
      // XWayland targets where Mutter doesn't route X11 keystrokes to GNOME
      // keybindings — but Mutter does route them, so they'll fail there too).
      return ['wtype', 'ydotool_type', 'wlcopy_then_ctrl_shift_v', 'ydotool_keystroke_ctrl_shift_v'];
    }
    // No collision: prefer instant strategies, fall back to typing if clipboard wedged.
    return ['wtype', 'wlcopy_then_ctrl_shift_v', 'ydotool_keystroke_ctrl_shift_v', 'ydotool_type'];
  }
  // x11
  return ['xdotool_keystroke_ctrl_v', 'xdotool_type'];
}

module.exports = {
  listStrategies,
  detectAvailable,
  getStrategy,
  setClipboard,
  executeStrategy,
  testStrategy,
  autoExecute,
  defaultFallbackChain,
  detectTargetType,
  getHistory,
  clearHistory,
};
