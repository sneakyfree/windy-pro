/**
 * P1-10 — webhook_deliveries cleanup job.
 *
 * The fan-out bus writes one row per (event, target) and KEEPS delivered
 * and dead-lettered rows forever for audit. At steady-state that's fine,
 * but over months of production traffic the table grows unbounded. This
 * job prunes terminal rows past their retention window (30d delivered,
 * 90d dead-lettered) while leaving in-flight rows alone so the retry
 * worker keeps owning them.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { getDb } from '../src/db/schema';
import {
  pruneWebhookDeliveries,
  DEFAULT_DELIVERED_RETENTION_DAYS,
  DEFAULT_DEAD_RETENTION_DAYS,
} from '../src/services/webhook-bus';

jest.setTimeout(15000);

function insertRow(opts: {
  id?: string;
  delivered_at?: string | null;
  dead_lettered_at?: string | null;
  next_attempt_at?: string;
  identity_id?: string | null;
}) {
  const id = opts.id ?? uuidv4();
  getDb().prepare(
    `INSERT INTO webhook_deliveries
       (id, event_type, target, target_url, payload, signature,
        attempts, next_attempt_at, delivered_at, dead_lettered_at, identity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'identity.created',
    'test',
    'http://example.test/webhook',
    '{}',
    'sha256=deadbeef',
    1,
    opts.next_attempt_at ?? new Date().toISOString(),
    opts.delivered_at ?? null,
    opts.dead_lettered_at ?? null,
    opts.identity_id ?? null,
  );
  return id;
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('P1-10 pruneWebhookDeliveries', () => {
  it('deletes delivered rows older than the retention window', async () => {
    const oldId = insertRow({ delivered_at: iso(DEFAULT_DELIVERED_RETENTION_DAYS + 1) });
    const freshId = insertRow({ delivered_at: iso(1) });

    const r = pruneWebhookDeliveries();

    expect(r.deliveredPurged).toBeGreaterThanOrEqual(1);
    const oldRow = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(oldId);
    const freshRow = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(freshId);
    expect(oldRow).toBeUndefined();
    expect(freshRow).toBeDefined();
  });

  it('deletes dead-lettered rows older than the (longer) dead retention window', async () => {
    const oldDead = insertRow({ dead_lettered_at: iso(DEFAULT_DEAD_RETENTION_DAYS + 1) });
    const freshDead = insertRow({ dead_lettered_at: iso(10) });

    const r = pruneWebhookDeliveries();

    expect(r.deadPurged).toBeGreaterThanOrEqual(1);
    const oldRow = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(oldDead);
    const freshRow = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(freshDead);
    expect(oldRow).toBeUndefined();
    expect(freshRow).toBeDefined();
  });

  it('leaves in-flight rows (not delivered, not dead) alone regardless of age', async () => {
    // Ancient row that somehow never completed — the retry worker, not the
    // cleaner, owns this. Cleaner must not touch it.
    const inflightId = insertRow({
      delivered_at: null,
      dead_lettered_at: null,
      next_attempt_at: iso(365), // "scheduled" a year ago, still pending
    });

    pruneWebhookDeliveries();

    const row = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(inflightId);
    expect(row).toBeDefined();
  });

  it('honors custom retention windows', async () => {
    const id = insertRow({ delivered_at: iso(5) }); // 5 days old
    const r = pruneWebhookDeliveries({ deliveredOlderThanDays: 1 });
    expect(r.deliveredPurged).toBeGreaterThanOrEqual(1);
    const row = getDb().prepare('SELECT id FROM webhook_deliveries WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('source invariant: server.ts starts the cleanup timer alongside the worker', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'server.ts'),
      'utf-8',
    );
    expect(src).toMatch(/startWebhookCleanup\(\)/);
  });
});
