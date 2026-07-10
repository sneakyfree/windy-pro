/**
 * [A1] Regression test — credential-broker tier resolution.
 *
 * A CONFIRMED launch-blocker (hardening pass 2026-07-09): POST /api/v1/license/activate
 * derived a paid tier from an unbacked, attacker-controlled WP- key (tierFromKey) and wrote
 * it to users.license_tier, which the broker ranked ABOVE the Stripe-verified users.tier —
 * so a fabricated key self-granted paid LLM access billed to Windy's provider accounts.
 *
 * Invariant guarded here: license_tier must NEVER elevate. Paid tier comes only from the
 * Stripe-verified `tier` (or a trusted server override); the only license_tier signal
 * honored is the admin 'revoked' kill-switch.
 */
import { resolveEffectiveTier } from '../services/credential-broker';

describe('A1 — resolveEffectiveTier: license_tier must never elevate', () => {
    it('a fabricated license key on a free account stays free (the exploit)', () => {
        expect(resolveEffectiveTier('pro', 'free')).toBe('free');
    });

    it('a paying user cannot self-upgrade via a forged license key', () => {
        expect(resolveEffectiveTier('max', 'pro')).toBe('pro');
    });

    it('a Stripe-verified paid tier is honored', () => {
        expect(resolveEffectiveTier(null, 'pro')).toBe('pro');
    });

    it('a free user with no license is free', () => {
        expect(resolveEffectiveTier(null, 'free')).toBe('free');
    });

    it("the admin 'revoked' sentinel forces free (kill-switch preserved)", () => {
        expect(resolveEffectiveTier('revoked', 'pro')).toBe('free');
    });

    it('a trusted server-side override keeps its top precedence', () => {
        expect(resolveEffectiveTier('pro', 'free', 'max')).toBe('max');
    });

    it('undefined/null tiers default to free', () => {
        expect(resolveEffectiveTier(undefined, undefined)).toBe('free');
    });
});
