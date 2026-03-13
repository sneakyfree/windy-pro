/**
 * Windy Pro — Marketplace Panel (L2) — Hardened
 *
 * Browsable pair catalog, bundles, downloads, and storage management.
 * Loaded as a deferred script in the main renderer window.
 *
 * DNA Strand: L2
 */

'use strict';

// eslint-disable-next-line no-unused-vars
class MarketplacePanel {
  /**
   * @param {WindyApp} app — reference to the main app instance
   */
  constructor(app) {
    this.app = app;
    this.catalog = [];
    this.bundles = [];
    this.downloadedPairs = [];
    this.storageInfo = { usedBytes: 0, availableBytes: 0, pairs: [] };
    this.activeDownloads = new Map(); // pairId → { percent, speed, eta }

    // Filter state
    this.filters = {
      search: '',
      region: 'all',
      quality: 'all',
      sort: 'popularity'
    };

    // Pagination
    this._visibleCount = 15;
    this._PAGE_SIZE = 15;

    // Panel element
    this.panel = null;
    this._initialized = false;
    this._loading = false;

    // Keyboard navigation cleanup
    this._keydownHandlers = [];
  }

  /* ═══════════════════════════════════════
     Init — Load data from IPC
     ═══════════════════════════════════════ */

  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this._loading = true;

    try {
      const api = window.windyAPI || {};
      const [catalog, bundles, downloaded, storage] = await Promise.all([
        api.pairCatalog?.() || [],
        api.pairBundles?.() || [],
        api.pairListDownloaded?.() || [],
        api.pairStorageInfo?.() || { usedBytes: 0, availableBytes: 0, pairs: [] }
      ]);

      this.catalog = Array.isArray(catalog) ? catalog : [];
      this.bundles = Array.isArray(bundles) ? bundles : [];
      this.downloadedPairs = Array.isArray(downloaded) ? downloaded : [];
      this.storageInfo = storage || { usedBytes: 0, availableBytes: 0, pairs: [] };
    } catch (err) {
      console.warn('[Marketplace] Init failed:', err.message);
      this._showErrorBanner('Failed to load marketplace data. Please try again.', () => {
        this._initialized = false;
        this._loading = false;
        this.init().then(() => this.render());
      });
    } finally {
      this._loading = false;
    }

