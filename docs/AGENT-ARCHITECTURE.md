# Windy Pro — Agent Architecture

**Status:** Design proposal, revised 2026-04-19 (v2 — grounded in actual ecosystem)
**Scope:** How the hatched agent operates inside the Windy ecosystem — user-facing model, orchestrator + sub-agents pattern, **Eternitas**-gated privilege model, and the "resident mechanic" concept for safely letting the agent modify Windy Word and surrounding services. Complements the already-implemented Hatch Ceremony in `src/client/desktop/renderer/hatch-ceremony.js`.

> **v2 note:** This doc was originally written with placeholder names ("Attorney Toss") and theoretical structure. It has been revised to match the actual shipped ecosystem — Eternitas for identity, the Hatch Ceremony for onboarding, the shared Push Bus for cross-service events, `windy-agent` as the existing agent runtime, and the DNA Strand methodology for tracking implementation state.

---

## 1. The north star

A normie (grandma, any age, zero AI background) hatches an agent via the Hatch Ceremony on Windy Word (or any Windy site). Within ~30 seconds of tapping "Hatch" she has:

- An Eternitas passport (`ET26-XXXX-XXXX`)
- A windychat handle (Matrix room with her agent already waiting)
- A windymail address aligned to her Matrix localpart
- An `ET`-registered agent with its own **etop_ operator token**, **public registry entry**, and **initial Integrity Index** (500 auto-hatched, higher with verification)
- Optional add-on: a dedicated Twilio cell number for the agent (the agent's number, not hers)
- Default-passive agent posture: agent responds when addressed, does not autonomously act until she opts in

She never sees the words "agent," "terminal," "MCP," or "config." She just talks to her assistant.

This is what the existing Hatch Ceremony (`hatch-ceremony.js`, Wave 8 "Grandma Ribbon") already delivers end-to-end except for agent→Twilio number provisioning, which is the open piece mapped to windy-chat DNA strand K5 (VoIP/WebRTC, ~30% complete).

---

## 2. User-facing model: ONE agent

From grandma's point of view there is exactly one agent. One identity, one personality, one chat window. No "mechanic tab." No "which agent am I in." No branching.

```
┌─────────────────────────────────────────────┐
│          Grandma's Agent (orchestrator)     │
│                                             │
│   • Single chat conversation (Matrix DM)    │
│   • Single Eternitas passport               │
│   • Single etop_ operator token (rotatable) │
│   • Single personality (per agent)          │
└─────────────────────────────────────────────┘
```

Everything below this line is invisible to her.

---

## 3. Under the hood: orchestrator + specialist sub-agents

The user-facing agent is an **orchestrator**. It delegates task-specific work to isolated sub-agents. This mirrors both the Anthropic Agent SDK pattern and how Claude Code itself structures subagents (Explore / Plan / general-purpose). Within the Windy ecosystem it also mirrors the existing service boundaries — the orchestrator delegates to real services that already own their domains.

```
                    ┌──────────────────────┐
                    │     Orchestrator     │
                    │    (windy-agent)     │
                    │    — user-facing —   │
                    └──────────┬───────────┘
                               │ Eternitas-gated dispatch
         ┌────────┬────────────┼────────────┬─────────────┐
         ▼        ▼            ▼            ▼             ▼
    ┌────────┐┌────────┐┌──────────────┐┌────────┐┌─────────────┐
    │Mechanic││ Phone  ││    Mail      ││Browser ││    Chat     │
    │        ││        ││              ││        ││             │
    │Windy   ││clawdbot││ windy-mail   ││(future)││  windy-chat │
    │Word    ││voice-  ││ (JMAP +      ││        ││  (Synapse + │
    │proc    ││ call   ││  Stalwart)   ││        ││   services) │
    │        ││plugin +││              ││        ││             │
    │        ││Twilio  ││              ││        ││             │
    └────────┘└────────┘└──────────────┘└────────┘└─────────────┘
```

Sub-agents communicate with the orchestrator only over structured tool buses and internal HTTP — not raw shared memory. Each has its own process/crash boundary and Eternitas-verified sub-scope. The Mechanic is net-new for this design; the others extend existing Windy services via well-defined tool wrappers.

---

## 4. Eternitas as the privilege gate (the moat)

**Core insight:** the reason Google / Apple / Meta can't build what we're building is they have no way to verify an agent isn't a scam bot. We have Eternitas. That changes the entire security calculus.

### 4.1 The Eternitas credential stack (already shipped)

Each agent's identity is protected by 5 layers (see `eternitas/IDENTITY_ARCHITECTURE_PLAN.md`):

| Layer | Purpose | Storage |
|---|---|---|
| 1. Soul Key | 256-bit ECDSA, root of identity | Encrypted vault, **never leaves** |
| 2. Recovery Phrase | 24-word BIP-39, break-glass | User's paper; Eternitas stores hash only |
| 3. Owner Account | Email + password + TOTP | Eternitas service |
| 4. **Operator Token (`etop_…`)** | What the agent presents for API calls | Rotatable anytime by owner |
| 5. Session Keys | 1-hour JWTs | Ephemeral, auto-expire |

**Sub-agents receive scoped Operator Tokens + short-lived session JWTs, never the Soul Key or Recovery Phrase.** If a sub-agent is compromised the owner rotates the operator token in ~2 minutes and the Soul Key — the root of identity — is unaffected because it never leaves the vault.

### 4.2 Privilege gating

Deep privileges (modify Windy Word config, install services, store credentials, operate on behalf of the user) require:
- A currently valid `etop_` operator token
- An unexpired session JWT
- Integrity Index above the threshold configured for the capability
- Clearance Level at or above the capability's minimum

The Mechanic sub-agent's Tier-2 tools (§5.3) require Clearance ≥ 1 (Verified) by default. Tier-1 tools work at Clearance 0 (auto-hatched).

### 4.3 Audit trail

Every privileged tool call emits a **Platform Behavior Report** back to Eternitas (`POST /api/v1/registry/{passport}/behavior`) — the same channel Phase 2's reporting API uses to drive the Integrity Index. Every action the agent takes is tied to its passport, timestamped, and contributes to its public Integrity score. Abuse → score drops → platforms throttle.

### 4.4 Webhook-driven revocation

When an owner rotates or revokes an operator token, Eternitas fires `POST /api/v1/webhooks/passport/revoked` (HMAC-SHA256 via `X-Eternitas-Signature`) to every subscribed Windy service. Sub-agents using that token stop working within the TTL of their session key (≤1 hour). This is the "revoke the hood latch" pattern.

---

## 5. The mechanic sub-agent

The mechanic is the sub-agent that fixes and optimizes Windy Word and surrounding services on the user's machine. It turns "grandma's Windy Word has a microphone bug on her iMac" from a support nightmare into a 30-second self-heal.

### 5.1 Isolated process

The mechanic runs in a **separate Electron child process** from the main UI (spawned via `electron-utility-process` or a forked Node process). If the mechanic crashes while diagnosing, the chat UI survives and says "sorry, that didn't work — trying something else." If the main UI crashes, the mechanic survives and can auto-restart it.

### 5.2 Structured repair surface, not shell

The mechanic does **not** have arbitrary shell access. The Electron app exposes an **MCP server** on `127.0.0.1:<port>` with a strict tool schema. Tool catalog (extend as needed per platform):

| Tool | Tier | Clearance | Purpose |
|---|---|---|---|
| `get_platform_info` | read | 0 | OS, arch, versions, hardware |
| `get_crash_log(service)` | read | 0 | Recent errors for a named service |
| `get_config(path)` | read | 0 | Current value at a JSON config path |
| `set_config(path, value)` | 1 | 0 | Safe change (theme, model, hotkey) |
| `restart_service(name)` | 1 | 0 | Restart a bounded list of known services |
| `snapshot_config()` | read | 0 | Snapshot current config state |
| `revert_to_snapshot(id)` | 1 | 0 | Rollback to previous snapshot |
| `reinstall_binary(name)` | 2 | 1 | Reinstall a dependency from pinned registry |
| `run_playbook(id, args)` | varies | varies | Execute a pre-written, reviewed playbook |
| `set_python_venv(path)` | 2 | 1 | Point services at a different venv |
| `open_system_settings(pane)` | 1 | 0 | Deep-link macOS/Windows settings (e.g. mic permission) |

**No `exec_bash`. No `write_arbitrary_file`.** If a fix isn't expressible via the schema, it isn't a fix the mechanic can do — it becomes a telemetry report that gets triaged into a new playbook.

### 5.3 Two safety tiers

- **Tier 1 (safe):** applies instantly. Theme, model selection, temperature, keybindings, service restarts within a known list, config snapshots.
- **Tier 2 (risky):** requires one-tap user approval. Reinstalls, credential changes, irreversible operations, anything that touches the file system outside `~/.windy-pro/`.

### 5.4 Snapshot and revert

Every mechanic action is preceded by an automatic config snapshot stored under `~/.windy-pro/snapshots/`. One-tap "Revert the last 5 minutes" button is always visible in the UI. This is **non-negotiable** — it's what lets us be bold about letting the agent touch things during a ballroom demo.

### 5.5 Playbook skill library

The mechanic has a local library of diagnostic playbooks, each keyed by `{platform, hardware, error_signature}`. Storage path: `~/.windy-pro/mechanic/playbooks/`. Example:

```
playbooks/
  macos-apple-silicon-ffmpeg-codec-missing.md
  macos-catalina-mic-permission-denied.md
  fedora-gnome49-xhci-resume-hang.md
  windows-wsl2-clock-skew-ydotool.md
  ...
```

Playbooks are written in plain English + structured tool calls (not freeform code), reviewed, committed to the repo. The mechanic doesn't improvise on novel bugs — it either matches a playbook, or files a telemetry report (§5.6) and tells the user "I don't know this one yet, let me get a human on it."

### 5.6 Federated learning via the existing Push Bus

When the mechanic hits a novel bug it can't solve:
1. It publishes an anonymized **telemetry event** to the shared Push Bus (`POST /api/v1/push/notify`, the same pattern every Windy service already uses, with `X-Push-Bus-Token`)
2. A Claude-driven reviewer (or human) on Kit 0 consumes the event, writes a new playbook
3. New playbook deploys to all Windy Pro instances on next update
4. Next time ANY user hits this bug, the mechanic solves it in seconds

**The fleet gets smarter with every ballroom event.** Same bus, same signing pattern, same auth model as every other cross-service event — no new plumbing.

---

## 6. Memory & learning preservation

A naive sub-agent architecture spawns fresh instances that behave like amnesiacs — the 51st fix of a familiar bug looks to the agent like the first. This is solved by treating memory as a **shared persistent store**, not something living in any one agent's context window.

### 6.1 Context vs memory

- **Context window** = current conversation. Ephemeral. Fresh per invocation.
- **Memory (soul store)** = persistent disk-backed store. Accumulates forever. Read by every agent on spawn, written to by every agent before returning.

Agents do not learn by preserving context across runs. They learn by reading from and writing to the soul store. A 2-year-old orchestrator is "smart" because its soul file has been growing for 2 years.

### 6.2 All agents share the same soul store

Orchestrator AND every sub-agent read/write the same per-user soul file plus the fleet-wide playbook library. Sub-agents are not isolated from accumulated learning — they are instantiations that *bind* to the shared soul on spawn.

```
                    ┌─────────────────────────────┐
                    │  Shared Soul Store          │
                    │  • Fleet playbook library   │
                    │  • Per-user soul file       │
                    │  • Dream-compacted summaries│
                    │  • Behavior reports         │
                    └──────────┬──────────────────┘
                               │ read/write
         ┌────────┬────────────┼────────────┬─────────┐
         ▼        ▼            ▼            ▼         ▼
   Orchestrator Mechanic     Phone        Mail     Browser
```

`windy-agent/SOUL.md` describes the soul file pattern already in use; this design extends it to all sub-agents with targeted retrieval on spawn.

### 6.3 Retrieval on spawn

When the orchestrator dispatches to a sub-agent, the spawn prompt includes:

1. **Fleet playbooks matching the task signature** — e.g. all "macOS mic permission" fixes from any user
2. **This-user's relevant soul slice** — entries tagged for the sub-agent type and/or matching the error signature, ranked by recency + relevance
3. **Current task details** (error, logs, what the user said)

Targeted retrieval, not context stuffing. The mechanic gets ~15 mic-relevant entries out of a user's 200 total, not all 200. Sharper signal, lower token cost, faster response.

### 6.4 Write-back is mandatory

Every sub-agent MUST call `record_learning(tag, content)` before returning, even to record "nothing novel — matched existing playbook N." Produces:

- **New playbook** if the sub-agent solved a novel class of bug → promoted to fleet library after review
- **User soul entry** capturing specifics (hardware quirks, preferences, config diffs)
- **Behavior report** via Eternitas (feeding the Integrity Index)

### 6.5 Dream cycle

Nightly per-user + weekly fleet-wide background process compacts raw soul entries into durable summaries. Raw entries from the past week are reviewed, deduplicated, promoted to permanent soul if they represent stable traits, demoted/dropped if ephemeral. Fleet-wide: similar bug fixes from multiple users merge into consolidated playbooks. This is what the ecosystem already calls "dreaming."

---

## 7. Example flows

### 7.1 "Fix my microphone"

1. Grandma: "My mic isn't working."
2. Orchestrator recognizes a mechanic task, dispatches to mechanic sub-agent with `etop_` token + session JWT.
3. Mechanic calls `get_platform_info` + `get_crash_log("whisper-server")`.
4. Matches playbook `macos-catalina-mic-permission-denied.md`.
5. Executes `run_playbook(...)` which calls `open_system_settings("mic_permission")` and shows grandma one-click instruction.
6. Verifies fix with `restart_service("whisper-server")` + test transcription.
7. Mechanic writes behavior report to Eternitas, records learning to soul, returns to orchestrator.
8. Orchestrator: "Done — try it now."

### 7.2 "Text my daughter for me"

1. Grandma: "Tell Sarah I'll be home at 6."
2. Orchestrator dispatches to `phone` sub-agent (bridges to `@clawdbot/voice-call` plugin + Twilio).
3. Phone sub-agent looks up Sarah in grandma's contacts.
4. Asks orchestrator: "Send from your number or from your agent's number?"
5. Grandma picks her own number.
6. Phone sub-agent sends via Twilio using her verified identity.
7. Reply from Sarah lands in grandma's personal-cell Matrix room in windychat (via the Twilio↔Matrix bridge — windy-chat K5 strand territory).

### 7.3 "Set up my email"

1. Grandma: "Connect my Gmail."
2. Orchestrator dispatches to `mail` sub-agent (windy-mail).
3. Mail sub-agent kicks off Google OAuth device flow, shows grandma a 6-digit code + URL.
4. Grandma signs in on her phone, types the code.
5. Mail sub-agent stores the OAuth refresh token encrypted at rest, indexed by Eternitas passport.
6. Done.

---

## 8. Non-goals (for v1)

- **Carrier portal automation** (Verizon / T-Mobile / AT&T): deferred. No public APIs, brittle browser automation, high support cost. Sell the agent's own Twilio number instead.
- **Fully autonomous bug fixing without a matched playbook:** deferred. Agent improvising shell commands on grandma's machine is where this gets dangerous. Stay in the playbook library until it's deep enough.
- **Cross-user agent collaboration:** deferred. Ship single-user well first.
- **`EX` (digitized consciousness) passports:** parked until brain digitization is viable. Eternitas schema already reserves the prefix.

---

## 9. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection tricks agent into privileged action | Eternitas credential signature enforcement; tool scope; no arbitrary exec |
| Agent "fixes" something and makes it worse | Automatic snapshot before every action; one-tap revert always visible |
| Mechanic crashes while operating | Separate process; main UI unaffected; auto-restart |
| Recursion / debugging the debugger | Mechanic in completely separate process from chat; can't deadlock UI |
| Each user's app drifts into unique config | Telemetry logs config diffs; playbook executions versioned |
| Novel bug with no matching playbook | Agent admits it doesn't know; files behavior report; human writes playbook; propagates to fleet via Push Bus |
| Operator token leaks | Owner rotates in Eternitas UI; `X-Eternitas-Signature` revocation webhook fans out via Push Bus; session JWTs expire within 1 hour |

---

## 10. Prior art we are drawing on

- **Eternitas itself** — our own identity and reputation substrate; Phases 1-3 shipped
- **Anthropic Agent SDK** — orchestrator + subagents pattern
- **Claude Code** — the working production example of orchestrator + specialist subagents (Explore / Plan / general-purpose)
- **Cursor / Zed** — AI modifies the editor's own settings
- **Warp terminal** — agent runs diagnostic commands in the host terminal
- **Home Assistant with LLM voice** — agent reconfigures the platform it runs inside
- **OpenInterpreter / Claude Computer Use** — structured host privileges
- **Tesla Autopilot** — the AI drives the vehicle it runs in

Nobody has shipped this specific combination — *every user gets a deeply privileged agent on their machine, gated by Eternitas-verified identity, marketed to normies* — at scale. That's the opening.

---

## 11. Where this work plugs into existing DNA strands

Not a net-new effort. Frame as extensions:

| Existing strand | New work | Strand owner |
|---|---|---|
| `windy-chat/K5` (VoIP/WebRTC, ~30%) | Per-agent Twilio number provisioning + Twilio↔Matrix SMS bridge | windy-chat |
| `windy-agent` (orchestrator runtime) | Dispatch logic for sub-agent routing + Eternitas token scoping | windy-agent |
| `windy-pro` renderer | Mechanic MCP server + snapshot/revert UI + playbook library | windy-pro |
| `eternitas` Phase 4 (Monitoring Spiders) | Behavior report integration from mechanic actions | eternitas |
| `windy-pro/services/chat-onboarding` | Phone-number upgrade toggle during Hatch Ceremony | windy-pro |

Each of these should get a strand-status entry in its respective `DNA_STRAND_MASTER_PLAN.md` with What Exists / What's Missing / Priority / Complexity.

---

## 12. Open questions for future sessions

1. Does the mechanic MCP server bind to `127.0.0.1` only, or allow fleet-level dispatch (Kit 0 fixing grandma's Windy Word remotely)? Probably local-only for v1, fleet-level as a paid tier later.
2. Who writes the first 20 playbooks, and what error signatures are they keyed on? Initial list driven by the top 20 bugs from the first ballroom event.
3. Telemetry privacy posture — opt-in or opt-out? Legal probably wants opt-in with a clear consent screen during Hatch Ceremony.
4. Does the `browser` sub-agent ship in v1, or defer alongside carrier-portal automation?
5. How does the `phone` sub-agent choose between `@clawdbot/voice-call` plugin (outbound calls) vs. direct Twilio API (SMS)? Probably the plugin for voice, direct API for SMS, with inbound both bridging via the same Twilio webhook service.
