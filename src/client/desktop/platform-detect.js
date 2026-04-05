/**
 * Windy Pro — Platform Detection Module
 *
 * Detects the runtime environment once at startup and exports a frozen
 * configuration object that the rest of the app uses.  This is the ONLY
 * place platform-specific detection logic should live.
 *
 * Usage:
 *   const platform = require('./platform-detect');
 *   if (platform.hotkeyStrategy === 'gnome-dbus') { ... }
 */

const { execSync } = require('child_process');

// ── Helper: run a shell command, return trimmed stdout or fallback ──
function run(cmd, fallback = '') {
  try {
    return execSync(cmd, { timeout: 3000, encoding: 'utf-8' }).trim();
  } catch (_) {
    return fallback;
  }
}

// ── Helper: check if a binary exists on PATH ──
function hasBinary(name) {
  return run(`which ${name}`) !== '';
}

// ── Detect Linux distro from /etc/os-release ──
function detectDistro() {
  try {
    const release = require('fs').readFileSync('/etc/os-release', 'utf-8');
    const id = (release.match(/^ID=(.*)$/m) || [])[1] || '';
    const versionId = (release.match(/^VERSION_ID=(.*)$/m) || [])[1] || '';
    // Normalize: strip quotes, lowercase
    return {
      id: id.replace(/"/g, '').toLowerCase(),
      version: versionId.replace(/"/g, ''),
    };
  } catch (_) {
    return { id: 'unknown', version: '' };
  }
}

// ── Detect display server ──
function detectDisplayServer() {
  if (process.platform !== 'linux') return 'n/a';
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  if (sessionType === 'wayland') return 'wayland';
  if (sessionType === 'x11') return 'x11';
  // Fallback: check for WAYLAND_DISPLAY env var
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  // Fallback: check DISPLAY (only set on X11)
  if (process.env.DISPLAY) return 'x11';
  return 'unknown';
}

// ── Detect desktop environment ──
function detectDesktopEnvironment() {
  if (process.platform !== 'linux') return 'n/a';
  const de = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  if (de.includes('gnome') || de.includes('unity')) return 'gnome';
  if (de.includes('kde') || de.includes('plasma')) return 'kde';
  if (de.includes('cosmic')) return 'cosmic';
  if (de.includes('xfce')) return 'xfce';
  if (de.includes('cinnamon')) return 'cinnamon';
  if (de.includes('mate')) return 'mate';
  if (de.includes('lxqt') || de.includes('lxde')) return 'lxde';
  if (de.includes('budgie')) return 'budgie';
  if (de.includes('deepin')) return 'deepin';
  if (de.includes('pantheon')) return 'pantheon'; // elementary OS
  if (de.includes('pop')) return 'pop'; // Pop!_OS COSMIC (older, GNOME-based)
  if (de) return de; // Return raw value for unknown DEs
  return 'unknown';
}

// ── Derive hotkey strategy ──
function deriveHotkeyStrategy(displayServer, desktop) {
  if (process.platform !== 'linux') return 'electron-global';
  if (displayServer === 'x11') return 'electron-global';

  // Wayland strategies depend on the desktop environment
  if (displayServer === 'wayland') {
    if (desktop === 'gnome' || desktop === 'pop' || desktop === 'budgie' || desktop === 'pantheon') {
      return 'gnome-dbus'; // HTTP control server + gsettings custom keybindings
    }
    if (desktop === 'kde') {
      return 'electron-global'; // KDE's GlobalShortcuts portal actually works
    }
    // COSMIC, Xfce on Wayland, etc. — try Electron first
    return 'electron-fallback';
  }

  return 'electron-global';
}

// ── Derive paste strategy ──
// On Wayland: We force Electron to use XWayland (--ozone-platform=x11),
// so xdotool works for paste simulation without triggering GNOME's
// "Allow Remote Interaction" permission dialog (which ydotool causes).
// Prefer xdotool; fall back to ydotool only if xdotool is unavailable.
function derivePasteStrategy(displayServer, _hasYdotool, _hasXdotool) {
  if (process.platform === 'darwin') return 'osascript';
  if (process.platform === 'win32') return 'powershell';
  if (process.platform !== 'linux') return 'clipboard-only';

  // Wayland+XWayland: xdotool works for XWayland windows (most apps)
  // without the security popup that ydotool triggers
  if (displayServer === 'wayland') {
    if (_hasXdotool) return 'xdotool';
    if (_hasYdotool) return 'ydotool';
    return 'clipboard-only';
  }

  // X11: xdotool is the standard
  if (_hasXdotool) return 'xdotool';
  return 'clipboard-only';
}

// ── Derive focus strategy ──
function deriveFocusStrategy(displayServer) {
  if (process.platform !== 'linux') return 'native';
  if (displayServer === 'x11') return 'xdotool-focus';
  if (displayServer === 'wayland') return 'wayland-blur';
  return 'native';
}

// ── Build the platform config ──
function detect() {
  const os = process.platform; // 'linux', 'darwin', 'win32'
  const distro = os === 'linux' ? detectDistro() : { id: os, version: '' };
  const displayServer = detectDisplayServer();
  const desktop = detectDesktopEnvironment();
  const _hasXdotool = os === 'linux' ? hasBinary('xdotool') : false;
  const _hasYdotool = os === 'linux' ? hasBinary('ydotool') : false;
  const _hasCurl = os === 'linux' ? hasBinary('curl') : false;
  const _hasGsettings = os === 'linux' ? hasBinary('gsettings') : false;

  const config = Object.freeze({
    os,
    distro: distro.id,
    distroVersion: distro.version,
    displayServer,
    desktop,

    // Tool availability
    hasXdotool: _hasXdotool,
    hasYdotool: _hasYdotool,
    hasCurl: _hasCurl,
    hasGsettings: _hasGsettings,

    // Derived strategies
    hotkeyStrategy: deriveHotkeyStrategy(displayServer, desktop),
    pasteStrategy: derivePasteStrategy(displayServer, _hasYdotool, _hasXdotool),
    focusStrategy: deriveFocusStrategy(displayServer),

    // Convenience booleans
    isWayland: displayServer === 'wayland',
    isX11: displayServer === 'x11',
    isGnome: desktop === 'gnome' || desktop === 'pop' || desktop === 'budgie',
    isKDE: desktop === 'kde',
    isLinux: os === 'linux',
    isMac: os === 'darwin',
    isWindows: os === 'win32',
    needsWaylandWorkaround: displayServer === 'wayland' && deriveHotkeyStrategy(displayServer, desktop) === 'gnome-dbus',
  });

  // Log detection results at startup
  if (os === 'linux') {
    console.info(`[Platform] OS: ${distro.id} ${distro.version}`);
    console.info(`[Platform] Display: ${displayServer}, Desktop: ${desktop}`);
    console.info(`[Platform] Tools: xdotool=${_hasXdotool}, ydotool=${_hasYdotool}, gsettings=${_hasGsettings}`);
    console.info(`[Platform] Strategies: hotkey=${config.hotkeyStrategy}, paste=${config.pasteStrategy}, focus=${config.focusStrategy}`);
  } else {
    console.info(`[Platform] OS: ${os}`);
  }

  return config;
}

// Run detection once and cache
const PLATFORM = detect();

module.exports = PLATFORM;
