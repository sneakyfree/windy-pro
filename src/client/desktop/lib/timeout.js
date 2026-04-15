/**
 * withTimeout — bound an awaited operation with a labeled timeout.
 *
 * Promotes the same helper that installer-v2/core/wizard-logger.js
 * uses for the install path. CR-003 in docs/CODE-REVIEW-2026-04.md
 * flagged that main.js has ~95 IPC handlers with unbounded awaits,
 * which is the class of bug that caused session 1's "wizard stuck
 * at 0%" regression. This module lets main.js wrap those awaits
 * without duplicating the helper.
 *
 * Usage:
 *   const { withTimeout } = require('./lib/timeout');
 *   const result = await withTimeout(
 *     this.accountManager.login(email, pwd),
 *     10_000,
 *     'chat-login'
 *   );
 *
 * On timeout:
 *   - Rejects with an Error whose `.timedOut = true`, `.label`, and
 *     `.timeoutMs` fields let friendlyError/other handlers format a
 *     user-visible message.
 *   - Does NOT cancel the underlying promise (Node can't). The
 *     caller's handler SHOULD abort via AbortSignal if supported.
 *
 * Keep this file dependency-free + tiny. It's loaded by main.js
 * which is on the cold-start path.
 */

'use strict';

function withTimeout(promise, ms, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`[timeout] ${label} did not complete within ${ms}ms`);
      err.timedOut = true;
      err.label = label;
      err.timeoutMs = ms;
      reject(err);
    }, ms);
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => { if (timeoutId) clearTimeout(timeoutId); }),
    timeoutPromise,
  ]);
}

/**
 * Tag an Error for the error-code taxonomy (WINDY-040 is the
 * install-path timeout code; main-app timeouts get WINDY-041).
 * Used where a consumer-facing error chain wants to propagate
 * the timeout without leaking raw stack shapes.
 */
function timeoutError(label, ms) {
  const err = new Error(`[timeout] ${label} did not complete within ${ms}ms`);
  err.timedOut = true;
  err.label = label;
  err.timeoutMs = ms;
  return err;
}

module.exports = { withTimeout, timeoutError };
