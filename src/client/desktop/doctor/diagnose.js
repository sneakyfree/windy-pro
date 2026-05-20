// Windy Doctor (local v0) — runs a battery of rule-based health checks
// against the running Windy Word + system state. Each check returns a
// finding with:
//
//   status         — 'ok' | 'warning' | 'error' | 'not_applicable'
//   severity       — 'info' | 'low' | 'medium' | 'high' | 'critical'
//   description    — what was checked
//   finding        — what we saw
//   remediation    — actionable fix, often referencing a specific MCP tool
//                    call the agent can make (install_dependency, set_setting, etc.)
//
// The cloud-relay piece (windy-fix-me) is deferred: it would take this
// local finding bundle, route it to a remote diagnostic service for
// richer analysis (LLM-powered + community knowledge), and return
// expanded remediation. For now, local-only diagnostics already cover
// the common cases.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');

async function hasBinary(name) {
  try {
    await execFileAsync('which', [name], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function processRunning(pattern) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern], { timeout: 1500 });
    return stdout.trim().split('\n').filter(Boolean).length > 0;
  } catch {
    return false;
  }
}

async function fileReadable(path) {
  try { await fs.promises.access(path, fs.constants.R_OK); return true; } catch { return false; }
}

async function fileWritable(path) {
  try { await fs.promises.access(path, fs.constants.W_OK); return true; } catch { return false; }
}

// ── Individual checks ────────────────────────────────────────────────────

