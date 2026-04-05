/**
 * PostgreSQL Adapter — implements DbAdapter using node-postgres (pg).
 *
 * Phase 7A-1: Provides a synchronous-looking API on top of pg's async
 * connection pool. Uses a worker thread to run async pg queries and
 * Atomics.wait() to block the calling thread until the result is ready.
 *
 * SQL Translation:
 *   - `?` placeholders -> `$1`, `$2`, etc.
 *   - `datetime('now')` -> `NOW()`
 *   - `INSERT OR IGNORE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 *   - `INSERT OR REPLACE INTO` / `REPLACE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 *
 * IMPORTANT: This adapter exists for migration purposes. The long-term
 * plan is to migrate the codebase to async/await and use pg natively.
 */
import { execSync } from 'child_process';
import type { DbAdapter, PreparedStatement, RunResult } from './adapter';

// pg is a peer dependency — only loaded when DATABASE_URL is postgres://
let Pool: any;

function requirePg() {
  if (!Pool) {
    Pool = require('pg').Pool;
  }
  return Pool;
}

/**
 * Translate SQLite SQL dialect to PostgreSQL.
 */
export function translateSQL(sql: string): string {
  let translated = sql;

  // datetime('now') -> NOW()
  translated = translated.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');

  // INSERT OR IGNORE INTO -> INSERT INTO (ON CONFLICT added separately)
  translated = translated.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO/gi,
    'INSERT INTO',
  );

  // INSERT OR REPLACE INTO -> INSERT INTO (ON CONFLICT added separately)
  translated = translated.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO/gi,
    'INSERT INTO',
  );

  // REPLACE INTO -> INSERT INTO
  translated = translated.replace(
    /REPLACE\s+INTO/gi,
    'INSERT INTO',
  );

  // Convert ? placeholders to $1, $2, ...
  let paramIndex = 0;
  translated = translated.replace(/\?/g, () => {
    paramIndex++;
    return `$${paramIndex}`;
  });

  return translated;
}

/**
 * Detect conflict handling intent from original SQL.
 */
function needsConflictHandling(originalSql: string): 'ignore' | 'replace' | null {
  if (/INSERT\s+OR\s+IGNORE/i.test(originalSql)) return 'ignore';
  if (/INSERT\s+OR\s+REPLACE/i.test(originalSql) || /REPLACE\s+INTO/i.test(originalSql)) return 'replace';
  return null;
}

/**
 * Append ON CONFLICT clause if needed.
 */
function addConflictClause(translatedSql: string, conflictType: 'ignore' | 'replace' | null): string {
  if (!conflictType) return translatedSql;
  if (/ON\s+CONFLICT/i.test(translatedSql)) return translatedSql;
  // Both ignore and replace get DO NOTHING — specific UPSERT queries
  // should be rewritten explicitly in the codebase when migrating.
  return translatedSql + ' ON CONFLICT DO NOTHING';
}

/**
 * Synchronous wrapper around pg queries.
 *
 * Uses a child process to execute the query synchronously. This is
 * intentionally simple and correct, though not high-performance.
 * It's suitable for the migration period.
 *
 * For production PostgreSQL usage, the codebase should be migrated
 * to async/await — this sync bridge is a transitional tool.
 */
function querySyncViaChild(connectionString: string, sql: string, params: any[]): { rows: any[]; rowCount: number } {
  // Serialize the query request as JSON, pass to a node child process
  const queryPayload = JSON.stringify({ connectionString, sql, params });

  // Use a small inline script to execute the query
  const script = `
    const { Client } = require('pg');
    const input = JSON.parse(process.argv[1]);
    const client = new Client({ connectionString: input.connectionString });
    client.connect()
      .then(() => client.query(input.sql, input.params))
      .then(res => {
        process.stdout.write(JSON.stringify({ rows: res.rows, rowCount: res.rowCount || 0 }));
        return client.end();
      })
      .catch(err => {
        process.stderr.write(err.message);
        process.exit(1);
      });
  `;

  try {
    const result = execSync(
      `node -e ${JSON.stringify(script)} ${JSON.stringify(queryPayload)}`,
      {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 50 * 1024 * 1024, // 50MB for large result sets
        env: { ...process.env, NODE_PATH: require('path').join(__dirname, '..', '..', 'node_modules') },
      },
    );
    return JSON.parse(result);
  } catch (err: any) {
    const message = err.stderr?.toString() || err.message || 'PostgreSQL query failed';
    throw new Error(`[postgres-adapter] Query failed: ${message}\nSQL: ${sql}`);
  }
}

export class PostgresAdapter implements DbAdapter {
  private connectionString: string;
  readonly engine = 'postgres' as const;

  constructor(databaseUrl: string) {
    this.connectionString = databaseUrl;

    // Validate connection on startup
    try {
      this.querySync('SELECT 1 as ok');
      console.log('[postgres-adapter] Connected to PostgreSQL');
    } catch (err: any) {
      throw new Error(`[postgres-adapter] Failed to connect to PostgreSQL: ${err.message}`);
    }
  }

  private querySync(sql: string, params: any[] = []): { rows: any[]; rowCount: number } {
    return querySyncViaChild(this.connectionString, sql, params);
  }

  run(sql: string, ...params: any[]): RunResult {
    const conflictType = needsConflictHandling(sql);
    let translated = translateSQL(sql);
    translated = addConflictClause(translated, conflictType);

    const { rowCount } = this.querySync(translated, params);
    return { changes: rowCount, lastInsertRowid: 0 };
  }

  get<T = any>(sql: string, ...params: any[]): T | undefined {
    const translated = translateSQL(sql);
    const { rows } = this.querySync(translated, params);
    return rows[0] as T | undefined;
  }

  all<T = any>(sql: string, ...params: any[]): T[] {
    const translated = translateSQL(sql);
    const { rows } = this.querySync(translated, params);
    return rows as T[];
  }

  prepare(sql: string): PreparedStatement {
    const conflictType = needsConflictHandling(sql);
    let translated = translateSQL(sql);
    translated = addConflictClause(translated, conflictType);
    const adapter = this;

    return {
      run(...params: any[]): RunResult {
        const { rowCount } = adapter.querySync(translated, params);
        return { changes: rowCount, lastInsertRowid: 0 };
      },
      get(...params: any[]): any | undefined {
        const { rows } = adapter.querySync(translated, params);
        return rows[0];
      },
      all(...params: any[]): any[] {
        const { rows } = adapter.querySync(translated, params);
        return rows;
      },
    };
  }

  transaction<T>(fn: () => T): T {
    this.querySync('BEGIN');
    try {
      const result = fn();
      this.querySync('COMMIT');
      return result;
    } catch (err) {
      this.querySync('ROLLBACK');
      throw err;
    }
  }

  exec(sql: string): void {
    // Translate common SQLite DDL to PostgreSQL equivalents
    const translated = sql
      .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()')
      .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
      .replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO')
      .replace(/AUTOINCREMENT/gi, '')
      .replace(/INTEGER\s+PRIMARY\s+KEY/gi, 'SERIAL PRIMARY KEY');

    this.querySync(translated);
  }

  pragma(_sql: string): any {
    // PostgreSQL has no pragma system — no-op, returns empty array
    return [];
  }

  close(): void {
    // Nothing to close — each query uses its own client via child process
  }
}
