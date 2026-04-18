/**
 * Windy Pro — Structured Logger (Desktop)
 *
 * Usage:
 *   const log = require('./logger')('ChatClient');
 *   log.entry('login', { userId });
 *   log.exit('login', { success: true });
 *   log.state('login', 'sync started, connected=true');
 *   log.error('login', err);
 */

'use strict';

// P5 — file sink + rotation + structured JSON lines.
//
// Writes a JSON-lines log file at ~/Library/Logs/Windy Pro/app.log
// (macOS), ~/AppData/Local/Windy Pro/Logs/app.log (Windows), or
// ~/.local/state/windy-pro/logs/app.log (Linux). Rotates at 10 MB,
// keeps the last 5 generations (app.log, app.log.1, ... app.log.5).
//
// Format (one line per entry):
//   {"ts":"2026-04-15T...","level":"info","component":"ChatClient",
//    "event":"login.entry","params":{...}}
//
// The file sink is OPT-IN via WINDY_LOG_FILE=1 or when running from a
// packaged .app (app.isPackaged). Dev mode keeps console output only.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES_PER_FILE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 5;

function resolveLogDir() {
  // Mirrors wizard-logger.getLogDir so support can find both files in
  // the same place.
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'Windy Pro');
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Windy Pro', 'Logs');
  }
  return path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'windy-pro', 'logs'
  );
}

// Resolve LOG_DIR lazily so tests can swap $HOME between runs without
// having to re-require the whole module. Each emit call reads the
// current env; first resolution cached for the life of the module.
let _cachedLogDir = null;
function LOG_DIR_NOW() {
  if (_cachedLogDir) return _cachedLogDir;
  _cachedLogDir = resolveLogDir();
  return _cachedLogDir;
}
function LOG_PATH_NOW() { return path.join(LOG_DIR_NOW(), 'app.log'); }
// Property getters on the module for tests that read these.
const _pathAccessors = {
  get LOG_DIR() { return LOG_DIR_NOW(); },
  get LOG_PATH() { return LOG_PATH_NOW(); },
};

// Detect opt-in: explicit env var OR packaged app. Check isPackaged
// lazily — require('electron').app isn't available in the renderer
// but the logger is loaded by both.
function shouldWriteFile() {
  if (process.env.WINDY_LOG_FILE === '0') return false;
  if (process.env.WINDY_LOG_FILE === '1') return true;
  try {
    const electron = require('electron');
    return !!(electron && electron.app && electron.app.isPackaged);
  } catch (_) {
    return false;
  }
}

let _fileSinkDisabled = false;
let _fileSinkReady = false;

/**
 * Check the file size after writes and rotate if needed. Synchronous
 * to keep crash-safety — if the process dies mid-write, the line
 * before is durable on disk.
 */
