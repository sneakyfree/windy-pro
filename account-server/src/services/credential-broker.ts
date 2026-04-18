/**
 * Wave 8 — Managed-credential broker.
 *
 * Pro holds multi-provider LLM keys (OpenAI, Anthropic, Gemini). When an
 * agent needs to make an LLM call it asks account-server for a short-lived
 * broker token instead of getting a raw provider key. The agent hands the
 * broker token to the LLM gateway; the gateway calls back here to redeem
 * it, meter usage against the user's plan, and forward the request to the
 * appropriate provider with the real key.
 *
 * Why a token and not just "call the gateway directly":
 *   1. Tokens are revocable. Eternitas fires passport.revoked → every
 *      broker token minted against that passport becomes invalid instantly.
 *   2. Tokens are meterable. Each token has a usage_cap_tokens ceiling so
 *      a runaway agent can't burn the monthly plan on one prompt.
 *   3. Tokens are auditable. Every issuance + usage row is a database
 *      record an operator can correlate to a user.
 *
 * Security model:
 *   - Raw tokens are never persisted. We store sha256(raw) for lookup.
 *   - /credentials/issue requires HMAC signing with BROKER_HMAC_SECRET —
 *     it's service-to-service only (agent host → account-server).
 *   - Revocations are cryptographic, not "mark as inactive": a bcrypt-
 *     hashed reason is written to broker_revocations so the intent is
 *     tamper-evident.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/schema';
import { config } from '../config';
import { logAuditEvent } from '../identity-service';

// ─── Provider routing (plan tier → provider/model) ───────────
//
// Free users get Gemini (free tier covers most casual use). Paid tiers
// get better providers/models. Enterprise unlocks tools like claude
// sonnet with a fat per-token cap. The cap is lifetime-of-token; the
// token expires after duration_seconds anyway, so this is really a
// per-session ceiling against runaway loops.
export interface ProviderChoice {
    provider: 'gemini' | 'openai' | 'anthropic';
    model: string;
    usage_cap_tokens: number;
}

const TIER_TO_PROVIDER: Record<string, ProviderChoice> = {
    free:       { provider: 'gemini',    model: 'gemini-1.5-flash',              usage_cap_tokens:    50_000 },
    starter:    { provider: 'openai',    model: 'gpt-4o-mini',                    usage_cap_tokens:   200_000 },
    pro:        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',      usage_cap_tokens:   500_000 },
    enterprise: { provider: 'anthropic', model: 'claude-sonnet-4-6',              usage_cap_tokens: 2_000_000 },
};

export function chooseProvider(tier: string | null | undefined): ProviderChoice {
    const key = (tier || 'free').toLowerCase();
    return TIER_TO_PROVIDER[key] || TIER_TO_PROVIDER.free;
}

// ─── HMAC signing for service-to-service calls ───────────────
//
// Headers:   X-Windy-Signature: sha256=<hex>
//            X-Windy-Timestamp: <unix seconds>
// Canonical: `${timestamp}.${method}.${path}.${sha256(canonical_body)}`
//   where canonical_body is the payload serialized with sorted keys and
//   minimal separators — matching python's
//   json.dumps(payload, separators=(",", ":"), sort_keys=True).
// Replay is bounded by a ±5 minute timestamp window.
//
// Both header names are the ecosystem-wide "X-Windy-*" convention (the
// same scheme the outbound webhook bus uses). Sort-keys canonicalization
// is load-bearing because Express's body-parser discards the raw bytes
// by the time our handler runs — we re-canonicalize on this side and
// clients must canonicalize the same way when they sign.
export interface SignedRequest {
    timestamp: string;   // Unix seconds as string
    signature: string;   // "sha256=<hex>" — ready to put in the header
    canonicalBody: string; // the bytes that were actually signed
}

/**
 * Canonical JSON: recursively sorts object keys and emits minimal
 * separators (`,` and `:`). Matches python's
 * `json.dumps(x, separators=(",", ":"), sort_keys=True)` byte-for-byte
 * for any value the two languages share (strings, numbers, booleans,
 * null, arrays, plain objects). Non-finite numbers throw like
 * JSON.stringify would.
 */
export function canonicalJsonStringify(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalJsonStringify).join(',') + ']';
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        return '{' + keys.map(k =>
            JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]),
        ).join(',') + '}';
    }
    // undefined / function / symbol — match JSON.stringify's "silently drop"
    // behavior inside objects; at top level we return 'null' so the HMAC
    // is still deterministic.
    return 'null';
}

/**
 * Strip the "sha256=" prefix from a header value. Accepts either the
 * prefixed form (preferred) or a bare hex signature (for back-compat
 * during the rename rollout).
 */
