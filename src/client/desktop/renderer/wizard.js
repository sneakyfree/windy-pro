/**
 * Windy Pro — First-Run Setup Wizard (v2)
 * 6-step premium onboarding: Welcome → Mic → Engine → Account → Plan → Ready
 */
class SetupWizard {
  constructor(app) {
    this.app = app;
    this.totalSteps = 7;
    this.step = 0;
    this.overlay = null;
    this._micStream = null;
    this._micCtx = null;
    this._micInterval = null;
    this._hardware = null;
    this._pollTimer = null;
    this.choices = {
      engine: 'local',
      recordingMode: 'batch',
      accountEmail: '',
      accountSkipped: false,
      planTier: 'free'
    };
  }

  async shouldShow() {
    // Check electron-store first
    try {
      if (window.windyAPI?.getWizardState) {
        const state = await window.windyAPI.getWizardState();
        if (state?.completed) return false;
        this.step = state?.currentStep || 0;
      }
    } catch (e) { console.debug('[Wizard] Prior install check failed:', e.message); }
    // Also check localStorage fallback
    if (localStorage.getItem('windy_wizardComplete') === 'true') return false;
    // Skip for v0.5.0 upgraders — they already have settings configured
    if (localStorage.getItem('windy_engine')) return false;
    try {
      if (window.windyAPI?.getSettings) {
        const settings = await window.windyAPI.getSettings();
        if (settings?.model && settings.model !== 'base') return false;
      }
    } catch (e) { console.debug('[Wizard] Settings probe failed:', e.message); }
    return true;
  }

  async show() {
    const shouldShow = await this.shouldShow();
    if (!shouldShow) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'setupWizard';
    this.overlay.className = 'wizard-overlay';
    this.overlay.innerHTML = this._buildHTML();
    document.body.appendChild(this.overlay);
    this._bindEvents();
    this._showStep(this.step);
  }

