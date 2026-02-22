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
        <div class="settings-section">
          <h3>🧭 Simple Mode</h3>
          <div class="setting-row" title="ON: clear transcript after paste. OFF: keep it visible (lighter + italic) for scrollback.">
            <label for="clearOnPaste">Clear after paste</label>
            <input type="checkbox" id="clearOnPaste">
          </div>
          <p class="settings-hint">When off, pasted text stays visible but grayed out so you can scroll back.</p>
          <div class="setting-row" title="When OFF, only the green strobe shows during recording. This can reduce UI overhead on weaker machines.">
            <label for="livePreview">Show live words while recording</label>
            <input type="checkbox" id="livePreview" checked>
          </div>
          <p class="settings-hint">ON = words stream live. OFF = strobe-only during recording; text appears after stop.</p>
        </div>

        <div class="settings-section">
          <h3>🔌 Transcription Engine</h3>
          <div class="setting-row">
            <label for="engineSelect">Engine</label>
            <select id="engineSelect">
              <option value="local" selected>🏠 Local — your device</option>
              <option value="cloud">☁️ Cloud — WindyPro servers</option>
              <option value="smart">🧠 Smart — auto-switch</option>
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

        <div class="settings-section" id="localModelSection">
          <h3>🎤 Transcription</h3>
          <div class="setting-row">
            <label for="modelSelect">Model Size</label>
            <select id="modelSelect">
              <option value="tiny" selected>Tiny (75MB — fastest, CPU ✅)</option>
              <option value="base">Base (150MB — balanced, CPU ✅)</option>
              <option value="small">Small (500MB — ⚠️ GPU recommended)</option>
              <option value="medium">Medium (1.5GB — ⚠️ GPU only)</option>
              <option value="large-v3">Large (3GB — ⚠️ GPU only)</option>
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
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="ko">한국어</option>
              <option value="pt">Português</option>
              <option value="it">Italiano</option>
              <option value="auto">Auto-detect</option>
            </select>
          </div>
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
        
        <div class="settings-section">
          <h3>🗄️ Archive</h3>
          <div class="setting-row" title="Automatically save each completed dictation locally.">
            <label for="autoArchive">Auto-archive dictations</label>
            <input type="checkbox" id="autoArchive">
          </div>
          <div class="setting-row" title="Local archive destination in your filesystem.">
            <label for="archiveFolder">Local archive folder</label>
            <div class="setting-inline">
              <input type="text" id="archiveFolder" readonly>
              <button id="browseArchiveFolder" class="settings-btn">Browse</button>
            </div>
          </div>
          <div class="setting-row" title="Chunk: one file per stop. Daily: one rolling file. Both: both outputs.">
            <label for="archiveMode">Archive format</label>
            <select id="archiveMode">
              <option value="chunk">Per recording chunk</option>
              <option value="daily">Daily rolling file</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div class="setting-row" title="Enable Dropbox sync for routes that include Dropbox.">
            <label for="dropboxEnabled">Enable Dropbox sync</label>
            <input type="checkbox" id="dropboxEnabled">
          </div>
          <div class="setting-row" title="Dropbox API access token (stored locally on this machine).">
            <label for="dropboxAccessToken">Dropbox token</label>
            <input type="password" id="dropboxAccessToken" placeholder="dbx_...">
          </div>
          <div class="setting-row" title="Dropbox destination folder.">
            <label for="dropboxFolder">Dropbox folder</label>
            <input type="text" id="dropboxFolder" placeholder="/WindyProArchive">
          </div>
          <div class="setting-row">
            <label>Dropbox connection</label>
            <div class="setting-inline">
              <button id="testDropbox" class="settings-btn">Test</button>
              <span class="settings-meta" id="dropboxLastTest">Never tested</span>
            </div>
          </div>
          <div class="setting-row" title="Enable Google Drive sync for routes that include Google.">
            <label for="googleEnabled">Enable Google sync</label>
            <input type="checkbox" id="googleEnabled">
          </div>
          <div class="setting-row" title="Google OAuth access token (stored locally on this machine).">
            <label for="googleAccessToken">Google token</label>
            <input type="password" id="googleAccessToken" placeholder="ya29...">
          </div>
          <div class="setting-row" title="Optional Drive folder ID. Leave blank for My Drive root.">
            <label for="googleFolderId">Google folder ID</label>
            <input type="text" id="googleFolderId" placeholder="Optional folder id">
          </div>
          <div class="setting-row">
            <label>Google connection</label>
            <div class="setting-inline">
              <button id="testGoogle" class="settings-btn">Test</button>
              <span class="settings-meta" id="googleLastTest">Never tested</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>⌨️ Hotkeys</h3>
          <div class="setting-row">
            <label>Toggle Recording</label>
            <span class="hotkey-display">Ctrl+Shift+Space</span>
          </div>
          <div class="setting-row">
            <label>Paste Transcript</label>
            <span class="hotkey-display">Ctrl+Shift+V</span>
          </div>
          <div class="setting-row">
            <label>Show/Hide Window</label>
            <span class="hotkey-display">Ctrl+Shift+W</span>
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
        </div>
        
        <div class="settings-section">
          <h3>ℹ️ About</h3>
          <p class="settings-about" id="aboutVersion">Windy Pro<br>Voice-to-text with the Green Strobe guarantee.</p>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Close button
    this.panel.querySelector('#settingsClose').addEventListener('click', () => this.close());

    // Engine selector — toggle cloud/local UI sections
    const engineSelect = this.panel.querySelector('#engineSelect');
    const cloudSettings = this.panel.querySelector('#cloudSettings');
    const localModelSection = this.panel.querySelector('#localModelSection');
    const engineHint = this.panel.querySelector('#engineHint');
    engineSelect.addEventListener('change', (e) => {
      const engine = e.target.value;
      this.saveSetting('engine', engine);
      this.app.transcriptionEngine = engine;
      if (engine === 'cloud') {
        cloudSettings.style.display = 'block';
        localModelSection.style.display = 'none';
        engineHint.textContent = '☁️🔒 Audio streamed to WindyPro Cloud. E2E encrypted, zero retention.';
        engineHint.style.color = '#4ecdc4';
      } else if (engine === 'smart') {
        cloudSettings.style.display = 'block';
        localModelSection.style.display = 'block';
        engineHint.textContent = '🧠 Starts local. Auto-switches to cloud if your device struggles.';
        engineHint.style.color = '#f7dc6f';
      } else {
        cloudSettings.style.display = 'none';
        localModelSection.style.display = 'block';
        engineHint.textContent = 'Audio processed on your device. Nothing sent anywhere.';
        engineHint.style.color = '';
      }
      // Update badge
      const badge = document.getElementById('modelBadge');
      if (badge) {
        const icon = engine === 'cloud' ? '☁️🔒' : engine === 'smart' ? '🧠' : '🏠';
        badge.textContent = `${icon} ${engine}`;
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
            throw new Error(data.detail || 'Login failed');
          }

          // Success — store token
          this.app.cloudToken = data.token;
          this.saveSetting('cloudToken', data.token);
          this.saveSetting('cloudUser', data.user?.email || email);

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
    this.panel.querySelector('#livePreview').addEventListener('change', (e) => {
      this.saveSetting('livePreview', e.target.checked);
      this.app.livePreview = e.target.checked;
    });

    // Archive controls
    this.panel.querySelector('#autoArchive').addEventListener('change', (e) => {
      this.saveSetting('autoArchive', e.target.checked);
    });
    this.panel.querySelector('#archiveMode').addEventListener('change', (e) => {
      this.saveSetting('archiveMode', e.target.value);
    });
    this.panel.querySelector('#browseArchiveFolder').addEventListener('click', async () => {
      if (!window.windyAPI?.chooseArchiveFolder) return;
      const result = await window.windyAPI.chooseArchiveFolder();
      if (!result?.canceled && result?.path) {
        this.panel.querySelector('#archiveFolder').value = result.path;
        this.saveSetting('archiveFolder', result.path);
      }
    });
    this.panel.querySelector('#dropboxEnabled').addEventListener('change', (e) => {
      this.saveSetting('dropboxEnabled', e.target.checked);
    });
    this.panel.querySelector('#dropboxAccessToken').addEventListener('change', (e) => {
      this.saveSetting('dropboxAccessToken', e.target.value || '');
    });
    this.panel.querySelector('#dropboxFolder').addEventListener('change', (e) => {
      this.saveSetting('dropboxFolder', e.target.value || '/WindyProArchive');
    });
    this.panel.querySelector('#googleEnabled').addEventListener('change', (e) => {
      this.saveSetting('googleEnabled', e.target.checked);
    });
    this.panel.querySelector('#googleAccessToken').addEventListener('change', (e) => {
      this.saveSetting('googleAccessToken', e.target.value || '');
    });
    this.panel.querySelector('#googleFolderId').addEventListener('change', (e) => {
      this.saveSetting('googleFolderId', e.target.value || '');
    });
    this.panel.querySelector('#testDropbox').addEventListener('click', async () => {
      const res = await window.windyAPI?.testDropboxConnection?.();
      if (res?.ok && res?.testedAt) {
        this.updateLastTestIndicator('#dropboxLastTest', res.testedAt);
      }
      this.showToast(res?.ok ? 'Dropbox connection OK ✅' : `Dropbox failed: ${res?.error || 'unknown error'}`);
    });
    this.panel.querySelector('#testGoogle').addEventListener('click', async () => {
      const res = await window.windyAPI?.testGoogleConnection?.();
      if (res?.ok && res?.testedAt) {
        this.updateLastTestIndicator('#googleLastTest', res.testedAt);
      }
      this.showToast(res?.ok ? 'Google connection OK ✅' : `Google failed: ${res?.error || 'unknown error'}`);
    });

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
        if (settings.clearOnPaste !== undefined) {
          this.panel.querySelector('#clearOnPaste').checked = settings.clearOnPaste;
        }
        this.panel.querySelector('#livePreview').checked = settings.livePreview !== false;
        this.app.livePreview = settings.livePreview !== false;
        this.panel.querySelector('#autoArchive').checked = settings.autoArchive !== false;
        this.panel.querySelector('#archiveMode').value = settings.archiveMode || 'both';
        this.panel.querySelector('#archiveFolder').value = settings.archiveFolder || '';
        this.panel.querySelector('#dropboxEnabled').checked = !!settings.dropboxEnabled;
        this.panel.querySelector('#dropboxAccessToken').value = settings.dropboxAccessToken || '';
        this.panel.querySelector('#dropboxFolder').value = settings.dropboxFolder || '/WindyProArchive';
        this.updateLastTestIndicator('#dropboxLastTest', settings.dropboxLastTestAt);
        this.panel.querySelector('#googleEnabled').checked = !!settings.googleEnabled;
        this.panel.querySelector('#googleAccessToken').value = settings.googleAccessToken || '';
        this.panel.querySelector('#googleFolderId').value = settings.googleFolderId || '';
        this.updateLastTestIndicator('#googleLastTest', settings.googleLastTestAt);
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

  saveSetting(key, value) {
    if (window.windyAPI) {
      window.windyAPI.updateSettings({ [key]: value });
    }
    // Also persist cloud settings to localStorage (fallback for windows without windyAPI)
    const cloudKeys = ['engine', 'cloudUrl', 'cloudToken', 'cloudEmail', 'cloudPassword', 'cloudUser'];
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
}
