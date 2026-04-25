/**
 * PostgreSQL Adapter — implements DbAdapter using node-postgres (pg).
 *
 * This adapter exposes both interfaces during the migration:
 *
 * 1. **Sync path (legacy).** Spawns a `node -e` subprocess per query,
 *    blocking the main JS thread via `execFileSync`. Preserved so call
 *    sites outside the hot path continue to work without a full sweep.
 *    Every call costs a TCP+TLS+pg-auth round-trip and a node startup,
 *    so it is unfit for concurrency and serializes through one worker.
 *
 * 2. **Async path (preferred).** Backed by a process-wide `pg.Pool` with
 *    `runAsync` / `getAsync` / `allAsync` / `transactionAsync`. Non-
 *    blocking; 20 concurrent callers share up to `PG_POOL_MAX` (default 10)
 *    pooled connections. The `/register` handler is the first caller to
 *    migrate; follow-up PRs migrate the remaining routes one family at a
 *    time (see fix/postgres-adapter-pg-pool PR description).
 *
 * SQL Translation (applies to both paths):
 *   - `?` placeholders -> `$1`, `$2`, etc.
 *   - `datetime('now')` -> `NOW()`
 *   - `INSERT OR IGNORE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 *   - `INSERT OR REPLACE INTO` / `REPLACE INTO` -> `INSERT INTO ... ON CONFLICT DO NOTHING`
 */
import { execFileSync } from 'child_process';
import type { AsyncTxContext, DbAdapter, PreparedStatement, RunResult } from './adapter';

// pg is a peer dependency — only loaded when DATABASE_URL is postgres://
let PgPool: any;

function requirePg() {
  if (!PgPool) {
    PgPool = require('pg').Pool;
  }
  return PgPool;
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
    // Wave 13 prod fix — use execFileSync instead of execSync so the
    // multi-line `script` passes through argv directly without shell
    // parsing. The previous `execSync(\`node -e ${JSON.stringify(script)}\`)`
    // pipeline relied on the shell to unescape \n inside double-quoted
    // JSON strings, which it does NOT — the script arrived at node -e
    // with literal "\n" char-pairs and failed with
    //   SyntaxError: Invalid or unexpected token / Expected unicode escape
    const result = execFileSync(
      'node',
      ['-e', script, queryPayload],
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
  private pool: any = null;
  readonly engine = 'postgres' as const;

  constructor(databaseUrl: string) {
    this.connectionString = databaseUrl;

    // Validate connection on startup (via the sync path — cheap one-shot)
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

  /**
   * Lazily initialise the shared pg.Pool. Pool size, idle timeout, and
   * connect timeout are env-tunable without redeploy: PG_POOL_MAX (default
   * 10), PG_POOL_IDLE_MS (default 10000), PG_POOL_CONNECT_MS (default 2000).
   */
  private getPool(): any {
    if (!this.pool) {
      const Pool = requirePg();
      const max = parseInt(process.env.PG_POOL_MAX || '10', 10);
      const idleTimeoutMillis = parseInt(process.env.PG_POOL_IDLE_MS || '10000', 10);
      const connectionTimeoutMillis = parseInt(process.env.PG_POOL_CONNECT_MS || '2000', 10);
      this.pool = new Pool({
        connectionString: this.connectionString,
        max,
        idleTimeoutMillis,
        connectionTimeoutMillis,
      });
      // Surface pool errors that happen outside a query (e.g. idle-client
      // disconnects). Without this, pg emits 'unhandled error' and the
      // process dies.
      this.pool.on('error', (err: any) => {
        console.error('[postgres-adapter] pool idle-client error:', err?.message || err);
      });
      console.log(`[postgres-adapter] Pool initialised (max=${max}, idleMs=${idleTimeoutMillis}, connectMs=${connectionTimeoutMillis})`);
    }
    return this.pool;
  }

  /** Translate SQL, query the pool, normalize errors. */
  private async queryAsync(sql: string, params: any[], handleConflict: boolean): Promise<{ rows: any[]; rowCount: number }> {
    const conflictType = handleConflict ? needsConflictHandling(sql) : null;
    let translated = translateSQL(sql);
    if (conflictType) translated = addConflictClause(translated, conflictType);
    try {
      const res = await this.getPool().query(translated, params);
      return { rows: res.rows, rowCount: res.rowCount || 0 };
    } catch (err: any) {
      // Preserve the pg error's original message (call sites regex-match
      // on it for e.g. unique_violation handling). Decorate with the SQL
      // for debugging without losing the original `.message` / `.code`.
      if (err && typeof err === 'object') {
        (err as any).query = translated;
      }
      throw err;
    }
  }

  async runAsync(sql: string, ...params: any[]): Promise<RunResult> {
    const { rowCount } = await this.queryAsync(sql, params, /*handleConflict*/ true);
    return { changes: rowCount, lastInsertRowid: 0 };
  }

  async getAsync<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    const { rows } = await this.queryAsync(sql, params, /*handleConflict*/ false);
    return rows[0] as T | undefined;
  }

  async allAsync<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    const { rows } = await this.queryAsync(sql, params, /*handleConflict*/ false);
    return rows as T[];
  }

  /**
   * Real atomic transaction. Pulls ONE client out of the pool, runs
   * BEGIN + caller queries + COMMIT through it, then releases. Rolls
   * back on any throw inside fn. Queries MUST be issued through the
   * ctx argument — using the parent adapter inside fn would hit a
   * different pooled connection and break atomicity.
   */
  async transactionAsync<T>(fn: (ctx: AsyncTxContext) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ctx: AsyncTxContext = {
        run: async (sql: string, ...params: any[]): Promise<RunResult> => {
          const conflictType = needsConflictHandling(sql);
          let translated = translateSQL(sql);
          translated = addConflictClause(translated, conflictType);
          const res = await client.query(translated, params);
          return { changes: res.rowCount || 0, lastInsertRowid: 0 };
        },
        get: async <R = any>(sql: string, ...params: any[]): Promise<R | undefined> => {
          const translated = translateSQL(sql);
          const res = await client.query(translated, params);
          return res.rows[0] as R | undefined;
        },
        all: async <R = any>(sql: string, ...params: any[]): Promise<R[]> => {
          const translated = translateSQL(sql);
          const res = await client.query(translated, params);
          return res.rows as R[];
        },
      };
      const result = await fn(ctx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* rollback best-effort */ }
      throw err;
    } finally {
      client.release();
    }
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
    // Subprocess path has nothing to close. For the pool, fire-and-forget
    // pool.end() so process.exit() isn't blocked waiting. Use shutdownAsync
    // from a SIGTERM handler for a clean drain.
    if (this.pool) {
      const pending = this.pool;
      this.pool = null;
      pending.end().catch(() => { /* exiting anyway */ });
    }
  }

  /**
   * Graceful pool shutdown — awaits in-flight queries, releases every
   * client, then resolves. Wire this to SIGTERM so the container can
   * restart without killing mid-flight registrations.
   */
  async shutdownAsync(): Promise<void> {
    if (this.pool) {
      const pending = this.pool;
      this.pool = null;
      await pending.end();
    }
  }
}
