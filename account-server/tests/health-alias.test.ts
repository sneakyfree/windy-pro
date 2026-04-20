/**
 * Wave 14 P1-2 regression — /api/v1/health alias.
 *
 * The smoke report found /api/v1/health returning 404 while /health
 * and /healthz returned 200. The ECOSYSTEM_API_REFERENCE + sister
 * services expected /api/v1/health to respond. Alias added to the
 * same handler so all three paths share one implementation + cache.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-alias-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'health-alias-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import request from 'supertest';
import { app } from '../src/server';

describe('Wave 14 P1-2 — /api/v1/health alias', () => {
    for (const p of ['/health', '/healthz', '/api/v1/health']) {
        it(`${p} returns a healthy JSON envelope`, async () => {
            const res = await request(app).get(p);
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.service).toBe('windy-pro-account-server');
            expect(typeof res.body.uptime_seconds).toBe('number');
            expect(res.body.database).toBe('ok');
        });
    }

    it('all three aliases return the same payload shape', async () => {
        const [a, b, c] = await Promise.all([
            request(app).get('/health'),
            request(app).get('/healthz'),
            request(app).get('/api/v1/health'),
        ]);
        // Ignore per-response fields that change between calls
        const same = (x: any) => {
            const { uptime_seconds, timestamp, ...rest } = x;
            return rest;
        };
        expect(same(a.body)).toEqual(same(b.body));
        expect(same(b.body)).toEqual(same(c.body));
    });
});
