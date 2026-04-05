/**
 * Ecosystem auto-provisioner — runs in the background after registration.
 *
 * When a user registers on Windy Pro, this provisions them across the
 * ecosystem: Mail inbox, Chat profile, Cloud storage allocation.
 * Like creating a Google account gives you Gmail + Drive instantly.
 *
 * When an agent hatches, this provisions:
 *   Eternitas passport → Windy Chat Matrix account + DM room → product_accounts
 *
 * Retry strategy: exponential backoff (3 attempts: immediate, +5s, +30s).
 * Failed items stored in pending_provisions table, retried every 5 minutes.
 */
import { getDb } from '../db/schema';
import { logAuditEvent } from '../identity-service';
import { config } from '../config';
import crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────

export type ProvisionResult = 'ok' | 'skipped' | 'failed' | 'pending';

export interface AgentProvisionResult {
    eternitas: ProvisionResult;
    passport_number?: string;
    chat: ProvisionResult;
    matrix_user_id?: string;
    dm_room_id?: string;
}

// ─── Retry Configuration ────────────────────────────────────────

const RETRY_DELAYS_MS = [0, 5000, 30000]; // immediate, 5s, 30s
const PENDING_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let retryTimer: ReturnType<typeof setInterval> | null = null;

// ─── HTTP with Retry ────────────────────────────────────────────

async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxAttempts = 3,
): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
            const delay = RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        try {
            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok || res.status < 500) return res; // Don't retry 4xx
            lastError = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastError || new Error('All retry attempts failed');
}

// ─── User Ecosystem Provisioning ────────────────────────────────

export async function provisionEcosystem(
    userId: string,
    email: string,
    name: string,
): Promise<Record<string, ProvisionResult>> {
    const results: Record<string, ProvisionResult> = {};

    // 1. Provision Windy Mail inbox
    if (process.env.WINDYMAIL_API_URL) {
        try {
            const resp = await fetchWithRetry(`${process.env.WINDYMAIL_API_URL}/api/v1/webhooks/identity/created`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '',
                },
                body: JSON.stringify({ windy_identity_id: userId, email, display_name: name, creator_name: name }),
            });
            results.mail = resp.ok ? 'ok' : 'failed';
        } catch {
            results.mail = 'failed';
            queuePending(userId, 'windy_mail', 'provision_user', { email, name });
        }
    } else { results.mail = 'skipped'; }

    // 2. Provision Windy Chat profile (lazy — created on first chat access)
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

// ─── Agent Provisioning (Eternitas → Chat) ──────────────────────

/**
 * Full agent hatch flow:
 * 1. Call Eternitas auto-hatch → get passport_number
 * 2. Call Windy Chat agent onboarding → get matrix_user_id + dm_room_id
 * 3. Update product_accounts with all external IDs
 * 4. Return everything needed for mobile to show the agent in Chat
 */
