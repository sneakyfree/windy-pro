/**
 * paste-verify.js — Linux paste-tool detection, install, and verification.
 *
 * On Linux, paste-to-cursor requires platform-specific kernel-adjacent
 * tooling that we cannot bundle inside the .AppImage:
 *
 *   X11     → xdotool         (synthetic key events via XTest)
 *   Wayland → ydotool         (writes to /dev/uinput) + ydotoold daemon
 *             + user in `input` group + /dev/uinput perms
 *   Either  → wl-clipboard / xclip  (clipboard plumbing)
 *
 * This module:
 *   1. Detects current session type (X11 vs Wayland) and which tools exist.
 *   2. Returns per-distro install commands the wizard can run via pkexec
 *      (GUI sudo prompt — no terminal sudo, never grandma-hostile).
 *   3. Provides a real test-paste loop that injects a known string and
 *      reports whether it landed.
 *
 * Not used on macOS or Windows — they have native clipboard + key APIs.
 *
 * NB: every gotcha here has a corresponding entry in
 *     docs/WAYLAND-PASTE-FOCUS-GUIDE.md. Read that before changing anything.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function execAsync(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err ? err.code : 0 });
    });
  });
}

/**
 * Detect Linux distro from /etc/os-release. Returns one of:
 *   'debian' | 'fedora' | 'arch' | 'suse' | 'unknown'
 * — same buckets used by dependency-installer.js so install commands
 * line up.
 */
function detectDistro() {
  try {
    const r = fs.readFileSync('/etc/os-release', 'utf-8').toLowerCase();
    if (/ubuntu|debian|mint|pop|elementary|zorin|kali|raspbian/.test(r)) return 'debian';
    if (/fedora|rhel|centos|rocky|alma|amazon|oracle/.test(r)) return 'fedora';
    if (/arch|manjaro|endeavour|garuda|artix/.test(r)) return 'arch';
    if (/suse|opensuse/.test(r)) return 'suse';
  } catch (_) { /* ignore */ }
  return 'unknown';
}

/**
 * Per-distro install commands for the paste tooling. We always install
 * BOTH X11 and Wayland tools — the user might log out and switch session
 * types, and the bundle is small (<2MB total).
 */
function installCommandsFor(distro) {
  switch (distro) {
    case 'debian':
      return ['apt-get update', 'apt-get install -y xdotool ydotool wl-clipboard xclip'];
    case 'fedora':
      return ['dnf install -y xdotool ydotool wl-clipboard xclip'];
    case 'arch':
      return ['pacman -Sy --noconfirm xdotool ydotool wl-clipboard xclip'];
    case 'suse':
      return ['zypper install -y xdotool ydotool wl-clipboard xclip'];
    default:
      return null;
  }
}

/**
 * Probe what's already installed and the bits the user only gets right
 * by configuring their kernel/group membership.
 */
async function detect() {
  // P8: Windows returns "applicable and ready" — PowerShell SendKeys
  // needs no install, no udev rule, no daemon. The renderer's
  // verify card still fires the test-inject so we confirm it works.
  if (process.platform === 'win32') {
    return {
      applicable: true,
      distro: 'windows',
      session: 'win32',
      isWayland: false,
      tools: { sendKeys: true },
      wayland: null,
      ready: true,
      installCommands: null,
      canPkexecInstall: false,
    };
  }
  if (process.platform !== 'linux') {
    return { applicable: false, reason: 'Not Linux — paste tooling not required.' };
  }

  const distro = detectDistro();
  const session = (process.env.XDG_SESSION_TYPE || '').toLowerCase() || 'unknown';
  const isWayland = session === 'wayland' || !!process.env.WAYLAND_DISPLAY;

  // Tool presence
  const which = async (cmd) => (await execAsync(`command -v ${cmd}`)).stdout.trim() || null;
  const [xdotool, ydotool, wlCopy, xclip, pkexec] = await Promise.all([
    which('xdotool'), which('ydotool'), which('wl-copy'), which('xclip'), which('pkexec'),
  ]);

  // Wayland-specific: need /dev/uinput, user in input group, ydotoold daemon.
  let uinputAccess = null;
  let inInputGroup = null;
  let ydotooldRunning = null;
  if (isWayland) {
    try {
      uinputAccess = fs.existsSync('/dev/uinput');
      // Crude readability check — fs.access is the right call but synchronous
      // unreadability throws, so we wrap.
      try { fs.accessSync('/dev/uinput', fs.constants.W_OK); uinputAccess = 'writable'; }
      catch { uinputAccess = uinputAccess ? 'present-but-no-write' : 'missing'; }
    } catch (_) { uinputAccess = 'missing'; }

    const groups = (await execAsync('id -nG')).stdout.split(/\s+/);
    inInputGroup = groups.includes('input');

    const psOut = await execAsync('pgrep -x ydotoold');
    ydotooldRunning = !!psOut.stdout.trim();
  }

  // Compute readiness
  const x11Ready = !!xdotool && !!xclip;
  const waylandReady = !!ydotool && !!wlCopy && uinputAccess === 'writable' && inInputGroup && ydotooldRunning;
  const ready = isWayland ? waylandReady : x11Ready;

  return {
    applicable: true,
    distro,
    session,
    isWayland,
    tools: { xdotool, ydotool, wlCopy, xclip, pkexec },
    wayland: isWayland ? { uinputAccess, inInputGroup, ydotooldRunning } : null,
    ready,
    installCommands: installCommandsFor(distro),
    // If pkexec missing, we can't offer a one-click install — must tell user.
    canPkexecInstall: !!pkexec && !!installCommandsFor(distro),
  };
}

