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
        maxRecordingMinutes: 60,
        maxDevices: 5,
        cloudSync: true,
        translation: false,
        speechTranslation: false,
        voiceClone: true,
        videoRecording: true,
        offlinePacks: true,
        prioritySupport: true,
        priceCents: 4900,
    },
    translate: {
        maxRecordingMinutes: 30,
        maxDevices: 5,
        cloudSync: true,
        translation: true,
        speechTranslation: true,
        voiceClone: false,
        videoRecording: false,
        offlinePacks: true,
        prioritySupport: false,
        priceCents: 7900,
    },
    translate_pro: {
        maxRecordingMinutes: 60,
        maxDevices: 5,
        cloudSync: true,
        translation: true,
        speechTranslation: true,
        voiceClone: true,
        videoRecording: true,
        offlinePacks: true,
        prioritySupport: true,
        priceCents: 14900,
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
