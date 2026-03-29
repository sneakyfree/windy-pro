#!/usr/bin/env tsx
/**
 * SQLite → PostgreSQL Migration Script
 *
 * Phase 7A-3: Reads all data from the SQLite database, creates the
 * PostgreSQL schema, and inserts all rows in batches.
 *
 * Usage:
 *   DATABASE_URL=postgres://windy:pass@localhost:5432/windy_pro \
 *   DB_PATH=./accounts.db \
 *   npx tsx scripts/migrate-to-postgres.ts
 *
 * Options:
 *   --dry-run    Show what would be migrated without writing to PostgreSQL
 *   --verify     Only verify row counts (assumes migration already done)
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'accounts.db');
const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('Example: DATABASE_URL=postgres://windy:password@localhost:5432/windy_pro');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`ERROR: SQLite database not found at ${DB_PATH}`);
  console.error('Set DB_PATH to your accounts.db file.');
  process.exit(1);
}

// All tables to migrate, in dependency order (parents before children)
const TABLES = [
  'users',
  'devices',
  'refresh_tokens',
  'translations',
  'favorites',
  'recordings',
  'sync_queue',
  'files',
  'transactions',
  'coupons',
  'token_blacklist',
  'product_accounts',
  'identity_scopes',
  'identity_audit_log',
  'eternitas_passports',
  'bot_api_keys',
  'secretary_consents',
  'oauth_clients',
  'oauth_codes',
  'oauth_consents',
  'oauth_device_codes',
  'chat_profiles',
];

// Columns that are INTEGER booleans in SQLite but BOOLEAN in PostgreSQL
const BOOLEAN_COLUMNS: Record<string, string[]> = {
  users: ['frozen', 'email_verified', 'phone_verified'],
  recordings: ['media_audio', 'media_video', 'synced', 'clone_usable', 'clone_training_ready', 'has_video'],
  coupons: ['active'],
  secretary_consents: ['active'],
  oauth_clients: ['is_first_party', 'is_public'],
  oauth_codes: ['used'],
  chat_profiles: ['onboarding_complete'],
};

// Columns that are TEXT JSON in SQLite but JSONB in PostgreSQL
const JSONB_COLUMNS: Record<string, string[]> = {
  recordings: ['transcript_segments', 'quality_json', 'languages_json', 'tags_json'],
  files: ['metadata'],
  product_accounts: ['metadata'],
  identity_audit_log: ['details'],
  eternitas_passports: ['birth_certificate'],
  bot_api_keys: ['scopes'],
  oauth_clients: ['redirect_uris', 'allowed_scopes'],
  chat_profiles: ['languages'],
};

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' SQLite → PostgreSQL Migration');
  console.log('═══════════════════════════════════════════');
  console.log(`  SQLite:     ${DB_PATH}`);
  console.log(`  PostgreSQL: ${DATABASE_URL!.replace(/:[^@]+@/, ':***@')}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log('');

  // Open SQLite
  const sqlite = new Database(DB_PATH, { readonly: true });
  sqlite.pragma('journal_mode = WAL');

  // Connect to PostgreSQL
  const { Client } = require('pg');
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  console.log('[pg] Connected to PostgreSQL');

  if (VERIFY_ONLY) {
    await verifyRowCounts(sqlite, pg);
    await pg.end();
    sqlite.close();
    return;
  }

  // Create PostgreSQL schema
  if (!DRY_RUN) {
    console.log('\n[schema] Creating PostgreSQL schema...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'db', 'postgres-schema.sql'),
      'utf-8',
    );
    await pg.query(schemaSQL);
    console.log('[schema] Schema created successfully');
  }

  // Migrate each table
  const results: { table: string; sqliteCount: number; pgCount: number; status: string }[] = [];

  for (const table of TABLES) {
    try {
      const result = await migrateTable(sqlite, pg, table);
      results.push(result);
    } catch (err: any) {
      console.error(`[${table}] FAILED: ${err.message}`);
      results.push({ table, sqliteCount: 0, pgCount: 0, status: 'FAILED: ' + err.message });
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════');
  console.log(' Migration Summary');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log(
    'Table'.padEnd(30) +
    'SQLite'.padStart(10) +
    'PostgreSQL'.padStart(12) +
    '  Status',
  );
  console.log('─'.repeat(70));

  let allMatch = true;
  for (const r of results) {
    const match = r.sqliteCount === r.pgCount;
    if (!match) allMatch = false;
    console.log(
      r.table.padEnd(30) +
      String(r.sqliteCount).padStart(10) +
      String(r.pgCount).padStart(12) +
      `  ${r.status}`,
    );
  }

  console.log('─'.repeat(70));
  console.log(allMatch ? '\nAll tables migrated successfully.' : '\nSome tables have mismatched counts — review above.');

  await pg.end();
  sqlite.close();
}

async function migrateTable(
  sqlite: Database.Database,
  pg: any,
  table: string,
): Promise<{ table: string; sqliteCount: number; pgCount: number; status: string }> {
  // Check if table exists in SQLite
  const tableExists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table);

  if (!tableExists) {
    console.log(`[${table}] Skipping — table does not exist in SQLite`);
    return { table, sqliteCount: 0, pgCount: 0, status: 'SKIPPED (not in SQLite)' };
  }

  // Count rows
  const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any).count;

  if (sqliteCount === 0) {
    console.log(`[${table}] Empty — skipping`);
    return { table, sqliteCount: 0, pgCount: 0, status: 'OK (empty)' };
  }

  console.log(`[${table}] Migrating ${sqliteCount} rows...`);

  if (DRY_RUN) {
    return { table, sqliteCount, pgCount: 0, status: 'DRY RUN' };
  }

  // Read all rows from SQLite
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as any[];

  if (rows.length === 0) {
    return { table, sqliteCount, pgCount: 0, status: 'OK (empty)' };
  }

  // Get column names from the first row
  const columns = Object.keys(rows[0]);

  // Convert values for PostgreSQL
  const boolCols = BOOLEAN_COLUMNS[table] || [];
  const jsonbCols = JSONB_COLUMNS[table] || [];

  // Insert in batches
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Build parameterized INSERT
    const valuePlaceholders: string[] = [];
    const allParams: any[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        let value = row[col];

        // Convert INTEGER booleans to PostgreSQL booleans
        if (boolCols.includes(col)) {
          value = value === 1 || value === true ? true : value === 0 || value === false ? false : null;
        }

        // Validate JSONB columns
        if (jsonbCols.includes(col) && typeof value === 'string') {
          try {
            JSON.parse(value); // Validate it's valid JSON
          } catch {
            value = '{}'; // Fallback to empty object
          }
        }

        allParams.push(value);
        rowPlaceholders.push(`$${paramIdx++}`);
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const insertSQL = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${valuePlaceholders.join(', ')} ON CONFLICT DO NOTHING`;

    try {
      await pg.query(insertSQL, allParams);
      inserted += batch.length;
    } catch (err: any) {
      console.error(`[${table}] Batch insert error at rows ${i}-${i + batch.length}: ${err.message}`);
      // Try one-by-one for this batch
      for (const row of batch) {
        const rowParams: any[] = [];
        const rowPlaceholders: string[] = [];
        let idx = 1;
        for (const col of columns) {
          let value = row[col];
          if (boolCols.includes(col)) {
            value = value === 1 || value === true ? true : value === 0 || value === false ? false : null;
          }
          if (jsonbCols.includes(col) && typeof value === 'string') {
            try { JSON.parse(value); } catch { value = '{}'; }
          }
          rowParams.push(value);
          rowPlaceholders.push(`$${idx++}`);
        }
        const singleSQL = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${rowPlaceholders.join(', ')}) ON CONFLICT DO NOTHING`;
        try {
          await pg.query(singleSQL, rowParams);
          inserted++;
        } catch (singleErr: any) {
          console.error(`[${table}] Row insert failed (id=${row.id}): ${singleErr.message}`);
        }
      }
    }

    if (i + BATCH_SIZE < rows.length) {
      process.stdout.write(`  ${inserted}/${sqliteCount}\r`);
    }
  }

  // Verify count
  const pgCountResult = await pg.query(`SELECT COUNT(*) as count FROM ${table}`);
  const pgCount = parseInt(pgCountResult.rows[0].count, 10);

  const match = pgCount >= sqliteCount;
  const status = match ? 'OK' : `MISMATCH (expected ${sqliteCount}, got ${pgCount})`;
  console.log(`[${table}] ${status} — ${pgCount} rows`);

  return { table, sqliteCount, pgCount, status };
}

async function verifyRowCounts(sqlite: Database.Database, pg: any): Promise<void> {
  console.log('\n═══════════════════════════════════════════');
  console.log(' Row Count Verification');
  console.log('═══════════════════════════════════════════\n');

  console.log(
    'Table'.padEnd(30) +
    'SQLite'.padStart(10) +
    'PostgreSQL'.padStart(12) +
    '  Match',
  );
  console.log('─'.repeat(60));

  for (const table of TABLES) {
    let sqliteCount = 0;
    let pgCount = 0;

    try {
      const exists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table);
      if (exists) {
        sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any).count;
      }
    } catch { /* table may not exist */ }

    try {
      const result = await pg.query(`SELECT COUNT(*) as count FROM ${table}`);
      pgCount = parseInt(result.rows[0].count, 10);
    } catch { /* table may not exist */ }

    const match = sqliteCount === pgCount;
    console.log(
      table.padEnd(30) +
      String(sqliteCount).padStart(10) +
      String(pgCount).padStart(12) +
      `  ${match ? 'YES' : 'NO'}`,
    );
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
