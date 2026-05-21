/**
 * WD-31 M-D acceptance tests for GET /api/v1/vitals.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-vitals-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest-cp-vitals';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { VitalsV1Schema, VITALS_V1_SCHEMA_ID } from '../src/contracts/control-panel';

function makeUser(): { token: string; userId: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type)
         VALUES (?, ?, 'Vitals User', 'x', 'free', 'free', ?, 'human')`,
    ).run(userId, `vitals-${userId}@test.local`, crypto.randomUUID());
    const token = jwt.sign(
        { userId, email: `vitals-${userId}@test.local` },
        process.env.JWT_SECRET!,
        { algorithm: 'HS256', expiresIn: '5m' },
    );
    return { token, userId };
}

describe('GET /api/v1/vitals', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).get('/api/v1/vitals');
        expect(res.status).toBe(401);
    });

    it('returns a Vitals v1 payload for authenticated users', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        const parsed = VitalsV1Schema.safeParse(res.body);
        if (!parsed.success) console.error(JSON.stringify(parsed.error.issues, null, 2));
        expect(parsed.success).toBe(true);
    });

    it('self-identifies with the canonical schema id', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.schema).toBe(VITALS_V1_SCHEMA_ID);
        expect(res.body.schema).toBe('windy.vitals.v1');
    });

    it('declares source="account-server"', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.source).toBe('account-server');
    });

    it('returns honest placeholder nulls for unmeasured server fields', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.gpu).toBeNull();
        expect(res.body.thermal).toBeNull();
        expect(res.body.host.location).toBeNull();
        expect(res.body.host.model).toBeNull();
        expect(res.body.cpu.temperature_c).toBeNull();
        expect(res.body.processes.running).toBeNull();
        expect(res.body.processes.sleeping).toBeNull();
        expect(res.body.network.total_tx_bytes_per_sec).toBe(0);
        expect(res.body.network.total_rx_bytes_per_sec).toBe(0);
    });

    it('returns integer-typed disk, memory, processes counts', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(Number.isInteger(res.body.memory.total_bytes)).toBe(true);
        expect(Number.isInteger(res.body.memory.available_bytes)).toBe(true);
        expect(Number.isInteger(res.body.disk.total_bytes)).toBe(true);
        expect(Number.isInteger(res.body.disk.used_bytes)).toBe(true);
        expect(Number.isInteger(res.body.processes.all)).toBe(true);
    });

    it('returns a fresh ISO 8601 sampled_at timestamp', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        const ts = Date.parse(res.body.sampled_at);
        expect(Number.isFinite(ts)).toBe(true);
        expect(Date.now() - ts).toBeLessThan(60_000);
    });

    it('returns a 3-element load average', async () => {
        const { token } = makeUser();
        const res = await request(app)
            .get('/api/v1/vitals')
            .set('Authorization', `Bearer ${token}`);
        expect(Array.isArray(res.body.load)).toBe(true);
        expect(res.body.load).toHaveLength(3);
        for (const n of res.body.load) expect(n).toBeGreaterThanOrEqual(0);
    });
});
