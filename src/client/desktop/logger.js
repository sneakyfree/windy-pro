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
    },

    /** Log method exit with result */
    exit(method, result) {
      console.log(`${prefix(method)} ← exit  ${compact(result)}`);
    },

    /** Log a state change */
    state(method, message) {
      console.log(`${prefix(method)} ⚡ state: ${message}`);
    },

    /** Log an error */
    error(method, err) {
      const info = err instanceof Error
        ? { message: err.message, code: err.code || err.errcode, stack: err.stack?.split('\n').slice(0, 3).join(' ← ') }
        : err;
      console.error(`${prefix(method)} ✖ error ${compact(info)}`);
    },

    /** Log a warning */
    warn(method, message) {
      console.warn(`${prefix(method)} ⚠ ${message}`);
    },

    /** Log a debug message (only in dev/debug mode) */
    debug(method, message) {
      if (process.env.WINDY_DEBUG || process.env.NODE_ENV === 'development') {
        console.debug(`${prefix(method)} 🔍 ${message}`);
      }
    },
  };
}

module.exports = createLogger;
