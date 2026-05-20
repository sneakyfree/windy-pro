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

// Per-tool metadata. Cross-platform: each tool declares which OSes it
// supports + how to install it on each. `binary` is what we look up on
// PATH to decide "already installed" — most packages share a name with
// their primary binary, but wl-clipboard's package provides `wl-copy` +
// `wl-paste` (no binary named wl-clipboard).
//
// `install.<os>.<package-manager>` is the package name for that OS+PM
// combo. `null` (or missing key) means the tool isn't installable on
// that OS — the agent gets a friendly "not supported on this platform"
// response.
const TOOL_WHITELIST = {
  wtype: {
    binary: 'wtype',
    description: 'Wayland-native keystroke injection. Promotes paste to instant on Wayland-native targets.',
    install: {
      linux: { fedora: 'wtype', rhel: 'wtype', centos: 'wtype', debian: 'wtype', ubuntu: 'wtype', pop: 'wtype', arch: 'wtype', manjaro: 'wtype' },
      // No Wayland on macOS / Windows — wtype is Linux-only.
    },
  },
  ydotool: {
    binary: 'ydotool',
    description: 'Wayland keystroke injection via /dev/uinput. Universal Wayland keystroke fallback.',
    install: {
      linux: { fedora: 'ydotool', rhel: 'ydotool', centos: 'ydotool', debian: 'ydotool', ubuntu: 'ydotool', pop: 'ydotool', arch: 'ydotool', manjaro: 'ydotool' },
    },
  },
  'wl-clipboard': {
    binary: 'wl-copy',
    description: 'Wayland clipboard utilities (wl-copy, wl-paste). Required for clipboard-write strategies on Wayland.',
    install: {
      linux: { fedora: 'wl-clipboard', rhel: 'wl-clipboard', centos: 'wl-clipboard', debian: 'wl-clipboard', ubuntu: 'wl-clipboard', pop: 'wl-clipboard', arch: 'wl-clipboard', manjaro: 'wl-clipboard' },
    },
  },
  xdotool: {
    binary: 'xdotool',
    description: 'X11 keystroke injection. Used for XWayland focus restoration and X11-session paste.',
    install: {
      linux: { fedora: 'xdotool', rhel: 'xdotool', centos: 'xdotool', debian: 'xdotool', ubuntu: 'xdotool', pop: 'xdotool', arch: 'xdotool', manjaro: 'xdotool' },
    },
  },
  cliclick: {
    binary: 'cliclick',
    description: 'macOS fast paste via Cmd+V simulation. ~2-3× faster than the default osascript path.',
    install: {
      darwin: { brew: 'cliclick' },
    },
  },
  ffmpeg: {
    binary: 'ffmpeg',
    description: 'Audio/video re-encoding. Used by future paste-history export + voice-clone training-data prep features.',
    install: {
      linux: { fedora: 'ffmpeg', rhel: 'ffmpeg', centos: 'ffmpeg', debian: 'ffmpeg', ubuntu: 'ffmpeg', pop: 'ffmpeg', arch: 'ffmpeg', manjaro: 'ffmpeg' },
      darwin: { brew: 'ffmpeg' },
      win32: { winget: 'Gyan.FFmpeg' },
    },
  },
};

// Build install-command builders per (os, package-manager) combo.
//
// Linux: pkexec wraps the distro install command. Pairs with the polkit
//   rule at /etc/polkit-1/rules.d/49-windy-install-deps.rules which
//   auto-approves the whitelist for grantwhitmer — without the rule the
//   user sees a polkit prompt (still works, just not zero-touch).
//
// macOS: brew installs to user-scope, no sudo needed (brew is itself
//   user-installed under /opt/homebrew or /usr/local/Homebrew). The
//   first `brew install` after a long gap can hit a brew update which
//   may take a minute or two; the 5-min sync timeout handles it.
//
// Windows: winget handles UAC internally — the elevation prompt fires
//   only if the package itself needs admin rights. --silent suppresses
//   per-package prompts; the two --accept flags handle EULA / source
//   confirmations that would otherwise hang the spawn.
const OS_INSTALL = {
  linux: {
    fedora: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
    rhel: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
    centos: (pkg) => ['pkexec', ['dnf', 'install', '-y', pkg]],
    debian: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
    ubuntu: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
    pop: (pkg) => ['pkexec', ['apt-get', 'install', '-y', pkg]],
    arch: (pkg) => ['pkexec', ['pacman', '-S', '--noconfirm', pkg]],
    manjaro: (pkg) => ['pkexec', ['pacman', '-S', '--noconfirm', pkg]],
  },
  darwin: {
    brew: (pkg) => ['brew', ['install', pkg]],
  },
  win32: {
    winget: (pkg) => ['winget', ['install', '--silent', '--accept-source-agreements', '--accept-package-agreements', pkg]],
  },
};

// Pick the package-manager key for the running platform. On Linux this is
// the distro id from PLATFORM.distro. On macOS/Windows there is only one
// supported PM so the choice is trivial.
function packageManagerFor(platform) {
  if (platform.isLinux) return platform.distro;
  if (platform.isMac) return 'brew';
  if (platform.isWindows) return 'winget';
  return null;
}