  _buildHTML() {
    return `
      <div class="wizard-container wizard-v2">
        <div class="wizard-dots" id="wizardDots">
          ${Array.from({ length: this.totalSteps }, (_, i) =>
      `<div class="wizard-dot ${i === 0 ? 'active' : ''}" data-step="${i}"></div>`
    ).join('')}
        </div>
        <div class="wizard-slides" id="wizardSlides">

          <!-- Step 0: Welcome -->
          <div class="wizard-step" id="wizardStep0">
            <div class="wizard-emoji">🌪️</div>
            <h2 class="wizard-title">Welcome to Windy Pro</h2>
            <p class="wizard-desc">Record your voice, get polished text.<br>100% local. 100% private.</p>
            <ul class="wizard-features">
              <li>🎙️ Record your voice, get polished text instantly</li>
              <li>🔒 Privacy-first — everything stays on your device</li>
              <li>⚡ 15 transcription engines to choose from</li>
              <li>✨ AI cleanup for perfect punctuation & formatting</li>
              <li>🌍 99 languages supported</li>
            </ul>
            <button class="wizard-btn primary" data-action="next">Get Started →</button>
          </div>

          <!-- Step 1: Microphone -->
          <div class="wizard-step" id="wizardStep1" style="display:none">
            <div class="wizard-emoji">🎤</div>
            <h2 class="wizard-title">Test Your Microphone</h2>
            <p class="wizard-desc">Windy Pro needs microphone access to record your voice.</p>
            <div class="wiz-mic-area" id="wizMicArea">
              <button class="wizard-btn primary wiz-mic-test-btn" id="wizMicTestBtn">🎤 Test Microphone</button>
              <div class="wiz-mic-meter" id="wizMicMeter" style="display:none">
                <div class="wiz-mic-meter-bar" id="wizMicMeterBar"></div>
              </div>
              <div class="wiz-mic-status" id="wizMicStatus"></div>
            </div>
            <div class="wiz-mic-denied" id="wizMicDenied" style="display:none">
              <p class="wiz-mic-denied-msg">⚠️ Microphone access was denied.</p>
              <p class="wiz-mic-denied-help">To fix this:<br>
                • <strong>Linux:</strong> Check PulseAudio/PipeWire settings<br>
                • <strong>macOS:</strong> System Preferences → Privacy → Microphone<br>
                • <strong>Windows:</strong> Settings → Privacy → Microphone</p>
              <button class="wizard-btn secondary" id="wizMicRetry">Try Again</button>
            </div>
            <div class="wizard-nav">
              <button class="wizard-btn secondary" data-action="back">← Back</button>
              <button class="wizard-btn primary" data-action="next" id="wizMicNext" disabled>Next →</button>
            </div>
          </div>

          <!-- Step 2: Engine -->
          <div class="wizard-step" id="wizardStep2" style="display:none">
            <h2 class="wizard-title">Choose Your Engine</h2>
            <div class="wiz-hw-info" id="wizHwInfo">
              <div class="wiz-hw-loading">🔍 Detecting your hardware…</div>
            </div>
            <div class="wizard-engine-list" id="wizEngineList"></div>
            <div class="wizard-nav">
              <button class="wizard-btn secondary" data-action="back">← Back</button>
              <button class="wizard-btn primary" data-action="next">Next →</button>
            </div>
          </div>

          <!-- Step 3: Account -->
          <div class="wizard-step" id="wizardStep3" style="display:none">
            <div class="wizard-emoji">👤</div>
            <h2 class="wizard-title">Create Your Account</h2>
            <p class="wizard-desc">Optional — sync settings and unlock cloud-powered transcription.</p>
            <p class="wizard-desc" style="font-size:11px;color:#9CA3AF;margin-top:4px;">☁️ Monthly & Annual plans include Cloud STT. 🏠 Lifetime = local engines only (Own Your Stack).</p>
            <div class="wiz-account-form" id="wizAccountForm">
              <input type="text" class="wizard-input" id="wizAccName" placeholder="Your name">
              <input type="email" class="wizard-input" id="wizAccEmail" placeholder="Email address">
              <input type="password" class="wizard-input" id="wizAccPassword" placeholder="Password (min 8 chars)">
              <button class="wizard-btn primary" id="wizAccCreateBtn">Create Free Account</button>
              <div class="wiz-acc-status" id="wizAccStatus"></div>
            </div>
            <div class="wiz-account-divider">
              <span>or</span>
            </div>
            <button class="wizard-btn secondary wiz-skip-btn" id="wizAccSkipBtn">Skip — use offline only</button>
            <div class="wizard-nav" style="margin-top:12px;">
              <button class="wizard-btn secondary" data-action="back">← Back</button>
              <button class="wizard-btn primary" data-action="next" id="wizAccNext">Next →</button>
            </div>
          </div>

          <!-- Step 4: Plan -->
          <div class="wizard-step" id="wizardStep4" style="display:none">
            <h2 class="wizard-title">Choose Your Plan</h2>
            <p class="wizard-desc">Start free with local transcription — or unlock <strong>cloud-powered voice-to-text</strong> for blazing speed, zero CPU drain, and always-updated models.</p>
            <div class="wiz-plan-cards" id="wizPlanCards"></div>
            <div class="wiz-plan-coupon">
              <input type="text" class="wizard-input" id="wizCouponInput" placeholder="Have a coupon code?">
              <button class="wizard-btn secondary wiz-coupon-apply" id="wizCouponBtn">Apply</button>
            </div>
            <div class="wiz-coupon-result" id="wizCouponResult"></div>
            <div class="wiz-plan-status" id="wizPlanStatus"></div>
            <div class="wizard-nav">
              <button class="wizard-btn secondary" data-action="back">← Back</button>
              <button class="wizard-btn primary" data-action="next" id="wizPlanNext">Next →</button>
            </div>
          </div>

          <!-- Step 5: Pair Picker (Translation Pairs) -->
          <div class="wizard-step" id="wizardStep5" style="display:none">
            <div class="wizard-emoji">🌍</div>
            <h2 class="wizard-title">Translation Pairs</h2>
            <p class="wizard-desc">Download language pairs for offline translation.</p>
            <div class="wiz-pair-counter" id="wizPairCounter">0 pairs selected</div>
            <div class="wiz-pair-regions" id="wizPairRegions"></div>
            <div class="wiz-pair-selected" id="wizPairSelected"></div>
            <div class="wizard-nav">
              <button class="wizard-btn secondary" data-action="back">← Back</button>
              <button class="wizard-btn primary" data-action="next" id="wizPairNext">Next →</button>
            </div>
          </div>

          <!-- Step 6: All Set -->
          <div class="wizard-step" id="wizardStep6" style="display:none">
            <div class="wizard-emoji">🚀</div>
            <h2 class="wizard-title">You're All Set!</h2>
            <p class="wizard-desc">Press the shortcut below to start recording anywhere.</p>
            <div class="wiz-shortcuts">
              <div class="wiz-shortcut-row"><kbd>Ctrl+Shift+Space</kbd><span>Start / Stop recording</span></div>
              <div class="wiz-shortcut-row"><kbd>Ctrl+Shift+V</kbd><span>Paste transcript at cursor</span></div>
              <div class="wiz-shortcut-row"><kbd>Ctrl+Shift+W</kbd><span>Show / Hide window</span></div>
            </div>
            <div class="wiz-system-options" id="wizSystemOptions">
              <label class="wiz-checkbox-row">
                <input type="checkbox" id="wizAutostart" checked>
                <span>Launch Windy Pro on login</span>
              </label>
            </div>
            <button class="wizard-btn primary wiz-finish-btn" data-action="finish">Start Recording 🎤</button>
          </div>
        </div>
      </div>`;
  }

