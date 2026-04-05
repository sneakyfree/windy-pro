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
    // Update active state
    document.querySelectorAll('.eco-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-product="${product}"]`)?.classList.add('active');

    switch (product) {
      case 'word':
        // Already here — show main Windy Word view
        this.showMainView();
        break;
      case 'chat':
        // Open chat in the built-in panel (electron window)
        if (window.windyAPI?.openChat) window.windyAPI.openChat();
        break;
      case 'mail':
        // Open Windy Mail in browser
        if (window.windyAPI?.openExternal) window.windyAPI.openExternal('https://mail.windypro.com');
        break;
      case 'cloud':
        if (window.windyAPI?.openExternal) window.windyAPI.openExternal('https://cloud.windypro.com');
        break;
      case 'agent':
        if (window.windyAPI?.openExternal) window.windyAPI.openExternal('https://fly.windypro.com');
        break;
      case 'code':
        if (window.windyAPI?.openExternal) window.windyAPI.openExternal('https://code.windypro.com');
        break;
    }

    this.activeProduct = product;
  }

  showMainView() {
    // Ensure main Windy Word UI is visible (in case something else was shown)
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
