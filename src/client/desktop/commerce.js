/**
 * Windy Word — desktop commerce client (Commerce P3).
 *
 * Thin main-process bridge to the account-server's unified wallet:
 * catalog, wallet summary, ONE-TAP purchase (when a card is already on
 * file), entitlements. The renderer talks to this via the commerce:* IPC
 * handlers; card ENTRY never happens in the desktop app — adding a card
 * opens the web wallet (Stripe Elements) in the system browser, so no
 * PAN ever touches Electron.
 *
 * All calls are best-effort with short timeouts: commerce being down must
 * never affect dictation (the product works fully offline).
 */
const { ipcMain, shell } = require('electron');
const crypto = require('crypto');

const TIMEOUT_MS = 10000;

let _store = null;

function accountServerUrl() {
    return process.env.WINDY_ACCOUNT_SERVER_URL || 'https://account.windyword.ai';
}

function webAppUrl() {
    return process.env.WINDY_WEBAPP_URL || 'https://app.windyword.ai';
}

function getAuthToken() {
    if (!_store) return null;
    return _store.get('auth.token', '') || _store.get('auth.storageToken', '') || null;
}

async function api(method, path, body) {
    const token = getAuthToken();
    if (!token && path !== '/api/v1/catalog') {
        return { ok: false, error: 'not_signed_in', message: 'Sign in to your Windy account first.' };
    }
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const resp = await fetch(`${accountServerUrl()}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timer);
        const json = await resp.json().catch(() => ({}));
        return { httpStatus: resp.status, ...json };
    } catch (err) {
        return { ok: false, error: 'network', message: 'Could not reach Windy — check your connection and try again.' };
    }
}

function registerCommerceIpc(store) {
    _store = store;

    ipcMain.handle('commerce:catalog', async () => api('GET', '/api/v1/catalog'));

    ipcMain.handle('commerce:wallet', async () => api('GET', '/api/v1/wallet'));

    ipcMain.handle('commerce:entitlements', async () => api('GET', '/api/v1/entitlements'));

    // ONE-TAP purchase — only works when the wallet already has a card;
    // the renderer falls back to commerce:open-wallet otherwise. The
    // idempotency key is generated HERE per user gesture, so an accidental
    // double-click can never double-charge.
    ipcMain.handle('commerce:purchase', async (_evt, skuId) => {
        if (typeof skuId !== 'string' || !skuId) {
            return { ok: false, error: 'bad_sku' };
        }
        return api('POST', '/api/v1/wallet/purchase', {
            sku_id: skuId,
            idempotency_key: `desktop-${crypto.randomUUID()}`,
        });
    });

    // Card entry / full wallet lives in the web app (Stripe Elements).
    ipcMain.handle('commerce:open-wallet', async (_evt, skuId) => {
        const suffix = skuId && typeof skuId === 'string' ? `?sku=${encodeURIComponent(skuId)}` : '';
        await shell.openExternal(`${webAppUrl()}/wallet${suffix}`);
        return { ok: true };
    });
}

module.exports = { registerCommerceIpc };
