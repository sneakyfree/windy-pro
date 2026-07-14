/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/doctor/selftest.js — the ADR-060
 * run_selftest core-path exerciser. Dependency-injected so no live engine
 * is needed. The real bundled clip is used for the clip-present stage.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { runSelftest } = require('../src/client/desktop/doctor/selftest');

const REAL_CLIP = path.join(__dirname, '..', 'assets', 'selftest-clip.wav');

test('the bundled selftest clip is shipped in assets/', () => {
  expect(fs.existsSync(REAL_CLIP)).toBe(true);
});

test('all stages pass when engine is up and transcription yields text', async () => {
  const v = await runSelftest({
    engineRunning: true,
    clipPath: REAL_CLIP,
    transcribe: async () => ({ transcript: 'the quick brown fox' }),
  });
  expect(v.passed).toBe(true);
  expect('ok' in v).toBe(false); // envelope rule: `passed`, not `ok`
  expect(v.stages.map(s => s.name)).toEqual(['engine', 'clip', 'transcribe']);
});

test('content-free: reports transcript LENGTH, never the transcript', async () => {
  const secret = 'SECRET USER SPEECH CONTENT';
  const v = await runSelftest({
    engineRunning: true,
    clipPath: REAL_CLIP,
    transcribe: async () => ({ transcript: secret }),
  });
  const dump = JSON.stringify(v);
  expect(dump).not.toContain('SECRET USER SPEECH');
  expect(dump).toContain(`${secret.length} chars`);
});

test('engine down → fails at the engine stage, transcribe skipped', async () => {
  let called = false;
  const v = await runSelftest({
    engineRunning: false,
    clipPath: REAL_CLIP,
    transcribe: async () => { called = true; return { transcript: 'x' }; },
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'engine').ok).toBe(false);
  expect(called).toBe(false); // never attempts transcription without the engine
});

test('missing clip → fails at the clip stage', async () => {
  const v = await runSelftest({
    engineRunning: true,
    clipPath: '/no/such/clip.wav',
    transcribe: async () => ({ transcript: 'x' }),
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'clip').ok).toBe(false);
});

test('empty transcript → honest transcribe failure', async () => {
  const v = await runSelftest({
    engineRunning: true,
    clipPath: REAL_CLIP,
    transcribe: async () => ({ transcript: '   ' }),
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'transcribe').ok).toBe(false);
});

test('transcribe throwing is caught, not surfaced as a crash', async () => {
  const v = await runSelftest({
    engineRunning: true,
    clipPath: REAL_CLIP,
    transcribe: async () => { throw new Error('engine timeout'); },
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'transcribe').detail).toMatch(/engine timeout/);
});
