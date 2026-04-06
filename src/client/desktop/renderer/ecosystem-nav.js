/**
 * Ecosystem Navigation Bar
 * Provides quick switching between Windy products from the desktop app.
 */
class EcosystemNav {
  constructor(app) {
    this.app = app;
    this.activeProduct = 'word';
    this.bindEvents();
    this.startBadgePolling();
  }

  bindEvents() {
    document.querySelectorAll('.eco-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.product));
    });
  }

  navigate(product) {
    // Update active state visually
    document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-product="${product}"]`)?.classList.add('active');

    switch (product) {
      case 'word':
        this.showMainView();
        break;

      case 'chat':
        // Open the built-in chat window (BrowserWindow with chat.html)
        if (window.windyAPI?.openChat) {
          window.windyAPI.openChat();
          this.showToast('Opening Windy Chat...');
        } else {
          this.showToast('Chat not available', true);
        }
        // Revert active tab to Word since chat opens in a separate window
        setTimeout(() => {
          document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
          document.querySelector('[data-product="word"]')?.classList.add('active');
        }, 1500);
        break;

      case 'mail':
        this.openExternal('https://windymail.ai', 'Opening Windy Mail...');
        break;

      case 'cloud':
        this.openExternal('https://windyword.ai/app/cloud', 'Opening Windy Cloud...');
        break;

      case 'agent':
        this.openExternal('https://windyword.ai/app/fly', 'Opening Windy Fly...');
        break;

      case 'code':
        this.openExternal('https://windycode.ai', 'Opening Windy Code...');
        break;
    }

    this.activeProduct = product;
  }

  openExternal(url, message) {
    const api = window.windyAPI;
    if (api?.openExternal) {
      api.openExternal(url);
    } else if (api?.openExternalUrl) {
      api.openExternalUrl(url);
    } else {
      // Last resort — won't work in sandboxed renderer but worth trying
      window.open(url, '_blank');
    }
    if (message) this.showToast(message);

    // Revert active tab to Word since external links open in browser
    setTimeout(() => {
      document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-product="word"]')?.classList.add('active');
    }, 1500);
  }

  showMainView() {
    // Word tab is the default view — nothing to toggle
  }

  showToast(message, isError) {
    // Remove existing toast
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

  // Poll for notification badges every 30 seconds
  startBadgePolling() {
    this.updateBadges();
    setInterval(() => this.updateBadges(), 30000);
  }

  async updateBadges() {
    // Chat unread count
    try {
      if (window.windyChat?.getUnreadCount) {
        const count = await window.windyChat.getUnreadCount();
        this.setBadge('chatBadge', count);
      }
    } catch (_) {}

    // Mail unread (via account-server ecosystem-status)
    try {
      if (window.windyAPI?.getEcosystemStatus) {
        const status = await window.windyAPI.getEcosystemStatus();
        if (status?.products?.windy_mail?.unread_count) {
          this.setBadge('mailBadge', status.products.windy_mail.unread_count);
        }
      }
    } catch (_) {}
  }

  setBadge(elementId, count) {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
}
