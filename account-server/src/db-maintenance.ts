/**
 * Database Maintenance — WAL checkpoint and backup utilities.
 *
 * Phase 4: Ensures SQLite WAL doesn't grow unbounded and provides
 * a safe backup mechanism for the database file.
 */
import { getDb } from './db/schema';
import { config } from './config';
import path from 'path';
import fs from 'fs';

let walCheckpointTimer: ReturnType<typeof setInterval> | null = null;

// ═══════════════════════════════════════════
//  WAL CHECKPOINT
// ═══════════════════════════════════════════

/**
 * Run a WAL checkpoint to flush the write-ahead log to the main database file.
 * Uses PASSIVE mode (non-blocking) to avoid interfering with active reads/writes.
 *
 * Returns the checkpoint result: [busy, log, checkpointed]
 */
export function runWALCheckpoint(): { busy: number; log: number; checkpointed: number } {
  const db = getDb();
  try {
    const result = db.pragma('wal_checkpoint(PASSIVE)') as any[];
    const row = result[0] || { busy: 0, log: 0, checkpointed: 0 };
    return {
      busy: row.busy ?? 0,
      log: row.log ?? 0,
      checkpointed: row.checkpointed ?? 0,
    };
  } catch (err: any) {
    console.error('[db-maintenance] WAL checkpoint failed:', err.message);
    return { busy: 0, log: 0, checkpointed: 0 };
  }
}

/**
 * Start periodic WAL checkpoints.
 * Default interval: 5 minutes.
 */
export function startWALCheckpoint(intervalMs: number = 5 * 60 * 1000): void {
  if (walCheckpointTimer) return; // Already running

  // Run once immediately
  const result = runWALCheckpoint();
  if (result.log > 0) {
    console.log(`[db-maintenance] Initial WAL checkpoint: ${result.checkpointed}/${result.log} pages`);
  }

  walCheckpointTimer = setInterval(() => {
    const r = runWALCheckpoint();
    if (r.log > 100) {
      console.log(`[db-maintenance] WAL checkpoint: ${r.checkpointed}/${r.log} pages (${r.busy} busy)`);
    }
  }, intervalMs);

  // Don't prevent process exit
  if (walCheckpointTimer.unref) {
    walCheckpointTimer.unref();
  }
}

/**
 * Stop periodic WAL checkpoints.
 */
export function stopWALCheckpoint(): void {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
    walCheckpointTimer = null;
  }
}

// ═══════════════════════════════════════════
//  DATABASE BACKUP
// ═══════════════════════════════════════════

/**
 * Create a safe backup of the SQLite database.
 *
 * Uses SQLite's backup API (via better-sqlite3) for a consistent copy
 * even while the database is being written to.
 *
 * @param backupDir — directory to store backups (default: data/backups)
 * @returns path to the backup file, or null on failure
 */
export function backupDatabase(backupDir?: string): string | null {
  const dir = backupDir || path.join(config.DATA_ROOT, 'backups');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `accounts-${timestamp}.db`);

  try {
    const db = getDb();

    // Use better-sqlite3's backup API for a consistent snapshot
    db.backup(backupPath);

    const stats = fs.statSync(backupPath);
    console.log(`[db-maintenance] Backup created: ${backupPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    // Clean up old backups — keep last 10
    pruneBackups(dir, 10);

    return backupPath;
  } catch (err: any) {
    console.error('[db-maintenance] Backup failed:', err.message);

    // Fallback: file copy (less safe but better than nothing)
    try {
      // Checkpoint WAL first to ensure data is in main file
      runWALCheckpoint();
      fs.copyFileSync(config.DB_PATH, backupPath);
      console.log(`[db-maintenance] Backup created (file copy fallback): ${backupPath}`);
      pruneBackups(dir, 10);
      return backupPath;
    } catch (fallbackErr: any) {
      console.error('[db-maintenance] Backup fallback also failed:', fallbackErr.message);
      return null;
    }
  }
}

/**
 * Keep only the N most recent backups in the directory.
 */
function pruneBackups(dir: string, keep: number): void {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('accounts-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (let i = keep; i < files.length; i++) {
      const filePath = path.join(dir, files[i]);
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  } catch { /* ignore pruning errors */ }
}

// ═══════════════════════════════════════════
//  CLEANUP EXPIRED DATA
// ═══════════════════════════════════════════

/**
 * Clean up expired token blacklist entries and expired refresh tokens.
 * Call periodically (e.g., every hour) to prevent table bloat.
 */
export function cleanupExpiredData(): { blacklistPurged: number; refreshPurged: number } {
  const db = getDb();
  let blacklistPurged = 0;
  let refreshPurged = 0;

  try {
    const result1 = db.prepare("DELETE FROM token_blacklist WHERE expires_at < datetime('now')").run();
    blacklistPurged = result1.changes;
  } catch { /* table may not exist */ }

  try {
    const result2 = db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')").run();
    refreshPurged = result2.changes;
  } catch { /* ignore */ }

  return { blacklistPurged, refreshPurged };
}
