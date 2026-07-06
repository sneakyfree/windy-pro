/**
 * Windy Admin telemetry emitter (ADR-WA-001).
 *
 * Fire-and-forget event envelopes to the ecosystem's central
 * observability ingest (admin.windyword.ai). Distinct from
 * analytics.ts (local DB engagement metrics): this feeds the
 * cross-platform funnel the super-admin dashboard reads —
 * signup → email-verified → hatch started/completed → first
 * conversation.
 *
 * Hard rules:
 *  - NEVER affects product traffic: 2s timeout, all errors swallowed,
 *    inert unless WINDY_ADMIN_INGEST_URL + WINDY_ADMIN_INGEST_TOKEN
 *    are set.
 *  - Privacy line (ADR-WA-001 §4): counts/durations/models only —
 *    never message content, never email bodies. The ingest 422s
 *    content-like metadata keys.
 */

export interface AdminEvent {
  event_type: string;
  actor_type: 'human' | 'agent' | 'system';
  actor_id?: string | null;
  model?: string | null;
  provider?: string | null;
  duration_ms?: number | null;
  session_id?: string | null;
  metadata?: Record<string, unknown>;
}

export function emitAdminEvent(event: AdminEvent): Promise<number | null> {
  const url = process.env.WINDY_ADMIN_INGEST_URL;
  const token = process.env.WINDY_ADMIN_INGEST_TOKEN;
  if (!url || !token) return Promise.resolve(null);
  const envelope = {
    ts: new Date().toISOString(),
    platform: 'windy-pro',
    service: 'account-server',
    ...event,
  };
  return fetch(`${url.replace(/\/$/, '')}/v1/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ events: [envelope] }),
    signal: AbortSignal.timeout(2000),
  })
    .then((res) => {
      if (res.status !== 202) {
        console.warn(`[admin-telemetry] ingest returned ${res.status}`);
      }
      return res.status;
    })
    .catch((err) => {
      console.warn(`[admin-telemetry] post failed: ${err?.message || err}`);
      return null;
    });
}
