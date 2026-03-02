/**
 * Windy Pro — Upgrade Panel
 * Premium pricing cards with Stripe Checkout integration.
 * Slide-in panel matching History/Vault pattern.
 */
class UpgradePanel {
    constructor(app) {
        this.app = app;
        this.panel = null;
        this.isOpen = false;
        this._pollTimer = null;
        this._pollCount = 0;
        this._currentTier = 'free';
        this._discount = null;

        this.plans = [
            {
                key: 'free',
                name: 'Free',
                price: '$0',
                period: 'forever',
                priceId: null,
                features: ['1 language', '3 engines', '5-min recordings', 'Local transcription'],
                color: '#6B7280',
                icon: '🌱'
            },
            {
                key: 'pro',
                name: 'Windy Pro',
                price: '$49',
                altPrice: '$4.99/mo',
                period: 'one-time',
                priceId: 'price_1T5oYzBXIOBasDQibSlnIsPg',
                altPriceId: 'price_1T60GeBXIOBasDQi4aitcq8O',
                features: ['All 15 engines', '99 languages', '30-min recordings', 'Batch mode', 'LLM polish'],
                color: '#22C55E',
                icon: '⚡'
            },
            {
                key: 'translate',
                name: 'Windy Translate',
                price: '$79',
                altPrice: '$7.99/mo',
                period: 'one-time',
                priceId: 'price_1T5oZJBXIOBasDQiHO0MtYS7',
                altPriceId: 'price_1T5oZJBXIOBasDQijBW23Gow',
                features: ['Everything in Pro', 'Real-time translation', 'Conversation mode', '99 language pairs'],
                color: '#3B82F6',
                icon: '🌍',
                recommended: true
            },
            {
                key: 'translate_pro',
                name: 'Windy Translate Pro',
                price: '$149',
                altPrice: '$14.99/mo',
                period: 'one-time',
                priceId: 'price_1T5oZ1BXIOBasDQinrz3VdvG',
                altPriceId: 'price_1T60H8BXIOBasDQiy5eorTWR',
                features: ['Everything in Translate', 'Text-to-speech', 'Medical/legal glossaries', 'Priority support'],
                color: '#8B5CF6',
                icon: '👑'
            }
        ];
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    async open() {
        // Load current tier
        try {
            if (window.windyAPI?.getCurrentTier) {
                const result = await window.windyAPI.getCurrentTier();
                this._currentTier = result?.tier || 'free';
            }
        } catch (_) { }

        if (this.panel) this.panel.remove();
        this.panel = document.createElement('div');
        this.panel.className = 'upgrade-panel';
        this.panel.innerHTML = this._buildHTML();
        document.getElementById('app').appendChild(this.panel);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => this.panel.classList.add('open'));
        });

        this.isOpen = true;
        this._bindEvents();
    }

    close() {
        this._stopPolling();
        if (this.panel) {
            this.panel.classList.remove('open');
            setTimeout(() => {
                if (this.panel) { this.panel.remove(); this.panel = null; }
            }, 300);
        }
        this.isOpen = false;
    }

    _buildHTML() {
        const cards = this.plans.map(plan => {
            const isCurrent = plan.key === this._currentTier;
            const isUpgrade = !isCurrent && plan.key !== 'free';
            const isDowngrade = plan.key === 'free' && this._currentTier !== 'free';
            const recommendedBadge = plan.recommended ? '<span class="upgrade-recommended">RECOMMENDED</span>' : '';
            const currentBadge = isCurrent ? '<span class="upgrade-current-badge">CURRENT PLAN</span>' : '';

            let priceDisplay = plan.price;
            if (plan.altPrice) {
                priceDisplay += ` <span class="upgrade-alt-price">or ${plan.altPrice}</span>`;
            }

            const features = plan.features.map(f => `<li>✓ ${f}</li>`).join('');

            let actionBtn = '';
            if (isCurrent) {
                actionBtn = '<button class="upgrade-btn upgrade-btn-current" disabled>Current Plan</button>';
            } else if (isUpgrade) {
                actionBtn = `<button class="upgrade-btn upgrade-btn-buy" data-price="${plan.priceId}" data-tier="${plan.key}">Upgrade →</button>`;
                if (plan.altPriceId) {
                    actionBtn += `<button class="upgrade-btn upgrade-btn-alt" data-price="${plan.altPriceId}" data-tier="${plan.key}" data-sub="true">or subscribe monthly</button>`;
                }
            } else if (isDowngrade) {
                actionBtn = '<button class="upgrade-btn upgrade-btn-current" disabled>✓ Included</button>';
            }

            return `
        <div class="upgrade-card ${plan.recommended ? 'upgrade-card-recommended' : ''} ${isCurrent ? 'upgrade-card-current' : ''}" style="--card-color: ${plan.color}">
          ${recommendedBadge}
          ${currentBadge}
          <div class="upgrade-card-icon">${plan.icon}</div>
          <h3 class="upgrade-card-name">${plan.name}</h3>
          <div class="upgrade-card-price">${priceDisplay}</div>
          <div class="upgrade-card-period">${plan.period}</div>
          <ul class="upgrade-card-features">${features}</ul>
          <div class="upgrade-card-actions">${actionBtn}</div>
        </div>`;
        }).join('');

        return `
      <div class="upgrade-header">
        <div class="upgrade-title-row">
          <h3>⚡ Upgrade Your Plan</h3>
          <button class="upgrade-close" id="upgradeClose">✕</button>
        </div>
        <p class="upgrade-subtitle">Unlock the full power of Windy Pro</p>
      </div>
      <div class="upgrade-body">
        <div class="upgrade-cards">${cards}</div>
        <div class="upgrade-coupon-section">
          <div class="upgrade-coupon-row">
            <input type="text" class="upgrade-coupon-input" id="upgradeCouponInput" placeholder="Enter coupon code…">
            <button class="upgrade-coupon-btn" id="upgradeCouponBtn">Apply</button>
          </div>
          <div class="upgrade-coupon-result" id="upgradeCouponResult"></div>
        </div>
        <div class="upgrade-status" id="upgradeStatus"></div>
        <p class="upgrade-guarantee">🔒 Secure payment via Stripe · 30-day money-back guarantee</p>
      </div>`;
    }

    _bindEvents() {
        // Close
        this.panel.querySelector('#upgradeClose').addEventListener('click', () => this.close());

        // Buy buttons
        this.panel.querySelectorAll('.upgrade-btn-buy, .upgrade-btn-alt').forEach(btn => {
            btn.addEventListener('click', () => {
                const priceId = btn.dataset.price;
                const tier = btn.dataset.tier;
                this._startCheckout(priceId, tier);
            });
        });

        // Coupon
        const couponBtn = this.panel.querySelector('#upgradeCouponBtn');
        const couponInput = this.panel.querySelector('#upgradeCouponInput');
        couponBtn.addEventListener('click', () => this._applyCoupon());
        couponInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._applyCoupon();
        });
    }

    async _applyCoupon() {
        const input = this.panel.querySelector('#upgradeCouponInput');
        const result = this.panel.querySelector('#upgradeCouponResult');
        const code = input.value.trim();
        if (!code) return;

        result.textContent = '⏳ Checking…';
        result.className = 'upgrade-coupon-result';

        try {
            if (!window.windyAPI?.applyCoupon) throw new Error('Not available');
            const res = await window.windyAPI.applyCoupon(code);
            if (res.valid) {
                this._discount = res.discount;
                result.textContent = `✅ ${res.discount.label} — discount applied at checkout!`;
                result.classList.add('coupon-valid');
            } else {
                this._discount = null;
                result.textContent = `❌ ${res.error || 'Invalid coupon code'}`;
                result.classList.add('coupon-invalid');
            }
        } catch (err) {
            result.textContent = '❌ Could not validate coupon';
            result.classList.add('coupon-invalid');
        }
    }

    async _startCheckout(priceId, tier) {
        // Initialize session tracking array if needed
        if (!this._activeSessions) this._activeSessions = [];

        const status = this.panel.querySelector('#upgradeStatus');
        status.innerHTML = '⏳ Creating checkout session…';
        status.className = 'upgrade-status upgrade-status-pending';

        // Get user email from settings
        let email = '';
        try {
            if (window.windyAPI?.getSettings) {
                const settings = await window.windyAPI.getSettings();
                email = settings?.cloudUser || settings?.cloudEmail || '';
            }
            if (!email) email = localStorage.getItem('windy_cloudEmail') || '';
        } catch (_) { }

        try {
            if (!window.windyAPI?.createCheckoutSession) throw new Error('Not available');
            const result = await window.windyAPI.createCheckoutSession(priceId, email);
            if (!result?.ok) throw new Error(result?.error || 'Session creation failed');

            // Track this session (keep all for multi-tab support)
            this._activeSessions.push({ sessionId: result.sessionId, tier });

            // Open checkout in browser
            status.innerHTML = '🌐 Opening Stripe checkout in your browser…<br><span style="font-size:11px;color:#9CA3AF;">Complete payment there, then come back here</span>';

            // Open checkout in system browser (not Electron window)
            if (window.windyAPI?.openExternalUrl) {
                const openResult = await window.windyAPI.openExternalUrl(result.url);
                if (!openResult?.ok) {
                    console.warn('[Upgrade] shell.openExternal failed, showing link');
                    status.innerHTML = `🔗 <a href="#" onclick="navigator.clipboard.writeText('${result.url}');this.textContent='Copied!';return false" style="color:#60A5FA;text-decoration:underline;cursor:pointer;">Click to copy checkout URL</a><br><span style="font-size:11px;color:#9CA3AF;">Paste in your browser to complete payment</span>`;
                }
            } else {
                window.open(result.url, '_blank');
            }

            // Start polling if not already running (polls ALL sessions)
            if (!this._pollTimer) {
                this._startPolling();
            }
        } catch (err) {
            status.innerHTML = `❌ ${err.message}`;
            status.className = 'upgrade-status upgrade-status-error';
        }
    }

    _startPolling() {
        this._pollCount = 0;
        const maxPolls = 600; // 3s × 600 = 30 minutes
        const status = this.panel?.querySelector('#upgradeStatus');

        this._pollTimer = setInterval(async () => {
            this._pollCount++;
            if (this._pollCount > maxPolls) {
                this._stopPolling();
                if (status) {
                    status.innerHTML = '⏰ Payment check timed out. If you completed payment, restart the app.';
                    status.className = 'upgrade-status upgrade-status-error';
                }
                return;
            }

            try {
                if (!window.windyAPI?.checkPaymentStatus) return;

                // Poll ALL active sessions in parallel
                const sessions = this._activeSessions || [];
                const results = await Promise.all(
                    sessions.map(s => window.windyAPI.checkPaymentStatus(s.sessionId).catch(() => null))
                );

                // Check if ANY session was paid
                for (let i = 0; i < results.length; i++) {
                    if (results[i]?.paid) {
                        this._stopPolling();
                        this._activeSessions = [];
                        this._currentTier = results[i].tier || sessions[i].tier;
                        this._onPaymentSuccess(this._currentTier);
                        return;
                    }
                }

                // No payment yet — update status
                if (status) {
                    const tabCount = sessions.length;
                    const dots = '.'.repeat((this._pollCount % 3) + 1);
                    const tabNote = tabCount > 1 ? `<br><span style="font-size:10px;color:#6B7280;">Watching ${tabCount} checkout tabs — pay on any one</span>` : '';
                    status.innerHTML = `⏳ Waiting for payment${dots}<br><span style="font-size:11px;color:#9CA3AF;">Complete checkout in your browser, then come back here</span>${tabNote}<br><a href="#" id="cancelCheckout" style="font-size:11px;color:#60A5FA;cursor:pointer;">Changed your mind? Pick a different plan</a>`;
                    const cancelLink = status.querySelector('#cancelCheckout');
                    if (cancelLink) {
                        cancelLink.onclick = (ev) => {
                            ev.preventDefault();
                            this._stopPolling();
                            this._activeSessions = [];
                            status.innerHTML = '👆 Select a plan above to continue';
                            status.className = 'upgrade-status';
                        };
                    }
                }
            } catch (_) { }
        }, 3000);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    _onPaymentSuccess(tier) {
        const tierNames = { pro: 'Windy Pro', translate: 'Windy Translate', translate_pro: 'Windy Translate Pro' };
        const status = this.panel?.querySelector('#upgradeStatus');
        if (status) {
            status.innerHTML = `
        <div class="upgrade-success">
          <div class="upgrade-success-icon">🎉</div>
          <div class="upgrade-success-title">Welcome to ${tierNames[tier] || tier}!</div>
          <div class="upgrade-success-msg">Your plan has been upgraded. All features are now unlocked.</div>
        </div>`;
            status.className = 'upgrade-status upgrade-status-success';
        }

        // Re-render cards to show new current plan
        setTimeout(() => {
            if (this.panel) {
                const body = this.panel.querySelector('.upgrade-body');
                if (body) {
                    // Rebuild cards section only
                    const cardsHtml = this.plans.map(plan => {
                        const isCurrent = plan.key === this._currentTier;
                        return `<div class="upgrade-card ${plan.recommended ? 'upgrade-card-recommended' : ''} ${isCurrent ? 'upgrade-card-current' : ''}" style="--card-color: ${plan.color}">
              ${isCurrent ? '<span class="upgrade-current-badge">CURRENT PLAN</span>' : ''}
              <div class="upgrade-card-icon">${plan.icon}</div>
              <h3 class="upgrade-card-name">${plan.name}</h3>
              <div class="upgrade-card-price">${plan.price}</div>
              <div class="upgrade-card-period">${plan.period}</div>
              <ul class="upgrade-card-features">${plan.features.map(f => `<li>✓ ${f}</li>`).join('')}</ul>
              <div class="upgrade-card-actions">
                <button class="upgrade-btn upgrade-btn-current" disabled>${isCurrent ? 'Current Plan' : '✓ Included'}</button>
              </div>
            </div>`;
                    }).join('');
                    body.querySelector('.upgrade-cards').innerHTML = cardsHtml;
                }
            }
        }, 2000);
    }
}
