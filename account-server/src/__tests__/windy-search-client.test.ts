/**
 * Windy Search V1 client — unit tests.
 *
 * Per master plan §2 V1 hard gate: account-server's outbound to
 * api.windysearch.com is THE canonical web-search egress. These tests
 * verify the wire shape (Bearer EPT header, JSON body, /v1/search vs
 * /web/fetch endpoints) and degraded-shape behavior on HTTP / network
 * errors.
 *
 * Strategy: inject a jest-mock fetchImpl into the client so we never
 * touch the network. Mirrors the python httpx.MockTransport pattern
 * used in windy-mind/api/tests/clients/test_windy_search.py.
 */
import {
    WindySearchClient,
    WindySearchClientError,
    type SearchResponse,
} from '../services/search/windy-search-client';

const BASE_URL = 'https://api.windysearch.com';
const EPT = 'fake-jwt-for-tests';

function okResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function errorResponse(status: number, text = 'error'): Response {
    return new Response(text, { status });
}

describe('WindySearchClient.isConfigured', () => {
    it('returns true only when both values are non-empty', () => {
        expect(WindySearchClient.isConfigured(BASE_URL, EPT)).toBe(true);
        expect(WindySearchClient.isConfigured('', EPT)).toBe(false);
        expect(WindySearchClient.isConfigured(BASE_URL, '')).toBe(false);
        expect(WindySearchClient.isConfigured(undefined, undefined)).toBe(false);
    });
});

describe('WindySearchClient constructor', () => {
    it('throws WindySearchClientError when baseUrl is empty', () => {
        expect(() => new WindySearchClient({ baseUrl: '', serviceEpt: EPT })).toThrow(
            WindySearchClientError,
        );
    });

    it('throws WindySearchClientError when serviceEpt is empty', () => {
        expect(() => new WindySearchClient({ baseUrl: BASE_URL, serviceEpt: '' })).toThrow(
            WindySearchClientError,
        );
    });

    it('strips trailing slashes from baseUrl', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                id: 'srch_1',
                results: [],
                stats: { own_corpus_results: 0, bridge_results: 0, bridges_used: [], ms_total: 1 },
            }),
        );
        const client = new WindySearchClient({
            baseUrl: 'https://api.windysearch.com/',
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        await client.search({ query: 'x' });
        const url = fetchMock.mock.calls[0][0] as string;
        // Should be exactly one slash between host and path
        expect(url).toBe('https://api.windysearch.com/v1/search');
    });
});

describe('WindySearchClient.search', () => {
    it('sends Bearer EPT + JSON body to /v1/search', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                id: 'srch_abc',
                results: [
                    {
                        url: 'https://example.com',
                        title: 'Example',
                        snippet: 'hello',
                        rank: 1,
                        _provenance: { source: 'bridge:brave' },
                    },
                ],
                stats: {
                    own_corpus_results: 0,
                    bridge_results: 1,
                    bridges_used: ['bridge:brave'],
                    ms_total: 42,
                },
            }),
        );

        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        const response = await client.search({ query: 'windy ecosystem', max_results: 5 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE_URL}/v1/search`);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe(`Bearer ${EPT}`);
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ query: 'windy ecosystem', max_results: 5 });

        expect(response.id).toBe('srch_abc');
        expect(response.results).toHaveLength(1);
        expect(response.results[0].url).toBe('https://example.com');
        expect(response.stats.bridges_used).toEqual(['bridge:brave']);
        expect((response as SearchResponse).error).toBeUndefined();
    });

    it('defaults max_results to 10 when omitted', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                id: 'srch_x',
                results: [],
                stats: { own_corpus_results: 0, bridge_results: 0, bridges_used: [], ms_total: 1 },
            }),
        );
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        await client.search({ query: 'x' });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.max_results).toBe(10);
    });

    it('includes agent_context when purpose or user_locale is set', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                id: 'srch_y',
                results: [],
                stats: { own_corpus_results: 0, bridge_results: 0, bridges_used: [], ms_total: 1 },
            }),
        );
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        await client.search({
            query: 'cafes near me',
            agent_context: { purpose: 'find_a_place', user_locale: 'en-US' },
        });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.agent_context).toEqual({ purpose: 'find_a_place', user_locale: 'en-US' });
    });

    it('omits agent_context when both purpose and user_locale are absent', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                id: 'srch_z',
                results: [],
                stats: { own_corpus_results: 0, bridge_results: 0, bridges_used: [], ms_total: 1 },
            }),
        );
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        await client.search({ query: 'x', agent_context: {} });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).not.toHaveProperty('agent_context');
    });

    it('degrades to {results:[], error} on HTTP 429', async () => {
        const fetchMock = jest.fn().mockResolvedValue(errorResponse(429, 'rate limited'));
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        const response = await client.search({ query: 'x' });
        expect(response.id).toBe('');
        expect(response.results).toEqual([]);
        expect(response.error).toContain('429');
        expect(response.stats.ms_total).toBe(0);
    });

    it('degrades to {results:[], error} on network failure', async () => {
        const fetchMock = jest.fn().mockRejectedValue(new Error('connection refused'));
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        const response = await client.search({ query: 'x' });
        expect(response.id).toBe('');
        expect(response.results).toEqual([]);
        expect(response.error).toContain('connection refused');
    });
});

describe('WindySearchClient.fetchUrl', () => {
    it('hits /web/fetch with the right body', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            okResponse({
                url: 'https://example.com',
                content: 'hello world',
                total_chars: 11,
                truncated: false,
            }),
        );
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        const response = await client.fetchUrl({ url: 'https://example.com' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE_URL}/web/fetch`);
        const body = JSON.parse(init.body);
        expect(body).toEqual({
            url: 'https://example.com',
            max_chars: 20000,
            offset: 0,
        });
        expect(response.content).toBe('hello world');
    });

    it('degrades with {content:"", error} on failure', async () => {
        const fetchMock = jest.fn().mockResolvedValue(errorResponse(500));
        const client = new WindySearchClient({
            baseUrl: BASE_URL,
            serviceEpt: EPT,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        const response = await client.fetchUrl({ url: 'https://example.com' });
        expect(response.content).toBe('');
        expect(response.error).toContain('500');
    });
});
