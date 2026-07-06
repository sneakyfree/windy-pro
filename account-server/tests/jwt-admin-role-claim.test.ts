/**
 * Windy Admin RBAC (ADR-WA-001 §6) — the login JWT carries an
 * `admin_role` claim IFF users.admin_role is set. Role claims live in
 * account-server (the human-identity SoT); windy-admin's dashboard
 * verifies this claim via JWKS and gates on it.
 *
 * Claim rules:
 *   - users.admin_role = 'super_admin' → claim present with that value
 *   - users.admin_role NULL            → claim ABSENT (the overwhelming
 *                                        majority of tokens are unchanged)
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-admin-role-claim';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'Admin Role Test', email: uniqueEmail('adminrole'), password: 'SecurePass1' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId };
}

async function loginClaims(email: string, password: string): Promise<Record<string, any>> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.token || res.body.accessToken;
  expect(token).toBeTruthy();
  return jwt.decode(token) as Record<string, any>;
}

describe('admin_role JWT claim', () => {
  it('is absent for a regular user', async () => {
    const user = await registerUser();
    const claims = await loginClaims(user.email, user.password);
    expect(claims.admin_role).toBeUndefined();
  });

  it('is present once users.admin_role is set', async () => {
    const user = await registerUser();
    getDb().prepare("UPDATE users SET admin_role = 'super_admin' WHERE id = ?").run(user.userId);
    const claims = await loginClaims(user.email, user.password);
    expect(claims.admin_role).toBe('super_admin');
    expect(claims.iss).toBe('windy-identity');
    expect(claims.windy_identity_id).toBeTruthy();
  });

  it('carries lower tiers verbatim (role field from day one)', async () => {
    const user = await registerUser();
    getDb().prepare("UPDATE users SET admin_role = 'analyst' WHERE id = ?").run(user.userId);
    const claims = await loginClaims(user.email, user.password);
    expect(claims.admin_role).toBe('analyst');
  });
});
