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
                // ADR-064: auto-hatch mints the certificate of record and
                // returns it (plus the bot api_key) alongside the passport.
                return { ok: true, status: 200, json: async () => ({
                    passport_number: 'ET26-8A3F-2B1C',
                    api_key: 'ek_bot_test_key_abc123',
                    certificate: {
                        id: 'cert-uuid-1',
                        certificate_no: 'ET-2026-000123',
                        passport: 'ET26-8A3F-2B1C',
                        signed_at: '2026-07-16T12:00:00.000Z',
                        json_url: '/api/v1/certificates/ET26-8A3F-2B1C',
                        pdf_url: '/api/v1/certificates/ET26-8A3F-2B1C/pdf',
                        qr_url: '/api/v1/certificates/ET26-8A3F-2B1C/qr',
                        verify_url: '/verify/ET26-8A3F-2B1C',
                    },
                }) };
            }
            if (url.includes('eternitas') && url.includes('/generate')) {
                // ADR-064 enrich — idempotent, bot-key-authed.
                calls.enrich = { url, body, apiKey: (init.headers as any)?.['X-API-Key'] || null };
                return { ok: true, status: 201, json: async () => ({ certificate_no: 'ET-2026-000123' }) };
            }
            if (url.includes('agent.test/hatch/remote')) {
                calls.hatchRemote = body;
                return { ok: true, status: 200, json: async () => ({ host: 'vps-01', agent_id: 'agt_xyz' }) };
            }
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                calls.chat = body;
                return { ok: true, status: 200, json: async () => ({
                    matrix_user_id: '@noras-agent:chat.windychat.ai',
                    dm_room_id: '!dm:chat.windychat.ai',
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
        // ADR-064: the number comes from Eternitas verbatim — never a
        // locally fabricated WF- value.
        expect(cert.status).toBe('ok');
        expect(cert.data.certificate_no).toBe('ET-2026-000123');
        expect(cert.data.certificate_no).not.toMatch(/^WF-/);
        // ADR-064 follow-up: user-facing links use the PUBLIC host (ETERNITAS_PUBLIC_URL
        // default), never the server-to-server ETERNITAS_URL — that leaked
        // host.docker.internal into grandma's browser on the first live hatch.
        expect(cert.data.pdf_url).toBe('https://api.eternitas.ai/api/v1/certificates/ET26-8A3F-2B1C/pdf');
        expect(cert.data.verify_url).toBe('https://api.eternitas.ai/verify/ET26-8A3F-2B1C');
        expect(cert.data.passport_number).toBe('ET26-8A3F-2B1C');
        expect(cert.data.brain.provider).toBe('gemini');

        // ADR-064: auto-hatch body carries the printed cloud allocation.
        expect(calls.eternitas.cloud_storage).toBe('5 GB — Windy Cloud');

        // ADR-064: after mail provisioning the certificate is enriched with
        // the agent's mail address, authed by the bot api_key.
        expect(calls.enrich).toBeDefined();
        expect(calls.enrich.url).toBe('http://eternitas.test/api/v1/certificates/ET26-8A3F-2B1C/generate');
        expect(calls.enrich.apiKey).toBe('ek_bot_test_key_abc123');
        expect(calls.enrich.body).toEqual({ windy_mail_address: 'noras-agent@windymail.ai' });

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

    it('reports a PARTIAL birth when a core resource does not provision (honest, not blanket ok)', async () => {
        const user = makeUser();
        // Mail service unconfigured — the mail step must report skipped and the
        // terminal frame must be a partial birth naming what's degraded, NOT a
        // green 'ok' that hides the missing mailbox.
        const savedMailUrl = process.env.WINDYMAIL_API_URL;
        delete process.env.WINDYMAIL_API_URL;
        handler = async (url) => {
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-PART-1AL0' }) };
            }
            if (url.includes('chat.test') && url.includes('/api/v1/onboarding/agent')) {
                return { ok: true, status: 200, json: async () => ({ matrix_user_id: '@a:chat.windychat.ai', dm_room_id: '!r:chat.windychat.ai' }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        try {
            const res = await request(app)
                .post('/api/v1/agent/hatch')
                .set('Authorization', `Bearer ${user.token}`)
                .buffer(true).parse((r: any, cb: any) => {
                    let chunks = '';
                    r.on('data', (c: Buffer) => (chunks += c.toString()));
                    r.on('end', () => cb(null, chunks));
                });
            const events = parseSse(res.body as unknown as string);
            const mail = events.find(e => e.event === 'mail.provisioned')!.data;
            expect(mail.status).toBe('skipped');
            // ADR-064: Eternitas returned no certificate (fail-open mint /
            // old server) — the event reports pending honestly and NEVER
            // fabricates a WF- number.
            const cert = events.find(e => e.event === 'birth_certificate.ready')!.data;
            expect(cert.status).toBe('partial');
            expect(cert.label).toBe('Birth certificate pending — Eternitas will issue it shortly.');
            expect(cert.data.certificate_no).toBeNull();
            expect(cert.data.pdf_url).toBeNull();
            expect(cert.data.verify_url).toBeNull();
            const complete = events.find(e => e.event === 'hatch.complete')!.data;
            expect(complete.status).toBe('partial');
            expect(complete.data.degraded).toContain('mail');
        } finally {
            if (savedMailUrl) process.env.WINDYMAIL_API_URL = savedMailUrl;
        }
    });

    it('forwards verified_payment_intent_id and comp_code to Eternitas auto-hatch (ADR-056)', async () => {
        const user = makeUser();
        let eternitasBody: any = null;
        handler = async (url, init) => {
            let body: any = {};
            try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                eternitasBody = body;
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-PAID-0001' }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };

        await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .send({ verified_payment_intent_id: 'pi_test_adr056', comp_code: 'WINDY-AAAA-BBBB' })
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });

        expect(eternitasBody).toBeDefined();
        expect(eternitasBody.verified_payment_intent_id).toBe('pi_test_adr056');
        expect(eternitasBody.comp_code).toBe('WINDY-AAAA-BBBB');
    });

    it('honors the Naming Ceremony: body.agent_name flows to Eternitas, mail slug, and the certificate', async () => {
        const user = makeUser();
        let eternitasBody: any = null;
        let mailBody: any = null;
        handler = async (url, init) => {
            let body: any = {};
            try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                eternitasBody = body;
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-NAME-0001' }) };
            }
            if (url.includes('mail.test')) {
                mailBody = body;
                return { ok: true, status: 200, json: async () => ({ email: body.email }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        process.env.WINDYMAIL_API_URL = 'http://mail.test';
        process.env.WINDYMAIL_SERVICE_TOKEN = 'test-token';

        const res = await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .send({ agent_name: '  Sunny!  ' })
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });

        // Whitespace is collapsed/trimmed; the display name keeps its
        // punctuation ("Sunny!") but the mail localpart slug drops it and
        // never carries edge hyphens.
        expect(eternitasBody.agent_name).toBe('Sunny!');
        expect(mailBody.email).toBe('sunny@windymail.ai');
        expect(mailBody.display_name).toBe('Sunny!');

        const events = parseSse(res.body as unknown as string);
        const cert = events.find(e => e.event === 'birth_certificate.ready')!.data;
        expect(cert.data.agent_name).toBe('Sunny!');
    });

    it('falls back to the auto-name when agent_name is missing, HTML-only, or unusable', async () => {
        for (const badName of [undefined, '<script></script>', '  🌟🌟  ', '!!!']) {
            const user = makeUser();
            let eternitasBody: any = null;
            handler = async (url, init) => {
                let body: any = {};
                try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
                if (url.includes('eternitas') && url.includes('auto-hatch')) {
                    eternitasBody = body;
                    return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-FALL-BACK' }) };
                }
                return { ok: true, status: 200, json: async () => ({}) };
            };
            const req_ = request(app)
                .post('/api/v1/agent/hatch')
                .set('Authorization', `Bearer ${user.token}`);
            if (badName !== undefined) req_.send({ agent_name: badName });
            await req_.buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });
            // makeUser seeds name 'Nora Grandma' → auto-name is first token.
            expect(eternitasBody.agent_name).toBe("Nora's Agent");
        }
    });

    it('caps an absurdly long agent_name at 60 chars (fits Eternitas 100-char limit with room)', async () => {
        const user = makeUser();
        let eternitasBody: any = null;
        handler = async (url, init) => {
            let body: any = {};
            try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                eternitasBody = body;
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-LONG-0001' }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };
        await request(app)
            .post('/api/v1/agent/hatch')
            .set('Authorization', `Bearer ${user.token}`)
            .send({ agent_name: 'A'.repeat(300) })
            .buffer(true).parse((r: any, cb: any) => {
                let chunks = '';
                r.on('data', (c: Buffer) => (chunks += c.toString()));
                r.on('end', () => cb(null, chunks));
            });
        expect(eternitasBody.agent_name).toHaveLength(60);
    });

    it('sends empty payment fields on a plain free hatch (never accidentally paid)', async () => {
        const user = makeUser();
        let eternitasBody: any = null;
        handler = async (url, init) => {
            let body: any = {};
            try { body = JSON.parse(String(init.body || '{}')); } catch { /* noop */ }
            if (url.includes('eternitas') && url.includes('auto-hatch')) {
                eternitasBody = body;
                return { ok: true, status: 200, json: async () => ({ passport_number: 'ET26-FREE-0001' }) };
            }
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

        expect(eternitasBody).toBeDefined();
        expect(eternitasBody.verified_payment_intent_id).toBe('');
        expect(eternitasBody.comp_code).toBe('');
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
