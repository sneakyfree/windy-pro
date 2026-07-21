/**
 * Windy Admin telemetry emitter for the DESKTOP app (ADR-WA-001).
 *
 * Mirrors account-server/src/services/admin-telemetry.ts for the desktop
 * lifecycle: session start/end only. This exists for operator/stress rigs —
 * it is HARD-INERT unless BOTH WINDY_ADMIN_INGEST_URL and
 * WINDY_ADMIN_INGEST_TOKEN are set in the app's environment, so a normal
 * consumer install (which sets neither) emits NOTHING, consistent with the
 * free build's "No Telemetry" privacy promise. This is separate from the
 * opt-in anonymous stats in renderer/app.js (_sendAnalytics).
 *
 * Hard rules (ADR-WA-001):
 *  - NEVER affects product traffic: 2s timeout, all errors swallowed.
 *  - Privacy line: counts/durations/versions only — never transcript text,
 *    never audio, never message content. The ingest 422s content-like keys.
 */
'use strict';

function emitAdminEvent(eventType, fields = {}) {
  try {
    const url = process.env.WINDY_ADMIN_INGEST_URL;
    const token = process.env.WINDY_ADMIN_INGEST_TOKEN;
    if (!url || !token) return; // inert unless explicitly configured
    const envelope = {
      ts: new Date().toISOString(),
      platform: 'windy-pro',
      service: 'desktop',
      event_type: eventType,
      // The free desktop build has no login/identity — 'system' avoids the ingest's
      // actor_id requirement for human/agent and keeps us from minting device IDs.
      actor_type: 'system',
      ...fields,
    };
    fetch(`${url.replace(/\/$/, '')}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [envelope] }),
      signal: AbortSignal.timeout(2000),
    }).then((res) => {
      if (res.status !== 202) console.warn(`[admin-telemetry] ingest returned ${res.status}`);
    }).catch(() => { /* fire-and-forget */ });
  } catch (_) { /* never throw into app lifecycle */ }
}

module.exports = { emitAdminEvent };
