/**
 * Ecosystem Navigation Bar
 * Provides quick switching between Windy products from the desktop app.
 * Embeds services as in-app webviews when available.
 * Shows aspirational placeholders when services aren't deployed yet.
 * Clone tab for digital twin marketplace. Code launches the desktop app.
 * Shows recording indicator on Word tab when recording from another tab.
 */
class EcosystemNav {
  constructor(app) {
    this.app = app;
    this.activeProduct = 'word';
    this.webviews = {};
    this.container = document.getElementById('ecoWebviewContainer');
    this.appEl = document.getElementById('app');
    this.isRecording = false;

    // Product config
    this.products = {
      chat: {
        name: 'Windy Chat',
        icon: '💬',
        url: 'https://chat.windyword.ai',
        localUrl: 'http://localhost:3000',
        description: 'End-to-end encrypted messaging with auto-translation in 99 languages.',
        tagline: 'Talk to anyone, in any language — instantly.',
        preview: 'Send messages that auto-translate in real time. Military-grade encryption. Works offline. Your agent lives here too.',
        comingSoonFeatures: ['Real-time translation in 99 languages', 'Bot-to-bot communication', 'Voice messages with auto-transcription', 'Group chats with live translation']
      },
      mail: {
        name: 'Windy Mail',
        icon: '✉️',
        url: 'https://windymail.ai',
        localUrl: null,
        description: 'Voice-first email — dictate, send, and manage mail without touching a keyboard.',
        tagline: 'Email that works for you, not against you.',
        preview: 'Dictate emails with your voice. Your AI agent gets its own inbox on day one. No more fighting OAuth tokens.',
        comingSoonFeatures: ['Dictate and send emails by voice', 'AI agent inbox (auto-provisioned)', 'Smart sorting and priority detection', 'Works with Gmail, Outlook, or standalone']
      },
      cloud: {
        name: 'Windy Cloud',
        icon: '☁️',
        url: 'https://cloud.windyfly.ai',
        localUrl: 'http://localhost:3000',
        description: 'Your personal cloud — files, compute, servers, and billing in one dashboard.',
        tagline: 'Your data, your cloud, your rules.',
        preview: 'All your Windy data in one place. Cloud GPU for speech-to-text. VPS servers on demand. Like iCloud, but for everything.',
        comingSoonFeatures: ['Unified file storage across all Windy products', 'Cloud GPU speech-to-text (faster than local)', 'VPS server provisioning', 'Encrypted backups with zero-knowledge option']
      },
      clone: {
        name: 'Windy Clone',
        icon: '🧬',
        url: 'https://windyclone.com',
        localUrl: 'http://localhost:5173',
        description: 'Turn your voice recordings into a digital twin that lives forever.',
        tagline: 'Your voice lives forever.',
        preview: 'Every recording you\'ve made is building something extraordinary. Windy Clone turns it into a voice twin, digital avatar, and soul file — through the best providers in the world.',
        comingSoonFeatures: ['Voice twin — your grandchildren hear YOUR voice', 'Digital avatar — a video likeness that looks like you', 'Provider marketplace — ElevenLabs, HeyGen, and more', 'One-button upload — we handle everything']
      },
      agent: {
        name: 'Windy Fly',
        icon: '🪰',
        url: null,
        localUrl: 'http://localhost:3000',
        description: 'Deploy and manage AI agents that work for you around the clock.',
        tagline: 'Your personal AI, born into the ecosystem.',
        preview: 'An AI agent that\'s born connected — with its own chat identity, email inbox, phone number, and verified passport. It works while you sleep.',
        comingSoonFeatures: ['Personality sliders (humor, formality, creativity...)', 'Memory management and skill learning', 'Born with Windy Chat + Windy Mail identity', 'Eternitas-verified passport from day one']
      }
    };

    this.bindEvents();
    this.startBadgePolling();
    this.watchRecordingState();
  }

