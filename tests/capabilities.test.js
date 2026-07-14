/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/doctor/capabilities.js — the ADR-060
 * get_capabilities tri-state feature probe. Read-only, side-effect-free.
 */
'use strict';

const { probeCapabilities, probeTts } = require('../src/client/desktop/doctor/capabilities');

const TRISTATE = new Set(['supported', 'unsupported', 'unknown']);

describe('probeCapabilities', () => {
  test('reports every known feature, all tri-state', async () => {
    const caps = await probeCapabilities();
    for (const f of ['paste', 'tts', 'recording', 'translate', 'clone']) {
      expect(caps).toHaveProperty(f);
      expect(TRISTATE.has(caps[f].status)).toBe(true);
    }
  });

  test('recording is a present capability (live check deferred to run_selftest)', async () => {
    const caps = await probeCapabilities();
    expect(caps.recording.status).toBe('supported');
    expect(caps.recording.detail).toMatch(/run_selftest/);
  });

  test('clone is honestly unknown, not silently assumed', async () => {
    const caps = await probeCapabilities();
    expect(caps.clone.status).toBe('unknown');
  });

  test('never throws — always resolves an object', async () => {
    await expect(probeCapabilities()).resolves.toEqual(expect.any(Object));
  });
});

describe('probeTts', () => {
  test('returns a tri-state status for this platform', async () => {
    const t = await probeTts();
    expect(TRISTATE.has(t.status)).toBe(true);
  });
});
