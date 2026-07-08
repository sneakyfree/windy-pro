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

    it('activated key → 200 valid:true with tier, on both path aliases', async () => {
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
});
