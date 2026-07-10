/**
 * windy-cloud provisioner — pushes a user's storage tier to windy-cloud's
 * service-token allocate endpoint. Cloud's quota gate enforces its OWN
 * user_plans.quota_bytes (never a JWT claim), and POST /api/v1/billing/allocate
 * is the one channel that sets it (tier→bytes mapping happens cloud-side:
 * free 5GB / pro 100GB / ultra 1TB / max 5TB).
 *
 * Fail-soft: a cloud outage during purchase must not fail the purchase —
 * the caller records the miss (users.cloud_tier_pushed stays stale) and the
 * maintenance sweep converges it later. Inert unless WINDY_CLOUD_URL +
 * WINDY_CLOUD_SERVICE_TOKEN are configured (dev/test default).
 */
import { config } from '../../config';

const TIMEOUT_MS = 5000;

export function cloudProvisionerConfigured(): boolean {
    return !!(config.WINDY_CLOUD_URL && config.WINDY_CLOUD_SERVICE_TOKEN);
}

/**
 * Returns true when the allocation is confirmed pushed (or provisioning is
 * intentionally disabled in this environment); false = retry later.
 */
export async function allocateCloudTier(windyIdentityId: string, tier: 'free' | 'pro' | 'ultra' | 'max'): Promise<boolean> {
    if (!cloudProvisionerConfigured()) {
        // Dev/test without a cloud: treat as pushed so local flows complete.
        return true;
    }
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const resp = await fetch(`${config.WINDY_CLOUD_URL}/api/v1/billing/allocate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Token': config.WINDY_CLOUD_SERVICE_TOKEN,
            },
            body: JSON.stringify({ windy_identity_id: windyIdentityId, tier }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
            console.warn(`[Commerce] cloud allocate ${tier} for ${windyIdentityId.slice(0, 8)}… -> HTTP ${resp.status}`);
            return false;
        }
        return true;
    } catch (err: any) {
        console.warn(`[Commerce] cloud allocate failed (will retry via sweep): ${err?.message || err}`);
        return false;
    }
}
