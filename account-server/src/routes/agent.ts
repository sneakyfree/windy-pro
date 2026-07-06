/**
 * Wave 8 — Agent routes.
 *
 * Endpoints:
 *   POST /api/v1/agent/credentials/issue   (HMAC-signed S2S)
 *     → mints a broker token the agent hands to the LLM gateway.
 *   POST /api/v1/agent/credentials/verify  (HMAC-signed S2S)
 *     → verifies an opaque broker_token so sister services (windy-fly-agent)
 *       can fail-closed on the cryptographic source of truth before
 *       acting on the token.
 *   POST /api/v1/agent/hatch               (Bearer JWT)
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
import { emitAdminEvent } from '../services/admin-telemetry';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/schema';
import { config } from '../config';
import { makeRateLimiter } from '../services/rate-limiter';
import {
    issueBrokerToken,
    verifyBrokerSignature,
    verifyBrokerToken,
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
//
// Hatch: TWO-LAYER design (Sprint 1.5 — ballroom-scale onboarding).
//   Layer 1 (pre-auth, per-IP): 500/min — DDoS shield. Generous enough
//   that ~hundreds of grandmas behind one hotel-WiFi NAT can all hatch
//   inside a 5-minute demo window without queueing.
//   Layer 2 (post-auth, per-user): 5/min — abuse cap. One identity
//   cannot spam-hatch even if their IP isn't shared. The legitimate
//   case is ~1 hatch per user (idempotent), so 5/min is plenty of slack
//   for retries.
//
// Why both: a single per-IP limit at ballroom-friendly width (e.g.
// 500/min) would let one bad actor inside a shared NAT spam-hatch and
// burn through quota. A single per-user limit can't be applied before
// auth, leaving the auth code path itself open to anonymous DDoS.
// Layered, each side does what it's best at.
const issueLimiter = makeRateLimiter('broker-issue', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const hatchIpLimiter = makeRateLimiter('agent-hatch-ip', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 500,
    standardHeaders: true,
    legacyHeaders: false,
});
// Exported for unit tests — keyed lookup must remain stable since
// upstream limiter state lives in Redis under this key shape.
export function hatchUserKey(req: any): string {
    const userId = req?.user?.userId;
    return typeof userId === 'string' && userId.length > 0
        ? `user:${userId}`
        : `ip:${req?.ip ?? 'unknown'}`;
}

const hatchUserLimiter = makeRateLimiter('agent-hatch-user', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    // Key on the authenticated user's id (set by authenticateToken
    // upstream of this limiter). If auth didn't run or didn't populate
    // req.user, fall back to IP — strictly safer than a fall-through
    // empty key, which would lump every unauth'd hit into one bucket.
    keyGenerator: hatchUserKey,
});

// ─── POST /api/v1/agent/credentials/issue ────────────────────
//
// Service-to-service credential issuance. Caller signs the request with
// BROKER_HMAC_SECRET. Returns a short-lived broker token bound to a
// provider/model chosen by plan tier.
router.post('/credentials/issue', issueLimiter, async (req: Request, res: Response) => {
    try {
        // Ecosystem-wide "X-Windy-*" convention — matches windy-agent's
        // outbound signing and our own outbound webhook bus.
        const timestamp = (req.header('x-windy-timestamp') || '').trim();
        const signature = (req.header('x-windy-signature') || '').trim();

        // Pass the parsed body. verifyBrokerSignature re-canonicalizes
        // with sorted keys + minimal separators, matching the serialize
        // side that windy-agent uses (python json.dumps(..., sort_keys=
        // True, separators=(",", ":"))).
        const check = verifyBrokerSignature(
            'POST',
            '/api/v1/agent/credentials/issue',
            req.body ?? {},
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

// ─── POST /api/v1/agent/credentials/verify ───────────────────
//
// S2S broker-token verification. windy-fly-agent calls this before it
// acts on a bk_live_* token an agent presents. Pro is the only
// authoritative verifier — tokens are opaque (sha256 hash lookups),
// not JWTs — so sister services MUST round-trip here before trusting
// any claim a token carries.
//
// Same HMAC gate as /credentials/issue. Body: { "broker_token": "bk_live_..." }.
// 200 with {ok,true,token} or {ok,false,reason} is the expected shape;
// 401 means the signature is bad. Sister-side contract is pinned in
// windy-agent/gateway/src/broker-verify.ts.
router.post('/credentials/verify', issueLimiter, async (req: Request, res: Response) => {
    try {
        const timestamp = (req.header('x-windy-timestamp') || '').trim();
        const signature = (req.header('x-windy-signature') || '').trim();

        const check = verifyBrokerSignature(
            'POST',
            '/api/v1/agent/credentials/verify',
            req.body ?? {},
            timestamp,
            signature,
        );
        if (!check.ok) {
            return res.status(401).json({ error: 'invalid_signature', reason: check.reason });
        }

        const { broker_token } = req.body || {};
        if (!broker_token || typeof broker_token !== 'string') {
            return res.status(400).json({ error: 'broker_token is required' });
        }

        const result = verifyBrokerToken(broker_token);
        if (!result.ok) {
            return res.json({ ok: false, reason: result.reason });
        }

        // Reshape the DB row into the BrokerTokenClaims contract the
        // sister repos expect. `id` is Pro-internal; callers keyed by
        // identity_id + passport_number + token metadata only.
        const t = result.token!;
        return res.json({
            ok: true,
            token: {
                identity_id: t.identity_id,
                passport_number: t.passport_number,
                provider: t.provider,
                model: t.model,
                scope: t.scope,
                expires_at: t.expires_at,
                usage_cap_tokens: t.usage_cap_tokens,
                usage_tokens: t.usage_tokens,
            },
        });
    } catch (err: any) {
        console.error('[broker] verify error:', err);
        return res.status(500).json({ error: 'broker_verify_failed' });
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
router.post('/hatch', hatchIpLimiter, authenticateToken, hatchUserLimiter, async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    // Pull owner with the extra fields sister repos need. windy-agent's
    // /hatch/remote contract requires owner_phone + owner_name (drift #2)
    // so we SELECT them here up front rather than re-querying later.
    const owner = db.prepare(
        `SELECT id, email, name, phone, tier, license_tier, windy_identity_id
         FROM users WHERE id = ?`,
    ).get(userId) as
        { id: string; email: string; name: string; phone: string | null; tier: string; license_tier: string; windy_identity_id: string } | undefined;
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
    // request, emit a terminal hatch.complete frame with resumed:true so
    // the client can render the existing state without double-hatching.
    if (session.existing && session.status !== 'running') {
        const snap = getHatchSession(session.id);
        writeSse(res, {
            seq: (snap?.events.length ?? 0) + 1,
            at: new Date().toISOString(),
            type: 'hatch.complete',
            status: 'ok',
            label: 'Agent already hatched — here is the existing session.',
            data: {
                resumed: true,
                session_id: session.id,
                status: snap?.status,
                passport_number: snap?.passport_number,
                agent_name: snap?.agent_name,
            },
        });
        res.end();
        return;
    }

    // Funnel beat (ADR-WA-001 §3): a FRESH hatch is starting (replays
    // returned above). Duration to hatch.complete is grandma's wait.
    const hatchStartedAtMs = Date.now();
    emitAdminEvent({
        event_type: 'hatch.started',
        actor_type: 'human',
        actor_id: windyIdentityId,
        session_id: session.id,
        metadata: { tier: owner.tier || 'free' },
    });

    // Heartbeat — keep intermediaries from closing the stream.
    const heartbeat = setInterval(() => {
        try { res.write(':heartbeat\n\n'); } catch { /* ignore */ }
    }, 10_000);
    req.on('close', () => clearInterval(heartbeat));

    // SSE emit — only the canonical event set is written to the stream.
    // Internal mechanics (broker issuance, bot-identity row creation,
    // windy-fly remote hatch call) log via console.log but never append
    // to hatch_sessions.events, so replay stays clean too.
    const emit = (ev: Omit<HatchEvent, 'seq' | 'at'>): HatchEvent => {
        const full = appendHatchEvent(session.id, ev);
        writeSse(res, full);
        return full;
    };

    const logInternal = (stage: string, detail: Record<string, any> = {}) => {
        console.log(`[hatch] ${stage}`, detail);
    };

    // ── The Naming Ceremony ────────────────────────────────────
    // The web ceremony asks the owner to name their helper BEFORE the
    // provisioning stream starts and passes it as body.agent_name.
    // Sanitize hard: strip HTML tags, collapse whitespace, cap at 60
    // chars, and require at least one letter or digit — the windy-mail
    // localpart below is slugified from this name, so an all-emoji /
    // all-punctuation name would produce an empty localpart. Anything
    // unusable falls back to the historical auto-name ("<first>'s
    // Agent"), which also keeps older clients that send no name
    // hatching exactly as before.
    const requestedName = String((req.body || {}).agent_name || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim();
    const agentName = /[a-zA-Z0-9]/.test(requestedName)
        ? requestedName
        : `${(owner.name || owner.email.split('@')[0]).split(' ')[0]}'s Agent`;
    // ADR-056 — a succeeded $1 PaymentIntent id makes this a VERIFIED
    // hatch: forwarded to Eternitas, which proves it against Stripe
    // server-side and mints the passport at tru=70/ver="basic".
    const verifiedPaymentIntentId: string = String((req.body || {}).verified_payment_intent_id || '');
    // ADR-056 D5 — a one-use ballroom comp code: same VERIFIED shape,
    // no card. Eternitas enforces mutual exclusion with the intent id.
    const compCode: string = String((req.body || {}).comp_code || '');

    logInternal('ceremony.started', { session_id: session.id, agent_name: agentName, owner_email: owner.email });

    // ── Step 1: bot identity row (internal, not SSE) ──────────
    let botUserId: string;
    try {
        // Bot-lookup idempotency. `product_accounts.metadata` is TEXT on
        // SQLite (dev) and JSONB on Postgres (prod). Postgres rejects
        // `jsonb LIKE text` so we cast metadata → text on that engine.
        // This is a redundant safety check — hatch_sessions dedupes at a
        // higher level via UNIQUE(windy_identity_id) — but we keep it for
        // the edge case where a session row was manually cleaned up.
        const existingBotSql = db.engine === 'postgres'
            ? `SELECT u.id FROM users u
               JOIN product_accounts pa ON pa.identity_id = u.id
               WHERE pa.product = 'windy_fly' AND pa.metadata::text LIKE ?
               LIMIT 1`
            : `SELECT u.id FROM users u
               JOIN product_accounts pa ON pa.identity_id = u.id
               WHERE pa.product = 'windy_fly' AND pa.metadata LIKE ?
               LIMIT 1`;
        const existingBot = db.prepare(existingBotSql)
            .get(`%"owner":"${userId}"%`) as { id: string } | undefined;

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
        // Internal failure pre-Eternitas — surface as eternitas.registered
        // failed so the canonical client sees a step it recognises.
        emit({ type: 'eternitas.registered', status: 'failed', label: 'Could not allocate bot identity.', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', error: String(err?.message || err) });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 2: Eternitas passport registration ───────────────
    let passportNumber: string | null = null;
    emit({ type: 'eternitas.registering', status: 'pending', label: 'Registering passport with Eternitas…' });
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // Eternitas platform auth is X-API-Key, NOT Authorization: Bearer.
        // Bearer is reserved for Operator JWTs; platform routes read X-API-Key.
        // See src/eternitas/middleware/auth.py:get_current_platform.
        if (config.ETERNITAS_API_KEY) headers['X-API-Key'] = config.ETERNITAS_API_KEY;
        if (config.ETERNITAS_SERVICE_TOKEN) headers['X-Service-Token'] = config.ETERNITAS_SERVICE_TOKEN;

        const result = await fetchJson(`${config.ETERNITAS_URL}/api/v1/bots/auto-hatch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                agent_name: agentName,
                creator_email: owner.email,
                creator_name: owner.name || owner.email.split('@')[0],
                operator_windy_identity_id: windyIdentityId,
                // ADR-056: empty strings = free hatch (Eternitas ignores them).
                verified_payment_intent_id: verifiedPaymentIntentId,
                comp_code: compCode,
            }),
        });
        if (!result.ok) {
            emit({
                type: 'eternitas.registered',
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
            emit({ type: 'eternitas.registered', status: 'failed', label: 'Eternitas returned no passport number.', data: result.data });
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
            type: 'eternitas.registered',
            status: 'ok',
            label: `Eternitas passport issued: ${passportNumber}`,
            data: { passport_number: passportNumber },
        });
    } catch (err: any) {
        emit({ type: 'eternitas.registered', status: 'failed', label: 'Eternitas call threw.', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, error: String(err?.message || err) });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 3: Broker token (internal, not SSE) ──────────────
    // The canonical event set treats broker mechanics as Pro-internal —
    // the token itself is S2S-only and sister repos don't parse it.
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
        logInternal('broker.issued', {
            token_id: brokerTokenId,
            provider: brokerProvider,
            model: brokerModel,
            expires_at: issued.expires_at,
        });
    } catch (err: any) {
        // Surface broker failure as a hatch.complete/failed terminal frame
        // so the client gets a deterministic end to the stream.
        emit({ type: 'hatch.complete', status: 'failed', label: 'Broker could not issue credentials.', data: { error: String(err?.message || err) } });
        finishHatchSession(session.id, { status: 'failed', bot_identity_id: botUserId, agent_name: agentName, passport_number: passportNumber, error: 'broker_failed' });
        clearInterval(heartbeat);
        res.end();
        return;
    }

    // ── Step 4: Windy Fly remote hatch (internal, not SSE) ────
    // Drift #2 fix — /hatch/remote requires owner_phone + owner_name for
    // the agent's SMS/greeting wiring. Without them windy-agent 400s.
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
                owner_phone: owner.phone || null,
                owner_name: owner.name || owner.email.split('@')[0],
            }),
        });
        logInternal('windy_fly.hatch_remote', {
            ok: hatchResult.ok,
            http_status: hatchResult.status,
            agent_host: hatchResult.data?.host || null,
            agent_id: hatchResult.data?.agent_id || null,
        });
    } catch (err: any) {
        // Non-fatal — the user keeps their passport + credentials; the
        // agent process can be started later. Log and continue.
        logInternal('windy_fly.hatch_remote_error', { error: String(err?.message || err) });
    }

    // ── Step 5: Mail inbox ─────────────────────────────────────
    // Drift #3 fix — without { bot_type, owner_email, phone } windy-mail
    // skips the welcome-email branch because the payload looks human-
    // shaped. These fields are additive; mail's schema already expects
    // them from the canonical contract.
    emit({ type: 'mail.provisioning', status: 'pending', label: 'Allocating agent inbox…' });
    let agentEmail: string | null = null;
    // Track the real outcome of each cross-product step so hatch.complete can
    // report an honest partial birth instead of a blanket "ok". A skipped or
    // failed mailbox/chat used to be swallowed under a green hatch.complete.
    let mailOk = false;
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
                    // Slug the display name into a localpart. Trim the
                    // leading/trailing hyphens a name like "Sunny!" would
                    // leave behind — a bare hyphen at either end makes an
                    // invalid (and ugly) address. The name sanitizer above
                    // guarantees at least one [a-z0-9] survives.
                    email: `${agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}@windymail.ai`,
                    display_name: agentName,
                    identity_type: 'bot',
                    passport_number: passportNumber,
                    bot_type: 'agent',
                    owner_email: owner.email,
                    phone: null,
                }),
            });
            agentEmail = mailResult.data?.email || null;
            // ADR-050: windy_mail is Category 2 (mailbox belongs to bot).
            // identity_id = bot, operator_identity_id = human operator,
            // external_id = mailbox address. This is the first time the
            // hatch flow writes a product_accounts row for mail — previously
            // the row was missing entirely, which is why the dashboard
            // Mail tile fell through to 'not_provisioned'.
            if (mailResult.ok && agentEmail) {
                db.prepare(
                    `INSERT OR REPLACE INTO product_accounts (id, identity_id, operator_identity_id, product, status, external_id, metadata, provisioned_at)
                     VALUES (?, ?, ?, 'windy_mail', 'active', ?, ?, datetime('now'))`,
                ).run(
                    crypto.randomUUID(), botUserId, userId, agentEmail,
                    JSON.stringify({ passport_number: passportNumber, agent_name: agentName }),
                );
            }
            mailOk = !!(mailResult.ok && agentEmail);
            emit({
                type: 'mail.provisioned',
                status: mailResult.ok ? 'ok' : 'failed',
                label: mailResult.ok ? `Inbox: ${agentEmail}` : 'Mail inbox pending — will retry.',
                data: { email: agentEmail },
            });
        } else {
            // Mail service not configured — this is a real gap, not an "ok".
            // Report it as skipped so the client renders a warning and
            // hatch.complete can flag the birth as partial.
            emit({ type: 'mail.provisioned', status: 'skipped', label: 'Mail inbox skipped (no mail service configured).', data: { skipped: true } });
        }
    } catch (err: any) {
        emit({ type: 'mail.provisioned', status: 'failed', label: 'Mail inbox call threw.', data: { error: String(err?.message || err) } });
    }

    // ── Step 6: Chat onboarding (Matrix DM room) ──────────────
    emit({ type: 'chat.provisioning', status: 'pending', label: 'Opening your chat with the agent…' });
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
            // ADR-050: windy_chat is Category 2 (chat handle belongs to bot).
            // identity_id = bot, operator_identity_id = human operator.
            db.prepare(
                `INSERT OR REPLACE INTO product_accounts (id, identity_id, operator_identity_id, product, status, external_id, metadata, provisioned_at)
                 VALUES (?, ?, ?, 'windy_chat', 'active', ?, ?, datetime('now'))`,
            ).run(
                crypto.randomUUID(), botUserId, userId, matrixUserId,
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
                type: 'chat.provisioned',
                status: 'ok',
                label: 'Chat room is live.',
                data: { matrix_user_id: matrixUserId, dm_room_id: dmRoomId },
            });
        } else {
            emit({
                type: 'chat.provisioned',
                status: 'failed',
                label: 'Chat onboarding failed — will retry.',
                data: { http_status: chatResult.status },
            });
        }
    } catch (err: any) {
        emit({
            type: 'chat.provisioned',
            status: 'failed',
            label: 'Chat onboarding threw.',
            data: { error: String(err?.message || err) },
        });
    }

    // ── Step 7: Cloud quota allocation (bot) ──────────────────
    emit({ type: 'cloud.provisioning', status: 'pending', label: 'Allocating cloud storage…' });
    try {
        db.prepare(
            `UPDATE users SET storage_limit = ? WHERE id = ? AND (storage_limit IS NULL OR storage_limit = 0)`,
        ).run(5 * 1024 * 1024 * 1024, botUserId);
        emit({ type: 'cloud.provisioned', status: 'ok', label: '5 GB allocated.', data: { storage_limit_bytes: 5 * 1024 * 1024 * 1024 } });
    } catch (err: any) {
        emit({ type: 'cloud.provisioned', status: 'failed', label: 'Cloud allocation failed.', data: { error: String(err?.message || err) } });
    }

    // ── Step 8: Phone assignment ──────────────────────────────
    // SMS gateway isn't wired yet, but the canonical contract requires
    // these two frames so sister clients can draw the "Phone: …" row on
    // the certificate. We emit assigned/ok with skipped:true — clients
    // render "—" for a null number.
    emit({ type: 'phone.assigning', status: 'pending', label: 'Assigning a phone number…' });
    const agentPhone: string | null = null;
    emit({
        type: 'phone.assigned',
        status: 'ok',
        label: 'Phone assignment queued (SMS gateway pending).',
        data: { phone: agentPhone, skipped: true },
    });

    // ── Step 9: Birth certificate ─────────────────────────────
    emit({ type: 'birth_certificate.generating', status: 'pending', label: 'Generating birth certificate…' });
    const certificateNo = `WF-${(passportNumber || 'XXXX-XXXX').replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;
    const certificate = {
        certificate_no: certificateNo,
        agent_name: agentName,
        passport_number: passportNumber,
        born_at: new Date().toISOString(),
        creator: owner.name || owner.email.split('@')[0],
        creator_email: owner.email,
        email: agentEmail,
        phone: agentPhone,
        cloud_storage_bytes: 5 * 1024 * 1024 * 1024,
        brain: { provider: brokerProvider, model: brokerModel },
        chat: { matrix_user_id: matrixUserId, dm_room_id: dmRoomId },
    };
    emit({
        type: 'birth_certificate.ready',
        status: 'ok',
        label: 'Birth certificate issued.',
        data: certificate,
    });

    // ── Step 10: Hatch complete ───────────────────────────────
    // Honest terminal frame: if a core cross-product resource (mailbox, chat
    // identity) didn't actually provision, report a PARTIAL birth naming what's
    // degraded — don't paper over it with a blanket "ok". (Phone is
    // intentionally deferred and not counted; the passport is fail-closed
    // upstream so it always exists by the time we reach here.)
    const degraded: string[] = [];
    if (!mailOk) degraded.push('mail');
    if (!matrixUserId) degraded.push('chat');
    if (degraded.length > 0) {
        emit({
            type: 'hatch.complete',
            status: 'partial',
            label: `Your agent is here — but ${degraded.join(' + ')} didn't finish provisioning.`,
            data: { session_id: session.id, resumed: false, degraded },
        });
    } else {
        emit({ type: 'hatch.complete', status: 'ok', label: 'Your agent is here.', data: { session_id: session.id, resumed: false } });
    }

    emitAdminEvent({
        event_type: 'hatch.completed',
        actor_type: 'human',
        actor_id: windyIdentityId,
        duration_ms: Date.now() - hatchStartedAtMs,
        session_id: session.id,
        metadata: {
            status: degraded.length > 0 ? 'partial' : 'ok',
            degraded,
            passport: passportNumber || null,
        },
    });

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

    // ── Welcome email (fire-and-forget) ───────────────────────
    // Sent from Pro via Resend (not via Mail's JMAP send, which is
    // currently blocked by a Stalwart 0.16 auth incompatibility — see
    // lockbox Phase 8d). Owner gets a "<Agent> is alive" email with
    // the agent's passport, certificate, and inbox address. Non-fatal
    // on failure — the hatch flow has already completed.
    (async () => {
        try {
            const { sendMail, agentHatchedEmail } = await import('../services/mailer');
            const certificateNo = `WF-${(passportNumber || '').replace(/-/g, '').slice(2, 10)}`;
            const args = agentHatchedEmail({
                agentName,
                agentEmail,
                passportNumber: passportNumber || '',
                certificateNo,
                ownerName: owner.name || owner.email.split('@')[0],
            });
            args.to = owner.email;
            const result = await sendMail(args);
            if (result.success) {
                console.log(`[hatch] welcome email sent to=${args.to} subject="${args.subject}"`);
            } else {
                console.warn(`[hatch] welcome email send failed for ${owner.email}: ${result.error}`);
            }
        } catch (err: any) {
            console.warn('[hatch] welcome email dispatch threw:', err?.message || err);
        }
    })();

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
