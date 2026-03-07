/**
 * Windy Pro - Settings Panel
 * Slide-in overlay for configuring transcription, hotkeys, and appearance.
 * DNA Strand: FEAT-065, FEAT-003
 */

class SettingsPanel {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('settingsPanel');
    this.isOpen = false;
    this._upgradePanel = null;
    this.init();
  }

  init() {
    // Create settings panel HTML and inject if not already in DOM
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'settingsPanel';
      this.panel.className = 'settings-panel';
      this.panel.innerHTML = this.buildHTML();
      document.querySelector('.window').appendChild(this.panel);
    }
    this.bindEvents();
    this.loadSettings();
  }

  buildHTML() {
    return `
      <div class="settings-header">
        <h2>⚙️ Settings</h2>
        <button class="settings-close" id="settingsClose">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-section settings-plan-section" id="settingsPlanSection">
          <h3>💎 Your Plan</h3>
          <div class="settings-plan-row">
            <div class="settings-tier-badge" id="settingsTierBadge">Free</div>
            <button class="settings-upgrade-btn" id="settingsUpgradeBtn">⚡ Upgrade</button>
          </div>
          <p class="settings-hint" id="settingsTierHint">Unlock more engines, languages, and recording time.</p>
        </div>

        <div class="settings-section">
          <h3>🧭 Simple Mode</h3>
          <div class="setting-row" title="ON: clear transcript after paste. OFF: keep it visible (lighter + italic) for scrollback.">
            <label for="clearOnPaste">Clear after paste</label>
            <input type="checkbox" id="clearOnPaste">
          </div>
          <p class="settings-hint">When off, pasted text stays visible but grayed out so you can scroll back.</p>
          <div class="setting-row">
            <label for="recordingModeSelect">Transcription Mode</label>
            <select id="recordingModeSelect">
              <option value="batch" selected>✨ Batch — record first, transcribe on stop</option>
              <option value="live">⚡ Live — see words as you speak</option>
              <option value="hybrid">🔄 Hybrid — live preview + final polish</option>
              <option value="clone_capture">🧬 Clone Capture — record only, no transcription</option>
            </select>
          </div>
          <p class="settings-hint" id="recordingModeHint">Records everything, transcribes on stop. Best accuracy. Works with any engine above.</p>
          <p class="settings-hint" style="font-size:11px; margin-top:4px;">💡 <b>Engine</b> = which AI model runs. <b>Mode</b> = when it transcribes (during or after recording).</p>
          <div class="setting-row" id="maxDurationRow">
            <label for="maxRecordingSelect">Max Recording</label>
            <select id="maxRecordingSelect">
              <option value="5">5 minutes</option>
              <option value="10" selected>10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
            </select>
          </div>
          <p class="settings-hint">Longer recordings = more context = better quality. Processing time increases with length.</p>
          <div class="setting-row" title="Save batch recordings for playback.">
            <label for="saveAudio">Save audio recordings</label>
            <input type="checkbox" id="saveAudio" checked>
          </div>
          <p class="settings-hint">Saves audio files locally after each recording. Re-listen anytime from History.</p>
          <div class="setting-row" title="Save transcript text to archive.">
            <label for="saveText">Save text recordings</label>
            <input type="checkbox" id="saveText" checked>
          </div>
          <p class="settings-hint">Saves transcript text to your archive. Uncheck for "Snapchat mode" — text pastes to cursor then disappears forever.</p>
          <div class="setting-row" title="Record video from your camera during voice sessions.">
            <label for="saveVideo">Save video recordings</label>
            <input type="checkbox" id="saveVideo">
          </div>
          <p class="settings-hint">Records your camera during sessions. Builds data for AI avatar creation. Opt-in only — camera never activates without your permission.</p>
          <div id="videoQualityRow" class="setting-row" style="display:none;" title="Video recording quality.">
            <label for="videoQuality">Video quality</label>
            <select id="videoQuality">
              <option value="480p">480p — smallest files (~350 MB/hr)</option>
              <option value="720p" selected>720p — balanced (~700 MB/hr)</option>
              <option value="1080p">1080p — high quality (~1.5 GB/hr)</option>
            </select>
          </div>
          <p id="cameraCapHint" class="settings-hint" style="display:none; font-size:11px;"></p>
          <div id="audioQualityRow" class="setting-row" title="Audio recording quality.">
            <label for="audioQuality">Audio quality</label>
            <select id="audioQuality">
              <option value="low">Low (32 kbps) — smallest files</option>
              <option value="standard" selected>Standard (128 kbps) — good quality</option>
              <option value="high">High (320 kbps) — near-lossless</option>
              <option value="lossless">Lossless (WAV) — voice clone grade</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3>📦 Archive & Storage</h3>
          <div class="setting-row">
            <label for="storageLocation">Storage</label>
            <select id="storageLocation">
              <option value="local" selected>💾 Local only — stays on this device</option>
              <option value="windy-cloud">☁️ Windy Cloud — encrypted, syncs when on Wi-Fi</option>
              <option value="both">🔄 Both — local + Windy Cloud backup</option>
            </select>
          </div>
          <p class="settings-hint" id="storageHint">Your data stays on this machine. Nothing uploaded anywhere. Maximum privacy.</p>
          <div class="setting-row" title="Where to save files on this device.">
            <label for="archiveFolder">Local folder</label>
            <div class="setting-inline">
              <input type="text" id="archiveFolder" placeholder="/home/user/Documents/WindyProArchive" style="width:160px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;font-size:11px;">
              <button id="browseArchive" class="settings-btn">Browse</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>🧬 Soul File — Your Digital Twin Data</h3>
          <p style="margin-bottom:10px; color:#E2E8F0; font-size:13px; line-height:1.5;">
            Every recording builds your Soul File — a high-fidelity dataset of your voice, vocabulary, and speech patterns.
            Over time, this becomes everything needed for a perfect voice clone or AI avatar twin.
            <b style="color:#F59E0B;">"Talk today. Live forever."</b>
          </p>
          <div id="soulFileStats" style="background:#1a1a2e; border-radius:10px; padding:14px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span style="color:#D1D5DB; font-size:12px;">Voice Data Collected</span>
              <span id="soulVoiceHours" style="color:#22C55E; font-weight:700; font-size:12px;">0 hours</span>
            </div>
            <div style="background:#334155; border-radius:4px; height:8px; margin-bottom:10px; overflow:hidden;">
              <div id="soulVoiceBar" style="background:linear-gradient(90deg, #22C55E, #3B82F6); height:100%; width:0%; border-radius:4px; transition:width 0.5s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span style="color:#D1D5DB; font-size:12px;">Video Data Collected</span>
              <span id="soulVideoHours" style="color:#A855F7; font-weight:700; font-size:12px;">0 hours</span>
            </div>
            <div style="background:#334155; border-radius:4px; height:8px; margin-bottom:10px; overflow:hidden;">
              <div id="soulVideoBar" style="background:linear-gradient(90deg, #A855F7, #EC4899); height:100%; width:0%; border-radius:4px; transition:width 0.5s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span style="color:#D1D5DB; font-size:12px;">Clone Quality Estimate</span>
              <span id="soulCloneGrade" style="color:#F59E0B; font-weight:700; font-size:12px;">Not enough data</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; margin-top:12px;">
              <span style="color:#D1D5DB; font-size:12px;">📝 Text Data Collected</span>
              <span id="soulTextWords" style="color:#60A5FA; font-weight:700; font-size:12px;">0 words</span>
            </div>
            <div style="background:#334155; border-radius:4px; height:8px; margin-bottom:10px; overflow:hidden;">
              <div id="soulTextBar" style="background:linear-gradient(90deg, #60A5FA, #38BDF8); height:100%; width:0%; border-radius:4px; transition:width 0.5s;"></div>
            </div>
            <div id="soulRequirements" style="margin-top:8px;">
              <span style="color:#6B7280;font-size:11px;">Loading progress…</span>
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button id="exportSoulFile" class="settings-btn" style="flex:1; background:#3B82F6; color:white; border:none; padding:10px; border-radius:8px; font-weight:700; cursor:pointer;">🧬 Export Soul File Package</button>
            <button id="exportVoiceClone" class="settings-btn" style="flex:1; background:#22C55E; color:#000; border:none; padding:10px; border-radius:8px; font-weight:700; cursor:pointer;">🎤 Export for Voice Cloning</button>
          </div>
          <p class="settings-hint" style="margin-top:6px;">Exports audio + transcripts in formats compatible with ElevenLabs, Coqui, Tortoise TTS, and other major voice cloning platforms.</p>
        </div>

        <div class="settings-section">
          <h3>🔌 Transcription Engine</h3>
          <div class="setting-row">
            <label for="engineSelect">Engine</label>
            <select id="engineSelect">
              <option value="windytune" selected>🌪️ WindyTune — auto-pilot, monitors & optimizes</option>
              <option value="local">🏠 Local — manual model selection</option>
              <option value="edge-spark">🛡️ Edge Spark (42 MB) — ultra-light, 32x speed</option>
              <option value="edge-pulse">🛡️ Edge Pulse (78 MB) — phone-friendly, 16x</option>
              <option value="edge-standard">🛡️ Edge Standard (168 MB) — best CPU balance, 6x</option>
              <option value="edge-global">🛡️ Edge Global (515 MB) — multilingual CPU, 2x</option>
              <option value="edge-pro">🛡️ Edge Pro (515 MB) — best English on CPU, 4x</option>
              <option value="core-spark">⚡ Core Spark (75 MB) — fastest GPU, 32x</option>
              <option value="core-pulse">⚡ Core Pulse (142 MB) — reliable GPU, 16x</option>
              <option value="core-standard">⚡ Core Standard (466 MB) — all-rounder, 6x</option>
              <option value="core-global">⚡ Core Global (1.5 GB) — multilingual GPU, 2x</option>
              <option value="core-pro">⚡ Core Pro (1.5 GB) — English excellence, 6x</option>
              <option value="core-turbo">⚡ Core Turbo (1.6 GB) — near-Ultra, 4x</option>
              <option value="core-ultra">⚡ Core Ultra (2.9 GB) — BEST accuracy, 1x</option>
              <option value="lingua-es">🌍 Lingua Español (500 MB) — Spanish specialist</option>
              <option value="lingua-fr">🌍 Lingua Français (500 MB) — French specialist</option>
              <option value="lingua-hi">🌍 Lingua हिन्दी (500 MB) — Hindi specialist</option>
            </select>
          </div>
          <p class="settings-hint" id="engineHint">Audio processed on your device. Nothing sent anywhere.</p>
          <div id="cloudSettings" style="display:none;">
            <div class="setting-row">
              <label for="cloudUrl">Cloud URL</label>
              <input type="text" id="cloudUrl" placeholder="wss://windypro.thewindstorm.uk" style="width:180px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;">
            </div>
            <div id="cloudAccountStatus" style="margin:8px 0;padding:6px 10px;border-radius:6px;font-size:12px;background:#1a2e1a;color:#22C55E;display:none;">✅ Signed in</div>
            <div id="cloudLoginForm">
              <div class="setting-row" style="margin-top:6px;">
                <label for="cloudEmail">Email</label>
                <input type="email" id="cloudEmail" placeholder="you@example.com" style="width:180px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;">
              </div>
              <div class="setting-row">
                <label for="cloudPassword">Password</label>
                <input type="password" id="cloudPassword" placeholder="••••••••" style="width:180px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;">
              </div>
              <div class="setting-row">
                <label for="cloudName" id="cloudNameLabel" style="display:none;">Name</label>
                <input type="text" id="cloudName" placeholder="Your Name" style="display:none;width:180px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;">
              </div>
              <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
                <button id="cloudSignInBtn" style="padding:6px 16px;background:#22C55E;color:#000;border:none;border-radius:4px;font-weight:600;cursor:pointer;">Sign In</button>
                <button id="cloudToggleRegister" style="padding:6px 12px;background:transparent;color:#4ecdc4;border:1px solid #333;border-radius:4px;font-size:11px;cursor:pointer;">Need an account?</button>
                <span id="cloudLoginStatus" style="font-size:11px;color:#888;"></span>
              </div>
            </div>
            <p class="settings-hint" style="color:#4ecdc4;">🔒 E2E encrypted. Zero data retention. Audio never stored.</p>
          </div>
        </div>

        <!-- Third-party API keys removed — Windy Pro uses proprietary engines only -->

        <div class="settings-section" id="localModelSection">
          <h3>🎤 Transcription</h3>
          <div id="transcriptionPlanBanner" style="background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid #333;border-radius:8px;padding:10px 12px;margin-bottom:10px;display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span id="transcriptionPlanLabel" style="font-size:12px;color:#D1D5DB;">Your Plan: <b style="color:#22C55E;">Free</b></span>
              <button id="transcriptionUpgradeBtn" class="settings-btn" style="font-size:11px;padding:4px 10px;background:#F59E0B;color:#000;border:none;border-radius:4px;font-weight:600;cursor:pointer;">⚡ Upgrade</button>
            </div>
            <p id="transcriptionPlanHint" style="font-size:11px;color:#9CA3AF;margin:4px 0 0;line-height:1.4;">Unlock more engines — see grayed-out options for what's available on higher plans.</p>
          </div>
          <div class="setting-row" id="modelSizeRow">
            <label for="modelSelect">Model Size</label>
            <select id="modelSelect">
              <option value="tiny" selected>Edge Spark (75MB — fastest, CPU ✅)</option>
              <option value="base">Edge Pulse (150MB — balanced, CPU ✅)</option>
              <option value="small">Core Standard (500MB — ⚠️ GPU recommended)</option>
              <option value="medium">Core Pro (1.5GB — ⚠️ GPU only)</option>
              <option value="large-v3">Core Ultra (3GB — ⚠️ GPU only)</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="deviceSelect">Device</label>
            <select id="deviceSelect">
              <option value="auto" selected>Auto (GPU if available)</option>
              <option value="cpu">CPU</option>
              <option value="cuda">NVIDIA GPU (CUDA)</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="languageSelect">Language</label>
            <select id="languageSelect">
              <option value="en" selected>English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="pt">Português</option>
              <option value="it">Italiano</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="ko">한국어</option>
              <option value="ar">العربية</option>
              <option value="hi">हिन्दी</option>
              <option value="ru">Русский</option>
              <option value="auto">Auto-detect</option>
            </select>
          </div>
          <div class="setting-row" title="Identify different speakers in the transcript. Available with Cloud and Windy Pro Stream engines.">
            <label for="diarizeEnabled">Identify speakers</label>
            <input type="checkbox" id="diarizeEnabled">
          </div>
          <p class="settings-hint">Labels speakers as Speaker 1, Speaker 2, etc. Cloud &amp; Stream engines only.</p>
        </div>
        
        <div class="settings-section">
          <h3>✨ Vibe Toggle</h3>
          <div class="setting-row">
            <label for="vibeEnabled">Clean-up Mode</label>
            <input type="checkbox" id="vibeEnabled">
          </div>
          <p class="settings-hint">Removes filler words, fixes grammar, adds punctuation</p>
        </div>
        
        <div class="settings-section">
          <h3>🎙️ Input Device</h3>
          <div class="setting-row">
            <label for="micSelect">Microphone</label>
            <select id="micSelect">
              <option value="default">System Default</option>
            </select>
          </div>
        </div>
        
        <!-- Old Archive section replaced by new Archive & Storage + Soul File sections above -->

        <div class="settings-section">
          <h3>⌨️ Keyboard Shortcuts</h3>
          <p class="settings-hint">Click any shortcut to rebind it. Press your new key combo.</p>
          <div class="hotkey-list">
            <div class="hotkey-item">
              <span class="hotkey-label">🎙️ Toggle Recording</span>
              <div class="shortcut-capture" id="shortcutToggle" tabindex="0" data-key="toggleRecording">Ctrl+Shift+Space</div>
            </div>
            <div class="hotkey-item">
              <span class="hotkey-label">📋 Paste Transcript</span>
              <div class="shortcut-capture" id="shortcutPaste" tabindex="0" data-key="pasteTranscript">Ctrl+Shift+V</div>
            </div>
            <div class="hotkey-item">
              <span class="hotkey-label">👁️ Show / Hide Window</span>
              <div class="shortcut-capture" id="shortcutShowHide" tabindex="0" data-key="showHide">Ctrl+Shift+W</div>
            </div>
            <div class="hotkey-item hotkey-readonly">
              <span class="hotkey-label">🔍 Zoom In / Out / Reset</span>
              <span class="hotkey-fixed">Ctrl + / −  ·  Ctrl+0</span>
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>🎨 Appearance</h3>
          <div class="setting-row">
            <label for="opacityRange">Window Opacity</label>
            <input type="range" id="opacityRange" min="50" max="100" value="95">
            <span id="opacityValue">95%</span>
          </div>
          <div class="setting-row">
            <label for="alwaysOnTop">Always on Top</label>
            <input type="checkbox" id="alwaysOnTop" checked>
          </div>
          <div class="setting-row">
            <label for="themeToggle">Theme</label>
            <select id="themeToggle">
              <option value="dark" selected>🌙 Dark</option>
              <option value="light">☀️ Light</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3>🌪️ Tornado Widget</h3>
          <div class="setting-row">
            <label for="tornadoSize">Tornado size</label>
            <input type="range" id="tornadoSize" min="32" max="128" step="8" value="56" style="flex:1;margin:0 8px;">
            <span id="tornadoSizeValue" style="min-width:36px;text-align:right;">56px</span>
          </div>
        </div>

        <div class="settings-section">
          <h3>📊 Analytics</h3>
          <div class="setting-row" title="Anonymous metrics: engine used, recording duration, batch vs live, language. Never transcript content.">
            <label for="analyticsEnabled">Help improve Windy Pro</label>
            <input type="checkbox" id="analyticsEnabled">
          </div>
          <p class="settings-hint">Sends anonymous usage stats (engine, duration, mode, language). Never transcript text.</p>
        </div>
        
        <div class="settings-section">
          <h3>ℹ️ About</h3>
          <p class="settings-about" id="aboutVersion">Windy Pro<br>Voice-to-text with the Green Strobe guarantee.</p>
          <button class="settings-btn" id="checkUpdatesBtn" style="margin-top:8px;">🔄 Check for Updates</button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Close button
    this.panel.querySelector('#settingsClose').addEventListener('click', () => this.close());

    // Upgrade button
    const upgradeBtn = this.panel.querySelector('#settingsUpgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        if (!this._upgradePanel) this._upgradePanel = new UpgradePanel(this.app);
        this._upgradePanel.toggle();
      });
    }

    // Engine selector — toggle cloud/local UI sections
    const engineSelect = this.panel.querySelector('#engineSelect');
    const cloudSettings = this.panel.querySelector('#cloudSettings');
    const localModelSection = this.panel.querySelector('#localModelSection');
    const engineHint = this.panel.querySelector('#engineHint');
    engineSelect.addEventListener('change', (e) => {
      const engine = e.target.value;
      this.saveSetting('engine', engine);
      this.app.transcriptionEngine = engine;
      // Show/hide relevant sections based on engine
      const apiKeySection = this.panel.querySelector('#apiKeySection');
      const engineInfo = {
        local: { hint: '🏠 <b>Manual mode.</b> Select your model below. Full control over which engine model runs.', color: '#22C55E', cloud: false, local: true, api: false },
        windytune: { hint: '🌪️ <b>Auto-pilot.</b> Monitors your performance in real-time. Auto-switches to the best model for your hardware. Logs every change to the status bar.', color: '#22C55E', cloud: false, local: true, api: false },
        cloud: { hint: '🔒 <b>E2E encrypted.</b> Streamed to WindyPro servers. Large-v3 on RTX 5090 GPU. Zero data retention.', color: '#4ecdc4', cloud: true, local: false, api: false },
        'edge-spark': { hint: '🛡️ <b>Ultra-light (42 MB).</b> Fits anything. Quick dictation, real-time captions.', color: '#22C55E', cloud: false, local: true, api: false },
        'edge-pulse': { hint: '🛡️ <b>Phone-optimized.</b> Fast & light. Mobile dictation, voice memos.', color: '#22C55E', cloud: false, local: true, api: false },
        'edge-standard': { hint: '🛡️ <b>Best size/accuracy balance.</b> Laptop users, everyday use.', color: '#22C55E', cloud: false, local: true, api: false },
        'edge-global': { hint: '🛡️ <b>Multilingual on CPU.</b> Great for travel & translation.', color: '#22C55E', cloud: false, local: true, api: false },
        'edge-pro': { hint: '🛡️ <b>Best English on CPU.</b> No GPU needed.', color: '#22C55E', cloud: false, local: true, api: false },
        'core-spark': { hint: '⚡ <b>Lightning fast GPU.</b> Quick dictation, embedded systems.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-pulse': { hint: '⚡ <b>Fast & reliable GPU.</b> Everyday dictation, emails.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-standard': { hint: '⚡ <b>The workhorse.</b> Meetings, technical dictation, content creation.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-global': { hint: '⚡ <b>Multilingual powerhouse.</b> Non-English, code-switching.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-pro': { hint: '⚡ <b>English excellence.</b> Distilled flagship at 6x speed.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-turbo': { hint: '⚡ <b>Near-Ultra at 2x speed.</b> Best balance of accuracy & speed.', color: '#F59E0B', cloud: false, local: true, api: false },
        'core-ultra': { hint: '⚡ <b>BEST accuracy. Period.</b> Broadcast, legal, medical, professional.', color: '#F59E0B', cloud: false, local: true, api: false },
        'lingua-es': { hint: '🌍 <b>Spanish specialist.</b> All dialects — Castilian, Mexican, Caribbean.', color: '#3B82F6', cloud: false, local: true, api: false },
        'lingua-fr': { hint: '🌍 <b>French specialist.</b> Metropolitan, Canadian, African dialects.', color: '#3B82F6', cloud: false, local: true, api: false },
        'lingua-hi': { hint: '🌍 <b>Hindi specialist.</b> Hindi-English code-switching.', color: '#3B82F6', cloud: false, local: true, api: false },
        cloud: { hint: '☁️ <b>WindyPro Cloud.</b> End-to-end encrypted. For when you want server-grade accuracy.', color: '#4ecdc4', cloud: true, local: false, api: false }
      };
      const info = engineInfo[engine] || engineInfo.local;
      engineHint.innerHTML = info.hint;
      engineHint.style.color = info.color;
      cloudSettings.style.display = info.cloud ? 'block' : 'none';
      localModelSection.style.display = info.local ? 'block' : 'none';
      // Hide Model Size row for named engines (they auto-map to a model)
      const modelSizeRow = this.panel.querySelector('#modelSizeRow');
      if (modelSizeRow) {
        const isNamedEngine = engine !== 'local' && engine !== 'cloud';
        modelSizeRow.style.display = (info.local && !isNamedEngine) ? '' : 'none';
      }
      if (apiKeySection) {
        apiKeySection.style.display = info.api ? 'block' : 'none';
        /* Legacy API key visibility removed — Windy Pro engines only */
        [].forEach(k => {
          const row = this.panel.querySelector('#apiKey_' + k + '_row');
          if (row) row.style.display = (k === info.api) ? 'block' : 'none';
        });
      }
      // Update badge with model size info
      if (this.app && this.app.updateModelBadge) {
        this.app.updateModelBadge(engine);
      } else {
        const badge = document.getElementById('modelBadge');
        if (badge) {
          const icons = { local: '🌪️', cloud: '☁️', 'edge-spark': '🛡️', 'edge-pulse': '🛡️', 'edge-standard': '🛡️', 'edge-global': '🛡️', 'edge-pro': '🛡️', 'core-spark': '⚡', 'core-pulse': '⚡', 'core-standard': '⚡', 'core-global': '⚡', 'core-pro': '⚡', 'core-turbo': '⚡', 'core-ultra': '⚡', 'lingua-es': '🌍', 'lingua-fr': '🌍', 'lingua-hi': '🌍' };
          badge.textContent = `${icons[engine] || '🌪️'} ${engine}`;
        }
      }
      // Auto-sync Model Size dropdown to match engine selection
      const modelMap = this.app?._engineModelMap;
      if (modelMap && engine in modelMap && modelMap[engine]) {
        const whisperModel = modelMap[engine];
        this.saveSetting('model', whisperModel);
        const modelSelect = this.panel.querySelector('#modelSelect');
        if (modelSelect) {
          // Find the option that starts with the model name
          for (const opt of modelSelect.options) {
            if (opt.value === whisperModel || opt.value.startsWith(whisperModel)) {
              modelSelect.value = opt.value;
              break;
            }
          }
        }
        // Also tell the Python server to switch models now
        if (this.app?.ws?.readyState === WebSocket.OPEN) {
          this.app.ws.send(JSON.stringify({ type: 'config', model: whisperModel }));
        }
      }
    });

    // Cloud URL change
    const cloudUrlInput = this.panel.querySelector('#cloudUrl');
    if (cloudUrlInput) {
      cloudUrlInput.addEventListener('change', (e) => {
        this.saveSetting('cloudUrl', e.target.value);
        this.app.cloudUrl = e.target.value;
      });
    }

    // Cloud Sign In / Register
    let isRegisterMode = false;
    const cloudSignInBtn = this.panel.querySelector('#cloudSignInBtn');
    const cloudToggleRegister = this.panel.querySelector('#cloudToggleRegister');
    const cloudLoginStatus = this.panel.querySelector('#cloudLoginStatus');
    const cloudNameInput = this.panel.querySelector('#cloudName');
    const cloudNameLabel = this.panel.querySelector('#cloudNameLabel');
    const cloudLoginForm = this.panel.querySelector('#cloudLoginForm');
    const cloudAccountStatus = this.panel.querySelector('#cloudAccountStatus');

    // Show/hide login form based on existing token (loaded in loadSettings)
    // Initial state: show login form, loadSettings will update if token exists

    if (cloudToggleRegister) {
      cloudToggleRegister.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        cloudNameInput.style.display = isRegisterMode ? '' : 'none';
        cloudNameLabel.style.display = isRegisterMode ? '' : 'none';
        cloudSignInBtn.textContent = isRegisterMode ? 'Create Account' : 'Sign In';
        cloudToggleRegister.textContent = isRegisterMode ? 'Have an account?' : 'Need an account?';
      });
    }

    if (cloudSignInBtn) {
      cloudSignInBtn.addEventListener('click', async () => {
        const cloudUrl = this.panel.querySelector('#cloudUrl').value || 'https://windypro.thewindstorm.uk';
        const email = this.panel.querySelector('#cloudEmail').value;
        const password = this.panel.querySelector('#cloudPassword').value;
        const name = this.panel.querySelector('#cloudName').value;

        if (!email || !password) {
          cloudLoginStatus.textContent = '⚠️ Enter email and password';
          cloudLoginStatus.style.color = '#EF4444';
          return;
        }

        // Convert wss:// URL to https:// for REST API calls
        const apiBase = cloudUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
        const endpoint = isRegisterMode ? '/api/v1/auth/register' : '/api/v1/auth/login';
        const body = isRegisterMode ? { email, password, name } : { email, password };

        cloudSignInBtn.disabled = true;
        cloudLoginStatus.textContent = '⏳ Connecting...';
        cloudLoginStatus.style.color = '#888';

        // Always store credentials on app for WS auth (bypasses CORS)
        this.app.cloudEmail = email;
        this.app.cloudPassword = password;
        this.saveSetting('cloudEmail', email);
        this.saveSetting('cloudPassword', password);

        try {
          const res = await fetch(apiBase + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.detail || data.error || 'Login failed');
          }

          // Success — store token
          this.app.cloudToken = data.token;
          this.saveSetting('cloudToken', data.token);
          this.saveSetting('cloudUser', data.user?.email || email);

          // Sync with WindySync (H4)
          if (this.app.cloudSync) {
            this.app.cloudSync.token = data.token;
            this.app.cloudSync.refreshToken = data.refreshToken || null;
            this.app.cloudSync.user = data.user;
            this.app.cloudSync.baseUrl = apiBase;
            this.app.cloudSync._saveCredentials();
            localStorage.setItem('windy_cloud_api_url', apiBase);
          }

          cloudLoginForm.style.display = 'none';
          cloudAccountStatus.style.display = 'block';
          cloudAccountStatus.textContent = `✅ Signed in as ${data.user?.email || email}`;
          this.showToast('☁️ Cloud account connected!');
        } catch (err) {
          // REST failed (CORS) — but credentials stored for WS auth
          cloudLoginForm.style.display = 'none';
          cloudAccountStatus.style.display = 'block';
          cloudAccountStatus.textContent = `✅ Credentials saved (will auth over WebSocket)`;
          this.saveSetting('cloudUser', email);
          this.showToast('☁️ Credentials saved! Cloud auth will happen on first recording.');
        } finally {
          cloudSignInBtn.disabled = false;
        }
      });
    }

    // Cloud sign out (click status to sign out)
    if (cloudAccountStatus) {
      cloudAccountStatus.addEventListener('click', () => {
        this.app.cloudToken = null;
        this.saveSetting('cloudToken', '');
        this.saveSetting('cloudUser', '');
        cloudLoginForm.style.display = '';
        cloudAccountStatus.style.display = 'none';
        this.showToast('Signed out of cloud account');
      });
      cloudAccountStatus.style.cursor = 'pointer';
      cloudAccountStatus.title = 'Click to sign out';
    }

    // Model info for confirmation dialog
    const MODEL_INFO = {
      tiny: { size: '75 MB', ram: '~150 MB', time: '2-5s', cpu: 'Excellent', quality: '★★☆☆☆' },
      base: { size: '150 MB', ram: '~300 MB', time: '5-15s', cpu: 'Good', quality: '★★★☆☆' },
      small: { size: '500 MB', ram: '~1 GB', time: '30-60s', cpu: 'Slow', quality: '★★★★☆' },
      medium: { size: '1.5 GB', ram: '~3 GB', time: '2-5 min', cpu: 'Very Slow', quality: '★★★★☆' },
      'large-v3': { size: '3 GB', ram: '~6 GB', time: '5-15 min', cpu: 'Unusable', quality: '★★★★★' }
    };

    // Model change — with confirmation dialog
    const modelSelect = this.panel.querySelector('#modelSelect');
    modelSelect.addEventListener('change', (e) => {
      const newModel = e.target.value;
      const info = MODEL_INFO[newModel] || {};
      const currentModel = this._currentModel || 'tiny';

      // Show confirmation for any model change
      const needsGpu = ['small', 'medium', 'large-v3'].includes(newModel);
      const gpuWarn = needsGpu
        ? `\n⚠️ CPU Performance: ${info.cpu} — GPU recommended for real-time use.`
        : `\n✅ CPU Performance: ${info.cpu}`;

      const confirmed = confirm(
        `Switch model: ${currentModel} → ${newModel}\n\n` +
        `📦 Download: ${info.size} (first time only)\n` +
        `💾 RAM needed: ${info.ram}\n` +
        `⏱️ Load time: ${info.time}\n` +
        `🎯 Quality: ${info.quality}` +
        gpuWarn +
        `\n\nProceed?`
      );

      if (!confirmed) {
        // Reset dropdown to current model
        modelSelect.value = currentModel;
        return;
      }

      this.saveSetting('model', newModel);
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
        modelSelect.disabled = true;

        // Start elapsed timer in badge
        const badge = document.getElementById('modelBadge');
        let elapsed = 0;
        const timerInterval = setInterval(() => {
          elapsed++;
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          if (badge) badge.textContent = `🧠 Loading ${newModel}... ${timeStr}`;
          this.showToast(`Loading ${newModel} model... (${timeStr})`);
        }, 1000);
        if (badge) {
          badge.textContent = `🧠 Loading ${newModel}...`;
          badge.classList.add('loading');
        }

        this.app.ws.send(JSON.stringify({
          action: 'config',
          config: { model: newModel }
        }));

        // Listen for ack response
        const handler = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ack' && msg.action === 'config') {
              clearInterval(timerInterval);
              modelSelect.disabled = false;
              this._currentModel = newModel;
              if (msg.applied?.model_reloaded) {
                this.showToast(`${newModel} model loaded ✅`);
                if (badge) {
                  badge.textContent = `🧠 ${newModel}`;
                  badge.classList.remove('loading');
                }
              } else if (msg.applied?.model_error) {
                this.showToast(`Failed: ${msg.applied.model_error}`);
                modelSelect.value = currentModel;
                if (badge) {
                  badge.textContent = `🧠 ${currentModel}`;
                  badge.classList.remove('loading');
                }
              } else if (msg.applied?.model_note) {
                this.showToast(msg.applied.model_note);
              }
              this.app.ws.removeEventListener('message', handler);
            }
          } catch (_) { }
        };
        this.app.ws.addEventListener('message', handler);
        // Extended timeout for large models (10 min)
        setTimeout(() => {
          clearInterval(timerInterval);
          modelSelect.disabled = false;
          if (badge) badge.classList.remove('loading');
        }, 600000);
      }
    });

    // Video recording toggle
    const saveVideoEl = this.panel.querySelector('#saveVideo');
    const videoQualityRow = this.panel.querySelector('#videoQualityRow');
    const cameraCapHint = this.panel.querySelector('#cameraCapHint');
    if (saveVideoEl) {
      saveVideoEl.addEventListener('change', (e) => {
        this.saveSetting('saveVideo', e.target.checked);
        if (videoQualityRow) videoQualityRow.style.display = e.target.checked ? 'flex' : 'none';
        if (cameraCapHint) cameraCapHint.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) this._probeCameraResolution();
      });
    }

    // Video quality
    const videoQualityEl = this.panel.querySelector('#videoQuality');
    if (videoQualityEl) {
      videoQualityEl.addEventListener('change', (e) => {
        this.saveSetting('videoQuality', e.target.value);
        this._probeCameraResolution();
      });
    }

    // Audio quality
    const audioQualityEl = this.panel.querySelector('#audioQuality');
    if (audioQualityEl) {
      audioQualityEl.addEventListener('change', (e) => {
        this.saveSetting('audioQuality', e.target.value);
      });
    }

    // Storage location
    const storageEl = this.panel.querySelector('#storageLocation');
    if (storageEl) {
      storageEl.addEventListener('change', (e) => {
        this.saveSetting('storageLocation', e.target.value);
        const hint = this.panel.querySelector('#storageHint');
        const hints = {
          local: 'Your data stays on this machine. Nothing uploaded anywhere. Maximum privacy.',
          'windy-cloud': 'Files sync to Windy Cloud when connected to Wi-Fi. End-to-end encrypted — we can\'t read your data.',
          both: 'Saved locally first, then backed up to Windy Cloud over Wi-Fi. Best of both worlds.'
        };
        if (hint) hint.textContent = hints[e.target.value] || hints.local;
      });
    }

    // Soul File export buttons
    const exportSoulBtn = this.panel.querySelector('#exportSoulFile');
    if (exportSoulBtn) {
      exportSoulBtn.addEventListener('click', async () => {
        this.showToast('📦 Exporting Soul File package...');
        if (window.windyAPI?.exportSoulFile) {
          const result = await window.windyAPI.exportSoulFile();
          this.showToast(result?.ok ? `✅ Soul File exported to ${result.path}` : '❌ Export failed — no recordings found');
        } else {
          this.showToast('Soul File export will be available in the next update');
        }
      });
    }

    const exportCloneBtn = this.panel.querySelector('#exportVoiceClone');
    if (exportCloneBtn) {
      exportCloneBtn.addEventListener('click', async () => {
        this.showToast('🎤 Exporting voice clone package...');
        if (window.windyAPI?.exportVoiceClone) {
          const result = await window.windyAPI.exportVoiceClone();
          this.showToast(result?.ok ? `✅ Voice clone data exported to ${result.path}` : '❌ Export failed — no audio recordings found');
        } else {
          this.showToast('Voice clone export will be available in the next update');
        }
      });
    }

    // Device change (T18: propagate to server — triggers model reload)
    const deviceSelect = this.panel.querySelector('#deviceSelect');
    deviceSelect.addEventListener('change', (e) => {
      this.saveSetting('device', e.target.value);
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
        this.showToast('Device changed — will reload model on next recording');
        this.app.ws.send(JSON.stringify({
          action: 'config',
          config: { device: e.target.value }
        }));
      }
    });

    // Vibe toggle (T17)
    this.panel.querySelector('#vibeEnabled').addEventListener('change', (e) => {
      this.saveSetting('vibeEnabled', e.target.checked);
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
        this.app.ws.send(JSON.stringify({
          action: 'config',
          config: { vibe_enabled: e.target.checked }
        }));
      }
    });

    // Clear on paste toggle
    this.panel.querySelector('#clearOnPaste').addEventListener('change', (e) => {
      this.saveSetting('clearOnPaste', e.target.checked);
    });

    // Live preview toggle
    /* livePreview checkbox removed — merged into recordingMode */

    // Recording mode (batch / live)
    const recordingModeSelect = this.panel.querySelector('#recordingModeSelect');
    if (recordingModeSelect) {
      recordingModeSelect.addEventListener('change', (e) => {
        this.saveSetting('recordingMode', e.target.value);
        // Also save livePreview equivalent for backward compat
        this.saveSetting('livePreview', e.target.value === 'live' || e.target.value === 'hybrid');
        const hint = this.panel.querySelector('#recordingModeHint');
        const maxRow = this.panel.querySelector('#maxDurationRow');
        const hints = {
          batch: 'Records everything, transcribes on stop. Green strobe only. Best accuracy. Great for meetings, dictation, and long sessions.',
          live: 'Words appear as you speak in real-time. Slightly lower accuracy (~5%). Great for live captions, presentations, and quick notes.',
          hybrid: 'Shows approximate words while recording, then replaces with polished batch result on stop. Best of both worlds — minor accuracy impact (~2%).',
          clone_capture: '🧬 Records audio + video for digital twin archives. No transcription model loaded — near-zero CPU. Perfect for all-day recording at your desk. Archives are processed later with higher-quality models.'
        };
        if (hint) hint.textContent = hints[e.target.value] || hints.batch;
        // Hide max duration for clone_capture (unlimited) and live (streaming)
        if (maxRow) maxRow.style.display = (e.target.value === 'live' || e.target.value === 'clone_capture') ? 'none' : 'flex';
      });
    }

    // Max recording duration
    const maxRecordingSelect = this.panel.querySelector('#maxRecordingSelect');
    if (maxRecordingSelect) {
      maxRecordingSelect.addEventListener('change', (e) => {
        this.saveSetting('maxRecordingMin', e.target.value);
      });
    }

    // Save audio recordings toggle
    const saveAudioEl = this.panel.querySelector('#saveAudio');
    if (saveAudioEl) {
      saveAudioEl.addEventListener('change', (e) => {
        localStorage.setItem('windy_saveAudio', e.target.checked ? 'true' : 'false');
      });
    }

    // Save text recordings toggle
    const saveTextEl = this.panel.querySelector('#saveText');
    if (saveTextEl) {
      saveTextEl.addEventListener('change', (e) => {
        localStorage.setItem('windy_saveText', e.target.checked ? 'true' : 'false');
      });
    }

    // Keyboard shortcut capture
    this.panel.querySelectorAll('.shortcut-capture').forEach(el => {
      el.addEventListener('focus', () => {
        el.classList.add('capturing');
        el.textContent = 'Press keys...';
      });
      el.addEventListener('blur', () => {
        el.classList.remove('capturing');
        // Restore current value if nothing was set
        if (el.textContent === 'Press keys...') {
          this._restoreShortcutDisplay(el);
        }
      });
      el.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Build Electron-compatible accelerator string
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        // Get the actual key (not modifier-only)
        const key = e.key;
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
          if (key === ' ') parts.push('Space');
          else if (key.length === 1) parts.push(key.toUpperCase());
          else parts.push(key);

          const accelerator = parts.join('+');
          const settingKey = el.dataset.key;
          const displayStr = accelerator.replace('CommandOrControl', 'Ctrl');

          // Block reserved system shortcuts that should never be hijacked
          const reserved = [
            'CommandOrControl+V', 'CommandOrControl+C', 'CommandOrControl+X',
            'CommandOrControl+Z', 'CommandOrControl+A', 'CommandOrControl+S',
            'CommandOrControl+F', 'CommandOrControl+P', 'CommandOrControl+N',
            'CommandOrControl+W', 'CommandOrControl+T', 'CommandOrControl+Q',
            'Alt+F4'
          ];
          if (reserved.includes(accelerator)) {
            this.showToast(`⛔ ${displayStr} is a system shortcut and can't be used. Use Ctrl+Shift+key instead.`);
            el.classList.remove('capturing');
            el.blur();
            this._restoreShortcutDisplay(el);
            return;
          }

          el.textContent = displayStr;
          el.classList.remove('capturing');
          el.blur();
          this.saveSetting(settingKey, accelerator);

          // Tell main process to actually re-register the global shortcut
          if (window.windyAPI?.rebindHotkey) {
            window.windyAPI.rebindHotkey(settingKey, accelerator).then(result => {
              if (result?.ok) {
                this.showToast(`✅ ${displayStr} bound successfully`);
              } else {
                this.showToast(`⚠️ Failed to bind ${displayStr}: ${result?.error || 'unknown'}`);
              }
            });
          }
        }
      });
    });

    // Archive folder browse
    const browseArchiveBtn = this.panel.querySelector('#browseArchive');
    if (browseArchiveBtn) {
      browseArchiveBtn.addEventListener('click', async () => {
        if (!window.windyAPI?.chooseArchiveFolder) return;
        const result = await window.windyAPI.chooseArchiveFolder();
        if (!result?.canceled && result?.path) {
          this.panel.querySelector('#archiveFolder').value = result.path;
          this.saveSetting('archiveFolder', result.path);
        }
      });
    }

    // Mic device selector (T20)
    this.panel.querySelector('#micSelect').addEventListener('change', (e) => {
      this.saveSetting('micDeviceId', e.target.value);
    });

    // Language change
    this.panel.querySelector('#languageSelect').addEventListener('change', (e) => {
      this.saveSetting('language', e.target.value);
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
        this.app.ws.send(JSON.stringify({
          action: 'config',
          config: { language: e.target.value }
        }));
      }
    });

    // Diarization toggle
    const diarizeEl = this.panel.querySelector('#diarizeEnabled');
    if (diarizeEl) {
      diarizeEl.addEventListener('change', (e) => {
        this.saveSetting('diarize', e.target.checked);
        localStorage.setItem('windy_diarize', e.target.checked ? 'true' : 'false');
      });
    }

    // Tornado size slider
    const tornadoRange = this.panel.querySelector('#tornadoSize');
    const tornadoValue = this.panel.querySelector('#tornadoSizeValue');
    if (tornadoRange && tornadoValue) {
      tornadoRange.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        tornadoValue.textContent = size + 'px';
        localStorage.setItem('windy_tornadoSize', size);
        this.saveSetting('tornadoSize', size);
        if (window.windyAPI?.updateTornadoSize) {
          window.windyAPI.updateTornadoSize(size);
        }
      });
    }

    // Analytics toggle
    const analyticsEl = this.panel.querySelector('#analyticsEnabled');
    if (analyticsEl) {
      analyticsEl.addEventListener('change', (e) => {
        localStorage.setItem('windy_analytics', e.target.checked ? 'true' : 'false');
        this.saveSetting('analyticsEnabled', e.target.checked);
      });
    }

    // Check for updates button
    const checkUpdBtn = this.panel.querySelector('#checkUpdatesBtn');
    if (checkUpdBtn) {
      checkUpdBtn.addEventListener('click', async () => {
        checkUpdBtn.textContent = '⏳ Checking...';
        checkUpdBtn.disabled = true;
        try {
          if (window.windyAPI?.checkForUpdates) {
            await window.windyAPI.checkForUpdates();
          }
        } catch (_) { }
        setTimeout(() => {
          checkUpdBtn.textContent = '🔄 Check for Updates';
          checkUpdBtn.disabled = false;
        }, 3000);
      });
    }

    // Opacity slider
    const opacityRange = this.panel.querySelector('#opacityRange');
    const opacityValue = this.panel.querySelector('#opacityValue');
    opacityRange.addEventListener('input', (e) => {
      const opacity = e.target.value;
      opacityValue.textContent = `${opacity}%`;
      document.querySelector('.window').style.opacity = opacity / 100;
      this.saveSetting('opacity', parseInt(opacity));
    });

    // Always on top
    this.panel.querySelector('#alwaysOnTop').addEventListener('change', (e) => {
      this.saveSetting('alwaysOnTop', e.target.checked);
      if (window.windyAPI) {
        window.windyAPI.updateSettings({ alwaysOnTop: e.target.checked });
      }
    });

    // Theme toggle (Light / Dark)
    const themeToggle = this.panel.querySelector('#themeToggle');
    if (themeToggle) {
      // Restore saved theme
      const savedTheme = localStorage.getItem('windy_theme') || 'dark';
      themeToggle.value = savedTheme;
      document.body.classList.toggle('light-theme', savedTheme === 'light');

      themeToggle.addEventListener('change', (e) => {
        const theme = e.target.value;
        localStorage.setItem('windy_theme', theme);
        document.body.classList.toggle('light-theme', theme === 'light');
      });
    }
  }

  async loadSettings() {
    if (!window.windyAPI) return;

    try {
      const settings = await window.windyAPI.getSettings();
      if (settings) {
        // Engine selector
        if (settings.engine) {
          this.panel.querySelector('#engineSelect').value = settings.engine;
          this.app.transcriptionEngine = settings.engine;
          this.panel.querySelector('#engineSelect').dispatchEvent(new Event('change'));
        }
        if (settings.cloudUrl) {
          this.panel.querySelector('#cloudUrl').value = settings.cloudUrl;
          this.app.cloudUrl = settings.cloudUrl;
        }
        /* Third-party API key restore removed */
        // Restore cloud login state
        if (settings.cloudToken) {
          this.app.cloudToken = settings.cloudToken;
          const loginForm = this.panel.querySelector('#cloudLoginForm');
          const accountStatus = this.panel.querySelector('#cloudAccountStatus');
          if (loginForm) loginForm.style.display = 'none';
          if (accountStatus) {
            accountStatus.style.display = 'block';
            accountStatus.textContent = `✅ Signed in as ${settings.cloudUser || 'user'}`;
          }
        }
        // Restore email/password for WS-based auth
        if (settings.cloudEmail) this.app.cloudEmail = settings.cloudEmail;
        if (settings.cloudPassword) this.app.cloudPassword = settings.cloudPassword;
        if (settings.model) this.panel.querySelector('#modelSelect').value = settings.model;
        if (settings.device) this.panel.querySelector('#deviceSelect').value = settings.device;
        if (settings.language) this.panel.querySelector('#languageSelect').value = settings.language;
        if (settings.opacity) {
          this.panel.querySelector('#opacityRange').value = settings.opacity;
          this.panel.querySelector('#opacityValue').textContent = `${settings.opacity}%`;
        }
        if (settings.alwaysOnTop !== undefined) {
          this.panel.querySelector('#alwaysOnTop').checked = settings.alwaysOnTop;
        }
        if (settings.vibeEnabled !== undefined) {
          this.panel.querySelector('#vibeEnabled').checked = settings.vibeEnabled;
        }
        if (settings.diarize !== undefined) {
          const dEl = this.panel.querySelector('#diarizeEnabled');
          if (dEl) dEl.checked = settings.diarize;
        }
        if (settings.clearOnPaste !== undefined) {
          this.panel.querySelector('#clearOnPaste').checked = settings.clearOnPaste;
        }
        /* livePreview restore handled via recordingMode */
        this.app.livePreview = settings.recordingMode === 'live' || settings.recordingMode === 'hybrid';
        // Recording mode restore
        if (settings.recordingMode) {
          const modeSelect = this.panel.querySelector('#recordingModeSelect');
          if (modeSelect) {
            modeSelect.value = settings.recordingMode;
            modeSelect.dispatchEvent(new Event('change'));
          }
        }
        if (settings.maxRecordingMin) {
          const maxSelect = this.panel.querySelector('#maxRecordingSelect');
          if (maxSelect) maxSelect.value = settings.maxRecordingMin;
        }
        // Restore tornado size
        if (settings.tornadoSize !== undefined) {
          const tornadoRange = this.panel.querySelector('#tornadoSize');
          const tornadoValue = this.panel.querySelector('#tornadoSizeValue');
          if (tornadoRange && tornadoValue) {
            tornadoRange.value = settings.tornadoSize;
            tornadoValue.textContent = settings.tornadoSize + 'px';
          }
        }
        // Restore custom hotkeys
        if (settings.hotkeys) {
          const map = { toggleRecording: '#shortcutToggle', pasteTranscript: '#shortcutPaste', showHide: '#shortcutShowHide' };
          for (const [key, selector] of Object.entries(map)) {
            const el = this.panel.querySelector(selector);
            if (el && settings.hotkeys[key]) {
              el.textContent = settings.hotkeys[key].replace('CommandOrControl', 'Ctrl');
            }
          }
        }
        const archiveFolderEl = this.panel.querySelector('#archiveFolder');
        if (archiveFolderEl) archiveFolderEl.value = settings.archiveFolder || '';
        const saveVideoEl2 = this.panel.querySelector('#saveVideo');
        if (saveVideoEl2) saveVideoEl2.checked = !!settings.saveVideo;
        if (saveVideoEl2?.checked) {
          const vqr = this.panel.querySelector('#videoQualityRow'); if (vqr) vqr.style.display = 'flex';
          const camHint = this.panel.querySelector('#cameraCapHint'); if (camHint) camHint.style.display = 'block';
          this._probeCameraResolution();
        }
        const videoQualityEl2 = this.panel.querySelector('#videoQuality');
        if (videoQualityEl2 && settings.videoQuality) videoQualityEl2.value = settings.videoQuality;
        const audioQualityEl2 = this.panel.querySelector('#audioQuality');
        if (audioQualityEl2 && settings.audioQuality) audioQualityEl2.value = settings.audioQuality;
        const storageEl2 = this.panel.querySelector('#storageLocation');
        if (storageEl2 && settings.storageLocation) storageEl2.value = settings.storageLocation;
        /* Dropbox/Google restore removed — Windy Storage only */
        // Update Soul File stats from archive data
        this.updateSoulFileStats();

        // Load current tier
        this._loadTierBadge();
      }
    } catch (e) {
      // Settings not available yet, use defaults
    }

    // Populate version from package.json
    if (window.windyAPI?.getAppVersion) {
      window.windyAPI.getAppVersion().then(v => {
        const el = this.panel.querySelector('#aboutVersion');
        if (el) el.innerHTML = `Windy Pro v${v}<br>Voice-to-text with the Green Strobe guarantee.`;
      }).catch(() => { });
    }

    // Enumerate audio input devices (T20)
    this.populateMicDevices();
  }

  async populateMicDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      const select = this.panel.querySelector('#micSelect');
      select.innerHTML = '<option value="default">System Default</option>';
      mics.forEach(mic => {
        const opt = document.createElement('option');
        opt.value = mic.deviceId;
        opt.textContent = mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`;
        select.appendChild(opt);
      });
      // Restore saved selection
      if (window.windyAPI) {
        const settings = await window.windyAPI.getSettings();
        if (settings && settings.micDeviceId) {
          select.value = settings.micDeviceId;
        }
      }
    } catch (e) {
      // Devices not available until mic permission granted
    }
  }

  async updateSoulFileStats() {
    try {
      // Get recording count and estimate hours from history
      const stats = window.windyAPI?.getArchiveStats ? await window.windyAPI.getArchiveStats() : null;
      const voiceHours = stats?.audioHours || 0;
      const videoHours = stats?.videoHours || 0;
      const totalWords = stats?.totalWords || 0;
      const totalSessions = stats?.totalSessions || 0;

      const voiceEl = this.panel.querySelector('#soulVoiceHours');
      const videoEl = this.panel.querySelector('#soulVideoHours');
      const voiceBar = this.panel.querySelector('#soulVoiceBar');
      const videoBar = this.panel.querySelector('#soulVideoBar');
      const gradeEl = this.panel.querySelector('#soulCloneGrade');
      const textEl = this.panel.querySelector('#soulTextWords');
      const textBar = this.panel.querySelector('#soulTextBar');

      if (voiceEl) voiceEl.textContent = voiceHours < 1 ? `${Math.round(voiceHours * 60)} minutes` : `${voiceHours.toFixed(1)} hours`;
      if (videoEl) videoEl.textContent = videoHours < 1 ? `${Math.round(videoHours * 60)} minutes` : `${videoHours.toFixed(1)} hours`;
      if (textEl) textEl.textContent = `${totalWords.toLocaleString()} words across ${totalSessions} sessions`;

      // Progress bars: use 10hr target for voice, 5hr for video, 10K for text
      // Minimum 5% when > 0 so something always shows
      const voicePct = voiceHours > 0 ? Math.max(5, Math.min(100, (voiceHours / 10) * 100)) : 0;
      const videoPct = videoHours > 0 ? Math.max(5, Math.min(100, (videoHours / 5) * 100)) : 0;
      const textPct = totalWords > 0 ? Math.max(5, Math.min(100, (totalWords / 10000) * 100)) : 0;

      if (voiceBar) voiceBar.style.width = voicePct + '%';
      if (videoBar) videoBar.style.width = videoPct + '%';
      if (textBar) textBar.style.width = textPct + '%';

      // Clone quality grade
      if (gradeEl) {
        if (voiceHours >= 300) { gradeEl.textContent = '🏆 Studio-Grade'; gradeEl.style.color = '#22C55E'; }
        else if (voiceHours >= 100) { gradeEl.textContent = '⭐ Excellent'; gradeEl.style.color = '#3B82F6'; }
        else if (voiceHours >= 40) { gradeEl.textContent = '👍 Good'; gradeEl.style.color = '#60A5FA'; }
        else if (voiceHours >= 10) { gradeEl.textContent = '📊 Fair'; gradeEl.style.color = '#F59E0B'; }
        else if (totalWords >= 5000) { gradeEl.textContent = '📝 Building (text data growing)'; gradeEl.style.color = '#60A5FA'; }
        else { gradeEl.textContent = 'Not enough data yet'; gradeEl.style.color = '#94A3B8'; }
      }

      // Update requirements legend with percentage progress
      const legendEl = this.panel.querySelector('#soulRequirements');
      if (legendEl) {
        const tiers = [
          { label: 'Fair', hours: 10, icon: '📊', color: '#F59E0B' },
          { label: 'Good', hours: 40, icon: '👍', color: '#60A5FA' },
          { label: 'Excellent', hours: 100, icon: '⭐', color: '#3B82F6' },
          { label: 'Studio-Grade', hours: 300, icon: '🏆', color: '#22C55E' }
        ];
        legendEl.innerHTML = tiers.map(t => {
          const pct = Math.min(100, Math.round((voiceHours / t.hours) * 100));
          const done = pct >= 100;
          const barColor = done ? t.color : t.color + '99';
          return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
            <span style="font-size:13px;width:20px;text-align:center;">${done ? '✅' : t.icon}</span>
            <span style="color:${done ? t.color : '#D1D5DB'};font-size:12px;font-weight:${done ? '700' : '500'};width:90px;">${t.label} (${t.hours}h)</span>
            <div style="flex:1;background:#334155;border-radius:4px;height:6px;overflow:hidden;">
              <div style="background:${barColor};height:100%;width:${pct}%;border-radius:4px;transition:width 0.5s;"></div>
            </div>
            <span style="color:${done ? t.color : '#9CA3AF'};font-size:12px;font-weight:700;width:38px;text-align:right;">${pct}%</span>
          </div>`;
        }).join('');
      }
    } catch (e) {
      console.warn('[Settings] Soul File stats update failed:', e.message);
    }
  }

  async _loadTierBadge() {
    try {
      if (!window.windyAPI?.getCurrentTier) return;
      const result = await window.windyAPI.getCurrentTier();
      const tier = result?.tier || 'free';
      this._currentTier = tier;
      const badge = this.panel.querySelector('#settingsTierBadge');
      const hint = this.panel.querySelector('#settingsTierHint');
      const upgradeBtn = this.panel.querySelector('#settingsUpgradeBtn');
      const tierInfo = {
        free: { label: '🌱 Free', color: '#6B7280', hint: 'Unlock more engines, languages, and recording time.' },
        pro: { label: '⚡ Pro', color: '#22C55E', hint: 'All 15 engines, 99 languages, 30-min recordings.' },
        translate: { label: '🚀 Ultra', color: '#3B82F6', hint: 'Pro + 60-min recordings, real-time translation, conversation mode.' },
        translate_pro: { label: '👑 Windy Max', color: '#8B5CF6', hint: 'All features unlocked. Premium support.' }
      };
      const info = tierInfo[tier] || tierInfo.free;
      if (badge) {
        badge.textContent = info.label;
        badge.style.borderColor = info.color;
        badge.style.color = info.color;
      }
      if (hint) hint.textContent = info.hint;
      if (upgradeBtn && tier !== 'free') {
        upgradeBtn.textContent = '💎 Manage Plan';
      }
      // Apply tier-based engine gating
      this._applyTierGating(tier);
    } catch (_) { }
  }

  /**
   * Gray out engines/models not available on the user's plan tier.
   * Free: WindyTune + Edge Spark + Edge Pulse (2 smallest engines)
   * Pro: All Edge + all Core engines
   * Translate: Pro + Lingua language specialists
   * Windy Max: Everything
   */
  _applyTierGating(tier) {
    const tierEngines = {
      free: ['windytune', 'local', 'edge-spark', 'edge-pulse'],
      pro: ['windytune', 'local', 'edge-spark', 'edge-pulse', 'edge-standard', 'edge-global', 'edge-pro',
        'core-spark', 'core-pulse', 'core-standard', 'core-global', 'core-pro', 'core-turbo', 'core-ultra'],
      translate: ['windytune', 'local', 'edge-spark', 'edge-pulse', 'edge-standard', 'edge-global', 'edge-pro',
        'core-spark', 'core-pulse', 'core-standard', 'core-global', 'core-pro', 'core-turbo', 'core-ultra',
        'lingua-es', 'lingua-fr', 'lingua-hi'],
      translate_pro: null, // all engines
      unlimited: null  // all engines
    };
    const tierModels = {
      free: ['tiny', 'base'],
      pro: ['tiny', 'base', 'small', 'medium', 'large-v3'],
      translate: ['tiny', 'base', 'small', 'medium', 'large-v3'],
      translate_pro: null, // all models
      unlimited: null  // all models
    };

    const allowedEngines = tierEngines[tier] || tierEngines.free;
    const allowedModels = tierModels[tier] || tierModels.free;

    // Gate engine dropdown
    const engineSelect = this.panel.querySelector('#engineSelect');
    if (engineSelect) {
      for (const opt of engineSelect.options) {
        if (allowedEngines && !allowedEngines.includes(opt.value)) {
          opt.disabled = true;
          if (!opt.dataset.originalText) opt.dataset.originalText = opt.textContent;
          opt.textContent = '🔒 ' + opt.dataset.originalText + ' — upgrade to unlock';
          opt.style.color = '#8899AA';
        } else {
          opt.disabled = false;
          if (opt.dataset.originalText) opt.textContent = opt.dataset.originalText;
          opt.style.color = '';
        }
      }
    }

    // Gate model dropdown (manual mode)
    const modelSelect = this.panel.querySelector('#modelSelect');
    if (modelSelect) {
      for (const opt of modelSelect.options) {
        if (allowedModels && !allowedModels.includes(opt.value)) {
          opt.disabled = true;
          if (!opt.dataset.originalText) opt.dataset.originalText = opt.textContent;
          opt.textContent = '🔒 ' + opt.dataset.originalText + ' — upgrade to unlock';
          opt.style.color = '#8899AA';
        } else {
          opt.disabled = false;
          if (opt.dataset.originalText) opt.textContent = opt.dataset.originalText;
          opt.style.color = '';
        }
      }
    }

    // Update transcription plan banner
    const banner = this.panel.querySelector('#transcriptionPlanBanner');
    const planLabel = this.panel.querySelector('#transcriptionPlanLabel');
    const planHint = this.panel.querySelector('#transcriptionPlanHint');
    const planUpgrade = this.panel.querySelector('#transcriptionUpgradeBtn');
    if (banner) {
      banner.style.display = 'block';
      const tierLabels = {
        free: { name: 'Free', color: '#6B7280', hint: '2 engines included. Upgrade to Pro for all 15 engines, GPU models, and 30-min recordings.' },
        pro: { name: 'Pro', color: '#22C55E', hint: 'All 15 engines unlocked! Add Translate to get language-specialist engines for Spanish, French, and Hindi.' },
        translate: { name: 'Ultra', color: '#3B82F6', hint: 'All engines + language specialists unlocked. Upgrade to Windy Max for priority support.' },
        translate_pro: { name: 'Windy Max', color: '#8B5CF6', hint: 'All engines and features unlocked. You have the best plan! 👑' }
      };
      const tInfo = tierLabels[tier] || tierLabels.free;
      if (planLabel) planLabel.innerHTML = `Your Plan: <b style="color:${tInfo.color};">${tInfo.name}</b>`;
      if (planHint) planHint.textContent = tInfo.hint;
      if (planUpgrade) {
        planUpgrade.style.display = (tier === 'translate_pro') ? 'none' : '';
        planUpgrade.addEventListener('click', () => {
          if (!this._upgradePanel) this._upgradePanel = new UpgradePanel(this.app);
          this._upgradePanel.toggle();
        });
      }
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'settings-toast';
    toast.textContent = message;
    this.panel.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  getLastTestMeta(iso) {
    if (!iso) return { text: 'Never tested', level: 'never' };
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return { text: 'Never tested', level: 'never' };
    const ageMs = Date.now() - dt.getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    const level = ageMs <= oneDay ? 'recent' : 'stale';
    return { text: `Last: ${dt.toLocaleString()}`, level };
  }

  updateLastTestIndicator(selector, iso) {
    const el = this.panel.querySelector(selector);
    if (!el) return;
    const meta = this.getLastTestMeta(iso);
    el.textContent = meta.text;
    el.classList.remove('recent', 'stale', 'never');
    el.classList.add(meta.level);
  }

  /**
   * Restore shortcut display text when user blurs without pressing a combo.
   */
  _restoreShortcutDisplay(el) {
    const defaults = {
      toggleRecording: 'Ctrl+Shift+Space',
      pasteTranscript: 'Ctrl+Shift+V',
      showHide: 'Ctrl+Shift+W'
    };
    el.textContent = defaults[el.dataset.key] || 'Not set';
  }

  saveSetting(key, value) {
    if (window.windyAPI) {
      window.windyAPI.updateSettings({ [key]: value });
    }
    // Also persist cloud settings to localStorage (fallback for windows without windyAPI)
    const cloudKeys = ['engine', 'cloudUrl', 'cloudToken', 'cloudEmail', 'cloudPassword', 'cloudUser', 'recordingMode', 'maxRecordingMin', 'language'];
    if (cloudKeys.includes(key)) {
      try { localStorage.setItem(`windy_${key}`, value || ''); } catch (_) { }
    }
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.panel.classList.add('open');
    this.isOpen = true;
  }

  close() {
    this.panel.classList.remove('open');
    this.isOpen = false;
  }

  /**
   * Probe the camera hardware to detect actual max resolution.
   * Shows a hint below the video quality dropdown with the real capability.
   */
  async _probeCameraResolution() {
    const hint = this.panel?.querySelector('#cameraCapHint');
    if (!hint) return;
    hint.textContent = '📷 Checking camera…';
    hint.style.display = 'block';
    try {
      // Request max resolution to see what the camera actually delivers
      const probe = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
      });
      const track = probe.getVideoTracks()[0];
      const s = track?.getSettings();
      const camW = s?.width || 0;
      const camH = s?.height || 0;
      // Release immediately
      probe.getTracks().forEach(t => t.stop());

      if (camH > 0) {
        const label = camH >= 2160 ? '4K' : camH >= 1080 ? '1080p' : camH >= 720 ? '720p' : camH >= 480 ? '480p' : camH + 'p';
        const selectedQ = this.panel.querySelector('#videoQuality')?.value || '720p';
        const selectedH = selectedQ === '1080p' ? 1080 : selectedQ === '720p' ? 720 : 480;

        if (camH < selectedH) {
          hint.innerHTML = `⚠️ <strong style="color:#D97706;">Your camera max: ${label} (${camW}×${camH})</strong> — selected ${selectedQ} exceeds hardware. Recordings will be ${label}.`;
        } else {
          hint.innerHTML = `📷 Your camera: <strong>${label}</strong> (${camW}×${camH}) — ✅ supports your selected quality.`;
        }
      } else {
        hint.textContent = '📷 Camera detected but resolution unknown.';
      }
    } catch (err) {
      hint.textContent = '📷 Camera not available — check permissions.';
    }
  }
}
