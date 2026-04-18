/**
 * @jest-environment node
 *
 * Tests for src/client/desktop/lib/crash-summary.js (CR-006).
 *
 * Pins the allow-list / deny-list redaction behaviour. These tests
 * fail if anyone re-introduces the raw toString() path or drops
 * a secret pattern.
 */

'use strict';

const { safeErrorSummary, redactLine, SECRET_PATTERNS } = require('../src/client/desktop/lib/crash-summary');

describe('safeErrorSummary — allow-list', () => {
  test('extracts name/message/code from an Error', () => {
    const e = new Error('boom');
    e.code = 'E_BOOM';
    const s = safeErrorSummary(e);
    expect(s.name).toBe('Error');
    expect(s.message).toBe('boom');
    expect(s.code).toBe('E_BOOM');
    expect(s.stack).toContain('boom');
  });

  test('drops arbitrary attached properties', () => {
    // Libraries like axios attach `response`, `request`, `config`
    // objects that include HTTP headers with auth tokens.
    const e = new Error('upstream failed');
    e.response = { headers: { Authorization: 'Bearer leaky-jwt' } };
    e.config = { headers: { 'X-API-Key': 'secret-key-abcd' } };
    const s = safeErrorSummary(e);
    // The summary only has the 4 allow-listed fields.
    expect(Object.keys(s).sort()).toEqual(['code', 'message', 'name', 'stack']);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain('leaky-jwt');
    expect(serialised).not.toContain('secret-key-abcd');
  });

  test('handles non-Error throws (string)', () => {
    const s = safeErrorSummary('plain string error');
    expect(s.message).toBe('plain string error');
    expect(s.name).toBeNull();
    expect(s.code).toBeNull();
    expect(s.stack).toBeNull();
  });

  test('handles null/undefined', () => {
    expect(safeErrorSummary(null).message).toBe('null');
    expect(safeErrorSummary(undefined).message).toBe('undefined');
  });

  test('truncates long messages', () => {
    const long = 'x'.repeat(1000);
    const s = safeErrorSummary(new Error(long));
    expect(s.message.length).toBe(500);
  });

  test('limits stack to N frames', () => {
    const e = new Error('deep');
    e.stack = Array.from({ length: 20 }, (_, i) => `  at frame${i} (/foo.js:${i})`).join('\n');
    const s = safeErrorSummary(e, { stackFrames: 3 });
    expect(s.stack.split('\n')).toHaveLength(3);
  });
});

describe('redactLine — deny-list redaction as belt-and-suspenders', () => {
  test.each([
    ['Bearer eyJhbGci.xyz', /Bearer \[REDACTED\]/],
    ['sk-proj-abc123def456', /sk-\[REDACTED\]/],
    ['ghp_1234567890abcdefghij', /ghp_\[REDACTED\]/],
    ['xoxb-1234567890-abc', /xoxb-\[REDACTED\]/],
    ['AKIAIOSFODNN7EXAMPLE', /AKIA\[REDACTED\]/],
    ['glpat-abc_def-123', /glpat-\[REDACTED\]/],
    ['key_abcdef1234567890', /key_\[REDACTED\]/],
  ])('redacts %s', (input, pattern) => {
    expect(redactLine(input)).toMatch(pattern);
    // And the original secret is not present
    expect(redactLine(input)).not.toContain(input);
  });

  test('leaves innocuous text alone', () => {
    expect(redactLine('Error: EACCES')).toBe('Error: EACCES');
    expect(redactLine('code=ENOENT path=/tmp/foo')).toBe('code=ENOENT path=/tmp/foo');
  });

  test('full safeErrorSummary scrubs secrets from message + stack', () => {
    const e = new Error('failed with Bearer secret-jwt-abc and sk-proj-leaky-key');
    e.stack = `Error: ...\n    at handle (/app.js:1:1 Bearer tokenxyz)`;
    const s = safeErrorSummary(e);
    const whole = JSON.stringify(s);
    expect(whole).not.toMatch(/secret-jwt-abc/);
    expect(whole).not.toMatch(/sk-proj-leaky-key/);
    expect(whole).not.toMatch(/tokenxyz/);
    expect(whole).toMatch(/\[REDACTED\]/);
  });
});

describe('SECRET_PATTERNS exposed for extension', () => {
  test('is iterable with shape {re, label}', () => {
    expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SECRET_PATTERNS) {
      expect(p.re).toBeInstanceOf(RegExp);
      expect(typeof p.label).toBe('string');
    }
  });
});
