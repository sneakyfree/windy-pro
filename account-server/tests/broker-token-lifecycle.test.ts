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
    verifyBrokerSignature,
    canonicalJsonStringify,
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

describe('Wave 8 — canonical JSON serialization', () => {
    it('sorts object keys alphabetically at every level', () => {
        const out = canonicalJsonStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
        expect(out).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
    });
    it('preserves array element order', () => {
        expect(canonicalJsonStringify([{ b: 1, a: 2 }, 3])).toBe('[{"a":2,"b":1},3]');
    });
    it('uses minimal separators (no spaces)', () => {
        expect(canonicalJsonStringify({ a: [1, 2], b: null })).toBe('{"a":[1,2],"b":null}');
    });
    it('matches python json.dumps(payload, separators=(",", ":"), sort_keys=True) byte-for-byte', () => {
        // Reference string produced by: python3 -c 'import json; print(json.dumps({"windy_identity_id":"u-1","duration_seconds":600,"scope":"llm:chat","nested":{"z":1,"a":2}}, separators=(",", ":"), sort_keys=True))'
        const payload = {
            windy_identity_id: 'u-1',
            duration_seconds: 600,
            scope: 'llm:chat',
            nested: { z: 1, a: 2 },
        };
        expect(canonicalJsonStringify(payload)).toBe(
            '{"duration_seconds":600,"nested":{"a":2,"z":1},"scope":"llm:chat","windy_identity_id":"u-1"}',
        );
    });
});

describe('Wave 8 — signature verify / sort-keys canonicalization', () => {
    it('accepts a signature over the sort-keys canonical body regardless of send-order', () => {
        const payload = { windy_identity_id: 'abc', duration_seconds: 600, scope: 'llm:chat' };
        const { timestamp, signature } = signBrokerRequest('POST', '/x', payload);
        // Re-order keys on the "received" side — verify must still pass
        // because both sides re-canonicalize the parsed object.
        const reordered = { scope: 'llm:chat', duration_seconds: 600, windy_identity_id: 'abc' };
        const r = verifyBrokerSignature('POST', '/x', reordered, timestamp, signature);
        expect(r.ok).toBe(true);
    });
    it('rejects a signature computed over a different payload', () => {
        const { timestamp, signature } = signBrokerRequest('POST', '/x', { a: 1 });
        const r = verifyBrokerSignature('POST', '/x', { a: 2 }, timestamp, signature);
        expect(r.ok).toBe(false);
    });
    it('accepts the header value with "sha256=" prefix', () => {
        const payload = { windy_identity_id: 'abc' };
        const { timestamp, signature } = signBrokerRequest('POST', '/x', payload);
        expect(signature).toMatch(/^sha256=[a-f0-9]+$/);
        expect(verifyBrokerSignature('POST', '/x', payload, timestamp, signature).ok).toBe(true);
    });
    it('accepts a bare-hex signature (back-compat for in-flight clients)', () => {
        const payload = { a: 1 };
        const { timestamp, signature } = signBrokerRequest('POST', '/x', payload);
        const bare = signature.replace(/^sha256=/, '');
        expect(verifyBrokerSignature('POST', '/x', payload, timestamp, bare).ok).toBe(true);
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
            .set('X-Windy-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Windy-Signature', 'sha256=deadbeef')
            .send(body);
        expect(res.status).toBe(401);
    });

    it('rejects a stale-timestamp signed request (401)', async () => {
        const user = makeUser('free');
        const body = { windy_identity_id: user.windy_identity_id };
        const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
        const { signature } = signBrokerRequest('POST', '/api/v1/agent/credentials/issue', body, undefined, oldTs);
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Windy-Timestamp', oldTs)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(401);
    });

    it('rejects the old X-Broker-* header names (401)', async () => {
        // The rename is the whole point of this fix. If a caller is still
        // sending the legacy headers, the verify must 401 rather than
        // silently accepting them.
        const user = makeUser('free');
        const body = { windy_identity_id: user.windy_identity_id };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/issue', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Broker-Timestamp', timestamp)
            .set('X-Broker-Signature', signature)
            .send(body);
        expect(res.status).toBe(401);
    });

    it('accepts a correctly-signed request with X-Windy-* headers and returns a token', async () => {
        const user = makeUser('pro');
        const body = { windy_identity_id: user.windy_identity_id, duration_seconds: 600 };
        const { timestamp, signature } = signBrokerRequest(
            'POST',
            '/api/v1/agent/credentials/issue',
            body,
        );
        // Header must carry the "sha256=" prefix by default.
        expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.broker_token).toMatch(/^bk_live_/);
        expect(res.body.provider).toBe('anthropic');
        expect(res.body.expires_at).toBeTruthy();
    });

    it('accepts a signature computed over the sort-keys canonical body when the client sends keys in arbitrary JSON order', async () => {
        // This mimics windy-agent's python side: it signs
        // json.dumps(payload, separators=(",", ":"), sort_keys=True) and
        // sends the request. Supertest will serialize our unsorted object
        // in insertion order, but on the server side express.json()
        // parses to an object and we re-canonicalize with sort_keys.
        const user = makeUser('starter');
        const body = { scope: 'llm:chat', windy_identity_id: user.windy_identity_id, duration_seconds: 900 };
        const { timestamp, signature } = signBrokerRequest(
            'POST',
            '/api/v1/agent/credentials/issue',
            body, // signed via canonicalJsonStringify (sort_keys)
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.provider).toBe('openai');
    });

    it('rejects a signed request for an unknown identity (404)', async () => {
        const body = { windy_identity_id: crypto.randomUUID() };
        const { timestamp, signature } = signBrokerRequest(
            'POST', '/api/v1/agent/credentials/issue', body,
        );
        const res = await request(app)
            .post('/api/v1/agent/credentials/issue')
            .set('X-Windy-Timestamp', timestamp)
            .set('X-Windy-Signature', signature)
            .send(body);
        expect(res.status).toBe(404);
    });
});
