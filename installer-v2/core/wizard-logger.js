/**
 * wizard-logger.js
 *
 * Persistent file-based logger for the install wizard. Writes every line
 * to ~/Library/Logs/Windy Pro/wizard-install.log (or the platform equivalent)
 * with a timestamp, AND to console as a fallback.
 *
 * Why this exists:
 *   - In a packaged Electron .app, console.log goes to stdout which is
 *     swallowed when launched from Finder. Users can't see it.
 *   - DevTools is disabled in production builds.
 *   - When the wizard hangs, the LAST line in the log file tells us
 *     exactly which step never completed. No DevTools needed.
 *
 * Usage:
 *   const { wizardLog, getLogPath } = require('./wizard-logger');
 *   wizardLog('starting phase 0');
 *
 * Tail the log live (in a separate terminal):
 *   tail -f "$HOME/Library/Logs/Windy Pro/wizard-install.log"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getLogDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'Windy Pro');
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Windy Pro', 'Logs');
  }
  // Linux (XDG-ish)
  return path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'windy-pro', 'logs'
  );
}

const LOG_DIR = getLogDir();
const LOG_PATH = path.join(LOG_DIR, 'wizard-install.log');

let initialized = false;
let writeStream = null;

function ensureInit() {
  if (initialized) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Open append stream so we don't lose data on crash
    writeStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
    writeStream.on('error', (e) => {
      // Don't crash the wizard if log file can't be opened
      console.error('[wizard-logger] write stream error:', e.message);
      writeStream = null;
    });
    // Marker line so we can find this run easily
    const banner = `\n========== WIZARD START ${new Date().toISOString()} (pid ${process.pid}) ==========\n`;
    writeStream.write(banner);
    process.stdout.write(banner);
  } catch (e) {
    console.error('[wizard-logger] init failed:', e.message);
  }
  initialized = true;
}

/**
 * Log a line. Always logs to console too. Returns the formatted line.
 */
function wizardLog(...args) {
  ensureInit();
  const ts = new Date().toISOString();
  const msg = args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  const line = `[${ts}] ${msg}\n`;
  try { if (writeStream) writeStream.write(line); } catch (_) { /* ignore */ }
  process.stdout.write(line);
  return line;
}

/**
 * Wrap an async function so we log entry, exit, duration, and any error.
 * If the function hangs, the entry log line will be the last entry — that
 * tells us exactly which call to investigate.
 */
function logAsyncStep(label, fn) {
  return async function (...args) {
    const t0 = Date.now();
    wizardLog(`→ ${label}() ENTER`);
    try {
      const result = await fn.apply(this, args);
      const dt = Date.now() - t0;
      wizardLog(`✓ ${label}() OK (${dt}ms)`);
      return result;
    } catch (e) {
      const dt = Date.now() - t0;
      wizardLog(`✗ ${label}() THREW (${dt}ms): ${e.message}`);
      wizardLog(`  stack: ${e.stack || '(no stack)'}`);
      throw e;
    }
  };
}

/**
 * Synchronous version of logAsyncStep for plain functions.
 */
function logSyncStep(label, fn) {
  return function (...args) {
    const t0 = Date.now();
    wizardLog(`→ ${label}() ENTER`);
    try {
      const result = fn.apply(this, args);
      const dt = Date.now() - t0;
      wizardLog(`✓ ${label}() OK (${dt}ms)`);
      return result;
    } catch (e) {
      const dt = Date.now() - t0;
      wizardLog(`✗ ${label}() THREW (${dt}ms): ${e.message}`);
      throw e;
    }
  };
}

function getLogPath() {
  return LOG_PATH;
}

module.exports = { wizardLog, logAsyncStep, logSyncStep, getLogPath };
