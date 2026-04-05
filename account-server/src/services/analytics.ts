/**
 * Lightweight analytics — logs events to SQLite/PG table.
 * No third-party service. Queryable via admin API.
 */
import crypto from 'crypto';
import { getDb } from '../db/schema';

/**
 * Track an analytics event. Non-blocking — never throws.
 */
export function trackEvent(
  event: string,
  userId?: string,
  properties?: Record<string, any>,
): void {
  if (!event) return;

  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const propsJson = properties ? JSON.stringify(properties) : null;
    db.prepare(
      'INSERT INTO analytics_events (id, event, user_id, properties) VALUES (?, ?, ?, ?)',
    ).run(id, event, userId || null, propsJson);
  } catch {
    // Non-blocking — swallow errors silently
  }
}
