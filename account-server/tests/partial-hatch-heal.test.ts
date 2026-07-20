/**
 * q12 — Partial-hatch heal.
 *
 * A PARTIAL hatch must heal itself. When chat (or mail) provisioning fails
 * during the hatch ceremony (POST /api/v1/agent/hatch), the SSE stream says
 * "will retry" — this suite pins the two things that make that true:
 *
 *   (a) the owner's windy_fly product_accounts row is written even on chat
 *       failure (status 'pending'), so the dashboard/fleet and the step-1
 *       bot-dedupe lookup can see the agent exists, and
 *   (b) a pending_provisions retry row is enqueued for the failed step, in
 *       the exact action/payload family the EXISTING ecosystem-provisioner
 *       retry worker (processPendingProvisions) already drains — and that
 *       draining it completes the heal (rows flip to 'active').
 *
 * Also guards the happy path: a fully green (or merely mail-unconfigured
 * "skipped") ceremony must enqueue nothing and behave exactly as before.
 *
 * Mirrors tests/agent-hatch-sse.test.ts (supertest + mocked global.fetch).
 */
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-hatch-heal-'));
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
import { processPendingProvisions } from '../src/services/ecosystem-provisioner';

// Capture fetch and mock per-test.
const realFetch = global.fetch;

type FetchHandler = (url: string, init: RequestInit) => Promise<any>;
let handler: FetchHandler = async () => { throw new Error('no handler'); };

beforeEach(() => {
    global.fetch = (async (url: any, init: any) => handler(String(url), init || {})) as any;
});
afterAll(() => { global.fetch = realFetch; });

