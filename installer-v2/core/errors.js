// Stable error code registry for the install path.
//
// Why a registry instead of free-form throw new Error('...'):
//   1. Users can google "WINDY-001" and land on docs/ERRORS.md with
//      diagnostic + fix steps.
//   2. Support replies become "what's the WINDY-NNN code?" instead of
//      "paste your full stack trace".
//   3. Adding a new failure mode forces the author through this file
//      AND docs/ERRORS.md — no error ships without an entry.
//
// To add a new code:
//   1. Pick the next free WINDY-NNN below.
//   2. Add an entry to ERROR_CATALOG with code, title, friendly
//      message, fix steps.
//   3. Use `WindyError.from('WINDY-NNN', context?)` at the throw site.
//   4. Add the matching section to docs/ERRORS.md.

'use strict';

/**
 * Registry of every user-facing error the wizard can surface.
 *
 * Fields:
 *   code      — stable identifier; never reuse a retired code
 *   title     — short headline for UI ("Setup couldn't reach the network")
 *   user      — friendly message shown in the wizard UI
 *   fix       — short imperative ("Connect to the internet and retry")
 *   docsAnchor — slug for docs/ERRORS.md anchor
 *   matchers  — substrings that, when found in error.message, map a
 *               raw thrown error to this code. Used by friendlyError()
 *               to upgrade legacy throws transparently.
 */
