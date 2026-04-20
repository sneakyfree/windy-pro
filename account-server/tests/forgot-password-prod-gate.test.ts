/**
 * Wave 14 P0-1 regression — /auth/forgot-password must NOT return
 * _devToken in production.
 *
 * Smoke report 2026-04-19 found the dev convenience branch leaking
 * reset tokens in the response body whenever the mailer stubbed (no
 * RESEND_API_KEY configured). Any anonymous caller that knew a user's
 * email could exploit this to take over the account.
 *
 * This test pins two behaviours at once:
 *   1. In production, the response NEVER contains _devToken.
 *   2. server.ts still boots when RESEND_API_KEY is set (the
 *      companion fail-closed assertion in server.ts).
 */
import path from 'path';
import fs from 'fs';
import os from 'os';

// Isolate DB from other suites BEFORE importing the server. Anything
// that reaches `process.env` at module-load time (CORS, RESEND,
// TRUST_PROXY) must be set here.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgot-prod-'));
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'forgot-prod-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.TRUST_PROXY = '1';
process.env.CORS_ALLOWED_ORIGINS = 'https://api.windyword.ai';
process.env.RESEND_API_KEY = 'resend-stub-for-test-xxxxxxxxxxxxxxxxxxx'; // satisfies fail-closed; mailer will still stub because the key is not real

import request from 'supertest';
import { app } from '../src/server';
import bcrypt from 'bcryptjs';
import { getDb } from '../src/db/schema';
import { v4 as uuidv4 } from 'uuid';

async function registerProdUser(email: string) {
    const db = getDb();
    const hash = await bcrypt.hash('Pr0duction!', 10);
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, ?, ?, ?)`,
    ).run(uuidv4(), email, 'Prod Tester', hash, 'free');
}

describe('Wave 14 P0-1 — /auth/forgot-password in production', () => {
    it('never returns _devToken even when the mailer stubs', async () => {
        const email = `prod-${Date.now()}@forgot-prod.test`;
        await registerProdUser(email);

        const res = await request(app)
            .post('/api/v1/auth/forgot-password')
            .send({ email });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).not.toHaveProperty('_devToken');
        expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z0-9_-]{20,}/);
    });

    it('also returns no _devToken for unknown emails (existing behaviour, regression guard)', async () => {
        const res = await request(app)
            .post('/api/v1/auth/forgot-password')
            .send({ email: 'ghost-user-who-never-registered@forgot-prod.test' });
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('_devToken');
    });
});
