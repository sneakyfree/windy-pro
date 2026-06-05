/**
 * Installer-side edition config — MIRRORS src/client/desktop/edition.js.
 * Keep the engine sets in sync with that file.
 *
 * The wizard downloads exactly this fixed set (no hardware-recommendation branching),
 * so every install is predictable — one of the launch virtues (simple, can't trip up).
 *   'lite'   : 2 engines (website default download)
 *   'reader' : all 7 int8 engines (unlocked via the per-book code/link)
 * int8/CPU only — no GPU/CUDA at launch. WindyTune adapts among whatever is installed.
 */
'use strict';

const EDITION = process.env.WINDY_EDITION || 'reader';

const ENGINE_SETS = {
  lite: ['windy-lite-ct2', 'windy-turbo-ct2'],
  reader: [
    'windy-nano-ct2',
    'windy-lite-ct2',
    'windy-core-ct2',
    'windy-edge-ct2',
    'windy-plus-ct2',
    'windy-turbo-ct2',
    'windy-pro-engine-ct2',
  ],
};

module.exports = {
  EDITION,
  ENGINES: ENGINE_SETS[EDITION] || ENGINE_SETS.reader,
  ENGINE_SETS,
};
