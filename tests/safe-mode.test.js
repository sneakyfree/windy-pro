/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/doctor/safe-mode.js — the ADR-060
 * enter/exit_safe_mode knobs. In-memory store; applySetting records writes.
 */
'use strict';

const { enterSafeMode, exitSafeMode, KNOWN_GOOD } = require('../src/client/desktop/doctor/safe-mode');

function makeIo(initial = {}) {
  const store = { ...initial };
  const applied = [];
  return {
    io: {
      getSetting: (p) => store[p],
      applySetting: (p, v) => { store[p] = v; applied.push([p, v]); },
      getSafeState: () => store['safeMode'],
      setSafeState: (s) => { store['safeMode'] = s; },
    },
    store,
    applied,
  };
}

test('enter snapshots current engine config, then applies known-good', () => {
  const { io, store } = makeIo({ 'engine.engine': 'cloud', 'engine.model': 'large' });
  const r = enterSafeMode(io);
  expect(r.active).toBe(true);
  expect(r.snapshot).toEqual({ 'engine.engine': 'cloud', 'engine.model': 'large' });
  // known-good now applied
  expect(store['engine.engine']).toBe('local');
  expect(store['engine.model']).toBe('small');
  expect(store['safeMode']).toEqual({ active: true, snapshot: { 'engine.engine': 'cloud', 'engine.model': 'large' } });
});

test('exit restores the exact snapshot and clears the flag', () => {
  const { io, store } = makeIo({ 'engine.engine': 'windytune', 'engine.model': 'medium' });
  enterSafeMode(io);
  const r = exitSafeMode(io);
  expect(r.active).toBe(false);
  expect(r.restored).toEqual({ 'engine.engine': 'windytune', 'engine.model': 'medium' });
  expect(store['engine.engine']).toBe('windytune');
  expect(store['engine.model']).toBe('medium');
  expect(store['safeMode'].active).toBe(false);
});

test('round-trip is exact even through a manual change while in safe mode', () => {
  const { io, store } = makeIo({ 'engine.engine': 'cloud', 'engine.model': 'large' });
  enterSafeMode(io);
  // user fiddles while safe-moded — exit still restores the ORIGINAL snapshot
  store['engine.model'] = 'tiny';
  exitSafeMode(io);
  expect(store['engine.model']).toBe('large');
});

test('enter is idempotent — a second enter does NOT clobber the snapshot', () => {
  const { io, store } = makeIo({ 'engine.engine': 'cloud', 'engine.model': 'large' });
  enterSafeMode(io);
  const second = enterSafeMode(io);
  expect(second.alreadyActive).toBe(true);
  // snapshot preserved as the true original, not the known-good values
  expect(store['safeMode'].snapshot).toEqual({ 'engine.engine': 'cloud', 'engine.model': 'large' });
});

test('exit when not in safe mode is a harmless no-op', () => {
  const { io, applied } = makeIo({ 'engine.engine': 'local', 'engine.model': 'small' });
  const r = exitSafeMode(io);
  expect(r.alreadyOut).toBe(true);
  expect(applied).toEqual([]); // nothing written
});

test('the known-good overlay is engine-only (never paste/recording/focus)', () => {
  for (const key of Object.keys(KNOWN_GOOD)) {
    expect(key.startsWith('engine.')).toBe(true);
  }
});
