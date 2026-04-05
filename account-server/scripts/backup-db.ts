#!/usr/bin/env tsx
/**
 * Database backup script — can be called from cron.
 *
 * Usage:
 *   tsx scripts/backup-db.ts [backup-dir]
 *
 * Cron example (daily at 2 AM):
 *   0 2 * * * cd /path/to/account-server && tsx scripts/backup-db.ts
 */
import path from 'path';

// Set minimal env for config to load
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'backup-only';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

import { backupDatabase, runWALCheckpoint } from '../src/db-maintenance';

const backupDir = process.argv[2] || undefined;

console.log('[backup] Starting database backup...');

// Checkpoint WAL first for consistency
const checkpoint = runWALCheckpoint();
console.log(`[backup] WAL checkpoint: ${checkpoint.checkpointed}/${checkpoint.log} pages`);

const result = backupDatabase(backupDir);
if (result) {
  console.log(`[backup] Success: ${result}`);
  process.exit(0);
} else {
  console.error('[backup] Failed to create backup');
  process.exit(1);
}
