// install_dependency: install whitelisted system tools that expand Windy Word's
// capabilities (paste backends, clipboard helpers, etc.) via the distro's
// package manager wrapped in pkexec so the user always sees the polkit GUI
// prompt and explicitly approves.
//
// Linux only in v0. macOS / Windows surface a friendly error directing the
// user to install via brew / winget manually.
//
// Tool whitelist is the contract: agents can install ONLY these names. Each
// entry maps to the per-distro package name. The endpoint validates the
// requested tool against this map before doing anything else.

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Per-tool metadata. `binary` is what we look up on PATH to decide
// "already installed" — most packages share a name with their primary
// binary, but wl-clipboard's package provides `wl-copy` + `wl-paste`
// (no binary named wl-clipboard).
const TOOL_WHITELIST = {
  wtype: {
    binary: 'wtype',
    description: 'Wayland-native keystroke injection. Promotes paste to instant on Wayland-native targets.',
    pkg: { fedora: 'wtype', rhel: 'wtype', centos: 'wtype', debian: 'wtype', ubuntu: 'wtype', pop: 'wtype', arch: 'wtype', manjaro: 'wtype' },
  },
  ydotool: {
    binary: 'ydotool',
    description: 'Wayland keystroke injection via /dev/uinput. Universal Wayland keystroke fallback.',
    pkg: { fedora: 'ydotool', rhel: 'ydotool', centos: 'ydotool', debian: 'ydotool', ubuntu: 'ydotool', pop: 'ydotool', arch: 'ydotool', manjaro: 'ydotool' },
  },
  'wl-clipboard': {
    binary: 'wl-copy',
    description: 'Wayland clipboard utilities (wl-copy, wl-paste). Required for clipboard-write strategies on Wayland.',
    pkg: { fedora: 'wl-clipboard', rhel: 'wl-clipboard', centos: 'wl-clipboard', debian: 'wl-clipboard', ubuntu: 'wl-clipboard', pop: 'wl-clipboard', arch: 'wl-clipboard', manjaro: 'wl-clipboard' },
  },
  xdotool: {
    binary: 'xdotool',
    description: 'X11 keystroke injection. Used for XWayland focus restoration and X11-session paste.',
    pkg: { fedora: 'xdotool', rhel: 'xdotool', centos: 'xdotool', debian: 'xdotool', ubuntu: 'xdotool', pop: 'xdotool', arch: 'xdotool', manjaro: 'xdotool' },
  },
};

const DISTRO_INSTALL = {
  fedora: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
  rhel: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
  centos: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
  debian: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
  ubuntu: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
  pop: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
  arch: (pkg) => ['pkexec', ['pacman', '-S', '--noconfirm', pkg]],
  manjaro: (pkg) => ['pkexec', ['pacman', '-S', '--noconfirm', pkg]],
};

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURED_BYTES = 16 * 1024;
const AUDIT_BUFFER_LIMIT = 100;
const _auditLog = [];

function recordAudit(entry) {
  _auditLog.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (_auditLog.length > AUDIT_BUFFER_LIMIT) _auditLog.length = AUDIT_BUFFER_LIMIT;
}

function getAuditLog(limit = 20) {
  const clamped = Math.max(1, Math.min(AUDIT_BUFFER_LIMIT, limit));
  return _auditLog.slice(0, clamped);
}

function clearAuditLog() {
  _auditLog.length = 0;
}

async function isInstalled(tool) {
  const meta = TOOL_WHITELIST[tool];
  const binary = meta?.binary || tool;
  try {
    await execFileAsync('which', [binary], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function listInstallable(platform) {
  if (!platform.isLinux) {
    return {
      supported: false,
      reason: `install_dependency only supports Linux in v0. On ${platform.os}, install paste-related tools manually: 'brew install wtype' (macOS — wtype is Wayland-only so usually unneeded), or via winget on Windows.`,
      tools: [],
    };
  }
  const distroBuilder = DISTRO_INSTALL[platform.distro];
  if (!distroBuilder) {
    return {
      supported: false,
      reason: `Unsupported distro: ${platform.distro}. Supported: ${Object.keys(DISTRO_INSTALL).join(', ')}.`,
      tools: [],
    };
  }
  const tools = Object.entries(TOOL_WHITELIST).map(([name, meta]) => {
    const [cmd, args] = distroBuilder(meta.pkg[platform.distro] || name);
    return {
      name,
      description: meta.description,
      packageName: meta.pkg[platform.distro] || name,
      installCommand: [cmd, ...args].join(' '),
    };
  });
  return { supported: true, distro: platform.distro, tools };
}

async function install(tool, platform, opts = {}) {
  const meta = TOOL_WHITELIST[tool];
  if (!meta) {
    const err = { ok: false, tool, error: `Tool not in whitelist: ${tool}`, allowed: Object.keys(TOOL_WHITELIST) };
    recordAudit(err);
    return err;
  }
  if (!platform.isLinux) {
    const err = { ok: false, tool, error: `install_dependency only supports Linux in v0; this machine is ${platform.os}` };
    recordAudit(err);
    return err;
  }
  const distroBuilder = DISTRO_INSTALL[platform.distro];
  if (!distroBuilder) {
    const err = { ok: false, tool, error: `Unsupported distro: ${platform.distro}` };
    recordAudit(err);
    return err;
  }

  if (await isInstalled(tool)) {
    const result = { ok: true, tool, alreadyInstalled: true };
    recordAudit(result);
    return result;
  }

  const pkg = meta.pkg[platform.distro] || tool;
  const [cmd, args] = distroBuilder(pkg);
  const command = [cmd, ...args].join(' ');

  if (opts.dryRun) {
    const result = { ok: true, tool, dryRun: true, command, package: pkg };
    recordAudit(result);
    return result;
  }

  const start = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }, INSTALL_TIMEOUT_MS);

    const cap = (which) => (d) => {
      const s = which === 'out' ? (stdout += d) : (stderr += d);
      if (s.length > MAX_CAPTURED_BYTES) {
        if (which === 'out') stdout = stdout.slice(-MAX_CAPTURED_BYTES);
        else stderr = stderr.slice(-MAX_CAPTURED_BYTES);
      }
    };
    proc.stdout.on('data', cap('out'));
    proc.stderr.on('data', cap('err'));

    proc.on('error', (e) => {
      clearTimeout(timer);
      const result = { ok: false, tool, package: pkg, command, error: `spawn failed: ${e.message}` };
      recordAudit(result);
      resolve(result);
    });

    proc.on('close', async (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - start;
      // pkexec exit codes worth surfacing:
      //   126 = user cancelled the polkit dialog
      //   127 = authentication failed
      let userMessage;
      if (code === 126) userMessage = 'Cancelled at polkit prompt.';
      else if (code === 127) userMessage = 'polkit authentication failed (wrong password or no rights).';
      else if (signal === 'SIGKILL') userMessage = `Install timed out after ${INSTALL_TIMEOUT_MS / 1000}s and was killed.`;

      const nowInstalled = await isInstalled(tool);
      const result = {
        ok: code === 0 && nowInstalled,
        tool,
        package: pkg,
        command,
        exitCode: code,
        signal: signal || undefined,
        elapsedMs,
        installed: nowInstalled,
        userMessage,
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
      };
      recordAudit(result);
      resolve(result);
    });
  });
}

module.exports = { TOOL_WHITELIST, listInstallable, install, getAuditLog, clearAuditLog };