/**
 * Run the per-distro install command via pkexec. pkexec gives a graphical
 * sudo prompt — no terminal needed, normie-friendly.
 *
 * We also try to add the user to the `input` group when Wayland was
 * detected, because ydotool fails silently otherwise (one of the four
 * Wayland gotchas in CLAUDE.md).
 */
async function install() {
  const det = await detect();
  if (!det.applicable) return { ok: false, error: 'Not applicable on this platform.' };
  if (!det.canPkexecInstall) {
    return { ok: false, error: `No one-click installer for distro "${det.distro}". Install xdotool ydotool wl-clipboard xclip manually with your package manager.` };
  }

  const cmds = [...det.installCommands];
  if (det.isWayland && det.wayland?.inInputGroup === false) {
    // Add user to input group so ydotool can write to /dev/uinput.
    // Takes effect on next login — we surface that to the UI.
    cmds.push(`usermod -a -G input ${os.userInfo().username}`);
  }
  if (det.isWayland && det.wayland?.uinputAccess !== 'writable') {
    // Persistent udev rule so /dev/uinput is group-writable.
    cmds.push(`bash -c "echo 'KERNEL==\\"uinput\\", GROUP=\\"input\\", MODE=\\"0660\\"' > /etc/udev/rules.d/99-uinput.rules"`);
    cmds.push('udevadm control --reload-rules');
    cmds.push('udevadm trigger');
  }

  // Single pkexec invocation runs the whole batch — one prompt, not five.
  const joined = cmds.join(' && ');
  const r = await execAsync(`pkexec bash -c '${joined.replace(/'/g, "'\\''")}'`, { timeout: 300000 });
  if (!r.ok) {
    return { ok: false, error: r.stderr.trim() || `pkexec exited code ${r.code}` };
  }
  // Best-effort: start ydotoold if we just installed it
  if (det.isWayland) {
    exec('systemctl --user enable --now ydotoold 2>/dev/null || ydotoold --daemon 2>/dev/null &', () => { /* fire and forget */ });
  }
  return { ok: true, ranCommands: cmds, requiresReLogin: cmds.some(c => c.startsWith('usermod')) };
}

/**
 * Inject `Hello from Windy Word` via the active session's keystroke tool.
 * Caller is responsible for focusing a text input first; we just fire the
 * keys. Returns whether the inject command itself exited cleanly — the
 * renderer-side caller must then verify the text actually landed in its
 * scratch textarea.
 */
async function injectTestKeystroke() {
  const det = await detect();
  const TEXT = 'Hello from Windy Word';

  // P8: Windows path. Linux uses xdotool/ydotool; Windows uses
  // PowerShell SendKeys (System.Windows.Forms.SendKeys). SendKeys
  // doesn't need any install — it's part of .NET Framework that
  // ships with every modern Windows — so the verify flow skips the
  // install step entirely on Windows.
  //
  // SendKeys special characters: + ^ % ~ ( ) { } must be wrapped in
  // braces. Our test string "Hello from Windy Word" contains none of
  // them, but the escaping helper is here so future strings don't
  // silently break.
  if (process.platform === 'win32') {
    const escaped = TEXT.replace(/([+^%~(){}\[\]])/g, '{$1}');
    // PowerShell invocation: load forms, call SendKeys.SendWait.
    // Not execFile because PowerShell -Command wants the full
    // script as a single arg. Double-single-quote escaping is the
    // documented PS escape for a single-quoted string.
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`;
    const r = await execAsync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '""')}"`, { timeout: 5000 });
    if (!r.ok) return { ok: false, error: r.stderr.trim() || 'SendKeys failed' };
    return { ok: true, text: TEXT };
  }

  if (!det.applicable) return { ok: false, error: 'Not Linux.' };

  if (det.isWayland) {
    if (!det.tools.ydotool) return { ok: false, error: 'ydotool missing. Run install first.' };
    if (det.wayland?.uinputAccess !== 'writable') return { ok: false, error: '/dev/uinput not writable. Run install + log out/in.' };
    // ydotool type doesn't take quotes well — use shell-escaped single quotes
    const r = await execAsync(`ydotool type --delay 25 -- '${TEXT.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    if (!r.ok) return { ok: false, error: r.stderr.trim() || 'ydotool failed' };
  } else {
    if (!det.tools.xdotool) return { ok: false, error: 'xdotool missing. Run install first.' };
    const r = await execAsync(`xdotool type --delay 25 '${TEXT.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    if (!r.ok) return { ok: false, error: r.stderr.trim() || 'xdotool failed' };
  }
  return { ok: true, text: TEXT };
}

module.exports = { detect, install, injectTestKeystroke };