    // Listen for download progress events
    try {
      const api2 = window.windyAPI || {};
      if (api2.onPairDownloadProgress) {
        api2.onPairDownloadProgress((data) => {
          if (!data || !data.pairId) return;
          if (data.percent >= 100) {
            this.activeDownloads.delete(data.pairId);
            if (!this.downloadedPairs.includes(data.pairId)) {
              this.downloadedPairs.push(data.pairId);
            }
            this._refreshStorageInfo();
          } else {
            this.activeDownloads.set(data.pairId, data);
          }
          this._updateDownloadUI(data.pairId);
        });
      }
    } catch (err) {
      console.warn('[Marketplace] Progress listener failed:', err.message);
    }
  }

  /* ═══════════════════════════════════════
     Toggle
     ═══════════════════════════════════════ */

  toggle() {
    if (this.panel && this.panel.classList.contains('visible')) {
      this.hide();
    } else {
      this.show();
    }
  }

  async show() {
    await this.init();
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = 'marketplace-panel';
      this.panel.id = 'marketplacePanel';
      document.body.appendChild(this.panel);
    }
    this.render();
    this.panel.classList.add('visible');
  }

  hide() {
    if (this.panel) {
      this.panel.classList.remove('visible');
    }
  }

  get isVisible() {
    return this.panel && this.panel.classList.contains('visible');
  }

  /* ═══════════════════════════════════════
     Render — Build Full HTML
     ═══════════════════════════════════════ */

  render() {
    if (!this.panel) return;
    this._visibleCount = this._PAGE_SIZE;

    // Show loading skeleton if still loading
    if (this._loading) {
      this.panel.innerHTML = `<div class="marketplace-inner">
        ${this._renderLoadingSkeleton()}
      </div>`;
      return;
    }

    // Handle empty catalog
    if (this.catalog.length === 0 && this.bundles.length === 0) {
      this.panel.innerHTML = `<div class="marketplace-inner">
        ${this._renderEmptyCatalog()}
      </div>`;
      return;
    }

    this.panel.innerHTML = `<div class="marketplace-inner">
      ${this._renderHero()}
      ${this._renderBundles()}
      ${this._renderYourEngines()}
      ${this._renderDiscover()}
    </div>
    ${this._renderPickerModal()}`;

    this._bindEvents();
  }

  /* ── Loading Skeleton ── */

  _renderLoadingSkeleton() {
    const skeletonCard = `
      <div class="mp-skeleton-card" aria-hidden="true">
        <div class="mp-skeleton-line" style="width:60%;height:18px;margin-bottom:8px;"></div>
        <div class="mp-skeleton-line" style="width:40%;height:14px;margin-bottom:12px;"></div>
        <div class="mp-skeleton-line" style="width:80%;height:32px;"></div>
      </div>`;

    return `
      <div class="mp-section-title"><span class="mp-icon">⏳</span> Loading Marketplace…</div>
      <div class="mp-bundles-row">
        ${skeletonCard}${skeletonCard}${skeletonCard}
      </div>
      <div class="mp-section-title" style="margin-top:20px;"><span class="mp-icon">🔍</span> Discover</div>
      <div class="mp-catalog-grid">
        ${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}
      </div>
      <style>
        .mp-skeleton-card { background:rgba(255,255,255,.03); border-radius:12px; padding:16px; }
        .mp-skeleton-line { background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.04) 75%);
          background-size:200% 100%; border-radius:6px; animation:mpSkeletonPulse 1.5s infinite; }
        @keyframes mpSkeletonPulse { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }
      </style>`;
  }

  /* ── Empty Catalog ── */

  _renderEmptyCatalog() {
    return `
      <div class="mp-empty-state" style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">🌐</div>
        <div style="font-size:16px;font-weight:600;color:#F5F5F5;margin-bottom:8px;">No engines available</div>
        <div style="font-size:13px;color:#94A3B8;margin-bottom:20px;">
          The engine catalog couldn't be loaded. Check your connection and try again.
        </div>
        <button class="mp-retry-btn" id="mpRetryBtn" style="padding:10px 24px;border:none;border-radius:8px;
          background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;font-weight:600;cursor:pointer;
          font-size:14px;transition:transform .1s;">
          🔄 Retry
        </button>
      </div>`;
  }

  /* ── Error Banner ── */

  _showErrorBanner(message, retryFn) {
    if (!this.panel) return;
    const existing = this.panel.querySelector('.mp-error-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'mp-error-banner';
    banner.style.cssText = 'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px 16px;margin:12px 0;display:flex;align-items:center;gap:10px;';
    banner.innerHTML = `
      <span style="font-size:18px;">⚠️</span>
      <span style="flex:1;font-size:13px;color:#FCA5A5;">${this._esc(message)}</span>
      ${retryFn ? '<button class="mp-error-retry" style="padding:6px 14px;border:none;border-radius:6px;background:rgba(239,68,68,.2);color:#FCA5A5;cursor:pointer;font-size:12px;font-weight:600;">Retry</button>' : ''}
      <button class="mp-error-dismiss" style="background:none;border:none;color:#64748B;cursor:pointer;font-size:16px;padding:2px 4px;">×</button>
    `;
    banner.querySelector('.mp-error-dismiss')?.addEventListener('click', () => banner.remove());
    if (retryFn) {
      banner.querySelector('.mp-error-retry')?.addEventListener('click', () => {
        banner.remove();
        retryFn();
      });
    }
    this.panel.prepend(banner);
  }

  /* ── 1. Marco Polo Hero Banner ── */

  _renderHero() {
    // Check if dismissed and not expired
    const dismissedAt = localStorage.getItem('mp_hero_dismissed');
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < 7 * 24 * 60 * 60 * 1000) return ''; // Within 7 days
    }

    // Check if user already owns Marco Polo
    const ownsMarcoPolo = localStorage.getItem('mp_owns_marco_polo') === 'true';
    if (ownsMarcoPolo) return '';

    return `
      <div class="mp-hero" id="mpHero">
        <button class="mp-hero-dismiss" id="mpHeroDismiss" title="Dismiss" aria-label="Dismiss banner">&times;</button>
        <div class="mp-hero-title">🧭 Marco Polo's Magic Box</div>
        <div class="mp-hero-sub">Every language on Earth. 2,500 engines. Offline forever.<br>
          Download once, translate anywhere — no internet needed.</div>
        <div class="mp-hero-price"><span class="mp-strike">$17,475 value</span> → $999</div>
        <button class="mp-hero-cta" id="mpHeroCta">Get Marco Polo's Magic Box →</button>
      </div>`;
  }

  /* ── 2. Bundle Cards ── */

  _renderBundles() {
    const bundleData = [
      { id: 'traveler-25', icon: '🧳', label: '25 engines · $49', cta: 'Browse & Pick' },
      { id: 'polyglot-200', icon: '🗣️', label: '200 engines · $149', cta: 'Browse & Pick' },
      { id: 'marco-polo', icon: '🧭', label: 'ALL 2,500 · $999', cta: 'Own Everything' }
    ];

    const cards = bundleData.map(b => {
      const bundle = this.bundles.find(x => x.id === b.id);
      const name = bundle ? bundle.name : b.id;
      return `
        <div class="mp-bundle-card" data-bundle="${this._esc(b.id)}" tabindex="0" role="button" aria-label="${this._esc(name)} — ${b.label}">
          <div class="mp-bundle-icon">${b.icon}</div>
          <div class="mp-bundle-name">${this._esc(name)}</div>
          <div class="mp-bundle-meta">${b.label}</div>
          <button class="mp-bundle-btn">${b.cta}</button>
        </div>`;
    }).join('');

    return `
      <div class="mp-section-title"><span class="mp-icon">📦</span> Bundles</div>
      <div class="mp-bundles-row">${cards}</div>`;
  }

  /* ── 3. Your Engines ── */

  _renderYourEngines() {
    let content;

    if (this.downloadedPairs.length === 0) {
      const freeCount = this.catalog.filter(p => p.includedInTier === 'free').length;
      content = `
        <div class="mp-empty-state">
          <div class="mp-empty-icon">🌍</div>
          <div>No engines yet. Your plan includes ${freeCount || 'some'} free — browse below!</div>
        </div>`;
    } else {
      const rows = this.downloadedPairs.map(pairId => {
        const pair = this.catalog.find(p => p.id === pairId);
        if (!pair) return '';
        const stars = this._stars(pair.quality || 3);
        return `
          <div class="mp-engine-row" data-pair-id="${this._esc(pairId)}">
            <span class="mp-engine-flags">${pair.sourceFlag || '🏳️'} ${pair.targetFlag || '🏳️'}</span>
            <span class="mp-engine-name">${this._esc(pair.sourceName)} ↔ ${this._esc(pair.targetName)}</span>
            <span class="mp-engine-quality">${stars}</span>
            <span class="mp-engine-size">${pair.sizeMB || '?'} MB</span>
            <span class="mp-engine-status">✅ Downloaded</span>
            <button class="mp-engine-manage" data-delete-pair="${this._esc(pairId)}">Delete</button>
          </div>`;
      }).join('');

      content = `<div class="mp-engines-list">${rows}</div>`;
    }

    // Storage bar
    const usedGB = (this.storageInfo.usedBytes / (1024 * 1024 * 1024)).toFixed(1);
    const totalGB = ((this.storageInfo.usedBytes + this.storageInfo.availableBytes) / (1024 * 1024 * 1024)).toFixed(0);
    const pct = this.storageInfo.usedBytes + this.storageInfo.availableBytes > 0
      ? Math.min(100, Math.round((this.storageInfo.usedBytes / (this.storageInfo.usedBytes + this.storageInfo.availableBytes)) * 100))
      : 0;

    return `
      <div class="mp-section-title"><span class="mp-icon">🗂️</span> Your Engines</div>
      ${content}
      <div class="mp-storage-bar-wrap">
        <div class="mp-storage-label">Used: ${usedGB} GB / ${totalGB} GB</div>
        <div class="mp-storage-track">
          <div class="mp-storage-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  /* ── 4. Discover Catalog ── */

  _renderDiscover() {
    return `
      <div class="mp-section-title"><span class="mp-icon">🔍</span> Discover</div>
      <div class="mp-filter-bar">
        <input type="text" class="mp-search" id="mpSearch" placeholder="🔍 Search languages..." aria-label="Search languages" maxlength="100">
        <select class="mp-filter-select" id="mpRegion" aria-label="Filter by region">
          <option value="all">All Regions</option>
          <option value="americas">🌎 Americas</option>
          <option value="europe">🌍 Europe</option>
          <option value="asia">🌏 Asia</option>
          <option value="meaf">🌍 Middle East & Africa</option>
        </select>
        <select class="mp-filter-select" id="mpQuality" aria-label="Filter by quality">
          <option value="all">All Quality</option>
          <option value="5">★★★★★ Excellent</option>
          <option value="4">★★★★ Very Good</option>
          <option value="3">★★★ Good</option>
          <option value="2">★★ Functional</option>
        </select>
        <select class="mp-filter-select" id="mpSort" aria-label="Sort by">
          <option value="popularity">Popularity</option>
          <option value="quality">Quality</option>
          <option value="size">Size</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>
      <div class="mp-catalog-grid" id="mpCatalogGrid"></div>
      <button class="mp-load-more" id="mpLoadMore" style="display:none">Load More</button>`;
  }

  /* ── 5. Bundle Picker Modal ── */

  _renderPickerModal() {
    return `
      <div class="mp-picker-overlay" id="mpPickerOverlay">
        <div class="mp-picker-container">
          <div class="mp-picker-header">
            <div>
              <div class="mp-picker-title" id="mpPickerTitle">Select Your Pairs</div>
              <div class="mp-picker-counter" id="mpPickerCounter">0 of 0 selected</div>
            </div>
            <button class="mp-picker-close" id="mpPickerClose">&times;</button>
          </div>
          <div class="mp-picker-controls">
            <input type="text" class="mp-picker-search" id="mpPickerSearch" placeholder="🔍 Search..." maxlength="100">
            <button class="mp-picker-region-btn" data-region="all">All</button>
            <button class="mp-picker-region-btn" data-region="americas">🌎</button>
            <button class="mp-picker-region-btn" data-region="europe">🌍</button>
            <button class="mp-picker-region-btn" data-region="asia">🌏</button>
            <button class="mp-picker-region-btn" data-region="meaf">🌍 ME</button>
          </div>
          <div class="mp-picker-list" id="mpPickerList"></div>
          <div class="mp-picker-footer">
            <div class="mp-picker-counter" id="mpPickerFooterCounter">0 of 0 selected</div>
            <button class="mp-picker-confirm" id="mpPickerConfirm" disabled>Confirm & Checkout</button>
          </div>
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════
     Event Binding
     ═══════════════════════════════════════ */

  _bindEvents() {
    // Hero dismiss
    const heroX = this.panel.querySelector('#mpHeroDismiss');
    heroX?.addEventListener('click', () => {
      localStorage.setItem('mp_hero_dismissed', String(Date.now()));
      const hero = this.panel.querySelector('#mpHero');
      if (hero) hero.style.display = 'none';
    });

    // Hero CTA → open Marco Polo bundle picker
    const heroCta = this.panel.querySelector('#mpHeroCta');
    heroCta?.addEventListener('click', () => {
      this._openPicker('marco-polo');
    });

    // Bundle card clicks + keyboard
    this.panel.querySelectorAll('.mp-bundle-card').forEach(card => {
      const handler = () => {
        const bundleId = card.dataset.bundle;
        this._openPicker(bundleId);
      };
      card.addEventListener('click', handler);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });

    // Delete pair buttons
    this.panel.querySelectorAll('[data-delete-pair]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pairId = btn.dataset.deletePair;
        if (!confirm(`Delete ${pairId}? This will free storage but you'll need to re-download.`)) return;
        try {
          await window.windyAPI.pairDelete(pairId);
          this.downloadedPairs = this.downloadedPairs.filter(p => p !== pairId);
          await this._refreshStorageInfo();
          this.render();
        } catch (err) {
          console.error('[Marketplace] Delete failed:', err);
          this._showErrorBanner('Failed to delete engine. Please try again.');
        }
      });
    });

    // Filter controls
    const search = this.panel.querySelector('#mpSearch');
    const region = this.panel.querySelector('#mpRegion');
    const quality = this.panel.querySelector('#mpQuality');
    const sort = this.panel.querySelector('#mpSort');

    search?.addEventListener('input', () => {
      this.filters.search = search.value.trim().toLowerCase();
      this._visibleCount = this._PAGE_SIZE;
      this._renderCatalogGrid();
    });
    region?.addEventListener('change', () => {
      this.filters.region = region.value;
      this._visibleCount = this._PAGE_SIZE;
      this._renderCatalogGrid();
    });
    quality?.addEventListener('change', () => {
      this.filters.quality = quality.value;
      this._visibleCount = this._PAGE_SIZE;
      this._renderCatalogGrid();
    });
    sort?.addEventListener('change', () => {
      this.filters.sort = sort.value;
      this._visibleCount = this._PAGE_SIZE;
      this._renderCatalogGrid();
    });

    // Load More
    const loadMore = this.panel.querySelector('#mpLoadMore');
    loadMore?.addEventListener('click', () => {
      this._visibleCount += this._PAGE_SIZE;
      this._renderCatalogGrid();
    });

    // Retry button (empty catalog)
    const retryBtn = this.panel.querySelector('#mpRetryBtn');
    retryBtn?.addEventListener('click', () => {
      this._initialized = false;
      this._loading = false;
      this.init().then(() => this.render());
    });

    // Picker events
    this._bindPickerEvents();

    // Initial catalog render
    this._renderCatalogGrid();
  }

  /* ═══════════════════════════════════════
     Catalog Grid Rendering
     ═══════════════════════════════════════ */

  _getFilteredCatalog() {
    let pairs = [...this.catalog];

    // Search
    if (this.filters.search) {
      const q = this.filters.search;
      pairs = pairs.filter(p =>
        (p.sourceName || '').toLowerCase().includes(q) ||
        (p.targetName || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }

    // Region
    if (this.filters.region !== 'all') {
      pairs = pairs.filter(p => p.region === this.filters.region);
    }

    // Quality
    if (this.filters.quality !== 'all') {
      pairs = pairs.filter(p => p.quality === parseInt(this.filters.quality, 10));
    }

    // Sort
    switch (this.filters.sort) {
      case 'quality':
        pairs.sort((a, b) => (b.quality || 0) - (a.quality || 0));
        break;
      case 'size':
        pairs.sort((a, b) => (b.sizeMB || 0) - (a.sizeMB || 0));
        break;
      case 'alpha':
        pairs.sort((a, b) => (a.targetName || '').localeCompare(b.targetName || ''));
        break;
      case 'popularity':
      default:
        pairs.sort((a, b) => (a.popularity || 999) - (b.popularity || 999));
        break;
    }

    return pairs;
  }

  _renderCatalogGrid() {
    const grid = this.panel.querySelector('#mpCatalogGrid');
    const loadMoreBtn = this.panel.querySelector('#mpLoadMore');
    if (!grid) return;

    const filtered = this._getFilteredCatalog();
    const visible = filtered.slice(0, this._visibleCount);
    const hasMore = filtered.length > this._visibleCount;

    // Group by region if not searching and sort is popularity
    const useRegionGroups = !this.filters.search && this.filters.region === 'all' && this.filters.sort === 'popularity';

    let html = '';
    let lastRegion = '';

    const REGION_LABELS = {
      americas: '🌎 Americas',
      europe: '🌍 Europe',
      asia: '🌏 Asia',
      meaf: '🌍 Middle East & Africa'
    };

    visible.forEach(pair => {
      if (useRegionGroups && pair.region !== lastRegion) {
        lastRegion = pair.region;
        html += `<div class="mp-region-header">${REGION_LABELS[pair.region] || pair.region}</div>`;
      }
      html += this._renderPairCard(pair);
    });

    // Show empty search state
    if (filtered.length === 0 && this.filters.search) {
      html = `<div class="mp-empty-state" style="grid-column:1/-1;text-align:center;padding:30px;">
        <div style="font-size:32px;margin-bottom:8px;">🔍</div>
        <div style="color:#94A3B8;">No engines match "${this._esc(this.filters.search)}"</div>
      </div>`;
    }

    grid.innerHTML = html;

    // Load More visibility
    if (loadMoreBtn) {
      loadMoreBtn.style.display = hasMore ? '' : 'none';
      loadMoreBtn.textContent = `Load More (${filtered.length - this._visibleCount} remaining)`;
    }

    // Bind card action buttons
    grid.querySelectorAll('.mp-pair-action.buy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pairId = btn.dataset.pairId;
        this._handleBuyPair(pairId);
      });
    });

    grid.querySelectorAll('.mp-pair-action.included').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pairId = btn.dataset.pairId;
        this._handleDownloadPair(pairId);
      });
    });

    // Keyboard navigation for pair cards
    grid.querySelectorAll('.mp-pair-card').forEach(card => {
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const actionBtn = card.querySelector('.mp-pair-action.buy, .mp-pair-action.included');
          if (actionBtn) actionBtn.click();
        }
      });
    });
  }

  _renderPairCard(pair) {
    const isDownloaded = this.downloadedPairs.includes(pair.id);
    const isDownloading = this.activeDownloads.has(pair.id);
    const isIncluded = pair.includedInTier === 'free'; // TODO: check user tier
    const stars = this._stars(pair.quality || 3);

    let actionHtml;
    if (isDownloaded) {
      actionHtml = `<div class="mp-pair-action downloaded">✅ Downloaded</div>`;
    } else if (isDownloading) {
      const dl = this.activeDownloads.get(pair.id);
      const pct = dl?.percent || 0;
      actionHtml = `<div class="mp-pair-action downloading" data-pair-id="${this._esc(pair.id)}">
        <div class="mp-dl-fill" style="width:${pct}%"></div>
        <span>Downloading ${pct}%</span>
      </div>`;
    } else if (isIncluded) {
      actionHtml = `<button class="mp-pair-action included" data-pair-id="${this._esc(pair.id)}">Download ✓ Included</button>`;
    } else {
      actionHtml = `<button class="mp-pair-action buy" data-pair-id="${this._esc(pair.id)}">Buy $${(pair.price || 6.99).toFixed(2)}</button>`;
    }

    const pairLabel = pair.bidirectional
      ? `${this._esc(pair.sourceName)} ↔ ${this._esc(pair.targetName)}`
      : `${this._esc(pair.sourceName)} → ${this._esc(pair.targetName)}`;

    return `
      <div class="mp-pair-card" data-pair-id="${this._esc(pair.id)}" tabindex="0" role="button"
           aria-label="${this._esc(pair.sourceName)} to ${this._esc(pair.targetName)}, ${this._esc(pair.qualityLabel || '')}, ${pair.sizeMB || '?'} MB">
        <div class="mp-pair-flags">
          ${pair.sourceFlag || '🏳️'} <span class="mp-arrow">↔</span> ${pair.targetFlag || '🏳️'}
        </div>
        <div class="mp-pair-name">${pairLabel}</div>
        <div class="mp-pair-meta">
          <span class="mp-pair-stars">${stars}</span>
          <span class="mp-pair-quality-label">${this._esc(pair.qualityLabel || '')}</span>
          <span>${pair.sizeMB || '?'} MB</span>
        </div>
        ${actionHtml}
      </div>`;
  }

  /* ═══════════════════════════════════════
     Bundle Picker
     ═══════════════════════════════════════ */

  _currentPicker = null; // { bundleId, maxPairs, selectedIds: Set }

  _openPicker(bundleId) {
    const bundle = this.bundles.find(b => b.id === bundleId);
    if (!bundle) return;

    const maxPairs = bundle.pairCount || 25;
    const isAll = !bundle.selectable; // Marco Polo = select all

    this._currentPicker = {
      bundleId,
      maxPairs,
      isAll,
      selectedIds: new Set(),
      searchFilter: '',
      regionFilter: 'all'
    };

    // If Marco Polo, pre-select all
    if (isAll) {
      this.catalog.forEach(p => this._currentPicker.selectedIds.add(p.id));
    }

    const overlay = this.panel.querySelector('#mpPickerOverlay');
    const title = this.panel.querySelector('#mpPickerTitle');
    if (title) title.textContent = `${bundle.icon} ${bundle.name}`;

    this._renderPickerList();
    this._updatePickerCounter();
    overlay?.classList.add('visible');
  }

  _closePicker() {
    const overlay = this.panel.querySelector('#mpPickerOverlay');
    overlay?.classList.remove('visible');
    this._currentPicker = null;
  }

  _renderPickerList() {
    const list = this.panel.querySelector('#mpPickerList');
    if (!list || !this._currentPicker) return;

    let pairs = [...this.catalog];
    const { searchFilter, regionFilter, selectedIds } = this._currentPicker;

    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      pairs = pairs.filter(p =>
        (p.sourceName || '').toLowerCase().includes(q) ||
        (p.targetName || '').toLowerCase().includes(q)
      );
    }
    if (regionFilter !== 'all') {
      pairs = pairs.filter(p => p.region === regionFilter);
    }

    pairs.sort((a, b) => (a.popularity || 999) - (b.popularity || 999));

    list.innerHTML = pairs.map(p => {
      const sel = selectedIds.has(p.id) ? ' selected' : '';
      return `
        <div class="mp-picker-item${sel}" data-pair-id="${this._esc(p.id)}" tabindex="0" role="checkbox" aria-checked="${selectedIds.has(p.id)}">
          <div class="mp-picker-check">✓</div>
          <span class="mp-picker-item-flags">${p.sourceFlag || ''} ${p.targetFlag || ''}</span>
          <span class="mp-picker-item-name">${this._esc(p.sourceName)} ↔ ${this._esc(p.targetName)}</span>
          <span class="mp-picker-item-meta">${this._stars(p.quality)} · ${p.sizeMB} MB</span>
        </div>`;
    }).join('');

    // Bind click + keyboard toggles
    list.querySelectorAll('.mp-picker-item').forEach(item => {
      const toggleItem = () => {
        if (!this._currentPicker) return;
        const pairId = item.dataset.pairId;
        if (this._currentPicker.isAll) return; // Marco Polo = locked selection

        if (this._currentPicker.selectedIds.has(pairId)) {
          this._currentPicker.selectedIds.delete(pairId);
          item.classList.remove('selected');
          item.setAttribute('aria-checked', 'false');
        } else {
          if (this._currentPicker.selectedIds.size >= this._currentPicker.maxPairs) return;
          this._currentPicker.selectedIds.add(pairId);
          item.classList.add('selected');
          item.setAttribute('aria-checked', 'true');
        }
        this._updatePickerCounter();
      };

      item.addEventListener('click', toggleItem);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleItem();
        }
      });
    });
  }

  _updatePickerCounter() {
    if (!this._currentPicker) return;
    const count = this._currentPicker.selectedIds.size;
    const max = this._currentPicker.maxPairs;
    const text = `${count} of ${max} selected`;

    const counter = this.panel.querySelector('#mpPickerCounter');
    const footerCounter = this.panel.querySelector('#mpPickerFooterCounter');
    const confirmBtn = this.panel.querySelector('#mpPickerConfirm');

    if (counter) counter.textContent = text;
    if (footerCounter) footerCounter.textContent = text;
    if (confirmBtn) confirmBtn.disabled = count === 0;
  }

  _bindPickerEvents() {
    const close = this.panel.querySelector('#mpPickerClose');
    const overlay = this.panel.querySelector('#mpPickerOverlay');
    const confirm = this.panel.querySelector('#mpPickerConfirm');
    const search = this.panel.querySelector('#mpPickerSearch');

    close?.addEventListener('click', () => this._closePicker());
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this._closePicker();
    });

    confirm?.addEventListener('click', () => {
      if (!this._currentPicker) return;
      const selectedIds = [...this._currentPicker.selectedIds];
      this._closePicker();
      this._handleBundlePurchase(selectedIds);
    });

    search?.addEventListener('input', () => {
      if (!this._currentPicker) return;
      this._currentPicker.searchFilter = search.value.trim();
      this._renderPickerList();
    });

    // Region quick-select buttons
    this.panel.querySelectorAll('.mp-picker-region-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._currentPicker) return;
        this._currentPicker.regionFilter = btn.dataset.region;
        // Update active state
        this.panel.querySelectorAll('.mp-picker-region-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderPickerList();
      });
    });

    // Escape to close picker
    const escHandler = (e) => {
      if (e.key === 'Escape' && this._currentPicker) {
        this._closePicker();
      }
    };
    document.addEventListener('keydown', escHandler);
    this._keydownHandlers.push(escHandler);
  }

  /* ═══════════════════════════════════════
     Actions — with error boundaries
     ═══════════════════════════════════════ */

  async _handleBuyPair(pairId) {
    const pair = this.catalog.find(p => p.id === pairId);
    if (!pair) return;

    // Open Stripe checkout
    if (window.windyAPI.openCheckoutUrl) {
      try {
        const priceId = pair.stripePriceId;
        if (priceId) {
          await window.windyAPI.openCheckoutUrl({ priceId, product: pairId });
        } else {
          // No Stripe price yet — show info
          alert(`${this._esc(pair.sourceName)} ↔ ${this._esc(pair.targetName)} — $${(pair.price || 6.99).toFixed(2)}\n\nPayment integration coming soon!`);
        }
      } catch (err) {
        console.error('[Marketplace] Buy failed:', err);
        this._showCheckoutError(pair, err);
      }
    }
  }

  /** Show a clear error message + retry button when Stripe checkout fails */
  _showCheckoutError(pair, err) {
    // Remove existing checkout errors
    const existing = this.panel?.querySelector('.mp-checkout-error');
    if (existing) existing.remove();

    const errorCard = document.createElement('div');
    errorCard.className = 'mp-checkout-error';
    errorCard.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(239,68,68,.95);color:#fff;padding:14px 20px;border-radius:12px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:420px;backdrop-filter:blur(8px);';
    errorCard.innerHTML = `
      <span style="font-size:20px;">❌</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">Checkout failed</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px;">${this._esc(err.message || 'Something went wrong. Please try again.')}</div>
      </div>
      <button class="mp-checkout-retry" style="padding:6px 14px;border:none;border-radius:8px;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;font-weight:600;font-size:12px;">Retry</button>
      <button class="mp-checkout-close" style="background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:18px;padding:2px 4px;">×</button>
    `;

    errorCard.querySelector('.mp-checkout-close').addEventListener('click', () => errorCard.remove());
    errorCard.querySelector('.mp-checkout-retry').addEventListener('click', () => {
      errorCard.remove();
      this._handleBuyPair(pair.id);
    });

    document.body.appendChild(errorCard);
    // Auto-dismiss after 10 seconds
    setTimeout(() => errorCard.remove(), 10000);
  }

  async _handleDownloadPair(pairId) {
    if (this.downloadedPairs.includes(pairId) || this.activeDownloads.has(pairId)) return;

    // L5 TRIGGER 3: Check pair limit for current tier
    const tierLimits = { free: 1, pro: 5, ultra: 25, max: 100 };
    try {
      const tierResult = await window.windyAPI.getCurrentTier?.();
      const currentTier = tierResult?.tier || 'free';
      const limit = tierLimits[currentTier] || tierLimits.free;
      if (this.downloadedPairs.length >= limit) {
        this._showPlanLimitDialog(currentTier, limit);
        return;
      }
    } catch (_) { /* proceed if tier check fails */ }

    this.activeDownloads.set(pairId, { pairId, percent: 0, speed: 0, eta: -1 });
    this._updateDownloadUI(pairId);

    try {
      const result = await window.windyAPI.pairDownload(pairId);
      if (result?.success) {
        if (!this.downloadedPairs.includes(pairId)) {
          this.downloadedPairs.push(pairId);
        }
        this.activeDownloads.delete(pairId);
        await this._refreshStorageInfo();
        this.render();
      } else {
        this.activeDownloads.delete(pairId);
        this._updateDownloadUI(pairId);
        this._showErrorBanner(`Download failed: ${result?.error || 'Unknown error'}. Please try again.`);
      }
    } catch (err) {
      this.activeDownloads.delete(pairId);
      this._updateDownloadUI(pairId);
      console.error('[Marketplace] Download failed:', err);
      this._showErrorBanner(`Download failed: ${err.message || 'Network error'}. Please check your connection.`);
    }
  }

  async _handleBundlePurchase(selectedIds) {
    if (!selectedIds || selectedIds.length === 0) return;

    try {
      // For now, show confirmation and note that Stripe integration is coming
      const bundle = this._currentPicker
        ? this.bundles.find(b => b.id === this._currentPicker.bundleId) : null;
      const bundleName = bundle ? bundle.name : 'Bundle';
      const bundlePrice = bundle ? `$${bundle.price}` : '';

      alert(`${bundleName} ${bundlePrice}\n\n${selectedIds.length} pairs selected.\n\nPayment integration coming soon! Once purchased, all selected pairs will begin downloading automatically.`);
    } catch (err) {
      console.error('[Marketplace] Bundle purchase failed:', err);
      this._showErrorBanner('Bundle purchase failed. Please try again.');
    }
  }

  /* ═══════════════════════════════════════
     Download UI Updates
     ═══════════════════════════════════════ */

  _updateDownloadUI(pairId) {
    if (!this.panel) return;

    // Update pair cards in the catalog grid
    const cards = this.panel.querySelectorAll(`.mp-pair-card[data-pair-id="${pairId}"]`);
    cards.forEach(card => {
      const isDownloaded = this.downloadedPairs.includes(pairId);
      const isDownloading = this.activeDownloads.has(pairId);

      const actionEl = card.querySelector('.mp-pair-action');
      if (!actionEl) return;

      if (isDownloaded) {
        actionEl.className = 'mp-pair-action downloaded';
        actionEl.innerHTML = '✅ Downloaded';
      } else if (isDownloading) {
        const dl = this.activeDownloads.get(pairId);
        const pct = dl?.percent || 0;
        actionEl.className = 'mp-pair-action downloading';
        actionEl.innerHTML = `<div class="mp-dl-fill" style="width:${pct}%"></div><span>Downloading ${pct}%</span>`;
      }
    });

    // Update downloading progress bars in-place
    const dlBars = this.panel.querySelectorAll(`.mp-pair-action.downloading[data-pair-id="${pairId}"]`);
    dlBars.forEach(bar => {
      const dl = this.activeDownloads.get(pairId);
      if (!dl) return;
      const fill = bar.querySelector('.mp-dl-fill');
      const label = bar.querySelector('span');
      if (fill) fill.style.width = `${dl.percent || 0}%`;
      if (label) label.textContent = `Downloading ${dl.percent || 0}%`;
    });
  }

  async _refreshStorageInfo() {
    try {
      this.storageInfo = await window.windyAPI.pairStorageInfo() || this.storageInfo;
    } catch (_) { /* non-fatal */ }
  }

  /* ═══════════════════════════════════════
     Helpers
     ═══════════════════════════════════════ */

  _stars(quality) {
    const n = Math.max(1, Math.min(5, quality || 3));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  /** XSS-safe escaping using DOM textContent → innerHTML */
  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /* ═══════════════════════════════════════
     L5 TRIGGER 3: Plan Limit Dialog
     ═══════════════════════════════════════ */

  _showPlanLimitDialog(currentTier, limit) {
    // Remove existing overlay if any
    const existing = document.getElementById('upsellPlanOverlay');
    if (existing) existing.remove();

    const tierNames = { free: 'Free', pro: 'Pro', ultra: 'Ultra', max: 'Max' };
    const tierName = tierNames[currentTier] || 'Free';

    const overlay = document.createElement('div');
    overlay.className = 'upsell-plan-overlay visible';
    overlay.id = 'upsellPlanOverlay';
    overlay.innerHTML = `
      <div class="upsell-plan-dialog">
        <button class="upsell-plan-dismiss" style="position:absolute;top:8px;right:12px;background:none;border:none;color:#64748B;font-size:18px;cursor:pointer;" title="Dismiss">&times;</button>
        <div class="upsell-plan-icon">🔒</div>
        <div class="upsell-plan-title">You've used all ${limit} engine${limit !== 1 ? 's' : ''} in your ${this._esc(tierName)} plan</div>
        <div class="upsell-plan-desc">
          Upgrade your plan for more offline translation engines, or buy just this engine individually.
        </div>
        <div class="upsell-card-actions" style="justify-content:center;">
          <button class="upsell-card-btn primary" id="upsellUpgradeBtn">Upgrade Plan</button>
          <button class="upsell-card-btn secondary" id="upsellBuySingleBtn">Buy Just This Engine $6.99</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Dismiss button
    overlay.querySelector('.upsell-plan-dismiss')?.addEventListener('click', () => overlay.remove());

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Upgrade plan
    overlay.querySelector('#upsellUpgradeBtn').addEventListener('click', () => {
      overlay.remove();
      // Open the main app settings/upgrade tab
      if (window.windyAPI?.openCheckoutUrl) {
        window.windyAPI.openCheckoutUrl({ upgrade: true });
      }
    });

    // Buy single engine
    overlay.querySelector('#upsellBuySingleBtn').addEventListener('click', () => {
      overlay.remove();
      // For now, show info that single purchase is coming
      alert('Single engine purchase — $6.99\n\nPayment integration coming soon!');
    });

    // Escape to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }
}
