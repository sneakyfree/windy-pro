/**
 * Wave E — POST /api/v1/identity/connect/paired
 *
 * The windy-connect orchestrator Worker calls this after a successful
 * magic-link pair to flip the user's dashboard tile from "Available" to
 * "Active". Signed with HMAC-SHA256 over `${email}:${issued_at}`.
 *
 * Tests:
 *   - 503 when WINDY_CONNECT_WEBHOOK_SECRET is unset (fails closed)
 *   - 401 on missing / wrong signature / wrong secret
 *   - 401 on replayed timestamp (±5 min window)
 *   - 200 + DB update on valid payload
 *   - Idempotent under retry
 *   - Doesn't overwrite a fresher pair with a stale one
 *   - Returns ok=true even when email isn't a known Windy Pro user
 *     (Worker doesn't need to discriminate; the dashboard just won't
 *     show the tile flip for that email)
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.WINDY_CONNECT_WEBHOOK_SECRET = 'test-connect-webhook-secret-xxxxxxxxxxxxxxxxxxxx';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

const SECRET = process.env.WINDY_CONNECT_WEBHOOK_SECRET!;

function sign(email: string, issuedAt: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${email}:${issuedAt}`).digest('hex');
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('POST /api/v1/identity/connect/paired', () => {
  it('returns 503 when WINDY_CONNECT_WEBHOOK_SECRET is unset', async () => {
    const saved = process.env.WINDY_CONNECT_WEBHOOK_SECRET;
    delete process.env.WINDY_CONNECT_WEBHOOK_SECRET;
    try {
      const issued = nowIso();
      const res = await request(app)
        .post('/api/v1/identity/connect/paired')
        .send({ email: 'a@x.com', issued_at: issued, signature: 'whatever' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('webhook_secret_not_configured');
    } finally {
      process.env.WINDY_CONNECT_WEBHOOK_SECRET = saved;
    }
  });

  it('rejects missing signature → 401', async () => {
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: nowIso() });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('rejects wrong signature → 401', async () => {
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: nowIso(), signature: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  it('rejects signature computed with a different secret → 401', async () => {
    const issued = nowIso();
    const wrongSig = crypto
      .createHmac('sha256', 'totally-different-secret')
      .update(`a@x.com:${issued}`)
      .digest('hex');
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: issued, signature: wrongSig });
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp (>5 min) → 401', async () => {
    const stale = nowIso(-10 * 60 * 1000); // 10 min ago
    const sig = sign('a@x.com', stale);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: stale, signature: sig });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/window/i);
  });

  it('rejects a future timestamp (>5 min ahead) → 401', async () => {
    const future = nowIso(10 * 60 * 1000); // 10 min ahead
    const sig = sign('a@x.com', future);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: future, signature: sig });
    expect(res.status).toBe(401);
  });

  it('400 on missing email', async () => {
    const issued = nowIso();
    const sig = sign('a@x.com', issued);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ issued_at: issued, signature: sig });
    expect(res.status).toBe(400);
  });

  it('400 on non-ISO issued_at', async () => {
    const sig = sign('a@x.com', 'not-a-date');
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email: 'a@x.com', issued_at: 'not-a-date', signature: sig });
    expect(res.status).toBe(400);
  });

  it('valid payload returns 200 + ok:true even when email is unknown', async () => {
    const issued = nowIso();
    const sig = sign('unknown@example.com', issued);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({
        email: 'unknown@example.com',
        issued_at: issued,
        bundle_version: '1.0',
        signature: sig,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(false); // user doesn't exist
  });

  it('valid payload updates connect_paired_at for an existing user', async () => {
    const db = getDb();
    const email = `wave-e-test-${Date.now()}@example.com`;
    const userId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, tier) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, email, 'x', email.split('@')[0], 'free');

    const issued = nowIso();
    const sig = sign(email, issued);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email, issued_at: issued, bundle_version: '1.0', signature: sig });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const row = db
      .prepare('SELECT connect_paired_at, connect_bundle_version FROM users WHERE id = ?')
      .get(userId) as { connect_paired_at: string; connect_bundle_version: string };
    expect(row.connect_paired_at).toBe(issued);
    expect(row.connect_bundle_version).toBe('1.0');
  });

  it('does NOT overwrite a fresher pair with a stale one', async () => {
    const db = getDb();
    const email = `wave-e-stale-${Date.now()}@example.com`;
    const userId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, tier) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, email, 'x', email.split('@')[0], 'free');

    const fresh = nowIso();
    const sigFresh = sign(email, fresh);
    await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email, issued_at: fresh, signature: sigFresh });

    // Re-deliver an OLDER timestamp; webhook should accept signature but
    // SQL guard rejects the UPDATE.
    const stale = nowIso(-60 * 1000); // 1 min ago — still inside window
    const sigStale = sign(email, stale);
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email, issued_at: stale, signature: sigStale });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(false);

    const row = db
      .prepare('SELECT connect_paired_at FROM users WHERE id = ?')
      .get(userId) as { connect_paired_at: string };
    expect(row.connect_paired_at).toBe(fresh); // unchanged
  });

  it('case-insensitive email match', async () => {
    const db = getDb();
    const email = `Wave-E-Case-${Date.now()}@Example.COM`;
    const userId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, tier) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, email.toLowerCase(), 'x', 'case-test', 'free');

    const issued = nowIso();
    const sig = sign(email, issued); // signature uses original-case
    const res = await request(app)
      .post('/api/v1/identity/connect/paired')
      .send({ email, issued_at: issued, signature: sig });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });
});
