/**
 * Ecosystem auto-provisioner — runs in the background after registration.
 *
 * When a user registers on Windy Pro, this provisions them across the
 * ecosystem: Mail inbox, Chat profile, Cloud storage allocation.
 * Like creating a Google account gives you Gmail + Drive instantly.
 */
import { getDb } from '../db/schema';
import { logAuditEvent } from '../identity-service';

export type ProvisionResult = 'ok' | 'skipped' | 'failed';

export async function provisionEcosystem(
    userId: string,
    email: string,
    name: string,
): Promise<Record<string, ProvisionResult>> {
    const results: Record<string, ProvisionResult> = {};

    // 1. Provision Windy Mail inbox
    if (process.env.WINDYMAIL_API_URL) {
        try {
            const resp = await fetch(`${process.env.WINDYMAIL_API_URL}/api/v1/webhooks/identity/created`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '',
                },
                body: JSON.stringify({ windy_identity_id: userId, email, display_name: name }),
                signal: AbortSignal.timeout(10000),
            });
            results.mail = resp.ok ? 'ok' : 'failed';
        } catch { results.mail = 'failed'; }
    } else { results.mail = 'skipped'; }

    // 2. Provision Windy Chat profile (lazy — created on first chat access)
    // Just ensure product_accounts row exists as pending
    try {
        const db = getDb();
        db.prepare(
            `INSERT OR IGNORE INTO product_accounts (id, identity_id, product, status, metadata)
             VALUES (?, ?, 'windy_chat', 'pending', '{}')`,
        ).run(crypto.randomUUID(), userId);
        results.chat = 'ok';
    } catch { results.chat = 'failed'; }

    // 3. Provision Windy Cloud storage allocation (free tier: 500 MB)
    try {
        const db = getDb();
        db.prepare('UPDATE users SET storage_limit = ? WHERE id = ? AND (storage_limit IS NULL OR storage_limit = 0)')
            .run(500 * 1024 * 1024, userId);
        results.cloud = 'ok';
    } catch { results.cloud = 'failed'; }

    // 4. Log the provisioning results
    try {
        logAuditEvent('product_provision', userId, {
            action: 'ecosystem_auto_provision',
            results,
        });
    } catch { /* audit logging is non-critical */ }

    console.log(`[Ecosystem] Provisioned ${email}: ${JSON.stringify(results)}`);
    return results;
}

// Node.js crypto for UUID generation in product_accounts insert
import crypto from 'crypto';
