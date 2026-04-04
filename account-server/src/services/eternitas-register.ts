/**
 * Eternitas Platform Registration — runs on account-server startup.
 * Registers Windy Pro as an Eternitas platform so we receive webhook events
 * (passport.revoked, passport.suspended, passport.reinstated).
 * Idempotent: skips if already registered.
 */
import { getDb } from '../db/schema';
import { config } from '../config';

export async function registerWithEternitas(): Promise<void> {
  const db = getDb();

  // Check if already registered
  const existing = db.prepare(
    "SELECT value FROM app_settings WHERE key = 'eternitas_platform_id'",
  ).get() as { value: string } | undefined;

  if (existing?.value) {
    console.log(`[Eternitas] Already registered as platform ${existing.value} — skipping`);
    return;
  }

  // Build the webhook URL
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || 'https://account.windypro.com';
  const webhookUrl = `${webhookBaseUrl}/api/v1/identity/webhooks/eternitas`;

  console.log(`[Eternitas] Registering Windy Pro as platform (webhook: ${webhookUrl})...`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${config.ETERNITAS_URL}/api/v1/platforms/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.ETERNITAS_API_KEY ? { 'Authorization': `Bearer ${config.ETERNITAS_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        name: 'Windy Pro',
        webhook_url: webhookUrl,
        events: ['passport.revoked', 'passport.suspended', 'passport.reinstated', 'trust_updated'],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[Eternitas] Registration failed: HTTP ${res.status} — ${body}`);
      return;
    }

    const data = await res.json() as any;
    const platformId = data.platform_id || data.id || 'registered';

    // Store platform_id in DB
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('eternitas_platform_id', ?, datetime('now'))",
    ).run(platformId);

    console.log(`[Eternitas] Registered as platform: ${platformId}`);
  } catch (err: any) {
    console.warn(`[Eternitas] Registration deferred: ${err.message}`);
    // Don't crash — Eternitas might not be running yet
  }
}
