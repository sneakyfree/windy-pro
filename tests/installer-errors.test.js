/**
 * Unit tests for installer-v2/core/errors.js
 *
 * Pins:
 *   - Every WINDY-NNN code resolvable via codeFromMessage matches the
 *     legacy substring patterns (no upgrade-via-rename surprises).
 *   - WindyError.from() builds a code-prefixed message and exposes
 *     userMessage / fix / code / detail.
 *   - friendlyError() handles all four input shapes: WindyError,
 *     timeout error, legacy throw, raw fallback.
 *   - The catalog itself is frozen — anyone trying to mutate
 *     ERROR_CATALOG at runtime fails loudly.
 */

'use strict';

const { ERROR_CATALOG, WindyError, friendlyError, codeFromMessage } = require('../installer-v2/core/errors');

describe('ERROR_CATALOG shape', () => {
  test('every entry has the required fields', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.code).toBe(code);
      expect(typeof entry.title).toBe('string');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.user).toBe('string');
      expect(entry.user.length).toBeGreaterThan(0);
      expect(typeof entry.fix).toBe('string');
      expect(entry.fix.length).toBeGreaterThan(0);
      expect(typeof entry.docsAnchor).toBe('string');
      // matchers optional but if present must be string array
      if (entry.matchers) {
        expect(Array.isArray(entry.matchers)).toBe(true);
        for (const m of entry.matchers) expect(typeof m).toBe('string');
      }
    }
  });

  test('catalog is frozen against mutation', () => {
    expect(Object.isFrozen(ERROR_CATALOG)).toBe(true);
    expect(() => { ERROR_CATALOG['WINDY-999'] = {}; }).toThrow();
  });

  test('codes follow WINDY-NNN format', () => {
    for (const code of Object.keys(ERROR_CATALOG)) {
      expect(code).toMatch(/^WINDY-\d{3}$/);
    }
  });
});

describe('codeFromMessage — legacy throw upgrades', () => {
  test.each([
    ['ENOTFOUND something', 'WINDY-001'],
    ['Network timeout: 30s', 'WINDY-002'],
    ['Too many redirects following GET', 'WINDY-003'],
    ['HTTP 503: server overloaded', 'WINDY-004'],
    ['ENOSPC writing wheel', 'WINDY-010'],
    ['EACCES: permission denied, open /etc/foo', 'WINDY-011'],
    ['Could not install Python on macOS', 'WINDY-020'],
    ['Could not install ffmpeg', 'WINDY-030'],
    ['Unknown model: windy-rogue', 'WINDY-050'],
    ['No files found in repo openai/whisper-tiny', 'WINDY-051'],
  ])('"%s" → %s', (msg, code) => {
    expect(codeFromMessage(msg)).toBe(code);
  });

  test('returns null for unrecognised messages', () => {
    expect(codeFromMessage('something completely novel')).toBeNull();
    expect(codeFromMessage('')).toBeNull();
    expect(codeFromMessage(null)).toBeNull();
  });
});

describe('WindyError', () => {
  test('builds with code-prefixed message', () => {
    const e = WindyError.from('WINDY-001');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(WindyError);
    expect(e.code).toBe('WINDY-001');
    expect(e.message).toContain('WINDY-001');
    expect(e.message).toContain('Network unreachable');
  });

  test('appends detail to message but not user-facing copy', () => {
    const e = WindyError.from('WINDY-021', 'pip exit 1');
    expect(e.message).toContain('pip exit 1');
    expect(e.userMessage).not.toContain('pip exit 1');
  });

  test('does not crash on unknown code', () => {
    const e = WindyError.from('WINDY-99999', 'oops');
    expect(e).toBeInstanceOf(WindyError);
    expect(e.code).toBe('WINDY-99999');
  });
});

describe('friendlyError dispatch', () => {
  test('handles WindyError with code prefix + log path', () => {
    const e = WindyError.from('WINDY-010');
    const out = friendlyError(e, { logPath: '/tmp/log.txt' });
    expect(out).toContain('[WINDY-010]');
    expect(out).toContain('disk space');
    expect(out).toContain('/tmp/log.txt');
  });

  test('handles withTimeout-style errors (label + timeoutMs + timedOut)', () => {
    const e = Object.assign(new Error('did not complete within 60000ms'), {
      timedOut: true,
      label: 'CleanSlate.run',
      timeoutMs: 60_000,
    });
    const out = friendlyError(e);
    expect(out).toContain('[WINDY-040]');
    expect(out).toContain('CleanSlate.run');
    expect(out).toContain('60s');
  });

  test('upgrades legacy throw new Error(...) via matcher', () => {
    const e = new Error('ENOSPC: no space left on device');
    const out = friendlyError(e);
    expect(out).toContain('[WINDY-010]');
  });

  test('falls back to raw message when no matcher hits', () => {
    const e = new Error('totally novel error');
    const out = friendlyError(e);
    expect(out).toBe('totally novel error');
  });

  test('truncates fallback messages over 300 chars', () => {
    const e = new Error('x'.repeat(500));
    const out = friendlyError(e);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBe(true);
  });
});
