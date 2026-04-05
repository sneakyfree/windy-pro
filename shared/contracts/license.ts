/**
 * @windy-pro/contracts — License tier definitions
 *
 * Single source of truth for license tiers, feature gating, and recording limits.
 * Replaces three separate implementations: desktop license.js, mobile license.ts,
 * and server getTierLimits.
 */

export type LicenseTier = 'free' | 'pro' | 'translate' | 'translate_pro';

export interface LicenseValidation {
    key: string;
    tier: LicenseTier;
    validUntil: string | null;
    devicesUsed: number;
    devicesMax: number;
    features: string[];
}

export const LICENSE_KEY_REGEX = /^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * Tier prefix → tier mapping for license key activation.
 * WP-T... → translate, WP-U... → translate_pro, anything else → pro.
 */
export const KEY_PREFIX_TIER: Record<string, LicenseTier> = {
    'WP-T': 'translate',
    'WP-U': 'translate_pro',
};

export interface TierFeatures {
    maxRecordingMinutes: number;
    maxDevices: number;
    cloudSync: boolean;
    translation: boolean;
    speechTranslation: boolean;
    voiceClone: boolean;
    videoRecording: boolean;
    offlinePacks: boolean;
    prioritySupport: boolean;
    /** Price in cents (one-time or monthly depending on tier) */
    priceCents: number;
}

/**
 * Feature matrix — determines what each tier can do.
 */
export const TIER_FEATURES: Record<LicenseTier, TierFeatures> = {
    free: {
        maxRecordingMinutes: 5,
        maxDevices: 5,
        cloudSync: false,
        translation: false,
        speechTranslation: false,
        voiceClone: false,
        videoRecording: false,
        offlinePacks: false,
        prioritySupport: false,
        priceCents: 0,
    },
    pro: {
        maxRecordingMinutes: 15,   // Bible v2: 15 min cloud recording
        maxDevices: 3,             // Bible v2: 3 devices
        cloudSync: true,
        translation: false,
        speechTranslation: false,
        voiceClone: false,         // Bible v2: No voice clone at Pro
        videoRecording: true,      // Bible v2: Video recording ✅
        offlinePacks: true,        // Bible v2: 5 offline engines
        prioritySupport: false,    // Bible v2: Priority support = Max only
        priceCents: 499,           // Bible v2: $4.99/mo
    },
    translate: {
        maxRecordingMinutes: 30,   // Bible v2: 30 min cloud recording
        maxDevices: 5,             // Bible v2: 5 devices
        cloudSync: true,
        translation: true,
        speechTranslation: true,
        voiceClone: false,         // Bible v2: No voice clone at Ultra
        videoRecording: true,      // Bible v2: Video recording ✅
        offlinePacks: true,        // Bible v2: 25 offline engines
        prioritySupport: false,    // Bible v2: Priority support = Max only
        priceCents: 899,           // Bible v2: $8.99/mo
    },
    translate_pro: {
        maxRecordingMinutes: 60,   // Bible v2: 60 min cloud recording
        maxDevices: 10,            // Bible v2: 10 devices
        cloudSync: true,
        translation: true,
        speechTranslation: true,
        voiceClone: true,          // Bible v2: Voice clone ✅
        videoRecording: true,      // Bible v2: Video recording ✅
        offlinePacks: true,        // Bible v2: 100 offline engines
        prioritySupport: true,     // Bible v2: Priority support ✅
        priceCents: 1499,          // Bible v2: $14.99/mo
    },
};

/**
 * Determine tier from license key prefix.
 */
export function tierFromKey(key: string): LicenseTier {
    for (const [prefix, tier] of Object.entries(KEY_PREFIX_TIER)) {
        if (key.startsWith(prefix)) return tier;
    }
    return 'pro';
}

// ─── Cross-Product Tier Mapping ─────────────────────────────
// Canonical tier enum used by the identity hub to normalize tier names
// across all Windy products. Each product may use its own naming, but
// validate-token and the identity API always return a CanonicalTier.

/** Canonical tiers recognized by the Windy identity hub */
export type CanonicalTier = 'free' | 'pro' | 'translate' | 'translate_pro' | 'enterprise';

/** Maps product-specific tier strings to the canonical tier enum */
export const TIER_MAPPING: Record<string, CanonicalTier> = {
    // Windy Pro (desktop/server canonical names)
    'free': 'free',
    'pro': 'pro',
    'translate': 'translate',
    'translate_pro': 'translate_pro',
    // Mobile variants (hyphenated)
    'translate-pro': 'translate_pro',
    // Legacy aliases
    'ultra': 'translate',
    'max': 'translate_pro',
    // Windy Mail tier
    'enterprise': 'enterprise',
};

/**
 * Normalize any product-specific tier string to a canonical tier.
 * Returns 'free' for unrecognized values.
 */
export function normalizeProductTier(tier: string): CanonicalTier {
    return TIER_MAPPING[tier.toLowerCase()] ?? 'free';
}
