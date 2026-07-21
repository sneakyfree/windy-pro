/**
 * Windy Word — What's New Changelog Popup
 * Shows once per version on first launch after update.
 */
class ChangelogPopup {
  constructor() {
    // Real app version (package.json), not a hardcode — the old '0.4.0' shipped as a stale
    // literal and showed up in the UI as "Windy Word v0.4.0" while the app was actually 1.7.0.
    this.currentVersion = '1.8.0';
    this._setVersionWatermark(this.currentVersion);
    if (window.windyAPI?.getAppVersion) {
      window.windyAPI.getAppVersion().then(v => {
        if (v) { this.currentVersion = v; this._setVersionWatermark(v); }
      }).catch(() => {});
    }
    this.overlay = null;
  }

  // Feeds the .window::before version watermark (styles.css) so it can't go
  // stale again — it displayed a hardcoded 'v0.4.0' for four releases.
  _setVersionWatermark(v) {
    try {
      document.documentElement.style.setProperty('--ww-version-label', `'Windy Word v${v}'`);
    } catch (_) { }
  }

  shouldShow() {
    const lastSeen = localStorage.getItem('windy_lastSeenVersion') || '0.0.0';
    return lastSeen !== this.currentVersion;
  }

  show() {
    if (!this.shouldShow()) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'wizard-overlay';
    this.overlay.innerHTML = `
      <div class="wizard-container changelog-container">
        <div class="wizard-emoji">🌪️</div>
        <h2 class="wizard-title">What's New in v${this.currentVersion}</h2>

        <div class="changelog-list">
          <div class="changelog-item">
            <span class="changelog-icon">✨</span>
            <div>
              <strong>Record → Speak → Paste</strong>
              <p>Press the hotkey (or the Record button), talk, and your words land wherever your cursor is — instantly, on your machine. Nothing is ever uploaded.</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">🔧</span>
            <div>
              <strong>Seven engines, your pick</strong>
              <p>Seven on-device speech engines are bundled — from the tiny, instant Nano to the flagship Pro. WindyTune auto-picks the best for your machine, or choose your own from the dropdown.</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">🌐</span>
            <div>
              <strong>On-device translation</strong>
              <p>Speak in one language, get text in another — a bundled translation model runs fully offline. Works on a plane or a mountain bus.</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">🔒</span>
            <div>
              <strong>Unlimited & private</strong>
              <p>Record as long as you like — dictate a whole book. No account required, no time limit, and your audio never leaves your computer.</p>
            </div>
          </div>
        </div>

        <button class="wizard-btn primary" id="changelogDismiss">Got it! 🚀</button>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.overlay.querySelector('#changelogDismiss').addEventListener('click', () => this._dismiss());
  }

  _dismiss() {
    localStorage.setItem('windy_lastSeenVersion', this.currentVersion);
    this.overlay.remove();
    this.overlay = null;
  }
}
