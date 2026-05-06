/**
 * Sprint 1.5 — hatch rate-limiter keyGenerator behavior.
 *
 * Pre-1.5 the hatch endpoint had a single per-IP limiter at 5/min.
 * Hotel WiFi NATs everyone behind one IP, so 200 normies on the
 * ballroom floor would queue ~19 minutes for hatch. Sprint 1.5 split
 * the limiter into two layers; this test pins the user-layer's key
 * derivation so a future "simplify the keyGenerator" refactor can't
 * silently regress to per-IP fallback for authenticated traffic
 * (which would re-introduce the ballroom queue cliff).
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { hatchUserKey } from '../src/routes/agent';

describe('hatchUserKey', () => {
    it('keys by user when req.user.userId is set', () => {
        const req = { user: { userId: 'abc-123' }, ip: '10.0.0.1' };
        expect(hatchUserKey(req)).toBe('user:abc-123');
    });

    it('falls back to IP when req.user is missing', () => {
        const req = { ip: '203.0.113.5' };
        expect(hatchUserKey(req)).toBe('ip:203.0.113.5');
    });

    it('falls back to IP when req.user is present but userId is empty', () => {
        const req = { user: { userId: '' }, ip: '203.0.113.5' };
        expect(hatchUserKey(req)).toBe('ip:203.0.113.5');
    });

    it('falls back to IP when userId is non-string', () => {
        const req = { user: { userId: 42 }, ip: '203.0.113.5' };
        expect(hatchUserKey(req)).toBe('ip:203.0.113.5');
    });

    it('uses literal "unknown" when req has no ip and no user', () => {
        // Defensive — should never happen in practice (Express always
        // populates req.ip), but a missing key is worse than a constant
        // one; constant "unknown" at least has a predictable bucket.
        const req = {};
        expect(hatchUserKey(req)).toBe('ip:unknown');
    });

    it('two different authenticated users get different keys', () => {
        const a = { user: { userId: 'alice' }, ip: '10.0.0.1' };
        const b = { user: { userId: 'bob' }, ip: '10.0.0.1' };
        // Same NAT'd IP, different identities — must hash to different
        // buckets so hotel-WiFi doesn't collapse them.
        expect(hatchUserKey(a)).not.toBe(hatchUserKey(b));
    });
});
