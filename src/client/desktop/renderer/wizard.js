/**
 * Windy Pro — Setup Wizard
 * Shows on first launch to guide users through engine + mode selection.
 */
class SetupWizard {
    constructor(app) {
        this.app = app;
        this.step = 0;
        this.choices = {
            recordingMode: 'batch',
            engine: 'local',
            apiKey: ''
        };
        this.overlay = null;
    }

    shouldShow() {
        return !localStorage.getItem('windy_wizardComplete');
    }

    show() {
        if (!this.shouldShow()) return;
        this.overlay = document.createElement('div');
        this.overlay.id = 'setupWizard';
        this.overlay.className = 'wizard-overlay';
        this.overlay.innerHTML = this._buildHTML();
        document.body.appendChild(this.overlay);
        this._bindEvents();
        this._showStep(0);
    }

    _buildHTML() {
        return `
      <div class="wizard-container">
        <!-- Progress bar -->
        <div class="wizard-progress">
          <div class="wizard-progress-fill" id="wizardProgressFill" style="width:25%"></div>
        </div>

        <!-- Step 0: Welcome -->
        <div class="wizard-step" id="wizardStep0">
          <div class="wizard-emoji">🌪️</div>
          <h2 class="wizard-title">Welcome to Windy Pro</h2>
          <p class="wizard-desc">Voice-to-text that just works. Let's get you set up in 30 seconds.</p>
          <ul class="wizard-features">
            <li>🎙️ Record your voice, get polished text</li>
            <li>🔒 Privacy-first — works offline or in the cloud</li>
            <li>⚡ 5 transcription engines to choose from</li>
            <li>✨ LLM cleanup for perfect punctuation & formatting</li>
          </ul>
          <button class="wizard-btn primary" data-action="next">Get Started →</button>
        </div>

        <!-- Step 1: Choose Mode -->
        <div class="wizard-step" id="wizardStep1" style="display:none">
          <h2 class="wizard-title">Choose Your Recording Mode</h2>
          <p class="wizard-desc">How should Windy Pro process your audio?</p>
          <div class="wizard-cards">
            <div class="wizard-card selected" data-mode="batch" id="wizCardBatch">
              <div class="card-badge">✨ Recommended</div>
              <div class="card-icon">🎬</div>
              <h3>Batch Mode</h3>
              <p>Record first, then process everything at once for the best quality.</p>
              <ul class="card-pros">
                <li>✅ Best accuracy & formatting</li>
                <li>✅ LLM-polished output</li>
                <li>✅ Up to 30 min recordings</li>
              </ul>
            </div>
            <div class="wizard-card" data-mode="live" id="wizCardLive">
              <div class="card-icon">📝</div>
              <h3>Live Mode</h3>
              <p>Words appear instantly as you speak. Faster feedback, lower quality.</p>
              <ul class="card-pros">
                <li>✅ Real-time feedback</li>
                <li>⚠️ Lower accuracy</li>
                <li>⚠️ No LLM cleanup</li>
              </ul>
            </div>
          </div>
          <div class="wizard-nav">
            <button class="wizard-btn secondary" data-action="back">← Back</button>
            <button class="wizard-btn primary" data-action="next">Next →</button>
          </div>
        </div>

        <!-- Step 2: Choose Engine -->
        <div class="wizard-step" id="wizardStep2" style="display:none">
          <h2 class="wizard-title">Choose Your Engine</h2>
          <p class="wizard-desc">Where should your audio be processed?</p>
          <div class="wizard-engine-list">
            <div class="wizard-engine selected" data-engine="local">
              <span class="engine-icon">🏠</span>
              <div class="engine-info">
                <strong>Local</strong>
                <span class="engine-tag">Free · Private · Offline</span>
              </div>
              <span class="engine-check">✓</span>
            </div>
            <div class="wizard-engine" data-engine="cloud">
              <span class="engine-icon">☁️</span>
              <div class="engine-info">
                <strong>WindyPro Cloud</strong>
                <span class="engine-tag">GPU · Best Quality · $5/mo</span>
              </div>
              <span class="engine-check">✓</span>
            </div>
            <div class="wizard-engine" data-engine="deepgram">
              <span class="engine-icon">🎙️</span>
              <div class="engine-info">
                <strong>Deepgram</strong>
                <span class="engine-tag">Best Streaming · API Key</span>
              </div>
              <span class="engine-check">✓</span>
            </div>
            <div class="wizard-engine" data-engine="groq">
              <span class="engine-icon">⚡</span>
              <div class="engine-info">
                <strong>Groq</strong>
                <span class="engine-tag">Fastest · Free Tier · API Key</span>
              </div>
              <span class="engine-check">✓</span>
            </div>
            <div class="wizard-engine" data-engine="openai">
              <span class="engine-icon">🌐</span>
              <div class="engine-info">
                <strong>OpenAI Whisper</strong>
                <span class="engine-tag">Reliable · API Key</span>
              </div>
              <span class="engine-check">✓</span>
            </div>
          </div>
          <div class="wizard-apikey-row" id="wizApiKeyRow" style="display:none">
            <label id="wizApiKeyLabel">API Key</label>
            <input type="password" id="wizApiKeyInput" placeholder="Paste your API key here" class="wizard-input">
            <a id="wizApiKeyLink" href="#" class="wizard-link" target="_blank">Get a key →</a>
          </div>
          <div class="wizard-nav">
            <button class="wizard-btn secondary" data-action="back">← Back</button>
            <button class="wizard-btn primary" data-action="next">Next →</button>
          </div>
        </div>

        <!-- Step 3: Ready -->
        <div class="wizard-step" id="wizardStep3" style="display:none">
          <div class="wizard-emoji">🚀</div>
          <h2 class="wizard-title">You're Ready!</h2>
          <div class="wizard-summary" id="wizardSummary"></div>
          <p class="wizard-desc" style="margin-top:12px;">Press <kbd>Ctrl+Shift+Space</kbd> to start recording anytime.</p>
          <button class="wizard-btn primary" data-action="finish">Start Recording 🎤</button>
        </div>
      </div>
    `;
    }

