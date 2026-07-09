/**
 * Unit tests for the Intel V2 client-enforced message frequency caps
 * (INTEL-CONTRACT-V2 §3) and the contract event validator (§1).
 */
'use strict';

const { withinWindow, capAllows, pickMessage, recordImpression } =
  require('../src/client/desktop/lib/frequency-cap');
const { validateEvent, crashSignatureFromError, compareSemver } =
  require('../src/client/desktop/lib/intel-validate');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-07-08T12:00:00Z');

function msg(over = {}) {
  return {
    message_id: 'msg_a',
    campaign_id: 'camp_x',
    type: 'promo',
    priority: 10,
    title: 't',
    body: 'b',
    dismissible: true,
    frequency_cap: { max_impressions: 3, per_hours: 168, cooldown_hours: 24 },
    ...over,
  };
}

describe('frequency caps', () => {
  test('starts_at/ends_at window is honored', () => {
    expect(withinWindow(msg({ starts_at: '2026-07-09T00:00:00Z' }), NOW)).toBe(false);
    expect(withinWindow(msg({ ends_at: '2026-07-07T00:00:00Z' }), NOW)).toBe(false);
    expect(withinWindow(msg(), NOW)).toBe(true);
  });

  test('max_impressions per per_hours window blocks further shows', () => {
    const m = msg();
    let rec = { impressions: [NOW - 100 * HOUR, NOW - 80 * HOUR, NOW - 60 * HOUR] };
    expect(capAllows(m, rec, NOW)).toBe(false); // 3 shows inside 168h
    rec = { impressions: [NOW - 200 * HOUR, NOW - 190 * HOUR, NOW - 60 * HOUR] };
    expect(capAllows(m, rec, NOW)).toBe(true); // only 1 inside the window
  });

  test('cooldown_hours between shows is honored', () => {
    const m = msg();
    expect(capAllows(m, { impressions: [NOW - 2 * HOUR] }, NOW)).toBe(false); // < 24h
    expect(capAllows(m, { impressions: [NOW - 30 * HOUR] }, NOW)).toBe(true);
  });

  test('no history → always allowed', () => {
    expect(capAllows(msg(), undefined, NOW)).toBe(true);
  });

  test('pickMessage: priority order, maintenance tie-break, caps applied', () => {
    const low = msg({ message_id: 'low', priority: 1 });
    const high = msg({ message_id: 'high', priority: 50 });
    const maint = msg({ message_id: 'maint', priority: 50, type: 'maintenance' });
    expect(pickMessage([low, high], {}, NOW).message_id).toBe('high');
    expect(pickMessage([high, maint], {}, NOW).message_id).toBe('maint');
    // capped-out high-priority message falls through to the next
    const records = { high: { impressions: [NOW - HOUR] }, maint: { impressions: [NOW - HOUR] } };
    expect(pickMessage([low, high, maint], records, NOW).message_id).toBe('low');
    expect(pickMessage([high], records, NOW)).toBeNull();
  });

  test('recordImpression appends and trims history', () => {
    let rec;
    for (let i = 0; i < 60; i++) rec = recordImpression(rec, NOW + i);
    expect(rec.impressions.length).toBe(50);
    expect(rec.impressions[49]).toBe(NOW + 59);
  });
});

describe('intel-validate', () => {
  const base = {
    ts: '2026-07-08T12:00:00Z',
    platform: 'windy-word',
    service: 'desktop',
    actor_type: 'system',
    actor_id: null,
    session_id: 'abc',
  };

  test('accepts an on-contract dictation event', () => {
    const res = validateEvent({
      ...base,
      event_type: 'feature.usage.dictation',
      metadata: { seconds: 12, language: 'en', engine_tier: 'light', word_count: 40, on_device: true },
    });
    expect(res.ok).toBe(true);
  });

  test('rejects unknown metadata keys (content channel stays closed)', () => {
    const res = validateEvent({
      ...base,
      event_type: 'feature.usage.dictation',
      metadata: { seconds: 12, language: 'en', engine_tier: 'light', on_device: true, transcript: 'hello' },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unknown_key/);
  });

  test('rejects unknown event types and bad enums', () => {
    expect(validateEvent({ ...base, event_type: 'made.up', metadata: {} }).ok).toBe(false);
    expect(validateEvent({
      ...base,
      event_type: 'feature.usage.export',
      metadata: { format: 'exe', destination: 'file' },
    }).ok).toBe(false);
  });

  test('rejects a non-slug client.error code', () => {
    expect(validateEvent({
      ...base,
      event_type: 'client.error',
      metadata: { code: 'Some exception text!', surface: 'main', app_version: '1.7.0', os: 'macos' },
    }).ok).toBe(false);
  });

  test('requires required keys', () => {
    expect(validateEvent({
      ...base,
      event_type: 'session.start',
      metadata: { app_version: '1.7.0', os: 'macos' }, // missing install_id
    }).ok).toBe(false);
  });

  test('crash signature is a stable 16-hex hash independent of file paths', () => {
    const e1 = new Error('boom');
    e1.stack = 'Error: boom\n    at fn (/Users/alice/app/src/main.js:10:5)\n    at run (/Users/alice/app/src/other.js:20:1)';
    const e2 = new Error('different message');
    e2.stack = 'Error: different message\n    at fn (C:\\Users\\bob\\install\\main.js:10:5)\n    at run (C:\\Users\\bob\\install\\other.js:20:1)';
    const s1 = crashSignatureFromError(e1);
    const s2 = crashSignatureFromError(e2);
    expect(s1).toMatch(/^[0-9a-f]{16}$/);
    expect(s1).toBe(s2); // same frames (basenames), same signature
  });

  test('compareSemver orders versions', () => {
    expect(compareSemver('1.8.1', '1.7.0')).toBe(1);
    expect(compareSemver('1.7.0', '1.7.0')).toBe(0);
    expect(compareSemver('1.6.9', '1.7.0')).toBe(-1);
  });
});
