// capabilities.js — tri-state per-FEATURE probe for the ADR-060
// `get_capabilities` knob. PROBED, not assumed: each feature reports
// `supported` / `unsupported` / `unknown` (§3.4 tri-state law).
//
// Read-only and side-effect-free. Deliberately does NOT touch recording,
// paste injection, Wayland/focus, or getUserMedia (probing the mic live
// would steal focus) — those are the dangerous paths. `recording` is
// therefore reported as a present capability whose LIVE availability is
// answered by run_selftest, not by a mic grab here.

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function hasBinary(name) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(finder, [name], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function probeTts() {
  if (process.platform === 'darwin') {
    return (await hasBinary('say'))
      ? { status: 'supported', detail: 'macOS `say`' }
      : { status: 'unsupported', detail: '`say` not found' };
  }
  if (process.platform === 'win32') {
    // SAPI is always present on Windows.
    return { status: 'supported', detail: 'Windows SAPI' };
  }
  for (const bin of ['spd-say', 'espeak-ng', 'espeak']) {
    if (await hasBinary(bin)) return { status: 'supported', detail: bin };
  }
  return { status: 'unsupported', detail: 'no TTS engine (spd-say/espeak) on PATH' };
}

/**
 * Probe each user-facing feature. Never throws — a probe that itself fails
 * yields {status:'unknown'} for that feature.
 *
 * @returns {Promise<Object<string,{status:string, detail?:string}>>}
 */
async function probeCapabilities() {
  const caps = {};

  // paste — genuinely probed via the strategy registry's own detection.
  try {
    const paste = require('../strategies/paste-strategies');
    const avail = await paste.detectAvailable();
    caps.paste = avail.length
      ? { status: 'supported', detail: `${avail.length} strategy(ies) available` }
      : { status: 'unsupported', detail: 'no paste strategy available on this machine' };
  } catch (e) {
    caps.paste = { status: 'unknown', detail: `probe failed: ${e.message}` };
  }

  // tts — probed by platform + engine binary.
  try {
    caps.tts = await probeTts();
  } catch (e) {
    caps.tts = { status: 'unknown', detail: `probe failed: ${e.message}` };
  }

  // recording — Word's core capability; ALWAYS present as a feature. Live mic
  // availability is intentionally not probed here (a getUserMedia grab would
  // steal focus) — run_selftest exercises the real record→transcribe path.
  caps.recording = { status: 'supported', detail: 'core feature; live mic check via run_selftest' };

  // translate — present, but a network call to windyword.ai at use time.
  caps.translate = { status: 'supported', detail: 'via windyword.ai; requires network at call time' };

  // clone — entitlement/edition-gated; not probeable read-only here.
  caps.clone = { status: 'unknown', detail: 'entitlement/edition-gated; not probed here' };

  return caps;
}

module.exports = { probeCapabilities, probeTts, hasBinary };