  _showStep(n) {
    if (n < 0 || n >= this.totalSteps) return;
    this.step = n;

    // Update slides
    for (let i = 0; i < this.totalSteps; i++) {
      const el = document.getElementById(`wizardStep${i}`);
      if (el) el.style.display = i === n ? 'flex' : 'none';
    }

    // Update dots
    const dots = this.overlay.querySelectorAll('.wizard-dot');
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === n);
      d.classList.toggle('completed', i < n);
    });

    // Save state
    this._saveState();

    // Step-specific init
    if (n === 2) this._initEngineStep();
    if (n === 4) this._initPlanStep();
    if (n === 5) this._initPairPickerStep();
  }

  async _saveState() {
    try {
      if (window.windyAPI?.setWizardState) {
        const completedSteps = [];
        for (let i = 0; i < this.step; i++) completedSteps.push(i);
        await window.windyAPI.setWizardState({
          currentStep: this.step,
          completedSteps
        });
      }
    } catch (e) { console.debug('[Wizard] State save error:', e.message); }
  }

  _bindEvents() {
    // Nav buttons
    this.overlay.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'next') this._showStep(this.step + 1);
        else if (action === 'back') this._showStep(this.step - 1);
        else if (action === 'finish') this._complete();
      });
    });

    // Step 1: Mic test
    const micTestBtn = this.overlay.querySelector('#wizMicTestBtn');
    const micRetry = this.overlay.querySelector('#wizMicRetry');
    if (micTestBtn) micTestBtn.addEventListener('click', () => this._testMicrophone());
    if (micRetry) micRetry.addEventListener('click', () => this._testMicrophone());

    // Step 3: Account
    const accCreate = this.overlay.querySelector('#wizAccCreateBtn');
    const accSkip = this.overlay.querySelector('#wizAccSkipBtn');
    if (accCreate) accCreate.addEventListener('click', () => this._createAccount());
    if (accSkip) accSkip.addEventListener('click', () => this._skipAccount());

    // Step 4: Coupon
    const couponBtn = this.overlay.querySelector('#wizCouponBtn');
    if (couponBtn) couponBtn.addEventListener('click', () => this._applyCoupon());
  }

  // ═══ Step 1: Microphone Test ═══

  async _testMicrophone() {
    const btn = this.overlay.querySelector('#wizMicTestBtn');
    const meter = this.overlay.querySelector('#wizMicMeter');
    const meterBar = this.overlay.querySelector('#wizMicMeterBar');
    const status = this.overlay.querySelector('#wizMicStatus');
    const denied = this.overlay.querySelector('#wizMicDenied');
    const nextBtn = this.overlay.querySelector('#wizMicNext');

    btn.style.display = 'none';
    denied.style.display = 'none';
    status.textContent = '⏳ Requesting microphone access…';
    status.className = 'wiz-mic-status';

    try {
      this._micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      meter.style.display = 'block';
      status.textContent = '🎤 Speak now — you should see the meter move!';
      status.classList.add('wiz-mic-ok');

      // Audio analyser
      this._micCtx = new AudioContext();
      const source = this._micCtx.createMediaStreamSource(this._micStream);
      const analyser = this._micCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let peakDetected = false;
      this._micInterval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const level = Math.min(avg / 80, 1);
        meterBar.style.width = `${level * 100}%`;

        if (level > 0.15 && !peakDetected) {
          peakDetected = true;
          status.textContent = '✅ Microphone is working! You\'re good to go.';
          nextBtn.disabled = false;
        }
      }, 50);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        denied.style.display = 'block';
        status.textContent = '';
      } else {
        status.textContent = `❌ ${err.message}`;
        status.classList.add('wiz-mic-error');
      }
      // Allow skipping even if mic fails
      nextBtn.disabled = false;
    }
  }

  _stopMicTest() {
    if (this._micInterval) { clearInterval(this._micInterval); this._micInterval = null; }
    if (this._micCtx) { try { this._micCtx.close(); } catch (e) { console.debug('[Wizard] Mic cleanup error:', e.message); } this._micCtx = null; }
    if (this._micStream) { this._micStream.getTracks().forEach(t => t.stop()); this._micStream = null; }
  }

  // ═══ Step 2: Engine Auto-Detection ═══

  async _initEngineStep() {
    const hwInfo = this.overlay.querySelector('#wizHwInfo');
    const engineList = this.overlay.querySelector('#wizEngineList');

    // Stop any running mic test
    this._stopMicTest();

    if (this._hardware) {
      // Already loaded
      return;
    }

    try {
      if (window.windyAPI?.detectHardware) {
        this._hardware = await window.windyAPI.detectHardware();
      } else {
        this._hardware = { totalRAM: 8, cpuCores: 4, recommendedEngine: 'windy-stt-core-cpu', recommendation: 'We recommend Windy STT Core (CPU) for your system.' };
      }
    } catch (_) {
      this._hardware = { totalRAM: 8, cpuCores: 4, recommendedEngine: 'windy-stt-core-cpu', recommendation: 'We recommend Windy STT Core (CPU) for your system.' };
    }

    const hw = this._hardware;

    // Hardware info card
    hwInfo.innerHTML = `
      <div class="wiz-hw-card">
        <div class="wiz-hw-row"><span>💻 CPU</span><strong>${hw.cpuCores} cores</strong></div>
        <div class="wiz-hw-row"><span>🧠 RAM</span><strong>${hw.totalRAM} GB</strong></div>
        ${hw.gpu ? `<div class="wiz-hw-row"><span>🎮 GPU</span><strong>${hw.gpu.name} (${Math.round(hw.gpu.vramMB / 1024)}GB)</strong></div>` : ''}
        ${hw.diskFreeGB ? `<div class="wiz-hw-row"><span>💾 Free Disk</span><strong>${hw.diskFreeGB} GB</strong></div>` : ''}
        <p class="wiz-hw-rec">💡 ${hw.recommendation}</p>
      </div>`;

    // Engine cards
    const engines = [
      { key: 'windy-stt-nano-cpu', icon: '🛡️', name: 'Windy STT Nano (CPU)', desc: '406 MB · Ultra-light', speed: '32×', quality: '★★☆☆☆' },
      { key: 'windy-stt-core-cpu', icon: '🛡️', name: 'Windy STT Core (CPU)', desc: '1.7 GB · Best CPU balance', speed: '6×', quality: '★★★★☆' },
      { key: 'windy-stt-nano', icon: '⚡', name: 'Windy STT Nano', desc: '73 MB · Fastest GPU', speed: '32×', quality: '★★☆☆☆', needsGPU: true },
      { key: 'windy-stt-core', icon: '⚡', name: 'Windy STT Core', desc: '462 MB · Recommended', speed: '6×', quality: '★★★★☆', needsGPU: true },
      { key: 'windy-stt-pro', icon: '⚡', name: 'Windy STT Pro', desc: '2.9 GB · BEST accuracy', speed: '1×', quality: '★★★★★', needsGPU: true },
    ];

    const recommended = hw.recommendedEngine || 'windy-stt-core-cpu';
    this.choices.engine = recommended;

    engineList.innerHTML = engines.map(e => {
      const isRec = e.key === recommended;
      const disabled = e.needsGPU && !hw.gpu;
      return `
        <div class="wizard-engine ${isRec ? 'selected' : ''} ${disabled ? 'wiz-engine-disabled' : ''}" 
             data-engine="${e.key}" ${disabled ? 'title="Requires NVIDIA GPU"' : ''}>
          <span class="engine-icon">${e.icon}</span>
          <div class="engine-info">
            <strong>${e.name} ${isRec ? '<span class="wiz-rec-badge">RECOMMENDED</span>' : ''}</strong>
            <span class="engine-tag">${e.desc} · ${e.speed} speed · ${e.quality}</span>
          </div>
          <span class="engine-check">✓</span>
        </div>`;
    }).join('');

    // Bind engine clicks
    engineList.querySelectorAll('.wizard-engine:not(.wiz-engine-disabled)').forEach(row => {
      row.addEventListener('click', () => {
        engineList.querySelectorAll('.wizard-engine').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        this.choices.engine = row.dataset.engine;
      });
    });
  }

  // ═══ Step 3: Account Creation ═══

  async _createAccount() {
    const name = this.overlay.querySelector('#wizAccName').value.trim();
    const email = this.overlay.querySelector('#wizAccEmail').value.trim();
    const password = this.overlay.querySelector('#wizAccPassword').value;
    const status = this.overlay.querySelector('#wizAccStatus');
    const btn = this.overlay.querySelector('#wizAccCreateBtn');

    if (!email || !password) {
      status.textContent = '⚠️ Email and password are required';
      status.className = 'wiz-acc-status wiz-acc-error';
      return;
    }
    // Validate email format
    if (typeof Validators !== 'undefined') {
      const ev = Validators.email(email);
      if (!ev.valid) {
        status.textContent = '⚠️ ' + ev.error;
        status.className = 'wiz-acc-status wiz-acc-error';
        return;
      }
    }
    if (name) {
      if (typeof Validators !== 'undefined') {
        const nv = Validators.displayName(name);
        if (!nv.valid) {
          status.textContent = '⚠️ ' + nv.error;
          status.className = 'wiz-acc-status wiz-acc-error';
          return;
        }
      }
    }
    if (password.length < 8) {
      status.textContent = '⚠️ Password must be at least 8 characters';
      status.className = 'wiz-acc-status wiz-acc-error';
      return;
    }
    if (password.length > 128) {
      status.textContent = '⚠️ Password is too long (max 128 characters)';
      status.className = 'wiz-acc-status wiz-acc-error';
      return;
    }

    btn.disabled = true;
    status.textContent = '⏳ Creating account…';
    status.className = 'wiz-acc-status';

    try {
      if (!window.windyAPI?.registerWizardAccount) throw new Error('Not available');
      const result = await window.windyAPI.registerWizardAccount({ email, password, name });
      if (result.ok) {
        this.choices.accountEmail = email;
        this.choices.accountSkipped = false;
        status.textContent = '✅ Account created! You can sign in from any device.';
        status.className = 'wiz-acc-status wiz-acc-ok';

        // Also save email to localStorage for settings panel
        // SEC-03: Do NOT store password in localStorage — it's plaintext and extractable
        localStorage.setItem('windy_cloudEmail', email);

        // Auto-advance after a moment
        setTimeout(() => this._showStep(this.step + 1), 1500);
      } else {
        status.textContent = `❌ ${result.error}`;
        status.className = 'wiz-acc-status wiz-acc-error';
      }
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
      status.className = 'wiz-acc-status wiz-acc-error';
    }
    btn.disabled = false;
  }

  _skipAccount() {
    this.choices.accountSkipped = true;
    this._showStep(this.step + 1);
  }

  // ═══ Step 4: Plan Selection ═══

  _initPlanStep() {
    const container = this.overlay.querySelector('#wizPlanCards');
    const plans = [
      { key: 'free', name: 'Free', price: '$0', period: 'forever', color: '#6B7280', icon: '🌱', features: ['English only', '2 engines', '5-min rec', '1 pair'], priceId: null },
      { key: 'pro', name: 'Windy Pro', price: '$4.99', period: '/month', color: '#22C55E', icon: '⚡', features: ['All engines', '99 languages', '30-min rec', '5 pairs'], priceId: 'price_1T5oYzBXIOBasDQibSlnIsPg' },
      { key: 'translate', name: 'Windy Ultra', price: '$8.99', period: '/month', color: '#3B82F6', icon: '🚀', features: ['Pro +', 'Translation', '30-min rec', '25 pairs'], priceId: 'price_1T5oZJBXIOBasDQiHO0MtYS7', recommended: true },
      { key: 'translate_pro', name: 'Windy Max', price: '$14.99', period: '/month', color: '#8B5CF6', icon: '👑', features: ['Ultra +', '60-min rec', '99 pairs', 'TTS + glossaries'], priceId: 'price_1T5oZ1BXIOBasDQinrz3VdvG' },
    ];

    this.choices.planTier = 'free';

    // Cloud STT persuasion block per tier
    const cloudSttSell = {
      free: `<div class="wiz-cloud-stt-box" style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(107,114,128,0.1);border:1px solid rgba(107,114,128,0.2);">
        <div style="font-size:11px;font-weight:700;color:#9CA3AF;margin-bottom:2px;">🏠 Local Transcription</div>
        <div style="font-size:10px;color:#6B7280;line-height:1.4;">Your voice never leaves your device. Powered by on-device AI engines. Private by default.</div>
      </div>`,
      paid: `<div class="wiz-cloud-stt-box" style="margin-top:8px;padding:8px 10px;border-radius:8px;background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(139,92,246,0.1));border:1px solid rgba(59,130,246,0.2);">
        <div style="font-size:11px;font-weight:700;color:#60A5FA;margin-bottom:2px;">☁️ Cloud Voice-to-Text — Supercharged</div>
        <div style="font-size:10px;color:#9CA3AF;line-height:1.4;">Monthly & Annual subscribers get GPU-powered cloud transcription via WindyCloud. <strong style="color:#F59E0B;">3-5x faster</strong> than local, always the latest models, zero CPU drain on your machine.</div>
        <div style="font-size:9px;color:#8B5CF6;margin-top:4px;font-weight:600;">🏠 Prefer to own it? Lifetime = local engines only. Your stack, your rules, forever.</div>
      </div>`
    };

    container.innerHTML = plans.map(p => `
      <div class="wiz-plan-card ${p.key === 'free' ? 'selected' : ''} ${p.recommended ? 'wiz-plan-recommended' : ''}" 
           data-plan="${p.key}" data-price="${p.priceId || ''}" style="--plan-color: ${p.color}">
        ${p.recommended ? '<span class="wiz-plan-rec-badge">RECOMMENDED</span>' : ''}
        <div class="wiz-plan-icon">${p.icon}</div>
        <div class="wiz-plan-name">${p.name}</div>
        <div class="wiz-plan-price" style="color:${p.color}">${p.price}</div>
        <div class="wiz-plan-period">${p.period}</div>
        <ul class="wiz-plan-features">${p.features.map(f => `<li>✓ ${f}</li>`).join('')}</ul>
        ${p.key === 'free' ? cloudSttSell.free : cloudSttSell.paid}
      </div>`).join('');

    container.querySelectorAll('.wiz-plan-card').forEach(card => {
      card.addEventListener('click', () => {
        container.querySelectorAll('.wiz-plan-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.choices.planTier = card.dataset.plan;
        this.choices.planPriceId = card.dataset.price;
      });
    });
  }

  async _applyCoupon() {
    const input = this.overlay.querySelector('#wizCouponInput');
    const result = this.overlay.querySelector('#wizCouponResult');
    const code = input.value.trim();
    if (!code) return;

    // Validate coupon format
    if (typeof Validators !== 'undefined') {
      const cv = Validators.couponCode(code);
      if (!cv.valid) {
        result.textContent = '⚠️ ' + cv.error;
        result.className = 'wiz-coupon-result coupon-invalid';
        return;
      }
    }

    result.textContent = '⏳ Checking…';
    try {
      if (!window.windyAPI?.applyCoupon) throw new Error('Not available');
      const res = await window.windyAPI.applyCoupon(code);
      result.textContent = res.valid
        ? `✅ ${res.discount.label} — will be applied at checkout!`
        : `❌ ${res.error || 'Invalid code'}`;
      result.className = `wiz-coupon-result ${res.valid ? 'coupon-valid' : 'coupon-invalid'}`;
    } catch (_) {
      result.textContent = '❌ Could not validate coupon';
      result.className = 'wiz-coupon-result coupon-invalid';
    }
  }

  // ═══ Step 5: Pair Picker ═══

  _initPairPickerStep() {
    const regionsEl = this.overlay.querySelector('#wizPairRegions');
    const selectedEl = this.overlay.querySelector('#wizPairSelected');
    if (!regionsEl) return;

    // For free users, show skip message
    if (this.choices.planTier === 'free') {
      regionsEl.innerHTML = `
        <div class="wiz-pair-free-msg">
          <p>📦 Translation pairs are available on paid plans.</p>
          <p class="wizard-desc">Upgrade anytime from Settings → Your Plan.</p>
        </div>`;
      selectedEl.innerHTML = '';
      this._wizSelectedPairs = [];
      this._updatePairCounter();
      return;
    }

    const regions = [
      { name: 'Europe', icon: '🇪🇺', pairs: ['en-es', 'en-fr', 'en-de', 'en-it', 'en-pt', 'en-nl', 'en-pl', 'en-ru', 'en-sv'] },
      { name: 'Asia', icon: '🌏', pairs: ['en-zh', 'en-ja', 'en-ko', 'en-hi', 'en-th', 'en-vi', 'en-id'] },
      { name: 'Middle East & Africa', icon: '🌍', pairs: ['en-ar', 'en-tr', 'en-he', 'en-fa'] },
      { name: 'Americas', icon: '🌎', pairs: ['en-pt', 'es-pt'] },
    ];

    this._wizSelectedPairs = this._wizSelectedPairs || [];

    const PAIR_LABELS = {
      'en-es': '🇺🇸↔🇪🇸 English ↔ Spanish', 'en-fr': '🇺🇸↔🇫🇷 English ↔ French',
      'en-de': '🇺🇸↔🇩🇪 English ↔ German', 'en-it': '🇺🇸↔🇮🇹 English ↔ Italian',
      'en-pt': '🇺🇸↔🇧🇷 English ↔ Portuguese', 'en-nl': '🇺🇸↔🇳🇱 English ↔ Dutch',
      'en-pl': '🇺🇸↔🇵🇱 English ↔ Polish', 'en-ru': '🇺🇸↔🇷🇺 English ↔ Russian',
      'en-sv': '🇺🇸↔🇸🇪 English ↔ Swedish', 'en-zh': '🇺🇸↔🇨🇳 English ↔ Chinese',
      'en-ja': '🇺🇸↔🇯🇵 English ↔ Japanese', 'en-ko': '🇺🇸↔🇰🇷 English ↔ Korean',
      'en-hi': '🇺🇸↔🇮🇳 English ↔ Hindi', 'en-th': '🇺🇸↔🇹🇭 English ↔ Thai',
      'en-vi': '🇺🇸↔🇻🇳 English ↔ Vietnamese', 'en-id': '🇺🇸↔🇮🇩 English ↔ Indonesian',
      'en-ar': '🇺🇸↔🇸🇦 English ↔ Arabic', 'en-tr': '🇺🇸↔🇹🇷 English ↔ Turkish',
      'en-he': '🇺🇸↔🇮🇱 English ↔ Hebrew', 'en-fa': '🇺🇸↔🇮🇷 English ↔ Persian',
      'es-pt': '🇪🇸↔🇧🇷 Spanish ↔ Portuguese',
    };

    regionsEl.innerHTML = regions.map(r => `
      <div class="wiz-pair-region">
        <div class="wiz-pair-region-header">
          <span>${r.icon} ${r.name}</span>
          <button class="wizard-btn secondary wiz-pair-region-select" data-pairs="${r.pairs.join(',')}" style="font-size:11px;padding:4px 10px;">Select All</button>
        </div>
        <div class="wiz-pair-list">
          ${r.pairs.map(p => `
            <label class="wiz-pair-item">
              <input type="checkbox" class="wiz-pair-cb" data-pair="${p}" ${this._wizSelectedPairs.includes(p) ? 'checked' : ''}>
              <span>${PAIR_LABELS[p] || p}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Bind checkbox changes
    regionsEl.querySelectorAll('.wiz-pair-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const pair = cb.dataset.pair;
        if (cb.checked && !this._wizSelectedPairs.includes(pair)) {
          this._wizSelectedPairs.push(pair);
        } else if (!cb.checked) {
          this._wizSelectedPairs = this._wizSelectedPairs.filter(p => p !== pair);
        }
        this._updatePairCounter();
      });
    });

    // Region quick-select
    regionsEl.querySelectorAll('.wiz-pair-region-select').forEach(btn => {
      btn.addEventListener('click', () => {
        const pairs = btn.dataset.pairs.split(',');
        pairs.forEach(p => {
          if (!this._wizSelectedPairs.includes(p)) this._wizSelectedPairs.push(p);
          const cb = regionsEl.querySelector(`.wiz-pair-cb[data-pair="${p}"]`);
          if (cb) cb.checked = true;
        });
        this._updatePairCounter();
      });
    });

    this._updatePairCounter();
  }

  _updatePairCounter() {
    const counter = this.overlay.querySelector('#wizPairCounter');
    const count = (this._wizSelectedPairs || []).length;
    if (counter) {
      counter.textContent = `${count} pair${count !== 1 ? 's' : ''} selected`;
      counter.style.color = count > 0 ? '#22C55E' : '#94A3B8';
    }
  }

  // ═══ Complete ═══

  async _complete() {
    // Save engine
    localStorage.setItem('windy_engine', this.choices.engine);
    localStorage.setItem('windy_recordingMode', this.choices.recordingMode);
    if (window.windyAPI?.updateSettings) {
      window.windyAPI.updateSettings({
        engine: this.choices.engine,
        recordingMode: this.choices.recordingMode
      });
    }

    // Handle plan selection — launch Stripe if paid
    if (this.choices.planTier !== 'free' && this.choices.planPriceId) {
      try {
        if (window.windyAPI?.createCheckoutSession) {
          const email = this.choices.accountEmail || localStorage.getItem('windy_cloudEmail') || '';
          const result = await window.windyAPI.createCheckoutSession(this.choices.planPriceId, email);
          if (result?.ok) {
            const link = document.createElement('a');
            link.href = result.url;
            link.target = '_blank';
            link.click();
          }
        }
      } catch (e) { console.debug('[Wizard] Checkout session error:', e.message); }
    }

    // Queue selected translation pairs for download
    if (this._wizSelectedPairs && this._wizSelectedPairs.length > 0) {
      try {
        localStorage.setItem('windy_pendingPairDownloads', JSON.stringify(this._wizSelectedPairs));
        if (window.windyAPI?.showDownloadWizard) {
          window.windyAPI.showDownloadWizard();
        }
      } catch (e) { console.debug('[Wizard] Pair queue error:', e.message); }
    }

    // Setup autostart
    const autostart = this.overlay.querySelector('#wizAutostart');
    if (autostart?.checked && window.windyAPI?.setupAutostart) {
      try { await window.windyAPI.setupAutostart(true); } catch (e) { console.debug('[Wizard] Autostart setup error:', e.message); }
    }

    // Stop mic test cleanup
    this._stopMicTest();

    // Mark complete
    localStorage.setItem('windy_wizardComplete', 'true');
    if (window.windyAPI?.setWizardState) {
      await window.windyAPI.setWizardState({ completed: true, currentStep: this.totalSteps - 1 });
    }

    // Animate out
    this.overlay.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
      if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    }, 300);
  }
}
