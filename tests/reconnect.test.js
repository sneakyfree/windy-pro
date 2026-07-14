/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/doctor/reconnect.js — the ADR-060
 * reconnect knob. Dependency-injected so no Python engine is spawned.
 */
'use strict';

const { reconnect } = require('../src/client/desktop/doctor/reconnect');

const noSleep = async () => {};

test('engine already up + handshake ok → passed, engine not restarted', async () => {
  let started = false;
  const v = await reconnect({
    engineRunning: true,
    startEngine: async () => { started = true; },
    probeConnection: async () => true,
    sleep: noSleep,
  });
  expect(v.passed).toBe(true);
  expect('ok' in v).toBe(false); // envelope rule
  expect(started).toBe(false); // never restart a live engine
  expect(v.stages.map(s => s.name)).toEqual(['engine_start', 'connect']);
  expect(v.stages[0].detail).toMatch(/already running/);
});

test('engine down → starts it, then verifies the handshake', async () => {
  const calls = [];
  const v = await reconnect({
    engineRunning: false,
    startEngine: async () => calls.push('start'),
    probeConnection: async () => { calls.push('probe'); return true; },
    sleep: noSleep,
  });
  expect(v.passed).toBe(true);
  expect(calls).toEqual(['start', 'probe']); // start BEFORE probing
  expect(v.stages[0].detail).toMatch(/was down/);
});

test('start throws → fails at engine_start, never probes', async () => {
  let probed = false;
  const v = await reconnect({
    engineRunning: false,
    startEngine: async () => { throw new Error('spawn EACCES'); },
    probeConnection: async () => { probed = true; return true; },
    sleep: noSleep,
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'engine_start').ok).toBe(false);
  expect(v.stages.find(s => s.name === 'engine_start').detail).toMatch(/spawn EACCES/);
  expect(probed).toBe(false);
  expect(v.stages.find(s => s.name === 'connect')).toBeUndefined();
});

test('handshake never succeeds → fails at connect (honest)', async () => {
  const v = await reconnect({
    engineRunning: true,
    startEngine: async () => {},
    probeConnection: async () => false,
    sleep: noSleep,
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'connect').ok).toBe(false);
  expect(v.stages.find(s => s.name === 'connect').detail).toMatch(/did not accept/);
});

test('probe throwing is caught → connect fails, no crash', async () => {
  const v = await reconnect({
    engineRunning: true,
    startEngine: async () => {},
    probeConnection: async () => { throw new Error('boom'); },
    sleep: noSleep,
  });
  expect(v.passed).toBe(false);
  expect(v.stages.find(s => s.name === 'connect').ok).toBe(false);
});