    _showStep(n) {
        this.step = n;
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`wizardStep${i}`);
            if (el) el.style.display = i === n ? 'flex' : 'none';
        }
        const fill = document.getElementById('wizardProgressFill');
        if (fill) fill.style.width = `${((n + 1) / 4) * 100}%`;

        // Update summary on last step
        if (n === 3) {
            const summary = document.getElementById('wizardSummary');
            const modeLabel = this.choices.recordingMode === 'batch' ? '✨ Batch (best quality)' : '📝 Live (real-time)';
            const engineLabels = { local: '🏠 Local', cloud: '☁️ WindyPro Cloud', deepgram: '🎙️ Deepgram', groq: '⚡ Groq', openai: '🌐 OpenAI' };
            summary.innerHTML = `
        <div class="summary-row"><span>Recording Mode</span><strong>${modeLabel}</strong></div>
        <div class="summary-row"><span>Engine</span><strong>${engineLabels[this.choices.engine]}</strong></div>
      `;
        }
    }

    _bindEvents() {
        // Navigation buttons
        this.overlay.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'next') this._showStep(this.step + 1);
                else if (action === 'back') this._showStep(this.step - 1);
                else if (action === 'finish') this._complete();
            });
        });

        // Mode cards
        this.overlay.querySelectorAll('.wizard-card').forEach(card => {
            card.addEventListener('click', () => {
                this.overlay.querySelectorAll('.wizard-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.choices.recordingMode = card.dataset.mode;
            });
        });

        // Engine rows
        this.overlay.querySelectorAll('.wizard-engine').forEach(row => {
            row.addEventListener('click', () => {
                this.overlay.querySelectorAll('.wizard-engine').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');
                this.choices.engine = row.dataset.engine;
                this._updateApiKeyRow();
            });
        });
    }

    _updateApiKeyRow() {
        const row = document.getElementById('wizApiKeyRow');
        const label = document.getElementById('wizApiKeyLabel');
        const link = document.getElementById('wizApiKeyLink');
        const needsKey = ['deepgram', 'groq', 'openai'].includes(this.choices.engine);
        row.style.display = needsKey ? 'flex' : 'none';

        const links = {
            deepgram: 'https://console.deepgram.com/signup',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys'
        };
        if (needsKey) {
            label.textContent = `${this.choices.engine.charAt(0).toUpperCase() + this.choices.engine.slice(1)} API Key`;
            link.href = links[this.choices.engine] || '#';
        }
    }

    _complete() {
        // Save recording mode
        localStorage.setItem('windy_recordingMode', this.choices.recordingMode);
        if (window.windyAPI?.updateSettings) {
            window.windyAPI.updateSettings({ recordingMode: this.choices.recordingMode });
        }

        // Save engine
        localStorage.setItem('windy_engine', this.choices.engine);
        if (window.windyAPI?.updateSettings) {
            window.windyAPI.updateSettings({ engine: this.choices.engine });
        }

        // Save API key if provided
        const apiKeyInput = document.getElementById('wizApiKeyInput');
        if (apiKeyInput && apiKeyInput.value.trim()) {
            const key = apiKeyInput.value.trim();
            const keyMap = { deepgram: 'deepgramApiKey', groq: 'groqApiKey', openai: 'openaiApiKey' };
            const storageKey = keyMap[this.choices.engine];
            if (storageKey) {
                localStorage.setItem(`windy_${storageKey}`, key);
                if (window.windyAPI?.updateSettings) {
                    window.windyAPI.updateSettings({ [storageKey]: key });
                }
            }
        }

        // Mark wizard complete
        localStorage.setItem('windy_wizardComplete', 'true');
        localStorage.setItem('windy_lastSeenVersion', '0.4.0');

        // Remove overlay
        this.overlay.remove();
        this.overlay = null;
    }
}
