/**
 * Hatch failure recovery — a FAILED hatch session must not permanently
 * brick the identity behind a false "already hatched — ok" replay.
 *
 * Bug under test (launch-blocker): createHatchSession returned ANY
 * existing hatch_sessions row (UNIQUE per windy_identity_id) including
 * status='failed', and the replay branch in routes/agent.ts emitted a
 * terminal hatch.complete with status:'ok' for any non-'running'
 * session. One transient Eternitas outage during the single hatch meant
 * every retry forever said "Agent already hatched — ok" with no agent.
 *
 * Fix under test:
 *   1. A failed session is RESET (same row id — the UNIQUE constraint is
 *      kept) and the real hatch re-runs.
 *   2. A genuinely completed session STILL replays success (happy path
 *      unchanged), and the replayed status is honest ('ok' only for
 *      'complete').
 *
 * Conventions mirror tests/agent-hatch-sse.test.ts (supertest + mocked
 * global.fetch + SSE frame parsing).
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-recovery-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;
process.env.BROKER_HMAC_SECRET = 'test-broker-secret-xxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.ETERNITAS_URL = 'http://eternitas.test';
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-etw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.WINDY_CHAT_URL = 'http://chat.test';
process.env.WINDY_AGENT_URL = 'http://agent.test';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

// Capture fetch and mock per-test.
const realFetch = global.fetch;

type FetchHandler = (url: string, init: RequestInit) => Promise<any>;
let handler: FetchHandler = async () => { throw new Error('no handler'); };

beforeEach(() => {
    global.fetch = (async (url: any, init: any) => handler(String(url), init || {})) as any;
    // Mail must provision for a clean 'ok' hatch.complete (otherwise the
    // honest-partial-birth logic reports degraded:['mail']).
    process.env.WINDYMAIL_API_URL = 'http://mail.test';
    process.env.WINDYMAIL_SERVICE_TOKEN = 'test-token';
});
afterAll(() => { global.fetch = realFetch; });

function makeUser(): { token: string; userId: string; windyIdentityId: string; email: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    const wid = crypto.randomUUID();
    const email = `u-${userId}@test.local`;
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type, phone)
         VALUES (?, ?, 'Nora Grandma', 'x', 'free', 'free', ?, 'human', ?)`,
    ).run(userId, email, wid, null);
    const token = jwt.sign({ userId, email }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
    return { token, userId, windyIdentityId: wid, email };
}

function parseSse(body: string): Array<{ event: string; data: any; id: string | null }> {
    const events: Array<{ event: string; data: any; id: string | null }> = [];
    const frames = body.split('\n\n');
    for (const frame of frames) {
        if (!frame.trim() || frame.startsWith(':heartbeat')) continue;
        const lines = frame.split('\n');
        let event = 'message';
        let dataLine = '';
        let id: string | null = null;
        for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) dataLine = line.slice(6);
            else if (line.startsWith('id: ')) id = line.slice(4);
        }
        try {
            events.push({ event, data: JSON.parse(dataLine), id });
        } catch { /* heartbeat or malformed */ }
    }
    return events;
}

async function postHatch(token: string): Promise<Array<{ event: string; data: any; id: string | null }>> {
    const res = await request(app)
        .post('/api/v1/agent/hatch')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true).parse((r: any, cb: any) => {
            let chunks = '';
            r.on('data', (c: Buffer) => (chunks += c.toString()));
            r.on('end', () => cb(null, chunks));
        });
    expect(res.status).toBe(200);
    return parseSse(res.body as unknown as string);
}

