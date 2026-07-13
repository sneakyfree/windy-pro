# contracts/ — Windy Word's agent-control manifest

`control.mcp.v1.json` is the **canonical source of truth** for Windy Word's
bilingual agent-control surface, governed by the ecosystem Agent Control
Doctrine (**ADR-060** in `sneakyfree/windy-contracts`). The Loom weaves the
MCP packet + Python twin + conformance driver from it; both languages call
the SAME live routes on `127.0.0.1:18765`, so they cannot drift.

- **Do not hand-edit generated packets** — edit this manifest and re-weave.
- Each tool's `transport` binding maps it to its real route in `main.js`
  (Gen-1 escape hatch, ADR-060 §4) — the hardened control server is not
  rewritten.
- Change control: additive → `v1.1` via PR; breaking → new `v2` file and
  tell Grant. Never silently mutate a frozen contract.

**This is the FIRST-PASS manifest** — the implemented 13-knob baseline + the
proven sound/settings tools. The 8 baseline gaps and the ~90 remaining
feature routes are tracked in
`windy-contracts/docs/handoffs/WORD-LANE-2026-07-13.md`.

`weave.json` is the per-platform Loom config (ADR-060
`schema/weave-config.v1.schema.json`).
