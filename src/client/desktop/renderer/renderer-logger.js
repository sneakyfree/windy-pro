/**
 * Windy Pro — Structured Logger (Renderer / Browser)
 *
 * Browser-compatible version of the desktop logger for renderer process files.
 * Uses console.log with timestamps and auto-redaction.
 *
 * Usage (script tag):
 *   <!-- loaded via script in HTML -->
 *   const log = createLogger('SyncService');
 *   log.entry('login', { email });
 *
 * Usage (CommonJS):
 *   const createLogger = require('./renderer-logger');
 */

(function (root) {
  'use strict';

  /** Fields whose values are auto-redacted in log output */
  const REDACTED_FIELDS = new Set([
    'password', 'accessToken', 'access_token', 'token',
    'secretKey', 'secret_key', 'STRIPE_SECRET_KEY',
    'Authorization', 'authorization',
    'deviceKey', 'recoveryKey', 'exportedKeys',
  ]);

  function redact(obj, depth) {
    depth = depth || 0;
    if (depth > 5 || obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(function (v) { return redact(v, depth + 1); });

    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = obj[k];
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

  function compact(obj) {
    if (obj === undefined) return '';
    try {
      var safe = redact(obj);
      var str = JSON.stringify(safe, function (_, v) {
        if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…';
        if (Array.isArray(v) && v.length > 10) return v.slice(0, 5).concat(['…+' + (v.length - 5) + ' more']);
        return v;
      });
      return str && str.length > 500 ? str.slice(0, 500) + '…' : str;
    } catch (e) {
      return '[unserializable]';
    }
  }

  function ts() {
    return new Date().toISOString();
  }

  function createLogger(serviceName) {
    function prefix(method) {
      return '[' + ts() + '] [' + serviceName + '.' + method + ']';
    }

    return {
      entry: function (method, params) {
        console.log(prefix(method) + ' → entry ' + compact(params));
      },
      exit: function (method, result) {
        console.log(prefix(method) + ' ← exit  ' + compact(result));
      },
      state: function (method, message) {
        console.log(prefix(method) + ' ⚡ state: ' + message);
      },
      error: function (method, err) {
        var info = err instanceof Error
          ? { message: err.message, code: err.code || err.errcode }
          : err;
        console.error(prefix(method) + ' ✖ error ' + compact(info));
      },
      warn: function (method, message) {
        console.warn(prefix(method) + ' ⚠ ' + message);
      },
      debug: function (method, message) {
        console.debug(prefix(method) + ' 🔍 ' + message);
      },
    };
  }

  // Export for both browser globals and CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createLogger;
  }
  root.createLogger = createLogger;
})(typeof window !== 'undefined' ? window : this);