function makeUser(): { token: string; userId: string; windyIdentityId: string; email: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    const wid = crypto.randomUUID();
    const email = `u-${userId}@test.local`;
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type, phone)
         VALUES (?, ?, 'Nora Grandma', 'x', 'free', 'free', ?, 'human', NULL)`,
    ).run(userId, email, wid);
    const token = jwt.sign({ userId, email }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
    return { token, userId, windyIdentityId: wid, email };
}

function parseSse(body: string): Array<{ event: string; data: any }> {
    const events: Array<{ event: string; data: any }> = [];
    for (const frame of body.split('\n\n')) {
        if (!frame.trim() || frame.startsWith(':heartbeat')) continue;
        let event = 'message';
        let dataLine = '';
        for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) dataLine = line.slice(6);
        }
        try { events.push({ event, data: JSON.parse(dataLine) }); } catch { /* malformed */ }
    }
    return events;
}

async function hatch(token: string): Promise<Array<{ event: string; data: any }>> {
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

function botIdByPassport(passport: string): string {
    const row = getDb().prepare(
        `SELECT identity_id FROM eternitas_passports WHERE passport_number = ?`,
    ).get(passport) as { identity_id: string } | undefined;
    expect(row).toBeDefined();
    return row!.identity_id;
}

describe('partial-hatch heal — chat/mail failures enqueue the existing retry queue', () => {
    it('chat failure: owner windy_fly row written (pending) + provision_agent_chat retry enqueued', async () => {
        const user = makeUser();
        delete process.env.WINDYMAIL_API_URL; // mail 'skipped' — isolates the chat failure
        let chatCalls = 0;
        handler = async (url) => {
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-HEAL-0001' }) };
            }
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                chatCalls++;
                return { ok: false, status: 503, json: async () => ({ error: 'synapse_down' }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };

        const events = await hatch(user.token);
        const chatEv = events.find(e => e.event === 'chat.provisioned')!.data;
        expect(chatEv.status).toBe('failed');
        const complete = events.find(e => e.event === 'hatch.complete')!.data;
        expect(complete.status).toBe('partial');
        expect(complete.data.degraded).toContain('chat');
        expect(chatCalls).toBe(1);

        const db = getDb();
        // (a) The dashboard/fleet can see the agent even though chat is down.
        const fly = db.prepare(
            `SELECT * FROM product_accounts WHERE identity_id = ? AND product = 'windy_fly'`,
        ).get(user.userId) as any;
        expect(fly).toBeDefined();
        expect(fly.status).toBe('pending');
        const meta = JSON.parse(fly.metadata);
        expect(meta.owner).toBe(user.userId); // bot-dedupe LIKE '%"owner":"<id>"%'
        expect(meta.agent_name).toBe("Nora's Agent");
        expect(meta.passport_number).toBe('ET26-HEAL-0001');
        expect(meta.matrix_user_id).toBeNull();

        // (b) The failed step sits on the EXISTING retry queue, in the exact
        // action family processPendingProvisions drains.
        const botId = botIdByPassport('ET26-HEAL-0001');
        const row = db.prepare(
            `SELECT * FROM pending_provisions WHERE identity_id = ? AND product = 'windy_chat' AND action = 'provision_agent_chat'`,
        ).get(botId) as any;
        expect(row).toBeDefined();
        const payload = JSON.parse(row.payload);
        expect(payload.passportNumber).toBe('ET26-HEAL-0001');
        expect(payload.agentName).toBe("Nora's Agent");
        expect(payload.ownerUserId).toBe(user.userId);
        expect(payload.ownerWindyIdentityId).toBe(user.windyIdentityId);
    });

    it('the EXISTING retry worker drains the live-path enqueue and completes the heal', async () => {
        const user = makeUser();
        delete process.env.WINDYMAIL_API_URL;
        handler = async (url) => {
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-HEAL-0002' }) };
            }
            if (url.includes('chat.test')) {
                return { ok: false, status: 503, json: async () => ({}) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        await hatch(user.token);

        const db = getDb();
        const botId = botIdByPassport('ET26-HEAL-0002');
        const row = db.prepare(
            `SELECT * FROM pending_provisions WHERE identity_id = ? AND action = 'provision_agent_chat'`,
        ).get(botId) as any;
        expect(row).toBeDefined();

        // Chat comes back up; make the row due and run one worker pass.
        let workerChatBody: any = null;
        handler = async (url, init) => {
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                try { workerChatBody = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
                return { ok: true, status: 200, json: async () => ({
                    matrix_user_id: '@healed:chat.windychat.ai',
                    dm_room_id: '!healed:chat.windychat.ai',
                }) };
            }
            return { ok: false, status: 500, json: async () => ({}) };
        };
        db.prepare(`UPDATE pending_provisions SET next_retry_at = datetime('now', '-1 minutes') WHERE id = ?`).run(row.id);
        const processed = await processPendingProvisions();
        expect(processed).toBeGreaterThanOrEqual(1);

        // The worker sent the owner's windy_identity_id, not the internal id.
        expect(workerChatBody).toBeDefined();
        expect(workerChatBody.owner_windy_identity_id).toBe(user.windyIdentityId);
        expect(workerChatBody.passport_number).toBe('ET26-HEAL-0002');

        // Queue row consumed.
        expect(db.prepare(`SELECT id FROM pending_provisions WHERE id = ?`).get(row.id)).toBeUndefined();

        // Owner's windy_fly row healed pending → active with the matrix id.
        const fly = db.prepare(
            `SELECT * FROM product_accounts WHERE identity_id = ? AND product = 'windy_fly'`,
        ).get(user.userId) as any;
        expect(fly.status).toBe('active');
        expect(fly.external_id).toBe('@healed:chat.windychat.ai');
        const meta = JSON.parse(fly.metadata);
        expect(meta.dm_room_id).toBe('!healed:chat.windychat.ai');
        expect(meta.owner).toBe(user.userId);

        // Bot's windy_chat row is now active too.
        const chat = db.prepare(
            `SELECT * FROM product_accounts WHERE identity_id = ? AND product = 'windy_chat'`,
        ).get(botId) as any;
        expect(chat).toBeDefined();
        expect(chat.status).toBe('active');
        expect(chat.external_id).toBe('@healed:chat.windychat.ai');
    });

    it('mail failure: provision_user retry enqueued with the bot-shaped payload', async () => {
        const user = makeUser();
        process.env.WINDYMAIL_API_URL = 'http://mail.test';
        process.env.WINDYMAIL_SERVICE_TOKEN = 'test-token';
        try {
            handler = async (url) => {
                if (url.includes('eternitas') && url.includes('auto-hatch')) {
                    return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-HEAL-0003' }) };
                }
                if (url.includes('mail.test')) {
                    return { ok: false, status: 500, json: async () => ({}) };
                }
                if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                    return { ok: true, status: 200, json: async () => ({
                        matrix_user_id: '@m3:chat.windychat.ai',
                        dm_room_id: '!r3:chat.windychat.ai',
                    }) };
                }
                return { ok: true, status: 200, json: async () => ({}) };
            };
            const events = await hatch(user.token);
            const mailEv = events.find(e => e.event === 'mail.provisioned')!.data;
            expect(mailEv.status).toBe('failed');
            const complete = events.find(e => e.event === 'hatch.complete')!.data;
            expect(complete.data.degraded).toContain('mail');
            expect(complete.data.degraded).not.toContain('chat');

            const db = getDb();
            const botId = botIdByPassport('ET26-HEAL-0003');
            const row = db.prepare(
                `SELECT * FROM pending_provisions WHERE identity_id = ? AND product = 'windy_mail' AND action = 'provision_user'`,
            ).get(botId) as any;
            expect(row).toBeDefined();
            const payload = JSON.parse(row.payload);
            // makeUser seeds "Nora Grandma" → auto-name "Nora's Agent" → slug.
            expect(payload.email).toBe('nora-s-agent@windymail.ai');
            expect(payload.name).toBe("Nora's Agent");
            expect(payload.identity_type).toBe('bot');
            expect(payload.bot_type).toBe('agent');
            expect(payload.owner_email).toBe(user.email);
            expect(payload.ownerUserId).toBe(user.userId);
            expect(payload.passport_number).toBe('ET26-HEAL-0003');

            // Chat succeeded, so the owner's windy_fly row is the normal
            // ACTIVE success-branch row — the heal path must not touch it.
            const fly = db.prepare(
                `SELECT * FROM product_accounts WHERE identity_id = ? AND product = 'windy_fly'`,
            ).get(user.userId) as any;
            expect(fly.status).toBe('active');
            expect(fly.external_id).toBe('@m3:chat.windychat.ai');
        } finally {
            delete process.env.WINDYMAIL_API_URL;
            delete process.env.WINDYMAIL_SERVICE_TOKEN;
        }
    });

    it('does not regress the happy path: no heal rows, no pending queue writes', async () => {
        const user = makeUser();
        delete process.env.WINDYMAIL_API_URL; // 'skipped' is not a failure — must NOT enqueue
        handler = async (url) => {
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-HEAL-0004' }) };
            }
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                return { ok: true, status: 200, json: async () => ({
                    matrix_user_id: '@ok:chat.windychat.ai',
                    dm_room_id: '!ok:chat.windychat.ai',
                }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        const events = await hatch(user.token);
        expect(events.find(e => e.event === 'chat.provisioned')!.data.status).toBe('ok');
        expect(events.find(e => e.event === 'mail.provisioned')!.data.status).toBe('skipped');

        const db = getDb();
        const botId = botIdByPassport('ET26-HEAL-0004');
        // No retry rows for this bot — unconfigured mail is skipped, chat succeeded.
        const rows = db.prepare(`SELECT id FROM pending_provisions WHERE identity_id = ?`).all(botId);
        expect(rows).toHaveLength(0);
        // Success branch wrote the owner's windy_fly row exactly as before.
        const fly = db.prepare(
            `SELECT * FROM product_accounts WHERE identity_id = ? AND product = 'windy_fly'`,
        ).get(user.userId) as any;
        expect(fly.status).toBe('active');
        expect(fly.external_id).toBe('@ok:chat.windychat.ai');
    });
});
