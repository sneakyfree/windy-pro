/**
 * Edition config — single source of truth for the flagship Windy Word build.
 *
 * Consolidation decision 2026-07-21: ONE edition — 'standard' — for everybody.
 * All 7 CPU/int8 engines ship; there is no lite tier and no model shopping.
 * Legacy 'reader'/'lite' stamps (pre-consolidation artifacts) resolve to
 * 'standard'. WindyTune bounces among whatever is installed; the user never
 * has to pick a model (but may, from the dropdown).
 *
 * Launch virtues: UX > Stability > Simple > Reliability > Quality. This build is
 * FREE and fully local. License enforcement (heartbeat, offline-grace model
 * locking, revoke-delete) is HARD-OFF so the app can never lock or wipe itself —
 * it must work forever, offline, with no phone-home for the user's content.
 */
'use strict';

function resolveEdition() {
  // Baked at build time by scripts/stamp-edition.cjs. Falls back to env, then
  // 'standard', so a plain build (no stamp file) is always a valid standard build.
  try { return require('./edition.generated.json').edition; } catch (_) { /* not stamped */ }
  return process.env.WINDY_EDITION || 'standard';
}
// Every legacy stamp value ('reader', 'lite') maps to the one flagship edition.
const EDITION = 'standard';
void resolveEdition; // retained for stamp-file diagnostics/back-compat

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
  // Hard-off for the free flagship build. Do not flip to true here — paid enforcement
  // belongs server-side (cloud compute/storage entitlements), never in the free client.
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
  // Translation tools (🌐 Translate Studio / Quick Translate). ON: translation is now
  // fully ON-DEVICE — a bundled NLLB-200 (CTranslate2 int8) model + SentencePiece,
  // routed through the offline 'translate-local' engine path. No internet, no API key.
  // Works on a plane or a mountain bus. (Speech→English is local Whisper; text→any
  // language is local NLLB.) Reversible: flip false to strip back to pure dictation.
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
  // Auto-update via electron-updater against the R2 generic feed
  // (downloads.windyword.ai/updates — see updater.js). ON for the flagship:
  // the update check is simultaneously the install census (content-free — CF
  // zone analytics count the requests) and the delivery channel for every
  // future flag-flip and seasonal offer. Where the packaged target can't
  // auto-apply (portable ZIP / DMG), the check still notifies and links the
  // re-download; failures stay silent (wrapped upstream). Reversible.
  AUTO_UPDATE: true,
  // Agent-control HTTP surface (localhost:18765 — /recording, /audio, /sound-effects,
  // /widget, /paste config, /install, /transcribe-file) that lets an external AI agent
  // drive the app. OFF for book-launch: it's an ecosystem/power-user feature, and being
  // unauthenticated (localhost-only, but no token/Origin check) a visited web page could
  // POST to it and silently start the mic — not something to ship to a general audience.
  // When false: the control server is NOT started on macOS/Windows (it has no other job
  // there — hotkeys use Electron globalShortcut); on Linux it still runs for Wayland paste
  // but serves ONLY the legacy paste/toggle actions, not the agent routes. The full build
  // (main branch) leaves this true so agents can drive it. Reversible. See docs/AGENT-ARCHITECTURE.md.
  AGENT_CONTROL: false,
  // Safe app-control KNOBS for a co-located Windy Fly agent — the dials a grandma
  // turns by voice ("turn the sounds down", "make the window bigger"): sounds,
  // on-screen widget, catalog-validated settings, window geometry. ON even in the
  // free book-launch build (the whole point is a normie controlling her app by
  // talking to her agent), but the DANGEROUS surface (/config raw-mutate, /install,
  // /transcribe-file, cloud upload, paste injection) stays gated behind AGENT_CONTROL.
  // With this true the control server starts on every platform (macOS/Windows too).
  // Flip false to strip the app back to zero local control surface. Reversible.
  AGENT_CONTROL_KNOBS: true,
  ENGINES: ENGINE_SETS[EDITION] || ENGINE_SETS.standard,
  ENGINE_SETS,
};
