/**
 * Windy Pro — Structured Logger (Mobile / React Native)
 *
 * Persists logs to Documents/windy-pro.log with 5MB rotation.
 * Falls back to console-only if filesystem is unavailable.
 *
 * Usage:
 *   import { createLogger } from './LogService';
 *   const log = createLogger('ChatMedia');
 *   log.entry('sendImage', { roomId, size });
 *   log.exit('sendImage', { eventId });
 */

import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

/** Fields whose values are auto-redacted in log output */
const REDACTED_FIELDS = new Set([
  'password', 'accessToken', 'access_token', 'token',
  'secretKey', 'secret_key', 'STRIPE_SECRET_KEY',
  'Authorization', 'authorization',
  'deviceKey', 'recoveryKey', 'exportedKeys',
]);

const LOG_DIR = RNFS.DocumentDirectoryPath;
const LOG_FILE = `${LOG_DIR}/windy-pro.log`;
const LOG_FILE_OLD = `${LOG_DIR}/windy-pro.log.1`;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

let _writeQueue: string[] = [];
let _flushing = false;

/** Deep-clone an object while replacing sensitive field values */
function redact(obj: any, depth = 0): any {
  if (depth > 5 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redact(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Compact JSON — truncates long strings and large arrays */
function compact(obj: any): string {
  if (obj === undefined) return '';
  try {
    const safe = redact(obj);
    const str = JSON.stringify(safe, (_, v) => {
      if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…';
      if (Array.isArray(v) && v.length > 10) return [...v.slice(0, 5), `…+${v.length - 5} more`];
      return v;
    });
    return str && str.length > 500 ? str.slice(0, 500) + '…' : str;
  } catch {
    return '[unserializable]';
  }
}

function ts(): string {
  return new Date().toISOString();
}

/** Flush write queue to disk (batched for performance) */
async function flushQueue(): Promise<void> {
  if (_flushing || _writeQueue.length === 0) return;
  _flushing = true;

  const batch = _writeQueue.splice(0, _writeQueue.length).join('');
  try {
    // Check if rotation needed
    try {
      const stat = await RNFS.stat(LOG_FILE);
      if (Number(stat.size) > MAX_LOG_SIZE) {
        // Rotate: move current → .1 (overwrites old backup)
        try { await RNFS.unlink(LOG_FILE_OLD); } catch { /* ok */ }
        await RNFS.moveFile(LOG_FILE, LOG_FILE_OLD);
      }
    } catch { /* file doesn't exist yet, that's fine */ }

    await RNFS.appendFile(LOG_FILE, batch, 'utf8');
  } catch (e) {
    // Filesystem write failed — logs still went to console
    console.warn('[LogService] File write failed:', (e as Error).message);
  } finally {
    _flushing = false;
    // If more items queued while we were flushing, flush again
    if (_writeQueue.length > 0) {
      setTimeout(flushQueue, 50);
    }
  }
}

/** Write a log line to console and queue for file persistence */
function writeLine(level: 'log' | 'error' | 'warn', line: string): void {
  // Console output
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  // Queue for file persistence
  _writeQueue.push(line + '\n');
  // Debounced flush (batch writes every 100ms)
  if (_writeQueue.length === 1) {
    setTimeout(flushQueue, 100);
  }
}

export interface Logger {
  entry(method: string, params?: any): void;
  exit(method: string, result?: any): void;
  state(method: string, message: string): void;
  error(method: string, err: any): void;
  warn(method: string, message: string): void;
}

/**
 * Create a structured logger for a named service.
 */
export function createLogger(serviceName: string): Logger {
  const prefix = (method: string) => `[${ts()}] [${serviceName}.${method}]`;

  return {
    entry(method: string, params?: any) {
      writeLine('log', `${prefix(method)} → entry ${compact(params)}`);
    },

    exit(method: string, result?: any) {
      writeLine('log', `${prefix(method)} ← exit  ${compact(result)}`);
    },

    state(method: string, message: string) {
      writeLine('log', `${prefix(method)} ⚡ state: ${message}`);
    },

    error(method: string, err: any) {
      const info = err instanceof Error
        ? { message: err.message, code: (err as any).code || (err as any).errcode }
        : err;
      writeLine('error', `${prefix(method)} ✖ error ${compact(info)}`);
    },

    warn(method: string, message: string) {
      writeLine('warn', `${prefix(method)} ⚠ ${message}`);
    },
  };
}

/** Read the current log file contents (for diagnostics screen) */
export async function readLogFile(): Promise<string> {
  try {
    return await RNFS.readFile(LOG_FILE, 'utf8');
  } catch {
    return '(no log file)';
  }
}

/** Clear the log file */
export async function clearLogFile(): Promise<void> {
  try { await RNFS.unlink(LOG_FILE); } catch { /* ok */ }
  try { await RNFS.unlink(LOG_FILE_OLD); } catch { /* ok */ }
}

/** Get the log file path (for sharing/export) */
export function getLogFilePath(): string {
  return LOG_FILE;
}
