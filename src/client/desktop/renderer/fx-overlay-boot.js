// Bootstrap for the whole-screen effects canvas (fx-overlay.html).
//
// MUST be an external file, never an inline <script>: the app installs a CSP
// with `script-src 'self'` on the DEFAULT session, which every window shares —
// an inline block here is silently refused and the canvas renders nothing
// forever (the "no effects outside the app" bug, 2026-07-23).
//
// effects-engine.js (loaded before this) defines VisualOverlay at script scope.
// Visuals only — sound always plays from the app window.

(function () {
  const overlay = new VisualOverlay();
  window.__fxBooted = true; // probe marker for the overlay harness

  if (window.fxAPI && window.fxAPI.onFx) {
    window.fxAPI.onFx(({ type, opts }) => {
      try { overlay.renderEffect(type, opts || {}); }
      catch (err) { console.warn('[FxCanvas] render failed:', err && err.message); }
    });
    console.info('[FxCanvas] ready');
  } else {
    console.warn('[FxCanvas] fxAPI bridge missing — canvas will stay empty');
  }
})();
