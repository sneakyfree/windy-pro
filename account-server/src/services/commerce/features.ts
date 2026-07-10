/**
 * Commerce feature registry — the namespaced entitlement slugs, how multiple
 * grants of the same feature combine, the free-forever baseline caps, and the
 * mapping from a storage entitlement to windy-cloud's tier namespace.
 *
 * Free-tier caps are the ONE real free COGS surface (millions of free users
 * must not run up a bill) — they are hard server-side numbers, served in the
 * catalog payload so clients never hardcode them.
 */

export const GB = 1024 * 1024 * 1024;

export type FeatureKey = string;

export interface FeatureSpec {
    /** How concurrent active grants combine: capacity = max, allowance = sum. */
    resolution: 'max' | 'sum';
    unit: string;
    /** Free-forever baseline (0 = locked without an entitlement). */
    freeLimit: number;
    /** Human-readable name for lock/unlock messaging. */
    label: string;
}

/**
 * Known quota features. `feature.<name>` boolean flags (P5 granularity) are
 * accepted without registration: resolution=max, freeLimit=0, unit='flag'.
 */
export const FEATURES: Record<FeatureKey, FeatureSpec> = {
    // Capacity — take the single best active grant.
    'storage.bytes': { resolution: 'max', unit: 'bytes', freeLimit: 524288000, label: 'Cloud storage' },
    // Monthly allowances — top-ups stack.
    'stt.cloud_minutes': { resolution: 'sum', unit: 'minutes/mo', freeLimit: 15, label: 'Cloud transcription minutes' },
    'translate.chars': { resolution: 'sum', unit: 'chars/mo', freeLimit: 20000, label: 'Cloud translation characters' },
    'agent.messages': { resolution: 'sum', unit: 'messages/mo', freeLimit: 100, label: 'Agent messages' },
};

export function featureSpec(feature: FeatureKey): FeatureSpec {
    const known = FEATURES[feature];
    if (known) return known;
    if (feature.startsWith('feature.')) {
        return { resolution: 'max', unit: 'flag', freeLimit: 0, label: feature.slice('feature.'.length).replace(/_/g, ' ') };
    }
    // Unknown quota slug — treat as a locked-by-default capacity.
    return { resolution: 'max', unit: 'units', freeLimit: 0, label: feature };
}

/**
 * windy-cloud's own tier namespace (user_plans.quota_bytes is what its quota
 * gate enforces; /api/v1/billing/allocate maps tier→bytes server-side there:
 * free 5GB / pro 100GB / ultra 1TB / max 5TB). We derive the cloud tier from
 * the user's effective storage.bytes entitlement.
 */
export function cloudTierForStorageBytes(bytes: number): 'free' | 'pro' | 'ultra' | 'max' {
    if (bytes >= 5 * 1024 * GB) return 'max';
    if (bytes >= 1024 * GB) return 'ultra';
    if (bytes >= 100 * GB) return 'pro';
    return 'free';
}

/** Human-readable size for lock/unlock messages ("100 GB", "500 MB"). */
export function humanBytes(bytes: number): string {
    if (bytes >= GB) return `${Math.round(bytes / GB)} GB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function humanLimit(feature: FeatureKey, limit: number): string {
    const spec = featureSpec(feature);
    if (spec.unit === 'bytes') return humanBytes(limit);
    if (spec.unit === 'flag') return limit > 0 ? 'on' : 'off';
    return `${limit.toLocaleString('en-US')} ${spec.unit}`;
}