// What's installable for this (tool, platform) combo? Returns the package
// name or null if the tool isn't supported on this OS or this distro.
function packageNameFor(tool, platform) {
  const meta = TOOL_WHITELIST[tool];
  if (!meta) return null;
  const osKey = platform.isLinux ? 'linux' : platform.isMac ? 'darwin' : platform.isWindows ? 'win32' : null;
  const osInstall = meta.install?.[osKey];
  if (!osInstall) return null;
  const pm = packageManagerFor(platform);
  return osInstall[pm] || null;
}

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
  const osKey = platform.isLinux ? 'linux' : platform.isMac ? 'darwin' : platform.isWindows ? 'win32' : null;
  if (!osKey || !OS_INSTALL[osKey]) {
    return {
      supported: false,
      reason: `install_dependency does not yet support OS "${platform.os}". Supported: linux, darwin, win32.`,
      tools: [],
    };
  }
  const pm = packageManagerFor(platform);
  const pmBuilder = OS_INSTALL[osKey][pm];
  if (!pmBuilder) {
    const supported = Object.keys(OS_INSTALL[osKey]).join(', ');
    return {
      supported: false,
      reason: `Unsupported ${osKey} package manager: ${pm}. Supported on ${osKey}: ${supported}.`,
      tools: [],
    };
  }
  const tools = [];
  for (const [name, meta] of Object.entries(TOOL_WHITELIST)) {
    const pkg = packageNameFor(name, platform);
    if (!pkg) continue;  // tool not supported on this OS
    const [cmd, args] = pmBuilder(pkg);
    tools.push({
      name,
      description: meta.description,
      packageName: pkg,
      packageManager: pm,
      installCommand: [cmd, ...args].join(' '),
    });
  }
  return { supported: true, os: osKey, packageManager: pm, distro: platform.isLinux ? platform.distro : undefined, tools };
}

async function install(tool, platform, opts = {}) {
  const meta = TOOL_WHITELIST[tool];
  if (!meta) {
    const err = { ok: false, tool, error: `Tool not in whitelist: ${tool}`, allowed: Object.keys(TOOL_WHITELIST) };
    recordAudit(err);
    return err;
  }
  const osKey = platform.isLinux ? 'linux' : platform.isMac ? 'darwin' : platform.isWindows ? 'win32' : null;
  if (!osKey || !OS_INSTALL[osKey]) {
    const err = { ok: false, tool, error: `OS "${platform.os}" not supported by install_dependency` };
    recordAudit(err);
    return err;
  }
  const pkg = packageNameFor(tool, platform);
  if (!pkg) {
    const err = { ok: false, tool, error: `Tool "${tool}" is not installable on ${osKey}/${platform.distro || platform.os} via the whitelist.` };
    recordAudit(err);
    return err;
  }
  const pm = packageManagerFor(platform);
  const pmBuilder = OS_INSTALL[osKey][pm];
  if (!pmBuilder) {
    const err = { ok: false, tool, error: `No install command for ${osKey}/${pm}` };
    recordAudit(err);
    return err;
  }

  if (await isInstalled(tool)) {
    const result = { ok: true, tool, alreadyInstalled: true };
    recordAudit(result);
    return result;
  }

  const [cmd, args] = pmBuilder(pkg);
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

// ── Async install with status polling ──────────────────────────────────
//
// For long-running installs (anything more than a few seconds), the
// caller may prefer to fire-and-poll rather than block. installAsync()
// returns immediately with a jobId; the caller checks getInstallStatus(jobId)
// until status === 'completed'.
//
// Job lifecycle:
//   created  → background install spawned, status = "running"
//   running  → pkexec/etc in flight
//   completed → status = "completed", `result` populated with the same
//               shape install() returns synchronously
//
// In-memory only. Restart clears jobs. FIFO-evicts beyond 50 entries.
const _jobs = new Map();
let _nextJobId = 1;
const JOB_BUFFER_LIMIT = 50;

function _evictOldJobs() {
  while (_jobs.size > JOB_BUFFER_LIMIT) {
    const oldestKey = _jobs.keys().next().value;
    _jobs.delete(oldestKey);
  }
}

function installAsync(tool, platform, opts = {}) {
  const jobId = `install-${_nextJobId++}-${Date.now()}`;
  const job = {
    jobId,
    tool,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
  };
  _jobs.set(jobId, job);
  _evictOldJobs();
  // Run the install in the background. We deliberately don't await this.
  install(tool, platform, opts).then((result) => {
    job.result = result;
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
  }).catch((e) => {
    job.result = { ok: false, tool, error: `installAsync caught: ${e.message}` };
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
  });
  return { jobId, status: 'running', tool, hint: 'Poll GET /install/status?jobId=' + jobId };
}

function getInstallStatus(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return { jobId, status: 'unknown', error: 'job not found (may have been FIFO-evicted or never existed)' };
  return job;
}

function listJobs() {
  return Array.from(_jobs.values());
}

module.exports = { TOOL_WHITELIST, listInstallable, install, installAsync, getInstallStatus, listJobs, getAuditLog, clearAuditLog };
