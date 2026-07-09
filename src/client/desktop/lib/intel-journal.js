/**
 * Intel V2 — offline JSONL journal (INTEL-CONTRACT-V2 §2).
 *
 * Store-and-forward buffer for telemetry events. Pure Node (no electron)
 * so it is unit-testable; the caller injects the directory.
 *
 * Layout (all inside `dir`):
 *   state.json    — { journal_id, batch_seq } (seq bumps ONLY after 2xx ack)
 *   journal.jsonl — pending events, one envelope per line
 *   inflight.json — the batch currently being uploaded (exact snapshot, so a
 *                   lost ack replays the SAME (journal_id, batch_seq, payload)
 *                   and the server dedups it — §2 rule 1/2)
 *
 * Caps: maxEvents (default 5000), maxBytes (default 5 MB), maxAgeMs
 * (default 30 days). On overflow the OLDEST events are dropped and the
 * caller is told how many (so it can emit client.error code:journal_overflow).
 *
 * Every method swallows fs errors — a broken disk must never crash the app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

class IntelJournal {
  constructor(opts = {}) {
    this.dir = opts.dir;
    this.maxEvents = opts.maxEvents || 5000;
    this.maxBytes = opts.maxBytes || 5 * 1024 * 1024;
    this.maxAgeMs = opts.maxAgeMs || 30 * DAY_MS;
    this.now = opts.now || (() => Date.now());
    this._events = [];       // pending envelopes (in memory mirror of journal.jsonl)
    this._inflight = null;   // { batch_seq, events } or null
    this._state = { journal_id: null, batch_seq: 0 };
    this._loaded = false;
  }

  _p(name) { return path.join(this.dir, name); }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // state
      try {
        this._state = JSON.parse(fs.readFileSync(this._p('state.json'), 'utf8'));
      } catch (_) { /* first run or corrupt — regenerate below */ }
      if (!this._state || typeof this._state !== 'object') this._state = {};
      if (!this._state.journal_id) this._state.journal_id = crypto.randomUUID();
      if (!Number.isInteger(this._state.batch_seq) || this._state.batch_seq < 0) {
        this._state.batch_seq = 0;
      }
      this._saveState();
      // pending events
      this._events = [];
      try {
        const raw = fs.readFileSync(this._p('journal.jsonl'), 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try { this._events.push(JSON.parse(line)); } catch (_) { /* skip bad line */ }
        }
      } catch (_) { /* no journal yet */ }
      // inflight batch
      try {
        const inflight = JSON.parse(fs.readFileSync(this._p('inflight.json'), 'utf8'));
        if (inflight && Number.isInteger(inflight.batch_seq) && Array.isArray(inflight.events)) {
          this._inflight = inflight;
        }
      } catch (_) { /* none */ }
      this._prune();
      this._loaded = true;
    } catch (_) { /* journal disabled on unwritable disk — emits become no-ops */ }
    return this;
  }

  get journalId() { return this._state.journal_id; }
  get batchSeq() { return this._state.batch_seq; }
  get pendingCount() { return this._events.length; }
  get hasInflight() { return this._inflight != null; }

  /**
   * Append one (already-validated) envelope.
   * Returns { dropped } — how many old events were evicted by the caps.
   */
  append(envelope) {
    if (!this._loaded) return { dropped: 0 };
    this._events.push(envelope);
    const dropped = this._prune();
    try {
      if (dropped > 0) {
        this._rewritePending();
      } else {
        fs.appendFileSync(this._p('journal.jsonl'), JSON.stringify(envelope) + '\n');
      }
    } catch (_) { }
    return { dropped };
  }

  /**
   * Get the batch to upload next (≤ maxBatch events). If a batch is already
   * inflight (unacked), returns THAT batch again — exact replay, same seq.
   * Otherwise snapshots the oldest pending events into inflight.json.
   * Returns { journal_id, batch_seq, events } or null when nothing to send.
   */
  takeBatch(maxBatch = 500) {
    if (!this._loaded) return null;
    if (this._inflight) {
      return {
        journal_id: this._state.journal_id,
        batch_seq: this._inflight.batch_seq,
        events: this._inflight.events,
      };
    }
    if (this._events.length === 0) return null;
    const events = this._events.slice(0, maxBatch);
    this._inflight = { batch_seq: this._state.batch_seq, events };
    try {
      fs.writeFileSync(this._p('inflight.json'), JSON.stringify(this._inflight));
    } catch (_) { }
    this._events = this._events.slice(events.length);
    this._rewritePending();
    return {
      journal_id: this._state.journal_id,
      batch_seq: this._inflight.batch_seq,
      events,
    };
  }

  /** Server acked (202 accepted, or 200 duplicate). Bump seq, clear inflight. */
  ack() {
    if (!this._inflight) return;
    this._state.batch_seq = this._inflight.batch_seq + 1;
    this._inflight = null;
    this._saveState();
    try { fs.unlinkSync(this._p('inflight.json')); } catch (_) { }
  }

  /**
   * Server rejected the batch permanently (422 off-contract / 409 tamper
   * guard). Drop it — replaying forever would wedge the journal — and skip
   * to the next seq so a future batch isn't mistaken for a mutated replay.
   */
  discardInflight() {
    if (!this._inflight) return;
    this._state.batch_seq = this._inflight.batch_seq + 1;
    this._inflight = null;
    this._saveState();
    try { fs.unlinkSync(this._p('inflight.json')); } catch (_) { }
  }

  // ── internals ──────────────────────────────────────────────────

  _saveState() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this._p('state.json'), JSON.stringify(this._state));
    } catch (_) { }
  }

  _rewritePending() {
    try {
      fs.writeFileSync(
        this._p('journal.jsonl'),
        this._events.map((e) => JSON.stringify(e)).join('\n') + (this._events.length ? '\n' : '')
      );
    } catch (_) { }
  }

  /** Enforce age/count/byte caps on the pending list. Returns events dropped. */
  _prune() {
    let dropped = 0;
    const cutoff = this.now() - this.maxAgeMs;
    const fresh = this._events.filter((e) => {
      const t = Date.parse(e && e.ts);
      return Number.isNaN(t) ? true : t >= cutoff;
    });
    dropped += this._events.length - fresh.length;
    this._events = fresh;
    while (this._events.length > this.maxEvents) {
      this._events.shift();
      dropped++;
    }
    let bytes = this._events.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
    while (bytes > this.maxBytes && this._events.length > 0) {
      const gone = this._events.shift();
      bytes -= JSON.stringify(gone).length + 1;
      dropped++;
    }
    return dropped;
  }
}

module.exports = { IntelJournal };