function parseSignatureHeader(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith('sha256=')) return trimmed.slice(7);
    // Bare hex — accept so an in-flight client that hasn't adopted the
    // prefix yet doesn't silently 401. Reject anything non-hex.
    if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
    return null;
}

export function signBrokerRequest(
    method: string,
    path: string,
    bodyOrPayload: string | Record<string, unknown> | unknown[] | null,
    secret = config.BROKER_HMAC_SECRET,
    timestamp = Math.floor(Date.now() / 1000).toString(),
): SignedRequest {
    if (!secret) throw new Error('BROKER_HMAC_SECRET is not configured');
    // Accept either a pre-canonicalized string (caller is already in
    // charge of sort-keys) or a parsed payload we canonicalize here.
    const canonicalBody = typeof bodyOrPayload === 'string'
        ? bodyOrPayload
        : canonicalJsonStringify(bodyOrPayload ?? {});
    const bodyHash = crypto.createHash('sha256').update(canonicalBody).digest('hex');
    const canonical = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
    const hex = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    return { timestamp, signature: `sha256=${hex}`, canonicalBody };
}

export function verifyBrokerSignature(
    method: string,
    path: string,
    payload: unknown,
    timestamp: string,
    signatureHeader: string,
    secret = config.BROKER_HMAC_SECRET,
    nowSec = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
    if (!secret) return { ok: false, reason: 'broker_secret_not_configured' };
    if (!timestamp || !signatureHeader) return { ok: false, reason: 'missing_sig_headers' };
    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
    if (Math.abs(nowSec - ts) > 300) return { ok: false, reason: 'stale_timestamp' };

    const providedHex = parseSignatureHeader(signatureHeader);
    if (!providedHex) return { ok: false, reason: 'bad_signature' };

    const canonicalBody = canonicalJsonStringify(payload ?? {});
    const bodyHash = crypto.createHash('sha256').update(canonicalBody).digest('hex');
    const canonical = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
    const expectedHex = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length === 0 || a.length !== b.length) return { ok: false, reason: 'bad_signature' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
    return { ok: true };
}

// ─── Token minting ───────────────────────────────────────────

export interface IssueParams {
    windy_identity_id: string;
    passport_number?: string | null;
    scope?: string;
    duration_seconds?: number;
    plan_tier_override?: string;
}

export interface IssuedToken {
    broker_token: string;        // raw token — returned once, never again
    token_id: string;
    provider: string;
    model: string;
    scope: string;
    expires_at: string;           // ISO-8601
    usage_cap_tokens: number;
    passport_number: string | null;
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function randomToken(): { raw: string; hash: string; prefix: string } {
    const body = crypto.randomBytes(32).toString('base64url');
    const raw = `bk_live_${body}`;
    return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 12) };
}

export function issueBrokerToken(params: IssueParams): IssuedToken {
    const db = getDb();

    const user = db.prepare(
        `SELECT id, tier, license_tier, passport_id
         FROM users WHERE windy_identity_id = ? OR id = ?`,
    ).get(params.windy_identity_id, params.windy_identity_id) as
        { id: string; tier: string; license_tier: string; passport_id: string | null } | undefined;

    if (!user) {
        throw new Error(`identity_not_found:${params.windy_identity_id}`);
    }

    // Passport revocation check — no token issuance for revoked passports.
    const passportNumber = params.passport_number ?? user.passport_id ?? null;
    if (passportNumber) {
        const passport = db.prepare(
            `SELECT status FROM eternitas_passports WHERE passport_number = ?`,
        ).get(passportNumber) as { status: string } | undefined;
        if (passport && (passport.status === 'revoked' || passport.status === 'suspended')) {
            throw new Error(`passport_${passport.status}`);
        }
    }

    // Explicit override > license_tier > tier > 'free'.
    const effectiveTier = params.plan_tier_override || user.license_tier || user.tier || 'free';
    const choice = chooseProvider(effectiveTier);

    // Default 1 hour, clamp to [60s, 24h].
    const duration = Math.min(
        Math.max(params.duration_seconds ?? 3600, 60),
        24 * 60 * 60,
    );

    const { raw, hash, prefix } = randomToken();
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + duration * 1000).toISOString();

    db.prepare(`
        INSERT INTO broker_tokens
          (id, identity_id, passport_number, token_hash, token_prefix,
           scope, provider, model, plan_tier, issued_at, expires_at,
           usage_cap_tokens, usage_tokens, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, 0, 'active')
    `).run(
        tokenId,
        user.id,
        passportNumber,
        hash,
        prefix,
        params.scope || 'llm:chat',
        choice.provider,
        choice.model,
        effectiveTier,
        expiresAt,
        choice.usage_cap_tokens,
    );

    try {
        logAuditEvent('broker_token_issue', user.id, {
            token_id: tokenId,
            prefix,
            provider: choice.provider,
            model: choice.model,
            plan_tier: effectiveTier,
            passport_number: passportNumber,
            usage_cap_tokens: choice.usage_cap_tokens,
            expires_at: expiresAt,
        });
    } catch { /* audit is non-critical */ }

    return {
        broker_token: raw,
        token_id: tokenId,
        provider: choice.provider,
        model: choice.model,
        scope: params.scope || 'llm:chat',
        expires_at: expiresAt,
        usage_cap_tokens: choice.usage_cap_tokens,
        passport_number: passportNumber,
    };
}

