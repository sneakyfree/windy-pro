/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/lib/timeout.js (CR-003).
 *
 * Mirrors the shape of the existing withTimeout tests in
 * tests/installer-wizard-logger.test.js but covers the main-app
 * copy. Both versions MUST stay behaviour-equivalent — if anyone
 * changes either, the other's test must keep passing too.
 */

'use strict';

const { withTimeout, timeoutError } = require('../src/client/desktop/lib/timeout');

describe('withTimeout', () => {
  test('resolves with inner value when the promise settles in time', async () => {
    const result = await withTimeout(Promise.resolve(42), 500, 'fast-op');
    expect(result).toBe(42);
  });

  test('rejects with a labeled timeout error when inner never resolves', async () => {
    const hang = new Promise(() => { /* never resolves */ });
    let err;
    try { await withTimeout(hang, 50, 'stuck-op'); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.timedOut).toBe(true);
    expect(err.label).toBe('stuck-op');
    expect(err.timeoutMs).toBe(50);
    expect(err.message).toContain('stuck-op');
  });

  test('propagates inner rejection unchanged when inner rejects first', async () => {
    const fail = Promise.reject(new Error('inner-fail'));
    let err;
    try { await withTimeout(fail, 1000, 'will-fail'); }
    catch (e) { err = e; }
    expect(err.message).toBe('inner-fail');
    expect(err.timedOut).toBeUndefined();
  });

  test('clears the timeout when inner resolves (no pending handle)', async () => {
    // If the timeout wasn't cleared, Node would keep the event loop
    // alive past the test's completion. Jest runs with --forceExit
    // so this is a weak signal, but the assertion that the promise
    // resolved is the real one.
    const r = await withTimeout(Promise.resolve('ok'), 100, 'clean-up');
    expect(r).toBe('ok');
  });
});

describe('timeoutError', () => {
  test('builds a labeled timeout error without racing a real promise', () => {
    const err = timeoutError('manual-cancel', 5000);
    expect(err.timedOut).toBe(true);
    expect(err.label).toBe('manual-cancel');
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain('manual-cancel');
  });
});
