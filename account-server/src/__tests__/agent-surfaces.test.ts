// agent-surfaces — the cloud discovery registry (ADR-060 §3.8).
// Pure mapping logic; no DB. Proves products -> ops surfaces is honest:
// known products map, unknown products are omitted (never guessed), and
// results dedupe.

import { opsSurfacesForProducts, KNOWN_OPS_PRODUCTS } from '../services/agent-surfaces';

describe('opsSurfacesForProducts', () => {
  test('maps known provisioned products to their ops MCP surfaces', () => {
    const out = opsSurfacesForProducts([
      { product: 'windy_mail', status: 'active' },
      { product: 'windy_mind', status: 'active' },
    ]);
    const names = out.map((s) => s.product).sort();
    expect(names).toEqual(['windy-mail', 'windy-mind']);
    for (const s of out) {
      expect(s.contract).toBe('ops.mcp.v1');
      expect(s.mcp).toMatch(/^https:\/\/.+\/mcp$/); // remote streamable-http endpoint
      expect(s.class).toBe('cloud');
    }
  });

  test('omits unknown products rather than guessing an endpoint', () => {
    const out = opsSurfacesForProducts([
      { product: 'windy_pro', status: 'active' },   // no ops shim
      { product: 'windy_fly', status: 'active' },   // agent-host, not cloud
      { product: 'eternitas', status: 'active' },   // separate entity
      { product: 'some_future_thing', status: 'active' },
    ]);
    expect(out).toEqual([]);
  });

  test('dedupes a product that appears twice (direct + operator rows)', () => {
    const out = opsSurfacesForProducts([
      { product: 'windy_mail', status: 'pending' },
      { product: 'windy_mail', status: 'active' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].product).toBe('windy-mail');
  });

  test('drops registry maps to its service dev-name windy-registry', () => {
    const out = opsSurfacesForProducts([{ product: 'windy_drops', status: 'active' }]);
    expect(out[0].product).toBe('windy-registry'); // brand Drops -> service windy-registry
  });

  test('registry has no secrets — endpoints only', () => {
    // KNOWN_OPS_PRODUCTS is a static list; the module exports no credentials.
    expect(KNOWN_OPS_PRODUCTS.length).toBeGreaterThan(0);
    const all = opsSurfacesForProducts(
      KNOWN_OPS_PRODUCTS.map((p) => ({ product: p, status: 'active' })),
    );
    for (const s of all) {
      expect(JSON.stringify(s)).not.toMatch(/token|secret|password|key/i);
    }
  });
});