  bindEvents() {
    document.querySelectorAll('.eco-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.product));
    });
  }

  // #6: Watch recording state and show indicator on Word tab when on other tabs
  watchRecordingState() {
    if (window.windyAPI?.onToggleRecording) {
      window.windyAPI.onToggleRecording((recording) => {
        this.isRecording = recording;
        this.updateRecordingIndicator();
      });
    }
    // Fallback: watch for the CSS class on the window element
    const observer = new MutationObserver(() => {
      const wasRecording = this.isRecording;
      this.isRecording = this.appEl.classList.contains('state-listening') ||
                         this.appEl.classList.contains('state-recording');
      if (wasRecording !== this.isRecording) this.updateRecordingIndicator();
    });
    observer.observe(this.appEl, { attributes: true, attributeFilter: ['class'] });
  }

  updateRecordingIndicator() {
    const wordBtn = document.querySelector('[data-product="word"]');
    if (!wordBtn) return;

    let indicator = wordBtn.querySelector('.eco-rec-indicator');

    if (this.isRecording && this.activeProduct !== 'word') {
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'eco-rec-indicator';
        indicator.textContent = '●';
        indicator.style.cssText = 'color:#EF4444;font-size:8px;position:absolute;top:2px;left:4px;animation:eco-rec-pulse 1s ease-in-out infinite;';
        wordBtn.appendChild(indicator);
      }
      indicator.style.display = '';
    } else if (indicator) {
      indicator.style.display = 'none';
    }
  }

  navigate(product) {
    if (product === this.activeProduct) return;

    document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-product="${product}"]`)?.classList.add('active');

    const previousProduct = this.activeProduct;
    this.activeProduct = product;

    // Update recording indicator when switching tabs
    this.updateRecordingIndicator();

    if (product === 'word') {
      this.showWord();
    } else if (product === 'code') {
      this.launchWindyCode();
      this.activeProduct = previousProduct;
      document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
      document.querySelector(`[data-product="${previousProduct}"]`)?.classList.add('active');
    } else {
      this.showProduct(product);
    }
  }

  showWord() {
    this.appEl.classList.remove('eco-embedded');
    this.container.style.display = 'none';
    Object.values(this.webviews).forEach(v => {
      if (v.wrapper) v.wrapper.style.display = 'none';
    });
  }

  async showProduct(product) {
    this.appEl.classList.add('eco-embedded');
    this.container.style.display = '';

    Object.values(this.webviews).forEach(v => {
      if (v.wrapper) v.wrapper.style.display = 'none';
    });

    const config = this.products[product];
    if (!config) return;

    if (this.webviews[product]) {
      this.webviews[product].wrapper.style.display = '';
      return;
    }

    // Try production URL first, then local dev, then aspirational placeholder
    if (config.url) {
      const prodLive = await this.checkUrl(config.url);
      if (prodLive) {
        this.createWebview(product, config.url);
        this.webviews[product].wrapper.style.display = '';
        return;
      }
    }

    if (config.localUrl) {
      const localLive = await this.checkUrl(config.localUrl);
      if (localLive) {
        this.createWebview(product, config.localUrl);
        this.webviews[product].wrapper.style.display = '';
        return;
      }
    }

    // #3: Aspirational placeholder (not dev-focused)
    this.createAspirationPlaceholder(product);
    this.webviews[product].wrapper.style.display = '';
  }

  async checkUrl(url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }

  // #3: Aspirational placeholders — exciting preview, not "not deployed" dead ends
  createAspirationPlaceholder(product) {
    const config = this.products[product];
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow-y:auto;background:var(--bg-primary);';

    const featuresHtml = config.comingSoonFeatures.map(f =>
      `<div style="display:flex;align-items:flex-start;gap:8px;margin:6px 0;">
        <span style="color:#8B5CF6;font-size:12px;margin-top:1px;">✦</span>
        <span style="color:var(--text-secondary);font-size:12px;line-height:1.4;">${f}</span>
      </div>`
    ).join('');

    wrapper.innerHTML = `
      <div style="max-width:400px;margin:0 auto;padding:32px 24px;text-align:center;">
        <div style="font-size:56px;margin-bottom:8px;">${config.icon}</div>
        <h2 style="color:var(--text-primary);font-size:22px;margin:0 0 4px;font-weight:700;">${config.name}</h2>
        <p style="color:#A78BFA;font-size:13px;font-style:italic;margin:0 0 16px;">${config.tagline}</p>

        <p style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin:0 0 24px;text-align:left;">
          ${config.preview}
        </p>

        <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);
                    border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">
          <div style="color:#A78BFA;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;
                      font-weight:700;margin-bottom:10px;">What's Coming</div>
          ${featuresHtml}
        </div>

        <div style="background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(79,70,229,0.1));
                    border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="color:var(--text-primary);font-size:14px;font-weight:600;margin-bottom:4px;">
            Launching Soon
          </div>
          <div style="color:var(--text-muted);font-size:11px;">
            ${config.name} is being built right now. When it goes live, it will appear here automatically.
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          ${config.url ? `
            <button class="eco-open-browser" style="padding:6px 14px;border-radius:8px;
                       border:1px solid rgba(255,255,255,0.1);background:transparent;
                       color:var(--text-muted);cursor:pointer;font-size:11px;">
              Visit ${config.name} website
            </button>
          ` : ''}
          <button class="eco-retry-connect" style="padding:6px 14px;border-radius:8px;
                     border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.1);
                     color:#A78BFA;cursor:pointer;font-size:11px;font-weight:600;">
            Check if it's live
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(wrapper);
    this.webviews[product] = { wrapper };

    wrapper.querySelector('.eco-retry-connect')?.addEventListener('click', () => {
      wrapper.remove();
      delete this.webviews[product];
      this.showProduct(product);
    });

    wrapper.querySelector('.eco-open-browser')?.addEventListener('click', () => {
      const api = window.windyAPI;
      if (api?.openExternal) api.openExternal(config.url);
      else if (api?.openExternalUrl) api.openExternalUrl(config.url);
    });
  }

  createWebview(product, url) {
    const config = this.products[product];
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;';

    const toolbar = document.createElement('div');
    toolbar.className = 'eco-webview-toolbar';
    toolbar.innerHTML = `
      <button class="eco-nav-back" title="Back">◀</button>
      <button class="eco-nav-fwd" title="Forward">▶</button>
      <button class="eco-nav-reload" title="Reload">↻</button>
      <span class="eco-url-label">${url}</span>
      <button class="eco-nav-external" title="Open in browser">↗</button>
    `;
    wrapper.appendChild(toolbar);

    const loading = document.createElement('div');
    loading.className = 'eco-webview-loading';
    loading.innerHTML = `<div class="eco-spinner"></div><span>Loading ${config.name}...</span>`;
    wrapper.appendChild(loading);

    // #5: Shared auth — pass JWT to webview via partition + preload
    const webview = document.createElement('webview');
    webview.src = url;
    webview.style.cssText = 'flex:1;border:none;';
    webview.setAttribute('partition', 'persist:ecosystem');
    webview.setAttribute('allowpopups', '');
    wrapper.appendChild(webview);

    this.container.appendChild(wrapper);

    // Inject auth token into webview after load
    webview.addEventListener('did-finish-load', () => {
      loading.style.display = 'none';
      // #5: SSO prep — inject JWT into webview's localStorage
      this.injectAuth(webview);
    });

    toolbar.querySelector('.eco-nav-back').addEventListener('click', () => {
      if (webview.canGoBack()) webview.goBack();
    });
    toolbar.querySelector('.eco-nav-fwd').addEventListener('click', () => {
      if (webview.canGoForward()) webview.goForward();
    });
    toolbar.querySelector('.eco-nav-reload').addEventListener('click', () => webview.reload());
    toolbar.querySelector('.eco-nav-external').addEventListener('click', () => {
      const api = window.windyAPI;
      if (api?.openExternal) api.openExternal(webview.getURL());
      else if (api?.openExternalUrl) api.openExternalUrl(webview.getURL());
    });

    webview.addEventListener('did-navigate', (e) => {
      toolbar.querySelector('.eco-url-label').textContent = e.url;
    });
    webview.addEventListener('did-navigate-in-page', (e) => {
      toolbar.querySelector('.eco-url-label').textContent = e.url;
    });

    webview.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return;
      loading.innerHTML = `
        <span style="font-size:24px;">⚠️</span>
        <span style="color:var(--text-secondary);font-size:13px;">${config.name} isn't reachable</span>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="eco-retry-btn"
                  style="padding:6px 14px;border-radius:6px;border:1px solid rgba(139,92,246,0.4);
                         background:rgba(139,92,246,0.15);color:#A78BFA;cursor:pointer;font-size:11px;font-weight:600;">
            Retry
          </button>
          <button class="eco-fallback-btn"
                  style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);
                         background:transparent;color:var(--text-muted);cursor:pointer;font-size:11px;">
            Open in browser
          </button>
        </div>
      `;
      loading.style.display = '';
      loading.querySelector('.eco-retry-btn')?.addEventListener('click', () => {
        loading.innerHTML = `<div class="eco-spinner"></div><span>Loading ${config.name}...</span>`;
        webview.reload();
      });
      loading.querySelector('.eco-fallback-btn')?.addEventListener('click', () => {
        const api = window.windyAPI;
        if (api?.openExternal) api.openExternal(url);
        else if (api?.openExternalUrl) api.openExternalUrl(url);
      });
    });

    this.webviews[product] = { webview, toolbar, wrapper, loading };
  }

  // #5: Inject Windy Pro auth token into embedded webviews for SSO
  async injectAuth(webview) {
    try {
      if (window.windyAPI?.getAuthToken) {
        const token = await window.windyAPI.getAuthToken();
        if (token) {
          webview.executeJavaScript(`
            try {
              localStorage.setItem('windy_auth_token', '${token}');
              localStorage.setItem('windy_jwt', '${token}');
            } catch(e) {}
          `);
        }
      }
    } catch (_) {}
  }

  async launchWindyCode() {
    if (window.windyAPI?.launchWindyCode) {
      const result = await window.windyAPI.launchWindyCode();
      if (result?.launched) {
        this.showToast('Launching Windy Code...');
        return;
      }
    }
    this.showCodePanel();
  }

  showCodePanel() {
    this.appEl.classList.add('eco-embedded');
    this.container.style.display = '';

    Object.values(this.webviews).forEach(v => {
      if (v.wrapper) v.wrapper.style.display = 'none';
    });

    if (!this.webviews['code']) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-primary);';
      wrapper.innerHTML = `
        <div style="text-align:center;max-width:360px;padding:32px;">
          <div style="font-size:56px;margin-bottom:8px;">💻</div>
          <h2 style="color:var(--text-primary);font-size:22px;margin:0 0 4px;font-weight:700;">Windy Code</h2>
          <p style="color:#A78BFA;font-size:13px;font-style:italic;margin:0 0 16px;">Code with your voice, build with AI.</p>
          <p style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin:0 0 20px;">
            AI-native IDE built on VS Code — optimized for voice-first, agent-assisted development.
            Windy Code is a standalone desktop application.
          </p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button id="ecoCodeLaunch" style="padding:8px 20px;border-radius:8px;border:none;
                       background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#fff;cursor:pointer;
                       font-size:12px;font-weight:600;">
              Launch Windy Code
            </button>
            <button id="ecoCodeDownload" style="padding:8px 20px;border-radius:8px;
                       border:1px solid rgba(139,92,246,0.3);background:transparent;
                       color:#A78BFA;cursor:pointer;font-size:12px;font-weight:600;">
              Download
            </button>
          </div>
        </div>
      `;
      this.container.appendChild(wrapper);
      this.webviews['code'] = { wrapper };

      wrapper.querySelector('#ecoCodeLaunch').addEventListener('click', async () => {
        if (window.windyAPI?.launchWindyCode) {
          const result = await window.windyAPI.launchWindyCode();
          if (result?.launched) {
            this.showToast('Launching Windy Code...');
            return;
          }
        }
        this.showToast('Windy Code not found — please download it first', true);
      });

      wrapper.querySelector('#ecoCodeDownload').addEventListener('click', () => {
        const api = window.windyAPI;
        if (api?.openExternal) api.openExternal('https://windycode.ai');
        else if (api?.openExternalUrl) api.openExternalUrl('https://windycode.ai');
      });
    }

    this.webviews['code'].wrapper.style.display = '';
    this.activeProduct = 'code';
  }

  showToast(message, isError) {
    const existing = document.getElementById('eco-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'eco-toast';
    toast.textContent = message;
    toast.style.cssText = `position:fixed; top:80px; left:50%; transform:translateX(-50%);
      background:${isError ? '#dc2626' : 'rgba(30,41,59,0.95)'}; color:#fff; padding:8px 20px;
      border-radius:8px; font-size:12px; font-weight:600; z-index:9999;
      box-shadow:0 4px 12px rgba(0,0,0,0.3); border:1px solid ${isError ? '#ef4444' : 'rgba(255,255,255,0.1)'};
      animation:toast-in 0.2s ease-out;`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // #8: Enhanced badge polling — more sources, faster for active tabs
  startBadgePolling() {
    this.updateBadges();
    // Poll every 15s instead of 30s for better responsiveness
    setInterval(() => this.updateBadges(), 15000);
  }

  async updateBadges() {
    // Chat unread
    try {
      if (window.windyChat?.getUnreadCount) {
        const count = await window.windyChat.getUnreadCount();
        this.setBadge('chatBadge', count);
      }
    } catch (_) {}

    // Mail unread + other ecosystem status
    try {
      if (window.windyAPI?.getEcosystemStatus) {
        const status = await window.windyAPI.getEcosystemStatus();
        if (status?.products?.windy_mail?.unread_count) {
          this.setBadge('mailBadge', status.products.windy_mail.unread_count);
        }
        // Clone training notification
        if (status?.products?.windy_clone?.active_training) {
          this.setBadge('cloneBadge', '!');
        }
      }
    } catch (_) {}
  }

  setBadge(elementId, count) {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    if (count && count !== 0) {
      badge.textContent = typeof count === 'number' ? (count > 99 ? '99+' : String(count)) : count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
}
