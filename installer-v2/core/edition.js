/**
 * Installer-side edition config — MIRRORS src/client/desktop/edition.js.
 * Keep the engine sets in sync with that file.
 *
 * Consolidation 2026-07-21: ONE edition — 'standard' — all 7 int8 engines.
 * The wizard downloads exactly this fixed set (no hardware-recommendation
 * branching), so every install is predictable — one of the launch virtues
 * (simple, can't trip up). Legacy 'reader'/'lite' stamps resolve to 'standard'.
 * int8/CPU today; GPU variants arrive as dropdown additions after silent
 * hardware detect (never a wizard question). WindyTune adapts among whatever
 * is installed.
 */
'use strict';

const EDITION = 'standard';

const ENGINE_SETS = {
  standard: [
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
  ENGINES: ENGINE_SETS[EDITION] || ENGINE_SETS.standard,
  ENGINE_SETS,
};
