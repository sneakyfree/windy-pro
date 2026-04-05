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
 * Database adapter interface. Both SQLite and PostgreSQL adapters
 * implement this, making the rest of the codebase database-agnostic.
 */
export interface DbAdapter {
  /** Execute a write query (INSERT, UPDATE, DELETE). */
  run(sql: string, ...params: any[]): RunResult;

  /** Execute a read query, return first row or undefined. */
  get<T = any>(sql: string, ...params: any[]): T | undefined;

  /** Execute a read query, return all rows. */
  all<T = any>(sql: string, ...params: any[]): T[];

  /** Create a prepared statement for repeated execution. */
  prepare(sql: string): PreparedStatement;

  /** Execute a function inside a transaction. */
  transaction<T>(fn: () => T): T;

  /** Execute raw SQL (DDL, multi-statement scripts). */
  exec(sql: string): void;

  /** Execute a pragma (SQLite-specific, no-op on PostgreSQL). */
  pragma(sql: string): any;

  /** Close the database connection / pool. */
  close(): void;

  /** The underlying engine: 'sqlite' or 'postgres'. */
  readonly engine: 'sqlite' | 'postgres';
}
