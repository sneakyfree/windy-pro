/**
 * Unit tests for installer-v2/core/wizard-logger.js
 *
 * Covers withTimeout — the helper wrapping every awaited operation in
 * the install path. If any step never completes, withTimeout's rejection
 * is what surfaces a useful "X did not complete in Yms" error to the
 * user instead of a silent 0% spinner.
 */

'use strict';

const { withTimeout } = require('../installer-v2/core/wizard-logger');

describe('withTimeout', () => {
  test('resolves with the inner promise value when it finishes in time', async () => {
    const result = await withTimeout(Promise.resolve(42), 500, 'fast-op');
    expect(result).toBe(42);
  });

  test('rejects with a labeled timeout error when the inner promise hangs', async () => {
    const hang = new Promise(() => { /* never resolves */ });
    let err;
    try {
      await withTimeout(hang, 50, 'hung-op');
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.timedOut).toBe(true);
    expect(err.label).toBe('hung-op');
    expect(err.timeoutMs).toBe(50);
    expect(err.message).toContain('hung-op');
  });

  test('propagates inner rejection unchanged when the inner promise rejects first', async () => {
    const fail = Promise.reject(new Error('inner-fail'));
    let err;
    try {
      await withTimeout(fail, 1000, 'will-fail');
    } catch (e) { err = e; }
    expect(err.message).toBe('inner-fail');
    expect(err.timedOut).toBeUndefined();
  });
});
