#!/usr/bin/env node
/**
 * Migration script: Import cloud-storage JSON data → account-server SQLite.
 *
 * Reads from: services/cloud-storage/data/_db/*.json
 * Writes to:  account-server/accounts.db
 *
 * Usage: cd account-server && npx tsx scripts/migrate-cloud-storage.ts
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { config } from '../src/config';
import { getDb } from '../src/db/schema';

// ─── Config ──────────────────────────────────────────────────

const CLOUD_DB_DIR = path.resolve(__dirname, '..', '..', 'services', 'cloud-storage', 'data', '_db');

function loadJson(filename: string): Record<string, any> {
    const filePath = path.join(CLOUD_DB_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠  File not found: ${filePath}`);
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e: any) {
        console.warn(`⚠  Failed to parse ${filename}: ${e.message}`);
        return {};
    }
}

// ─── Main ────────────────────────────────────────────────────

async function migrate() {
    console.log('');
    console.log('🔄 Cloud Storage → Account Server Migration');
    console.log(`   Source:  ${CLOUD_DB_DIR}`);
    console.log(`   Target:  ${config.DB_PATH}`);
    console.log('');

    if (!fs.existsSync(CLOUD_DB_DIR)) {
        console.log('❌ Cloud storage data directory not found. Nothing to migrate.');
        return;
    }

    const db = getDb();
    let counts = { users: 0, files: 0, transactions: 0, coupons: 0, skipped: 0 };

    // ─── Users ───────────────────────────────────────────────

    const usersData = loadJson('users.json');
    const userIdMap: Record<string, string> = {}; // cloud-id → account-id

    const insertUser = db.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, password_hash, tier, role, storage_used, storage_limit, frozen, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [id, user] of Object.entries(usersData)) {
        if (!user.email) continue;

        // Check if user already exists by email
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email) as { id: string } | undefined;
        if (existing) {
            userIdMap[id] = existing.id;
            // Update storage fields on existing user
            db.prepare('UPDATE users SET storage_used = MAX(COALESCE(storage_used, 0), ?), storage_limit = MAX(COALESCE(storage_limit, 0), ?) WHERE id = ?')
                .run(user.storageUsed || 0, user.storageLimit || 524288000, existing.id);
            counts.skipped++;
            continue;
        }

        const newId = uuidv4();
        userIdMap[id] = newId;
        insertUser.run(
            newId,
            user.email,
            user.email.split('@')[0], // name from email
            user.password || '', // already bcrypt hashed
            user.tier || 'free',
            user.role || 'user',
            user.storageUsed || 0,
            user.storageLimit || 524288000,
            user.frozen ? 1 : 0,
            user.createdAt || new Date().toISOString(),
            user.lastActive || new Date().toISOString(),
        );
        counts.users++;
    }
    console.log(`✅ Users:        ${counts.users} imported, ${counts.skipped} already existed`);

    // ─── Files ───────────────────────────────────────────────

    const filesData = loadJson('files.json');
    const insertFile = db.prepare(
        `INSERT OR IGNORE INTO files (id, user_id, original_name, stored_name, mime_type, size, type, session_date, metadata, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [id, file] of Object.entries(filesData)) {
        const userId = userIdMap[file.userId] || file.userId;
        insertFile.run(
            id,
            userId,
            file.originalName || 'unknown',
            file.storedName || id,
            file.mimeType || 'application/octet-stream',
            file.size || 0,
            file.type || 'transcript',
            file.sessionDate || null,
            JSON.stringify(file.metadata || {}),
            file.uploadedAt || new Date().toISOString(),
        );
        counts.files++;
    }
    console.log(`✅ Files:        ${counts.files} imported`);

    // ─── Transactions ────────────────────────────────────────

    const txData = loadJson('transactions.json');
    const insertTx = db.prepare(
        `INSERT OR IGNORE INTO transactions (id, user_id, email, amount, currency, type, status, stripe_payment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [id, tx] of Object.entries(txData)) {
        const userId = tx.userId ? (userIdMap[tx.userId] || tx.userId) : null;
        insertTx.run(
            id,
            userId,
            tx.email || '',
            tx.amount || 0,
            tx.currency || 'usd',
            tx.type || 'one_time',
            tx.status || 'pending',
            tx.stripePaymentId || '',
            tx.createdAt || new Date().toISOString(),
        );
        counts.transactions++;
    }
    console.log(`✅ Transactions: ${counts.transactions} imported`);

    // ─── Coupons ─────────────────────────────────────────────

    const couponsData = loadJson('coupons.json');
    const insertCoupon = db.prepare(
        `INSERT OR IGNORE INTO coupons (code, discount_percent, max_uses, usage_count, expires_at, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [code, coupon] of Object.entries(couponsData)) {
        insertCoupon.run(
            code,
            coupon.discountPercent || 0,
            coupon.maxUses || 999,
            coupon.usageCount || 0,
            coupon.expiresAt || null,
            coupon.active !== false ? 1 : 0,
            coupon.createdAt || new Date().toISOString(),
        );
        counts.coupons++;
    }
    console.log(`✅ Coupons:      ${counts.coupons} imported`);

    console.log('');
    console.log('🎉 Migration complete!');
    console.log(`   Total records: ${counts.users + counts.files + counts.transactions + counts.coupons}`);
    console.log('');
}

migrate().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
