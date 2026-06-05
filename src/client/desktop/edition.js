/**
 * Book-launch edition config — single source of truth for the free Windy Word build.
 *
 * Launch virtues: UX > Stability > Simple > Reliability > Quality. These builds are FREE,
 * ungated, and fully local. License enforcement (heartbeat, offline-grace model locking,
 * revoke-delete) is HARD-OFF so the app can never lock or wipe itself — it must work
 * forever, offline, with no phone-home for the user's content.
 *
 * Two editions, differing ONLY in which CPU/int8 engines ship (no GPU/CUDA at launch):
 *   - 'lite'   : 2 engines (website default download)
 *   - 'reader' : all 7 engines (unlocked via the per-book code/link)
 * WindyTune bounces among whatever is installed; the user never picks a model.
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
  // Hard-off for ALL free book-launch builds. Do not flip to true here — paid enforcement
  // belongs in a separate build, never in the free reader/lite editions.
  LICENSE_ENFORCEMENT: false,
  ENGINES: ENGINE_SETS[EDITION] || ENGINE_SETS.reader,
  ENGINE_SETS,
};
