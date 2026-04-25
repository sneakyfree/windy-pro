/**
 * Wave 14 P1-3 — admin bootstrap.
 *
 * Phase 1 prod shipped without a seeded admin user. The admin
 * console + /api/v1/admin/* endpoints were effectively dormant
 * because there was no way to log in as admin without manually
 * running SQL on the RDS instance.
 *
 * This helper reads ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD
 * at startup and creates an admin user IF no admin exists yet.
 * Idempotent: if an admin is already present (any role='admin' row),
 * this is a no-op. If the env vars are unset, this is a no-op. If
 * only the email is set without a password, log a warning and
 * skip — we deliberately don't auto-generate a password and log it,
 * because application logs are an easy secret-exfiltration path.
 *
 * Ops flow:
 *   1. Set both env vars on the EC2 (or wherever) before boot.
 *   2. Server boots. First call creates the admin, logs one line.
 *   3. Operator logs in via /api/v1/auth/login with those creds.
 *   4. Operator UNSETS ADMIN_BOOTSTRAP_PASSWORD from the env and
 *      restarts — the check sees an admin already exists and skips.
 */
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDb } from '../db/schema';
import { config } from '../config';

export interface BootstrapResult {
    action: 'created' | 'skipped_exists' | 'skipped_no_env' | 'skipped_no_password';
    email?: string;
    reason?: string;
}

export async function maybeBootstrapAdmin(): Promise<BootstrapResult> {
    const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';

    if (!email) {
        return { action: 'skipped_no_env' };
    }
    if (!password) {
        // Don't silently auto-generate a password and log it — logs
        // are the wrong place for credentials.
        console.warn(
            '[admin-bootstrap] ADMIN_BOOTSTRAP_EMAIL is set but ' +
            'ADMIN_BOOTSTRAP_PASSWORD is not. Skipping. To bootstrap an ' +
            'admin user, set BOTH env vars.',
        );
        return { action: 'skipped_no_password', reason: 'password_missing' };
    }

    const db = getDb();

    // Is there an admin already? Any role='admin' row counts — we
    // don't care if it matches our email. The intent is "give the
    // platform exactly one minted admin identity"; if one already
    // exists, this bootstrap has done its job.
    const existing = db.prepare(
        "SELECT id, email FROM users WHERE role = 'admin' LIMIT 1",
    ).get() as { id: string; email: string } | undefined;

    if (existing) {
        console.info(
            `[admin-bootstrap] admin already exists (${existing.email}); ` +
            `skipping bootstrap. You can remove ADMIN_BOOTSTRAP_* env vars.`,
        );
        return { action: 'skipped_exists', email: existing.email };
    }

    // Mint the admin. Reuse the same users-table shape as register:
    // uuid id, normalized email, password_hash, tier, role, and a
    // windy_identity_id so any downstream "product account" logic
    // treats this row like any other identity.
    const id = uuidv4();
    const windyIdentityId = crypto.randomUUID();
    const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

    // Insert. If a user with this email already exists (but NOT as
    // admin — the earlier check caught admin), promote them rather
    // than failing on the UNIQUE constraint; less confusing ops.
    const sameEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (sameEmail) {
        db.prepare(
            `UPDATE users SET role = 'admin', password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(hash, sameEmail.id);
        console.info(
            `[admin-bootstrap] promoted existing user ${email} to admin. ` +
            `You can now remove ADMIN_BOOTSTRAP_* env vars.`,
        );
        return { action: 'created', email };
    }

    db.prepare(
        `INSERT INTO users (id, email, name, password_hash, tier, role, windy_identity_id, identity_type)
         VALUES (?, ?, ?, ?, 'free', 'admin', ?, 'human')`,
    ).run(id, email, 'Admin', hash, windyIdentityId);

    console.info(
        `[admin-bootstrap] created admin user ${email}. ` +
        `Log in via POST /api/v1/auth/login. After first login, ` +
        `REMOVE ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD from ` +
        `the environment and restart.`,
    );
    return { action: 'created', email };
}
