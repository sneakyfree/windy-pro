/**
 * Windy Search client singleton — behavioral tests.
 *
 * Per master plan §2 V1 hard gate, account-server is configured to
 * talk to Windy Search at boot but may not have an EPT issued in
 * every environment yet. The singleton accessor must:
 *
 *   - return `null` when WINDY_SEARCH_EPT is empty (so routes can
 *     503 gracefully rather than crash)
 *   - return a working WindySearchClient when both env vars are set
 *   - cache the instance across calls within a process
 *
 * Tests use `resetWindySearchClient()` + `jest.resetModules()` to get
 * a clean cache + a fresh `config` import between cases.
 */

describe('getWindySearchClient singleton', () => {
    const originalBase = process.env.WINDY_SEARCH_BASE_URL;
    const originalEpt = process.env.WINDY_SEARCH_EPT;

    afterEach(() => {
        jest.resetModules();
        // restore env
        if (originalBase !== undefined) process.env.WINDY_SEARCH_BASE_URL = originalBase;
        else delete process.env.WINDY_SEARCH_BASE_URL;
        if (originalEpt !== undefined) process.env.WINDY_SEARCH_EPT = originalEpt;
        else delete process.env.WINDY_SEARCH_EPT;
    });

    it('returns null when WINDY_SEARCH_EPT is unset', () => {
        process.env.WINDY_SEARCH_BASE_URL = 'https://api.windysearch.com';
        delete process.env.WINDY_SEARCH_EPT;

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getWindySearchClient } = require('../services/search');
        expect(getWindySearchClient()).toBeNull();
    });

    it('returns a WindySearchClient when both env vars are set', () => {
        process.env.WINDY_SEARCH_BASE_URL = 'https://api.windysearch.com';
        process.env.WINDY_SEARCH_EPT = 'fake-jwt';

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getWindySearchClient, WindySearchClient } = require('../services/search');
        const client = getWindySearchClient();
        expect(client).not.toBeNull();
        expect(client).toBeInstanceOf(WindySearchClient);
    });

    it('caches the same instance across calls', () => {
        process.env.WINDY_SEARCH_BASE_URL = 'https://api.windysearch.com';
        process.env.WINDY_SEARCH_EPT = 'fake-jwt';

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getWindySearchClient } = require('../services/search');
        const first = getWindySearchClient();
        const second = getWindySearchClient();
        expect(first).toBe(second);
    });

    it('config defaults WINDY_SEARCH_BASE_URL to https://api.windysearch.com', () => {
        delete process.env.WINDY_SEARCH_BASE_URL;

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config } = require('../config');
        expect(config.WINDY_SEARCH_BASE_URL).toBe('https://api.windysearch.com');
    });

    it('config defaults WINDY_SEARCH_EPT to empty string', () => {
        delete process.env.WINDY_SEARCH_EPT;

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config } = require('../config');
        expect(config.WINDY_SEARCH_EPT).toBe('');
    });
});
