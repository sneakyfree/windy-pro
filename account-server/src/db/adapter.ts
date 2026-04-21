/**
 * Database Adapter Interface — abstraction layer for SQLite / PostgreSQL.
 *
 * Phase 7A-1: All database consumers use this interface. The concrete
 * implementation is selected at startup based on DATABASE_URL.
 *
 * When DATABASE_URL starts with "postgres://", PostgreSQL is used.
 * Otherwise, SQLite (better-sqlite3) at DB_PATH is used — preserving
 * all existing behavior as the zero-config default.
 */

/**
 * Represents a prepared statement that can be executed multiple times
 * with different parameters.
 */
export interface PreparedStatement {
  run(...params: any[]): RunResult;
  get(...params: any[]): any | undefined;
  all(...params: any[]): any[];
}

/**
 * Result of a write operation (INSERT, UPDATE, DELETE).
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Transaction context passed to transactionAsync's callback. Exposes
 * run/get/all pinned to the same pool connection so the queries
 * actually execute inside the BEGIN/COMMIT block.
 */
export interface AsyncTxContext {
  run(sql: string, ...params: any[]): Promise<RunResult>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
}

/**
 * Database adapter interface. Both SQLite and PostgreSQL adapters
 * implement this, making the rest of the codebase database-agnostic.
 *
 * Two interfaces exist in parallel during the async migration:
 * - Sync methods (run/get/all/prepare/transaction) — backed by
 *   better-sqlite3 directly on SQLite, and by an execFileSync
 *   subprocess on Postgres. The subprocess path blocks the main
 *   event loop and serializes concurrent requests; hot-path code
 *   should prefer the *Async variants below.
 * - Async methods (runAsync/getAsync/allAsync/transactionAsync) —
 *   backed by a pooled `pg.Pool` on Postgres (non-blocking) and
 *   by Promise.resolve-wrapped sync calls on SQLite. Migrated
 *   route-by-route; see fix/postgres-adapter-pg-pool.
 */
export interface DbAdapter {
  /** Execute a write query (INSERT, UPDATE, DELETE). */
  run(sql: string, ...params: any[]): RunResult;

  /** Execute a read query, return first row or undefined. */
  get<T = any>(sql: string, ...params: any[]): T | undefined;

  /** Execute a read query, return all rows. */
  all<T = any>(sql: string, ...params: any[]): T[];

  /** Async, pool-backed write. Does not block the event loop on Postgres. */
  runAsync(sql: string, ...params: any[]): Promise<RunResult>;

  /** Async, pool-backed single-row read. Does not block the event loop on Postgres. */
  getAsync<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;

  /** Async, pool-backed multi-row read. Does not block the event loop on Postgres. */
  allAsync<T = any>(sql: string, ...params: any[]): Promise<T[]>;

  /** Create a prepared statement for repeated execution. */
  prepare(sql: string): PreparedStatement;

  /** Execute a function inside a transaction (sync). */
  transaction<T>(fn: () => T): T;

  /**
   * Execute an async function inside a real transaction. The queries
   * run through the ctx argument share one pooled connection and are
   * committed or rolled back atomically.
   */
  transactionAsync<T>(fn: (ctx: AsyncTxContext) => Promise<T>): Promise<T>;

  /** Execute raw SQL (DDL, multi-statement scripts). */
  exec(sql: string): void;

  /** Execute a pragma (SQLite-specific, no-op on PostgreSQL). */
  pragma(sql: string): any;

  /** Close the database connection / pool (sync fire-and-forget). */
  close(): void;

  /** Close the database connection / pool and wait for in-flight queries. */
  shutdownAsync(): Promise<void>;

  /** The underlying engine: 'sqlite' or 'postgres'. */
  readonly engine: 'sqlite' | 'postgres';
}