// ─── Verification (used by gateway at redeem time) ───────────

export interface VerifyResult {
    ok: boolean;
    reason?: 'not_found' | 'revoked' | 'expired' | 'exhausted';
    token?: {
        id: string;
        identity_id: string;
        passport_number: string | null;
        provider: string;
        model: string;
        scope: string;
        expires_at: string;
        usage_cap_tokens: number;
        usage_tokens: number;
    };
}

export function verifyBrokerToken(rawToken: string): VerifyResult {
    if (!rawToken || !rawToken.startsWith('bk_')) return { ok: false, reason: 'not_found' };
    const hash = sha256Hex(rawToken);
    const db = getDb();
    const row = db.prepare(
        `SELECT id, identity_id, passport_number, provider, model, scope,
                expires_at, usage_cap_tokens, usage_tokens, status
         FROM broker_tokens WHERE token_hash = ?`,
    ).get(hash) as any | undefined;
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status === 'revoked') return { ok: false, reason: 'revoked' };
    if (row.status === 'exhausted') return { ok: false, reason: 'exhausted' };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
    if (row.usage_tokens >= row.usage_cap_tokens) return { ok: false, reason: 'exhausted' };
    return { ok: true, token: row };
}

// ─── Metering ────────────────────────────────────────────────

/**
 * Record that `tokensUsed` have been spent against this broker token.
 * If usage crosses the cap, the row is marked 'exhausted' and future
 * verify() calls will reject.
 */
export function meterBrokerUsage(rawToken: string, tokensUsed: number): void {
    if (tokensUsed <= 0) return;
    const hash = sha256Hex(rawToken);
    const db = getDb();
    db.prepare(
        `UPDATE broker_tokens SET usage_tokens = usage_tokens + ? WHERE token_hash = ?`,
    ).run(tokensUsed, hash);
    db.prepare(
        `UPDATE broker_tokens SET status = 'exhausted' WHERE token_hash = ? AND usage_tokens >= usage_cap_tokens AND status = 'active'`,
    ).run(hash);
}

// ─── Revocation ──────────────────────────────────────────────

export interface RevokeParams {
    identity_id?: string;
    passport_number?: string;
    token_hash?: string;          // revoke a single token
    reason: string;                // plaintext reason — hashed before persist
    cascade?: boolean;             // default true
}

/**
 * Revoke tokens. Any of {identity_id, passport_number, token_hash} can
 * be the selector. The reason is bcrypt-hashed so the revocation record
 * is tamper-evident (support can confirm "was this revoked for abuse?"
 * by rehashing the candidate reason without reading plaintext back).
 */