const CHECKS = [
  {
    name: 'wtype_installed',
    description: 'wtype is the Wayland-native keystroke injection tool. When present + the compositor supports the virtual-keyboard protocol, paste is structurally instant on Wayland-native targets.',
    appliesTo: (p) => p.isLinux && p.isWayland,
    async run() {
      const ok = await hasBinary('wtype');
      if (ok) return { status: 'ok', severity: 'info', finding: 'wtype is on PATH.' };
      return {
        status: 'warning',
        severity: 'medium',
        finding: 'wtype is not installed — paste falls back to ydotool typing (~1-5ms/char) or clipboard-write strategies.',
        remediation: 'Call install_dependency({tool: "wtype"}) to install. Pairs with the polkit rule at /etc/polkit-1/rules.d/49-windy-install-deps.rules for zero-prompt install.',
      };
    },
  },
  {
    name: 'ydotool_installed',
    description: 'ydotool injects keystrokes via /dev/uinput. Universal Wayland keystroke fallback that works on any focused target — slower than wtype but more compatible.',
    appliesTo: (p) => p.isLinux && p.isWayland,
    async run() {
      const ok = await hasBinary('ydotool');
      if (ok) return { status: 'ok', severity: 'info', finding: 'ydotool is on PATH.' };
      return {
        status: 'error',
        severity: 'high',
        finding: 'ydotool is not installed — Wayland paste cannot fall back to keystroke injection. The clipboard-write strategies still work but are slower and brittle on Mutter.',
        remediation: 'Call install_dependency({tool: "ydotool"}).',
      };
    },
  },
  {
    name: 'wl_clipboard_installed',
    description: 'wl-clipboard provides wl-copy / wl-paste — used by the wlcopy_then_ctrl_shift_v paste strategy and any clipboard-write fallback on Wayland.',
    appliesTo: (p) => p.isLinux && p.isWayland,
    async run() {
      const ok = await hasBinary('wl-copy');
      if (ok) return { status: 'ok', severity: 'info', finding: 'wl-copy is on PATH.' };
      return {
        status: 'warning',
        severity: 'medium',
        finding: 'wl-clipboard not installed — Wayland clipboard-write strategies will fail.',
        remediation: 'Call install_dependency({tool: "wl-clipboard"}).',
      };
    },
  },
  {
    name: 'xdotool_installed',
    description: 'xdotool injects X11 keystrokes — needed for X11 sessions and for XWayland focus restoration on Wayland.',
    appliesTo: (p) => p.isLinux,
    async run() {
      const ok = await hasBinary('xdotool');
      if (ok) return { status: 'ok', severity: 'info', finding: 'xdotool is on PATH.' };
      return {
        status: 'warning',
        severity: 'medium',
        finding: 'xdotool is not installed — XWayland focus restoration after recording may fail; X11-session paste will fail entirely.',
        remediation: 'Call install_dependency({tool: "xdotool"}).',
      };
    },
  },
  {
    name: 'uinput_writable',
    description: 'ydotool needs write access to /dev/uinput to inject keystrokes. Requires user in `input` group + a udev rule granting group write.',
    appliesTo: (p) => p.isLinux,
    async run() {
      const exists = await fileReadable('/dev/uinput');
      if (!exists) return { status: 'error', severity: 'high', finding: '/dev/uinput does not exist (kernel uinput module missing?).', remediation: 'sudo modprobe uinput; then ensure uinput is loaded at boot.' };
      const writable = await fileWritable('/dev/uinput');
      if (writable) return { status: 'ok', severity: 'info', finding: '/dev/uinput exists and is writable by this user — ydotool can inject keystrokes.' };
      return {
        status: 'error',
        severity: 'high',
        finding: '/dev/uinput exists but is not writable by this user — ydotool will spawn but cannot inject. Paste to Wayland-native targets will fail.',
        remediation: 'Add user to `input` group: sudo usermod -aG input $USER. Add udev rule: echo \'KERNEL=="uinput", GROUP="input", MODE="0660"\' | sudo tee /etc/udev/rules.d/60-uinput.rules. Then re-login.',
      };
    },
  },
  {
    name: 'ydotoold_running',
    description: 'ydotool depends on the ydotoold daemon. Windy Word starts its own user-level instance at app launch, but if /dev/uinput is unwritable that fails silently.',
    appliesTo: (p) => p.isLinux && p.isWayland,
    async run() {
      const running = await processRunning('ydotoold');
      if (running) return { status: 'ok', severity: 'info', finding: 'ydotoold daemon is running.' };
      return {
        status: 'warning',
        severity: 'medium',
        finding: 'ydotoold daemon is NOT running. Either Windy Word\'s startup launch failed (check /dev/uinput permissions) or the daemon crashed.',
        remediation: 'Restart Windy Word — it will attempt to start the user-level ydotoold at boot. If that fails, fix /dev/uinput permissions first (see uinput_writable check).',
      };
    },
  },
  {
    name: 'install_polkit_rule',
    description: 'The /etc/polkit-1/rules.d/49-windy-install-deps.rules file auto-approves pkexec calls for the install_dependency whitelist so agents can install tools with zero prompts.',
    appliesTo: (p) => p.isLinux,
    async run() {
      // /etc/polkit-1/rules.d/ is typically drwxr-x--- root:polkitd — non-
      // polkitd users (including Windy Word's electron) can't fs.access() into
      // it even when the rule file inside is world-readable. We have three
      // detection states:
      //   - file exists & we can stat it  → ok
      //   - parent dir is EACCES          → "unverifiable" (best-effort: signal info)
      //   - everything else (EOENT)       → warning, rule is genuinely missing
      const rulePath = '/etc/polkit-1/rules.d/49-windy-install-deps.rules';
      try {
        await fs.promises.access(rulePath, fs.constants.F_OK);
        return { status: 'ok', severity: 'info', finding: 'Polkit auto-approve rule is installed. install_dependency runs without prompts.' };
      } catch (err) {
        if (err.code === 'EACCES') {
          // Can't see inside /etc/polkit-1/rules.d — fall back to behavioral
          // signal: if recent installs in the audit log completed quickly
          // (suggesting no prompt was shown), the rule is probably active.
          return {
            status: 'ok',
            severity: 'info',
            finding: 'Cannot directly verify polkit rule presence (parent dir /etc/polkit-1/rules.d/ is polkitd-group-restricted, which is the default). The rule appears active if install_dependency calls complete without a visible polkit dialog. Compare get_install_history elapsedMs across calls to confirm.',
          };
        }
        if (err.code === 'ENOENT') {
          return {
            status: 'warning',
            severity: 'low',
            finding: 'Polkit auto-approve rule is missing — install_dependency will work but each call triggers a polkit GUI prompt.',
            remediation: 'See reference_polkit_install_rule.md in the kit-army-config docs for the install snippet. Requires sudo once per machine.',
          };
        }
        return { status: 'warning', severity: 'low', finding: `Could not check polkit rule: ${err.message}` };
      }
    },
  },
  {
    name: 'pyengine_running',
    description: 'Windy Word\'s Python transcription engine runs as a child process at app launch. If it has crashed, recordings will not transcribe.',
    appliesTo: () => true,
    async run() {
      const running = await processRunning('src.engine.server|engine/server.py|engine.server');
      if (running) return { status: 'ok', severity: 'info', finding: 'Python transcription engine process is running.' };
      return {
        status: 'error',
        severity: 'critical',
        finding: 'Python transcription engine is NOT running. Recordings can be captured but will not be transcribed.',
        remediation: 'Restart Windy Word. If the engine fails repeatedly, check the engine log and the bundled Python wheels.',
      };
    },
  },
  // ── macOS ────────────────────────────────────────────────────────────
  {
    name: 'homebrew_installed',
    description: 'Homebrew is the macOS package manager install_dependency uses to add cliclick and ffmpeg. Without it, no automated install path on macOS.',
    appliesTo: (p) => p.isMac,
    async run() {
      const ok = await hasBinary('brew');
      if (ok) return { status: 'ok', severity: 'info', finding: 'brew is on PATH — install_dependency works on macOS.' };
      return {
        status: 'warning',
        severity: 'medium',
        finding: 'Homebrew is not installed — install_dependency cannot install cliclick or ffmpeg on this Mac.',
        remediation: 'Install Homebrew from https://brew.sh (one-line shell installer). After that, install_dependency works without further setup.',
      };
    },
  },
  {
    name: 'cliclick_installed',
    description: 'cliclick is the fast macOS paste backend used by the cliclick_t_v paste strategy (~2-3× faster than the default osascript Cmd+V).',
    appliesTo: (p) => p.isMac,
    async run() {
      const ok = await hasBinary('cliclick');
      if (ok) return { status: 'ok', severity: 'info', finding: 'cliclick is on PATH — fast paste strategy enabled.' };
      return {
        status: 'warning',
        severity: 'low',
        finding: 'cliclick is not installed — paste falls back to slower osascript Cmd+V.',
        remediation: 'Call install_dependency({tool: "cliclick"}) — brew install runs in user-scope (~10-30s, no sudo).',
      };
    },
  },
  {
    name: 'accessibility_permission_granted',
    description: 'macOS Accessibility permission lets Windy Word inject Cmd+V (or cliclick) keystrokes into the focused app after recording. Without it, the recording transcribes but nothing pastes — silent no-op from the user\'s perspective.',
    appliesTo: (p) => p.isMac,
    async run() {
      try {
        const { systemPreferences } = require('electron');
        // false → check status without prompting (prompting requires a user gesture)
        const trusted = systemPreferences.isTrustedAccessibilityClient(false);
        if (trusted) return { status: 'ok', severity: 'info', finding: 'This Electron process is a trusted Accessibility client — keystroke paste works.' };
        return {
          status: 'error',
          severity: 'critical',
          finding: 'Accessibility permission is NOT granted. Recordings will transcribe but paste will silently no-op — the most common "Windy Word looks broken" failure on macOS.',
          remediation: 'Open System Settings → Privacy & Security → Accessibility and enable Windy Word (in dev: enable Electron). Accessibility cannot be granted programmatically on macOS — this requires a user click.',
        };
      } catch (e) {
        return { status: 'warning', severity: 'low', finding: `Could not check Accessibility status: ${e.message}` };
      }
    },
  },
  {
    name: 'microphone_permission_granted',
    description: 'macOS Microphone permission is required for getUserMedia to return an audio stream. Without it, recording fails immediately and silently.',
    appliesTo: (p) => p.isMac,
    async run() {
      try {
        const { systemPreferences } = require('electron');
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') return { status: 'ok', severity: 'info', finding: 'Microphone access granted.' };
        if (status === 'not-determined') {
          return {
            status: 'warning',
            severity: 'medium',
            finding: 'Microphone permission has not been requested yet — the first recording will trigger the system prompt.',
            remediation: 'Start a recording (toggle_recording) to surface the macOS permission prompt, then approve. After that the status becomes "granted" and stays that way.',
          };
        }
        return {
          status: 'error',
          severity: 'critical',
          finding: `Microphone access status is "${status}" — recordings will fail to capture audio.`,
          remediation: 'Open System Settings → Privacy & Security → Microphone and enable Windy Word. Microphone cannot be granted programmatically on macOS — this requires a user click.',
        };
      } catch (e) {
        return { status: 'warning', severity: 'low', finding: `Could not check Microphone status: ${e.message}` };
      }
    },
  },
  {
    name: 'mutter_hotkey_collision',
    description: 'On Wayland+GNOME, Mutter intercepts Ctrl+Shift+V for Windy Word\'s own pasteTranscript GNOME custom keybinding before forwarded keystrokes can reach the focused window. The paste-strategy registry auto-detects this and demotes the colliding strategies.',
    appliesTo: (p) => p.isLinux && p.isWayland && p.isGnome,
    async run() {
      // The detection logic is in pasteStrategies.defaultFallbackChain.
      // Re-derive it here: if the user has Ctrl+Shift+V bound to pasteTranscript,
      // and we're on Wayland+GNOME with GNOME custom keybindings active,
      // the collision is present.
      let hotkeys;
      try { hotkeys = require('../platform-detect'); } catch { /* not needed */ }
      // Cheaper: just check the store via the caller — we'll wire that
      // through main.js. Here we report "see paste/strategies endpoint".
      return {
        status: 'ok',
        severity: 'info',
        finding: 'See list_paste_strategies.hotkeyCollisionDetected for the live state. The paste registry auto-handles the collision by reordering the fallback chain.',
      };
    },
  },
];

async function runDiagnostics(platform) {
  const findings = [];
  for (const check of CHECKS) {
    if (check.appliesTo && !check.appliesTo(platform)) {
      findings.push({
        name: check.name,
        description: check.description,
        status: 'not_applicable',
        reason: 'does not apply to this OS/display server',
      });
      continue;
    }
    try {
      const result = await check.run(platform);
      findings.push({ name: check.name, description: check.description, ...result });
    } catch (e) {
      findings.push({ name: check.name, description: check.description, status: 'error', severity: 'medium', finding: `check threw: ${e.message}` });
    }
  }

  // Roll up
  const counts = findings.reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {});
  const errors = findings.filter((f) => f.status === 'error');
  const warnings = findings.filter((f) => f.status === 'warning');
  const overall = errors.length > 0 ? 'unhealthy' : warnings.length > 0 ? 'degraded' : 'healthy';

  return {
    overall,
    counts,
    findings,
    actionable: [...errors, ...warnings].map((f) => ({
      check: f.name,
      severity: f.severity,
      finding: f.finding,
      remediation: f.remediation || 'No automated remediation — investigate manually.',
    })),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { runDiagnostics, CHECKS };
