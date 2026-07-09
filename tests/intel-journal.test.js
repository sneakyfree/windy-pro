/**
 * Unit tests for the Intel V2 offline journal (INTEL-CONTRACT-V2 §2):
 * batch_seq monotonicity, ack-gated increments, exact replay of unacked
 * batches, and overflow caps (count/bytes/age).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IntelJournal } = require('../src/client/desktop/lib/intel-journal');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'intel-journal-test-'));
}

function ev(i, ts) {
  return {
    ts: ts || new Date().toISOString(),
    platform: 'windy-word',
    service: 'desktop',
    event_type: 'session.start',
    actor_type: 'system',
    actor_id: null,
    metadata: { app_version: '1.7.0', os: 'macos', install_id: `id-${i}` },
  };
}

describe('IntelJournal', () => {
  test('generates a stable journal_id and starts batch_seq at 0', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    expect(j.journalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.batchSeq).toBe(0);
    // reload keeps the same id
    const j2 = new IntelJournal({ dir }).load();
    expect(j2.journalId).toBe(j.journalId);
  });

  test('append persists events across reloads', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    j.append(ev(1));
    j.append(ev(2));
    const j2 = new IntelJournal({ dir }).load();
    expect(j2.pendingCount).toBe(2);
  });

  test('batch_seq increments ONLY after ack', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    j.append(ev(1));
    const batch = j.takeBatch();
    expect(batch.batch_seq).toBe(0);
    expect(j.batchSeq).toBe(0);        // not yet acked
    j.ack();
    expect(j.batchSeq).toBe(1);        // acked → bumped
    expect(j.hasInflight).toBe(false);
  });

  test('unacked batch is replayed EXACTLY (same seq, same events) after restart', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    j.append(ev(1));
    j.append(ev(2));
    const batch = j.takeBatch();
    // no ack (lost response) — simulate restart
    const j2 = new IntelJournal({ dir }).load();
    const replay = j2.takeBatch();
    expect(replay.batch_seq).toBe(batch.batch_seq);
    expect(replay.events).toEqual(batch.events);
    j2.ack();
    expect(j2.batchSeq).toBe(1);
    expect(j2.takeBatch()).toBeNull(); // nothing left
  });

  test('takeBatch respects the 500-event cap', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    for (let i = 0; i < 600; i++) j.append(ev(i));
    const batch = j.takeBatch(500);
    expect(batch.events.length).toBe(500);
    j.ack();
    const rest = j.takeBatch(500);
    expect(rest.events.length).toBe(100);
    expect(rest.batch_seq).toBe(1);
  });

  test('discardInflight skips the seq without re-sending (409/422 guard)', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    j.append(ev(1));
    j.takeBatch();
    j.discardInflight();
    expect(j.batchSeq).toBe(1);
    expect(j.hasInflight).toBe(false);
  });

  test('overflow: maxEvents cap drops the OLDEST and reports the count', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir, maxEvents: 5 }).load();
    let totalDropped = 0;
    for (let i = 0; i < 8; i++) {
      totalDropped += j.append(ev(i)).dropped;
    }
    expect(totalDropped).toBe(3);
    expect(j.pendingCount).toBe(5);
    const batch = j.takeBatch();
    // oldest (0,1,2) dropped — first remaining is id-3
    expect(batch.events[0].metadata.install_id).toBe('id-3');
  });

  test('overflow: byte cap drops oldest', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir, maxBytes: 600 }).load();
    let dropped = 0;
    for (let i = 0; i < 10; i++) dropped += j.append(ev(i)).dropped;
    expect(dropped).toBeGreaterThan(0);
    const bytes = j._events.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
    expect(bytes).toBeLessThanOrEqual(600);
  });

  test('overflow: 30-day age cap drops stale events', () => {
    const dir = tmpDir();
    let nowMs = Date.parse('2026-07-08T00:00:00Z');
    const j = new IntelJournal({ dir, now: () => nowMs }).load();
    // A stale event (> 30 days old) is pruned on the very append that adds it
    const { dropped } = j.append(ev(1, '2026-05-01T00:00:00Z'));
    expect(dropped).toBe(1);
    j.append(ev(2, '2026-07-07T00:00:00Z'));
    j.append(ev(3, '2026-07-08T00:00:00Z'));
    expect(j.pendingCount).toBe(2);
  });

  test('corrupt journal lines are skipped, not fatal', () => {
    const dir = tmpDir();
    const j = new IntelJournal({ dir }).load();
    j.append(ev(1));
    fs.appendFileSync(path.join(dir, 'journal.jsonl'), 'NOT-JSON\n');
    j.append(ev(2));
    const j2 = new IntelJournal({ dir }).load();
    expect(j2.pendingCount).toBe(2);
  });
});
