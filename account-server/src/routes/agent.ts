/**
 * Wave 8 — Agent routes.
 *
 * Two endpoints:
 *   POST /api/v1/agent/credentials/issue  (HMAC-signed S2S)
 *     → mints a broker token the agent hands to the LLM gateway.
 *   POST /api/v1/agent/hatch  (Bearer JWT)
 *     → idempotent per windy_identity_id. Streams SSE events through
 *       the bootcamp-demo.md ceremony: eternitas → broker → remote
 *       hatch → chat/mail/cloud → birth certificate.
 *
 * Design goals:
 *   - Zero CLI, zero API keys, zero config. A logged-in user clicks one
 *     button and their agent is born.
 *   - One agent per identity. Calling /hatch twice returns the existing
 *     session — safe for users who spam-click during the ceremony.
 *   - Full audit trail. Every event is persisted in hatch_sessions.events
 *     so support / analytics can replay what happened without parsing
 *     arbitrary logs.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/schema';
import { config } from '../config';
import { makeRateLimiter } from '../services/rate-limiter';
import {
    issueBrokerToken,
    verifyBrokerSignature,
    createHatchSession,
    appendHatchEvent,
    finishHatchSession,
    getHatchSession,
    type HatchEvent,
} from '../services/credential-broker';
import { logAuditEvent } from '../identity-service';

const router = Router();

// ─── Rate limits ─────────────────────────────────────────────
// Broker issue: 120/min per IP (S2S traffic — generous but capped).
// Hatch: 5/min per IP to prevent provisioning floods.
const issueLimiter = makeRateLimiter('broker-issue', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const hatchLimiter = makeRateLimiter('agent-hatch', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── POST /api/v1/agent/credentials/issue ────────────────────
//
// Service-to-service credential issuance. Caller signs the request with
// BROKER_HMAC_SECRET. Returns a short-lived broker token bound to a
// provider/model chosen by plan tier.
router.post('/credentials/issue', issueLimiter, async (req: Request, res: Response) => {
    try {
        const timestamp = (req.header('x-broker-timestamp') || '').trim();
        const signature = (req.header('x-broker-signature') || '').trim();
        // Sign the exact raw body the client sent. We re-stringify here since
        // express.json() has already parsed it; callers must use canonical
        // JSON.stringify with no extra whitespace (same as Stripe-style).
        const bodyStr = JSON.stringify(req.body ?? {});

        const check = verifyBrokerSignature(
            'POST',
            '/api/v1/agent/credentials/issue',
            bodyStr,
            timestamp,
            signature,
        );
        if (!check.ok) {
            return res.status(401).json({ error: 'invalid_signature', reason: check.reason });
        }

        const { windy_identity_id, passport_number, scope, duration_seconds } = req.body || {};
        if (!windy_identity_id || typeof windy_identity_id !== 'string') {
            return res.status(400).json({ error: 'windy_identity_id is required' });
        }

        const issued = issueBrokerToken({
            windy_identity_id,
            passport_number: passport_number || null,
            scope: scope || 'llm:chat',
            duration_seconds,
        });

        return res.json(issued);
    } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.startsWith('identity_not_found')) {
            return res.status(404).json({ error: 'identity_not_found' });
        }
        if (msg.startsWith('passport_revoked') || msg.startsWith('passport_suspended')) {
            return res.status(403).json({ error: msg });
        }
        console.error('[broker] issue error:', err);
        return res.status(500).json({ error: 'broker_issue_failed' });
    }
});

// ─── SSE helpers ─────────────────────────────────────────────

function writeSse(res: Response, ev: HatchEvent): void {
    res.write(`id: ${ev.seq}\n`);
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; data: any }> {
    try {
        const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        let data: any = null;
        try { data = await resp.json(); } catch { /* non-JSON body */ }
        return { ok: resp.ok, status: resp.status, data };
    } catch (err: any) {
        return { ok: false, status: 0, data: { error: String(err?.message || err) } };
    }
}

