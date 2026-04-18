/**
 * P0-5 — GDPR right-to-erasure: DELETE /me must leave NO user-scoped rows.
 *
 * Before Wave 7, handleAccountDeletion cascaded across 13 tables but
 * missed webhook_deliveries, identity_audit_log (no FK), analytics_events,
 * mfa_secrets, otp_codes — the user's IP / user-agent / encrypted TOTP
 * secret / signed webhook payloads all survived. Partial Article 17
 * failure. This test pins the contract.
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Walk every table that could plausibly hold user-scoped data and assert
 * zero matching rows. Each entry is [table_name, column_name]. Add to
 * this list if you add a new user-scoped table.
 */
const USER_SCOPED_COLUMNS: Array<[string, string]> = [
  ['users', 'id'],
  ['devices', 'user_id'],
  ['refresh_tokens', 'user_id'],
  ['translations', 'user_id'],
  ['favorites', 'user_id'],
  ['recordings', 'user_id'],
  ['files', 'user_id'],
  ['transactions', 'user_id'],
  ['product_accounts', 'identity_id'],
  ['identity_scopes', 'identity_id'],
  ['identity_audit_log', 'identity_id'],
  ['chat_profiles', 'identity_id'],
  ['bot_api_keys', 'identity_id'],
  ['eternitas_passports', 'identity_id'],
  ['mfa_secrets', 'user_id'],
  ['otp_codes', 'user_id'],
  ['webhook_deliveries', 'identity_id'],
  ['analytics_events', 'user_id'],
  ['clone_training_jobs', 'user_id'],
  ['oauth_consents', 'identity_id'],
  ['pending_provisions', 'identity_id'],
];

describe('P0-5 account self-delete leaves no user-scoped rows', () => {
  it('every listed table has zero rows matching the deleted user id', async () => {
    // Register a user
    const email = uniqueEmail('gdpr');
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'GDPR Test', email, password: 'SecurePass1' });
    expect(reg.status).toBe(201);
    const userId = reg.body.userId;
    const token = reg.body.token;

    const db = getDb();

    // Seed a few extra per-table rows so we have something to check.
    // The register call already produces: product_accounts (×2), identity_scopes,
    // refresh_tokens (×1), identity_audit_log (register event), analytics_events,
    // webhook_deliveries (identity.created fan-out × however many targets).
    // Manually add rows to tables that register doesn't hit:
    try {
      db.prepare(`INSERT INTO otp_codes (id, user_id, code_hash, purpose, expires_at)
                  VALUES (?, ?, ?, 'email_verification', datetime('now', '+15 minutes'))`).run(
        crypto.randomUUID(), userId, 'fake-hash',
      );
    } catch { /* schema may differ */ }
    try {
      db.prepare(`INSERT INTO mfa_secrets (user_id, totp_secret_encrypted, totp_secret_iv, totp_secret_tag)
                  VALUES (?, 'aaaa', 'bbbb', 'cccc')`).run(userId);
    } catch { /* schema may differ */ }
    try {
      db.prepare(`INSERT INTO recordings (id, user_id, bundle_id) VALUES (?, ?, ?)`)
        .run(crypto.randomUUID(), userId, `bundle-${crypto.randomBytes(4).toString('hex')}`);
    } catch { /* schema may differ */ }

    // Confirm SOMETHING exists so the test isn't a trivial pass
    const beforeCount = USER_SCOPED_COLUMNS.reduce((sum, [t, c]) => {
      try {
        const n = (db.prepare(`SELECT COUNT(*) as n FROM ${t} WHERE ${c} = ?`).get(userId) as any).n as number;
        return sum + n;
      } catch {
        return sum; // table may not exist on older schemas
      }
    }, 0);
    expect(beforeCount).toBeGreaterThan(0);

    // Delete the account
    const del = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(del.status).toBe(200);

    // After deletion, every user-scoped table should have 0 rows for this user.
    const residuals: Array<{ table: string; column: string; count: number }> = [];
    for (const [table, column] of USER_SCOPED_COLUMNS) {
      try {
        const n = (db.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE ${column} = ?`).get(userId) as any).n as number;
        if (n > 0) residuals.push({ table, column, count: n });
      } catch {
        // Table doesn't exist on this schema — ignore.
      }
    }

    // Fail with a clear message naming every table that wasn't cleaned.
    expect(residuals).toEqual([]);
  });
});
