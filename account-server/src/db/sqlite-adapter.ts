/**
 * SQLite Adapter — wraps better-sqlite3 in the DbAdapter interface.
 *
 * Phase 7A-1: This is a thin wrapper. All existing SQLite behavior
 * is preserved exactly. The adapter just forwards calls to better-sqlite3.
 */
import Database from 'better-sqlite3';
import type { AsyncTxContext, DbAdapter, PreparedStatement, RunResult } from './adapter';

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;
  readonly engine = 'sqlite' as const;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  run(sql: string, ...params: any[]): RunResult {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get<T = any>(sql: string, ...params: any[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = any>(sql: string, ...params: any[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]): RunResult => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: any[]): any | undefined => {
        return stmt.get(...params);
      },
      all: (...params: any[]): any[] => {
        return stmt.all(...params);
      },
    };
  }

  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }

  // ── Async surface ────────────────────────────────────────────────────
  // better-sqlite3 is synchronous; the Async variants exist to match the
  // DbAdapter interface used by hot-path code that awaits. Wrapping in
  // Promise.resolve preserves existing behavior exactly (same errors, same
  // return shapes) — it just yields a microtask between each call.

  async runAsync(sql: string, ...params: any[]): Promise<RunResult> {
    return this.run(sql, ...params);
  }

  async getAsync<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    return this.get<T>(sql, ...params);
  }

  async allAsync<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    return this.all<T>(sql, ...params);
  }

  async transactionAsync<T>(fn: (ctx: AsyncTxContext) => Promise<T>): Promise<T> {
    // SQLite's better-sqlite3 transactions are sync, so we can't run an
    // async callback inside the native transaction wrapper. Instead we
    // issue BEGIN / COMMIT / ROLLBACK manually and expose a ctx that
    // delegates to the sync methods. For a single-writer SQLite DB this
    // is equivalent to the native wrapper.
    this.db.exec('BEGIN');
    try {
      const ctx: AsyncTxContext = {
        run: async (sql: string, ...params: any[]): Promise<RunResult> => this.run(sql, ...params),
        get: async <R = any>(sql: string, ...params: any[]): Promise<R | undefined> => this.get<R>(sql, ...params),
        all: async <R = any>(sql: string, ...params: any[]): Promise<R[]> => this.all<R>(sql, ...params),
      };
      const result = await fn(ctx);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* rollback best-effort */ }
      throw err;
    }
  }

  async shutdownAsync(): Promise<void> {
    this.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string): any {
    return this.db.pragma(sql);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Expose the underlying better-sqlite3 instance for SQLite-specific
   * operations (backup, WAL checkpoint, etc.). Only available when
   * engine === 'sqlite'.
   */
  get raw(): Database.Database {
    return this.db;
  }
}
