/**
 * 🌪️ WindyTune Smart Nudge (Electron)
 * Monitors transcription performance and shows a non-intrusive
 * notification when the device is struggling. Never auto-switches.
 * Respects user preferences and frequency limits.
 */

const NUDGE_KEY = 'windy_nudge_state';
const MAX_DISMISSALS = 3;
const MIN_NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const SLOW_THRESHOLD_MULTIPLIER = 3;
const CONSECUTIVE_SLOW_THRESHOLD = 2;

class WindyTuneNudge {
  constructor() {
    this._state = this._loadState();
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(NUDGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { dismissCount: 0, lastNudgeTimestamp: 0, permanentlyDismissed: false, consecutiveSlowCount: 0 };
  }

  _saveState() {
    try {
      localStorage.setItem(NUDGE_KEY, JSON.stringify(this._state));
    } catch (e) { /* ignore */ }
  }

  /**
   * Call after each transcription with timing data.
   * @param {number} durationMs - How long transcription took
   * @param {number} audioLengthMs - How long the audio clip was
   * @param {string} engine - Which engine was used
   */
  reportPerformance(durationMs, audioLengthMs, engine) {
    // Don't nudge if cloud is already the engine
    if (engine === 'cloud' || engine === 'windy-cloud') return;

    // Don't nudge if user already chose best quality mode
    const mode = localStorage.getItem('windy_processingMode');
    if (mode === 'bestquality') return;

    if (this._state.permanentlyDismissed) return;
    if (this._state.dismissCount >= MAX_DISMISSALS) {
      this._state.permanentlyDismissed = true;
      this._saveState();
      return;
    }

    const ratio = durationMs / Math.max(audioLengthMs, 1000);
    const isSlow = ratio > SLOW_THRESHOLD_MULTIPLIER;

    if (isSlow) {
      this._state.consecutiveSlowCount++;
    } else {
      this._state.consecutiveSlowCount = 0;
    }

    this._saveState();

    if (this._state.consecutiveSlowCount < CONSECUTIVE_SLOW_THRESHOLD) return;

    const now = Date.now();
    if (now - this._state.lastNudgeTimestamp < MIN_NUDGE_INTERVAL_MS) return;

    this._state.lastNudgeTimestamp = now;
    this._state.consecutiveSlowCount = 0;
    this._saveState();

    this._showNudge();
  }

  _showNudge() {
    // Create a non-intrusive toast notification
    const toast = document.createElement('div');
    toast.id = 'windytune-nudge';
    toast.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;max-width:380px;background:#1e1e2e;border:1px solid #333;border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:99999;font-family:system-ui,sans-serif;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:18px;">🌪️</span>
          <span style="font-size:14px;font-weight:700;color:#fff;">WindyTune Notice</span>
          <button id="nudge-close" style="margin-left:auto;background:none;border:none;color:#666;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <p style="font-size:12px;color:#9CA3AF;margin:0 0 10px;line-height:1.5;">
          Your device seems to be working hard. A few things that might help:
        </p>
        <div style="font-size:11px;color:#ccc;line-height:1.6;">
          🔄 <b>Try a lighter model</b> — smaller models run faster on your hardware<br>
          ☁️ <b>Try Best Quality mode</b> — uses cloud when connected for speed<br>
          ❄️ <b>Cool down</b> — give your device a moment to breathe
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="nudge-settings" style="flex:1;padding:8px;background:#22C55E;color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Open Settings</button>
          <button id="nudge-dismiss" style="padding:8px 12px;background:#333;color:#999;border:none;border-radius:6px;font-size:11px;cursor:pointer;">Dismiss</button>
          <button id="nudge-never" style="padding:8px 12px;background:transparent;color:#666;border:1px solid #333;border-radius:6px;font-size:10px;cursor:pointer;">Don't show again</button>
        </div>
      </div>
    `;
    document.body.appendChild(toast);

    // Animate in
    toast.firstElementChild.style.animation = 'fadeIn 0.3s ease';

    toast.querySelector('#nudge-close').addEventListener('click', () => this._dismissNudge(toast));
    toast.querySelector('#nudge-dismiss').addEventListener('click', () => {
      this._state.dismissCount++;
      this._saveState();
      this._dismissNudge(toast);
    });
    toast.querySelector('#nudge-never').addEventListener('click', () => {
      this._state.permanentlyDismissed = true;
      this._saveState();
      this._dismissNudge(toast);
    });
    toast.querySelector('#nudge-settings').addEventListener('click', () => {
      // Trigger settings panel open if available
      const settingsBtn = document.querySelector('[data-panel="settings"]') || document.querySelector('#settingsBtn');
      if (settingsBtn) settingsBtn.click();
      this._dismissNudge(toast);
    });

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (document.getElementById('windytune-nudge')) this._dismissNudge(toast);
    }, 30000);
  }

  _dismissNudge(el) {
    if (el && el.parentNode) {
      el.firstElementChild.style.animation = 'fadeOut 0.2s ease forwards';
      setTimeout(() => el.remove(), 200);
    }
  }

  reset() {
    this._state = { dismissCount: 0, lastNudgeTimestamp: 0, permanentlyDismissed: false, consecutiveSlowCount: 0 };
    this._saveState();
  }
}

// Singleton
window.windyTuneNudge = new WindyTuneNudge();
