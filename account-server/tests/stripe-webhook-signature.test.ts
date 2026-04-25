/**
 * P1-13 — /api/v1/stripe/webhook signature enforcement.
 *
 * Stripe webhook is the money path: `payment_intent.succeeded` and
 * `invoice.paid` events trigger transaction inserts and (for subscription
 * invoices) plan upgrades. Without signature enforcement, anyone on the
 * network could POST forged events to credit their own account.
 *
 * The gap analysis flagged billing.ts at 76% coverage with NO test for
 * the webhook header/signature branches. This locks in:
 *   - missing header → 400
 *   - malformed header → 400
 *   - valid shape but wrong secret → 400 (constant-time compare)
 *   - valid signature → NOT 400 (passes signature gate)
 *   - unset STRIPE_WEBHOOK_SECRET → 503 (never silently accepts)
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe_webhook_secret_for_jest_xxxxx';

import { app } from '../src/server';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

function signStripe(rawBody: string, timestamp?: number): string {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const v1 = crypto
        .createHmac('sha256', SECRET)
        .update(`${ts}.${rawBody}`)
        .digest('hex');
    return `t=${ts},v1=${v1}`;
}

describe('P1-13 POST /api/v1/stripe/webhook — signature enforcement', () => {
    it('rejects a request with NO stripe-signature header (400)', async () => {
        const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Missing|stripe-signature/i);
    });

    it('rejects a MALFORMED stripe-signature header (400)', async () => {
        const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', 'not-a-valid-stripe-sig-header')
            .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Malformed|signature/i);
    });

    it('rejects a signature computed with the WRONG secret (400)', async () => {
        const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
        const ts = Math.floor(Date.now() / 1000);
        const wrongV1 = crypto
            .createHmac('sha256', 'some-other-secret')
            .update(`${ts}.${body}`)
            .digest('hex');
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', `t=${ts},v1=${wrongV1}`)
            .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid signature/i);
    });

    it('rejects a signature computed over a DIFFERENT body (400 — prevents replay/swap)', async () => {
        const sentBody = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
        const signedBody = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
        const ts = Math.floor(Date.now() / 1000);
        const v1 = crypto
            .createHmac('sha256', SECRET)
            .update(`${ts}.${signedBody}`)
            .digest('hex');
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', `t=${ts},v1=${v1}`)
            .send(sentBody);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid signature/i);
    });

    it('accepts a CORRECT signature (does not 400 at the signature gate)', async () => {
        // Use an unknown event type so the handler short-circuits past the
        // DB-mutating branches — we only want to prove the signature check
        // passes, not exercise plan upgrades here.
        const body = JSON.stringify({ type: 'customer.updated', data: { object: {} } });
        const sig = signStripe(body);
        const res = await request(app)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', sig)
            .send(body);
        // Signature gate passed → not 400. Handler acks unknown events with 200.
        expect(res.status).not.toBe(400);
        expect(res.status).not.toBe(401);
        expect(res.status).toBe(200);
    });
});

describe('P1-13 /api/v1/stripe/webhook — fail-closed when secret missing', () => {
    it('returns 503 when STRIPE_WEBHOOK_SECRET is unset (never silently accepts)', async () => {
        // Temporarily remove the secret and re-import app fresh so config
        // picks up the change.
        const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app: freshApp } = require('../src/server');

        const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
        const res = await request(freshApp)
            .post('/api/v1/stripe/webhook')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', 't=0,v1=0')
            .send(body);
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);

        // Restore for any later suites.
        if (prevSecret) process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    });
});