// ─── POST /api/v1/agent/hatch ────────────────────────────────
//
// End-to-end agent hatch. Returns text/event-stream. Idempotent per
// windy_identity_id — second call replays the existing session's events.
router.post('/hatch', hatchLimiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const owner = db.prepare(
        `SELECT id, email, name, tier, license_tier, windy_identity_id
         FROM users WHERE id = ?`,
    ).get(userId) as
        { id: string; email: string; name: string; tier: string; license_tier: string; windy_identity_id: string } | undefined;
    if (!owner) {
        return res.status(404).json({ error: 'identity_not_found' });
    }
    const windyIdentityId = owner.windy_identity_id;

    // Idempotency check — if a session exists, stream its current state.
    const session = createHatchSession(windyIdentityId);

    // Open the SSE stream.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
    res.flushHeaders?.();

    // Replay prior events (either a resume, or "here is the whole finished ceremony").
    for (const ev of session.events) writeSse(res, ev);

    // If the session is already done or a hatch is in-flight in another
    // request, return the latest snapshot + done.
    if (session.existing && session.status !== 'running') {
        const snap = getHatchSession(session.id);
        writeSse(res, {
            seq: (snap?.events.length ?? 0) + 1,
            at: new Date().toISOString(),
            type: 'ceremony.resumed',
            status: 'ok',
            label: 'Agent already hatched — here is the existing session.',
            data: {
                session_id: session.id,
                status: snap?.status,
                passport_number: snap?.passport_number,
                agent_name: snap?.agent_name,
            },
        });
        res.end();
        return;
    }

    // Heartbeat — keep intermediaries from closing the stream.
    const heartbeat = setInterval(() => {
        try { res.write(':heartbeat\n\n'); } catch { /* ignore */ }
    }, 10_000);
    req.on('close', () => clearInterval(heartbeat));

    const emit = (ev: Omit<HatchEvent, 'seq' | 'at'>): HatchEvent => {
        const full = appendHatchEvent(session.id, ev);
        writeSse(res, full);
        return full;
    };

    const agentName = `${(owner.name || owner.email.split('@')[0]).split(' ')[0]}'s Agent`;

    emit({
        type: 'ceremony.started',
        status: 'ok',
        label: `Hatching ${agentName}…`,
        data: { session_id: session.id, agent_name: agentName, owner_email: owner.email },
    });

    // ── Step 1: bot identity row ───────────────────────────────
    // The bot needs its own user row so ecosystem tables FK-reference it.
    let botUserId: string;
    try {
        const existingBot = db.prepare(
            `SELECT u.id FROM users u
             JOIN product_accounts pa ON pa.identity_id = u.id
             WHERE pa.product = 'windy_fly' AND pa.metadata LIKE ?
             LIMIT 1`,
        ).get(`%"owner":"${userId}"%`) as { id: string } | undefined;

        if (existingBot) {
            botUserId = existingBot.id;
        } else {
            botUserId = crypto.randomUUID();
            db.prepare(
                `INSERT INTO users (id, email, name, password_hash, tier, identity_type, windy_identity_id, display_name)
                 VALUES (?, ?, ?, '', 'free', 'bot', ?, ?)`,
            ).run(
                botUserId,
                `agent-${botUserId.slice(0, 8)}@agents.windy.internal`,
                agentName,
                crypto.randomUUID(),
                agentName,
            );
        }
    } catch (err: any) {
        emit({ type: 'ceremony.failed', status: 'failed', label: 'Could not allocate bot identity', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', error: String(err?.message || err) });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 2: Eternitas auto-hatch ───────────────────────────
    let passportNumber: string | null = null;
    emit({ type: 'eternitas.issuing', status: 'pending', label: 'Registering passport with Eternitas…' });
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.ETERNITAS_API_KEY) headers['Authorization'] = `Bearer ${config.ETERNITAS_API_KEY}`;
        if (config.ETERNITAS_SERVICE_TOKEN) headers['X-Service-Token'] = config.ETERNITAS_SERVICE_TOKEN;

        const result = await fetchJson(`${config.ETERNITAS_URL}/api/v1/bots/auto-hatch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                agent_name: agentName,
                creator_email: owner.email,
                creator_name: owner.name || owner.email.split('@')[0],
                operator_windy_identity_id: windyIdentityId,
            }),
        });
        if (!result.ok) {
            emit({
                type: 'eternitas.issued',
                status: 'failed',
                label: `Eternitas refused the hatch (HTTP ${result.status}).`,
                data: { error: result.data?.error || `status_${result.status}` },
            });
            finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, error: 'eternitas_failed' });
            clearInterval(heartbeat);
            res.end();
            return;
        }
        passportNumber = result.data?.passport || result.data?.passport_number || result.data?.passportNumber || null;
        if (!passportNumber) {
            emit({ type: 'eternitas.issued', status: 'failed', label: 'Eternitas returned no passport number.', data: result.data });
            finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, error: 'no_passport' });
            clearInterval(heartbeat);
            res.end();
            return;
        }

        db.prepare(
            `INSERT OR REPLACE INTO eternitas_passports (id, identity_id, passport_number, status, operator_identity_id, registered_at)
             VALUES (?, ?, ?, 'active', ?, datetime('now'))`,
        ).run(crypto.randomUUID(), botUserId, passportNumber, userId);

        emit({
            type: 'eternitas.issued',
            status: 'ok',
            label: `Eternitas passport issued: ${passportNumber}`,
            data: { passport_number: passportNumber },
        });
    } catch (err: any) {
        emit({ type: 'eternitas.issued', status: 'failed', label: 'Eternitas call threw.', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, error: String(err?.message || err) });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 3: Broker token ───────────────────────────────────
    emit({ type: 'broker.issuing', status: 'pending', label: 'Minting brain credentials…' });
    let brokerTokenValue: string | null = null;
    let brokerTokenId: string | null = null;
    let brokerProvider = '';
    let brokerModel = '';
    try {
        const issued = issueBrokerToken({
            windy_identity_id: botUserId,
            passport_number: passportNumber,
            scope: 'llm:chat',
            duration_seconds: 3600,
        });
        brokerTokenValue = issued.broker_token;
        brokerTokenId = issued.token_id;
        brokerProvider = issued.provider;
        brokerModel = issued.model;
        emit({
            type: 'broker.issued',
            status: 'ok',
            label: `Brain online: ${issued.provider} / ${issued.model}`,
            // Do NOT include the raw broker_token in the SSE stream — it's
            // passed to windy-agent in the server-side call. The client UI
            // only needs the provider + model for the certificate.
            data: {
                provider: issued.provider,
                model: issued.model,
                expires_at: issued.expires_at,
                usage_cap_tokens: issued.usage_cap_tokens,
            },
        });
    } catch (err: any) {
        emit({ type: 'broker.issued', status: 'failed', label: 'Broker could not issue a token.', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, passport_number: passportNumber, error: 'broker_failed' });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 4: Windy Fly remote hatch ─────────────────────────
    emit({ type: 'windy_fly.hatching', status: 'pending', label: 'Starting your agent on Windy Fly…' });
    try {
        const hatchResult = await fetchJson(`${config.WINDY_AGENT_URL}/hatch/remote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.WINDY_AGENT_SERVICE_TOKEN ? { 'X-Service-Token': config.WINDY_AGENT_SERVICE_TOKEN } : {}),
            },
            body: JSON.stringify({
                windy_identity_id: windyIdentityId,
                bot_identity_id: botUserId,
                agent_name: agentName,
                passport_number: passportNumber,
                broker_token: brokerTokenValue,
                provider: brokerProvider,
                model: brokerModel,
                owner_email: owner.email,
            }),
        });
        if (!hatchResult.ok) {
            // The agent host not being reachable isn't fatal — the user
            // will still have a passport and credentials; the agent can
            // be started later. Mark as degraded, not failed.
            emit({
                type: 'windy_fly.hatched',
                status: 'failed',
                label: 'Agent host unreachable — will retry in background.',
                data: { http_status: hatchResult.status },
            });
        } else {
            emit({
                type: 'windy_fly.hatched',
                status: 'ok',
                label: 'Agent is running.',
                data: {
                    agent_host: hatchResult.data?.host || null,
                    agent_id: hatchResult.data?.agent_id || null,
                },
            });
        }
    } catch (err: any) {
        emit({
            type: 'windy_fly.hatched',
            status: 'failed',
            label: 'Agent host call threw.',
            data: { error: String(err?.message || err) },
        });
    }

    // ── Step 5: Chat onboarding (Matrix DM room) ───────────────
    emit({ type: 'windy_chat.provisioning', status: 'pending', label: 'Opening your chat with the agent…' });
    let matrixUserId: string | null = null;
    let dmRoomId: string | null = null;
    try {
        const chatResult = await fetchJson(`${config.WINDY_CHAT_URL}/api/v1/onboarding/agent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.CHAT_SERVICE_TOKEN ? { 'Authorization': `Bearer ${config.CHAT_SERVICE_TOKEN}` } : {}),
            },
            body: JSON.stringify({
                passport_number: passportNumber,
                agent_name: agentName,
                owner_windy_identity_id: windyIdentityId,
            }),
        });
        if (chatResult.ok) {
            matrixUserId = chatResult.data?.matrix_user_id || null;
            dmRoomId = chatResult.data?.dm_room_id || null;
            db.prepare(
                `INSERT OR REPLACE INTO product_accounts (id, identity_id, product, status, external_id, metadata, provisioned_at)
                 VALUES (?, ?, 'windy_chat', 'active', ?, ?, datetime('now'))`,
            ).run(
                crypto.randomUUID(), botUserId, matrixUserId,
                JSON.stringify({ dm_room_id: dmRoomId, passport_number: passportNumber }),
            );
            db.prepare(
                `INSERT OR REPLACE INTO product_accounts (id, identity_id, product, status, external_id, metadata, provisioned_at)
                 VALUES (?, ?, 'windy_fly', 'active', ?, ?, datetime('now'))`,
            ).run(
                crypto.randomUUID(), userId, matrixUserId,
                JSON.stringify({
                    owner: userId,
                    agent_name: agentName,
                    passport_number: passportNumber,
                    dm_room_id: dmRoomId,
                    matrix_user_id: matrixUserId,
                    broker_token_id: brokerTokenId,
                }),
            );
            emit({
                type: 'windy_chat.provisioned',
                status: 'ok',
                label: 'Chat room is live.',
                data: { matrix_user_id: matrixUserId, dm_room_id: dmRoomId },
            });
        } else {
            emit({
                type: 'windy_chat.provisioned',
                status: 'failed',
                label: 'Chat onboarding failed — will retry.',
                data: { http_status: chatResult.status },
            });
        }
    } catch (err: any) {
        emit({
            type: 'windy_chat.provisioned',
            status: 'failed',
            label: 'Chat onboarding threw.',
            data: { error: String(err?.message || err) },
        });
    }

    // ── Step 6: Mail inbox ─────────────────────────────────────
    emit({ type: 'windy_mail.provisioning', status: 'pending', label: 'Allocating agent inbox…' });
    let agentEmail: string | null = null;
    try {
        if (process.env.WINDYMAIL_API_URL) {
            const mailResult = await fetchJson(`${process.env.WINDYMAIL_API_URL}/api/v1/webhooks/identity/created`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '',
                },
                body: JSON.stringify({
                    windy_identity_id: botUserId,
                    email: `${agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@windymail.ai`,
                    display_name: agentName,
                    identity_type: 'bot',
                    passport_number: passportNumber,
                }),
            });
            agentEmail = mailResult.data?.email || null;
            emit({
                type: 'windy_mail.provisioned',
                status: mailResult.ok ? 'ok' : 'failed',
                label: mailResult.ok ? `Inbox: ${agentEmail}` : 'Mail inbox pending — will retry.',
                data: { email: agentEmail },
            });
        } else {
            emit({ type: 'windy_mail.provisioned', status: 'ok', label: 'Mail inbox skipped (no mail service configured).', data: { skipped: true } });
        }
    } catch (err: any) {
        emit({ type: 'windy_mail.provisioned', status: 'failed', label: 'Mail inbox call threw.', data: { error: String(err?.message || err) } });
    }

    // ── Step 7: Cloud quota allocation (bot) ───────────────────
    emit({ type: 'windy_cloud.provisioning', status: 'pending', label: 'Allocating cloud storage…' });
    try {
        db.prepare(
            `UPDATE users SET storage_limit = ? WHERE id = ? AND (storage_limit IS NULL OR storage_limit = 0)`,
        ).run(5 * 1024 * 1024 * 1024, botUserId);
        emit({ type: 'windy_cloud.provisioned', status: 'ok', label: '5 GB allocated.', data: { storage_limit_bytes: 5 * 1024 * 1024 * 1024 } });
    } catch (err: any) {
        emit({ type: 'windy_cloud.provisioned', status: 'failed', label: 'Cloud allocation failed.', data: { error: String(err?.message || err) } });
    }

    // ── Step 8: Birth certificate ──────────────────────────────
    const certificateNo = `WF-${(passportNumber || 'XXXX-XXXX').replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;
    const certificate = {
        certificate_no: certificateNo,
        agent_name: agentName,
        passport_number: passportNumber,
        born_at: new Date().toISOString(),
        creator: owner.name || owner.email.split('@')[0],
        creator_email: owner.email,
        email: agentEmail,
        phone: null,  // SMS gateway integration is pending — field reserved.
        cloud_storage_bytes: 5 * 1024 * 1024 * 1024,
        brain: { provider: brokerProvider, model: brokerModel },
        chat: { matrix_user_id: matrixUserId, dm_room_id: dmRoomId },
    };
    emit({
        type: 'certificate.ready',
        status: 'ok',
        label: 'Birth certificate issued.',
        data: certificate,
    });
    emit({ type: 'ceremony.complete', status: 'ok', label: 'Your agent is here.', data: { session_id: session.id } });

    finishHatchSession(session.id, {
        status: 'complete',
        bot_identity_id: botUserId,
        agent_name: agentName,
        passport_number: passportNumber,
        broker_token_id: brokerTokenId,
    });

    try {
        logAuditEvent('agent_hatch_complete', userId, {
            bot_identity_id: botUserId,
            passport_number: passportNumber,
            agent_name: agentName,
            broker_token_id: brokerTokenId,
        });
    } catch { /* non-critical */ }

    clearInterval(heartbeat);
    res.end();
});

// ─── GET /api/v1/agent/hatch/session/:id ─────────────────────
//
// Allow the UI to fetch a previously-completed hatch session (e.g. to
// re-show the birth certificate on next app launch).
router.get('/hatch/session/:id', authenticateToken, (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user.userId;
    const sessId = String(req.params.id);
    const sess = getHatchSession(sessId);
    if (!sess) return res.status(404).json({ error: 'session_not_found' });

    const db = getDb();
    const owner = db.prepare(`SELECT windy_identity_id FROM users WHERE id = ?`).get(userId) as { windy_identity_id: string } | undefined;
    if (!owner || owner.windy_identity_id !== sess.windy_identity_id) {
        return res.status(403).json({ error: 'forbidden' });
    }
    return res.json(sess);
});

export default router;
