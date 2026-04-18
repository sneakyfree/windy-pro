/**
 * Wave 8 — Broker-token lifecycle tests.
 *
 * Covers:
 *  - HMAC-gate on POST /api/v1/agent/credentials/issue (401 without sig,
 *    401 with wrong sig, 401 with stale timestamp, 200 with correct sig).
 *  - Tier-based provider routing (free → gemini, pro → anthropic).
 *  - Verify → meter → exhaustion → revoke cascade from a passport revoke.
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Isolate this test's DB from the shared accounts.db used by other suites.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.BROKER_HMAC_SECRET = 'test-broker-secret-xxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-eternitas-webhook-secret-xxxxxxxxxxxxxxxx';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import {
    issueBrokerToken,
    verifyBrokerToken,
    meterBrokerUsage,
    signBrokerRequest,
    revokeBrokerTokensForPassport,
    chooseProvider,
} from '../src/services/credential-broker';
import crypto from 'crypto';

function makeUser(tier = 'free', passport: string | null = null): { id: string; windy_identity_id: string } {
    const db = getDb();
    const id = crypto.randomUUID();
    const wid = crypto.randomUUID();
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, passport_id, identity_type)
         VALUES (?, ?, 'Test User', 'x', ?, ?, ?, ?, 'human')`,
    ).run(id, `u-${id}@test.local`, tier, tier, wid, passport);
    if (passport) {
        db.prepare(
            `INSERT INTO eternitas_passports (id, identity_id, passport_number, status, registered_at)
             VALUES (?, ?, ?, 'active', datetime('now'))`,
        ).run(crypto.randomUUID(), id, passport);
    }
    return { id, windy_identity_id: wid };
}

describe('Wave 8 — broker token lifecycle', () => {
    describe('tier routing', () => {
        it('free tier routes to gemini', () => {
            const choice = chooseProvider('free');
            expect(choice.provider).toBe('gemini');
            expect(choice.model).toMatch(/gemini/);
        });
        it('pro tier routes to anthropic', () => {
            const choice = chooseProvider('pro');
            expect(choice.provider).toBe('anthropic');
        });
        it('unknown tier falls back to free/gemini', () => {
            expect(chooseProvider('galaxy-brain').provider).toBe('gemini');
        });
    });

    describe('issue → verify → meter → exhaust', () => {
        it('issues a token that verifies, then meters to exhaustion', () => {
            const user = makeUser('free');
            const issued = issueBrokerToken({ windy_identity_id: user.windy_identity_id, duration_seconds: 3600 });
            expect(issued.broker_token).toMatch(/^bk_live_/);
            expect(issued.provider).toBe('gemini');

            const v1 = verifyBrokerToken(issued.broker_token);
            expect(v1.ok).toBe(true);

            // Exhaust the cap in a single meter call.
            meterBrokerUsage(issued.broker_token, issued.usage_cap_tokens + 10);
            const v2 = verifyBrokerToken(issued.broker_token);
            expect(v2.ok).toBe(false);
            expect(v2.reason).toBe('exhausted');
        });

        it('rejects unknown tokens with not_found', () => {
            expect(verifyBrokerToken('bk_live_not_a_real_token').ok).toBe(false);
            expect(verifyBrokerToken('').ok).toBe(false);
        });
    });

    describe('revocation cascade from passport', () => {
        it('revokes every live token issued against a revoked passport', async () => {
            const passport = 'ET26-TEST-0001';
            const user = makeUser('free', passport);
            const t1 = issueBrokerToken({ windy_identity_id: user.windy_identity_id, passport_number: passport });
            const t2 = issueBrokerToken({ windy_identity_id: user.windy_identity_id, passport_number: passport });

            expect(verifyBrokerToken(t1.broker_token).ok).toBe(true);
            expect(verifyBrokerToken(t2.broker_token).ok).toBe(true);

            const n = await revokeBrokerTokensForPassport(passport, 'test-reason');
            expect(n).toBeGreaterThanOrEqual(2);

            const v1 = verifyBrokerToken(t1.broker_token);
            const v2 = verifyBrokerToken(t2.broker_token);
            expect(v1.ok).toBe(false);
            expect(v1.reason).toBe('revoked');
            expect(v2.ok).toBe(false);
            expect(v2.reason).toBe('revoked');
        });

        it('will not issue new tokens against a revoked passport', async () => {
            const passport = 'ET26-TEST-0002';
            const user = makeUser('free', passport);
            await revokeBrokerTokensForPassport(passport, 'pre-emptive-revoke');
            getDb().prepare(`UPDATE eternitas_passports SET status = 'revoked' WHERE passport_number = ?`).run(passport);

            expect(() => issueBrokerToken({
                windy_identity_id: user.windy_identity_id, passport_number: passport,
            })).toThrow(/revoked/);
        });
    });
});

describe('Wave 8 — POST /api/v1/agent/credentials/issue HMAC gate', () => {
    it('rejects a request with NO signature (401)', async () => {
        const user = makeUser('free');
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .send({ windy_identity_id: user.windy_identity_id });
        expect(res.status).toBe(401);
    });

    it('rejects a request with WRONG signature (401)', async () => {
        const user = makeUser('free');
        const body = { windy_identity_id: user.windy_identity_id };
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Broker-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Broker-Signature', 'deadbeef')
            .send(body);
        expect(res.status).toBe(401);
    });

    it('rejects a stale-timestamp signed request (401)', async () => {
        const user = makeUser('free');
        const body = { windy_identity_id: user.windy_identity_id };
        const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
        const { signature } = signBrokerRequest('POST', '/api/v1/agent/credentials/issue', JSON.stringify(body), undefined, oldTs);
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Broker-Timestamp', oldTs)
            .set('X-Broker-Signature', signature)
            .send(body);
        expect(res.status).toBe(401);
    });

    it('accepts a correctly-signed request and returns a token', async () => {
        const user = makeUser('pro');
        const body = { windy_identity_id: user.windy_identity_id, duration_seconds: 600 };
        const { timestamp, signature } = signBrokerRequest(
            'POST',
            '/api/v1/agent/credentials/issue',
            JSON.stringify(body),
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Broker-Timestamp', timestamp)
            .set('X-Broker-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.broker_token).toMatch(/^bk_live_/);
        expect(res.body.provider).toBe('anthropic');
        expect(res.body.expires_at).toBeTruthy();
    });

    it('rejects a signed request for an unknown identity (404)', async () => {
        const body = { windy_identity_id: crypto.randomUUID() };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/issue', JSON.stringify(body),
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Broker-Timestamp', timestamp)
            .set('X-Broker-Signature', signature)
            .send(body);
        expect(res.status).toBe(404);
    });
});