const ERROR_CATALOG = Object.freeze({
  'WINDY-001': {
    code: 'WINDY-001',
    title: 'Network unreachable',
    user: 'No internet connection detected. Please connect to the internet and try again.',
    fix: 'Reconnect to Wi-Fi or Ethernet, then click Retry.',
    docsAnchor: 'WINDY-001-network-unreachable',
    matchers: ['No internet connection', 'ENOTFOUND', 'ENETUNREACH'],
  },
  'WINDY-002': {
    code: 'WINDY-002',
    title: 'Network timeout',
    user: 'Network connection timed out. Please check your internet connection and try again.',
    fix: 'Test your connection speed; if you\'re on hotel/captive Wi-Fi, sign in via your browser first.',
    docsAnchor: 'WINDY-002-network-timeout',
    matchers: ['Network timeout', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'],
  },
  'WINDY-003': {
    code: 'WINDY-003',
    title: 'Download server misconfigured',
    user: 'A download server is misconfigured. Please try again later.',
    fix: 'Wait 5 minutes and retry. If it persists, contact support.',
    docsAnchor: 'WINDY-003-download-redirect-loop',
    matchers: ['Too many redirects'],
  },
  'WINDY-004': {
    code: 'WINDY-004',
    title: 'Download server error',
    user: 'A download server returned an error. Please try again later.',
    fix: 'Wait, then retry. Check status.windyword.ai if it persists.',
    docsAnchor: 'WINDY-004-download-server-error',
    matchers: ['HTTP 4', 'HTTP 5'],
  },
  'WINDY-010': {
    code: 'WINDY-010',
    title: 'Disk full',
    user: 'Not enough disk space to complete the installation. Please free up space and try again.',
    fix: 'Free at least 2GB and retry. The wizard\'s storage step shows what each engine costs.',
    docsAnchor: 'WINDY-010-disk-full',
    matchers: ['ENOSPC', 'no space left'],
  },
  'WINDY-011': {
    code: 'WINDY-011',
    title: 'Permission denied',
    user: 'Permission denied. Try running the installer with administrator/sudo privileges.',
    fix: 'On macOS: drag Windy Pro to /Applications. On Linux: run with sudo. On Windows: right-click → Run as administrator.',
    docsAnchor: 'WINDY-011-permission-denied',
    matchers: ['EACCES', 'permission denied', 'EPERM'],
  },
  'WINDY-020': {
    code: 'WINDY-020',
    title: 'Python install failed',
    user: 'Could not install Python automatically. Please install Python 3.11+ manually and try again.',
    fix: 'Bundled Python should always be present. If you see this, file a bug — the bundle pipeline failed.',
    docsAnchor: 'WINDY-020-python-install-failed',
    matchers: ['Could not install Python'],
  },
  'WINDY-021': {
    code: 'WINDY-021',
    title: 'pip install failed',
    user: 'A Python package failed to install during setup.',
    fix: 'Re-run install. If it fails again, attach the wizard log when contacting support.',
    docsAnchor: 'WINDY-021-pip-install-failed',
    matchers: ['pip install failed'],
  },
  'WINDY-030': {
    code: 'WINDY-030',
    title: 'ffmpeg install failed',
    user: 'Could not install ffmpeg. Audio processing won\'t work without it.',
    fix: 'Bundled ffmpeg should always be present. If you see this, the bundle is broken — file a bug.',
    docsAnchor: 'WINDY-030-ffmpeg-install-failed',
    matchers: ['Could not install ffmpeg'],
  },
  'WINDY-040': {
    code: 'WINDY-040',
    title: 'Setup step timed out',
    user: 'A setup step took longer than expected and was aborted. Re-run install — if it happens again, attach the wizard log when contacting support.',
    fix: 'See the wizard log for the exact step (label) that hung. Most often a network issue or pkexec/sudo prompt left unanswered.',
    docsAnchor: 'WINDY-040-step-timeout',
    matchers: ['wizard-timeout', 'did not complete within'],
  },
  'WINDY-050': {
    code: 'WINDY-050',
    title: 'Unknown model selected',
    user: 'The selected engine isn\'t in the catalog. Pick a different engine.',
    fix: 'Refresh the wizard. If the engine is still missing, the catalog file may be corrupted — re-run install.',
    docsAnchor: 'WINDY-050-unknown-model',
    matchers: ['Unknown model:'],
  },
  'WINDY-051': {
    code: 'WINDY-051',
    title: 'Empty model repository',
    user: 'The model server returned an empty file list. Try again later or pick a different engine.',
    fix: 'Wait 5 minutes and retry. The Hugging Face mirror occasionally returns empty listings.',
    docsAnchor: 'WINDY-051-empty-repo',
    matchers: ['No files found in repo'],
  },
  'WINDY-052': {
    code: 'WINDY-052',
    title: 'Bundled model failed integrity check',
    user: 'The bundled starter model didn\'t match the shipped checksum. This usually means the .dmg is corrupted. Re-download and re-install.',
    fix: 'Download the installer again from windyword.ai. If the new download also fails, file a bug with the mismatched file names from the log.',
    docsAnchor: 'WINDY-052-model-integrity',
    matchers: ['model integrity mismatch'],
  },
});

/**
 * Map a raw Error message to a WINDY-NNN code, or null if no match.
 * Order-independent — first matcher wins.
 */
function codeFromMessage(msg) {
  if (!msg || typeof msg !== 'string') return null;
  for (const code of Object.keys(ERROR_CATALOG)) {
    const entry = ERROR_CATALOG[code];
    if (entry.matchers && entry.matchers.some((m) => msg.includes(m))) {
      return code;
    }
  }
  return null;
}

/**
 * WindyError — Error subclass that carries a stable code.
 *
 * Use at throw sites:
 *   throw WindyError.from('WINDY-020', { detail: 'brew exit 1' });
 *
 * The `detail` is appended to the message for log diagnostics but
 * not shown to the user.
 */
class WindyError extends Error {
  constructor(code, detail) {
    const entry = ERROR_CATALOG[code];
    if (!entry) {
      // Defensive: don't crash the throw site if someone passes a
      // typo. Surface as the closest fallback so the user still sees
      // something reasonable.
      super(`[${code}] ${detail || 'Unknown error'}`);
      this.code = code;
      this.title = 'Unknown error';
      this.userMessage = String(detail || 'Setup failed.');
      return;
    }
    const msg = detail ? `[${code}] ${entry.title}: ${detail}` : `[${code}] ${entry.title}`;
    super(msg);
    this.name = 'WindyError';
    this.code = code;
    this.title = entry.title;
    this.userMessage = entry.user;
    this.fix = entry.fix;
    this.detail = detail;
  }

  static from(code, detail) {
    return new WindyError(code, detail);
  }
}

/**
 * Convert any thrown error into the user-facing message.
 *
 * Three precedence levels:
 *   1. WindyError — use its userMessage directly + show code prefix
 *   2. Timeout error from withTimeout — surface the step label
 *   3. Legacy throw new Error('...') — match against ERROR_CATALOG
 *      via substring matchers and upgrade to a code if recognised
 *   4. Fallback — truncate raw message
 */
function friendlyError(error, opts) {
  const logPath = opts && opts.logPath;

  if (error instanceof WindyError) {
    return formatUserMessage(error.code, error.userMessage, error.fix, logPath);
  }

  if (error && error.timedOut && error.label) {
    const seconds = Math.round((error.timeoutMs || 0) / 1000);
    const detail = `"${error.label}" did not complete in ${seconds}s.`;
    return formatUserMessage('WINDY-040',
      `Setup got stuck on "${error.label}" (no progress in ${seconds}s). ${ERROR_CATALOG['WINDY-040'].fix}`,
      ERROR_CATALOG['WINDY-040'].fix, logPath);
  }

  const msg = (error && (error.message || String(error))) || 'Unknown error';
  const code = codeFromMessage(msg);
  if (code) {
    const entry = ERROR_CATALOG[code];
    return formatUserMessage(code, entry.user, entry.fix, logPath);
  }

  // No match — return raw message, truncated.
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

function formatUserMessage(code, body, fix, logPath) {
  let s = `[${code}] ${body}`;
  if (logPath) s += `\n\nDiagnostic log: ${logPath}`;
  return s;
}

module.exports = {
  ERROR_CATALOG,
  WindyError,
  friendlyError,
  codeFromMessage,
};
