/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/logger.js — P5 structured logging
 * + redaction.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let tmpHome;
let createLogger;

function freshLogger(env = {}) {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-'));
  process.env.HOME = tmpHome;
  process.env.XDG_STATE_HOME = path.join(tmpHome, '.local', 'state');
  Object.assign(process.env, env);
  jest.resetModules();
  createLogger = require('../src/client/desktop/logger');
}

afterEach(() => {
  delete process.env.WINDY_LOG_FILE;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
});

function readLog() {
  const p = createLogger.LOG_PATH;
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

describe('structured file sink', () => {
  beforeEach(() => freshLogger({ WINDY_LOG_FILE: '1' }));

  test('writes one JSON-line per log call', () => {
    const log = createLogger('TestSvc');
    log.entry('doThing', { input: 'hello' });
    log.exit('doThing', { ok: true });
    const lines = readLog().trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.level).toBe('info');
    expect(first.component).toBe('TestSvc');
    expect(first.event).toBe('doThing.entry');
    expect(first.data).toEqual({ input: 'hello' });
    expect(typeof first.ts).toBe('string');
  });

  test('redacts sensitive top-level field names', () => {
    const log = createLogger('Auth');
    log.entry('login', { email: 'a@b', password: 'secret', token: 'eyJ' });
    const record = JSON.parse(readLog().trim().split('\n').pop());
    expect(record.data.email).toBe('a@b');
    expect(record.data.password).toBe('[REDACTED]');
    expect(record.data.token).toBe('[REDACTED]');
  });

  test('redacts nested sensitive fields', () => {
    const log = createLogger('API');
    log.entry('call', { headers: { Authorization: 'Bearer xxx' } });
    const record = JSON.parse(readLog().trim().split('\n').pop());
    expect(record.data.headers.Authorization).toBe('[REDACTED]');
  });

  test('error logs capture message + code + trimmed stack', () => {
    const log = createLogger('Foo');
    const err = new Error('boom');
    err.code = 'E_BOOM';
    log.error('bar', err);
    const record = JSON.parse(readLog().trim().split('\n').pop());
    expect(record.level).toBe('error');
    expect(record.event).toBe('bar.error');
    expect(record.data.message).toBe('boom');
    expect(record.data.code).toBe('E_BOOM');
  });

  test('100 sequential lines all land (no buffering loss)', () => {
    const log = createLogger('Stream');
    for (let i = 0; i < 100; i++) log.state('tick', `beat ${i}`);
    // Count only the beat lines — earlier tests sharing cached state
    // may have left other records in the file.
    const beatLines = readLog().split('\n').filter(l => l.includes('"Stream"'));
    expect(beatLines).toHaveLength(100);
  });
});

describe('rotation', () => {
  beforeEach(() => freshLogger({ WINDY_LOG_FILE: '1' }));

  test('_rotateIfNeeded renames app.log → app.log.1 when counter past threshold', () => {
    // Prime the module by writing one real line so the write stream
    // opens against the real path.
    const log = createLogger('R');
    log.state('x', 'y');

    // Now forge enough state to trigger the rotate. We can't touch
    // the module's private _writeStreamBytes, so we plump the file
    // itself past the threshold and call _rotateIfNeeded. The rotate
    // function uses its internal counter, not the file stat, so
    // we need a second log call *after* the counter is bumped via
    // a big write.
    const logPath = createLogger.LOG_PATH;
    fs.writeFileSync(logPath, 'x'.repeat(11 * 1024 * 1024));

    // Trigger rotate through a line that carries the counter past
    // the limit. We fabricate that by writing a single large-ish line.
    const big = { blob: 'y'.repeat(11 * 1024 * 1024) };
    log.entry('rot', big);
    // Rotation should have happened at some point.
    expect(fs.existsSync(logPath + '.1')).toBe(true);
  });
});

describe('opt-out', () => {
  test('WINDY_LOG_FILE=0 prevents any file write', () => {
    freshLogger({ WINDY_LOG_FILE: '0' });
    const log = createLogger('OptOut');
    log.state('x', 'y');
    expect(fs.existsSync(createLogger.LOG_PATH)).toBe(false);
  });
});
