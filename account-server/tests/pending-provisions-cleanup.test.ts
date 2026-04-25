/**
 * P2-6 — pending_provisions cleanup.
 *
 * The retry worker deletes rows on success, but two terminal classes
 * accumulate forever without a cleaner:
 *   1. attempts >= 10 (retry budget exhausted; worker's WHERE clause
 *      stops touching them)
 *   2. any row older than the safety-net retention window (e.g. action
 *      enum drift leaves a row unmatchable)
 *
 * Cleaner must NOT touch rows that are still in the retry window —
 * the worker owns those.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { getDb } from '../src/db/schema';
import {
  prunePendingProvisions,
  DEFAULT_EXHAUSTED_RETENTION_DAYS,
  DEFAULT_ORPHAN_RETENTION_DAYS,
} from '../src/services/ecosystem-provisioner';

jest.setTimeout(15000);

// pending_provisions has a FK to users(id). Seed a user per test
// insert so the FK doesn't reject.
function insertUser(): string {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO users (id, email, name, password_hash, tier)
     VALUES (?, ?, ?, ?, 'free')`,
  ).run(id, `pp-${id}@example.com`, 'PP Test', 'bcrypt-stub');
  return id;
}

function insertRow(opts: {
  identity_id?: string;
  attempts?: number;
  created_at?: string; // ISO string or SQL datetime literal
}) {
  const id = uuidv4();
  const identityId = opts.identity_id ?? insertUser();
  getDb().prepare(
    `INSERT INTO pending_provisions (id, identity_id, product, action, payload, attempts, created_at, next_retry_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    id,
    identityId,
    'windy_mail',
    'provision_user',
    JSON.stringify({ email: 'x@y.com' }),
    opts.attempts ?? 0,
    opts.created_at ?? new Date().toISOString(),
  );
  return id;
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('P2-6 prunePendingProvisions', () => {
  it('deletes attempts >= 10 rows older than retention', async () => {
    const oldId = insertRow({
      attempts: 10,
      created_at: iso(DEFAULT_EXHAUSTED_RETENTION_DAYS + 1),
    });
    const freshId = insertRow({ attempts: 10, created_at: iso(1) });

    const r = prunePendingProvisions();

    expect(r.exhaustedPurged).toBeGreaterThanOrEqual(1);
    const oldRow = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(oldId);
    const freshRow = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(freshId);
    expect(oldRow).toBeUndefined();
    expect(freshRow).toBeDefined();
  });

  it('deletes orphan rows older than the (longer) orphan retention', async () => {
    const veryOldId = insertRow({
      attempts: 0,
      created_at: iso(DEFAULT_ORPHAN_RETENTION_DAYS + 1),
    });
    const freshRecent = insertRow({ attempts: 0, created_at: iso(10) });

    const r = prunePendingProvisions();

    expect(r.orphanPurged).toBeGreaterThanOrEqual(1);
    const oldRow = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(veryOldId);
    const recentRow = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(freshRecent);
    expect(oldRow).toBeUndefined();
    expect(recentRow).toBeDefined();
  });

  it('leaves active (<10 attempts, within retention) rows alone', async () => {
    const activeId = insertRow({ attempts: 3, created_at: iso(1) });

    prunePendingProvisions();

    const row = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(activeId);
    expect(row).toBeDefined();
  });

  it('honors custom retention windows', async () => {
    const id = insertRow({ attempts: 10, created_at: iso(5) });
    const r = prunePendingProvisions({ exhaustedOlderThanDays: 1 });
    expect(r.exhaustedPurged).toBeGreaterThanOrEqual(1);
    const row = getDb().prepare('SELECT id FROM pending_provisions WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('source invariant: server.ts starts the pending cleanup timer', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'server.ts'),
      'utf-8',
    );
    expect(src).toMatch(/startPendingCleanup\(\)/);
  });
});
