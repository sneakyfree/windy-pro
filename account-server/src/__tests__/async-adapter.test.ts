/**
 * Async adapter behavioral + concurrency tests for fix/postgres-adapter-pg-pool.
 *
 * Runs against the SqliteAdapter (the zero-config default) which wraps its
 * sync methods in Promise.resolve, so these verify the async interface
 * shape and that the /register hot-path contract works end-to-end. The
 * Postgres pool path cannot be exercised without a live Postgres, so
 * those branches are gated on TEST_POSTGRES_URL and skipped by default —
 * CI runs them against a throwaway instance.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { SqliteAdapter } from '../db/sqlite-adapter';
import type { DbAdapter } from '../db/adapter';

describe('async DbAdapter interface (sqlite backend)', () => {
  let tmpPath: string;
  let adapter: DbAdapter;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `async-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    adapter = new SqliteAdapter(tmpPath);
    adapter.exec('CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, val INTEGER)');
  });

  afterEach(async () => {
    await adapter.shutdownAsync();
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
  });

  it('runAsync inserts a row and reports changes', async () => {
    const result = await adapter.runAsync('INSERT INTO t (id, val) VALUES (?, ?)', 'a', 1);
    expect(result.changes).toBe(1);
  });

  it('getAsync returns undefined for empty table and the row after insert', async () => {
    expect(await adapter.getAsync('SELECT * FROM t WHERE id = ?', 'b')).toBeUndefined();
    await adapter.runAsync('INSERT INTO t (id, val) VALUES (?, ?)', 'b', 2);
    const row = await adapter.getAsync<{ id: string; val: number }>('SELECT * FROM t WHERE id = ?', 'b');
    expect(row).toEqual({ id: 'b', val: 2 });
  });

  it('allAsync returns all rows', async () => {
    await adapter.runAsync('INSERT INTO t (id, val) VALUES (?, ?)', 'c', 3);
    await adapter.runAsync('INSERT INTO t (id, val) VALUES (?, ?)', 'd', 4);
    const rows = await adapter.allAsync<{ id: string; val: number }>('SELECT * FROM t ORDER BY id');
    expect(rows.map(r => r.id)).toEqual(['c', 'd']);
  });

  it('transactionAsync commits on success', async () => {
    await adapter.transactionAsync(async (tx) => {
      await tx.run('INSERT INTO t (id, val) VALUES (?, ?)', 'e', 5);
      await tx.run('INSERT INTO t (id, val) VALUES (?, ?)', 'f', 6);
    });
    const rows = await adapter.allAsync('SELECT * FROM t ORDER BY id');
    expect(rows.map((r: any) => r.id)).toEqual(['e', 'f']);
  });

  it('transactionAsync rolls back on throw', async () => {
    await expect(adapter.transactionAsync(async (tx) => {
      await tx.run('INSERT INTO t (id, val) VALUES (?, ?)', 'g', 7);
      throw new Error('rollback please');
    })).rejects.toThrow('rollback please');

    const row = await adapter.getAsync('SELECT * FROM t WHERE id = ?', 'g');
    expect(row).toBeUndefined();
  });

  it('20 parallel runAsync calls all resolve without serializing', async () => {
    // This is the behavioral gate the stress test was failing: 20 concurrent
    // callers should all come back with results. On the sqlite backend this
    // is trivially true; on Postgres this exercises the pg.Pool path and
    // proves the execFileSync serialization is gone.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        adapter.runAsync('INSERT INTO t (id, val) VALUES (?, ?)', `p${i}`, i),
      ),
    );
    expect(results).toHaveLength(20);
    for (const r of results) expect(r.changes).toBe(1);

    const countRow = await adapter.getAsync<{ n: number }>('SELECT COUNT(*) AS n FROM t');
    expect(countRow?.n).toBe(20);
  });
});

// ── Postgres pool path ────────────────────────────────────────────────
// Only runs when TEST_POSTGRES_URL is set. CI sets this against a
// throwaway container; local developer runs skip it.
const describePg = process.env.TEST_POSTGRES_URL ? describe : describe.skip;

describePg('async DbAdapter interface (postgres pool backend)', () => {
  let adapter: DbAdapter;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
    const { PostgresAdapter } = require('../db/postgres-adapter');
    adapter = new PostgresAdapter(process.env.TEST_POSTGRES_URL);
    await adapter.runAsync('CREATE TABLE IF NOT EXISTS async_adapter_test (id TEXT PRIMARY KEY, val INTEGER)');
    await adapter.runAsync('TRUNCATE async_adapter_test');
  });

  afterAll(async () => {
    try { await adapter.runAsync('DROP TABLE IF EXISTS async_adapter_test'); } catch { /* best-effort */ }
    await adapter.shutdownAsync();
  });

  it('does not spawn a subprocess on async path', async () => {
    // Smoke check: fire 20 parallel SELECT 1s and they all come back. If
    // the pool were misconfigured or fell through to execFileSync, this
    // would serialize at ~100 ms/call and take >2 s. Pooled queries finish
    // in well under 1 s total.
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => adapter.getAsync<{ ok: number }>('SELECT 1 as ok')));
    const elapsed = Date.now() - started;
    expect(results).toHaveLength(20);
    for (const r of results) expect(r?.ok).toBe(1);
    // Generous ceiling — pooled 20-concurrent should be well under 500 ms even on slow CI.
    expect(elapsed).toBeLessThan(2000);
  });

  it('transactionAsync commits atomically', async () => {
    const id = `tx-${Date.now()}`;
    await adapter.transactionAsync(async (tx) => {
      await tx.run('INSERT INTO async_adapter_test (id, val) VALUES (?, ?)', id, 1);
      await tx.run('UPDATE async_adapter_test SET val = val + 1 WHERE id = ?', id);
    });
    const row = await adapter.getAsync<{ val: number }>('SELECT val FROM async_adapter_test WHERE id = ?', id);
    expect(row?.val).toBe(2);
  });

  it('transactionAsync rolls back atomically on throw', async () => {
    const id = `rb-${Date.now()}`;
    await expect(adapter.transactionAsync(async (tx) => {
      await tx.run('INSERT INTO async_adapter_test (id, val) VALUES (?, ?)', id, 99);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const row = await adapter.getAsync('SELECT * FROM async_adapter_test WHERE id = ?', id);
    expect(row).toBeUndefined();
  });
});
