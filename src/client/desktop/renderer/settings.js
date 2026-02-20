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
          <h3>🎤 Transcription</h3>
          <div class="setting-row">
            <label for="modelSelect">Model Size</label>
            <select id="modelSelect">
              <option value="tiny">Tiny (75MB — fastest)</option>
              <option value="base" selected>Base (150MB — balanced)</option>
              <option value="small">Small (500MB — accurate)</option>
              <option value="medium">Medium (1.5GB — high quality)</option>
              <option value="large-v3">Large (3GB — best quality)</option>
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
          <p class="settings-about">Windy Pro v0.1.0<br>Voice-to-text with the Green Strobe guarantee.</p>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Close button
    this.panel.querySelector('#settingsClose').addEventListener('click', () => this.close());

    // Model change
    this.panel.querySelector('#modelSelect').addEventListener('change', (e) => {
      this.saveSetting('model', e.target.value);
      // Send config update to server
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
        this.app.ws.send(JSON.stringify({
          action: 'config',
          config: { model: e.target.value }
        }));
      }
    });

    // Device change (T18: propagate to server)
    this.panel.querySelector('#deviceSelect').addEventListener('change', (e) => {
      this.saveSetting('device', e.target.value);
      if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
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
