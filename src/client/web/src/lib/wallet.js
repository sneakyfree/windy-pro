/**
 * Unified-wallet browser client (Commerce P1/P3).
 *
 * Talks to the account-server's wallet/catalog/entitlement endpoints with
 * the signed-in user's JWT. Card collection is Stripe Elements (SetupIntent
 * → confirmSetup) so the PAN never touches Windy servers — we only ever
 * see opaque payment-method ids.
 */

// Dev (Vite localhost) hits the same origin; prod hardcodes the canonical
// account host (same convention as Transcribe.jsx / the SSO handoffs).
export function accountBase() {
    const h = window.location.hostname
    return (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local'))
        ? ''
        : 'https://account.windyword.ai'
}

function token() {
    return localStorage.getItem('windy_token') || ''
}

async function api(method, path, body) {
    const resp = await fetch(`${accountBase()}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    const json = await resp.json().catch(() => ({}))
    return { httpStatus: resp.status, ...json }
}

export const getCatalog = () => api('GET', '/api/v1/catalog')
export const getWallet = () => api('GET', '/api/v1/wallet')
export const getEntitlements = () => api('GET', '/api/v1/entitlements')
export const createSetupIntent = () => api('POST', '/api/v1/wallet/setup-intent')
export const attachPaymentMethod = (paymentMethodId) =>
    api('POST', '/api/v1/wallet/payment-method', { payment_method_id: paymentMethodId })
export const cancelSubscription = (subscriptionId) =>
    api('POST', `/api/v1/wallet/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`)

/** One-tap purchase. The idempotency key is minted per user gesture so a
 *  double-click or flaky network retry can never double-charge. */
export const purchaseSku = (skuId) =>
    api('POST', '/api/v1/wallet/purchase', {
        sku_id: skuId,
        idempotency_key: `web-${crypto.randomUUID()}`,
    })
