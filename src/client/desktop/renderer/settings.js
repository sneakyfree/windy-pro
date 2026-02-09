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

        // Device change
        this.panel.querySelector('#deviceSelect').addEventListener('change', (e) => {
            this.saveSetting('device', e.target.value);
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

    loadSettings() {
        if (!window.windyAPI) return;

        try {
            const settings = window.windyAPI.getSettings();
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
            }
        } catch (e) {
            // Settings not available yet, use defaults
        }
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
