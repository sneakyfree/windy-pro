/*
 * Book-launch UI gating — applies the edition flags to <html> BEFORE the body
 * paints, so the full-ecosystem surfaces never flash into view in the free build.
 *
 * Loaded as a parser-blocking <script> in <head> (after the preload has exposed
 * window.windyAPI, before <body> is parsed). Reads the build-time flags and adds
 * gating classes that edition-ui.css keys off of. When the full ecosystem build
 * runs, ecosystemUI is true → no class is added → the app renders in full.
 *
 * Reversible by design: this only ADDS classes when flags are off. Remove nothing
 * to restore — flip ECOSYSTEM_UI/TRANSLATION_UI back to true in edition.js.
 */
(function () {
  try {
    var api = (typeof window !== 'undefined' && window.windyAPI) || {};
    var root = document.documentElement;
    if (api.ecosystemUI === false) root.classList.add('edition-simple');
    if (api.translationUI === false) root.classList.add('edition-no-translate');
  } catch (_) {
    /* On any error, add no class → default to the full UI (safe fallback). */
  }
})();
