# Windy Pro — Agent Architecture

**Status:** Design proposal, 2026-04-19
**Scope:** How the hatched agent operates inside the Windy ecosystem — user-facing model, under-the-hood structure, privilege gating, and the "resident mechanic" concept that lets the agent safely modify the Electron app and surrounding services.

---

## 1. The north star

A normie (grandma, any age, zero AI background) hatches an agent at a windy site. Within minutes that agent has:

- A windychat handle
- A dedicated Twilio cell number (optional upgrade) — *the agent's number, not hers*
- A windymail address
- The ability to send email/SMS on her behalf OR as itself
- The ability to fix, configure, and optimize the Windy ecosystem locally without her touching a terminal

She never hears the words "agent," "terminal," "MCP," or "config." She just talks to her assistant.

---

## 2. User-facing model: ONE agent

From grandma's point of view there is exactly one agent. One identity, one personality, one chat. No "mechanic tab." No "which agent am I in." No branching.

```
┌─────────────────────────────────────────────┐
│          Grandma's Agent (orchestrator)     │
│                                             │
│   • Single chat conversation                │
│   • Single identity / personality           │
│   • Single Attorney Toss (AT) credential    │
└─────────────────────────────────────────────┘
```

Everything below this line is invisible to her.

---

## 3. Under the hood: orchestrator + specialist sub-agents

The user-facing agent is an **orchestrator**. It delegates task-specific work to isolated sub-agents. This mirrors the Anthropic Agent SDK pattern (and is how Claude Code itself works with its Explore / Plan / Subagent tools).

```
                    ┌──────────────────────┐
                    │     Orchestrator     │
                    │   (user-facing)      │
                    └──────────┬───────────┘
                               │ AT-gated dispatch
         ┌────────┬────────────┼────────────┬─────────┐
         ▼        ▼            ▼            ▼         ▼
    ┌────────┐┌────────┐┌──────────────┐┌────────┐┌────────┐
    │Mechanic││ Phone  ││    Mail      ││Browser ││  Chat  │
    │        ││        ││              ││        ││        │
    │(isolate││(Twilio ││(IMAP/SMTP/   ││(Play-  ││(Matrix │
    │proc)   ││ +SMS)  ││ OAuth)       ││ wright)││ rooms) │
    └────────┘└────────┘└──────────────┘└────────┘└────────┘
```

Sub-agents communicate with the orchestrator only over a structured tool bus (not raw shared memory). Each has its own:
- Bounded tool surface (not arbitrary `exec`)
- Own process / crash boundary
- Own AT-verified sub-scope

---

## 4. Attorney Toss as the privilege gate (the moat)

**Core insight:** the reason Google / Apple / Meta can't build what we're building is that they have no way to verify an agent isn't a scam bot. We have Attorney Toss. That changes the entire security calculus.

AT is the "hood latch." Deep privileges (modify app config, install services, store credentials, operate on behalf of the user) require a **current, cryptographically valid AT token** tied to a verified human. The token:

