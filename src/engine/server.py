"""
Windy Pro - WebSocket Server
Bridges the Python transcription engine with the Electron client.

Protocol:
- Client sends audio chunks as binary WebSocket messages
- Server sends JSON messages with transcripts and state updates
"""

import asyncio
import json
import sys
import os
import time
from pathlib import Path
from typing import Set, Any

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None

WebSocketServerProtocol = Any

from .transcriber import StreamingTranscriber, TranscriberConfig, TranscriptionState
from .vault import PromptVault
from .vibe import VibeProcessor

SERVER_VERSION = "0.3.0"


class WindyServer:
    """
    WebSocket server for Windy Pro.
    
    Handles:
    - Audio streaming from Electron client
    - Real-time transcript updates back to client
    - State machine updates for UI feedback
    """
    
    def __init__(self, host: str = "127.0.0.1", port: int = 9876):
        self.host = host
        self.port = port
        self.transcriber: StreamingTranscriber = None
        self.clients: Set[WebSocketServerProtocol] = set()
        self._server = None
        self.vault = PromptVault()
        self._current_session_id: int = None
        self.vibe = VibeProcessor()
        self._pending_model = None
        self._loop = None
        
    async def _broadcast(self, message: dict):
        """Send message to all connected clients."""
        if not self.clients:
            # print(f"[DEBUG] _broadcast: NO clients to send to!")
            return
        
        data = json.dumps(message)
        # print(f"[DEBUG] _broadcast: sending {message.get('type','')} to {len(self.clients)} clients, data_len={len(data)}")
        # Use _safe_send to gracefully handle dead connections
        results = await asyncio.gather(
            *[self._safe_send(client, data) for client in list(self.clients)],
            return_exceptions=True
        )
        # print(f"[DEBUG] _broadcast: send complete, results={results}")
    
    async def _safe_send(self, ws: WebSocketServerProtocol, data: str):
        """Send data to a single client, removing it on failure."""
        try:
            await ws.send(data)
            # print(f"[DEBUG] _safe_send: OK")
        except Exception as e:
            # print(f"[DEBUG] _safe_send: FAILED: {e}")
            self.clients.discard(ws)
    
    def _on_performance_warning(self, ratio: float, current_model: str, recommend: str | None):
        """Called from transcriber thread when performance ratio is tracked."""
        # Rate-limit: only broadcast once per 10 seconds
        now = time.monotonic()
        if not hasattr(self, '_last_perf_broadcast'):
            self._last_perf_broadcast = 0
        if now - self._last_perf_broadcast < 10:
            return
        self._last_perf_broadcast = now
        
        msg = {
            "type": "performance",
            "ratio": round(ratio, 2),
            "model": current_model,
            "recommend": recommend,
            "status": "slow" if ratio > 1.0 else "ok"
        }
        coro = self._broadcast(msg)
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, self._loop)

    def _on_state_change(self, old_state: TranscriptionState, new_state: TranscriptionState):
        """Handle transcriber state changes (thread-safe)."""
        coro = self._broadcast({
            "type": "state",
            "state": new_state.value,
            "previous": old_state.value
        })
        if self._loop and self._loop.is_running():
            future = asyncio.run_coroutine_threadsafe(coro, self._loop)
            future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        else:
            asyncio.create_task(coro)
    
    def _on_transcript(self, segment):
        """Handle new transcript segments."""
        # print(f"[DEBUG] _on_transcript called: text='{segment.text}' partial={segment.is_partial} clients={len(self.clients)}")
        # Apply vibe processing if enabled
        if self.vibe.enabled and not segment.is_partial:
            original_text = segment.text
            processed_text = self.vibe.process(segment.text)
            # Safety: never allow vibe cleanup to blank a segment completely
            # (can happen with short/filler-heavy chunks)
            if processed_text and processed_text.strip():
                segment.text = processed_text
            else:
                segment.text = original_text
        
        # Save to vault
        if self._current_session_id and not segment.is_partial:
            self.vault.save_segment(
                session_id=self._current_session_id,
                text=segment.text,
                start_time=segment.start_time,
                end_time=segment.end_time,
                confidence=segment.confidence,
                is_partial=segment.is_partial
            )
        
        coro = self._broadcast({
            "type": "transcript",
            "text": segment.text,
            "start": segment.start_time,
            "end": segment.end_time,
            "confidence": segment.confidence,
            "partial": segment.is_partial,
            "words": segment.words,
            "detected_language": getattr(segment, 'detected_language', ''),
            "language_probability": getattr(segment, 'language_probability', 0.0)
        })
        if self._loop and self._loop.is_running():
            future = asyncio.run_coroutine_threadsafe(coro, self._loop)
            future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        else:
            asyncio.create_task(coro)
    
    async def _handle_client(self, websocket: WebSocketServerProtocol):
        """Handle a client connection."""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(f"Client connected: {client_addr}")
        
        # Send current state
        await websocket.send(json.dumps({
            "type": "state",
            "state": self.transcriber.state.value if self.transcriber else "idle"
        }))
        
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    # Binary = audio data
                    if self.transcriber:
                        self.transcriber.feed_audio(message)
                    if not hasattr(self, '_audio_debug_count'):
                        self._audio_debug_count = 0
                    self._audio_debug_count += 1
                    if self._audio_debug_count % 50 == 1:
                        pass  # Debug logging removed to prevent EPIPE
                else:
                    # Text = command
                    try:
                        cmd = json.loads(message)
                        await self._handle_command(cmd, websocket)
                    except json.JSONDecodeError:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": "Invalid JSON"
                        }))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"Client disconnected: {client_addr}")
    
    async def _handle_command(self, cmd: dict, websocket: WebSocketServerProtocol):
        """Handle a command from client."""
        action = cmd.get("action")
        
        if action == "start":
            if self.transcriber:
                # Apply pending model change if queued
                if self._pending_model:
                    # Nuclear approach: fully rebuild the transcriber
                    # to avoid any stale state from the old model
                    if self.transcriber._running:
                        self.transcriber.stop_session()
                    
                    await websocket.send(json.dumps({
                        "type": "state",
                        "state": "loading",
                        "message": f"Loading {self._pending_model} model..."
                    }))
                    
                    # Create a fresh transcriber with the new model
                    old_config = self.transcriber.config
                    old_config.model_size = self._pending_model
                    new_transcriber = StreamingTranscriber(old_config)
                    new_transcriber.on_state_change(self._on_state_change)
                    new_transcriber.on_transcript(self._on_transcript)
                    
                    # Load model in thread pool to avoid blocking event loop
                    loop = asyncio.get_event_loop()
                    success = await loop.run_in_executor(
                        None, new_transcriber.load_model
                    )
                    
                    if success:
                        self.transcriber = new_transcriber
                    else:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": f"Failed to load {self._pending_model} model"
                        }))
                        self._pending_model = None
                        return
                    
                    self._pending_model = None
                
                self.transcriber.start_session()
                self._current_session_id = self.vault.create_session()
                self._session_start_time = time.monotonic()
                await websocket.send(json.dumps({
                    "type": "ack",
                    "action": "start",
                    "success": True,
                    "session_id": self._current_session_id,
                    "model": self.transcriber.config.model_size,
                    "device": self.transcriber.config.device
                }))
        
        elif action == "stop":
            if self.transcriber:
                # Run stop_session in executor to avoid blocking the event loop.
                # This lets queued transcript broadcasts (from the worker thread)
                # drain before we send the stop ack.
                loop = asyncio.get_running_loop()
                transcript = await loop.run_in_executor(
                    None, self.transcriber.stop_session
                )
                # Allow any pending transcript broadcasts to flush
                await asyncio.sleep(0.1)
                word_count = len(transcript.split()) if transcript else 0
                duration_s = 0.0
                if hasattr(self, '_session_start_time') and self._session_start_time:
                    duration_s = round(time.monotonic() - self._session_start_time, 1)
                    print(f"Session ended: {word_count} words in {duration_s}s")
                    self._session_start_time = None
                if self._current_session_id:
                    self.vault.end_session(self._current_session_id)
                    self._current_session_id = None
                await websocket.send(json.dumps({
                    "type": "ack",
                    "action": "stop",
                    "success": True,
                    "transcript": transcript,
                    "word_count": word_count,
                    "duration_s": duration_s
                }))
        
        elif action == "config":
            config_data = cmd.get("config", {})
            applied = {}

            # Language change (hot-swappable)
            if "language" in config_data and self.transcriber:
                self.transcriber.config.language = config_data["language"]
                applied["language"] = config_data["language"]

            # Task change: transcribe vs translate (hot-swappable)
            if "task" in config_data and self.transcriber:
                new_task = config_data["task"]
                if new_task in ("transcribe", "translate"):
                    self.transcriber.config.task = new_task
                    applied["task"] = new_task
                    print(f"Task switched to: {new_task}")

            # Vibe toggle (hot-swappable)
            if "vibe_enabled" in config_data:
                self.vibe.enabled = config_data["vibe_enabled"]
                applied["vibe_enabled"] = config_data["vibe_enabled"]

            # Device change — requires model reload (same as model change)
            if "device" in config_data and self.transcriber:
                new_device = config_data["device"]
                self.transcriber.config.device = new_device
                applied["device"] = new_device
                # Queue model reload with new device
                self._pending_model = self.transcriber.config.model_size
                applied["device_note"] = "Device change will reload model"

            # Model change — hot-reload immediately if no active session
            if "model" in config_data:
                new_model = config_data["model"]
                applied["model"] = new_model
                
                if self.transcriber and not self.transcriber._running:
                    # No active session — reload immediately
                    await websocket.send(json.dumps({
                        "type": "state",
                        "state": "loading",
                        "message": f"Loading {new_model} model..."
                    }))
                    await self._broadcast({
                        "type": "state",
                        "state": "loading",
                        "message": f"Loading {new_model} model..."
                    })
                    
                    old_config = self.transcriber.config
                    old_config.model_size = new_model
                    new_transcriber = StreamingTranscriber(old_config)
                    new_transcriber.on_state_change(self._on_state_change)
                    new_transcriber.on_transcript(self._on_transcript)
                    new_transcriber.on_performance_warning(self._on_performance_warning)
                    
                    loop = asyncio.get_event_loop()
                    success = await loop.run_in_executor(
                        None, new_transcriber.load_model
                    )
                    
                    if success:
                        self.transcriber = new_transcriber
                        applied["model_reloaded"] = True
                        print(f"Model hot-reloaded to: {new_model}")
                    else:
                        applied["model_reloaded"] = False
                        applied["model_error"] = f"Failed to load {new_model}"
                    
                    self._pending_model = None
                    await self._broadcast({
                        "type": "state",
                        "state": "idle"
                    })
                else:
                    # Session active — queue for next session
                    self._pending_model = new_model
                    applied["model_note"] = "Model change takes effect on next session start"

            await websocket.send(json.dumps({
                "type": "ack",
                "action": "config",
                "success": True,
                "applied": applied
            }))
        
        elif action == "recovery_check":
            # T19: Check for crash recovery file
            recovery_path = Path.home() / "windy_session.txt"
            text = ""
            if recovery_path.exists():
                try:
                    text = recovery_path.read_text().strip()
                except Exception:
                    pass
            if text:
                await websocket.send(json.dumps({
                    "type": "recovery_available",
                    "text": text
                }))
                # Remove recovery file after sending
                try:
                    recovery_path.unlink()
                except Exception:
                    pass
        
        elif action == "ping":
            await websocket.send(json.dumps({
                "type": "pong",
                "timestamp": cmd.get("timestamp")
            }))
        
        # ═══ Vault Commands ═══
        elif action == "vault_list":
            limit = cmd.get("limit", 50)
            offset = cmd.get("offset", 0)
            sessions = self.vault.get_sessions(limit, offset)
            await websocket.send(json.dumps({
                "type": "vault_list",
                "sessions": sessions
            }))
        
        elif action == "vault_get":
            session_id = cmd.get("session_id")
            session = self.vault.get_session(session_id) if session_id else None
            await websocket.send(json.dumps({
                "type": "vault_get",
                "session": session
            }))
        
        elif action == "vault_search":
            query = cmd.get("query", "")
            results = self.vault.search(query)
            await websocket.send(json.dumps({
                "type": "vault_search",
                "results": results
            }))
        
        elif action == "vault_export":
            session_id = cmd.get("session_id")
            fmt = cmd.get("format", "txt")
            text = self.vault.export_session(session_id, fmt) if session_id else ""
            await websocket.send(json.dumps({
                "type": "vault_export",
                "text": text,
                "format": fmt
            }))
        
        elif action == "vault_delete":
            session_id = cmd.get("session_id")
            success = self.vault.delete_session(session_id) if session_id else False
            await websocket.send(json.dumps({
                "type": "vault_delete",
                "success": success
            }))
        
        elif action == "translate_blob":
            # One-shot translation: process audio blob without starting a session.
            # This avoids broadcasting state changes to the main app UI.
            # Client sends raw webm/opus audio as the next binary message.
            # We save to temp file and use faster-whisper's native file decoding (ffmpeg).
            source_lang = cmd.get("language", "auto")
            if self.transcriber and self.transcriber.model:
                try:
                    # Wait for the next binary message (the raw audio blob — webm/opus)
                    audio_data = await websocket.recv()
                    if isinstance(audio_data, bytes) and len(audio_data) > 100:
                        import tempfile
                        # Save raw audio to temp file (faster-whisper uses ffmpeg to decode)
                        tmp = tempfile.NamedTemporaryFile(suffix='.webm', delete=False)
                        tmp.write(audio_data)
                        tmp.close()
                        
                        try:
                            lang = source_lang if source_lang not in ('auto', '') else None
                            segments, info = self.transcriber.model.transcribe(
                                tmp.name,  # File path — faster-whisper handles decoding via ffmpeg
                                language=lang,
                                task="translate",
                                beam_size=self.transcriber.config.beam_size,
                                vad_filter=True,
                                condition_on_previous_text=False,
                                no_speech_threshold=0.6,
                                log_prob_threshold=-1.0
                            )
                            
                            translated_text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
                            detected_lang = getattr(info, 'language', '') or ''
                            
                            await websocket.send(json.dumps({
                                "type": "translate_result",
                                "text": translated_text,
                                "detected_language": detected_lang,
                                "confidence": 0.92,
                                "engine": "local-whisper"
                            }))
                            print(f"🌐 One-shot translate: {detected_lang}→en: {translated_text[:60]}")
                        finally:
                            try:
                                os.unlink(tmp.name)
                            except Exception:
                                pass
                    else:
                        await websocket.send(json.dumps({
                            "type": "translate_result",
                            "text": "",
                            "error": "No audio data received"
                        }))
                except Exception as e:
                    print(f"Translate blob error: {e}", file=sys.stderr)
                    await websocket.send(json.dumps({
                        "type": "translate_result",
                        "text": "",
                        "error": str(e)
                    }))
            else:
                await websocket.send(json.dumps({
                    "type": "translate_result",
                    "text": "",
                    "error": "No model loaded"
                }))
        
        elif action == "transcribe_blob":
            # One-shot batch transcription: process audio file without starting a streaming session.
            # Client sends raw audio (webm/wav) as the next binary message.
            # Uses the in-memory model — no cold load, much faster than spawning a new Python process.
            language = cmd.get("language", "en")
            if self.transcriber and self.transcriber.model:
                try:
                    audio_data = await websocket.recv()
                    if isinstance(audio_data, bytes) and len(audio_data) > 100:
                        import tempfile
                        # Determine suffix from hint or default to .wav
                        fmt = cmd.get("format", "wav")
                        suffix = f".{fmt}" if fmt else ".wav"
                        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
                        tmp.write(audio_data)
                        tmp.close()
                        
                        try:
                            t0 = time.monotonic()
                            lang = language if language not in ('auto', '') else None
                            segments, info = self.transcriber.model.transcribe(
                                tmp.name,
                                language=lang,
                                task="transcribe",
                                beam_size=self.transcriber.config.beam_size,
                                vad_filter=True,
                                condition_on_previous_text=True,
                                no_speech_threshold=0.3,
                                log_prob_threshold=-1.0
                            )
                            
                            text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
                            elapsed = round(time.monotonic() - t0, 2)
                            audio_duration = getattr(info, 'duration', 0) or 0
                            ratio = round(elapsed / max(audio_duration, 0.01), 2)
                            
                            await websocket.send(json.dumps({
                                "type": "transcribe_result",
                                "text": text,
                                "elapsed_s": elapsed,
                                "audio_duration_s": round(audio_duration, 1),
                                "ratio": ratio,
                                "model": self.transcriber.config.model_size,
                                "engine": "local-whisper-ws"
                            }))
                            print(f"🎤 Batch transcribe: {len(text)} chars in {elapsed}s (ratio {ratio}, model {self.transcriber.config.model_size})")
                        finally:
                            try:
                                os.unlink(tmp.name)
                            except Exception:
                                pass
                    else:
                        await websocket.send(json.dumps({
                            "type": "transcribe_result",
                            "text": "",
                            "error": "No audio data received"
                        }))
                except Exception as e:
                    print(f"Transcribe blob error: {e}", file=sys.stderr)
                    await websocket.send(json.dumps({
                        "type": "transcribe_result",
                        "text": "",
                        "error": str(e)
                    }))
            else:
                await websocket.send(json.dumps({
                    "type": "transcribe_result",
                    "text": "",
                    "error": "No model loaded"
                }))
        
        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown action: {action}"
            }))
    
    async def start(self, config: TranscriberConfig = None):
        """Start the WebSocket server."""
        self._loop = asyncio.get_running_loop()

        # P9: remember when the server first came up for /health uptime
        # and cold-start diagnostics. monotonic clock so we're immune to
        # user clock jumps.
        self._started_monotonic = time.monotonic()
        self._started_wall = time.time()
        self._cold_start_ms = None
        self._model_config = config or TranscriberConfig()
        self._load_error = None

        if not WEBSOCKETS_AVAILABLE:
            print("websockets not installed. Run: pip install websockets",
                  file=sys.stderr)
            self._load_error = 'websockets_missing'
            return False

        # Initialize transcriber
        config = self._model_config
        self.transcriber = StreamingTranscriber(config)
        self.transcriber.on_state_change(self._on_state_change)
        self.transcriber.on_transcript(self._on_transcript)
        self.transcriber.on_performance_warning(self._on_performance_warning)

        # Optional test/CI bypass for model loading
        skip_model_load = os.environ.get("WINDY_SKIP_MODEL_LOAD", "0") in ("1", "true", "yes")

        # P9: measure cold-start time. The model load is the single
        # biggest chunk of first-packet latency — anything over ~5s
        # is worth surfacing so we catch regressions (e.g. arm64
        # falling back to Rosetta) without waiting for user reports.
        if skip_model_load:
            print("WINDY_SKIP_MODEL_LOAD=1 set; skipping model load (test mode)")
        else:
            print(f"[cold-start] loading transcription model: "
                  f"model={config.model_size} device={config.device}")
            t0 = time.monotonic()
            if not self.transcriber.load_model():
                self._load_error = 'model_load_failed'
                print("Failed to load model", file=sys.stderr)
                print(f"[cold-start] model load FAILED after "
                      f"{int((time.monotonic() - t0) * 1000)}ms", file=sys.stderr)
                return False
            self._cold_start_ms = int((time.monotonic() - t0) * 1000)
            print(f"[cold-start] model loaded in {self._cold_start_ms}ms")

        # Kill any existing process on our port before binding
        self._kill_port_holder()

        # Start server with retry for port-in-use
        print(f"\n{'='*50}")
        print(f"  Windy Pro Server v{SERVER_VERSION}")
        print(f"  ws://{self.host}:{self.port}")
        print(f"  Model: {config.model_size} | Device: {config.device}")
        print(f"{'='*50}\n")

        max_retries = 3
        for attempt in range(max_retries):
            try:
                self._server = await websockets.serve(
                    self._handle_client,
                    self.host,
                    self.port,
                    reuse_address=True,
                    max_size=50 * 1024 * 1024,  # 50MB — supports up to ~26 min recordings at 16kHz mono
                    # P9: HTTP handler — short-circuits non-WebSocket
                    # GET /health requests with a JSON status blob.
                    # Anything else falls through to the default
                    # handshake path for real WS clients.
                    process_request=self._process_request,
                )
                break  # Success
            except OSError as e:
                if attempt < max_retries - 1:
                    print(f"[Server] Port {self.port} busy (attempt {attempt+1}/{max_retries}): {e}")
                    self._kill_port_holder()
                    await asyncio.sleep(2)
                else:
                    print(f"[Server] Cannot bind to port {self.port} after {max_retries} attempts: {e}",
                          file=sys.stderr)
                    return False
        
        # Start heartbeat task to detect zombie connections
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        print(f"Server running. Waiting for connections...")
        return True

    async def _process_request(self, path, headers):
        """P9: /health endpoint.

        websockets.serve's `process_request` hook lets us answer plain
        HTTP requests without breaking the WebSocket handshake path.
        Returning None means "continue the WS handshake"; returning a
        (status, headers, body) tuple short-circuits with an HTTP
        response.

        Payload shape:
            {
              "status": "ok" | "loading" | "error",
              "uptime_sec": <float>,
              "cold_start_ms": <int|null>,
              "model": <model-name>,
              "device": <device>,
              "clients": <int>,
              "version": <server-version>,
              "error": <string|null>
            }
        """
        # `path` is either a string (older websockets) or a Request
        # object (websockets 12+). Normalise.
        req_path = path if isinstance(path, str) else getattr(path, 'path', '/')
        if req_path == '/health':
            try:
                payload = self._health_payload()
                body = json.dumps(payload).encode('utf-8')
                # Healthy = 200. If the transcriber failed to load, we
                # still answer — but with 503 so liveness probes see it.
                status = 200 if payload['status'] == 'ok' else 503
                return (status, [('Content-Type', 'application/json'),
                                 ('Cache-Control', 'no-store')], body)
            except Exception as e:
                body = json.dumps({'status': 'error', 'error': str(e)}).encode('utf-8')
                return (500, [('Content-Type', 'application/json')], body)
        # Return None to let the WS handshake proceed for every other
        # path.
        return None

    def _health_payload(self):
        """Build the /health JSON payload. Single source of truth for
        what we expose externally — unit-testable without spawning a
        server."""
        if self._load_error:
            status = 'error'
        elif self.transcriber is None:
            status = 'loading'
        else:
            status = 'ok'
        cfg = getattr(self, '_model_config', None)
        uptime = time.monotonic() - getattr(self, '_started_monotonic', time.monotonic())
        return {
            'status': status,
            'uptime_sec': round(uptime, 3),
            'cold_start_ms': self._cold_start_ms,
            'model': getattr(cfg, 'model_size', None) if cfg else None,
            'device': getattr(cfg, 'device', None) if cfg else None,
            'clients': len(self.clients),
            'version': SERVER_VERSION,
            'error': self._load_error,
        }

    def _kill_port_holder(self):
        """Kill any process holding our port (handles stale previous instances)."""
        import subprocess
        try:
            # Try lsof (Linux/macOS)
            result = subprocess.run(
                ['lsof', '-ti', f':{self.port}'],
                capture_output=True, text=True, timeout=5
            )
            if result.stdout.strip():
                pids = result.stdout.strip().split('\n')
                my_pid = str(os.getpid())
                for pid in pids:
                    pid = pid.strip()
                    if pid and pid != my_pid:
                        print(f"[Server] Killing stale process {pid} on port {self.port}")
                        try:
                            os.kill(int(pid), 9)
                        except (ProcessLookupError, PermissionError):
                            pass
                import time
                time.sleep(0.5)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            # lsof not available — try fuser
            try:
                subprocess.run(
                    ['fuser', '-k', f'{self.port}/tcp'],
                    capture_output=True, timeout=5
                )
                import time
                time.sleep(0.5)
            except (FileNotFoundError, subprocess.TimeoutExpired):
                pass  # No port cleanup tools available
    
    async def _heartbeat_loop(self):
        """Send heartbeat ping every 15s to detect zombie connections."""
        while True:
            await asyncio.sleep(15)
            if self.clients:
                await self._broadcast({"type": "pong", "heartbeat": True})
    
    async def stop(self):
        """Stop the server."""
        if hasattr(self, '_heartbeat_task') and self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        if self.transcriber:
            self.transcriber.stop_session()


async def main():
    """Run the server."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Windy Pro WebSocket Server")
    parser.add_argument("--host", default=os.environ.get("WINDY_HOST", "127.0.0.1"), help="Host to bind to")
    parser.add_argument("--port", type=int, default=int(os.environ.get("WINDY_PORT", "9876")), help="Port to listen on")
    parser.add_argument("--model", default="base", help="Whisper model size")
    parser.add_argument("--device", default="auto", help="Device (auto/cpu/cuda)")
    parser.add_argument("--language", default="en", help="Language code")
    args = parser.parse_args()
    
    config = TranscriberConfig(
        model_size=args.model,
        device=args.device,
        language=args.language
    )
    
    server = WindyServer(host=args.host, port=args.port)
    
    if await server.start(config):
        try:
            await asyncio.Future()  # Run forever
        except KeyboardInterrupt:
            print("\nShutting down...")
        finally:
            await server.stop()


if __name__ == "__main__":
    if not WEBSOCKETS_AVAILABLE:
        print("Install websockets: pip install websockets")
        sys.exit(1)
    
    asyncio.run(main())
