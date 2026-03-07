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
                features: ['1 language', '3 engines', '2-min recordings', 'Local transcription'],
                color: '#6B7280',
                icon: '🌱'
            },
            {
                key: 'pro',
                name: 'Windy Pro',
                price: '$49',
                period: 'annual',
                monthlyPriceId: 'price_1T60GeBXIOBasDQi4aitcq8O',
                annualPriceId: 'price_1T5oYzBXIOBasDQibSlnIsPg',
                lifetimePriceId: 'price_1T5oYzBXIOBasDQibSlnIsPg_life',
                features: ['All 15 engines', '99 languages', '15-min recordings', 'Batch mode', 'LLM polish'],
                color: '#22C55E',
                icon: '⚡'
            },
            {
                key: 'translate',
                name: 'Windy Ultra',
                price: '$79',
                period: 'annual',
                monthlyPriceId: 'price_1T5oZJBXIOBasDQijBW23Gow',
                annualPriceId: 'price_1T5oZJBXIOBasDQiHO0MtYS7',
                lifetimePriceId: 'price_1T5oZJBXIOBasDQiHO0MtYS7_life',
                features: ['Everything in Pro', '60-min recordings', 'Real-time translation', '99 language pairs'],
                color: '#3B82F6',
                icon: '🚀',
                recommended: true
            },
            {
                key: 'translate_pro',
                name: 'Windy Max',
                price: '$149',
                period: 'annual',
                monthlyPriceId: 'price_1T60H8BXIOBasDQiy5eorTWR',
                annualPriceId: 'price_1T5oZ1BXIOBasDQinrz3VdvG',
                lifetimePriceId: 'price_1T5oZ1BXIOBasDQinrz3VdvG_life',
                features: ['Everything in Ultra', 'Unlimited recordings', 'Text-to-speech', 'Medical/legal glossaries'],
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
            const currentBadge = isCurrent ? '<span class="upgrade-current-badge">✓ YOUR CURRENT PLAN</span>' : '';

            const monthlyPrices = { pro: '$4.99', translate: '$8.99', translate_pro: '$14.99' };
            const lifetimePrices = { pro: '$99', translate: '$199', translate_pro: '$299' };

            let priceDisplay = plan.price;
            if (plan.monthlyPriceId) {
                priceDisplay += ` <span class="upgrade-alt-price">/year</span>`;
            }

            // Lifetime price in gold (only for paid plans)
            let lifetimeDisplay = '';
            if (plan.monthlyPriceId) {
                lifetimeDisplay = `<div class="upgrade-lifetime-price">💎 ${lifetimePrices[plan.key]} <span class="upgrade-lifetime-label">lifetime — own forever</span></div>`;
            }

            const features = plan.features.map(f => `<li>✓ ${f}</li>`).join('');

            let actionBtn = '';
            if (isCurrent) {
                actionBtn = '<button class="upgrade-btn upgrade-btn-current" disabled>Current Plan</button>';
            } else if (isUpgrade) {
                actionBtn = `<button class="upgrade-btn upgrade-btn-buy" data-price="${plan.annualPriceId}" data-tier="${plan.key}">Upgrade — ${plan.price}/yr →</button>`;
                actionBtn += `<button class="upgrade-btn upgrade-btn-lifetime" data-price="${plan.lifetimePriceId}" data-tier="${plan.key}">💎 ${lifetimePrices[plan.key]} Lifetime</button>`;
                actionBtn += `<button class="upgrade-btn upgrade-btn-alt" data-price="${plan.monthlyPriceId}" data-tier="${plan.key}" data-sub="true">or ${monthlyPrices[plan.key]}/mo</button>`;
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
          ${lifetimeDisplay}
          <ul class="upgrade-card-features">${features}</ul>
          <div class="upgrade-card-actions">${actionBtn}</div>
        </div>`;
        }).join('');

        const currentPlanObj = this.plans.find(p => p.key === this._currentTier);
        const currentPlanName = currentPlanObj ? currentPlanObj.name : 'Free';
        return `
      <div class="upgrade-header">
        <div class="upgrade-title-row">
          <h3>⚡ Upgrade Your Plan</h3>
          <button class="upgrade-close" id="upgradeClose">✕</button>
        </div>
        <p class="upgrade-subtitle">You're on: <strong style="color:#22C55E;">${currentPlanName}</strong> · Unlock the full power of Windy Pro</p>
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
        this.panel.querySelectorAll('.upgrade-btn-buy, .upgrade-btn-alt, .upgrade-btn-lifetime').forEach(btn => {
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
        if (!this._activeSessions) this._activeSessions = [];

        const status = this.panel.querySelector('#upgradeStatus');
        status.innerHTML = '⏳ Creating checkout sessions for all plans…';
        status.className = 'upgrade-status upgrade-status-pending';

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

            // Create sessions for ALL paid plans (monthly + annual + lifetime) in parallel
            const paidPlans = this.plans.filter(p => p.monthlyPriceId);
            const allSessionPromises = [];

            for (const p of paidPlans) {
                // Monthly
                allSessionPromises.push(
                    window.windyAPI.createCheckoutSession(p.monthlyPriceId, email)
                        .then(r => ({ key: p.key, billing: 'monthly', result: r }))
                        .catch(e => ({ key: p.key, billing: 'monthly', result: { ok: false, error: e.message } }))
                );
                // Annual
                allSessionPromises.push(
                    window.windyAPI.createCheckoutSession(p.annualPriceId, email)
                        .then(r => ({ key: p.key, billing: 'annual', result: r }))
                        .catch(e => ({ key: p.key, billing: 'annual', result: { ok: false, error: e.message } }))
                );
                // Lifetime
                allSessionPromises.push(
                    window.windyAPI.createCheckoutSession(p.lifetimePriceId, email)
                        .then(r => ({ key: p.key, billing: 'lifetime', result: r }))
                        .catch(e => ({ key: p.key, billing: 'lifetime', result: { ok: false, error: e.message } }))
                );
            }
            const sessionResults = await Promise.all(allSessionPromises);

            // Build 3 URL maps
            const monthlyPlanUrls = {};
            const annualPlanUrls = {};
            const lifetimePlanUrls = {};
            for (const { key, billing, result } of sessionResults) {
                if (result?.ok && result.url) {
                    if (billing === 'monthly') monthlyPlanUrls[key] = result.url;
                    else if (billing === 'annual') annualPlanUrls[key] = result.url;
                    else lifetimePlanUrls[key] = result.url;
                    this._activeSessions.push({ sessionId: result.sessionId, tier: key, url: result.url });
                }
            }

            const totalUrls = Object.keys(monthlyPlanUrls).length + Object.keys(annualPlanUrls).length + Object.keys(lifetimePlanUrls).length;
            if (totalUrls === 0) {
                throw new Error('Could not create any checkout sessions');
            }

            // Open interactive checkout window with all 3 billing URL maps
            if (window.windyAPI?.openCheckoutUrl) {
                const openResult = await window.windyAPI.openCheckoutUrl({
                    monthlyPlanUrls,
                    annualPlanUrls,
                    lifetimePlanUrls,
                    currentTier: this._currentTier || 'free',
                    initialTier: tier
                });
                if (openResult?.ok) {
                    status.innerHTML = `
                        <div style="text-align:center;">
                            <div style="margin-bottom:6px;font-size:13px;">🌐 <strong>Checkout window opened!</strong></div>
                            <div style="font-size:11px;color:#9CA3AF;">Browse plans and complete your purchase</div>
                        </div>
                    `;
                } else {
                    status.innerHTML = `<div style="text-align:center;color:#EF4444;">${openResult?.error || 'Could not open checkout'}</div>`;
                }
            }

            if (!this._pollTimer) {
                this._startPolling();
            }
        } catch (err) {
            const msg = err.message || 'Unknown error';
            if (msg.includes('Payment system not configured') || msg.includes('Not available')) {
                status.innerHTML = `❌ <strong>Stripe API key not set.</strong><br><span style="font-size:11px;color:#9CA3AF;">Set STRIPE_SECRET_KEY environment variable or configure in Settings → Advanced → Stripe Secret Key</span>`;
            } else {
                status.innerHTML = `❌ ${msg}`;
            }
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

                // No payment yet — update status with checkout link
                if (status) {
                    const tabCount = sessions.length;
                    const dots = '.'.repeat((this._pollCount % 3) + 1);
                    const latestUrl = sessions[sessions.length - 1]?.url || '';
                    const tabNote = tabCount > 1 ? `<br><span style="font-size:10px;color:#6B7280;">Watching ${tabCount} checkout tabs — pay on any one</span>` : '';
                    status.innerHTML = `
                        <div style="text-align:center;">
                            <div style="margin-bottom:6px;font-size:13px;">⏳ Waiting for payment${dots}</div>
                            ${latestUrl ? `
                                <a href="${latestUrl}" 
                                   style="display:inline-block;background:#635BFF;color:#fff;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;cursor:pointer;margin-bottom:6px;"
                                   onclick="if(window.windyAPI?.openExternalUrl){window.windyAPI.openExternalUrl('${latestUrl}')};return false;">
                                    💳 Open Stripe Checkout →
                                </a>
                                <div style="font-size:10px;color:#6B7280;margin-bottom:4px;">
                                    or <a href="#" onclick="window.windyAPI.copyToClipboard('${latestUrl}');this.textContent='✅ Copied!';return false;" style="color:#60A5FA;cursor:pointer;">copy checkout URL</a>
                                </div>
                            ` : `<div style="font-size:11px;color:#9CA3AF;">Complete checkout in your browser</div>`}
                            ${tabNote}
                            <a href="#" id="cancelCheckout" style="font-size:11px;color:#60A5FA;cursor:pointer;">Changed your mind? Pick a different plan</a>
                        </div>
                    `;
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
        const tierNames = { pro: 'Windy Pro', translate: 'Windy Ultra', translate_pro: 'Windy Max' };
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
