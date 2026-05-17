/**
 * Windy Search V1 client — account-server's canonical web-search egress.
 *
 * Per the Windy Search master plan §2 (V1 hard gate), every Windy
 * product must route web search through `api.windysearch.com` rather
 * than calling Brave / Google / etc directly. account-server is one
 * of the 10 products covered by that hard gate.
 *
 * V1 status — preemptive wiring:
 *   account-server has no current web-search callsite. The
 *   `/api/v1/translate` route brokers LLM calls through Mind but does
 *   not retrieve web context today. This module ships the client now
 *   so that whenever account-server grows a web-grounding surface
 *   (translate-with-citations, agent-host search proxy, admin-console
 *   research shortcut), it defaults through Windy Search rather than
 *   re-implementing Brave/Google bridges inline.
 *
 * Wire shape (mirrors `windy-agent/src/windyfly/tools/windy_search_client.py`
 * and `windy-mind/api/app/clients/windy_search.py`):
 *
 *     POST {WINDY_SEARCH_BASE_URL}/v1/search
 *     Authorization: Bearer {WINDY_SEARCH_EPT}
 *     Content-Type: application/json
 *
 *     {"query": "...", "max_results": 10}
 *
 * The EPT is account-server's own service-account Eternitas Passport —
 * the same trust-tier model as every other ecosystem peer call. The
 * Search service verifies the JWT via Eternitas JWKS and resolves the
 * EI tier to rate-limit and cost-cap the call.
 *
 * Both `baseUrl` and `serviceEpt` must be non-empty for the client to
 * instantiate. Static `isConfigured()` lets callers no-op gracefully
 * when account-server hasn't been issued an EPT yet rather than
 * crash boot.
 */

// ─── Wire types (mirror windy-search/service/app/types.py) ─────────

export interface SearchResultProvenance {
    source: string;                       // "own_corpus" | "bridge:brave" | ...
    indexed_at?: string | null;
    fetched_at?: string | null;
    domain_ei?: number | null;
    agent_friendliness_score?: number | null;
}

export interface SearchResult {
    url: string;
    title: string;
    snippet: string;
    rank: number;
    _provenance: SearchResultProvenance;
}

export interface SearchStats {
    own_corpus_results: number;
    bridge_results: number;
    bridges_used: string[];
    ms_total: number;
}

export interface SearchResponse {
    id: string;
    results: SearchResult[];
    stats: SearchStats;
    /**
     * Set only on degraded responses (wire / HTTP errors). Successful
     * responses do not carry this field; callers should check
     * `'error' in response` before treating results as authoritative.
     */
    error?: string;
}

export interface SearchAgentContext {
    purpose?: string;       // free-form intent label
    user_locale?: string;   // BCP-47 (e.g. "en-US")
}

export interface SearchRequest {
    query: string;
    max_results?: number;
    agent_context?: SearchAgentContext;
}

export class WindySearchClientError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WindySearchClientError';
    }
}

// ─── Client ────────────────────────────────────────────────────────

export interface WindySearchClientOptions {
    baseUrl: string;
    serviceEpt: string;
    timeoutMs?: number;
    /**
     * Optional injection point so tests can pass a jest mock without
     * stubbing global fetch.
     */
    fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Stateless wrapper around `POST /v1/search` and `POST /web/fetch` on
 * api.windysearch.com. Safe to share across requests.
 */
export class WindySearchClient {
    private readonly baseUrl: string;
    private readonly ept: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(opts: WindySearchClientOptions) {
        if (!opts.baseUrl) {
            throw new WindySearchClientError('baseUrl required');
        }
        if (!opts.serviceEpt) {
            throw new WindySearchClientError('serviceEpt required');
        }
        this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
        this.ept = opts.serviceEpt;
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }

    /**
     * Both inputs must be non-empty for the client to be usable.
     * Helper used by server bootstrap so account-server can ship
     * without Search wired and the route layer can fall back / 503
     * gracefully.
     */
    static isConfigured(baseUrl: string | undefined, serviceEpt: string | undefined): boolean {
        return Boolean(baseUrl) && Boolean(serviceEpt);
    }

    /**
     * Search the open web via Windy Search V1.
     *
     * Returns the normalized SearchResponse shape on success. On
     * HTTP / network errors, returns a degraded shape with `error`
     * set and `results=[]` so callers can decide whether to surface
     * the failure or silently fall through to "no grounding available".
     *
     * The Windy Search wire contract is documented at
     * https://api.windysearch.com/docs.
     */
    async search(req: SearchRequest): Promise<SearchResponse> {
        const body: Record<string, unknown> = {
            query: req.query,
            max_results: req.max_results ?? 10,
        };
        if (req.agent_context && (req.agent_context.purpose || req.agent_context.user_locale)) {
            body.agent_context = req.agent_context;
        }

        return this.postJson<SearchResponse>('/v1/search', body, this.degradedSearchResponse.bind(this));
    }

    /**
     * Fetch a URL via Windy Search's SSRF-hardened /web/fetch.
     *
     * Same auth + degraded-shape semantics as `.search()`.
     */
    async fetchUrl(opts: {
        url: string;
        maxChars?: number;
        offset?: number;
    }): Promise<{ url: string; content: string; error?: string } & Record<string, unknown>> {
        const body = {
            url: opts.url,
            max_chars: opts.maxChars ?? 20000,
            offset: opts.offset ?? 0,
        };
        return this.postJson(
            '/web/fetch',
            body,
            (err) => ({ url: opts.url, content: '', error: err }),
        );
    }

    // ─── Internals ──────────────────────────────────────────────

    private async postJson<T>(
        path: string,
        body: unknown,
        degrade: (err: string) => T,
    ): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.ept}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'windy-pro-account-server/1.0 (+windy-search-client)',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return degrade(`HTTP ${res.status}: ${text.slice(0, 200)}`);
            }
            return await res.json() as T;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return degrade(msg);
        } finally {
            clearTimeout(timer);
        }
    }

    private degradedSearchResponse(error: string): SearchResponse {
        return {
            id: '',
            results: [],
            error,
            stats: {
                own_corpus_results: 0,
                bridge_results: 0,
                bridges_used: [],
                ms_total: 0,
            },
        };
    }
}
