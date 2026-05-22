/**
 * WD-31 M-D acceptance tests for GET /api/v1/me/fleet.
 *
 * Tier-1 = user with zero windy_fly product_accounts → agents:[].
 * Tier-2 = user with one windy_fly Category-3 row → one agent.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-fleet-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest-cp-fleet';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { FleetV1Schema, FLEET_V1_SCHEMA_ID } from '../src/contracts/control-panel';

function makeHuman(): { token: string; userId: string } {
    const db = getDb();
    const userId = crypto.randomUUID();
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, license_tier, windy_identity_id, identity_type)
         VALUES (?, ?, 'Fleet User', 'x', 'free', 'free', ?, 'human')`,
    ).run(userId, `fleet-${userId}@test.local`, crypto.randomUUID());
    const token = jwt.sign(
        { userId, email: `fleet-${userId}@test.local` },
        process.env.JWT_SECRET!,
        { algorithm: 'HS256', expiresIn: '5m' },
    );
    return { token, userId };
}

function makeBot(): string {
    const db = getDb();
    const botId = crypto.randomUUID();
    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, identity_type, windy_identity_id, display_name)
         VALUES (?, ?, ?, '', 'free', 'bot', ?, ?)`,
    ).run(
        botId,
        `agent-${botId.slice(0, 8)}@agents.windy.internal`,
        'Test Agent',
        crypto.randomUUID(),
        'Test Agent',
    );
    return botId;
}

function insertFlyRow(opts: {
    humanId: string;
    botId: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
}) {
    const db = getDb();
    db.prepare(
        `INSERT INTO product_accounts (id, identity_id, product, external_id, status, metadata, provisioned_at)
         VALUES (?, ?, 'windy_fly', ?, ?, ?, datetime('now'))`,
    ).run(
        crypto.randomUUID(),
        opts.humanId,
        opts.botId,
        opts.status ?? 'active',
        JSON.stringify(opts.metadata ?? {}),
    );
}

describe('GET /api/v1/me/fleet', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).get('/api/v1/me/fleet');
        expect(res.status).toBe(401);
    });

    it('tier-1 (no windy_fly row) returns agents:[]', async () => {
        const { token, userId } = makeHuman();
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        const parsed = FleetV1Schema.safeParse(res.body);
        if (!parsed.success) console.error(JSON.stringify(parsed.error.issues, null, 2));
        expect(parsed.success).toBe(true);
        expect(res.body.schema).toBe(FLEET_V1_SCHEMA_ID);
        expect(res.body.user_id).toBe(userId);
        expect(res.body.agents).toEqual([]);
    });

    it('tier-1 this_machine block reports honest server defaults', async () => {
        const { token } = makeHuman();
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.this_machine).toEqual({
            is_user_device: false,
            can_self_report: false,
            vitals_url: 'internal',
        });
    });

    it('tier-2 (one windy_fly row) returns one parseable agent', async () => {
        const { token } = makeHuman();
        const botId = makeBot();
        insertFlyRow({
            humanId: jwt.decode(token) as any && (jwt.decode(token) as any).userId,
            botId,
            status: 'active',
            metadata: { agent_name: 'Echo', passport_number: 'ET26-TEST-0001' },
        });

        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        const parsed = FleetV1Schema.safeParse(res.body);
        if (!parsed.success) console.error(JSON.stringify(parsed.error.issues, null, 2));
        expect(parsed.success).toBe(true);
        expect(res.body.agents).toHaveLength(1);
        const agent = res.body.agents[0];
        expect(agent.id).toBe(botId);
        expect(agent.name).toBe('Echo');
        expect(agent.product).toBe('windy_fly');
        expect(agent.callsign).toBeNull();
        // Active product row but no live heartbeat → "unknown", never
        // over-claim "online" without a probe.
        expect(agent.status).toBe('unknown');
        expect(agent.machine.model).toBe('unknown');
        expect(agent.machine.location).toBeNull();
        expect(agent.auth).toBe('none');
        expect(agent.vitals_url).toBe(`internal://agents/${botId}/vitals`);
    });

    it('row with missing external_id is omitted (schema requires id min 1)', async () => {
        const { token } = makeHuman();
        insertFlyRow({
            humanId: (jwt.decode(token) as any).userId,
            botId: null,
            status: 'pending',
            metadata: { agent_name: 'Half-hatched' },
        });
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.agents).toEqual([]);
    });

    it('non-active status maps to "offline"', async () => {
        const { token } = makeHuman();
        const botId = makeBot();
        insertFlyRow({
            humanId: (jwt.decode(token) as any).userId,
            botId,
            status: 'suspended',
            metadata: { agent_name: 'Paused' },
        });
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.agents[0].status).toBe('offline');
    });

    it('missing agent_name in metadata falls back to "Agent"', async () => {
        const { token } = makeHuman();
        const botId = makeBot();
        insertFlyRow({
            humanId: (jwt.decode(token) as any).userId,
            botId,
            status: 'active',
            metadata: {},
        });
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.agents[0].name).toBe('Agent');
    });

    it('callsign in metadata is surfaced', async () => {
        const { token } = makeHuman();
        const botId = makeBot();
        insertFlyRow({
            humanId: (jwt.decode(token) as any).userId,
            botId,
            status: 'active',
            metadata: { agent_name: 'Nora', callsign: 'Foxtrot' },
        });
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.agents[0].callsign).toBe('Foxtrot');
    });

    it('fetched_at is a fresh ISO 8601 timestamp', async () => {
        const { token } = makeHuman();
        const res = await request(app)
            .get('/api/v1/me/fleet')
            .set('Authorization', `Bearer ${token}`);
        const ts = Date.parse(res.body.fetched_at);
        expect(Number.isFinite(ts)).toBe(true);
        expect(Date.now() - ts).toBeLessThan(60_000);
    });
});
