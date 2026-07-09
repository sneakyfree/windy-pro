/**
 * Intel V2 — client-enforced message frequency caps (INTEL-CONTRACT-V2 §3).
 *
 * Pure logic (no electron) so it is unit-testable. The caller persists the
 * per-message history records (impression timestamps) in electron-store.
 *
 * A history record is: { impressions: [epochMs, ...] }.
 */
'use strict';

const HOUR_MS = 60 * 60 * 1000;

/** Is `now` inside the message's starts_at/ends_at window (if any)? */
function withinWindow(msg, now) {
  if (msg.starts_at) {
    const t = Date.parse(msg.starts_at);
    if (!Number.isNaN(t) && now < t) return false;
  }
  if (msg.ends_at) {
    const t = Date.parse(msg.ends_at);
    if (!Number.isNaN(t) && now > t) return false;
  }
  return true;
}

/** Does the frequency_cap allow showing this message now? */
function capAllows(msg, record, now) {
  const cap = msg.frequency_cap || {};
  const imps = (record && Array.isArray(record.impressions)) ? record.impressions : [];
  if (imps.length === 0) return true;
  const last = Math.max(...imps);
  if (Number.isFinite(cap.cooldown_hours) && cap.cooldown_hours > 0) {
    if (now - last < cap.cooldown_hours * HOUR_MS) return false;
  }
  if (Number.isFinite(cap.max_impressions) && cap.max_impressions > 0) {
    const windowMs = (Number.isFinite(cap.per_hours) && cap.per_hours > 0)
      ? cap.per_hours * HOUR_MS
      : Infinity;
    const inWindow = imps.filter((t) => now - t <= windowMs).length;
    if (inWindow >= cap.max_impressions) return false;
  }
  return true;
}

/**
 * Pick the next message to show: in-window, cap-allowed, highest priority
 * first (maintenance messages tie-break above everything else at equal
 * priority). `records` is a map message_id → history record.
 * Returns the message or null.
 */
function pickMessage(messages, records, now) {
  if (!Array.isArray(messages)) return null;
  const eligible = messages.filter((m) => m && m.message_id
    && withinWindow(m, now)
    && capAllows(m, records[m.message_id], now));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 0;
    const pb = Number.isFinite(b.priority) ? b.priority : 0;
    if (pb !== pa) return pb - pa;
    const ma = a.type === 'maintenance' ? 1 : 0;
    const mb = b.type === 'maintenance' ? 1 : 0;
    return mb - ma;
  });
  return eligible[0];
}

/** Record an impression; trims history to the last 50 timestamps. */
function recordImpression(record, now) {
  const r = (record && Array.isArray(record.impressions)) ? record : { impressions: [] };
  r.impressions = r.impressions.concat([now]).slice(-50);
  return r;
}

module.exports = { withinWindow, capAllows, pickMessage, recordImpression };
