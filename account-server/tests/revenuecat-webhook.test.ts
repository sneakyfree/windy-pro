/**
 * RevenueCat webhook — mobile IAP provisioning (LAUNCH-BLOCKER fix).
 *
 * Mobile App Store / Play subscribers pay via RevenueCat; before this
 * webhook existed the server never learned about it and paying customers
 * stayed tier='free'. This locks in the new server-side path:
 *   - missing / wrong Authorization → 401, zero writes
 *   - valid INITIAL_PURCHASE for a known product → users.tier + storage_limit
 *     provisioned for that app_user_id, transaction recorded
 *   - replayed event id → acknowledged, no duplicate transaction
 *   - CANCELLATION (refund) / EXPIRATION → downgrade to free
 *   - CANCELLATION with auto-renew off but paid-through-period → tier KEPT
 *   - unknown product / unknown app_user_id / SANDBOX → graceful ACK, no writes
 *   - downgrade never clobbers a tier the product didn't grant
 *   - REVENUECAT_WEBHOOK_AUTH unset → 503, endpoint inert (fail-closed)
 *
 * Mirrors the setup style of stripe-webhook-signature.test.ts +
 * commerce-wallet.test.ts (real app, real SQLite, no network).
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenuecat-webhook-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'revenuecat-webhook-test-xxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.REVENUECAT_WEBHOOK_AUTH = 'rc_test_shared_secret_for_jest_xxxxx';

import request from 'supertest';
import { app } from '../src/server';
import { getDb } from '../src/db/schema';

const AUTH = process.env.REVENUECAT_WEBHOOK_AUTH!;
const FREE_STORAGE = 500 * 1024 * 1024;
const PRO_STORAGE = 5 * 1024 * 1024 * 1024;
const TRANSLATE_PRO_STORAGE = 50 * 1024 * 1024 * 1024;

// ─── Helpers ─────────────────────────────────────────────────

let userCounter = 0;
async function registerUser(): Promise<{ token: string; userId: string; email: string }> {
    const email = `rc-webhook-${++userCounter}-${Date.now()}@test.windy`;
    const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: `RC Webhook ${userCounter}`, email, password: 'Rc-Webhook-Test-1!' });
    expect(res.status).toBe(201);
    const userId = res.body.user?.id
        || (getDb().get('SELECT id FROM users WHERE email = ?', email) as any).id;
    return { token: res.body.token, userId, email };
}

function rcEvent(overrides: Record<string, any> = {}) {
    return {
        api_version: '1.0',
        event: {
            id: crypto.randomUUID(),
            type: 'INITIAL_PURCHASE',
            app_user_id: 'unset',
            aliases: [],
            product_id: 'windy_pro_monthly',
            entitlement_ids: ['pro'],
            period_type: 'NORMAL',
            purchased_at_ms: Date.now(),
            expiration_at_ms: Date.now() + 30 * 86400_000,
            store: 'APP_STORE',
            environment: 'PRODUCTION',
            price: 4.99,
            currency: 'USD',
            ...overrides,
        },
    };
}

function post(payload: any, auth: string | null = AUTH) {
    const req = request(app)
        .post('/api/v1/webhooks/revenuecat')
        .set('Content-Type', 'application/json');
    if (auth !== null) req.set('Authorization', auth);
    return req.send(payload);
}

function userRow(userId: string): { tier: string; storage_limit: number } {
    const row = getDb().get('SELECT tier, storage_limit FROM users WHERE id = ?', userId) as any;
    return { tier: row.tier, storage_limit: Number(row.storage_limit) };
}

// ─── Auth gate ───────────────────────────────────────────────

describe('POST /api/v1/webhooks/revenuecat — auth gate', () => {
    it('rejects a request with NO Authorization header (401), zero writes', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({ app_user_id: userId }), null);
        expect(res.status).toBe(401);
        expect(userRow(userId).tier).toBe('free');
    });

    it('rejects a WRONG Authorization value (401), zero writes', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({ app_user_id: userId }), 'not-the-secret');
        expect(res.status).toBe(401);
        expect(userRow(userId).tier).toBe('free');
    });

    it('accepts the exact configured value AND the Bearer-prefixed form', async () => {
        const exact = await post(rcEvent({ type: 'TEST' }), AUTH);
        expect(exact.status).toBe(200);
        const bearer = await post(rcEvent({ type: 'TEST' }), `Bearer ${AUTH}`);
        expect(bearer.status).toBe(200);
    });

    it('rejects a malformed body (400)', async () => {
        const res = await post({ nonsense: true });
        expect(res.status).toBe(400);
    });
});

// ─── Provisioning ────────────────────────────────────────────

describe('INITIAL_PURCHASE provisioning', () => {
    it('provisions the mapped tier + storage for the app_user_id and records the payment', async () => {
        const { userId } = await registerUser();
        const evtId = crypto.randomUUID();
        const res = await post(rcEvent({ id: evtId, app_user_id: userId }));
        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);

        const row = userRow(userId);
        expect(row.tier).toBe('pro');
        expect(row.storage_limit).toBe(PRO_STORAGE);

        const tx = getDb().get(
            'SELECT amount, status, type FROM transactions WHERE user_id = ? AND stripe_payment_id = ?',
            userId, `rc_evt_${evtId}`,
        ) as any;
        expect(tx).toBeTruthy();
        expect(tx.status).toBe('paid');
        expect(tx.type).toBe('subscription');
        expect(Number(tx.amount)).toBe(499);
    });

    it('is idempotent: a replayed event id never double-writes the transaction', async () => {
        const { userId } = await registerUser();
        const evtId = crypto.randomUUID();
        const payload = rcEvent({ id: evtId, app_user_id: userId });

        expect((await post(payload)).status).toBe(200);
        const replay = await post(payload);
        expect(replay.status).toBe(200);
        expect(replay.body.replayed).toBe(true);

        const txs = getDb().all(
            'SELECT id FROM transactions WHERE stripe_payment_id = ?', `rc_evt_${evtId}`,
        ) as any[];
        expect(txs.length).toBe(1);
        expect(userRow(userId).tier).toBe('pro');
    });

    it('maps via entitlement_ids when the product id is unrecognized (highest tier wins)', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({
            app_user_id: userId,
            product_id: 'some_future_store_sku',
            entitlement_ids: ['translate_pro'],
        }));
        expect(res.status).toBe(200);
        const row = userRow(userId);
        expect(row.tier).toBe('translate_pro');
        expect(row.storage_limit).toBe(TRANSLATE_PRO_STORAGE);
    });

    it('unknown product AND unknown entitlements → graceful ACK, nothing provisioned', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({
            app_user_id: userId,
            product_id: 'totally_unknown_sku',
            entitlement_ids: [],
        }));
        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
        expect(userRow(userId).tier).toBe('free');
    });

    it('unknown app_user_id → graceful ACK (RC must not retry forever), zero writes', async () => {
        const res = await post(rcEvent({ app_user_id: 'no-such-user-anywhere' }));
        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
    });

    it('anonymous RC ids never match; a windy id in aliases still resolves', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({
            app_user_id: '$RCAnonymousID:abcdef1234567890',
            aliases: ['$RCAnonymousID:abcdef1234567890', userId],
        }));
        expect(res.status).toBe(200);
        expect(userRow(userId).tier).toBe('pro');
    });

    it('SANDBOX events never provision (REVENUECAT_ALLOW_SANDBOX unset)', async () => {
        const { userId } = await registerUser();
        const res = await post(rcEvent({ app_user_id: userId, environment: 'SANDBOX' }));
        expect(res.status).toBe(200);
        expect(res.body.skipped).toBe('sandbox');
        expect(userRow(userId).tier).toBe('free');
    });
});

// ─── Downgrades ──────────────────────────────────────────────

describe('CANCELLATION / EXPIRATION downgrades', () => {
    it('EXPIRATION downgrades the granted tier back to free', async () => {
        const { userId } = await registerUser();
        await post(rcEvent({ app_user_id: userId }));
        expect(userRow(userId).tier).toBe('pro');

        const res = await post(rcEvent({
            type: 'EXPIRATION',
            app_user_id: userId,
            expiration_at_ms: Date.now() - 1000,
        }));
        expect(res.status).toBe(200);
        const row = userRow(userId);
        expect(row.tier).toBe('free');
        expect(row.storage_limit).toBe(FREE_STORAGE);
    });

    it('CANCELLATION via refund (cancel_reason=CUSTOMER_SUPPORT) downgrades immediately', async () => {
        const { userId } = await registerUser();
        await post(rcEvent({ app_user_id: userId }));
        expect(userRow(userId).tier).toBe('pro');

        const res = await post(rcEvent({
            type: 'CANCELLATION',
            app_user_id: userId,
            cancel_reason: 'CUSTOMER_SUPPORT',
        }));
        expect(res.status).toBe(200);
        expect(userRow(userId).tier).toBe('free');
    });

    it('CANCELLATION with auto-renew off but paid-through-period KEEPS the tier', async () => {
        const { userId } = await registerUser();
        await post(rcEvent({ app_user_id: userId }));

        const res = await post(rcEvent({
            type: 'CANCELLATION',
            app_user_id: userId,
            cancel_reason: 'UNSUBSCRIBE',
            expiration_at_ms: Date.now() + 20 * 86400_000, // still paid up
        }));
        expect(res.status).toBe(200);
        expect(res.body.deferred).toBe('active_until_expiration');
        expect(userRow(userId).tier).toBe('pro'); // user paid through period end
    });

    it("never clobbers a tier this product didn't grant (e.g. a Stripe upgrade)", async () => {
        const { userId } = await registerUser();
        // Simulate a Stripe-side upgrade to translate after a mobile pro sub
        getDb().run("UPDATE users SET tier = 'translate' WHERE id = ?", userId);

        const res = await post(rcEvent({
            type: 'EXPIRATION',
            app_user_id: userId,
            expiration_at_ms: Date.now() - 1000,
        }));
        expect(res.status).toBe(200);
        expect(userRow(userId).tier).toBe('translate'); // untouched
    });

    it('EXPIRATION for an unmapped product never downgrades', async () => {
        const { userId } = await registerUser();
        await post(rcEvent({ app_user_id: userId }));

        const res = await post(rcEvent({
            type: 'EXPIRATION',
            app_user_id: userId,
            product_id: 'totally_unknown_sku',
            entitlement_ids: [],
            expiration_at_ms: Date.now() - 1000,
        }));
        expect(res.status).toBe(200);
        expect(userRow(userId).tier).toBe('pro'); // conservative: keep
    });
});

// ─── Fail-closed when unconfigured ───────────────────────────

describe('fail-closed when REVENUECAT_WEBHOOK_AUTH unset', () => {
    it('returns 503 and performs zero writes (endpoint inert)', async () => {
        const { userId } = await registerUser();
        const prev = process.env.REVENUECAT_WEBHOOK_AUTH;
        delete process.env.REVENUECAT_WEBHOOK_AUTH;
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app: freshApp } = require('../src/server');

        const res = await request(freshApp)
            .post('/api/v1/webhooks/revenuecat')
            .set('Content-Type', 'application/json')
            .set('Authorization', 'anything')
            .send(rcEvent({ app_user_id: userId }));
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);
        expect(userRow(userId).tier).toBe('free');

        if (prev) process.env.REVENUECAT_WEBHOOK_AUTH = prev;
    });
});
