/**
 * Voice dispatch — contract tests for the v0 scaffold.
 *
 * Verifies:
 *   - POST /voice/dispatch validates input, persists a row, returns
 *     { task_id, transcript, stream_url } with the contract shape.
 *   - GET /voice/tasks/:id/events streams the documented event names
 *     in order: dispatched → thinking → (response → done | scaffold_mode → done | failed).
 *   - Task ownership is enforced (403 for another user).
 *   - Scaffold mode kicks in when WINDYFLY_GATEWAY_URL is unset.
 *   - When the gateway is configured and returns a response, the
 *     stream emits `response` then `done`, and the row's status is
 *     updated to 'done' with the response cached for replay.
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-dispatch-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

const realFetch = global.fetch;
type FetchHandler = (url: string, init: RequestInit) => Promise<any>;
let handler: FetchHandler = async () => { throw new Error('no handler'); };

beforeEach(() => {
    global.fetch = (async (url: any, init: any) => handler(String(url), init || {})) as any;
});
afterAll(() => { global.fetch = realFetch; });
afterEach(() => {
    delete process.env.WINDYFLY_GATEWAY_URL;
});

function makeUser(): { token: string; userId: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    const email = `u-${userId}@test.local`;
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type)
         VALUES (?, ?, 'Voice Tester', 'x', 'free', 'free', ?, 'human')`,
    ).run(userId, email, crypto.randomUUID());
    const token = jwt.sign({ userId, email }, process.env.JWT_SECRET!, {
        algorithm: 'HS256',
        expiresIn: '5m',
    });
    return { token, userId };
}

function parseSse(body: string): Array<{ event: string; data: any }> {
    const events: Array<{ event: string; data: any }> = [];
    for (const frame of body.split('\n\n')) {
        const lines = frame.split('\n').filter(Boolean);
        let event = 'message';
        let data = '';
        for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (event && data) {
            try {
                events.push({ event, data: JSON.parse(data) });
            } catch {
                events.push({ event, data });
            }
        }
    }
    return events;
}

describe('POST /api/v1/voice/dispatch', () => {
    it('rejects missing text with 400', async () => {
        const { token } = makeUser();
        const r = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/text/);
    });

    it('rejects empty / whitespace text with 400', async () => {
        const { token } = makeUser();
        const r = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: '   ' });
        expect(r.status).toBe(400);
    });

    it('rejects text over 10k chars with 400', async () => {
        const { token } = makeUser();
        const huge = 'a'.repeat(10_001);
        const r = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: huge });
        expect(r.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
        const r = await request(app)
            .post('/api/v1/voice/dispatch')
            .send({ text: 'hello' });
        expect(r.status).toBe(401);
    });

    it('persists a task row and returns the contract shape', async () => {
        const { token, userId } = makeUser();
        const r = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: 'research Austin and email Bob', context: { surface: 'mail' } });
        expect(r.status).toBe(202);
        expect(r.body.task_id).toMatch(/^vt_[0-9a-f]{32}$/);
        expect(r.body.transcript).toBe('research Austin and email Bob');
        expect(r.body.stream_url).toBe(`/api/v1/voice/tasks/${r.body.task_id}/events`);

        const row = getDb().prepare(
            'SELECT * FROM voice_tasks WHERE task_id = ?',
        ).get(r.body.task_id) as any;
        expect(row).toBeTruthy();
        expect(row.user_id).toBe(userId);
        expect(row.transcript).toBe('research Austin and email Bob');
        expect(row.surface).toBe('mail');
        expect(row.status).toBe('pending');
    });
});

describe('GET /api/v1/voice/tasks/:id/events', () => {
    it('returns 404 for unknown task', async () => {
        const { token } = makeUser();
        const r = await request(app)
            .get('/api/v1/voice/tasks/vt_unknown/events')
            .set('Authorization', `Bearer ${token}`);
        expect(r.status).toBe(404);
    });

    it('returns 403 for another user\'s task', async () => {
        const alice = makeUser();
        const bob = makeUser();
        const dispatch = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${alice.token}`)
            .send({ text: 'alice task' });
        const r = await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${bob.token}`);
        expect(r.status).toBe(403);
    });

    it('streams scaffold_mode + done when WINDYFLY_GATEWAY_URL is unset', async () => {
        delete process.env.WINDYFLY_GATEWAY_URL;
        const { token } = makeUser();
        const dispatch = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: 'hi' });
        const stream = await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${token}`)
            .buffer(true);

        const events = parseSse(stream.text);
        const eventNames = events.map((e) => e.event);
        expect(eventNames).toContain('dispatched');
        expect(eventNames).toContain('thinking');
        expect(eventNames).toContain('scaffold_mode');
        expect(eventNames[eventNames.length - 1]).toBe('done');
        expect(events[0].data.transcript).toBe('hi');
    });

    it('streams response + done when gateway returns ok', async () => {
        process.env.WINDYFLY_GATEWAY_URL = 'http://gateway.test';
        handler = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ response: 'sure thing, on it' }),
        });
        const { token } = makeUser();
        const dispatch = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: 'plan a trip' });
        const stream = await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${token}`)
            .buffer(true);

        const events = parseSse(stream.text);
        const names = events.map((e) => e.event);
        expect(names).toEqual(['dispatched', 'thinking', 'response', 'done']);
        expect(events[2].data.text).toBe('sure thing, on it');

        const row = getDb().prepare(
            'SELECT status, response FROM voice_tasks WHERE task_id = ?',
        ).get(dispatch.body.task_id) as any;
        expect(row.status).toBe('done');
        expect(row.response).toBe('sure thing, on it');
    });

    it('replays cached response on reconnect (idempotent SSE)', async () => {
        process.env.WINDYFLY_GATEWAY_URL = 'http://gateway.test';
        handler = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ response: 'cached answer' }),
        });
        const { token } = makeUser();
        const dispatch = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: 'something' });

        // First subscription completes the task.
        await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${token}`)
            .buffer(true);

        // Switch handler so a real fetch would fail — proves the second
        // call is purely a cache replay.
        handler = async () => { throw new Error('should not have re-fetched'); };

        const replay = await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${token}`)
            .buffer(true);

        const events = parseSse(replay.text);
        expect(events.map((e) => e.event)).toEqual(['dispatched', 'response', 'done']);
        expect(events[1].data.text).toBe('cached answer');
        expect(events[2].data.replayed).toBe(true);
    });

    it('streams scaffold_mode when gateway is unreachable', async () => {
        process.env.WINDYFLY_GATEWAY_URL = 'http://gateway.test';
        handler = async () => { throw new Error('ECONNREFUSED'); };
        const { token } = makeUser();
        const dispatch = await request(app)
            .post('/api/v1/voice/dispatch')
            .set('Authorization', `Bearer ${token}`)
            .send({ text: 'hello' });
        const stream = await request(app)
            .get(`/api/v1/voice/tasks/${dispatch.body.task_id}/events`)
            .set('Authorization', `Bearer ${token}`)
            .buffer(true);

        const events = parseSse(stream.text);
        const names = events.map((e) => e.event);
        expect(names).toContain('scaffold_mode');
        expect(names[names.length - 1]).toBe('done');
    });
});