export async function revokeBrokerTokens(params: RevokeParams): Promise<number> {
    const db = getDb();
    const cascade = params.cascade ?? true;

    // Hash the reason. bcrypt is intentional — the revocation record is
    // supposed to be a low-throughput operation and bcrypt gives a
    // collision-resistant commitment rather than a revealable hash.
    const reasonHash = await bcrypt.hash(params.reason, 6);

    db.prepare(
        `INSERT INTO broker_revocations (id, identity_id, passport_number, token_hash, reason_hash, cascade, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
        crypto.randomUUID(),
        params.identity_id || null,
        params.passport_number || null,
        params.token_hash || null,
        reasonHash,
        cascade ? 1 : 0,
    );

    let changes = 0;
    if (params.token_hash) {
        changes += (db.prepare(
            `UPDATE broker_tokens SET status = 'revoked', revoked_at = datetime('now'), revoked_reason = 'reason-redacted'
             WHERE token_hash = ? AND status != 'revoked'`,
        ).run(params.token_hash)).changes;
    }
    if (cascade && params.identity_id) {
        changes += (db.prepare(
            `UPDATE broker_tokens SET status = 'revoked', revoked_at = datetime('now'), revoked_reason = 'reason-redacted'
             WHERE identity_id = ? AND status = 'active'`,
        ).run(params.identity_id)).changes;
    }
    if (cascade && params.passport_number) {
        changes += (db.prepare(
            `UPDATE broker_tokens SET status = 'revoked', revoked_at = datetime('now'), revoked_reason = 'reason-redacted'
             WHERE passport_number = ? AND status = 'active'`,
        ).run(params.passport_number)).changes;
    }

    try {
        logAuditEvent('broker_token_revoke', params.identity_id || '(passport)', {
            passport_number: params.passport_number,
            token_hash_redacted: params.token_hash ? params.token_hash.slice(0, 8) + '…' : null,
            cascade,
            revoked_count: changes,
        });
    } catch { /* non-critical */ }

    return changes;
}

/**
 * Hook invoked by cascadeRevocation() in ecosystem-provisioner.
 * Keeps the broker in sync when Eternitas fires passport.revoked.
 */
export async function revokeBrokerTokensForPassport(
    passportNumber: string,
    reason = 'eternitas:passport.revoked',
): Promise<number> {
    return revokeBrokerTokens({
        passport_number: passportNumber,
        reason,
        cascade: true,
    });
}

// ─── Hatch session store ─────────────────────────────────────

export interface HatchEvent {
    seq: number;
    at: string;                    // ISO-8601
    type: string;                  // dotted event name
    status: 'pending' | 'ok' | 'failed';
    label: string;                 // short human label
    data?: Record<string, any>;
}

const MAX_STORED_EVENTS = 50;

export function createHatchSession(windyIdentityId: string): {
    id: string;
    existing: boolean;
    events: HatchEvent[];
    status: string;
} {
    const db = getDb();
    const existing = db.prepare(
        `SELECT id, status, events FROM hatch_sessions WHERE windy_identity_id = ?`,
    ).get(windyIdentityId) as { id: string; status: string; events: string } | undefined;

    if (existing) {
        return {
            id: existing.id,
            existing: true,
            events: JSON.parse(existing.events || '[]'),
            status: existing.status,
        };
    }

    const id = crypto.randomUUID();
    db.prepare(
        `INSERT INTO hatch_sessions (id, windy_identity_id, status, last_event_seq, events)
         VALUES (?, ?, 'running', 0, '[]')`,
    ).run(id, windyIdentityId);
    return { id, existing: false, events: [], status: 'running' };
}

export function appendHatchEvent(sessionId: string, ev: Omit<HatchEvent, 'seq' | 'at'>): HatchEvent {
    const db = getDb();
    const row = db.prepare(
        `SELECT last_event_seq, events FROM hatch_sessions WHERE id = ?`,
    ).get(sessionId) as { last_event_seq: number; events: string } | undefined;
    const seq = (row?.last_event_seq ?? 0) + 1;
    const arr: HatchEvent[] = row ? JSON.parse(row.events || '[]') : [];
    const full: HatchEvent = { seq, at: new Date().toISOString(), ...ev };
    arr.push(full);
    // Cap stored events so hatch_sessions.events doesn't grow unbounded.
    const capped = arr.slice(-MAX_STORED_EVENTS);
    db.prepare(
        `UPDATE hatch_sessions SET last_event_seq = ?, events = ? WHERE id = ?`,
    ).run(seq, JSON.stringify(capped), sessionId);
    return full;
}

export function finishHatchSession(
    sessionId: string,
    fields: {
        status: 'complete' | 'failed';
        bot_identity_id?: string | null;
        agent_name?: string | null;
        passport_number?: string | null;
        broker_token_id?: string | null;
        error?: string | null;
    },
): void {
    const db = getDb();
    db.prepare(
        `UPDATE hatch_sessions
         SET status = ?,
             bot_identity_id = COALESCE(?, bot_identity_id),
             agent_name = COALESCE(?, agent_name),
             passport_number = COALESCE(?, passport_number),
             broker_token_id = COALESCE(?, broker_token_id),
             error = COALESCE(?, error),
             completed_at = datetime('now')
         WHERE id = ?`,
    ).run(
        fields.status,
        fields.bot_identity_id ?? null,
        fields.agent_name ?? null,
        fields.passport_number ?? null,
        fields.broker_token_id ?? null,
        fields.error ?? null,
        sessionId,
    );
}

export function getHatchSession(sessionId: string): {
    id: string;
    windy_identity_id: string;
    status: string;
    events: HatchEvent[];
    agent_name: string | null;
    passport_number: string | null;
    broker_token_id: string | null;
    bot_identity_id: string | null;
    error: string | null;
} | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM hatch_sessions WHERE id = ?`).get(sessionId) as any;
    if (!row) return null;
    return { ...row, events: JSON.parse(row.events || '[]') };
}
