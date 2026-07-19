/**
 * Admin device board (Mission 12-A P3): list a user's registered devices
 * and deactivate ONE machine without revoking the whole license. Consumed
 * by Windy Admin's license board via JWT-forward federation.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-admin-devices';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function makeAdmin() {
  const body = { name: 'Dev Admin', email: uniqueEmail('devadmin'), password: 'SecurePass1' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  const token = res.body.token || res.body.accessToken;
  getDb().prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin', email_verified = 1 WHERE id = ?")
    .run(res.body.userId);
  return { token, userId: res.body.userId };
}

async function makeUserWithDevice() {
  const body = { name: 'Target', email: uniqueEmail('target'), password: 'SecurePass1' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  const uid = res.body.userId;
  getDb().prepare(
    "INSERT INTO devices (id, user_id, name, platform) VALUES (?, ?, ?, ?)"
  ).run('dev-1', uid, 'MacBook', 'macos');
  return uid;
}

describe('admin device board', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/users/x/devices');
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin token', async () => {
    const reg = await request(app).post('/api/v1/auth/register')
      .send({ name: 'Plain', email: uniqueEmail('plain'), password: 'SecurePass1' });
    const token = reg.body.token || reg.body.accessToken;
    const res = await request(app).get(`/api/v1/admin/users/${reg.body.userId}/devices`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lists devices and deactivates one', async () => {
    const admin = await makeAdmin();
    const uid = await makeUserWithDevice();

    const list = await request(app).get(`/api/v1/admin/users/${uid}/devices`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.devices.length).toBe(1);
    expect(list.body.devices[0].id).toBe('dev-1');

    const rm = await request(app).post(`/api/v1/admin/users/${uid}/devices/dev-1/remove`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(rm.status).toBe(200);
    expect(rm.body.ok).toBe(true);

    const after = await request(app).get(`/api/v1/admin/users/${uid}/devices`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(after.body.devices.length).toBe(0);

    const missing = await request(app).post(`/api/v1/admin/users/${uid}/devices/nope/remove`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
  });
});