- Cannot be forged via prompt injection (it's signed, not just a string)
- Is scoped per sub-agent capability
- Is revocable by the human at any time
- Produces a tamper-evident audit log tied to the AT identity

**Without AT, the mechanic sub-agent refuses privileged operations.** No exceptions. Every privileged tool call logs the AT identity + tool + args + outcome.

This is a real competitive moat. It lets us safely build the things the big platforms locked down because of abuse.

---

## 5. The mechanic sub-agent

The mechanic is the sub-agent that fixes and optimizes the Electron app and surrounding services on the user's machine. It is the thing that turns "grandma's Electron app has a microphone bug on her iMac" from a support nightmare into a 30-second self-heal.

### 5.1 Isolated process

The mechanic runs in a **separate Electron child process** from the main UI. If the mechanic crashes while diagnosing, the chat UI survives and says "sorry, that didn't work — trying something else." If the main UI crashes, the mechanic survives and can auto-restart it.

### 5.2 Structured repair surface, not shell

The mechanic does **not** have arbitrary shell access. The Electron app exposes an **MCP server** on `127.0.0.1:PORT` with a strict tool schema:

| Tool | Tier | Purpose |
|---|---|---|
| `get_platform_info` | read | OS, arch, versions, hardware |
| `get_crash_log(service)` | read | Recent errors for a named service |
| `get_config(path)` | read | Current value at a JSON config path |
| `set_config(path, value)` | tier-1 | Safe change (theme, model, hotkey) |
| `restart_service(name)` | tier-1 | Restart a bounded list of known services |
| `reinstall_binary(name)` | tier-2 | Reinstall a dependency from a pinned registry |
| `run_playbook(id, args)` | varies | Execute a pre-written, reviewed playbook |
| `snapshot_config()` | read | Snapshot the current config state |
| `revert_to_snapshot(id)` | tier-1 | Rollback to a previous snapshot |

**No `exec_bash`. No `write_arbitrary_file`.** If a fix isn't expressible via the schema, it isn't a fix the mechanic can do — it becomes a support ticket that gets triaged into a new playbook.

### 5.3 Two safety tiers

- **Tier 1 (safe):** applies instantly. Theme, model selection, temperature, keybindings, service restarts within a known list.
- **Tier 2 (risky):** requires one-tap user approval. Reinstalls, credential changes, irreversible operations, anything that touches the file system outside `~/.windy-pro/`.

### 5.4 Snapshot and revert

Every mechanic action is preceded by an automatic config snapshot. One-tap "Revert the last 5 minutes" button is always visible in the UI. This is **non-negotiable** — it's what lets us be bold about letting the agent touch things during a ballroom demo.

### 5.5 Playbook skill library

The mechanic has a local library of diagnostic playbooks, each keyed by `{platform, hardware, error_signature}`. Example:

```
playbooks/
  macos-apple-silicon-ffmpeg-codec-missing.md
  fedora-gnome49-xhci-resume-hang.md
  windows-wsl2-clock-skew-ydotool.md
  ...
```

Playbooks are written in plain English + structured tool calls, reviewed and committed to the repo. The mechanic doesn't improvise on novel bugs — it either matches a playbook, or it files a telemetry report (5.6) and tells the user "I don't know this one yet, let me get a human on it."

### 5.6 Federated learning loop

When the mechanic hits a novel bug it can't solve:
1. Anonymized telemetry (OS, hardware fingerprint, error signature, config diff) flows to Kit 0
2. A human or Claude-driven reviewer writes a new playbook
3. New playbook deploys to all Windy Pro instances on next update
4. Next time ANY user hits this bug, the mechanic solves it in seconds

**The fleet gets smarter with every ballroom event.** This is the long-term compounding advantage.

---

## 6. Example flows

### 6.1 "Fix my microphone"

1. Grandma: "My mic isn't working."
2. Orchestrator recognizes a mechanic task, dispatches to mechanic sub-agent with AT token.
3. Mechanic calls `get_platform_info` + `get_crash_log("whisper-server")`.
4. Matches playbook `macos-catalina-mic-permission-denied.md`.
5. Executes `run_playbook("...", {...})` — which opens System Preferences to the mic permission page and walks her through one click.
6. Verifies fix by calling `restart_service("whisper-server")` + a test transcription.
7. Orchestrator tells grandma: "Done — try it now."

### 6.2 "Text my daughter for me"

1. Grandma: "Tell Sarah I'll be home at 6."
2. Orchestrator dispatches to `phone` sub-agent with AT token.
3. Phone sub-agent looks up Sarah in grandma's contacts.
4. Asks orchestrator: "Send from your number or from your agent's number?"
5. Grandma picks her own number.
6. Phone sub-agent sends via Twilio using grandma's verified identity.
7. Reply from Sarah lands in grandma's personal-cell chat thread in windychat.

### 6.3 "Set up my email"

1. Grandma: "Connect my Gmail."
2. Orchestrator dispatches to `mail` sub-agent.
3. Mail sub-agent kicks off Google OAuth device flow, shows grandma a 6-digit code + URL.
4. Grandma signs in on her phone, types the code.
5. Mail sub-agent stores the OAuth refresh token encrypted at rest, indexed by AT identity.
6. Done.

---

## 7. Non-goals (for v1)

- Carrier portal automation (Verizon / T-Mobile / AT&T): **deferred.** No public APIs, brittle browser automation, high support cost. Sell the agent's own number instead.
- Fully autonomous bug fixing without a matched playbook: **deferred.** Agent improvising shell commands on grandma's machine is where this gets dangerous. Stay in the playbook library until the library is deep.
- Cross-user agent collaboration: **deferred.** First ship single-user well.

---

## 8. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection tricks agent into privileged action | AT token signature; tool scope enforcement; no arbitrary exec |
| Agent "fixes" something and makes it worse | Automatic snapshot before every action; one-tap revert always visible |
| Mechanic crashes while operating | Separate process; main UI unaffected; auto-restart mechanic |
| Debugging the debugger (recursion) | Mechanic runs in a completely separate process from chat; can't deadlock the UI |
| Each user's app drifts into a unique config | Telemetry logs config diffs; playbook executions are versioned |
| Novel bug with no matching playbook | Agent admits it doesn't know; files anonymized report; human writes playbook; propagates to fleet |

---

## 9. Prior art we are drawing on

- **Anthropic Agent SDK** (orchestrator + subagents pattern) — our primary reference
- **Claude Code** — subagents like Explore / Plan / general-purpose; the working example of this pattern in production
- **Cursor / Zed** — AI modifies the editor's own settings
- **Warp terminal** — agent runs diagnostic commands in the host terminal
- **Home Assistant with LLM voice** — agent reconfigures the platform it runs inside
- **OpenInterpreter / Claude Computer Use** — agent with structured privileges over the host
- **Tesla Autopilot** — the AI drives the vehicle it's embedded in

Nobody has shipped this specific combination — *every user gets a deeply privileged agent on their machine, gated by verified identity, marketed to normies* — at scale. That's the opening.

---

## 10. Memory & learning preservation

A naive sub-agent architecture spawns fresh instances that behave like amnesiacs — the 51st fix of a familiar bug looks to the agent like the first. This is a real risk and the wrong way to build. It is solved here by treating memory as a **shared persistent store**, not something living in any one agent's context window.

### 10.1 Context vs memory

- **Context window** = what's in the current conversation. Ephemeral. Fresh per invocation. Even the orchestrator gets a new context each session.
- **Memory (soul store)** = persistent disk-backed store. Accumulates forever. Read by every agent on spawn, written to by every agent before returning.

Agents do not learn by preserving context across runs. They learn by reading from and writing to the soul store. A 2-year-old orchestrator is "smart" because its soul file has been growing for 2 years, not because its context remembers anything from 2 years ago.

### 10.2 All agents share the same soul store

Orchestrator AND every sub-agent read/write the same per-user soul file plus the fleet-wide playbook library. Sub-agents are not isolated from accumulated learning — they are instantiations that *bind* to the shared soul on spawn.

```
                    ┌─────────────────────────────┐
                    │  Shared Soul Store          │
                    │  • Fleet playbook library   │
                    │  • Per-user soul file       │
                    │  • Dream-compacted summaries│
                    │  • Bug fix history          │
                    └──────────┬──────────────────┘
                               │ read/write
         ┌────────┬────────────┼────────────┬─────────┐
         ▼        ▼            ▼            ▼         ▼
   Orchestrator Mechanic     Phone        Mail     Browser
```

### 10.3 Retrieval on spawn

When the orchestrator dispatches to a sub-agent, the spawn prompt includes:

1. **Fleet playbooks matching the task signature.** The mechanic handling a macOS mic permission bug receives the fleet's accumulated playbooks for that error class — potentially hundreds of prior fixes across all users.
2. **This-user's relevant soul slice.** Entries tagged for the sub-agent type (e.g. `mechanic`) and/or matching the error signature, ranked by recency + relevance. Not the full soul — targeted retrieval.
3. **Current task details** (error, logs, what the user said).

This is targeted retrieval, not context stuffing. The mechanic gets the ~15 mic-relevant entries out of a user's 200 total, not all 200. Sharper signal, lower token cost, faster response.

### 10.4 Write-back is mandatory

Every sub-agent MUST call `record_learning(tag, content)` before returning, even to record "nothing novel — matched existing playbook N." This produces:

- **New playbook** if the sub-agent solved a novel class of bug → promoted to fleet library after review
- **User soul entry** capturing the specifics of this fix (hardware quirks, user preferences revealed, config before/after)
- **Telemetry ping** to fleet learning loop for aggregation

No silent returns. Learning is a first-class side effect.

### 10.5 Dream cycle

A background process (nightly per user + weekly fleet-wide) compacts raw soul entries into durable summaries. Raw entries from the past week are reviewed, deduplicated, promoted to permanent soul if they represent stable user traits, or demoted/dropped if ephemeral. Fleet-wide: similar bug fixes from multiple users get merged into stronger consolidated playbooks.

This is what the ecosystem already calls "dreaming." It's the compaction step that keeps memory from becoming noise over years of accumulation.

### 10.6 Why this beats a monolithic agent on learning

1. **Fleet learning only works with sub-agents sharing a playbook library.** A monolithic per-user agent cannot share learning across users. The sub-agent pattern is what makes a bug grandma in Atlanta hits today automatically already-solved when grandma in Boise hits it tomorrow.
2. **Targeted retrieval beats context stuffing.** Pulling ~15 relevant entries into a sub-agent's context is better focus than dragging 200 topics into a monolith's context window every time.
3. **Soul durability.** In a monolith, recent debug noise eventually pushes deep user context out of the window. With targeted retrieval, the soul is disk-backed permanent and re-injected as needed.
4. **Cross-session continuity is equivalent.** Both patterns start fresh each session and rely on the soul store for continuity — sub-agents don't lose anything here vs a monolith.

### 10.7 Practical consequence

The mechanic in 2028 has the benefit of 2 years of fleet playbooks plus this specific user's 200+ prior fixes, compacted into a retrievable soul. It is never a brand-new amnesiac. That's what separates a real agentic product from a toy.

---

## 11. Open questions for future sessions

1. Does the mechanic MCP server bind to `127.0.0.1` only, or do we allow fleet-level mechanic dispatch (Kit 0 fixing grandma's Windy 0 remotely)? Probably local-only for v1, fleet-level as a paid tier later.
2. Who writes the first 20 playbooks, and what error signatures are they keyed on? Initial list driven by the top 20 bugs we hit during the first ballroom event.
3. What's the telemetry privacy posture? Default opt-in or opt-out? Legal probably wants opt-in with a clear consent screen.
4. Does the `browser` sub-agent ship in v1 or get deferred along with carrier portals?
