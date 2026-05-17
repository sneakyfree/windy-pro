/**
 * Windy Search service module — public surface for account-server.
 *
 * Exports the `WindySearchClient` class for direct use plus a lazy
 * singleton `getWindySearchClient()` that reads `config.WINDY_SEARCH_*`
 * the first time it's called and returns `null` when account-server is
 * not configured to talk to Search.
 *
 * Usage from a route:
 *
 *     import { getWindySearchClient } from '../services/search';
 *
 *     const search = getWindySearchClient();
 *     if (!search) {
 *         return res.status(503).json({ error: 'Search not configured' });
 *     }
 *     const results = await search.search({ query: 'windy ecosystem' });
 *
 * The null-return contract is intentional: per master plan §2 V1 hard
 * gate, account-server is opted into Search but the EPT may not yet be
 * issued in every environment. Routes should handle the unconfigured
 * case explicitly rather than crash.
 */
import { config } from '../../config';
import { WindySearchClient } from './windy-search-client';

let cachedClient: WindySearchClient | null | undefined;

/**
 * Returns the singleton client, or `null` if either env var is unset.
 * The singleton is constructed once per process; tests that need a
 * fresh instance should call `resetWindySearchClient()` first.
 */
export function getWindySearchClient(): WindySearchClient | null {
    if (cachedClient !== undefined) return cachedClient;
    if (!WindySearchClient.isConfigured(config.WINDY_SEARCH_BASE_URL, config.WINDY_SEARCH_EPT)) {
        cachedClient = null;
        return cachedClient;
    }
    cachedClient = new WindySearchClient({
        baseUrl: config.WINDY_SEARCH_BASE_URL,
        serviceEpt: config.WINDY_SEARCH_EPT,
    });
    return cachedClient;
}

/**
 * Test-only — clear the cached singleton so the next `getWindySearchClient`
 * call re-reads config. Production code never calls this.
 */
export function resetWindySearchClient(): void {
    cachedClient = undefined;
}

export {
    WindySearchClient,
    WindySearchClientError,
    type SearchRequest,
    type SearchResponse,
    type SearchResult,
    type SearchStats,
    type SearchAgentContext,
    type WindySearchClientOptions,
} from './windy-search-client';