export async function provisionAgent(
    botUserId: string,
    agentName: string,
    ownerUserId: string,
    ownerEmail: string,
): Promise<AgentProvisionResult> {
    const db = getDb();
    const result: AgentProvisionResult = { eternitas: 'failed', chat: 'failed' };

    // ── Step 1: Eternitas auto-hatch ────────────────────────────
    let passportNumber: string | undefined;
    try {
        const eternitasRes = await fetchWithRetry(`${config.ETERNITAS_URL}/api/v1/bots/auto-hatch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.ETERNITAS_API_KEY ? { 'Authorization': `Bearer ${config.ETERNITAS_API_KEY}` } : {}),
                ...(config.ETERNITAS_SERVICE_TOKEN ? { 'X-Service-Token': config.ETERNITAS_SERVICE_TOKEN } : {}),
            },
            body: JSON.stringify({
                agent_name: agentName,
                creator_email: ownerEmail,
                creator_name: ownerEmail.split('@')[0],
            }),
        });

        if (!eternitasRes.ok) {
            console.error(`[Ecosystem] Eternitas auto-hatch failed: ${eternitasRes.status}`);
            queuePending(botUserId, 'eternitas', 'provision_agent', { agentName, ownerUserId, ownerEmail });
            result.eternitas = 'pending';
            return result;
        }

        const eternitasData = await eternitasRes.json() as any;
        passportNumber = eternitasData.passport || eternitasData.passport_number || eternitasData.passportNumber;

        if (!passportNumber) {
            console.error('[Ecosystem] Eternitas returned no passport number');
            result.eternitas = 'failed';
            return result;
        }

        // Store passport in DB
        db.prepare(
            `INSERT OR REPLACE INTO eternitas_passports (id, identity_id, passport_number, status, operator_identity_id, registered_at)
             VALUES (?, ?, ?, 'active', ?, datetime('now'))`,
        ).run(crypto.randomUUID(), botUserId, passportNumber, ownerUserId);

        db.prepare(
            "UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'eternitas'",
        ).run(passportNumber, botUserId);

        result.eternitas = 'ok';
        result.passport_number = passportNumber;
        console.log(`[Ecosystem] Eternitas passport issued: ${passportNumber}`);
    } catch (err) {
        console.error('[Ecosystem] Eternitas auto-hatch error:', err);
        queuePending(botUserId, 'eternitas', 'provision_agent', { agentName, ownerUserId, ownerEmail });
        result.eternitas = 'pending';
        return result;
    }

    // ── Step 2: Windy Chat agent onboarding ─────────────────────
    try {
        // Get owner's windy_identity_id for the DM room
        const owner = db.prepare('SELECT windy_identity_id FROM users WHERE id = ?').get(ownerUserId) as any;

        const chatRes = await fetchWithRetry(`${config.WINDY_CHAT_URL}/api/v1/onboarding/agent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.CHAT_SERVICE_TOKEN}`,
            },
            body: JSON.stringify({
                passport_number: passportNumber,
                agent_name: agentName,
                owner_windy_identity_id: owner?.windy_identity_id || ownerUserId,
            }),
        });

        if (!chatRes.ok) {
            console.error(`[Ecosystem] Chat agent onboarding failed: ${chatRes.status}`);
            queuePending(botUserId, 'windy_chat', 'provision_agent_chat', {
                passportNumber, agentName, ownerUserId,
            });
            result.chat = 'pending';
            return result;
        }

        const chatData = await chatRes.json() as any;
        result.matrix_user_id = chatData.matrix_user_id;
        result.dm_room_id = chatData.dm_room_id;

        // Update product_accounts for chat
        db.prepare(
            `INSERT OR REPLACE INTO product_accounts (id, identity_id, product, status, external_id, metadata, provisioned_at)
             VALUES (?, ?, 'windy_chat', 'active', ?, ?, datetime('now'))`,
        ).run(
            crypto.randomUUID(), botUserId, chatData.matrix_user_id,
            JSON.stringify({ dm_room_id: chatData.dm_room_id, passport_number: passportNumber }),
        );

        // Also update the windy_fly product account for the OWNER (so mobile can find the agent)
        db.prepare(
            `INSERT OR REPLACE INTO product_accounts (id, identity_id, product, status, external_id, metadata, provisioned_at)
             VALUES (?, ?, 'windy_fly', 'active', ?, ?, datetime('now'))`,
        ).run(
            crypto.randomUUID(), ownerUserId, chatData.matrix_user_id,
            JSON.stringify({
                agent_name: agentName,
                passport_number: passportNumber,
                dm_room_id: chatData.dm_room_id,
                matrix_user_id: chatData.matrix_user_id,
            }),
        );

        result.chat = 'ok';
        console.log(`[Ecosystem] Chat agent provisioned: ${chatData.matrix_user_id} (room: ${chatData.dm_room_id})`);
    } catch (err) {
        console.error('[Ecosystem] Chat agent onboarding error:', err);
        queuePending(botUserId, 'windy_chat', 'provision_agent_chat', {
            passportNumber, agentName, ownerUserId,
        });
        result.chat = 'pending';
    }

    // Audit
    logAuditEvent('product_provision', botUserId, {
        action: 'agent_provision',
        result,
        operator: ownerUserId,
    });

    return result;
}

// ─── Revocation Cascade ─────────────────────────────────────────

/**
 * When Eternitas fires a passport.revoked webhook, suspend the agent
 * across all products: chat, mail, cloud.
 */
export async function cascadeRevocation(passportNumber: string): Promise<void> {
    const db = getDb();

    // Find the bot user by passport
    const passport = db.prepare(
        'SELECT identity_id, operator_identity_id FROM eternitas_passports WHERE passport_number = ?',
    ).get(passportNumber) as { identity_id: string; operator_identity_id: string } | undefined;

    if (!passport) {
        console.warn(`[Ecosystem] Revocation cascade: passport ${passportNumber} not found`);
        return;
    }

    const botUserId = passport.identity_id;

    // Suspend all product accounts for this bot
    db.prepare(
        "UPDATE product_accounts SET status = 'suspended' WHERE identity_id = ?",
    ).run(botUserId);

    // Update passport status
    db.prepare(
        "UPDATE eternitas_passports SET status = 'revoked' WHERE passport_number = ?",
    ).run(passportNumber);

    // Deactivate bot API keys
    db.prepare(
        "UPDATE bot_api_keys SET status = 'revoked' WHERE identity_id = ?",
    ).run(botUserId);

    // Log
    logAuditEvent('product_deprovision', botUserId, {
        action: 'cascade_revocation',
        passport_number: passportNumber,
        operator: passport.operator_identity_id,
    });

    console.log(`[Ecosystem] Revocation cascade complete for ${passportNumber}`);
}

// ─── Pending Provisions Queue ───────────────────────────────────

function queuePending(
    identityId: string,
    product: string,
    action: string,
    payload: Record<string, any>,
): void {
    try {
        const db = getDb();
        db.prepare(
            `INSERT INTO pending_provisions (id, identity_id, product, action, payload, attempts, created_at, next_retry_at)
             VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now', '+5 minutes'))`,
        ).run(crypto.randomUUID(), identityId, product, action, JSON.stringify(payload));
    } catch (err) {
        console.error('[Ecosystem] Failed to queue pending provision:', err);
    }
}

