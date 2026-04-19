/**
 * POST /webhooks/eternitas — firehose subscriber endpoint.
 *
 * Eternitas fans out ecosystem-wide trust events (operator.registered,
 * clearance.promoted, passport.revoked, …) to every platform that has
 * subscribed to its firehose. We receive them here.
 *
 * Contract:
 *   - X-Eternitas-Signature: HMAC-SHA256(ETERNITAS_HMAC_SECRET, raw_body),
 *     hex-encoded. Optional `sha256=` prefix is accepted.
 *   - Respond 200 {"received": true} within 5 s; process the event
 *     asynchronously via setImmediate so the HTTP handler never blocks
 *     on downstream work.
 *   - Unknown event types are logged and receipted (200). Silently
 *     swallowing unknowns means a newer Eternitas version can ship new
 *     event types without breaking subscribers.
 *   - Signature mismatch → 401 (not 400/403 — Eternitas's retry logic
 *     treats 401 as auth failure and backs off cleanly).
 *
 * Separate from the existing /api/v1/identity/eternitas/webhook route,
 * which handles *individual passport* events for locally-registered
 * bots. This new route is the *platform-level* firehose for the entire
 * ecosystem, including events about operators / platforms other than
 * our own bots.
 *
 * Raw-body requirement: HMAC must be computed over the exact wire bytes
 * Eternitas signed. Express's default JSON body-parser re-serializes,
 * which would produce a different byte sequence (different whitespace,
 * key ordering, unicode escaping). Server.ts therefore mounts this
 * router BEFORE the global express.json() with its own
 * express.raw({ type: 'application/json' }) — same pattern as the
 * Stripe webhook route. We JSON.parse the buffer after signature
 * verify so handler code can see the event as an object.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { makeRateLimiter } from '../services/rate-limiter';

// ─── Recognized event types ──────────────────────────────────
//
// These are the events the platform knows how to dispatch. Keeping the
// list explicit makes the unknown-event log noisy-but-informative: any
// entry that falls into the default branch is either (a) a typo on
// Eternitas's side, (b) a new event we need to wire up, or (c) an
// event intended for a different subscriber.
const KNOWN_EVENT_TYPES = new Set<string>([
    'operator.registered',
    'operator.updated',
    'clearance.promoted',
    'clearance.demoted',
    'passport.issued',
    'passport.revoked',
    'passport.suspended',
    'passport.reinstated',
    'trust.band_changed',
    'trust.score_updated',
]);

const firehoseLimiter = makeRateLimiter('eternitas-firehose', {
    windowMs: 60 * 1000,
    // Firehose traffic can spike on fleet-wide promotions (e.g., a
    // clearance policy change that pushes hundreds of events). Leave
    // headroom over expected steady state; NODE_ENV=test lifts it.
    max: process.env.NODE_ENV === 'test' ? 10_000 : 600,
    standardHeaders: true,
    legacyHeaders: false,
});

const router = Router();

// ─── Parse the X-Eternitas-Signature header ─────────────────
// Accepts both "sha256=<hex>" (preferred) and bare hex (back-compat).
function parseSignatureHeader(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith('sha256=')) return trimmed.slice(7);
    if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
    return null;
}

function timingSafeEqualHex(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

// ─── Async event processing ──────────────────────────────────
// Fired via setImmediate after the response is sent so the handler
// returns within the spec's 5s budget regardless of how long the
// downstream work takes.
export function processEternitasFirehoseEvent(event: Record<string, unknown>): void {
    const type = String(event.type || event.event || '');
    if (!KNOWN_EVENT_TYPES.has(type)) {
        console.log(`[eternitas firehose] unknown event type: ${JSON.stringify(type)} (acknowledged, no handler)`);
        return;
    }
    // Phase 1 handler: log + no-op. Real handlers land as follow-up
    // commits in later waves (passport.revoked already has a local
    // cascade via /api/v1/identity/eternitas/webhook; we're careful
    // not to double-apply here).
    console.log(`[eternitas firehose] ${type}`, JSON.stringify(event));
}

// ─── Router ──────────────────────────────────────────────────
// Note: express.raw({ type: 'application/json' }) is installed at
// mount time in server.ts so req.body is a Buffer here (global
// express.json() would otherwise consume the stream first).
router.post(
    '/eternitas',
    firehoseLimiter,
    (req: Request, res: Response) => {
        const secret = process.env.ETERNITAS_HMAC_SECRET;
        if (!secret) {
            // Fail-closed — without the shared secret we can't verify
            // anything and MUST NOT accept events. 503 signals to
            // Eternitas that the subscriber is misconfigured; it'll
            // retry with backoff rather than deadlettering.
            return res.status(503).json({
                error: 'webhook_secret_not_configured',
                code: 'ETERNITAS_HMAC_SECRET not set',
            });
        }

        const sigHeader = (req.header('x-eternitas-signature') || '').trim();
        const providedHex = parseSignatureHeader(sigHeader);
        if (!providedHex) {
            return res.status(401).json({ error: 'missing_signature' });
        }

        // Raw body: express.raw gives us a Buffer when Content-Type
        // matches, otherwise an empty object. Normalize.
        const rawBody: Buffer = Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === 'string' ? req.body : '');

        const expectedHex = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

        if (!timingSafeEqualHex(expectedHex, providedHex)) {
            return res.status(401).json({ error: 'invalid_signature' });
        }

        // Parse the event. A malformed JSON body after a valid HMAC is
        // suspicious (the sender signed something unparseable) but we
        // still ack so Eternitas doesn't retry a doomed payload.
        let event: Record<string, unknown> = {};
        try {
            const parsed = JSON.parse(rawBody.toString('utf-8'));
            if (parsed && typeof parsed === 'object') event = parsed;
        } catch {
            console.warn('[eternitas firehose] signature verified but body is not JSON; acknowledging');
        }

        // Respond fast. Any downstream processing happens after the
        // response headers are flushed — the HTTP handler is free to
        // return within a few ms even if handlers take seconds.
        res.status(200).json({ received: true });
        setImmediate(() => {
            try {
                processEternitasFirehoseEvent(event);
            } catch (err: any) {
                console.error('[eternitas firehose] processing error:', err?.message || err);
            }
        });
    },
);

export default router;
