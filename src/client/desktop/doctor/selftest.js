// selftest.js — the ADR-060 `run_selftest` core-path exerciser for Windy
// Word. Actively transcribes a bundled test clip and verifies text comes
// back, pass/fail PER STAGE. Distinct from get_health (the doctor's static
// diagnosis) — this drives the REAL engine round-trip.
//
// Dependency-injected (engineRunning flag, transcribe fn, clip path) so it
// is unit-testable without a live Python engine. The caller (main.js) wires
// the real _transcribeAudioFile — a FILE-based path (ffmpeg → WebSocket
// engine), NOT the mic/recording path, so this never touches recording,
// paste, Wayland, or focus.
//
// Verdict uses `passed`, never top-level `ok` (the ADR-060 invoke envelope
// reserves `ok` for call success; a failing canary is still a successful
// observation).

'use strict';

const fs = require('fs');

/**
 * @param {object} deps
 * @param {boolean} deps.engineRunning  is the Python transcription engine up?
 * @param {string}  deps.clipPath       absolute path to the bundled test clip.
 * @param {(path:string)=>Promise<{transcript?:string}>} deps.transcribe
 *        the real file transcriber (main.js's _transcribeAudioFile bound to
 *        {language:'en'}).
 * @returns {Promise<{passed:boolean, stages:Array, duration_ms:number}>}
 */
async function runSelftest({ engineRunning, clipPath, transcribe }) {
  const started = Date.now();
  const stages = [];

  // Stage 1 — the engine must be up (transcribe needs it).
  stages.push({ name: 'engine', ok: !!engineRunning,
                detail: engineRunning ? 'running' : 'Python transcription engine is not running' });

  // Stage 2 — the bundled canary clip must be present.
  const clipPresent = !!clipPath && fs.existsSync(clipPath);
  stages.push({ name: 'clip', ok: clipPresent,
                detail: clipPresent ? 'bundled test clip found' : `test clip missing: ${clipPath}` });

  // Stage 3 — the real transcription round-trip yields non-empty text.
  if (engineRunning && clipPresent) {
    try {
      const result = await transcribe(clipPath);
      const text = (result && typeof result.transcript === 'string') ? result.transcript.trim() : '';
      stages.push({
        name: 'transcribe',
        ok: text.length > 0,
        // content-free: report only the LENGTH of the transcript, never the
        // transcript itself (privacy — it's user-shaped speech-to-text).
        detail: text.length > 0 ? `produced ${text.length} chars` : 'engine returned an empty transcript',
      });
    } catch (e) {
      stages.push({ name: 'transcribe', ok: false, detail: `transcribe threw: ${e && e.message}` });
    }
  } else {
    stages.push({ name: 'transcribe', ok: false, detail: 'skipped — engine or clip unavailable' });
  }

  return {
    passed: stages.every(s => s.ok),
    stages,
    duration_ms: Date.now() - started,
  };
}

module.exports = { runSelftest };
