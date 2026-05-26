/**
 * Apple Sign In — domain ownership verification endpoint.
 *
 * Apple's portal fetches /.well-known/apple-developer-domain-association.txt
 * during Services ID configuration. The file contents come from the
 * APPLE_DOMAIN_ASSOCIATION env var; route 404s when unset so random
 * crawlers don't see "configured but empty".
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

jest.setTimeout(15000);

describe('/.well-known/apple-developer-domain-association.txt', () => {
    const origValue = process.env.APPLE_DOMAIN_ASSOCIATION;
    afterAll(() => {
        if (origValue === undefined) delete process.env.APPLE_DOMAIN_ASSOCIATION;
        else process.env.APPLE_DOMAIN_ASSOCIATION = origValue;
    });

    test('returns 404 when APPLE_DOMAIN_ASSOCIATION is unset', async () => {
        delete process.env.APPLE_DOMAIN_ASSOCIATION;
        const res = await request(app).get('/.well-known/apple-developer-domain-association.txt');
        expect(res.status).toBe(404);
    });

    test('returns the configured string verbatim as text/plain when set', async () => {
        const verificationString = 'apple-developer-verification-1234567890abcdef';
        process.env.APPLE_DOMAIN_ASSOCIATION = verificationString;
        const res = await request(app).get('/.well-known/apple-developer-domain-association.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe(verificationString);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    test('emits a short cache so re-verification picks up env changes', async () => {
        process.env.APPLE_DOMAIN_ASSOCIATION = 'cache-header-probe';
        const res = await request(app).get('/.well-known/apple-developer-domain-association.txt');
        expect(res.headers['cache-control']).toMatch(/max-age=60/);
    });
});
