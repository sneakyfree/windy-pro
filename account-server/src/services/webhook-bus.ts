/**
 * Identity webhook fan-out bus (PR4).
 *
 * Producer-side contract: when an identity event happens (created, updated,
 * revoked) we POST a signed payload to every consumer's
 * {URL}/api/v1/webhooks/identity/{event-name} endpoint.
 *
 * Each (event, target) pair is one row in webhook_deliveries. A background
 * worker polls for due rows every 30s and retries on transient failures
 * with the schedule below. Successful deliveries are kept (delivered_at set)
 * for audit. Dead-lettered rows are kept (dead_lettered_at set) for forensics.
 *
 * Retry schedule (per spec):
 *   attempt 1 → immediate
 *   attempt 2 → +5s
 *   attempt 3 → +30s
 *   attempt 4 → +5m
 *   attempt 5 → +1h
 *   attempt 6 → +6h
 *   attempt 7 → +24h
 *   8th failure → dead letter
 *
 * Signature: HMAC-SHA256 of the raw JSON body with the target's shared
 * secret. Sent as `X-Windy-Signature: sha256=<hex>`. Each target has its
 * own secret so a leak at one consumer can't forge events to another.
 *
 * Producer event schemas live in account-server/docs/webhooks.md.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { logAuditEvent } from '../identity-service';

// ─── Targets ─────────────────────────────────────────────────────

export type WebhookEvent = 'identity.created' | 'identity.updated' | 'identity.revoked';

export interface TargetConfig {
  name: string;        // 'mail' | 'chat' | 'cloud' | 'eternitas' | 'clone'
  baseUrl: string;     // e.g. process.env.WINDY_MAIL_URL
  secret: string;      // HMAC shared secret, per-target
  pathFor: (event: WebhookEvent) => string;
}

/**
 * Resolve target configs from env. Targets without a configured URL are
 * silently skipped — useful in dev/test where not every consumer is up.
 */
export function getTargets(): TargetConfig[] {
  const candidates: Array<{ name: string; urlEnv: string; secretEnv: string }> = [
    { name: 'mail',      urlEnv: 'WINDY_MAIL_URL',  secretEnv: 'WINDY_MAIL_WEBHOOK_SECRET' },
    { name: 'chat',      urlEnv: 'WINDY_CHAT_URL',  secretEnv: 'WINDY_CHAT_WEBHOOK_SECRET' },
    { name: 'cloud',     urlEnv: 'WINDY_CLOUD_URL', secretEnv: 'WINDY_CLOUD_WEBHOOK_SECRET' },
    { name: 'eternitas', urlEnv: 'ETERNITAS_URL',   secretEnv: 'ETERNITAS_WEBHOOK_SECRET' },
    { name: 'clone',     urlEnv: 'WINDY_CLONE_URL', secretEnv: 'WINDY_CLONE_WEBHOOK_SECRET' },
  ];
  const targets: TargetConfig[] = [];
  for (const c of candidates) {
    const baseUrl = process.env[c.urlEnv];
    if (!baseUrl) continue;
    const secret = process.env[c.secretEnv] || '';
    if (!secret && process.env.NODE_ENV === 'production') {
      console.warn(`[webhook-bus] ${c.name} has URL but no ${c.secretEnv}; skipping in production.`);
      continue;
    }
    targets.push({
      name: c.name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      secret,
      pathFor: (event) => `/api/v1/webhooks/identity/${event.split('.')[1]}`, // 'created' | 'updated' | 'revoked'
    });
  }
  return targets;
}

// ─── Signature ───────────────────────────────────────────────────

export function signPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Retry schedule ──────────────────────────────────────────────

const RETRY_DELAYS_SECONDS = [0, 5, 30, 5 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length;

function delayForAttempt(attempt: number): number {
  // attempt is the count of attempts ALREADY made (0..MAX_ATTEMPTS-1).
  // Returns seconds until the (attempt+1)-th try.
  return RETRY_DELAYS_SECONDS[attempt] ?? RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1];
}

// ─── Payload builders ────────────────────────────────────────────

export interface IdentityFields {
  windy_identity_id: string;
  email: string;
  display_name?: string | null;
  tier?: string | null;
  created_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_local_part?: string | null;
}

function splitName(displayName: string | null | undefined, email: string): { first: string; last: string; localPart: string } {
  const trimmed = (displayName || '').trim();
  const localPart = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user';
  if (!trimmed) return { first: localPart, last: '', localPart };
  const parts = trimmed.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(' '), localPart };
}

export function buildIdentityPayload(
  event: WebhookEvent,
  identity: IdentityFields,
  extras: Record<string, any> = {},
): Record<string, any> {
  const { first, last, localPart } = splitName(identity.display_name, identity.email);
  return {
    event,
    windy_identity_id: identity.windy_identity_id,
    email: identity.email,
    display_name: identity.display_name || null,
    tier: identity.tier || 'free',
    created_at: identity.created_at || null,
    first_name: identity.first_name ?? first,
    last_name: identity.last_name ?? last,
    preferred_local_part: identity.preferred_local_part ?? localPart,
    ...extras,
  };
}

// ─── Enqueue ─────────────────────────────────────────────────────

