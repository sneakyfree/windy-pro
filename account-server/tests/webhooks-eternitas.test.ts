/**
 * POST /webhooks/eternitas — Wave 13 firehose subscriber.
 *
 * Four-case contract (from the Wave 13 runbook):
 *   1. Valid X-Eternitas-Signature → 200 { received: true }
 *   2. No signature header          → 401
 *   3. Wrong signature              → 401 (NOT 400/403 — Eternitas expects 401)
 *   4. Unknown event type + valid   → 200 (log + acknowledge)
 *
 * Plus: response returns fast (the 5s budget), even if the processing
 * side takes time.
 */
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Isolate DB + env BEFORE the server is imported (the server's module
// evaluation wires rate limiters using the current NODE_ENV value).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhooks-eternitas-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.ETERNITAS_HMAC_SECRET = 'test-eternitas-hmac-secret-xxxxxxxxxxxxxxxxxxxxxxxx';
// The existing per-passport webhook also expects a secret; set it so
// the other route doesn't 503 during route registration / tests.
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-eternitas-per-passport-xxxxxxxxxxxxxxxxxxxxxxx';

import { app } from '../src/server';

const SECRET = process.env.ETERNITAS_HMAC_SECRET!;

function signBody(body: string, secret = SECRET): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('POST /webhooks/eternitas — Wave 13 firehose contract', () => {
    it('Case 1: valid signature → 200 { received: true }', async () => {
        const body = JSON.stringify({
            type: 'operator.registered',
            operator_id: 'op-test-1',
            timestamp: new Date().toISOString(),
        });
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', signBody(body))
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
    });

    it('Case 2: missing signature header → 401', async () => {
        const body = JSON.stringify({ type: 'operator.registered' });
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .send(body);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('missing_signature');
    });

    it('Case 3: wrong signature → 401 (not 400, not 403)', async () => {
        const body = JSON.stringify({ type: 'operator.registered' });
        // Correctly-shaped but wrong-value sha256 hex.
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', 'sha256=' + '0'.repeat(64))
            .send(body);
        expect(res.status).toBe(401);
        expect([400, 403]).not.toContain(res.status);
        expect(res.body.error).toBe('invalid_signature');
    });

    it('Case 4: unknown event type with valid signature → 200 (logged, acknowledged)', async () => {
        const body = JSON.stringify({
            type: 'made.up.event.that.does.not.exist',
            data: { anything: 'here' },
        });
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', signBody(body))
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
    });

    // ─── Additional guardrails ──────────────────────────────
    // These aren't from the 4-case runbook but pin important
    // behaviours the spec implied ("within 5s", "don't block").

    it('responds well within the 5-second budget', async () => {
        const body = JSON.stringify({ type: 'operator.registered' });
        const t0 = Date.now();
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', signBody(body))
            .send(body);
        const elapsedMs = Date.now() - t0;
        expect(res.status).toBe(200);
        expect(elapsedMs).toBeLessThan(5000);
    });

    it('accepts a bare-hex signature (back-compat with non-prefixed senders)', async () => {
        const body = JSON.stringify({ type: 'operator.registered' });
        const sigHex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', sigHex)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
    });

    it('is byte-exact: whitespace changes that preserve JSON semantics still flip the signature', async () => {
        // Sign the canonical (no-whitespace) form, but send a version
        // with whitespace. HMAC must reject — otherwise an attacker who
        // captured a signed body could re-format it and it'd still pass.
        const canonical = JSON.stringify({ type: 'operator.registered', a: 1 });
        const withSpace = '{ "type": "operator.registered", "a": 1 }';
        const sig = signBody(canonical);
        const res = await request(app)
            .post('/webhooks/eternitas')
            .set('Content-Type', 'application/json')
            .set('X-Eternitas-Signature', sig)
            .send(withSpace);
        expect(res.status).toBe(401);
    });
});
