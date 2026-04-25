// Phase 8 post-first-transcription cloud-account upsell.
//
// Replaces the in-wizard account screen. Shown exactly once: the first
// time the user actually feels the magic of a transcription landing.
//
// Two outcomes:
//   "Create free account" → opens the existing account UI / web flow.
//   "No thanks"            → stamps localStorage so we never bug them.
//
// Auto-dismisses (without remembering) after 30s if untouched.
//
// Extracted from app.js so it can be unit-tested in jsdom and E2E
// tested in Playwright without launching the full record/transcribe
// stack. The function exported here is the SINGLE source of truth —
// app.js now delegates to this module.
//
// Returns silently and never throws — record flow is sacred.

(function (root) {
  'use strict';

  // Constants — exposed on the function so tests can override the
  // auto-dismiss timeout without monkey-patching setTimeout globally.
  const DEFAULT_AUTO_DISMISS_MS = 30_000;
  const STORAGE_KEY_DISMISSED = 'windy_signup_banner_shown';
  const STORAGE_KEY_TOKEN = 'windy_account_token';
  const SIGNUP_URL = 'https://windyword.ai/signup?source=app-first-transcript';

  /**
   * @param {{text?: string, partial?: boolean}} msg - transcript segment
   * @param {{autoDismissMs?: number, signupUrl?: string}} [opts] - test hooks
   * @returns {HTMLElement|null} the banner element, or null if suppressed
   */
  function maybeShowSignupBanner(msg, opts) {
    if (!msg || msg.partial) return null;
    if (!msg.text || !msg.text.trim()) return null;
    if (localStorage.getItem(STORAGE_KEY_DISMISSED) === '1') return null;
    if (localStorage.getItem(STORAGE_KEY_TOKEN)) return null;
    if (document.getElementById('windy-signup-banner')) return null;

    const autoDismissMs = (opts && typeof opts.autoDismissMs === 'number')
      ? opts.autoDismissMs
      : DEFAULT_AUTO_DISMISS_MS;
    const signupUrl = (opts && opts.signupUrl) || SIGNUP_URL;

    const banner = document.createElement('div');
    banner.id = 'windy-signup-banner';
    banner.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:20px', 'transform:translateX(-50%)',
      'background:linear-gradient(135deg, #1f2937, #111827)',
      'border:1px solid rgba(34,197,94,0.5)',
      'border-radius:14px', 'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
      'padding:14px 20px', 'display:flex', 'align-items:center', 'gap:14px',
      'max-width:520px', 'z-index:99999', 'color:#f3f4f6', 'font-size:14px',
      'line-height:1.4', 'animation:windy-slideup 280ms ease-out',
    ].join(';');
    banner.innerHTML = `
      <div style="font-size:32px;">🌪️</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; margin-bottom:2px;">Loved that?</div>
        <div style="opacity:0.8;">Save your sessions to the cloud — sync across devices, never lose a transcript.</div>
      </div>
      <button id="windy-signup-yes"
        style="background:#22c55e; color:#0b1220; border:none; border-radius:8px; padding:8px 14px; font-weight:700; cursor:pointer; font-size:13px;">
        Create free account
      </button>
      <button id="windy-signup-no"
        style="background:transparent; color:#9ca3af; border:none; cursor:pointer; font-size:13px; padding:8px 6px;">
        No thanks
      </button>
    `;
    if (!document.getElementById('windy-signup-banner-style')) {
      const style = document.createElement('style');
      style.id = 'windy-signup-banner-style';
      style.textContent = '@keyframes windy-slideup { from { transform: translate(-50%, 24px); opacity:0 } to { transform: translate(-50%, 0); opacity:1 } }';
      document.head.appendChild(style);
    }
    document.body.appendChild(banner);

    const dismiss = (rememberDecline) => {
      if (rememberDecline) localStorage.setItem(STORAGE_KEY_DISMISSED, '1');
      banner.style.transition = 'opacity 200ms';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 220);
    };

    document.getElementById('windy-signup-no').onclick = () => dismiss(true);
    document.getElementById('windy-signup-yes').onclick = () => {
      localStorage.setItem(STORAGE_KEY_DISMISSED, '1');
      try {
        if (root.electronAPI && typeof root.electronAPI.openExternal === 'function') {
          root.electronAPI.openExternal(signupUrl);
        } else {
          root.open(signupUrl, '_blank', 'noopener');
        }
      } catch (_) { root.open(signupUrl, '_blank', 'noopener'); }
      dismiss(false);
    };

    // Auto-dismiss (without remembering) so it doesn't camp permanently
    // if the user just walked away from the desk.
    if (autoDismissMs > 0) {
      setTimeout(() => { if (document.body.contains(banner)) dismiss(false); }, autoDismissMs);
    }

    return banner;
  }

  // Expose constants on the function object so tests can introspect.
  maybeShowSignupBanner.STORAGE_KEY_DISMISSED = STORAGE_KEY_DISMISSED;
  maybeShowSignupBanner.STORAGE_KEY_TOKEN = STORAGE_KEY_TOKEN;
  maybeShowSignupBanner.DEFAULT_AUTO_DISMISS_MS = DEFAULT_AUTO_DISMISS_MS;
  maybeShowSignupBanner.SIGNUP_URL = SIGNUP_URL;

  // Dual export: window global for renderer (script tag), CommonJS for tests.
  root.WindySignupBanner = maybeShowSignupBanner;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { maybeShowSignupBanner };
  }
}(typeof window !== 'undefined' ? window : globalThis));
