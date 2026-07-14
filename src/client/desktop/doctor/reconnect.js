// reconnect.js — the ADR-060 `reconnect` knob for Windy Word: re-establish
// the primary connection (the Python transcription engine) WITHOUT a full
// app restart.
//
// Two cases, per stage:
//   1. engine not running  → start it (the same startPythonServer() the app
//      uses on crash-recovery), then verify a WebSocket handshake.
//   2. engine already up    → just verify the handshake (re-establish the
//      link an agent believes is stuck).
//
// Dependency-injected (engineRunning, startEngine, probeConnection) so it is
// unit-testable without spawning Python. Touches ONLY the engine link — never
// recording, paste, Wayland, or focus. Verdict uses `passed`, never top-level
// `ok` (the ADR-060 invoke envelope reserves `ok`).

'use strict';

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} deps
 * @param {boolean} deps.engineRunning
 * @param {()=>Promise<void>|void} deps.startEngine  starts the Python engine.
 * @param {()=>Promise<boolean>} deps.probeConnection  true iff a WS handshake
 *        to the engine succeeds (with its own retries).
 * @param {number} [deps.settleMs]  pause after a cold start before probing.
 * @param {(ms:number)=>Promise<void>} [deps.sleep]  injectable for tests.
 * @returns {Promise<{passed:boolean, stages:Array, duration_ms:number}>}
 */
async function reconnect({ engineRunning, startEngine, probeConnection, settleMs = 1500, sleep = _sleep }) {
  const started = Date.now();
  const stages = [];

  if (!engineRunning) {
    try {
      await startEngine();
      stages.push({ name: 'engine_start', ok: true, detail: 'engine was down — started it' });
    } catch (e) {
      stages.push({ name: 'engine_start', ok: false, detail: `start failed: ${e && e.message}` });
      return _verdict(stages, started);
    }
    await sleep(settleMs); // let the engine bind its port + begin loading
  } else {
    stages.push({ name: 'engine_start', ok: true, detail: 'engine already running' });
  }

  let connected = false;
  try {
    connected = await probeConnection();
  } catch (e) {
    connected = false;
  }
  stages.push({
    name: 'connect',
    ok: connected,
    detail: connected ? 'websocket handshake ok' : 'engine did not accept a connection',
  });

  return _verdict(stages, started);
}

function _verdict(stages, started) {
  return { passed: stages.every((s) => s.ok), stages, duration_ms: Date.now() - started };
}

module.exports = { reconnect };
