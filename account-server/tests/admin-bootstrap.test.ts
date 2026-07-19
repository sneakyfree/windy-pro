/**
 * Wave 14 P1-3 — admin bootstrap helper.
 * Updated 2026-07-19 for the RBAC unification: users.admin_role is the ONE
 * source of truth for admin ACCESS; role='admin' is written for legacy
 * compatibility only. Bootstrap now mints admin_role='super_admin'.
 *
 * Cases:
 *   1. Both env vars set, no admin yet → create an admin (role AND admin_role).
 *   2. Both env vars set, admin already exists (admin_role) → no-op.
 *   3. Both env vars set, LEGACY admin exists (role only, pre-backfill) → no-op.
 *   4. Email match promotes an existing user (gets admin_role too).
 *   5. Email set without password → warn + skip, no admin created.
 *   6. Neither env var set → silent no-op.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-bootstrap-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-bootstrap-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.DB_PATH = path.join(tmpDir, 'accounts.db');
process.env.DATA_ROOT = tmpDir;

import { getDb } from '../src/db/schema';
import { maybeBootstrapAdmin } from '../src/services/admin-bootstrap';

function wipeUsers() {
    getDb().prepare('DELETE FROM users').run();
}

function insertUser(email: string, role: string, adminRole: string | null = null) {
    const id = uuidv4();
    const hash = 'not-a-real-hash';
    getDb().prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, role, admin_role, windy_identity_id, identity_type)
         VALUES (?, ?, 'T', ?, 'free', ?, ?, ?, 'human')`,
    ).run(id, email, hash, role, adminRole, crypto.randomUUID());
    return id;
}

describe('Wave 14 P1-3 — admin bootstrap (admin_role source of truth)', () => {
    beforeEach(() => {
        wipeUsers();
        delete process.env.ADMIN_BOOTSTRAP_EMAIL;
        delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    });

    it('creates an admin with BOTH role=admin and admin_role=super_admin', async () => {
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops@windypro.test';
        process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Bootstrap-P@ss-1';
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('created');
        expect(r.email).toBe('ops@windypro.test');
        const row = getDb().prepare(
            "SELECT email, role, admin_role FROM users WHERE admin_role = 'super_admin'",
        ).get() as { email: string; role: string; admin_role: string };
        expect(row.email).toBe('ops@windypro.test');
        expect(row.role).toBe('admin');           // legacy column still written (transition)
        expect(row.admin_role).toBe('super_admin'); // the source of truth
    });

    it('password is hashed, not stored in plaintext', async () => {
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops2@windypro.test';
        process.env.ADMIN_BOOTSTRAP_PASSWORD = 'hashed-plz';
        await maybeBootstrapAdmin();
        const row = getDb().prepare(
            'SELECT password_hash FROM users WHERE email = ?',
        ).get('ops2@windypro.test') as { password_hash: string };
        expect(row.password_hash).not.toBe('hashed-plz');
        expect(await bcrypt.compare('hashed-plz', row.password_hash)).toBe(true);
    });

    it('skips when an admin_role admin already exists (idempotent reboots)', async () => {
        insertUser('original-admin@x.test', 'admin', 'super_admin');
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops@windypro.test';
        process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ignored';
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('skipped_exists');
        const n = (getDb().prepare(
            "SELECT COUNT(*) AS n FROM users WHERE admin_role IN ('super_admin', 'admin')",
        ).get() as { n: number }).n;
        expect(n).toBe(1);
    });

    it('skips when only a LEGACY role=admin row exists (pre-backfill safety)', async () => {
        // A prod row where 008's backfill hasn't run yet must still count as
        // "an admin exists" — bootstrap must not mint a second admin.
        insertUser('legacy-admin@x.test', 'admin', null);
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops@windypro.test';
        process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ignored';
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('skipped_exists');
    });

    it('promotes an existing non-admin user if the email matches (gets admin_role)', async () => {
        insertUser('ops@windypro.test', 'user', null);
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops@windypro.test';
        process.env.ADMIN_BOOTSTRAP_PASSWORD = 'new-pass';
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('created');
        const row = getDb().prepare(
            'SELECT role, admin_role FROM users WHERE email = ?',
        ).get('ops@windypro.test') as { role: string; admin_role: string };
        expect(row.role).toBe('admin');
        expect(row.admin_role).toBe('super_admin');
    });

    it('warns and skips when password is missing', async () => {
        process.env.ADMIN_BOOTSTRAP_EMAIL = 'ops@windypro.test';
        // no password
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('skipped_no_password');
        const anyAdmin = getDb().prepare(
            "SELECT id FROM users WHERE admin_role IS NOT NULL OR role = 'admin'",
        ).get();
        expect(anyAdmin).toBeUndefined();
    });

    it('silent no-op when neither env var is set', async () => {
        const r = await maybeBootstrapAdmin();
        expect(r.action).toBe('skipped_no_env');
    });
});
