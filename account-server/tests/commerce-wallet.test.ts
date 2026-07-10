/**
 * Commerce engine integration tests — unified wallet + catalog + entitlements.
 *
 * Real Express app + real SQLite schema; ONLY the Stripe SDK is faked (via
 * setStripeClientForTests) so no network is touched. The fake is stateful
 * (customers / payment methods / subscriptions) to exercise the real flows:
 *
 *   catalog → save card → one-tap purchase → entitlements provision →
 *   storage_limit bumps → cancel → clean re-lock → webhooks → refund revoke →
 *   idempotent replay → declined card leaves NOTHING → cross-account isolation →
 *   3-activation cap at license activation → admin comp/revoke + flags.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-wallet-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'commerce-wallet-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_commerce_suite';

import request from 'supertest';
import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { seedCatalogIfEmpty } from '../src/services/commerce/catalog';
import { setStripeClientForTests } from '../src/services/commerce/stripe-client';

// ═══════════════════════════════════════════
//  Stateful fake Stripe
// ═══════════════════════════════════════════

interface FakeState {
    customers: Map<string, any>;
    paymentMethods: Map<string, any>;
    subscriptions: Map<string, any>;
    declineNext: string | null;
    calls: Record<string, number>;
}

function makeFakeStripe() {
    const state: FakeState = {
        customers: new Map(),
        paymentMethods: new Map(),
        subscriptions: new Map(),
        declineNext: null,
        calls: {},
    };
    // Globally-unique suffix — real Stripe ids never collide across objects;
    // a per-instance counter would (entitlements key off subscription id).
    let seq = 0;
    const uniq = crypto.randomBytes(4).toString('hex');
    const bump = (k: string) => { state.calls[k] = (state.calls[k] || 0) + 1; };
    const declineIfArmed = () => {
        if (state.declineNext) {
            const code = state.declineNext;
            state.declineNext = null;
            const err: any = new Error('Your card was declined.');
            err.code = code;
            err.decline_code = code;
            throw err;
        }
    };
    const client = {
        _state: state,
        customers: {
            create: async (params: any) => {
                bump('customers.create');
                const id = `cus_test_${uniq}_${++seq}`;
                const cust = { id, ...params, invoice_settings: { default_payment_method: null } };
                state.customers.set(id, cust);
                return cust;
            },
            retrieve: async (id: string) => {
                bump('customers.retrieve');
                return state.customers.get(id) || { id, deleted: true };
            },
            update: async (id: string, params: any) => {
                bump('customers.update');
                const cust = state.customers.get(id);
                if (params?.invoice_settings?.default_payment_method) {
                    cust.invoice_settings.default_payment_method = params.invoice_settings.default_payment_method;
                }
                return cust;
            },
        },
        setupIntents: {
            create: async (params: any) => {
                bump('setupIntents.create');
                return { id: `seti_${uniq}_${++seq}`, client_secret: `seti_secret_${uniq}_${seq}`, ...params };
            },
        },
        paymentMethods: {
            attach: async (pmId: string, params: any) => {
                bump('paymentMethods.attach');
                const pm = {
                    id: pmId, customer: params.customer,
                    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 },
                };
                state.paymentMethods.set(pmId, pm);
                return pm;
            },
            retrieve: async (pmId: string) => {
                bump('paymentMethods.retrieve');
                const pm = state.paymentMethods.get(pmId);
                if (!pm) throw Object.assign(new Error('No such PaymentMethod'), { code: 'resource_missing' });
                return pm;
            },
        },
        products: {
            create: async (params: any) => {
                bump('products.create');
                return { id: `prod_test_${uniq}_${++seq}`, ...params };
            },
        },
        subscriptions: {
            create: async (params: any) => {
                bump('subscriptions.create');
                declineIfArmed();
                const id = `sub_test_${uniq}_${++seq}`;
                const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
                const sub = {
                    id, status: 'active', metadata: params.metadata,
                    customer: params.customer,
                    items: { data: [{ current_period_end: periodEnd }] },
                    latest_invoice: { payment_intent: { id: `pi_sub_${uniq}_${seq}` } },
                };
                state.subscriptions.set(id, sub);
                return sub;
            },
            cancel: async (id: string) => {
                bump('subscriptions.cancel');
                const sub = state.subscriptions.get(id);
                if (!sub) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
                sub.status = 'canceled';
                return sub;
            },
        },
        paymentIntents: {
            create: async (params: any) => {
                bump('paymentIntents.create');
                declineIfArmed();
                return { id: `pi_test_${uniq}_${++seq}`, status: 'succeeded', ...params };
            },
        },
    };
    return client;
}

let fakeStripe: ReturnType<typeof makeFakeStripe>;

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

let userCounter = 0;
async function registerUser(): Promise<{ token: string; userId: string; email: string }> {
    const email = `commerce-${++userCounter}-${Date.now()}@test.windy`;
    const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: `Commerce ${userCounter}`, email, password: 'Commerce-Test-1!' });
    expect(res.status).toBe(201);
    const userId = res.body.user?.id
        || (getDb().get('SELECT id FROM users WHERE email = ?', email) as any).id;
    return { token: res.body.token, userId, email };
}

async function addCard(token: string): Promise<void> {
    const si = await request(app)
        .post('/api/v1/wallet/setup-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    expect(si.status).toBe(200);
    expect(si.body.client_secret).toMatch(/^seti_secret_/);
    const pmId = `pm_test_${crypto.randomBytes(6).toString('hex')}`;
    const attach = await request(app)
        .post('/api/v1/wallet/payment-method')
        .set('Authorization', `Bearer ${token}`)
        .send({ payment_method_id: pmId });
    expect(attach.status).toBe(200);
}

async function buy(token: string, skuId: string, idem?: string) {
    return request(app)
        .post('/api/v1/wallet/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ sku_id: skuId, idempotency_key: idem || crypto.randomUUID() });
}

function signedWebhook(event: any) {
    const payload = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET as string)
        .update(`${ts}.${payload}`).digest('hex');
    return request(app)
        .post('/api/v1/stripe/webhook')
        .set('stripe-signature', `t=${ts},v1=${sig}`)
        .set('content-type', 'application/json')
        .send(payload);
}

beforeAll(() => {
    seedCatalogIfEmpty();
});

beforeEach(() => {
    fakeStripe = makeFakeStripe();
    setStripeClientForTests(fakeStripe);
});

afterAll(() => {
    setStripeClientForTests(null);
});

// ═══════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════

describe('GET /api/v1/catalog', () => {
    it('is public and returns bundles + à-la-carte + free caps', async () => {
        const res = await request(app).get('/api/v1/catalog');
        expect(res.status).toBe(200);
        const ids = res.body.bundles.map((b: any) => b.sku_id);
        expect(ids).toEqual(['bundle_breeze', 'bundle_gale', 'bundle_storm']);
        expect(res.body.bundles.find((b: any) => b.sku_id === 'bundle_gale').price_cents).toBe(2000);
        expect(res.body.alacarte.length).toBeGreaterThan(0);
        expect(res.body.free_tier['storage.bytes'].limit).toBe(524288000);
    });
});

describe('one-tap purchase (the $20 bundle E2E)', () => {
    it('register → add card → buy Gale → entitlements provision → storage unlocks → cancel → re-locks', async () => {
        const { token, userId } = await registerUser();

        // No card yet → friendly 409, nothing charged
        const early = await buy(token, 'bundle_gale');
        expect(early.status).toBe(409);
        expect(early.body.error).toBe('no_payment_method');

        await addCard(token);

        const res = await buy(token, 'bundle_gale');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('succeeded');
        expect(res.body.subscription_id).toMatch(/^sub_test_/);

        // Entitlements actually gate: limits show the Gale numbers
        const limits = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${token}`);
        expect(limits.body.limits['storage.bytes']).toBe(1024 * 1024 * 1024 * 1024);
        expect(limits.body.limits['stt.cloud_minutes']).toBe(15 + 1500);
        expect(limits.body.limits['agent.messages']).toBe(100 + 3000);

        // Account-server's own storage gate follows
        const user = getDb().get('SELECT storage_limit, cloud_tier_pushed FROM users WHERE id = ?', userId) as any;
        expect(Number(user.storage_limit)).toBe(1024 * 1024 * 1024 * 1024);
        expect(user.cloud_tier_pushed).toBe('ultra'); // 1 TB → cloud tier ultra

        // Cancel → clean human-readable re-lock
        const cancel = await request(app)
            .post(`/api/v1/wallet/subscriptions/${res.body.subscription_id}/cancel`)
            .set('Authorization', `Bearer ${token}`);
        expect(cancel.status).toBe(200);

        const after = await request(app)
            .get('/api/v1/entitlements')
            .set('Authorization', `Bearer ${token}`);
        const storage = after.body.features.find((f: any) => f.feature === 'storage.bytes');
        expect(storage.on_free_tier).toBe(true);
        expect(storage.limit).toBe(524288000);
        expect(storage.message).toMatch(/cancelled/i);

        const userAfter = getDb().get('SELECT storage_limit, cloud_tier_pushed FROM users WHERE id = ?', userId) as any;
        expect(Number(userAfter.storage_limit)).toBe(524288000);
        expect(userAfter.cloud_tier_pushed).toBe('free');
    });

    it('is idempotent: same idempotency_key never double-charges', async () => {
        const { token } = await registerUser();
        await addCard(token);
        const idem = crypto.randomUUID();
        const first = await buy(token, 'bundle_breeze', idem);
        expect(first.body.status).toBe('succeeded');
        const subsBefore = fakeStripe._state.calls['subscriptions.create'];

        const replay = await buy(token, 'bundle_breeze', idem);
        expect(replay.body.status).toBe('succeeded');
        expect(replay.body.replayed).toBe(true);
        expect(replay.body.purchase_id).toBe(first.body.purchase_id);
        expect(fakeStripe._state.calls['subscriptions.create']).toBe(subsBefore); // no new charge

        // Exactly one set of entitlement rows
        const rows = getDb().all(
            "SELECT * FROM entitlements WHERE source_id = ?", first.body.subscription_id,
        );
        expect(rows.length).toBe(4);
    });

    it('declined card → 402, purchase failed, ZERO entitlements, storage untouched', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        fakeStripe._state.declineNext = 'card_declined';

        const res = await buy(token, 'bundle_storm');
        expect(res.status).toBe(402);
        expect(res.body.error).toBe('card_declined');
        expect(res.body.message).toMatch(/nothing was charged/i);

        const ents = getDb().all('SELECT * FROM entitlements WHERE user_id = ?', userId);
        expect(ents.length).toBe(0);
        const purchase = getDb().get('SELECT status, error_code FROM purchases WHERE user_id = ?', userId) as any;
        expect(purchase.status).toBe('failed');
        expect(purchase.error_code).toBe('card_declined');
        const user = getDb().get('SELECT storage_limit FROM users WHERE id = ?', userId) as any;
        expect(Number(user.storage_limit)).toBe(524288000);
    });

    it('one_time top-up SKUs stack on the monthly allowance', async () => {
        const { token } = await registerUser();
        await addCard(token);
        const res = await buy(token, 'alacarte_stt_600');
        expect(res.body.status).toBe('succeeded');
        const limits = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${token}`);
        expect(limits.body.limits['stt.cloud_minutes']).toBe(15 + 600);
    });

    it('unknown SKU → 404, frozen account → 403', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        expect((await buy(token, 'bundle_nope')).status).toBe(404);
        getDb().run('UPDATE users SET frozen = 1 WHERE id = ?', userId);
        expect((await buy(token, 'bundle_breeze')).status).toBe(403);
    });
});

describe('post-capture provisioning failure (money-safety)', () => {
    it('a provisioning failure AFTER the charge leaves the row pending+retry, and invoice.paid heals it — never marks a captured charge failed', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        // Persist the Stripe linkage, then make the provisioning transaction
        // throw once (simulating a transient DB error after capture).
        const realTx = (getDb() as any).transactionAsync.bind(getDb());
        let tripped = false;
        (getDb() as any).transactionAsync = async (fn: any) => {
            if (!tripped) { tripped = true; throw new Error('simulated post-capture DB failure'); }
            return realTx(fn);
        };
        let res: any;
        try {
            res = await buy(token, 'bundle_breeze');
        } finally {
            (getDb() as any).transactionAsync = realTx;
        }
        // 202-ish: the client is told it's processing, NOT that it failed.
        expect(res.status).toBe(202);
        expect(res.body.error).toBe('provisioning_pending');

        // The purchase is pending+retry with the Stripe ids saved (findable by webhook).
        const purchase = getDb().get('SELECT status, provision_status, stripe_subscription_id FROM purchases WHERE user_id = ?', userId) as any;
        expect(purchase.status).toBe('pending');
        expect(purchase.provision_status).toBe('charge_captured_retry');
        expect(purchase.stripe_subscription_id).toMatch(/^sub_test_/);
        // No entitlements yet (the tx that would have written them failed).
        expect(getDb().all('SELECT 1 FROM entitlements WHERE user_id = ?', userId).length).toBe(0);

        // invoice.paid (Stripe's first-invoice event) heals it: flips to succeeded + provisions.
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
        const heal = await signedWebhook({
            type: 'invoice.paid',
            data: { object: { subscription: purchase.stripe_subscription_id, amount_paid: 500, lines: { data: [{ period: { end: periodEnd } }] } } },
        });
        expect(heal.status).toBe(200);
        const healed = getDb().get('SELECT status FROM purchases WHERE user_id = ?', userId) as any;
        expect(healed.status).toBe('succeeded');
        const limits = await request(app).get('/api/v1/entitlements/limits').set('Authorization', `Bearer ${token}`);
        expect(limits.body.limits['storage.bytes']).toBe(100 * 1024 * 1024 * 1024);
    });

    it('a $0/refunded invoice never extends or re-activates', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        const purchase = await buy(token, 'bundle_gale');
        const subId = purchase.body.subscription_id;
        // $0 proration invoice — must be a no-op extension
        const before = getDb().get("SELECT expires_at FROM entitlements WHERE user_id = ? AND feature = 'storage.bytes'", userId) as any;
        await signedWebhook({ type: 'invoice.paid', data: { object: { subscription: subId, amount_paid: 0, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 999 * 86400 } }] } } } });
        const after = getDb().get("SELECT expires_at FROM entitlements WHERE user_id = ? AND feature = 'storage.bytes'", userId) as any;
        expect(after.expires_at).toBe(before.expires_at);
        // refund, then a late redelivered invoice.paid must NOT resurrect access
        const pi = getDb().get('SELECT stripe_payment_intent_id FROM purchases WHERE id = ?', purchase.body.purchase_id) as any;
        await signedWebhook({ type: 'charge.refunded', data: { object: { payment_intent: pi.stripe_payment_intent_id } } });
        await signedWebhook({ type: 'invoice.paid', data: { object: { subscription: subId, amount_paid: 2000, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 60 * 86400 } }] } } } });
        const limits = await request(app).get('/api/v1/entitlements/limits').set('Authorization', `Bearer ${token}`);
        expect(limits.body.limits['storage.bytes']).toBe(524288000); // stays free — not resurrected
    });
});

describe('cross-account isolation', () => {
    it("user B cannot cancel or see user A's subscription/wallet", async () => {
        const a = await registerUser();
        await addCard(a.token);
        const purchase = await buy(a.token, 'bundle_breeze');
        const subId = purchase.body.subscription_id;

        const b = await registerUser();
        const cancel = await request(app)
            .post(`/api/v1/wallet/subscriptions/${subId}/cancel`)
            .set('Authorization', `Bearer ${b.token}`);
        expect(cancel.status).toBe(404);

        const walletB = await request(app)
            .get('/api/v1/wallet')
            .set('Authorization', `Bearer ${b.token}`);
        expect(walletB.body.purchases.length).toBe(0);

        // A's entitlements never leak into B's limits
        const limitsB = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${b.token}`);
        expect(limitsB.body.limits['storage.bytes']).toBe(524288000);
    });
});

describe('Stripe webhooks (signed)', () => {
    it('invoice.paid renewal extends the subscription entitlements', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        const purchase = await buy(token, 'bundle_breeze');
        const subId = purchase.body.subscription_id;
        const before = getDb().get(
            "SELECT expires_at FROM entitlements WHERE user_id = ? AND feature = 'storage.bytes'", userId,
        ) as any;

        const newPeriodEnd = Math.floor(Date.now() / 1000) + 60 * 86400;
        const res = await signedWebhook({
            type: 'invoice.paid',
            data: { object: { subscription: subId, amount_paid: 500, lines: { data: [{ period: { end: newPeriodEnd } }] } } },
        });
        expect(res.status).toBe(200);
        expect(res.body.commerce).toBe(true);

        const after = getDb().get(
            "SELECT expires_at, status FROM entitlements WHERE user_id = ? AND feature = 'storage.bytes'", userId,
        ) as any;
        expect(after.status).toBe('active');
        expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(before.expires_at).getTime());
    });

    it('customer.subscription.deleted revokes with a friendly message', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        const purchase = await buy(token, 'bundle_gale');
        const subId = purchase.body.subscription_id;

        const res = await signedWebhook({
            type: 'customer.subscription.deleted',
            data: { object: { id: subId, metadata: { windy_commerce: '1' } } },
        });
        expect(res.status).toBe(200);

        const rows = getDb().all(
            "SELECT status, ended_reason FROM entitlements WHERE user_id = ?", userId,
        ) as any[];
        expect(rows.every(r => r.status === 'revoked')).toBe(true);
        expect(rows[0].ended_reason).toMatch(/subscription ended/i);
        const user = getDb().get('SELECT storage_limit FROM users WHERE id = ?', userId) as any;
        expect(Number(user.storage_limit)).toBe(524288000);
    });

    it('charge.refunded revokes exactly that purchase and marks it refunded', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        const topup = await buy(token, 'alacarte_stt_600');
        const pi = getDb().get('SELECT stripe_payment_intent_id FROM purchases WHERE id = ?', topup.body.purchase_id) as any;

        const res = await signedWebhook({
            type: 'charge.refunded',
            data: { object: { payment_intent: pi.stripe_payment_intent_id } },
        });
        expect(res.status).toBe(200);

        const purchase = getDb().get('SELECT status FROM purchases WHERE id = ?', topup.body.purchase_id) as any;
        expect(purchase.status).toBe('refunded');
        const limits = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${token}`);
        expect(limits.body.limits['stt.cloud_minutes']).toBe(15);
        expect(userId).toBeTruthy();
    });

    it('legacy (non-commerce) events still fall through to the legacy handler', async () => {
        const res = await signedWebhook({
            type: 'invoice.paid',
            data: { object: { subscription: 'sub_unknown_legacy', customer_email: 'nobody@test.windy', amount_paid: 4900 } },
        });
        expect(res.status).toBe(200);
        expect(res.body.commerce).toBeUndefined();
    });

    it('unsigned webhook is rejected', async () => {
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('content-type', 'application/json')
            .send(JSON.stringify({ type: 'invoice.paid', data: { object: {} } }));
        expect(res.status).toBe(400);
    });
});

describe('expiry', () => {
    it('expired entitlements re-lock with a renewal message on the next read', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        await buy(token, 'bundle_breeze');
        // Force the grant into the past
        getDb().run(
            "UPDATE entitlements SET expires_at = ? WHERE user_id = ?",
            new Date(Date.now() - 86400_000).toISOString(), userId,
        );
        const res = await request(app)
            .get('/api/v1/entitlements')
            .set('Authorization', `Bearer ${token}`);
        const storage = res.body.features.find((f: any) => f.feature === 'storage.bytes');
        expect(storage.on_free_tier).toBe(true);
        expect(storage.message).toMatch(/plan ended/i);
        expect(storage.message).toMatch(/100 GB/);
    });
});

describe('license activations (P5: 3-machine cap AT activation)', () => {
    const KEY = 'WP-PAAA-BBBB-CCCC';

    it('caps at 3 fingerprints, 4th → 403, deactivate frees a slot, sharing flagged', async () => {
        const { token } = await registerUser();
        for (const fp of ['fp-machine-1', 'fp-machine-2', 'fp-machine-3']) {
            const res = await request(app)
                .post('/api/v1/license/activate')
                .set('Authorization', `Bearer ${token}`)
                .set('X-Device-Fingerprint', fp)
                .send({ key: KEY });
            expect(res.status).toBe(200);
        }
        // Re-activating an existing machine is fine (not a new slot)
        const re = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Device-Fingerprint', 'fp-machine-2')
            .send({ key: KEY });
        expect(re.status).toBe(200);

        // 4th machine → friendly 403
        const fourth = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Device-Fingerprint', 'fp-machine-4')
            .send({ key: KEY });
        expect(fourth.status).toBe(403);
        expect(fourth.body.error).toBe('activation_limit');
        expect(fourth.body.message).toMatch(/3 machines/);

        // Self-serve deactivate frees the slot
        const list = await request(app)
            .get('/api/v1/license/activations')
            .set('Authorization', `Bearer ${token}`);
        expect(list.body.activations.length).toBe(3);
        const off = await request(app)
            .post('/api/v1/license/activations/deactivate')
            .set('Authorization', `Bearer ${token}`)
            .send({ device_fingerprint: 'fp-machine-1' });
        expect(off.status).toBe(200);
        const retry = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Device-Fingerprint', 'fp-machine-4')
            .send({ key: KEY });
        expect(retry.status).toBe(200);
    });

    it('activation without a fingerprint still works (legacy clients)', async () => {
        const { token } = await registerUser();
        const res = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ key: 'WP-TAAA-BBBB-DDDD' });
        expect(res.status).toBe(200);
    });

    it('heartbeat records over-cap sightings as INACTIVE and never punishes', async () => {
        const { token } = await registerUser();
        const key = 'WP-PBBB-CCCC-DDDD';
        await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Device-Fingerprint', 'hb-fp-1')
            .send({ key });
        // 4 extra machines heartbeat the same key
        for (const fp of ['hb-fp-2', 'hb-fp-3', 'hb-fp-4', 'hb-fp-5']) {
            const res = await request(app)
                .post('/v1/license/heartbeat')
                .set('Authorization', `Bearer ${key}`)
                .set('X-Device-Fingerprint', fp)
                .send({ timestamp: new Date().toISOString() });
            expect(res.status).toBe(200);
            expect(res.body.valid).toBe(true); // flag, never punish at heartbeat
        }
        const rows = getDb().all(
            'SELECT active FROM license_activations WHERE license_key = ?', key,
        ) as any[];
        expect(rows.length).toBe(5);
        const activeCount = rows.filter(r => r.active === 1 || r.active === true).length;
        expect(activeCount).toBeLessThanOrEqual(3);
    });
});

describe('admin commerce surface', () => {
    async function makeAdmin(): Promise<{ token: string; userId: string }> {
        const u = await registerUser();
        getDb().run("UPDATE users SET role = 'admin' WHERE id = ?", u.userId);
        // Re-login so the JWT reflects nothing new (adminOnly reads DB role) —
        // existing token is fine.
        return u;
    }

    it('admin can edit catalog prices live (server-driven)', async () => {
        const admin = await makeAdmin();
        const res = await request(app)
            .put('/api/v1/admin/catalog/bundle_breeze')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ price_cents: 700 });
        expect(res.status).toBe(200);
        const cat = await request(app).get('/api/v1/catalog');
        expect(cat.body.bundles.find((b: any) => b.sku_id === 'bundle_breeze').price_cents).toBe(700);
        // restore
        await request(app)
            .put('/api/v1/admin/catalog/bundle_breeze')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ price_cents: 500 });
    });

    it('non-admin cannot touch the catalog or grants', async () => {
        const u = await registerUser();
        const res = await request(app)
            .put('/api/v1/admin/catalog/bundle_breeze')
            .set('Authorization', `Bearer ${u.token}`)
            .send({ price_cents: 1 });
        expect(res.status).toBe(403);
    });

    it('admin comp grant unlocks a feature; revoke re-locks it (audited)', async () => {
        const admin = await makeAdmin();
        const target = await registerUser();

        const grant = await request(app)
            .post(`/api/v1/admin/users/${target.userId}/entitlements`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ feature: 'feature.priority_models', limit_value: 1 });
        expect(grant.status).toBe(200);

        const limits = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${target.token}`);
        expect(limits.body.limits['feature.priority_models']).toBe(1);

        const revoke = await request(app)
            .delete(`/api/v1/admin/users/${target.userId}/entitlements/${grant.body.entitlement_id}`)
            .set('Authorization', `Bearer ${admin.token}`);
        expect(revoke.status).toBe(200);

        const after = await request(app)
            .get('/api/v1/entitlements/limits')
            .set('Authorization', `Bearer ${target.token}`);
        expect(after.body.limits['feature.priority_models']).toBeUndefined();

        const audit = getDb().all(
            "SELECT event FROM identity_audit_log WHERE event LIKE 'commerce_%' ORDER BY created_at DESC",
        ) as any[];
        expect(audit.some(a => a.event === 'commerce_entitlement_grant')).toBe(true);
        expect(audit.some(a => a.event === 'commerce_entitlement_revoke')).toBe(true);
    });
});

describe('privacy: no PAN/CVV/PII beyond opaque ids anywhere', () => {
    it('wallet + purchases store only opaque Stripe ids', async () => {
        const { token, userId } = await registerUser();
        await addCard(token);
        await buy(token, 'bundle_breeze');
        const purchase = getDb().get('SELECT * FROM purchases WHERE user_id = ?', userId) as any;
        const serialized = JSON.stringify(purchase);
        expect(serialized).not.toMatch(/4242/);
        expect(serialized).not.toMatch(/cvv|cvc|card_number/i);
        const wallet = await request(app).get('/api/v1/wallet').set('Authorization', `Bearer ${token}`);
        // last4 + brand are allowed display fields; ensure no full PAN shape
        expect(JSON.stringify(wallet.body)).not.toMatch(/\d{13,19}/);
    });
});
