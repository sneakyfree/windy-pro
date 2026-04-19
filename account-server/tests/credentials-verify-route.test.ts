/**
 * Wave 13 — POST /api/v1/agent/credentials/verify HMAC gate.
 *
 * Mirrors the /credentials/issue test surface: 401 on missing /
 * wrong / stale signature, 200 with {ok, token} on a valid verify,
 * 200 with {ok:false, reason:"not_found"} on an unknown token. The
 * sister-side contract lives in
 * windy-agent/gateway/src/broker-verify.ts — if that file renames a
 * field, these assertions must move too.
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-route-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.BROKER_HMAC_SECRET = 'test-broker-secret-xxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-eternitas-webhook-secret-xxxxxxxxxxxxxxxx';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { issueBrokerToken, signBrokerRequest } from '../src/services/credential-broker';
import crypto from 'crypto';

function makeUser(tier = 'free'): { id: string; windy_identity_id: string } {
    const db = getDb();
    const id = crypto.randomUUID();
    const wid = crypto.randomUUID();
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type)
         VALUES (?, ?, 'Verify Test', 'x', ?, ?, ?, 'human')`,
    ).run(id, `u-${id}@test.local`, tier, tier, wid);
    return { id, windy_identity_id: wid };
}

describe('Wave 13 — POST /api/v1/agent/credentials/verify', () => {
    it('rejects a request with NO signature (401)', async () => {
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .send({ broker_token: 'bk_live_whatever' });
        expect(res.status).toBe(401);
    });

    it('rejects a request with WRONG signature (401)', async () => {
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Windy-Signature', 'sha256=deadbeef')
            .send({ broker_token: 'bk_live_whatever' });
        expect(res.status).toBe(401);
    });

    it('rejects a stale-timestamp signed request (401)', async () => {
        const body = { broker_token: 'bk_live_whatever' };
        const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
        const { signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/verify', body, undefined, oldTs,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', oldTs)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(401);
    });

    it('returns 400 when broker_token is missing from a validly signed body', async () => {
        const body = {};
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/verify', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(400);
    });

    it('returns 200 {ok:false, reason:"not_found"} for an unknown bk_live_ token', async () => {
        const body = { broker_token: 'bk_live_thisTokenDoesNotExistInTheDB_0123456789' };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/verify', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: false, reason: 'not_found' });
    });

    it('returns 200 {ok:false, reason:"not_found"} for a bare garbage string (no bk_ prefix)', async () => {
        const body = { broker_token: '12345678' };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/verify', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
        expect(res.body.reason).toBe('not_found');
    });

    it('returns 200 {ok:true, token:{...}} for a freshly-issued live token, with every claim the sister contract expects', async () => {
        const user = makeUser('pro');
        const issued = issueBrokerToken({
            windy_identity_id: user.windy_identity_id,
            scope: 'llm:chat',
            duration_seconds: 600,
        });
        const body = { broker_token: issued.broker_token };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/verify', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/verify')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        // Every field in BrokerTokenClaims must be present — sister-side
        // broker-verify.ts destructures these directly.
        expect(res.body.token).toEqual(expect.objectContaining({
            identity_id: user.id,
            provider: 'anthropic',
            model: expect.stringMatching(/claude/),
            scope: 'llm:chat',
            usage_cap_tokens: expect.any(Number),
            usage_tokens: expect.any(Number),
            expires_at: expect.any(String),
        }));
        // passport_number is nullable (user was created without a passport).
        expect('passport_number' in res.body.token).toBe(true);
        // `id` is Pro-internal and must NOT be leaked — the sister-side
        // claim shape explicitly omits it.
        expect('id' in res.body.token).toBe(false);
    });
});
