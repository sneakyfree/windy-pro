/**
 * Wave 8 — POST /api/v1/agent/hatch SSE ordering test.
 *
 * Uses nock to stub the ecosystem sister services (Eternitas auto-hatch,
 * Windy Chat onboarding, Windy Fly remote hatch, Windy Mail webhook) and
 * verifies the SSE event stream flows in the contract-mandated order and
 * ends with ceremony.complete + certificate.ready.
 *
 * Also verifies idempotency: a second call with a completed session
 * replays the events and emits ceremony.resumed rather than running the
 * full hatch again.
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-sse-'));
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
});
afterAll(() => { global.fetch = realFetch; });

function makeUser(opts: { phone?: string | null } = {}): { token: string; userId: string; windyIdentityId: string; email: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    const wid = crypto.randomUUID();
    const email = `u-${userId}@test.local`;
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type, phone)
         VALUES (?, ?, 'Nora Grandma', 'x', 'free', 'free', ?, 'human', ?)`,
    ).run(userId, email, wid, opts.phone ?? null);
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

describe('POST /api/v1/agent/hatch — SSE ceremony ordering', () => {
    it('streams events in the canonical contract order and completes with hatch.complete', async () => {
        const user = makeUser({ phone: '+14155550100' });
        const calls: Record<string, any> = {};

        handler = async (url, init) => {
            let body: any = {};
            try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }

            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                calls.eternitas = body;
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-8A3F-2B1C' }) };
            }
            if (url.includes('agent.test/hatch/remote')) {
                calls.hatchRemote = body;
                return { ok: true, status: 200, json: async () => ({ host: 'vps-01', agent_id: 'agt_xyz' }) };
            }
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                calls.chat = body;
                return { ok: true, status: 200, json: async () => ({
                    matrix_user_id: '@noras-agent:chat.windypro.com',
                    dm_room_id: '!dm:chat.windypro.com',
                }) };
            }
            if (url.includes('windymail') || url.includes('mail') && url.includes('identity/created')) {
                calls.mail = body;
                return { ok: true, status: 200, json: async () => ({ email: 'noras-agent@windymail.ai' }) };
            }
            return { ok: false, status: 500, json: async () => ({}) };
        };
        // windy-mail call is only made when WINDYMAIL_API_URL is set — set
        // it here so we can assert the drift-#3 fields on the outgoing
        // webhook body.
        process.env.WINDYMAIL_API_URL = 'http://mail.test';
        process.env.WINDYMAIL_SERVICE_TOKEN = 'test-token';

        const res = await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });

        expect(res.status).toBe(200);
        const events = parseSse(res.body as unknown as string);
        const order = events.map(e => e.event);

        // Canonical event order only — broker.*, ceremony.*, and
        // windy_fly.* must NOT appear on the stream.
        expect(order).toEqual([
            'eternitas.registering',
            'eternitas.registered',
            'mail.provisioning',
            'mail.provisioned',
            'chat.provisioning',
            'chat.provisioned',
            'cloud.provisioning',
            'cloud.provisioned',
            'phone.assigning',
            'phone.assigned',
            'birth_certificate.generating',
            'birth_certificate.ready',
            'hatch.complete',
        ]);
        expect(order).not.toContain('ceremony.started');
        expect(order).not.toContain('broker.issuing');
        expect(order).not.toContain('broker.issued');
        expect(order).not.toContain('windy_fly.hatching');
        expect(order).not.toContain('windy_fly.hatched');
        expect(order).not.toContain('certificate.ready');
        expect(order).not.toContain('ceremony.complete');

        const cert = events.find(e => e.event === 'birth_certificate.ready')!.data;
        expect(cert.data.certificate_no).toMatch(/^WF-/);
        expect(cert.data.passport_number).toBe('ET26-8A3F-2B1C');
        expect(cert.data.brain.provider).toBe('gemini');

        const complete = events.find(e => e.event === 'hatch.complete')!.data;
        expect(complete.status).toBe('ok');
        expect(complete.data.resumed).toBe(false);

        // Drift #2 — /hatch/remote body includes owner_phone + owner_name.
        expect(calls.hatchRemote).toBeDefined();
        expect(calls.hatchRemote.owner_phone).toBe('+14155550100');
        expect(calls.hatchRemote.owner_name).toBe('Nora Grandma');
        expect(calls.hatchRemote.owner_email).toBe(user.email);
        expect(calls.hatchRemote.broker_token).toMatch(/^bk_live_/);

        // Drift #3 — mail webhook body includes bot_type / owner_email / phone.
        expect(calls.mail).toBeDefined();
        expect(calls.mail.bot_type).toBe('agent');
        expect(calls.mail.owner_email).toBe(user.email);
        expect('phone' in calls.mail).toBe(true);  // present even if null
        expect(calls.mail.phone).toBeNull();

        // Seq numbers strictly increasing.
        let prev = 0;
        for (const e of events) {
            const n = e.data.seq as number;
            expect(n).toBeGreaterThan(prev);
            prev = n;
        }
    });

    it('is idempotent — a second call replays existing state via hatch.complete with resumed=true', async () => {
        const user = makeUser();
        handler = async (url) => {
            if (url.includes('eternitas')) return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-ID-IDEMP' }) };
            return { ok: true, status: 200, json: async () => ({}) };
        };

        await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });

        // Second call — must not re-run the ceremony.
        handler = async () => { throw new Error('second hatch should not make external calls'); };

        const res = await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });

        const events = parseSse(res.body as unknown as string);
        const completes = events.filter(e => e.event === 'hatch.complete');
        expect(completes.length).toBeGreaterThanOrEqual(1);
        // The terminal frame on a resume should carry resumed:true.
        const terminal = completes[completes.length - 1]!.data;
        expect(terminal.data.resumed).toBe(true);
        // No legacy event names should leak through on a resume either.
        expect(events.some(e => e.event === 'ceremony.resumed')).toBe(false);
        expect(events.some(e => e.event === 'ceremony.complete')).toBe(false);
    });
});
