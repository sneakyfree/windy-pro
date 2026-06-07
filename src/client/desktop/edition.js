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

function resolveEdition() {
  // Baked at build time by scripts/stamp-edition.cjs. Falls back to env, then 'reader',
  // so a plain build (no stamp file) is always a valid Reader edition.
  try { return require('./edition.generated.json').edition; } catch (_) { /* not stamped */ }
  return process.env.WINDY_EDITION || 'reader';
}
const EDITION = resolveEdition() === 'lite' ? 'lite' : 'reader';

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
  // ── Book-launch UI minimalism ────────────────────────────────────────────
  // The free Windy Word build is deliberately ONE thing: God's-gift local
  // voice-to-text. The full-ecosystem cross-sell surfaces — the product-switcher
  // tab bar (Chat/Mail/Cloud/Clone/Agent/Code/Panel), the marketplace/Bundles
  // view, the "Hatch Your Agent" card, and the embedded ecosystem webviews — are
  // HIDDEN here, not removed. All that code stays in place; the full build (main
  // branch) leaves this true and shows everything. Flip to true to restore the
  // full ecosystem UI in this build with zero other changes. Reversible by design.
  ECOSYSTEM_UI: false,
  // Translation tools (🌐 Translate Studio / Quick Translate). A voice feature,
  // not ecosystem cross-sell, so kept ON by default — gated separately so it can
  // be toggled independently. Flip to false to strip the app to pure dictation.
  TRANSLATION_UI: true,
  // Unlimited recording length — the dictate-a-whole-book use case. The
  // max-duration auto-stop is already disabled in the renderer for free builds;
  // this flag makes the Settings UI honest about it (shows "Unlimited" instead of
  // the license-tier 5-minute cap). Paid/tiered builds set this false to restore
  // the tiered Max-Recording dropdown.
  UNLIMITED_RECORDING: true,
  // Cloud storage (WindyCloud sync). OFF for book-launch — WindyCloud isn't live
  // yet, so the storage selectors hide the WindyCloud/Both options and lock to
  // local-only. The local-folder picker (save anywhere on disk) stays. Flip to
  // true when WindyCloud ships to restore cloud/sync storage. Reversible.
  CLOUD_STORAGE: false,
  // Auto-update via electron-updater (GitHub releases). OFF for book-launch: this
  // build is distributed as a notarized DMG from R2 (downloads.windyword.ai), not via
  // GitHub releases, so the updater only 404s on latest-mac.yml and throws an unhandled
  // rejection on every launch. Users update by re-downloading. Flip true in the full
  // build (which ships GitHub releases) to restore auto-update. Reversible.
  AUTO_UPDATE: false,
  ENGINES: ENGINE_SETS[EDITION] || ENGINE_SETS.reader,
  ENGINE_SETS,
};
