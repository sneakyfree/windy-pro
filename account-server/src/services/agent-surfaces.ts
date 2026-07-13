// agent-surfaces.ts — the cloud twin of ~/.windy/surfaces.json (ADR-060 §3.8).
//
// A local agent reads surfaces.json to enumerate every knob on the box. A
// hosted agent can't read a file on grandma's laptop — so account-server, the
// identity spine, answers the cloud equivalent: "what cloud ops surfaces does
// THIS human run?" One authenticated query → every cloud knob they own, so a
// hosted Fable can land, enumerate, and heal without a per-product handshake.
//
// This registry maps a product_accounts `product` name to its ops MCP surface
// descriptor. It is a STATIC catalog of the platforms' Loom-woven ops shims
// (Class C, streamable-HTTP MCP at /mcp, EPT-authed). Endpoints are the
// canonical deploy targets; a platform whose shim isn't live yet still lists
// (so the agent knows it exists) — the reader probes before trusting, exactly
// like the local file's stale-entry handling.
//
// Contracts (the ops.mcp.v1 manifests) are canon in each platform's repo and
// mirrored in sneakyfree/windy-contracts. No secrets here — endpoints only.

export interface OpsSurface {
  product: string;      // canonical dev-name (matches the ops manifest `product`)
  contract: string;     // e.g. "ops.mcp.v1"
  mcp: string;          // remote MCP endpoint (streamable-http)
  class: 'cloud';       // every entry here is Class C
}

// Keyed by the product_accounts.product value used in this DB.
const OPS_SURFACES: Record<string, OpsSurface> = {
  windy_mail: { product: 'windy-mail', contract: 'ops.mcp.v1', mcp: 'https://mail.windymail.ai/mcp', class: 'cloud' },
  windy_chat: { product: 'windy-chat', contract: 'ops.mcp.v1', mcp: 'https://chat.windychat.ai/mcp', class: 'cloud' },
  windy_cloud: { product: 'windy-cloud', contract: 'ops.mcp.v1', mcp: 'https://cloud.windycloud.com/mcp', class: 'cloud' },
  // Products commonly provisioned per-human that ship a Loom-woven ops shim.
  // (windy_mind / windy_search / windy_clone / windy_drops appear when the
  // user holds them; unknown products are simply omitted, never guessed.)
  windy_mind: { product: 'windy-mind', contract: 'ops.mcp.v1', mcp: 'https://api.windymind.ai/mcp', class: 'cloud' },
  windy_search: { product: 'windy-search', contract: 'ops.mcp.v1', mcp: 'https://api.windysearch.com/mcp', class: 'cloud' },
  windy_clone: { product: 'windy-clone', contract: 'ops.mcp.v1', mcp: 'https://windyclone.ai/mcp', class: 'cloud' },
  windy_drops: { product: 'windy-registry', contract: 'ops.mcp.v1', mcp: 'https://api.windydrops.com/mcp', class: 'cloud' },
};

// Given the products a human holds/operates, return the cloud ops surfaces
// they can heal. Products with no known ops shim (windy_pro, windy_fly,
// eternitas — a separate entity) are omitted rather than guessed.
export function opsSurfacesForProducts(
  products: { product: string; status: string }[],
): OpsSurface[] {
  const seen = new Set<string>();
  const out: OpsSurface[] = [];
  for (const p of products) {
    // Only surface products the user actually has (any provisioned status —
    // even a degraded one is worth an agent's attention).
    const surface = OPS_SURFACES[p.product];
    if (surface && !seen.has(surface.product)) {
      seen.add(surface.product);
      out.push(surface);
    }
  }
  return out;
}

export const KNOWN_OPS_PRODUCTS = Object.keys(OPS_SURFACES);