/**
 * Process pending provisions — called every 5 minutes.
 */
export async function processPendingProvisions(): Promise<number> {
    const db = getDb();
    let processed = 0;

    try {
        const pending = db.prepare(
            `SELECT * FROM pending_provisions
             WHERE attempts < 10 AND next_retry_at <= datetime('now')
             ORDER BY created_at ASC LIMIT 20`,
        ).all() as any[];

        for (const item of pending) {
            const payload = JSON.parse(item.payload);
            let success = false;

            try {
                if (item.action === 'provision_user' && item.product === 'windy_mail') {
                    const resp = await fetchWithRetry(`${process.env.WINDYMAIL_API_URL}/api/v1/webhooks/identity/created`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '',
                        },
                        body: JSON.stringify({
                            windy_identity_id: item.identity_id,
                            email: payload.email,
                            display_name: payload.name,
                            creator_name: payload.name,
                        }),
                    }, 1); // Single attempt per retry cycle
                    success = resp.ok;
                } else if (item.action === 'provision_agent') {
                    // Re-attempt full agent provision
                    const result = await provisionAgent(
                        item.identity_id, payload.agentName,
                        payload.ownerUserId, payload.ownerEmail,
                    );
                    success = result.eternitas === 'ok';
                } else if (item.action === 'provision_agent_chat') {
                    // Re-attempt chat-only step
                    const chatRes = await fetchWithRetry(`${config.WINDY_CHAT_URL}/api/v1/onboarding/agent`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.CHAT_SERVICE_TOKEN}`,
                        },
                        body: JSON.stringify({
                            passport_number: payload.passportNumber,
                            agent_name: payload.agentName,
                            owner_windy_identity_id: payload.ownerUserId,
                        }),
                    }, 1);
                    success = chatRes.ok;
                }
            } catch {
                success = false;
            }

            if (success) {
                db.prepare('DELETE FROM pending_provisions WHERE id = ?').run(item.id);
                processed++;
            } else {
                // Exponential backoff: 5min, 10min, 20min, 40min, ...
                const backoffMinutes = Math.min(5 * Math.pow(2, item.attempts), 1440); // cap at 24h
                db.prepare(
                    `UPDATE pending_provisions SET attempts = attempts + 1, next_retry_at = datetime('now', '+${backoffMinutes} minutes') WHERE id = ?`,
                ).run(item.id);
            }
        }
    } catch (err) {
        console.error('[Ecosystem] processPendingProvisions error:', err);
    }

    return processed;
}

/**
 * Start the background retry timer.
 */
export function startRetryWorker(): void {
    if (retryTimer) return;
    retryTimer = setInterval(async () => {
        const count = await processPendingProvisions();
        if (count > 0) console.log(`[Ecosystem] Processed ${count} pending provisions`);
    }, PENDING_RETRY_INTERVAL_MS);
    console.log('[Ecosystem] Retry worker started (every 5 minutes)');
}

/**
 * Stop the background retry timer.
 */
export function stopRetryWorker(): void {
    if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
    }
}
