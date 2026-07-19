/**
 * RBAC unification (2026-07-19) — users.admin_role is the ONE source of truth.
 *
 * Two layers proven here:
 *   1. Unit: adminOnly() gates purely on admin_role ∈ {super_admin, admin}.
 *      The legacy role column no longer grants anything by itself (the 008
 *      backfill migration is what carries legacy admins across).
 *   2. End-to-end: a real register→login token hits /api/v1/admin/users and
 *      flips 403→200 purely by setting users.admin_role.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-rbac-single-source';
process.env.PORT = '0';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { adminOnly } from '../src/middleware/auth';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

jest.setTimeout(30000);

function insertUser(adminRole: string | null, role: string = 'user'): string {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO users (id, email, name, password_hash, tier, role, admin_role, windy_identity_id, identity_type)
     VALUES (?, ?, 'RBAC T', 'x', 'free', ?, ?, ?, 'human')`,
  ).run(id, `rbac-${id.slice(0, 8)}@example.com`, role, adminRole, crypto.randomUUID());
  return id;
}

function callAdminOnly(userId: string): Promise<{ status?: number; passed: boolean }> {
  return new Promise(resolve => {
    const req: any = { user: { userId } };
    const res: any = {
      status(code: number) {
        return { json: (_body: any) => resolve({ status: code, passed: false }) };
      },
    };
    adminOnly(req, res, () => resolve({ passed: true }));
  });
}

describe('adminOnly gates on admin_role only (unit)', () => {
  it('super_admin passes', async () => {
    expect((await callAdminOnly(insertUser('super_admin'))).passed).toBe(true);
  });

  it('admin passes', async () => {
    expect((await callAdminOnly(insertUser('admin'))).passed).toBe(true);
  });

  it('support/analyst are read-tier — no account-server admin surfaces', async () => {
    expect((await callAdminOnly(insertUser('support'))).status).toBe(403);
    expect((await callAdminOnly(insertUser('analyst'))).status).toBe(403);
  });

  it('legacy role=admin WITHOUT admin_role no longer grants (008 backfills real admins)', async () => {
    expect((await callAdminOnly(insertUser(null, 'admin'))).status).toBe(403);
  });

  it('plain user and unknown user are denied', async () => {
    expect((await callAdminOnly(insertUser(null))).status).toBe(403);
    expect((await callAdminOnly('no-such-user')).status).toBe(403);
  });
});

describe('admin endpoint honors admin_role end-to-end', () => {
  function uniqueEmail() {
    return `rbac-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  }

  it('403 for a plain user, 200 once admin_role is set', async () => {
    const body = { name: 'RBAC E2E', email: uniqueEmail(), password: 'SecurePass1' };
    const reg = await request(app).post('/api/v1/auth/register').send(body);
    expect(reg.status).toBe(201);
    getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(reg.body.userId);

    const login1 = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password });
    expect(login1.status).toBe(200);
    const token1 = login1.body.token || login1.body.accessToken;

    const denied = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token1}`);
    expect(denied.status).toBe(403);

    // Flip ONLY admin_role — the single source of truth. adminOnly reads the
    // DB fresh, so even the pre-flip token now clears the gate.
    getDb().prepare("UPDATE users SET admin_role = 'admin' WHERE id = ?").run(reg.body.userId);

    const allowed = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token1}`);
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.users)).toBe(true);
  });
});