/** All sister services succeed; records which were actually called. */
function successHandler(calls: Record<string, boolean>): FetchHandler {
    return async (url) => {
        if (url.includes('eternitas.test') && url.includes('auto-hatch')) {
            calls.eternitas = true;
            return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-RTRY-0001' }) };
        }
        if (url.includes('agent.test') && url.includes('/hatch/remote')) {
            calls.hatchRemote = true;
            return { ok: true, status: 200, json: async () => ({ host: 'vps-01', agent_id: 'agt_retry' }) };
        }
        if (url.includes('chat.test')) {
            calls.chat = true;
            return { ok: true, status: 200, json: async () => ({
                matrix_user_id: '@retry-agent:chat.windychat.ai',
                dm_room_id: '!retry:chat.windychat.ai',
            }) };
        }
        if (url.includes('mail.test')) {
            calls.mail = true;
            return { ok: true, status: 200, json: async () => ({ email: 'retry-agent@windymail.ai' }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    };
}

describe('POST /api/v1/agent/hatch — failure recovery', () => {
    it('re-runs the real hatch when the existing session is failed (seeded row) — never a false ok replay', async () => {
        const user = makeUser();
        const db = getDb();

        // Seed the exact broken state: a permanent 'failed' session left
        // behind by a transient Eternitas outage.
        const sessionId = crypto.randomUUID();
        db.prepare(
            `INSERT INTO hatch_sessions (id, windy_identity_id, status, last_event_seq, events, error, completed_at)
             VALUES (?, ?, 'failed', 2, ?, 'eternitas_failed', datetime('now'))`,
        ).run(sessionId, user.windyIdentityId, JSON.stringify([
            { seq: 1, at: '2026-07-18T00:00:00.000Z', type: 'eternitas.registering', status: 'pending', label: 'Registering passport with Eternitas…' },
            { seq: 2, at: '2026-07-18T00:00:01.000Z', type: 'eternitas.registered', status: 'failed', label: 'Eternitas refused the hatch (HTTP 503).', data: { error: 'status_503' } },
        ]));

        const calls: Record<string, boolean> = {};
        handler = successHandler(calls);

        const events = await postHatch(user.token);

        // The real ceremony ran — Eternitas was actually called again.
        expect(calls.eternitas).toBe(true);

        // No frame anywhere claims a resumed success for the failed session.
        const falseReplays = events.filter(
            e => e.event === 'hatch.complete' && e.data?.data?.resumed === true && e.data?.status === 'ok',
        );
        expect(falseReplays).toHaveLength(0);

        // The terminal frame is a FRESH successful hatch.
        const completes = events.filter(e => e.event === 'hatch.complete');
        expect(completes.length).toBe(1);
        const terminal = completes[0]!.data;
        expect(terminal.status).toBe('ok');
        expect(terminal.data.resumed).toBe(false);

        // The UNIQUE row was RESET and reused (same id — not deleted, not
        // duplicated) and now records the successful hatch.
        const row = db.prepare(
            `SELECT id, status, error, passport_number FROM hatch_sessions WHERE windy_identity_id = ?`,
        ).get(user.windyIdentityId) as any;
        expect(row.id).toBe(sessionId);
        expect(row.status).toBe('complete');
        expect(row.error).toBeNull();
        expect(row.passport_number).toBe('ET26-RTRY-0001');
    });

    it('recovers end-to-end: transient Eternitas outage on hatch #1, retry hatch #2 succeeds', async () => {
        const user = makeUser();
        const db = getDb();

        // Hatch #1 — Eternitas is down.
        handler = async (url) => {
            if (url.includes('eternitas.test') && url.includes('auto-hatch')) {
                return { ok: false, status: 503, json: async () => ({ error: 'eternitas_down' }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        const firstEvents = await postHatch(user.token);
        const etFail = firstEvents.find(e => e.event === 'eternitas.registered')!.data;
        expect(etFail.status).toBe('failed');

        const failedRow = db.prepare(
            `SELECT id, status FROM hatch_sessions WHERE windy_identity_id = ?`,
        ).get(user.windyIdentityId) as any;
        expect(failedRow.status).toBe('failed');

        // Hatch #2 — Eternitas is back. The retry must NOT replay the
        // failure as a success; it must run the ceremony for real.
        const calls: Record<string, boolean> = {};
        handler = successHandler(calls);
        const secondEvents = await postHatch(user.token);

        expect(calls.eternitas).toBe(true);
        const terminal = secondEvents.filter(e => e.event === 'hatch.complete').pop()!.data;
        expect(terminal.status).toBe('ok');
        expect(terminal.data.resumed).toBe(false);

        const finalRow = db.prepare(
            `SELECT id, status FROM hatch_sessions WHERE windy_identity_id = ?`,
        ).get(user.windyIdentityId) as any;
        expect(finalRow.id).toBe(failedRow.id);   // same UNIQUE row, reset + reused
        expect(finalRow.status).toBe('complete');
    });

    it('does NOT regress the happy path: a genuinely completed session still replays success', async () => {
        const user = makeUser();

        const calls: Record<string, boolean> = {};
        handler = successHandler(calls);
        await postHatch(user.token);
        expect(calls.eternitas).toBe(true);

        // Second call — the completed session must replay without any
        // external calls, and the replayed terminal status must be an
        // honest 'ok' (the session really did complete).
        handler = async () => { throw new Error('replay of a completed session must not make external calls'); };
        const events = await postHatch(user.token);

        const completes = events.filter(e => e.event === 'hatch.complete');
        expect(completes.length).toBeGreaterThanOrEqual(1);
        const terminal = completes[completes.length - 1]!.data;
        expect(terminal.status).toBe('ok');
        expect(terminal.data.resumed).toBe(true);
        expect(terminal.data.status).toBe('complete');
    });
});
