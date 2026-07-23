/**
 * POST /v1/license/heartbeat (+ /api/v1 alias) — desktop DRM heartbeat.
 *
 * The desktop heartbeat-service.js has phoned this endpoint since launch,
 * but the server never implemented it: every install 404'd, exhausted its
 * offline-grace window, and locked pair models with no way to unlock
 * (unlock requires a successful heartbeat).
 *
 * Response-code contract (see misc.ts): the client DELETES all model files
 * on 401/403 or reason:'revoked'. Until a real revocation flag exists this
 * endpoint must never produce either — unknown keys are 200 {valid:false}.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-heartbeat-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'license-heartbeat-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import request from 'supertest';
import { app } from '../src/server';
import { getDb } from '../src/db/schema';

const PATHS = ['/v1/license/heartbeat', '/api/v1/license/heartbeat'];
const LICENSE_KEY = 'WP-TAAA-BBBB-CCCC'; // WP-T prefix → translate tier

describe('POST /v1/license/heartbeat', () => {
    let sessionToken: string;

    beforeAll(async () => {
        const reg = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'HB', email: 'heartbeat@test.windy', password: 'Heartbeat-Test-1!' });
        expect(reg.status).toBe(201);
        sessionToken = reg.body.token;
    });

    for (const p of PATHS) {
        it(`${p} with no bearer → 200 valid:false (never 401/403)`, async () => {
            const res = await request(app).post(p).send({ timestamp: new Date().toISOString() });
            expect(res.status).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.reason).toBe('no_license');
        });
    }

    it('bearer "free" → 200 valid:false no_license', async () => {
        const res = await request(app)
            .post('/v1/license/heartbeat')
            .set('Authorization', 'Bearer free')
            .send({ timestamp: new Date().toISOString() });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ valid: false, reason: 'no_license' });
    });

    it('unknown key → 200 valid:false unknown_token, NOT 401/403 and NOT reason:revoked', async () => {
        const res = await request(app)
            .post('/v1/license/heartbeat')
            .set('Authorization', 'Bearer WP-ZZZZ-YYYY-XXXX')
            .send({ timestamp: new Date().toISOString() });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.reason).not.toBe('revoked');
    });

    it('revoke lifecycle: admin revoke → 403 revoked; reactivate → valid again', async () => {
        const reg = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'RV', email: 'revoke@test.windy', password: 'Heartbeat-Test-1!' });
        expect(reg.status).toBe(201);
        const userId = reg.body.userId;
        const token = reg.body.token;
        const key = 'WP-UREV-OKED-TEST';

        // Post-A1 (#215): the heartbeat reports the STRIPE-verified account
        // tier, never a tier parsed from the key. Simulate a paying account.
        getDb().prepare("UPDATE users SET tier = 'translate_pro' WHERE id = ?").run(userId);

        const act = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ key });
        expect(act.status).toBe(200);

        // double-activate is idempotent
        const act2 = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ key });
        expect(act2.status).toBe(200);

        const hb = () => request(app)
            .post('/v1/license/heartbeat')
            .set('Authorization', `Bearer ${key}`)
            .send({ timestamp: new Date().toISOString() });

        // tier mirrors the account (translate_pro), not the WP-U key prefix
        expect((await hb()).body).toMatchObject({ valid: true, tier: 'translate_pro' });

        // admin revoke — promote a fresh user to admin directly in the DB
        const admReg = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'ADM', email: 'hb-admin@test.windy', password: 'Heartbeat-Test-1!' });
        getDb().prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin' WHERE id = ?").run(admReg.body.userId);
        const admLogin = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'hb-admin@test.windy', password: 'Heartbeat-Test-1!' });
        const admToken = admLogin.body.token;

        const rev = await request(app)
            .post(`/api/v1/admin/users/${userId}/license/revoke`)
            .set('Authorization', `Bearer ${admToken}`)
            .send({});
        expect(rev.status).toBe(200);
        // Post-A1: activate binds the key only and never writes a paid tier,
        // so the pre-revoke license_tier is still the 'free' default (proof
        // the WP-U key did NOT self-grant translate_pro).
        expect(rev.body.previousTier).toBe('free');

        // revoked → the one deliberate 403 case (desktop deletes model files)
        const revoked = await hb();
        expect(revoked.status).toBe(403);
        expect(revoked.body).toEqual({ valid: false, reason: 'revoked' });

        // Reactivate-after-revoke restores access: activate clears the
        // 'revoked' sentinel (the reactivation fix), so the heartbeat verifies
        // again and reports the account tier. Guards BOTH invariants: a
        // still-revoked key must never verify (Mission-5 P0), AND a revoked
        // license must be recoverable (the regression this fixes).
        const react = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ key });
        expect(react.status).toBe(200);
        expect((await hb()).body).toMatchObject({ valid: true, tier: 'translate_pro' });
    });

    it('activated key → 200 valid:true with the ACCOUNT tier, on both path aliases', async () => {
        // Post-A1 (#215): the heartbeat reports the Stripe-verified account
        // tier, never tierFromKey(). Simulate a paid account, then confirm the
        // heartbeat mirrors it (not the WP-T key prefix).
        getDb().prepare("UPDATE users SET tier = 'translate' WHERE email = ?").run('heartbeat@test.windy');

        const act = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${sessionToken}`)
            .send({ key: LICENSE_KEY });
        expect(act.status).toBe(200);

        for (const p of PATHS) {
            const res = await request(app)
                .post(p)
                .set('Authorization', `Bearer ${LICENSE_KEY}`)
                .send({ timestamp: new Date().toISOString() });
            expect(res.status).toBe(200);
            expect(res.body.valid).toBe(true);
            expect(res.body.tier).toBe('translate');
        }
    });

    it('[reactivation fix] a fabricated key still cannot self-grant a paid tier (A1 invariant preserved)', async () => {
        // A free account activating any WP- key stays free — clearing the
        // 'revoked' sentinel on reactivate must never elevate an unpaid account.
        const reg = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'FREE', email: 'hb-free@test.windy', password: 'Heartbeat-Test-1!' });
        const act = await request(app)
            .post('/api/v1/license/activate')
            .set('Authorization', `Bearer ${reg.body.token}`)
            .send({ key: 'WP-UPRO-XXXX-YYYY' }); // WP-U prefix = "translate_pro" if keys granted tier
        expect(act.status).toBe(200);
        const hb = await request(app)
            .post('/v1/license/heartbeat')
            .set('Authorization', 'Bearer WP-UPRO-XXXX-YYYY')
            .send({ timestamp: new Date().toISOString() });
        expect(hb.body).toMatchObject({ valid: true, tier: 'free' });
    });
});
