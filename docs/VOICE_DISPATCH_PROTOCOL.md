# Voice Dispatch Protocol

The Voice Dispatch Protocol is the contract every Windy frontend integrates against to give the user one-button voice control over their hatched agent. The mic button on Windy Word, the mic button on Windy Mail, the mic button in Windy Chat — all the same `<VoiceButton/>` component, all posting to the same endpoint.

This is the keystone of "voice as the unifying input modality" across the ecosystem.

---

## Status

**v0 (this PR):** text-input mode only, synchronous fly-gateway forwarding, scaffold-mode fallback when the gateway isn't configured. Frontends can integrate against the contract today; the audio path and per-tool-call streaming come in v1+.

---

## Endpoints

### `POST /api/v1/voice/dispatch`

Dispatch a voice command (or, today, a text command) to the user's hatched agent.

**Auth:** `Authorization: Bearer <user JWT>` (issued by Pro's account-server).

**Request body:**

```json
{
  "text": "research the Austin mortgage market and email Bob a battle plan",
  "context": {
    "surface": "mail",
    "thread_id": "...",
    "ref_id": "..."
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | `string` | yes (v0) | 1–10,000 chars. v1 accepts `audio` instead, server transcribes via Word STT and uses the transcript here. |
| `context.surface` | `"word" \| "mail" \| "chat" \| "cloud" \| "code" \| "pro" \| "mobile"` | no | The surface the button was tapped from. Lets the agent route results contextually (e.g., a voice command from Mail with a `thread_id` is treated as "draft a reply"). |
| `context.*` | any | no | Arbitrary, passed through to the agent. |

**Response 202:**

```json
{
  "task_id": "vt_abcdef0123456789...",
  "transcript": "research the Austin mortgage market and email Bob a battle plan",
  "stream_url": "/api/v1/voice/tasks/vt_abcdef.../events"
}
```

**Errors:**

| Status | Meaning |
|---|---|
| 400 | `text` missing, empty, or > 10k chars |
| 401 | Missing/invalid JWT |
| 429 | Rate limit (60/min/user) |
| 500 | `voice_dispatch_failed` (server error) |

---

### `GET /api/v1/voice/tasks/:task_id/events`

Server-Sent Events stream for the dispatched task. Subscribe with `EventSource` (or any SSE client). The stream **closes itself** after the terminal event (`done` or `failed`); the client should reconnect on transient drop and the server will replay cached events idempotently.

**Auth:** same Bearer JWT. Task ownership is enforced — 403 if the JWT's user doesn't match the task's owner.

**Event sequence (happy path):**

| Order | Event | Data |
|---|---|---|
| 1 | `dispatched` | `{ task_id, transcript, surface, ts }` |
| 2 | `thinking` | `{ ts }` |
| 3+ | `tool_call` *(v1+)* | `{ name, args_summary, ts }` — fires once per agent tool call |
| 3+ | `tool_result` *(v1+)* | `{ name, status, ts }` |
| Last-1 | `response` | `{ text, ts }` — the agent's final natural-language response |
| Last | `done` | `{ duration_ms, ts, replayed?: bool, scaffold?: bool }` |

**Alternative terminal events:**

| Event | When | Data |
|---|---|---|
| `failed` | Gateway returned non-2xx, or task internal error | `{ error, ts, replayed?: bool }` |
| `scaffold_mode` | `WINDYFLY_GATEWAY_URL` unset OR gateway unreachable | `{ reason, ts }` — followed by a `done` with `scaffold: true`. Frontends should render an "agent offline, retry" pill. |

**Replay semantics (v0):** if you reconnect to a task that's already `done` or `failed`, the server replays `dispatched` + `response`/`failed` + `done` (with `replayed: true` on the terminal event) and closes the stream. This makes the SSE endpoint network-blip-resilient — frontends can drop the connection and resubscribe without losing the result.

---

## Server-side state

The dispatch creates a row in `voice_tasks`:

```sql
CREATE TABLE voice_tasks (
    task_id      TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    transcript   TEXT NOT NULL,
    surface      TEXT NOT NULL DEFAULT 'unknown',
    context      TEXT NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed | scaffold
    response     TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);
```

Idempotent `CREATE TABLE IF NOT EXISTS` — the table is bootstrapped on first dispatch.

---

## Configuration

| Env var | Default | Behavior |
|---|---|---|
| `WINDYFLY_GATEWAY_URL` | unset | If unset OR unreachable, dispatch falls back to scaffold mode. When set (e.g. `http://localhost:3000`), POSTs `{ message, user_id }` to `${url}/api/chat` and uses the `response` field. |

---

## Rate limit

60 requests per minute per authenticated user (key: `user:<userId>`). Falls back to per-IP key if for some reason auth didn't populate `req.user`.

---

## Frontend integration sketch

```ts
// 1. Tap mic, transcribe (or capture text), POST to /dispatch
const dispatch = await fetch('/api/v1/voice/dispatch', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ text, context: { surface: 'mail' } }),
}).then((r) => r.json());

// 2. Subscribe to the event stream
const es = new EventSource(dispatch.stream_url);
es.addEventListener('dispatched', (e) => updateChip('working...', JSON.parse(e.data)));
es.addEventListener('thinking',   () => updateChip('thinking...'));
es.addEventListener('response',   (e) => showResponse(JSON.parse(e.data).text));
es.addEventListener('done',       () => { updateChip('done'); es.close(); });
es.addEventListener('failed',     (e) => { showError(JSON.parse(e.data)); es.close(); });
es.addEventListener('scaffold_mode', (e) => showOfflinePill(JSON.parse(e.data).reason));
```

The `<VoiceButton/>` and `<TaskStatusChip/>` web components ship as part of `@windy/voice-button` (forthcoming) so every frontend gets identical behavior with zero per-surface logic.

---

## Roadmap

| Version | Adds |
|---|---|
| **v0 (this PR)** | Text-input dispatch; synchronous fly-gateway forwarding; scaffold-mode fallback; replay-on-reconnect |
| v1 | Audio dispatch (multipart/form-data → Word STT → text path); the `audio` field on POST |
| v1.1 | Real SSE forwarding from the agent (per-tool-call `tool_call` / `tool_result` events) |
| v1.2 | Cross-surface task resumption (close laptop, open phone, status chip is still there — uses the persisted `voice_tasks` rows) |
| v2 | Multi-modal context (image + voice), agent-initiated voice replies (TTS) |

---

## Why this is the keystone

Once this protocol is locked in, every frontend ships the same component and every surface gets voice for free. The 4-week effort to wire each frontend independently collapses to a 2-3 week distribution effort. Every other "agent does X" demand becomes either a new tool in the agent's registry (1-3 hours each) or a new SSE event (additive) — never a per-surface UI build.