/**
 * Insert one delivery row per configured target. Each target gets its own
 * signed payload (same body, different signature because secrets differ).
 *
 * Returns the delivery IDs so callers can attempt immediate delivery in the
 * same request.
 */
export function enqueueIdentityEvent(
  event: WebhookEvent,
  identity: IdentityFields,
  extras: Record<string, any> = {},
  targetsOverride?: TargetConfig[],
): { deliveryIds: string[]; payload: Record<string, any> } {
  const db = getDb();
  const targets = targetsOverride ?? getTargets();
  const payload = buildIdentityPayload(event, identity, extras);
  const body = JSON.stringify(payload);
  const nowIso = new Date().toISOString();
  const deliveryIds: string[] = [];

  for (const t of targets) {
    const id = uuidv4();
    const url = t.baseUrl + t.pathFor(event);
    const signature = signPayload(body, t.secret);
    db.prepare(
      `INSERT INTO webhook_deliveries
         (id, event_type, target, target_url, payload, signature,
          attempts, next_attempt_at, identity_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, event, t.name, url, body, signature, nowIso, identity.windy_identity_id);
    deliveryIds.push(id);
  }

  return { deliveryIds, payload };
}

// ─── Attempt delivery ────────────────────────────────────────────

export interface AttemptResult {
  status: 'delivered' | 'retry' | 'dead';
  httpStatus?: number;
  error?: string;
}

export async function attemptDelivery(deliveryId: string): Promise<AttemptResult> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(deliveryId) as any;
  if (!row) return { status: 'dead', error: 'delivery row not found' };
  if (row.delivered_at) return { status: 'delivered' };
  if (row.dead_lettered_at) return { status: 'dead' };

  const attemptNumber = row.attempts; // 0-indexed; this is the upcoming attempt
  let httpStatus: number | undefined;
  let error: string | undefined;
  let success = false;
  let unrecoverable = false;

  try {
    const res = await fetch(row.target_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Windy-Signature': row.signature,
        'X-Windy-Event': row.event_type,
        'X-Windy-Delivery-Id': row.id,
      },
      body: row.payload,
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = res.status;
    success = res.status >= 200 && res.status < 300;
    // 4xx (except 408 Request Timeout, 429 Too Many) = consumer rejected; don't retry forever.
    unrecoverable = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    if (!success) {
      try { error = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    }
  } catch (e: any) {
    error = e?.message || String(e);
  }

  const newAttempts = attemptNumber + 1;
  const nowIso = new Date().toISOString();

  if (success) {
    db.prepare(
      'UPDATE webhook_deliveries SET attempts = ?, delivered_at = ?, last_error = NULL WHERE id = ?',
    ).run(newAttempts, nowIso, deliveryId);
    logAuditEvent('webhook_delivered', row.identity_id || null, {
      target: row.target, event: row.event_type, httpStatus,
    });
    return { status: 'delivered', httpStatus };
  }

  if (unrecoverable || newAttempts >= MAX_ATTEMPTS) {
    db.prepare(
      'UPDATE webhook_deliveries SET attempts = ?, dead_lettered_at = ?, last_error = ? WHERE id = ?',
    ).run(newAttempts, nowIso, error || `HTTP ${httpStatus}`, deliveryId);
    logAuditEvent('webhook_dead_lettered', row.identity_id || null, {
      target: row.target, event: row.event_type, attempts: newAttempts, httpStatus, error,
    });
    return { status: 'dead', httpStatus, error };
  }

  // Schedule next attempt
  const delaySec = delayForAttempt(newAttempts);
  const next = new Date(Date.now() + delaySec * 1000).toISOString();
  db.prepare(
    'UPDATE webhook_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
  ).run(newAttempts, next, error || `HTTP ${httpStatus}`, deliveryId);
  logAuditEvent('webhook_failed', row.identity_id || null, {
    target: row.target, event: row.event_type, attempts: newAttempts, httpStatus, error, retryAt: next,
  });
  return { status: 'retry', httpStatus, error };
}

// ─── Worker ──────────────────────────────────────────────────────

const WORKER_INTERVAL_MS = 30 * 1000;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export async function processDueDeliveries(limit = 50): Promise<{ attempted: number; delivered: number; failed: number; dead: number }> {
  const db = getDb();
  const due = db.prepare(
    `SELECT id FROM webhook_deliveries
     WHERE delivered_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC LIMIT ?`,
  ).all(new Date().toISOString(), limit) as Array<{ id: string }>;

  let delivered = 0, failed = 0, dead = 0;
  for (const { id } of due) {
    const r = await attemptDelivery(id);
    if (r.status === 'delivered') delivered++;
    else if (r.status === 'retry') failed++;
    else dead++;
  }
  return { attempted: due.length, delivered, failed, dead };
}

export function startWebhookWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(async () => {
    try {
      const r = await processDueDeliveries();
      if (r.attempted > 0) {
        console.log(`[webhook-bus] ${r.delivered} delivered, ${r.failed} retrying, ${r.dead} dead-lettered`);
      }
    } catch (e: any) {
      console.error('[webhook-bus] worker error:', e?.message || e);
    }
  }, WORKER_INTERVAL_MS);
  workerTimer.unref();
  console.log('[webhook-bus] worker started (every 30s)');
}

export function stopWebhookWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
