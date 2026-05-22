---
schema: windy.drop.v1
id: windy-echo-hq
name: Echo HQ
subtitle: Cyberpunk-vitals dashboard for the box you're sitting at
type: control-panel-template
version: 0.1.0
author:
  - name: Kit Army Windstorm
license: MIT
consumes:
  - windy.vitals.v1
  - windy.fleet.v1
surfaces:
  - windy-control-panel
entry: render.js
tags:
  - vitals
  - cyberpunk
  - fleet
  - official
preview: preview.png
control_panel:
  refresh_interval_ms: 1000
  supports_remote_fleet: true
---

# Echo HQ

The cyberpunk-vitals Control Panel template ported from Kit 0C5's bespoke React dashboard into a drop. Watches the box you're sitting at — CPU, RAM, disk, network, load, processes — plus the rest of your fleet in a single dense grid.

Origin: this template *was* the iMac at the head of Grant's kit army for months before the Drops substrate existed. ADR-054 made it a drop so anyone can pick it from the Control Panel template dropdown — and so anyone can fork it.

## What the template reads

- `windy.vitals.v1` — the host machine's CPU / memory / disk / network / load / processes. Sparklines maintain ~40 samples of history across `data-update` pushes.
- `windy.fleet.v1` — `this_machine` + `agents[]`. Rendered as a tiled "kit army" grid; the current machine is highlighted with a glowing border.

## What the template shows

- Header: hostname + platform + uptime + at-a-glance CPU/RAM/PROCS gauges
- A scrolling heartbeat SVG (purely decorative — the "alive" feel doesn't depend on data changing)
- Location/hardware bar (model · IP · CPU · platform)
- Six sparkline cards: CPU · RAM · DISK · NETWORK · LOAD · PROCESSES
- Kit army grid: one tile per `fleet.agents[]` entry, plus `this_machine` as the first tile
- Echo's log: a short prose blurb personalized with the host's identity
- Comms feed: placeholder until per-agent message subscription lands

## Forking

```bash
windy-drops fork windy-echo-hq your-handle-my-dashboard
```

Then edit `render.js` + `styles.css` and `windy-drops publish` your variant.

## Limitations (v1)

- `gpu`, `thermal`, `cpu.temperature_c`, `host.location` arrive as `null` per the Vitals v1 contract — Echo HQ surfaces "—" honestly rather than fabricating values.
- Network rates are placeholders (`0` bytes/sec) until v1.1 of the collector.
- The kit-army grid maxes out at one agent today (the `UNIQUE(identity_id, product)` constraint on `windy_fly` `product_accounts`). Multi-agent users in v1.x will see one tile per row automatically.
