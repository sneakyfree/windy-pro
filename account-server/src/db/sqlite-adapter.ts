/**
 * SQLite Adapter — wraps better-sqlite3 in the DbAdapter interface.
 *
 * Phase 7A-1: This is a thin wrapper. All existing SQLite behavior
 * is preserved exactly. The adapter just forwards calls to better-sqlite3.
 */
import Database from 'better-sqlite3';
import type { DbAdapter, PreparedStatement, RunResult } from './adapter';

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
