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
    this._makeCollapsible();
  }

  buildHTML() {
    return `
      <div class="settings-header">
        <h2>⚙️ Settings</h2>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="settings-close" id="settingsFontDown" title="Decrease font size" style="font-size:12px;background:rgba(99,102,241,0.3);">A-</button>
          <button class="settings-close" id="settingsFontUp" title="Increase font size" style="font-size:14px;font-weight:700;background:rgba(99,102,241,0.3);">A+</button>
          <button class="settings-close" id="settingsMaximize" title="Toggle fullscreen" style="background:rgba(139,92,246,0.3);">⛶</button>
          <button class="settings-close" id="settingsClose">✕</button>
        </div>
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
              ${(() => {
                const tier = localStorage.getItem('windy_license_tier') || 'free';
                const tierMaxMap = { free: 5, pro: 30, translate: 30, translate_pro: 60 };
                const tierMax = tierMaxMap[tier] || 5;
                const allOptions = [5, 10, 15, 30, 60];
                return allOptions
                  .filter(v => v <= tierMax)
                  .map(v => `<option value="${v}" ${v === tierMax ? 'selected' : ''}>${v} minutes</option>`)
                  .join('');
              })()}
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
          <p class="settings-hint" id="storageHint">Local storage selected — your data stays on this machine. Change to Windy Cloud or Both to enable syncing.</p>
          <div class="setting-row" title="Where to save files on this device.">
            <label for="archiveFolder">Local folder</label>
            <div class="setting-inline">
              <input type="text" id="archiveFolder" placeholder="~/Documents/WindyProArchive" style="width:160px;background:#1a1a2e;color:#f0f0f0;border:1px solid #333;border-radius:4px;padding:4px 6px;font-size:11px;">
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
              <option value="windy-stt-nano">⚡ Windy Nano (73 MB) — fastest GPU, quick dictation</option>
              <option value="windy-stt-lite">⚡ Windy Lite (140 MB) — lightweight, balanced speed/quality</option>
              <option value="windy-stt-core">⚡ Windy Core (462 MB) — recommended for most use cases</option>
              <option value="windy-stt-edge">⚡ Windy Edge (1444 MB) — high-accuracy, professional grade</option>
              <option value="windy-stt-plus">⚡ Windy Plus (1458 MB) — premium accuracy, production-grade</option>
              <option value="windy-stt-turbo">⚡ Windy Turbo (1544 MB) — latest-gen, state-of-the-art</option>
              <option value="windy-stt-pro">⚡ Windy Pro Engine (2945 MB) — ultra-fast large model</option>
              <option value="windy-stt-nano-cpu">🛡️ Windy Nano CPU (406 MB) — CPU-optimized, resource-constrained</option>
              <option value="windy-stt-lite-cpu">🛡️ Windy Lite CPU (668 MB) — CPU-optimized, good balance</option>
              <option value="windy-stt-core-cpu">🛡️ Windy Core CPU (1760 MB) — CPU-optimized, recommended for CPU</option>
              <option value="windy-stt-edge-cpu">🛡️ Windy Edge CPU (3824 MB) — CPU-optimized, high accuracy</option>
              <option value="windy-stt-plus-cpu">🛡️ Windy Plus CPU (4872 MB) — CPU-optimized, premium accuracy</option>
              <option value="windy-stt-turbo-cpu">🛡️ Windy Turbo CPU (4200 MB) — CPU-optimized, state-of-the-art</option>
              <option value="windy-stt-pro-cpu">🛡️ Windy Pro Engine CPU (9456 MB) — CPU-optimized, maximum performance</option>
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
              <option value="tiny" selected>Windy Nano (73MB — fastest, GPU ✅)</option>
              <option value="base">Windy Core (462MB — recommended, GPU ✅)</option>
              <option value="small">Windy Lite (140MB — lightweight, GPU ✅)</option>
              <option value="medium">Windy Edge (1444MB — high-accuracy, GPU ✅)</option>
              <option value="large-v3">Windy Pro Engine (2945MB — ultra-fast large model, GPU ✅)</option>
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
          <h3>🎹 Customizable Keyboard Shortcuts</h3>
          <p class="settings-hint" style="color:#94A3B8;font-weight:500;">🖱️ Tap any button below to rebind it. Press your new key combo.</p>
          <div class="hotkey-list">
            <div class="hotkey-item-stacked">
              <span class="hotkey-label">🎙️ Start / Stop Recording</span>
              <span class="hotkey-desc">Begins or ends a voice recording session</span>
              <div class="shortcut-capture shortcut-btn" id="shortcutToggle" tabindex="0" data-key="toggleRecording">Ctrl+Shift+Space</div>
            </div>
            <div class="hotkey-item-stacked">
              <span class="hotkey-label">📋 Auto-Type Transcription</span>
              <span class="hotkey-desc">Types your latest recording at the cursor</span>
              <div class="shortcut-capture shortcut-btn" id="shortcutPaste" tabindex="0" data-key="pasteTranscript">Ctrl+Shift+V</div>
            </div>
            <div class="hotkey-item-stacked">
              <span class="hotkey-label">📸 Paste from Clipboard</span>
              <span class="hotkey-desc">Pastes clipboard contents (screenshots, copied text)</span>
              <div class="shortcut-capture shortcut-btn" id="shortcutClipboard" tabindex="0" data-key="pasteClipboard">Ctrl+Shift+B</div>
            </div>
            <div class="hotkey-item-stacked">
              <span class="hotkey-label">👁️ Show / Hide Window</span>
              <span class="hotkey-desc">Cycles: Full window → Tornado → Hidden</span>
              <div class="shortcut-capture shortcut-btn" id="shortcutShowHide" tabindex="0" data-key="showHide">Ctrl+Shift+W</div>
            </div>
            <div class="hotkey-item-stacked">
              <span class="hotkey-label">🌐 Quick Translate</span>
              <span class="hotkey-desc">Opens floating translate pop-up for instant translations</span>
              <div class="shortcut-capture shortcut-btn" id="shortcutQuickTranslate" tabindex="0" data-key="quickTranslate">Ctrl+Shift+T</div>
            </div>
            <div class="hotkey-item-stacked hotkey-readonly">
              <span class="hotkey-label">🔍 Zoom (app window only)</span>
              <span class="hotkey-desc">Click inside the app first — only zooms the Windy Pro window, not your desktop</span>
              <span class="hotkey-fixed-btn">Ctrl + / −  ·  Ctrl+0 Reset</span>
            </div>
          </div>
          <button class="hotkey-reset-btn" id="hotkeyResetBtn">🔄 Reset All to Defaults</button>
          <details class="reserved-shortcuts-info">
            <summary>ℹ️ Why can't I use Ctrl+V, Ctrl+C, etc?</summary>
            <p>These shortcuts are <b>system-wide</b> — used by every app for copy, paste, undo, etc. If Windy Pro hijacked them, you couldn't paste screenshots, copy text, or undo anywhere.</p>
            <p><b>Blocked shortcuts:</b></p>
            <div class="reserved-list">
              <span>Ctrl+V</span><span>Ctrl+C</span><span>Ctrl+X</span>
              <span>Ctrl+Z</span><span>Ctrl+A</span><span>Ctrl+S</span>
              <span>Ctrl+F</span><span>Ctrl+P</span><span>Ctrl+N</span>
              <span>Ctrl+W</span><span>Ctrl+T</span><span>Ctrl+Q</span>
              <span>Alt+F4</span>
            </div>
            <p>✅ <b>Tip:</b> Use <b>Ctrl+Shift+key</b> or <b>Ctrl+Alt+key</b> combos — those are fair game!</p>
          </details>
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
          <h3>🎨 Theme Packs & Effects</h3>

          <div class="setting-row">
            <label>Mode</label>
            <div class="sfx-mode-pills" id="sfxModePills">
              <button class="sfx-mode-pill active" data-mode="silent">🔇 Silent</button>
              <button class="sfx-mode-pill" data-mode="default">🔔 Default</button>
              <button class="sfx-mode-pill" data-mode="single">⚡ Single Pack</button>
              <button class="sfx-mode-pill" data-mode="surprise">🎲 Surprise Me</button>
              <button class="sfx-mode-pill" data-mode="custom">🎨 Custom</button>
            </div>
          </div>

          <div id="sfxPackRow" class="setting-row" style="display:none;">
            <label for="sfxPackSelect">Active Pack</label>
            <select id="sfxPackSelect" style="flex:1;"></select>
          </div>

          <div id="sfxPreviewRow" class="setting-row" style="display:none;">
            <button id="sfxPreviewBtn" class="settings-btn" style="width:100%;padding:6px 12px;" title="Preview current pack sounds">▶ Preview Sounds</button>
          </div>

          <div id="sfxSurpriseRow" class="setting-row" style="display:none;">
            <label for="sfxSurpriseCategory">Rotate From</label>
            <select id="sfxSurpriseCategory">
              <option value="all">🎲 All Packs</option>
              <option value="epic">⚡ Epic</option>
              <option value="gamer">🎮 Gamer</option>
              <option value="cultural">🌍 Cultural</option>
              <option value="utilitarian">🔔 Utilitarian</option>
              <option value="favorites">⭐ Favorites</option>
            </select>
          </div>

          <div id="sfxUnifiedSection" style="display:none;">
            <div class="sfx-master-controls">
              <span class="sfx-custom-hook-label">🔊 Master</span>
              <button class="sfx-custom-btn" id="sfxMasterMute" title="Mute/Unmute All" style="width:auto;padding:0 6px;font-size:12px;">🔊</button>
              <input type="range" class="sfx-hook-vol" id="sfxMasterVol" min="0" max="100" value="70" title="Master Volume">
              <span class="sfx-hook-pct" id="sfxMasterVolPct">70%</span>
            </div>

            <p class="settings-hint sfx-during-hint" style="margin:8px 0 4px;font-weight:700;font-size:12px;">── 📚 My Sound Library ──</p>
            <div class="sfx-library-controls">
              <button class="sfx-custom-btn sfx-custom-record" id="sfxLibRecord" title="Record with mic" style="width:auto;padding:0 8px;font-size:11px;">🎙️ Record</button>
              <button class="sfx-custom-btn" id="sfxLibOpen" title="Open full sound library" style="width:auto;padding:0 8px;font-size:11px;">📚 Open Library</button>
              <span class="sfx-hook-pct" id="sfxLibCount" style="margin-left:auto;">0 sounds</span>
            </div>
            <div id="sfxLibRecStatus" style="display:none;padding:4px 8px;margin:4px 0;border-radius:6px;font-size:11px;"></div>
            <div id="sfxLibSummary" style="font-size:10px;color:#94A3B8;margin:4px 0;"></div>
            <div id="sfxLibPanel" style="display:none;">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                <button class="sfx-custom-btn" id="sfxLibUpload" title="Import audio file from disk" style="width:auto;padding:0 8px;font-size:11px;">📥 Import from Disk</button>
                <span style="font-size:9px;color:#64748B;">Add .mp3, .wav, .m4a files</span>
              </div>
              <div id="sfxLibGrid" class="sfx-library-grid sfx-library-expanded"></div>
            </div>
            <div id="sfxLibGridInline" class="sfx-library-grid"></div>

            <p class="settings-hint sfx-during-hint" style="margin:8px 0 6px;font-weight:700;font-size:12px;">── 🎛️ Sound Hooks ──</p>
            <div id="sfxUnifiedHooks"></div>

            <div class="setting-row" style="margin-top:8px;">
              <label for="sfxDynamicScaling">Scale paste effects with length</label>
              <input type="checkbox" id="sfxDynamicScaling" checked>
            </div>
            <p class="settings-hint">Bigger recordings = bigger paste celebration.</p>
          </div>
        </div>

        <div class="settings-section">
          <h3>🌪️ Widget</h3>
          <div class="widget-mode-pills" id="widgetModePills">
            <div class="widget-mode-pill active" data-mode="specific">📌 Pick One</div>
            <div class="widget-mode-pill" data-mode="random-stock">🔀 Random Stock</div>
            <div class="widget-mode-pill" data-mode="random-custom">🔀 Random Custom</div>
          </div>
          <div id="widgetSpecificSection">
            <div class="sfx-widget-gallery" id="sfxWidgetGallery"></div>
          </div>
          <div id="widgetRandomStockInfo" style="display:none;">
            <p class="settings-hint" style="color:#22C55E;font-weight:600;">🔀 Each prompt picks a random stock widget!</p>
          </div>
          <div id="widgetRandomCustomInfo" style="display:none;">
            <p class="settings-hint" style="color:#22C55E;font-weight:600;">🔀 Each prompt picks from your custom library!</p>
          </div>
          <p class="settings-hint" style="font-weight:600;margin:6px 0 4px;">📁 My Custom Widgets <span id="customWidgetCount" style="color:#94A3B8;">(0/100)</span></p>
          <div class="custom-widget-library" id="customWidgetLibrary">
            <div class="custom-widget-grid" id="customWidgetGrid"></div>
          </div>
          <button id="sfxUploadWidget" class="settings-btn" style="margin-top:4px;width:100%;font-size:11px;">➕ Upload Custom Widget</button>
          <p class="settings-hint">PNG, GIF, SVG, or WebP (max 2MB). Up to 100.</p>
          <div class="setting-row" style="margin-top:8px;">
            <label for="tornadoSize">Widget size</label>
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

    // Font size buttons (zoom webContents)
    this.panel.querySelector('#settingsFontDown')?.addEventListener('click', () => {
      if (window.windyAPI?.zoomOut) window.windyAPI.zoomOut();
      else document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') - 0.1).toFixed(1);
    });
    this.panel.querySelector('#settingsFontUp')?.addEventListener('click', () => {
      if (window.windyAPI?.zoomIn) window.windyAPI.zoomIn();
      else document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1).toFixed(1);
    });

    // Maximize/restore settings panel
    this.panel.querySelector('#settingsMaximize')?.addEventListener('click', () => {
      const isMaxed = this.panel.classList.toggle('settings-maximized');
      const btn = this.panel.querySelector('#settingsMaximize');
      if (btn) { btn.textContent = isMaxed ? '⧉' : '⛶'; btn.title = isMaxed ? 'Restore' : 'Fullscreen'; }
    });

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
        'windy-stt-nano': { hint: '⚡ <b>Fastest engine (73 MB).</b> Quick dictation on powerful hardware.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-lite': { hint: '⚡ <b>Lightweight engine (140 MB).</b> Balanced speed and quality.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-core': { hint: '⚡ <b>Core engine (462 MB).</b> Recommended for most use cases.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-edge': { hint: '⚡ <b>High-accuracy engine (1.4 GB).</b> Professional transcription.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-plus': { hint: '⚡ <b>Premium engine (1.4 GB).</b> Excellent accuracy, production-grade.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-turbo': { hint: '⚡ <b>State-of-the-art engine (1.5 GB).</b> Best balance of accuracy & speed.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-pro': { hint: '⚡ <b>BEST accuracy (2.9 GB).</b> Broadcast, legal, medical, professional.', color: '#F59E0B', cloud: false, local: true, api: false },
        'windy-stt-nano-cpu': { hint: '🛡️ <b>Ultra-light CPU (406 MB).</b> Runs on any hardware.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-lite-cpu': { hint: '🛡️ <b>Lightweight CPU (668 MB).</b> Fast and efficient.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-core-cpu': { hint: '🛡️ <b>Core CPU (1.7 GB).</b> Great balance, no GPU needed.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-edge-cpu': { hint: '🛡️ <b>High-accuracy CPU (3.8 GB).</b> Professional-grade on CPU.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-plus-cpu': { hint: '🛡️ <b>Premium CPU (4.9 GB).</b> Premium accuracy without GPU.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-turbo-cpu': { hint: '🛡️ <b>State-of-the-art CPU (4.2 GB).</b> Best CPU accuracy.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-stt-pro-cpu': { hint: '🛡️ <b>Maximum CPU (9.5 GB).</b> Best possible accuracy on CPU.', color: '#22C55E', cloud: false, local: true, api: false },
        'windy-translate-spark': { hint: '🌍 <b>Fast translation (929 MB).</b> 100+ languages. LoRA-enhanced.', color: '#3B82F6', cloud: false, local: true, api: false },
        'windy-translate-standard': { hint: '🌍 <b>Standard translation (2.4 GB).</b> 100+ languages. Higher quality.', color: '#3B82F6', cloud: false, local: true, api: false },
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
      }
      // Update badge with model size info
      if (this.app && this.app.updateModelBadge) {
        this.app.updateModelBadge(engine);
      } else {
        const badge = document.getElementById('modelBadge');
        if (badge) {
          const icons = { local: '🌪️', cloud: '☁️', 'windy-stt-nano': '⚡', 'windy-stt-lite': '⚡', 'windy-stt-core': '⚡', 'windy-stt-edge': '⚡', 'windy-stt-plus': '⚡', 'windy-stt-turbo': '⚡', 'windy-stt-pro': '⚡', 'windy-stt-nano-cpu': '🛡️', 'windy-stt-lite-cpu': '🛡️', 'windy-stt-core-cpu': '🛡️', 'windy-stt-edge-cpu': '🛡️', 'windy-stt-plus-cpu': '🛡️', 'windy-stt-turbo-cpu': '🛡️', 'windy-stt-pro-cpu': '🛡️', 'windy-translate-spark': '🌍', 'windy-translate-standard': '🌍' };
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
        const val = e.target.value.trim();
        if (val) {
          const cv = Validators.cloudUrl(val);
          if (!cv.valid) {
            this.showToast('⚠️ ' + cv.error);
            return;
          }
        }
        this.saveSetting('cloudUrl', val);
        this.app.cloudUrl = val;
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
        const cloudUrl = this.panel.querySelector('#cloudUrl').value || (window.API_CONFIG || {}).baseUrl || 'https://windypro.thewindstorm.uk';
        const email = this.panel.querySelector('#cloudEmail').value;
        const password = this.panel.querySelector('#cloudPassword').value;
        const name = this.panel.querySelector('#cloudName').value;

        if (!email || !password) {
          cloudLoginStatus.textContent = '⚠️ Enter email and password';
          cloudLoginStatus.style.color = '#EF4444';
          return;
        }

        // Validate email format
        const ev = Validators.email(email);
        if (!ev.valid) {
          cloudLoginStatus.textContent = '⚠️ ' + ev.error;
          cloudLoginStatus.style.color = '#EF4444';
          return;
        }

        // Validate password length
        const pv = Validators.password(password);
        if (!pv.valid) {
          cloudLoginStatus.textContent = '⚠️ ' + pv.error;
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

        // Offline guard: don't attempt network call when offline
        if (!navigator.onLine) {
          cloudLoginStatus.textContent = '✈️ You\'re offline — credentials saved. Sign-in will complete when you reconnect.';
          cloudLoginStatus.style.color = '#94A3B8';
          cloudSignInBtn.disabled = false;
          // Still save credentials for WS auth
          this.app.cloudEmail = email;
          this.app.cloudPassword = password;
          this.saveSetting('cloudEmail', email);
          this.saveSetting('cloudPassword', password);
          this.saveSetting('cloudUser', email);
          return;
        }

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
        // Save current text so we can restore it if user cancels
        el.dataset.previous = el.textContent;
        el.classList.add('capturing');
        el.textContent = 'Press keys...';
      });
      el.addEventListener('blur', () => {
        el.classList.remove('capturing');
        // Restore previous value if nothing was set (user clicked away)
        if (el.textContent === 'Press keys...') {
          el.textContent = el.dataset.previous || el.textContent;
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
                // Refresh the main screen shortcuts display immediately
                if (window.windyAPI?.getSettings) {
                  window.windyAPI.getSettings().then(s => {
                    if (window.app?._populateShortcutDisplay) {
                      window.app._populateShortcutDisplay(s?.hotkeys);
                    }
                  });
                }
              } else {
                this.showToast(`⚠️ Failed to bind ${displayStr}: ${result?.error || 'unknown'}`);
              }
            });
          }
        }
      });
    });

    // Reset all hotkeys to defaults
    const resetBtn = this.panel.querySelector('#hotkeyResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const defaults = {
          toggleRecording: 'CommandOrControl+Shift+Space',
          pasteTranscript: 'CommandOrControl+Shift+V',
          pasteClipboard: 'CommandOrControl+Shift+B',
          showHide: 'CommandOrControl+Shift+W',
          quickTranslate: 'CommandOrControl+Shift+T'
        };
        const displayMap = {
          toggleRecording: '#shortcutToggle',
          pasteTranscript: '#shortcutPaste',
          pasteClipboard: '#shortcutClipboard',
          showHide: '#shortcutShowHide',
          quickTranslate: '#shortcutQuickTranslate'
        };
        // Reset each badge display
        for (const [key, selector] of Object.entries(displayMap)) {
          const el = this.panel.querySelector(selector);
          if (el) el.textContent = defaults[key].replace('CommandOrControl', 'Ctrl');
        }
        // Tell main process to reset each
        if (window.windyAPI?.rebindHotkey) {
          for (const [key, accel] of Object.entries(defaults)) {
            window.windyAPI.rebindHotkey(key, accel);
          }
        }
        this.showToast('✅ All shortcuts reset to defaults');
      });
    }

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

    // ═══ Theme Packs & Effects Event Binding ═══
    const fx = this.app?.effectsEngine;
    const wg = this.app?.widgetEngine;

    // Mode pills
    const modePills = this.panel.querySelectorAll('.sfx-mode-pill');
    const packRow = this.panel.querySelector('#sfxPackRow');
    const surpriseRow = this.panel.querySelector('#sfxSurpriseRow');
    const unifiedSection = this.panel.querySelector('#sfxUnifiedSection');
    const previewRow = this.panel.querySelector('#sfxPreviewRow');

    const updateModeUI = (mode) => {
      modePills.forEach(p => p.classList.toggle('active', p.dataset.mode === mode));
      if (packRow) packRow.style.display = mode === 'single' ? 'flex' : 'none';
      if (surpriseRow) surpriseRow.style.display = mode === 'surprise' ? 'flex' : 'none';
      if (unifiedSection) unifiedSection.style.display = mode === 'silent' ? 'none' : '';
      if (previewRow) previewRow.style.display = mode === 'silent' ? 'none' : '';
    };

    modePills.forEach(pill => {
      pill.addEventListener('click', () => {
        const mode = pill.dataset.mode;
        if (fx) fx.setMode(mode);
        updateModeUI(mode);
      });
    });

    // Pack selector
    const packSelect = this.panel.querySelector('#sfxPackSelect');
    if (packSelect && fx) {
      const packs = fx.getPackList();
      packSelect.innerHTML = packs
        .filter(p => p.id !== '_silent')
        .map(p => `<option value="${p.id}">${p.name} — ${p.description}</option>`)
        .join('');
      if (fx._activePackId) packSelect.value = fx._activePackId;
      packSelect.addEventListener('change', () => {
        fx.setActivePack(packSelect.value);
      });
    }

    // ═══ Shared Sound Library + Custom Hook Builder ═══
    const unifiedHooksContainer = this.panel.querySelector('#sfxUnifiedHooks');
    const libGrid = this.panel.querySelector('#sfxLibGrid');
    const libGridInline = this.panel.querySelector('#sfxLibGridInline');
    const libCountEl = this.panel.querySelector('#sfxLibCount');
    const libRecStatus = this.panel.querySelector('#sfxLibRecStatus');
    const libSummaryEl = this.panel.querySelector('#sfxLibSummary');
    const libPanel = this.panel.querySelector('#sfxLibPanel');
    if (unifiedHooksContainer && fx) {
      // ── Shared Library ──
      let soundLibrary = [];
      try { soundLibrary = JSON.parse(localStorage.getItem('windy_soundLibrary') || '[]'); } catch (_) { }
      const saveLibrary = () => localStorage.setItem('windy_soundLibrary', JSON.stringify(soundLibrary));

      // Hook assignment config
      let customCfg = {};
      try { customCfg = JSON.parse(localStorage.getItem('windy_customSounds') || '{}'); } catch (_) { }
      const saveCustomCfg = () => localStorage.setItem('windy_customSounds', JSON.stringify(customCfg));

      const hookDefs = [
        { key: 'start', label: '🎬 Start Recording' },
        { key: 'during', label: '🎤 During Recording' },
        { key: 'stop', label: '⏹️ Stop Recording' },
        { key: 'process', label: '⏳ Processing' },
        { key: 'warning', label: '⚠️ Warning (limit)' },
        { key: 'paste', label: '📋 Paste' }
      ];

      // Stock sound options
      const allPacks = fx.getPackList().filter(p => p.id !== '_silent');
      const stockOptions = [];
      for (const pack of allPacks) {
        const packData = fx._packs[pack.id];
        if (!packData?.hooks) continue;
        for (const hookName of Object.keys(packData.hooks)) {
          stockOptions.push({ packId: pack.id, hook: hookName, label: `${pack.name} → ${hookName}` });
        }
      }

      // ── Render library grid ──
      let libPanelOpen = false;

      // ── Shared Audio Player (single instance, no parallel spawns) ──
      let activeAudio = null;
      let activeAudioId = null;
      let activeAudioInterval = null;

      const stopActiveAudio = () => {
        if (activeAudio) {
          activeAudio.pause();
          activeAudio.currentTime = 0;
          activeAudio = null;
        }
        activeAudioId = null;
        if (activeAudioInterval) { clearInterval(activeAudioInterval); activeAudioInterval = null; }
        // Reset all play buttons everywhere
        document.querySelectorAll('.sfx-lib-play, .slib-play-btn').forEach(btn => { btn.textContent = '▶'; });
        document.querySelectorAll('.sfx-lib-progress-fill, .slib-progress-fill').forEach(bar => { bar.style.width = '0%'; });
      };

      const playAudio = (item, playBtn, progressFill) => {
        if (!item.dataUrl) { console.warn('No dataUrl for', item.name); return; }

        // Same sound already playing → toggle pause/resume
        if (activeAudioId === item.id && activeAudio) {
          if (activeAudio.paused) {
            activeAudio.play().catch(() => { });
            playBtn.textContent = '⏸';
          } else {
            activeAudio.pause();
            playBtn.textContent = '▶';
          }
          return;
        }

        // Different sound or nothing playing → stop old, start new
        stopActiveAudio();
        activeAudio = new Audio(item.dataUrl);
        activeAudio.volume = 0.7;
        activeAudioId = item.id;
        playBtn.textContent = '⏸';

        // Progress updates
        activeAudioInterval = setInterval(() => {
          if (activeAudio && activeAudio.duration && progressFill) {
            const pct = (activeAudio.currentTime / activeAudio.duration) * 100;
            progressFill.style.width = `${pct}%`;
          }
        }, 100);

        activeAudio.addEventListener('ended', () => {
          playBtn.textContent = '▶';
          if (progressFill) progressFill.style.width = '0%';
          activeAudioId = null;
          activeAudio = null;
          if (activeAudioInterval) { clearInterval(activeAudioInterval); activeAudioInterval = null; }
        });

        activeAudio.play().catch(e => {
          console.warn('Audio play failed:', e);
          playBtn.textContent = '▶';
        });
      };

      const renderLibraryCards = (container, items, expanded) => {
        container.innerHTML = '';
        if (items.length === 0) {
          container.innerHTML = '<p style="font-size:10px;color:#64748B;text-align:center;padding:8px;">No sounds yet. Record or import to get started!</p>';
          return;
        }
        for (const item of items) {
          if (item.starred === undefined) item.starred = true;
          const card = document.createElement('div');
          card.className = 'sfx-lib-card';
          const sizeKb = item.size ? `${Math.round(item.size / 1024)}KB` : '';
          const durText = item.duration ? `${item.duration}s` : '';
          const metaParts = [durText, sizeKb, item.timestamp || ''].filter(Boolean).join(' · ');
          const starLabel = item.starred ? '⭐ In Dropdown' : '☆ Archived';
          const starClass = item.starred ? 'color:#22C55E;' : 'color:#64748B;';

          card.innerHTML = `
            <div class="sfx-lib-card-top">
              <button class="sfx-lib-star" title="${item.starred ? 'Remove from dropdowns (archive)' : 'Add to dropdowns'}" style="background:none;border:none;cursor:pointer;font-size:10px;padding:2px 4px;border-radius:4px;${starClass}white-space:nowrap;">${starLabel}</button>
              <span class="sfx-lib-name-text">${item.name || 'Untitled'}</span>
              <button class="sfx-custom-btn sfx-lib-rename" title="Rename" style="width:22px;height:22px;font-size:10px;">✏️</button>
              <span class="sfx-lib-card-meta" style="margin-left:auto;">${metaParts}</span>
            </div>
            <input class="sfx-lib-name-input" type="text" value="${(item.name || '').replace(/"/g, '&quot;')}" style="display:none;" />
            <div class="sfx-lib-card-actions">
              <button class="sfx-custom-btn sfx-lib-play" title="Play / Pause">${activeAudioId === item.id && activeAudio && !activeAudio.paused ? '⏸' : '▶'}</button>
              <button class="sfx-custom-btn sfx-lib-stop" title="Stop & Reset">⏹</button>
              <button class="sfx-custom-btn sfx-custom-clear sfx-lib-del" title="Delete">🗑️</button>
            </div>
            <div class="sfx-lib-progress"><div class="sfx-lib-progress-fill"></div></div>
          `;
          container.appendChild(card);

          // Star toggle
          card.querySelector('.sfx-lib-star').addEventListener('click', () => {
            item.starred = !item.starred;
            saveLibrary();
            renderLibrary();
            refreshHookDropdowns();
          });

          // Rename
          const nameText = card.querySelector('.sfx-lib-name-text');
          const nameInput = card.querySelector('.sfx-lib-name-input');
          const renameBtn = card.querySelector('.sfx-lib-rename');
          renameBtn.addEventListener('click', () => {
            nameInput.style.display = '';
            nameText.style.display = 'none';
            renameBtn.style.display = 'none';
            nameInput.focus();
            nameInput.select();
          });
          const finishRename = () => {
            const newName = nameInput.value.trim();
            if (newName) {
              item.name = newName;
              nameText.textContent = newName;
              saveLibrary();
              refreshHookDropdowns();
            }
            nameInput.style.display = 'none';
            nameText.style.display = '';
            renameBtn.style.display = '';
          };
          nameInput.addEventListener('blur', finishRename);
          nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') finishRename(); });

          // Play / Pause
          const playBtn = card.querySelector('.sfx-lib-play');
          const progressFill = card.querySelector('.sfx-lib-progress-fill');
          playBtn.addEventListener('click', () => playAudio(item, playBtn, progressFill));

          // Stop / Reset
          card.querySelector('.sfx-lib-stop').addEventListener('click', () => {
            if (activeAudioId === item.id) stopActiveAudio();
          });

          // Delete
          card.querySelector('.sfx-lib-del').addEventListener('click', () => {
            if (activeAudioId === item.id) stopActiveAudio();
            soundLibrary = soundLibrary.filter(s => s.id !== item.id);
            saveLibrary();
            renderLibrary();
            refreshHookDropdowns();
          });
        }
      };

      const renderLibrary = () => {
        const starred = soundLibrary.filter(s => s.starred !== false);
        if (libCountEl) libCountEl.textContent = `${soundLibrary.length} sound${soundLibrary.length !== 1 ? 's' : ''}`;
        if (libSummaryEl) {
          libSummaryEl.textContent = `⭐ ${starred.length} in dropdowns · ${soundLibrary.length} total`;
        }

        // Inline view: show 3 most recent starred sounds (compact preview)
        if (libGridInline && !libPanelOpen) {
          renderLibraryCards(libGridInline, starred.slice(0, 3), false);
        } else if (libGridInline) {
          libGridInline.innerHTML = '';
        }

        // Expanded library: show ALL sounds
        if (libGrid && libPanelOpen) {
          renderLibraryCards(libGrid, soundLibrary, true);
        }
      };

      // ── Full Library Modal ──
      const slibModal = document.getElementById('soundLibraryModal');
      const slibBody = document.getElementById('slibTableBody');
      const slibStats = document.getElementById('slibStats');
      const slibSearch = document.getElementById('slibSearch');
      const slibSort = document.getElementById('slibSort');
      const slibClose = document.getElementById('slibClose');
      const slibStarAll = document.getElementById('slibStarAll');
      const slibArchiveAll = document.getElementById('slibArchiveAll');
      const slibImportBtn = document.getElementById('slibImport');
      const slibPacksTab = document.getElementById('slibPacksTab');
      const slibCommunityTab = document.getElementById('slibCommunityTab');
      const slibBulkBar = document.getElementById('slibBulkBar');
      const slibTableHeader = slibModal?.querySelector('.slib-table-header');

      const renderModalTable = () => {
        if (!slibBody) return;
        slibBody.innerHTML = '';
        let items = [...soundLibrary];
        // Search filter
        const q = (slibSearch?.value || '').toLowerCase().trim();
        if (q) items = items.filter(s => (s.name || '').toLowerCase().includes(q));
        // Sort
        const sortKey = slibSort?.value || 'newest';
        if (sortKey === 'oldest') items.reverse();
        else if (sortKey === 'name') items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        else if (sortKey === 'name-desc') items.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        else if (sortKey === 'size') items.sort((a, b) => (b.size || 0) - (a.size || 0));
        else if (sortKey === 'duration') items.sort((a, b) => (b.duration || 0) - (a.duration || 0));

        // Stats
        const starred = soundLibrary.filter(s => s.starred !== false).length;
        if (slibStats) slibStats.textContent = `⭐ ${starred} in dropdowns · ${soundLibrary.length} total`;

        if (items.length === 0) {
          slibBody.innerHTML = '<div style="padding:40px;text-align:center;color:#64748B;">No sounds found. Record or import to get started!</div>';
          return;
        }

        for (const item of items) {
          const row = document.createElement('div');
          row.className = 'slib-row';
          const isStarred = item.starred !== false;
          const sizeKb = item.size ? `${Math.round(item.size / 1024)}KB` : '—';
          const durText = item.duration ? `${item.duration}s` : '—';
          const dateText = item.timestamp || '—';

          row.innerHTML = `
            <span class="slib-col-status"><button class="slib-status-pill ${isStarred ? 'starred' : 'archived'}">${isStarred ? '⭐ In Dropdown' : '☆ Archived'}</button></span>
            <span class="slib-col-name slib-row-name" title="Click to rename">${item.name || 'Untitled'}</span>
            <span class="slib-col-dur slib-row-meta">${durText}</span>
            <span class="slib-col-size slib-row-meta">${sizeKb}</span>
            <span class="slib-col-date slib-row-meta">${dateText}</span>
            <span class="slib-col-actions slib-row-actions">
              <button class="slib-action-btn slib-play-btn" title="Play / Pause">${activeAudioId === item.id && activeAudio && !activeAudio.paused ? '⏸' : '▶'}</button>
              <button class="slib-action-btn slib-stop-btn" title="Stop & Reset" style="background:linear-gradient(135deg,#64748B,#475569);">⏹</button>
              <button class="slib-action-btn delete" title="Delete">🗑️</button>
            </span>
          `;

          // Progress bar row
          const progressRow = document.createElement('div');
          progressRow.className = 'slib-progress-row';
          progressRow.innerHTML = '<div class="slib-progress-bar"><div class="slib-progress-fill"></div></div>';

          slibBody.appendChild(row);
          slibBody.appendChild(progressRow);

          // Status pill toggle
          row.querySelector('.slib-status-pill').addEventListener('click', () => {
            item.starred = !item.starred;
            saveLibrary();
            renderModalTable();
            renderLibrary();
            refreshHookDropdowns();
          });

          // Rename on click
          const nameEl = row.querySelector('.slib-row-name');
          nameEl.addEventListener('click', () => {
            const input = document.createElement('input');
            input.className = 'slib-row-name-input';
            input.value = item.name || '';
            nameEl.replaceWith(input);
            input.focus();
            input.select();
            const finish = () => {
              const newName = input.value.trim();
              if (newName) { item.name = newName; saveLibrary(); refreshHookDropdowns(); }
              renderModalTable();
              renderLibrary();
            };
            input.addEventListener('blur', finish);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); });
          });

          // Play / Pause
          const playBtn = row.querySelector('.slib-play-btn');
          const progressFill = progressRow.querySelector('.slib-progress-fill');
          playBtn.addEventListener('click', () => playAudio(item, playBtn, progressFill));

          // Stop / Reset
          row.querySelector('.slib-stop-btn').addEventListener('click', () => {
            if (activeAudioId === item.id) stopActiveAudio();
          });

          // Delete
          row.querySelector('.slib-action-btn.delete').addEventListener('click', () => {
            if (activeAudioId === item.id) stopActiveAudio();
            soundLibrary = soundLibrary.filter(s => s.id !== item.id);
            saveLibrary();
            renderModalTable();
            renderLibrary();
            refreshHookDropdowns();
          });
        }
      };

      // Open Library button → opens modal
      const libOpenBtn = this.panel.querySelector('#sfxLibOpen');
      if (libOpenBtn) {
        libOpenBtn.addEventListener('click', () => {
          if (slibModal) {
            slibModal.style.display = '';
            renderModalTable();
          }
        });
      }

      // Close modal
      if (slibClose) slibClose.addEventListener('click', () => { if (slibModal) slibModal.style.display = 'none'; });
      slibModal?.querySelector('.slib-backdrop')?.addEventListener('click', () => { if (slibModal) slibModal.style.display = 'none'; });

      // Escape key closes sound library modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && slibModal && slibModal.style.display !== 'none') {
          slibModal.style.display = 'none';
          e.stopPropagation();
        }
      });

      // Focus trap for sound library modal
      slibModal?.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const container = slibModal.querySelector('.slib-container');
        if (!container) return;
        const focusable = container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });

      // Font size buttons for Sound Library
      document.getElementById('slibFontDown')?.addEventListener('click', () => {
        document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') - 0.1).toFixed(1);
      });
      document.getElementById('slibFontUp')?.addEventListener('click', () => {
        document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1).toFixed(1);
      });

      // Maximize / restore toggle
      const slibMaximize = document.getElementById('slibMaximize');
      if (slibMaximize) slibMaximize.addEventListener('click', () => {
        const container = slibModal?.querySelector('.slib-container');
        if (!container) return;
        const isMaxed = container.classList.toggle('slib-maximized');
        slibMaximize.textContent = isMaxed ? '⧉' : '⛶';
        slibMaximize.title = isMaxed ? 'Restore size' : 'Toggle fullscreen';
      });

      // Search & sort
      if (slibSearch) slibSearch.addEventListener('input', () => renderModalTable());
      if (slibSort) slibSort.addEventListener('change', () => renderModalTable());

      // Bulk actions
      if (slibStarAll) slibStarAll.addEventListener('click', () => {
        soundLibrary.forEach(s => s.starred = true);
        saveLibrary(); renderModalTable(); renderLibrary(); refreshHookDropdowns();
      });
      if (slibArchiveAll) slibArchiveAll.addEventListener('click', () => {
        soundLibrary.forEach(s => s.starred = false);
        saveLibrary(); renderModalTable(); renderLibrary(); refreshHookDropdowns();
      });
      if (slibImportBtn) slibImportBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'audio/*,.mp3,.wav,.ogg,.m4a';
        inp.multiple = true;
        inp.addEventListener('change', () => {
          for (const file of (inp.files || [])) {
            if (file.size > 5 * 1024 * 1024) { alert(`${file.name}: Max 5MB`); continue; }
            const reader = new FileReader();
            reader.onload = () => addToLibrary(reader.result, file.name.replace(/\.[^.]+$/, ''), file.size);
            reader.readAsDataURL(file);
          }
          setTimeout(() => renderModalTable(), 500);
        });
        inp.click();
      });

      // ── Music Recognition (Chromaprint — free, no setup needed) ──
      const slibIdentifyAll = document.getElementById('slibIdentifyAll');

      // Core identify function (uses main-process IPC → Chromaprint + AcoustID)
      const identifySong = async (item) => {
        if (!item.dataUrl) return null;
        try {
          if (window.windyAPI?.identifySong) {
            const result = await window.windyAPI.identifySong({ dataUrl: item.dataUrl, auddApiKey: '' });
            console.debug('[Identify]', item.name, '→', result);
            if (result?.success) return result;
            if (result?.error) console.warn('[Identify] Error:', result.error);
          }
          return null;
        } catch (e) {
          console.error('[Identify] Error:', e);
          return null;
        }
      };

      // Identify All button — just works, no setup
      if (slibIdentifyAll) slibIdentifyAll.addEventListener('click', async () => {

        slibIdentifyAll.textContent = '🎵 Identifying...';
        slibIdentifyAll.disabled = true;

        let identified = 0;
        let method = '';
        for (let i = 0; i < soundLibrary.length; i++) {
          const item = soundLibrary[i];
          // Skip already-identified items (those with ' — ' in the name)
          if (item.name && item.name.includes(' — ')) continue;

          slibIdentifyAll.textContent = `🎵 ${i + 1}/${soundLibrary.length}...`;
          const result = await identifySong(item);
          if (result) {
            item.name = result.newName;
            method = result.method || '';
            identified++;
            saveLibrary();
            renderModalTable();
            refreshHookDropdowns();
          }

          // Rate limit: ~1 req/sec for both APIs
          await new Promise(r => setTimeout(r, 1200));
        }

        const via = method === 'chromaprint' ? ' via Chromaprint' : method === 'audd' ? ' via AudD' : '';
        slibIdentifyAll.textContent = `🎵 Done! ${identified} identified${via}`;
        slibIdentifyAll.disabled = false;
        setTimeout(() => { slibIdentifyAll.textContent = '🎵 Identify All'; }, 4000);
        renderLibrary();
      });

      // Tab switching
      slibModal?.querySelectorAll('.slib-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          slibModal.querySelectorAll('.slib-tab').forEach(t => t.classList.remove('slib-tab-active'));
          tab.classList.add('slib-tab-active');
          const tabName = tab.dataset.tab;
          const showMySounds = tabName === 'my-sounds';
          if (slibBody) slibBody.style.display = showMySounds ? '' : 'none';
          if (slibBulkBar) slibBulkBar.style.display = showMySounds ? '' : 'none';
          if (slibTableHeader) slibTableHeader.style.display = showMySounds ? '' : 'none';
          if (slibPacksTab) slibPacksTab.style.display = tabName === 'packs' ? '' : 'none';
          if (slibCommunityTab) slibCommunityTab.style.display = tabName === 'community' ? '' : 'none';
        });
      });

      // ── Add to library helper ──
      const addToLibrary = (dataUrl, name, size, duration) => {
        const now = new Date();
        const ts = now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const id = `snd_${Date.now()}`;
        soundLibrary.unshift({ id, name: name || `Recording ${ts}`, dataUrl, timestamp: ts, size: size || 0, duration: duration || 0, starred: true });
        saveLibrary();
        renderLibrary();
        refreshHookDropdowns();
        return id;
      };

      // ── Library Upload ──
      const libUploadBtn = this.panel.querySelector('#sfxLibUpload');
      if (libUploadBtn) {
        libUploadBtn.addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a';
          inp.multiple = true;
          inp.addEventListener('change', () => {
            for (const file of (inp.files || [])) {
              if (file.size > 5 * 1024 * 1024) { alert(`${file.name}: Max 5MB`); continue; }
              const reader = new FileReader();
              reader.onload = () => addToLibrary(reader.result, file.name, file.size);
              reader.readAsDataURL(file);
            }
          });
          inp.click();
        });
      }

      // ── Library Record ──
      const libRecordBtn = this.panel.querySelector('#sfxLibRecord');
      let libMediaRec = null;
      let libRecTimer = null;
      if (libRecordBtn) {
        libRecordBtn.addEventListener('click', async () => {
          if (libMediaRec && libMediaRec.state === 'recording') {
            libMediaRec.stop();
            libRecordBtn.textContent = '🎙️ Record';
            libRecordBtn.classList.remove('recording');
            clearInterval(libRecTimer);
            if (libRecStatus) { libRecStatus.style.display = 'none'; }
            return;
          }
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            libMediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            libMediaRec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
            libMediaRec.onstop = () => {
              stream.getTracks().forEach(t => t.stop());
              clearInterval(libRecTimer);
              if (libRecStatus) { libRecStatus.style.display = 'none'; }
              const blob = new Blob(chunks, { type: 'audio/webm' });
              if (blob.size > 5 * 1024 * 1024) { alert('Recording too long (max 5MB)'); return; }
              const reader = new FileReader();
              reader.onload = () => addToLibrary(reader.result, null, blob.size, secs);
              reader.readAsDataURL(blob);
            };
            libMediaRec.start();
            libRecordBtn.textContent = '⏹ Stop';
            libRecordBtn.classList.add('recording');
            let secs = 0;
            if (libRecStatus) {
              libRecStatus.style.display = '';
              libRecStatus.style.background = 'rgba(34,197,94,0.12)';
              libRecStatus.style.color = '#22C55E';
              libRecStatus.textContent = '🟢 Recording... 0s';
            }
            libRecTimer = setInterval(() => {
              secs++;
              if (libRecStatus) libRecStatus.textContent = `🟢 Recording... ${secs}s`;
            }, 1000);
          } catch (_) { alert('Mic access denied'); }
        });
      }

      // ── Per-hook dropdowns (stock + library) ──
      const hookSelectEls = {};

      const buildHookOptions = () => {
        // Shuffle options
        const shuffleOpts = `<optgroup label="🔀 Shuffle / Playlist">
          <option value="shuffle|starred">🔀 Shuffle Starred (${soundLibrary.filter(s => s.starred !== false).length} sounds)</option>
          <option value="shuffle|all">🔀 Shuffle All Library (${soundLibrary.length} sounds)</option>
        </optgroup>`;

        let libOpts = '';
        const starredSounds = soundLibrary.filter(s => s.starred !== false);
        if (starredSounds.length > 0) {
          libOpts = `<optgroup label="⭐ My Library">` +
            starredSounds.map(s => `<option value="lib|${s.id}">${s.name}</option>`).join('') +
            `</optgroup>`;
        }
        const stockOpts = `<optgroup label="🔊 Stock Sounds">` +
          stockOptions.map(s => `<option value="stock|${s.packId}|${s.hook}">${s.label}</option>`).join('') +
          `</optgroup>`;
        return `<option value="">— Not set —</option>` + shuffleOpts + libOpts + stockOpts;
      };

      const refreshHookDropdowns = () => {
        const options = buildHookOptions();
        for (const [hook, sel] of Object.entries(hookSelectEls)) {
          const cur = sel.value;
          sel.innerHTML = options;
          // Restore selection
          const cfg = customCfg[hook];
          if (cfg?.type === 'shuffle') sel.value = `shuffle|${cfg.pool || 'starred'}`;
          else if (cfg?.type === 'library') sel.value = `lib|${cfg.libId}`;
          else if (cfg?.type === 'stock') sel.value = `stock|${cfg.packId}|${cfg.hook}`;
          else sel.value = '';
        }
      };

      // Build per-hook UI rows (unified: dropdown + volume + mute + preview in each row)
      const formatInterval = (s) => s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? s % 60 + 's' : ''}` : `${s}s`;

      // Intro tip
      const introTip = document.createElement('div');
      introTip.className = 'sfx-hooks-intro';
      introTip.innerHTML = `<strong>Every recording has 6 sound stages.</strong> Customize the sound effect, volume, or mute each one independently. Use a stock sound, pick from your library, or keep the pack default.`;
      unifiedHooksContainer.appendChild(introTip);

      let stepNum = 0;
      for (const hd of hookDefs) {
        stepNum++;
        const row = document.createElement('div');
        row.className = 'sfx-unified-hook-row';
        row.setAttribute('data-hook', hd.key);
        const current = customCfg[hd.key];
        const hookEnabled = fx._hookPoints[hd.key]?.enabled !== false;
        const hookVol = fx._hookPoints[hd.key]?.volume || 70;

        row.innerHTML = `
          <div class="sfx-unified-hook-top">
            <span class="sfx-step-badge">${stepNum}</span>
            <span class="sfx-unified-hook-label">${hd.label}</span>
            <button class="sfx-unified-mute" id="uniMute_${hd.key}" title="Mute/Unmute">${hookEnabled ? '🔊' : '🔇'}</button>
          </div>
          <select class="sfx-unified-select" id="uniSelect_${hd.key}" style="margin-bottom:6px;">
            ${buildHookOptions()}
          </select>
          <div class="sfx-unified-hook-bottom">
            <input type="range" class="sfx-hook-vol" id="uniVol_${hd.key}" min="0" max="100" value="${hookVol}" title="Volume">
            <span class="sfx-hook-pct" id="uniVolPct_${hd.key}">${hookVol}%</span>
            <button class="sfx-custom-btn" id="uniPreview_${hd.key}" title="Preview">▶</button>
          </div>
        `;
        unifiedHooksContainer.appendChild(row);

        // --- Volume slider ---
        const volSlider = row.querySelector(`#uniVol_${hd.key}`);
        const volPct = row.querySelector(`#uniVolPct_${hd.key}`);
        volSlider.addEventListener('input', () => {
          fx.setHookVolume(hd.key, parseInt(volSlider.value, 10));
          volPct.textContent = volSlider.value + '%';
        });

        // --- Mute toggle ---
        const muteBtn = row.querySelector(`#uniMute_${hd.key}`);
        muteBtn.addEventListener('click', () => {
          const cur = fx._hookPoints[hd.key]?.enabled !== false;
          fx.setHookEnabled(hd.key, !cur);
          muteBtn.textContent = !cur ? '🔊' : '🔇';
        });

        // --- Sound dropdown ---
        const sel = row.querySelector(`#uniSelect_${hd.key}`);
        hookSelectEls[hd.key] = sel;
        if (current?.type === 'shuffle') sel.value = `shuffle|${current.pool || 'starred'}`;
        else if (current?.type === 'library') sel.value = `lib|${current.libId}`;
        else if (current?.type === 'stock') sel.value = `stock|${current.packId}|${current.hook}`;

        sel.addEventListener('change', () => {
          if (!sel.value) {
            delete customCfg[hd.key];
            saveCustomCfg();
            return;
          }
          const parts = sel.value.split('|');
          if (parts[0] === 'shuffle') {
            customCfg[hd.key] = { type: 'shuffle', pool: parts[1] }; // 'starred' or 'all'
          } else if (parts[0] === 'lib') {
            const lib = soundLibrary.find(s => s.id === parts[1]);
            customCfg[hd.key] = { type: 'library', libId: parts[1], name: lib?.name };
          } else if (parts[0] === 'stock') {
            const opt = stockOptions.find(s => s.packId === parts[1] && s.hook === parts[2]);
            customCfg[hd.key] = { type: 'stock', packId: parts[1], hook: parts[2], label: opt?.label };
          }
          saveCustomCfg();

          // Auto-enable the hook when user selects a sound
          fx.setHookEnabled(hd.key, true);
          muteBtn.textContent = '🔊';
        });

        // --- Preview ---
        row.querySelector(`#uniPreview_${hd.key}`).addEventListener('click', () => {
          const cfg = customCfg[hd.key];
          if (cfg?.type === 'shuffle') {
            // Preview: play a random pick
            const pool = cfg.pool === 'all' ? soundLibrary : soundLibrary.filter(s => s.starred !== false);
            if (pool.length > 0) {
              const pick = pool[Math.floor(Math.random() * pool.length)];
              if (pick?.dataUrl) {
                const audio = new Audio(pick.dataUrl);
                audio.volume = Math.max(0.05, (volSlider.value / 100));
                audio.play().catch(e => console.warn('Shuffle preview failed:', e));
              }
            }
          } else if (cfg?.type === 'library') {
            const lib = soundLibrary.find(s => s.id === cfg.libId);
            if (lib?.dataUrl) {
              const audio = new Audio(lib.dataUrl);
              audio.volume = Math.max(0.05, (volSlider.value / 100));
              audio.play().catch(e => console.warn('Hook preview failed:', e));
            }
          } else if (cfg?.type === 'stock' && cfg.packId) {
            fx.previewEffect(cfg.packId, cfg.hook);
          } else {
            // Pack default — trigger hook
            fx.trigger(hd.key);
          }
        });

        // --- Interval sub-row for during/process ---
        if (hd.key === 'during' || hd.key === 'process') {
          const storageKey = hd.key === 'during' ? 'windy_duringInterval' : 'windy_processInterval';
          const defaultVal = hd.key === 'during' ? 5 : 10;
          const maxVal = hd.key === 'during' ? 300 : 600;
          const saved = parseInt(localStorage.getItem(storageKey) || String(defaultVal), 10);

          const subRow = document.createElement('div');
          subRow.className = 'sfx-interval-row';
          subRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;margin-top:4px;';
          subRow.innerHTML = `
            <span class="sfx-hook-label" style="font-size:9px;">⏱️ Beep every</span>
            <input type="range" class="sfx-hook-vol" id="uniInterval_${hd.key}" min="1" max="${maxVal}" value="${saved}" style="flex:1;">
            <span class="sfx-hook-pct" id="uniIntervalVal_${hd.key}" style="min-width:32px;">${formatInterval(saved)}</span>
          `;
          row.appendChild(subRow);

          const iSlider = subRow.querySelector(`#uniInterval_${hd.key}`);
          const iVal = subRow.querySelector(`#uniIntervalVal_${hd.key}`);
          iSlider.addEventListener('input', () => {
            const v = parseInt(iSlider.value, 10);
            localStorage.setItem(storageKey, v);
            iVal.textContent = formatInterval(v);
          });

          // Hint text for during
          if (hd.key === 'during') {
            const hint = document.createElement('p');
            hint.className = 'settings-hint sfx-during-hint';
            hint.style.cssText = 'margin:4px 0 0 4px;font-size:9px;';
            hint.textContent = '🎧 Periodic beeps confirm recording is active. Speaker-only.';
            row.appendChild(hint);
          }
        }

        // Warning hint
        if (hd.key === 'warning') {
          const hint = document.createElement('p');
          hint.className = 'settings-hint sfx-during-hint';
          hint.style.cssText = 'margin:4px 0 0 4px;font-size:9px;';
          hint.textContent = '⚠️ Warns 30s & 15s before recording time limit.';
          row.appendChild(hint);
        }
      }

      // Initial render
      renderLibrary();
    }

    // Preview button — plays all 5 hooks with proper timing
    const previewBtn = this.panel.querySelector('#sfxPreviewBtn');
    if (previewBtn && fx) {
      previewBtn.addEventListener('click', () => {
        const currentMode = fx._mode;
        let pid;
        if (currentMode === 'default') {
          pid = 'classic-beep';
        } else if (currentMode === 'single') {
          pid = packSelect?.value || 'classic-beep';
        } else if (currentMode === 'surprise') {
          pid = fx._getNextSurprisePack()?.id || 'classic-beep';
        } else {
          pid = 'classic-beep';
        }
        // Play all 5 hooks: start → during → stop → processing → paste
        previewBtn.textContent = '🔊 Playing...';
        previewBtn.disabled = true;
        fx.previewEffect(pid, 'start');
        setTimeout(() => fx.previewEffect(pid, 'during'), 600);
        setTimeout(() => fx.previewEffect(pid, 'stop'), 1200);
        setTimeout(() => fx.previewEffect(pid, 'process'), 1800);
        setTimeout(() => fx.previewEffect(pid, 'paste'), 2400);
        setTimeout(() => {
          previewBtn.textContent = '▶ Preview Sounds';
          previewBtn.disabled = false;
        }, 3200);
      });
    }

    // Surprise Me category
    const surpriseCat = this.panel.querySelector('#sfxSurpriseCategory');
    if (surpriseCat && fx) {
      surpriseCat.addEventListener('change', () => {
        fx._surpriseCategory = surpriseCat.value;
        fx._shuffleBag = [];
        fx._saveSettings();
      });
    }

    // Hook point toggles + volume sliders + mute labels
    const hookMap = { Start: 'start', During: 'during', Stop: 'stop', Process: 'process', Warning: 'warning', Paste: 'paste' };
    for (const [label, hook] of Object.entries(hookMap)) {
      const toggle = this.panel.querySelector(`#sfxHook${label}`);
      const slider = this.panel.querySelector(`#sfxVol${label}`);
      const pct = this.panel.querySelector(`#sfxVol${label}Pct`);
      const muteLabel = this.panel.querySelector(`#sfxMute${label}`);

      const updateMuteLabel = (enabled) => {
        if (muteLabel) muteLabel.textContent = enabled ? '🔊' : '🔇';
      };

      if (toggle && fx) {
        toggle.checked = fx._hookPoints[hook]?.enabled || false;
        updateMuteLabel(toggle.checked);
        toggle.addEventListener('change', () => {
          fx.setHookEnabled(hook, toggle.checked);
          updateMuteLabel(toggle.checked);
        });
      }

      // Click mute label to toggle
      if (muteLabel && toggle) {
        muteLabel.style.cursor = 'pointer';
        muteLabel.addEventListener('click', () => {
          toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event('change'));
        });
      }

      if (slider && fx) {
        slider.value = fx._hookPoints[hook]?.volume || 70;
        if (pct) pct.textContent = 'Vol: ' + slider.value + '%';
        slider.addEventListener('input', () => {
          fx.setHookVolume(hook, parseInt(slider.value, 10));
          if (pct) pct.textContent = 'Vol: ' + slider.value + '%';
        });
      }
    }

    // Interval sliders
    const formatInterval = (s) => s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? s % 60 + 's' : ''}` : `${s}s`;

    const duringInterval = this.panel.querySelector('#sfxIntervalDuring');
    const duringIntervalVal = this.panel.querySelector('#sfxIntervalDuringVal');
    if (duringInterval) {
      const saved = parseInt(localStorage.getItem('windy_duringInterval') || '5', 10);
      duringInterval.value = saved;
      if (duringIntervalVal) duringIntervalVal.textContent = formatInterval(saved);
      duringInterval.addEventListener('input', () => {
        const v = parseInt(duringInterval.value, 10);
        localStorage.setItem('windy_duringInterval', v);
        if (duringIntervalVal) duringIntervalVal.textContent = formatInterval(v);
      });
    }

    const processInterval = this.panel.querySelector('#sfxIntervalProcess');
    const processIntervalVal = this.panel.querySelector('#sfxIntervalProcessVal');
    if (processInterval) {
      const saved = parseInt(localStorage.getItem('windy_processInterval') || '10', 10);
      processInterval.value = saved;
      if (processIntervalVal) processIntervalVal.textContent = formatInterval(saved);
      processInterval.addEventListener('input', () => {
        const v = parseInt(processInterval.value, 10);
        localStorage.setItem('windy_processInterval', v);
        if (processIntervalVal) processIntervalVal.textContent = formatInterval(v);
      });
    }

    // Dynamic scaling
    const dynScale = this.panel.querySelector('#sfxDynamicScaling');
    if (dynScale && fx) {
      dynScale.checked = fx._dynamicScaling;
      dynScale.addEventListener('change', () => fx.setDynamicScaling(dynScale.checked));
    }

    // Restore saved mode UI
    if (fx) updateModeUI(fx._mode);

    // Widget gallery
    const gallery = this.panel.querySelector('#sfxWidgetGallery');
    const customGrid = this.panel.querySelector('#customWidgetGrid');
    const customCountEl = this.panel.querySelector('#customWidgetCount');

    // Helper: load custom widgets from localStorage
    const loadCustomWidgets = () => {
      try { return JSON.parse(localStorage.getItem('windy_customWidgets') || '[]'); }
      catch (_) { return []; }
    };
    const saveCustomWidgets = (list) => {
      localStorage.setItem('windy_customWidgets', JSON.stringify(list));
    };

    // Helper: render custom library grid
    const renderCustomGrid = () => {
      const customs = loadCustomWidgets();
      if (customCountEl) customCountEl.textContent = `(${customs.length}/100)`;
      if (!customGrid) return;
      customGrid.innerHTML = customs.map((dataUrl, i) => `
        <div class="custom-widget-thumb ${wg && wg._customPath === dataUrl ? 'active' : ''}" data-idx="${i}">
          <img src="${dataUrl}" alt="Custom ${i + 1}">
          <button class="custom-widget-delete" data-del="${i}" title="Remove">✕</button>
        </div>
      `).join('');

      // Click to select
      customGrid.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
          e.stopPropagation();
          const idx = parseInt(del.dataset.del, 10);
          const list = loadCustomWidgets();
          list.splice(idx, 1);
          saveCustomWidgets(list);
          renderCustomGrid();
          this.showToast('🗑️ Custom widget removed');
          return;
        }
        const thumb = e.target.closest('.custom-widget-thumb');
        if (!thumb || !wg) return;
        const idx = parseInt(thumb.dataset.idx, 10);
        const list = loadCustomWidgets();
        if (list[idx]) {
          wg.setWidget('custom', list[idx]);
          if (gallery) gallery.querySelectorAll('.sfx-widget-card').forEach(c => c.classList.remove('active'));
          customGrid.querySelectorAll('.custom-widget-thumb').forEach(c => c.classList.remove('active'));
          thumb.classList.add('active');
          // Switch to Specific mode
          setWidgetMode('specific');
          this.showToast('✅ Custom widget selected!');
        }
      });
    };

    // Widget mode pills
    const widgetModePills = this.panel.querySelector('#widgetModePills');
    const specificSection = this.panel.querySelector('#widgetSpecificSection');
    const randomStockInfo = this.panel.querySelector('#widgetRandomStockInfo');
    const randomCustomInfo = this.panel.querySelector('#widgetRandomCustomInfo');
    const savedWidgetMode = localStorage.getItem('windy_widgetMode') || 'specific';

    const setWidgetMode = (mode) => {
      localStorage.setItem('windy_widgetMode', mode);
      if (widgetModePills) {
        widgetModePills.querySelectorAll('.widget-mode-pill').forEach(p => {
          p.classList.toggle('active', p.dataset.mode === mode);
        });
      }
      if (specificSection) specificSection.style.display = mode === 'specific' ? '' : 'none';
      if (randomStockInfo) randomStockInfo.style.display = mode === 'random-stock' ? '' : 'none';
      if (randomCustomInfo) randomCustomInfo.style.display = mode === 'random-custom' ? '' : 'none';
    };

    setWidgetMode(savedWidgetMode);

    if (widgetModePills) {
      widgetModePills.addEventListener('click', (e) => {
        const pill = e.target.closest('.widget-mode-pill');
        if (!pill) return;
        const mode = pill.dataset.mode;
        setWidgetMode(mode);

        if (mode === 'random-stock' && wg) {
          // Pick a random stock widget immediately
          const stockIds = Object.keys(WidgetEngine.STOCK_WIDGETS);
          const rand = stockIds[Math.floor(Math.random() * stockIds.length)];
          wg.setWidget(rand);
          this.showToast(`🔀 Random: ${rand}`);
        } else if (mode === 'random-custom' && wg) {
          const customs = loadCustomWidgets();
          if (customs.length > 0) {
            const rand = customs[Math.floor(Math.random() * customs.length)];
            wg.setWidget('custom', rand);
            this.showToast(`🔀 Random custom widget!`);
          } else {
            this.showToast('⚠️ Upload custom widgets first!');
          }
        }
      });
    }

    // Stock gallery
    if (gallery && wg) {
      const widgets = wg.getStockList();
      gallery.innerHTML = widgets.map(w => `
        <div class="sfx-widget-card ${w.id === wg.getCurrentWidget() ? 'active' : ''}" data-widget="${w.id}" title="${w.name}">
          <div class="sfx-widget-preview">${w.svg}</div>
          <span class="sfx-widget-name">${w.name}</span>
        </div>
      `).join('');

      gallery.addEventListener('click', (e) => {
        const card = e.target.closest('.sfx-widget-card');
        if (!card) return;
        const widgetId = card.dataset.widget;
        wg.setWidget(widgetId);
        gallery.querySelectorAll('.sfx-widget-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        if (customGrid) customGrid.querySelectorAll('.custom-widget-thumb').forEach(c => c.classList.remove('active'));
        setWidgetMode('specific');
        this.showToast(`Widget: ${widgetId}`);
      });
    }

    // Render custom library
    renderCustomGrid();

    // Upload custom widget → add to library
    const uploadBtn = this.panel.querySelector('#sfxUploadWidget');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        const customs = loadCustomWidgets();
        if (customs.length >= 100) {
          this.showToast('❌ Library full (100 max). Delete some first.');
          return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.png,.gif,.svg,.webp,image/png,image/gif,image/svg+xml,image/webp';
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            this.showToast('❌ File too large (max 2MB)');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const list = loadCustomWidgets();
            list.push(reader.result);
            saveCustomWidgets(list);
            renderCustomGrid();
            // Auto-select the new widget
            if (wg) {
              wg.setWidget('custom', reader.result);
              if (gallery) gallery.querySelectorAll('.sfx-widget-card').forEach(c => c.classList.remove('active'));
              setWidgetMode('specific');
            }
            this.showToast(`✅ Custom widget added! (${list.length}/100)`);
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
    }
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
          const map = { toggleRecording: '#shortcutToggle', pasteTranscript: '#shortcutPaste', pasteClipboard: '#shortcutClipboard', showHide: '#shortcutShowHide' };
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
        if (voiceHours === 0 && totalWords === 0 && totalSessions === 0) {
          legendEl.innerHTML = '<span style="color:#94A3B8;font-size:12px;">🎙️ Start recording to build your Soul File! Each session adds voice data, vocabulary, and speech patterns.</span>';
        } else {
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
   * Free: WindyTune + smallest 3 GPU models
   * Pro: All GPU and CPU voice engines
   * Translate: Pro + Windy Translate Spark
   * Windy Max: Everything
   */
  _applyTierGating(tier) {
    const tierEngines = {
      free: ['windytune', 'local', 'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core'],
      pro: ['windytune', 'local', 'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core', 'windy-stt-edge', 'windy-stt-plus', 'windy-stt-turbo', 'windy-stt-pro',
        'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu', 'windy-stt-edge-cpu', 'windy-stt-plus-cpu', 'windy-stt-turbo-cpu', 'windy-stt-pro-cpu'],
      translate: ['windytune', 'local', 'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core', 'windy-stt-edge', 'windy-stt-plus', 'windy-stt-turbo', 'windy-stt-pro',
        'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu', 'windy-stt-edge-cpu', 'windy-stt-plus-cpu', 'windy-stt-turbo-cpu', 'windy-stt-pro-cpu',
        'windy-translate-spark'],
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
        free: { name: 'Free', color: '#6B7280', hint: '2 engines included. Upgrade to Windy Pro for all 15 engines, GPU models, and 30-min recordings.' },
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
      pasteClipboard: 'Ctrl+Shift+B',
      showHide: 'Ctrl+Shift+W'
    };
    el.textContent = defaults[el.dataset.key] || 'Not set';
  }

  /**
   * Make each settings-section collapsible with a ▼/▶ toggle.
   * State is persisted in localStorage so it survives settings closes and app restarts.
   */
  _makeCollapsible() {
    const saved = JSON.parse(localStorage.getItem('settings-collapsed') || '{}');
    const sections = this.panel.querySelectorAll('.settings-section');

    sections.forEach((section, i) => {
      const h3 = section.querySelector('h3');
      if (!h3) return;

      // Create a key from the section title text
      const key = h3.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);

      // Wrap content below h3 in a collapsible container
      const content = document.createElement('div');
      content.className = 'section-collapsible-content';
      while (h3.nextSibling) {
        content.appendChild(h3.nextSibling);
      }
      section.appendChild(content);

      // Add toggle indicator to h3
      const toggle = document.createElement('span');
      toggle.className = 'section-toggle';
      h3.prepend(toggle);
      h3.classList.add('section-header-clickable');

      // Set initial state (all COLLAPSED by default on first use)
      const isCollapsed = saved[key] !== false; // collapsed unless explicitly opened
      if (isCollapsed) {
        content.style.display = 'none';
        toggle.textContent = '▶ ';
        section.classList.add('collapsed');
      } else {
        toggle.textContent = '▼ ';
      }

      // Click handler
      h3.addEventListener('click', () => {
        const nowCollapsed = content.style.display !== 'none';
        content.style.display = nowCollapsed ? 'none' : '';
        toggle.textContent = nowCollapsed ? '▶ ' : '▼ ';
        section.classList.toggle('collapsed', nowCollapsed);

        // Save state
        const state = JSON.parse(localStorage.getItem('settings-collapsed') || '{}');
        state[key] = nowCollapsed;
        localStorage.setItem('settings-collapsed', JSON.stringify(state));
      });
    });
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
