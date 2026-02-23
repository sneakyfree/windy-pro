/**
 * Windy Pro — What's New Changelog Popup
 * Shows once per version on first launch after update.
 */
class ChangelogPopup {
    constructor() {
        this.currentVersion = '0.4.0';
        this.overlay = null;
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
              <strong>Batch Mode</strong>
              <p>Record first, get polished text on stop. GPU-accelerated transcription with LLM cleanup for perfect punctuation and paragraphs.</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">🔧</span>
            <div>
              <strong>Multi-Engine Support</strong>
              <p>Choose from 5 engines: Local, WindyPro Cloud, Deepgram, Groq, and OpenAI. Each with different strengths.</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">⏱️</span>
            <div>
              <strong>Configurable Duration</strong>
              <p>Record up to 30 minutes in one go with configurable limits (5/10/15/30 min).</p>
            </div>
          </div>
          <div class="changelog-item">
            <span class="changelog-icon">🧠</span>
            <div>
              <strong>LLM Cleanup</strong>
              <p>AI-powered text cleanup fixes punctuation, capitalization, removes filler words, and adds natural paragraph breaks.</p>
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
