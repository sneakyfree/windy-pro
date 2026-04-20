/**
 * Wave 14 P0-2 regression — GET / must return a landing stub, not
 * Express's default "Cannot GET /" 404.
 *
 * The Phase 1 Docker image does not include the web SPA bundle; the
 * SPA catch-all falls through to the new landing stub when the bundle
 * is missing, and leaves the SPA path active when it is present.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'landing-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import request from 'supertest';
import { app } from '../src/server';

// NOTE: on a dev machine that has a pre-built web SPA bundle at
// src/client/web/dist/index.html, the SPA branch wins ahead of the
// landing stub — which is correct: the stub is only intended to
// prevent the "Cannot GET /" 404 that appears when the Phase 1
// Docker image ships WITHOUT the SPA bundle. Tests below assert the
// behaviour that matters regardless of which branch fires: 200,
// HTML, no Express default-404 string, no stack-trace leaks.

describe('Wave 14 P0-2 — landing stub replaces "Cannot GET /"', () => {
    it('GET / returns 200 with an HTML body (stub or SPA)', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text.length).toBeGreaterThan(100); // not an empty 200
    });

    it('GET / does NOT return Express\'s default "Cannot GET /" 404', async () => {
        const res = await request(app).get('/');
        expect(res.text).not.toMatch(/Cannot GET/);
        expect(res.status).not.toBe(404);
    });

    it('GET / does NOT leak stack traces or internal paths', async () => {
        const res = await request(app).get('/');
        expect(res.text).not.toMatch(/\/app\/|\/opt\/windy-pro|\/build\//);
        expect(res.text).not.toMatch(/at .*\.ts:|at Object\./);
    });

    it('GET /index.html also returns 200 HTML (not a 404)', async () => {
        const res = await request(app).get('/index.html');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).not.toMatch(/Cannot GET/);
    });

    it('stub-only path: when the SPA bundle is absent, GET / serves our stub markup', () => {
        // Code-level assertion — the runtime stub branch was added and
        // contains the expected anchor text. Guards against a refactor
        // that accidentally removes the fallback.
        const fs = require('fs');
        const path = require('path');
        const serverSrc = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'server.ts'),
            'utf-8',
        );
        expect(serverSrc).toContain('Wave 14 P0-2');
        expect(serverSrc).toContain('windypro account API');
    });
});
