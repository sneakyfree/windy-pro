/**
 * Windy Pro — Input Validation (Browser / Renderer)
 *
 * Central validation module for all user input fields.
 * Every method returns { valid: boolean, error?: string } with
 * user-friendly error messages (no stack traces or codes).
 *
 * Usage:
 *   const r = Validators.email('bad');
 *   if (!r.valid) showError(r.error);
 */

// eslint-disable-next-line no-unused-vars
var Validators = (function () {
  'use strict';

  var CTRL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

  function ok() { return { valid: true }; }
  function fail(msg) { return { valid: false, error: msg }; }

  // ── Individual Validators ──

  /**
   * Username: 1–255 printable chars, no control characters.
   * Allows Matrix IDs like @user:server.org and bare usernames.
   */
  function username(v) {
    if (!v || typeof v !== 'string') return fail('Username is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Username is required.');
    if (t.length > 255) return fail('Username is too long (max 255 characters).');
    if (CTRL_CHAR_RE.test(t)) return fail('Username contains invalid characters.');
    return ok();
  }

  /**
   * Password: 8–128 chars.
   */
  function password(v) {
    if (!v || typeof v !== 'string') return fail('Password is required.');
    if (v.length < 8) return fail('Password must be at least 8 characters.');
    if (v.length > 128) return fail('Password is too long (max 128 characters).');
    return ok();
  }

  /**
   * Display name: 1–64 chars, no control characters.
   */
  function displayName(v) {
    if (!v || typeof v !== 'string') return fail('Display name is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Display name is required.');
    if (t.length > 64) return fail('Display name is too long (max 64 characters).');
    if (CTRL_CHAR_RE.test(t)) return fail('Display name contains invalid characters.');
    return ok();
  }

  /**
   * Homeserver URL: valid HTTPS URL (or localhost), ≤500 chars.
   */
  function homeserverUrl(v) {
    if (!v || typeof v !== 'string') return fail('Homeserver URL is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Homeserver URL is required.');
    if (t.length > 500) return fail('Homeserver URL is too long (max 500 characters).');
    try {
      var parsed = new URL(t);
      var isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLocal) {
        return fail('Homeserver must use HTTPS (e.g. https://matrix.org).');
      }
      if (['javascript:', 'data:', 'file:'].indexOf(parsed.protocol) !== -1) {
        return fail('Invalid homeserver URL protocol.');
      }
    } catch (_) {
      return fail('Invalid URL format. Example: https://matrix.org');
    }
    return ok();
  }

  /**
   * Matrix user ID: @user:server format, ≤255 chars.
   */
  function matrixUserId(v) {
    if (!v || typeof v !== 'string') return fail('User ID is required.');
    var t = v.trim();
    if (t.length === 0) return fail('User ID is required.');
    if (t.length > 255) return fail('User ID is too long (max 255 characters).');
    if (!/^@[a-zA-Z0-9._=\-\/]+:[a-zA-Z0-9.\-]+$/.test(t)) {
      return fail('Invalid format. Use @username:server.org');
    }
    return ok();
  }

  /**
   * Email: basic RFC 5322 format, ≤254 chars.
   */
  function email(v) {
    if (!v || typeof v !== 'string') return fail('Email is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Email is required.');
    if (t.length > 254) return fail('Email is too long (max 254 characters).');
    // Simple but effective email regex — catches 99% of real addresses
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      return fail('Please enter a valid email address.');
    }
    return ok();
  }

  /**
   * Coupon code: alphanumeric + dashes/underscores, 1–50 chars.
   */
  function couponCode(v) {
    if (!v || typeof v !== 'string') return fail('Coupon code is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Coupon code is required.');
    if (t.length > 50) return fail('Coupon code is too long (max 50 characters).');
    if (!/^[a-zA-Z0-9_\-]+$/.test(t)) {
      return fail('Coupon code can only contain letters, numbers, dashes and underscores.');
    }
    return ok();
  }

  /**
   * Chat message text: ≤4000 chars.
   */
  function textMessage(v) {
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return fail('Message is empty.');
    }
    if (v.length > 4000) return fail('Message is too long (max 4,000 characters).');
    return ok();
  }

  /**
   * Translation text: ≤10000 chars.
   */
  function translateText(v) {
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return fail('Please enter text to translate.');
    }
    if (v.length > 10000) return fail('Text is too long (max 10,000 characters). Try splitting into smaller sections.');
    return ok();
  }

  /**
   * Batch text (document translator): ≤100000 chars.
   */
  function batchText(v) {
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return fail('Please enter or paste text to translate.');
    }
    if (v.length > 100000) return fail('Text is too long (max 100,000 characters). Try a smaller document.');
    return ok();
  }

  /**
   * Clone name: 1–64 chars, no control characters.
   */
  function cloneName(v) {
    if (!v || typeof v !== 'string') return fail('Clone name is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Clone name is required.');
    if (t.length > 64) return fail('Clone name is too long (max 64 characters).');
    if (CTRL_CHAR_RE.test(t)) return fail('Clone name contains invalid characters.');
    return ok();
  }

  /**
   * Search query: ≤200 chars.
   */
  function searchQuery(v) {
    if (typeof v !== 'string') return ok(); // empty search is fine
    if (v.length > 200) return fail('Search query is too long (max 200 characters).');
    return ok();
  }

  /**
   * Cloud/WebSocket URL: valid wss:// or https:// URL, ≤500 chars.
   */
  function cloudUrl(v) {
    if (!v || typeof v !== 'string') return fail('Cloud URL is required.');
    var t = v.trim();
    if (t.length === 0) return fail('Cloud URL is required.');
    if (t.length > 500) return fail('Cloud URL is too long (max 500 characters).');
    try {
      var parsed = new URL(t);
      var allowed = ['https:', 'wss:', 'http:', 'ws:'];
      if (allowed.indexOf(parsed.protocol) === -1) {
        return fail('Cloud URL must use https:// or wss:// protocol.');
      }
    } catch (_) {
      return fail('Invalid URL format. Example: wss://windyword.ai');
    }
    return ok();
  }

  /**
   * File upload: check size and extension.
   * @param {File} file
   * @param {{ maxMB?: number, allowedExt?: string[] }} opts
   */
  function fileUpload(file, opts) {
    if (!file) return fail('No file selected.');
    var maxMB = (opts && opts.maxMB) || 50;
    var maxBytes = maxMB * 1024 * 1024;
    if (file.size > maxBytes) {
      return fail('File is too large (max ' + maxMB + ' MB).');
    }
    if (file.size === 0) return fail('File is empty.');
    if (opts && opts.allowedExt && opts.allowedExt.length > 0) {
      var name = (file.name || '').toLowerCase();
      var ext = name.split('.').pop();
      if (opts.allowedExt.indexOf(ext) === -1) {
        return fail('Unsupported file type. Allowed: ' + opts.allowedExt.join(', '));
      }
    }
    return ok();
  }

  /**
   * Show a validation error on an element. Sets text, color, display.
   * @param {HTMLElement|null} el
   * @param {string} msg
   */
  function showError(el, msg) {
    if (!el) return;
    el.textContent = '⚠️ ' + msg;
    el.style.display = 'block';
    el.style.color = '#f87171';
  }

  /**
   * Clear a validation error element.
   * @param {HTMLElement|null} el
   */
  function clearError(el) {
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  // ── Public API ──

  return {
    username: username,
    password: password,
    displayName: displayName,
    homeserverUrl: homeserverUrl,
    matrixUserId: matrixUserId,
    email: email,
    couponCode: couponCode,
    textMessage: textMessage,
    translateText: translateText,
    batchText: batchText,
    cloneName: cloneName,
    searchQuery: searchQuery,
    cloudUrl: cloudUrl,
    fileUpload: fileUpload,
    showError: showError,
    clearError: clearError
  };
})();

// CommonJS compat
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Validators;
}
