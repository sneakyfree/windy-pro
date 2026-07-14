// safe-mode.js — the ADR-060 enter_safe_mode / exit_safe_mode knobs for
// Windy Word. A minimal, REVERSIBLE known-good overlay on the transcription
// ENGINE config: bundled local Whisper + a reliable model, no cloud, no
// auto-tune. Deliberately scoped to the engine (the core path); it does NOT
// touch paste/recording/Wayland/focus config.
//
// enter snapshots the current engine settings, then applies the known-good
// set (hot-reloaded via applySetting). exit restores the snapshot exactly.
// State lives in the store under `safeMode` so it survives a restart.
//
// Dependency-injected (getSetting/applySetting/getSafeState/setSafeState) so
// it is unit-testable without electron-store or a live engine.

'use strict';

// The known-good overlay — catalog defaults for the core transcription path.
const KNOWN_GOOD = Object.freeze({
  'engine.engine': 'local',   // bundled Whisper; no cloud, no windytune auto-switch
  'engine.model': 'small',    // reliable default model
});

/**
 * @param {object} io
 * @param {(path:string)=>any} io.getSetting
 * @param {(path:string, value:any)=>void} io.applySetting  sets + hot-reloads.
 * @param {()=>{active:boolean, snapshot?:object}|undefined} io.getSafeState
 * @param {(state:{active:boolean, snapshot:object|null})=>void} io.setSafeState
 */
function enterSafeMode(io) {
  const state = io.getSafeState() || {};
  if (state.active) {
    return { ok: true, active: true, alreadyActive: true, snapshot: state.snapshot || {} };
  }
  // Snapshot exactly the keys we're about to override, so exit is exact.
  const snapshot = {};
  for (const path of Object.keys(KNOWN_GOOD)) snapshot[path] = io.getSetting(path);

  for (const [path, value] of Object.entries(KNOWN_GOOD)) io.applySetting(path, value);
  io.setSafeState({ active: true, snapshot });

  return { ok: true, active: true, applied: { ...KNOWN_GOOD }, snapshot };
}

function exitSafeMode(io) {
  const state = io.getSafeState() || {};
  if (!state.active) {
    return { ok: true, active: false, alreadyOut: true };
  }
  const snapshot = state.snapshot || {};
  for (const [path, value] of Object.entries(snapshot)) io.applySetting(path, value);
  io.setSafeState({ active: false, snapshot: null });

  return { ok: true, active: false, restored: snapshot };
}

module.exports = { enterSafeMode, exitSafeMode, KNOWN_GOOD };
