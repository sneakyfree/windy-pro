## Vendored control-panel runtime

This directory ships the **Echo HQ Control Panel** stack inside windy-pro so the Electron renderer can mount it offline (no registry dependency yet) and so the desktop deploy stays self-contained under `/opt/windy-pro/deploy-prod/`.

| Path | Source | Module system | Consumer |
|---|---|---|---|
| `vendor/collect.cjs` | `@windy/control-panel-host-electron@0.1.0` (collect.ts) | CJS | Electron main (`src/client/desktop/main.js`) |
| `vendor/protocols/index.js` | `@windy/control-panel-protocols@0.1.0` (constants only — Zod stripped) | ESM | Electron renderer (`renderer/control-panel.html`) |
| `vendor/host-web/host.js` + `protocol.js` | `@windy/control-panel-host-web@0.1.0` (Zod-stripped) | ESM | Electron renderer |
| `drops/echo-hq/0.1.0/` | `@windy/control-panel-drop-echo-hq@0.1.0` | drop bundle | iframe inside the Control Panel window |

### Why two module systems

The Electron main process is CommonJS; the renderer is a browser context that loads ESM via `<script type="module">`. Splitting the vendor by consumer lets each side stay native to its environment without a bundler.

### Why Zod was stripped

The canonical packages validate envelopes with Zod. The renderer has no bundler, so importing `zod` from `node_modules` doesn't resolve at runtime. The renderer's protocol module hand-validates the 3 child→parent envelope types (ready / rendered / error) — wire-compatible with the canonical schemas.

### Re-vendoring

```bash
# From windy-pro repo root, with sneakyfree/windy-control-panel checked out at ~/windy-control-panel:
bash scripts/sync-control-panel.sh
```

The drift-guard test at `account-server/tests/control-panel-vendor-drift.test.ts` (TODO M-H) asserts the rendered vendored files match the canonical when both repos are present.

### Bundle layout

The `drops/<dropId>/<version>/` directory mirrors the registry's R2 layout (`drops.windydrops.com/<dropId>/<version>/render.html`) so the host loader's `bundleOrigin` swap from `file://` (local) → `https://drops.windydrops.com` (registry-deployed) is a one-line change.

### Strand reference

WD-31 M-G of [sneakyfree/windy-control-panel](https://github.com/sneakyfree/windy-control-panel). The canonical packages live there; this directory is a Vendor copy per [`feedback_vendor_drift_guard_pattern`](https://github.com/sneakyfree/kit-army-config/blob/main/docs/) (memory).
