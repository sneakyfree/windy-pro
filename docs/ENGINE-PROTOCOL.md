# Windy Pro Engine — Protocol

The Python engine (`src/engine/server.py`) speaks two protocols on
the same TCP port:

- **HTTP** — a single health endpoint, used by main.js liveness checks
  and external observability.
- **WebSocket** — the bidirectional audio/control channel the desktop
  client uses during recording and transcription.

Both live on `ws://127.0.0.1:9876` by default. `websockets.serve`'s
`process_request` hook short-circuits HTTP requests before the WS
handshake, so `curl http://127.0.0.1:9876/health` returns JSON
without upgrading the connection.

## HTTP

### `GET /health`

Returns a JSON status payload. Also used as a liveness probe by
`main.js startPythonServer()` on retries.

```
GET /health HTTP/1.1
Host: 127.0.0.1:9876
```

Response (200 OK when healthy, 503 otherwise):

```json
{
  "status": "ok",            // "ok" | "loading" | "error"
  "uptime_sec": 123.456,     // seconds since server start (monotonic)
  "cold_start_ms": 4821,     // model load time; null if skipped/failed
  "model": "base",           // configured model size
  "device": "cpu",           // "cpu" | "cuda" | "mps" | "auto"
  "clients": 1,              // count of active WebSocket clients
  "version": "0.3.0",        // SERVER_VERSION constant
  "error": null              // "websockets_missing" | "model_load_failed" | null
}
```

`status`:
- `ok` — transcriber loaded, ready to accept WebSocket clients
- `loading` — constructor ran but `load_model()` hasn't completed yet
- `error` — a non-recoverable startup failure; `error` field names
  the cause; expect the server to exit shortly.

HTTP 200 maps to `status: 'ok'`; 503 maps to the other two.

## WebSocket

Messages from the client are either:
- **Binary**: raw 16-bit PCM audio chunks (float32 in little-endian,
  16 kHz mono), delivered during an active recording session.
- **JSON**: control commands (see table below).

Messages from the server are always JSON.

### Client → Server commands

Every command is a JSON object with an `action` key. Additional keys
are action-specific; unknown actions produce an `error` response.

| action | payload | description |
|---|---|---|
| `start` | `{}` | Start a new recording session. Resets internal state. |
| `stop` | `{}` | Stop the current recording and flush final transcript. |
| `config` | `{ "config": {...TranscriberConfig...} }` | Re-configure the transcriber (model, device, language, vad_*). Takes effect on the next `start`. |
| `recovery_check` | `{ "timestamp": <ms> }` | Ask whether any unflushed transcript from before timestamp is still in memory. |
| `ping` | `{}` | Keepalive. Server replies with `pong`. |
| `vault_list` | `{ "limit": 50, "offset": 0 }` | List recent vault entries (transcripts). |
| `vault_get` | `{ "session_id": <int> }` | Return a specific vault session. |
| `vault_search` | `{ "query": "<text>" }` | Full-text search the vault. |
| `vault_export` | `{ "session_id": <int>, "format": "txt"\|"md"\|"srt" }` | Export a session in the given format. |
| `vault_delete` | `{ "session_id": <int> }` | Delete a vault entry. |
| `translate_blob` | `{ "language": "es", ... }` | Translate an already-loaded audio blob. |
| `transcribe_blob` | `{ "language": "en", "format": "wav" }` | Transcribe a buffered audio blob. |

### Server → Client messages

Every server message is a JSON object with a `type` key.

| type | payload | when |
|---|---|---|
| `state` | `{ "oldState": "...", "newState": "..." }` | Every transcriber state transition. States from `TranscriptionState`. |
| `transcript` | `{ "text": "...", "partial": <bool>, "sessionId": <int> }` | Each partial + final transcript segment. |
| `performance` | `{ "ratio": <float>, "currentModel": "...", "recommend": "..."\|null }` | When real-time factor drops below threshold and a smaller model might help. |
| `error` | `{ "error": "<message>" }` | Any error surfaced by a handler. |
| `ack` | `{ "action": "...", ... }` | Confirmation that a command was accepted. Shape varies per command. |
| `pong` | `{ "heartbeat": <bool> }` | Reply to `ping`, or broadcast by the heartbeat loop. |
| `recovery_available` | `{ "sessionId": <int>, ... }` | After a `recovery_check` that found recoverable data. |
| `vault_list` | `{ "entries": [...], "total": <int> }` | Reply to `vault_list`. |
| `vault_get` | `{ "entry": {...} }` | Reply to `vault_get`. |
| `vault_search` | `{ "results": [...] }` | Reply to `vault_search`. |
| `vault_export` | `{ "content": "...", "format": "..." }` | Reply to `vault_export`. |
| `vault_delete` | `{ "ok": <bool> }` | Reply to `vault_delete`. |
| `translate_result` | `{ "text": "...", "sourceLang": "...", ... }` | Reply to `translate_blob`. |
| `transcribe_result` | `{ "text": "...", ... }` | Reply to `transcribe_blob`. |

## Error handling

- The server never throws to close the connection unsolicited. Any
  handler error becomes an `error` JSON message; the client can
  retry, reconfigure, or prompt the user.
- Dead clients (WebSocket write fails) are silently discarded from
  `self.clients`. The server continues serving others.
- The heartbeat loop broadcasts a `pong` every 30s so zombie
  connections with dead TCP don't linger.

## Reserved for future use

- `status: 'ok'` currently requires `load_model()` to have returned
  True. A future lazy-load mode might return `status: 'ok'` before
  the model is ready, with a new `model_status` field. If you're
  writing a liveness check, prefer reading `model !== null` over the
  top-level `status`.
- `/metrics` — not implemented yet. Prometheus-style exposition is
  a candidate for a future observability PR.

## Testing

See `tests/test_engine_health.py` for the contract tests that pin
`_health_payload()`'s shape. Running:

```bash
python3 -m pytest tests/test_engine_health.py -v
```

The WebSocket message types are not currently pinned with contract
tests; they're exercised by the end-to-end integration flow in the
desktop app. Adding JSON-schema validation on both sides is a
follow-up.

## Cross-references

- Source of truth: `src/engine/server.py`
- Client side: `src/client/desktop/main.js startPythonServer()` and
  `src/client/desktop/renderer/app.js` (WebSocket message handling).
- Debugging: [`DEBUGGING.md`](../DEBUGGING.md#symptom-python-engine-doesnt-start-in-main-app)