function rotateIfNeeded() {
  let size;
  try { size = fs.statSync(LOG_PATH_NOW()).size; }
  catch (_) { return; }
  if (size < MAX_BYTES_PER_FILE) return;
  try {
    for (let i = MAX_ROTATIONS; i > 0; i--) {
      const src = i === 1 ? LOG_PATH_NOW() : `${LOG_PATH_NOW()}.${i - 1}`;
      const dst = `${LOG_PATH_NOW()}.${i}`;
      if (fs.existsSync(src)) {
        if (i === MAX_ROTATIONS && fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.renameSync(src, dst);
      }
    }
  } catch (_) { /* ignore */ }
}

function ensureFileSinkReady() {
  if (_fileSinkDisabled) return false;
  if (_fileSinkReady) return true;
  if (!shouldWriteFile()) { _fileSinkDisabled = true; return false; }
  try {
    fs.mkdirSync(LOG_DIR_NOW(), { recursive: true });
    _fileSinkReady = true;
    return true;
  } catch (_) {
    _fileSinkDisabled = true;
    return false;
  }
}

/**
 * Emit one structured event to the file sink. JSON-lines format.
 * Synchronous appendFileSync so tests can immediately read, and so
 * that a crash mid-log still persists the preceding lines.
 *
 * Never throws. Rotate check runs after each write.
 */
function emitEvent(level, component, event, extra) {
  if (!ensureFileSinkReady()) return;
  try {
    const record = {
      ts: new Date().toISOString(),
      level,
      component,
      event,
    };
    if (extra !== undefined) record.data = redact(extra);
    fs.appendFileSync(LOG_PATH_NOW(), JSON.stringify(record) + '\n');
    rotateIfNeeded();
  } catch (_) { /* never surface logger errors to caller */ }
}

/** Fields whose values are auto-redacted in log output */
const REDACTED_FIELDS = new Set([
  'password', 'accessToken', 'access_token', 'token',
  'secretKey', 'secret_key', 'STRIPE_SECRET_KEY',
  'Authorization', 'authorization',
  'deviceKey', 'recoveryKey', 'exportedKeys',
]);

/**
 * Deep-clone an object while replacing sensitive field values with '[REDACTED]'.
 * Handles nested objects, arrays, and circular references safely.
 */
function redact(obj, depth = 0) {
  if (depth > 5 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redact(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Compact JSON stringifier — truncates long strings and large arrays */
function compact(obj) {
  if (obj === undefined) return '';
  try {
    const safe = redact(obj);
    const str = JSON.stringify(safe, (_, v) => {
      if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…';
      if (Array.isArray(v) && v.length > 10) return [...v.slice(0, 5), `…+${v.length - 5} more`];
      return v;
    });
    return str && str.length > 500 ? str.slice(0, 500) + '…' : str;
  } catch {
    return '[unserializable]';
  }
}

function ts() {
  return new Date().toISOString();
}

/**
 * Create a structured logger for a named service.
 * @param {string} serviceName  e.g. 'ChatClient', 'SyncService'
 * @returns {object} Logger with entry/exit/state/error methods
 */
function createLogger(serviceName) {
  const prefix = (method) => `[${ts()}] [${serviceName}.${method}]`;

  return {
    /** Log method entry with parameters */
    entry(method, params) {
      console.log(`${prefix(method)} → entry ${compact(params)}`);
      emitEvent('info', serviceName, `${method}.entry`, params);
    },

    /** Log method exit with result */
    exit(method, result) {
      console.log(`${prefix(method)} ← exit  ${compact(result)}`);
      emitEvent('info', serviceName, `${method}.exit`, result);
    },

    /** Log a state change */
    state(method, message) {
      console.log(`${prefix(method)} ⚡ state: ${message}`);
      emitEvent('info', serviceName, `${method}.state`, { message });
    },

    /** Log an error */
    error(method, err) {
      const info = err instanceof Error
        ? { message: err.message, code: err.code || err.errcode, stack: err.stack?.split('\n').slice(0, 3).join(' ← ') }
        : err;
      console.error(`${prefix(method)} ✖ error ${compact(info)}`);
      emitEvent('error', serviceName, `${method}.error`, info);
    },

    /** Log a warning */
    warn(method, message) {
      console.warn(`${prefix(method)} ⚠ ${message}`);
      emitEvent('warn', serviceName, `${method}.warn`, { message });
    },

    /** Log a debug message (only in dev/debug mode) */
    debug(method, message) {
      if (process.env.WINDY_DEBUG || process.env.NODE_ENV === 'development') {
        console.debug(`${prefix(method)} 🔍 ${message}`);
        emitEvent('debug', serviceName, `${method}.debug`, { message });
      }
    },
  };
}

// Exposed for diagnostics / tests
Object.defineProperty(createLogger, 'LOG_PATH', { get: () => LOG_PATH_NOW() });
Object.defineProperty(createLogger, 'LOG_DIR', { get: () => LOG_DIR_NOW() });
createLogger._rotateIfNeeded = rotateIfNeeded;
createLogger._emitEvent = emitEvent;

module.exports = createLogger;
