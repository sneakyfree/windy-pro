# contracts/ — Windy Translate's agent-OPS manifest

`ops.mcp.v1.json` is the **canonical source of truth** for Windy Translate's
agent-ops surface, governed by the Agent Control Doctrine (**ADR-060** in
`sneakyfree/windy-contracts`).

Windy Translate is an **internal support service** (Node on loopback:8099,
consumed by windy-pro). Product API (`/translate`, `/translate/batch`,
`/detect`) stays out per §2. This contract is health + language coverage +
cache stats.

**Two honest gaps** (the punch list):
1. No `/version` endpoint → MF1 non-compliant (`get_status` is a gap). Add the
   canonical `{service,version,commit_sha,started_at,environment}` shape.
2. No auth today → the ops shim's EPT passthrough is aspirational; add an EPT
   gate when/if this surface is exposed beyond loopback.

Change control: additive → `v1.1` via PR; breaking → new `v2` + tell Grant.
