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
            return
        
        data = json.dumps(message)
        # Use _safe_send to gracefully handle dead connections
        await asyncio.gather(
            *[self._safe_send(client, data) for client in list(self.clients)],
            return_exceptions=True
        )
    
    async def _safe_send(self, ws: WebSocketServerProtocol, data: str):
        """Send data to a single client, removing it on failure."""
        try:
            await ws.send(data)
        except Exception:
            self.clients.discard(ws)
    
    def _on_state_change(self, old_state: TranscriptionState, new_state: TranscriptionState):
        """Handle transcriber state changes (thread-safe)."""
        if self._loop:
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future,
                self._broadcast({
                    "type": "state",
                    "state": new_state.value,
                    "previous": old_state.value
                })
            )
        else:
            asyncio.create_task(self._broadcast({
                "type": "state",
                "state": new_state.value,
                "previous": old_state.value
            }))
    
    def _on_transcript(self, segment):
        """Handle new transcript segments."""
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
        
        if self._loop:
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future,
                self._broadcast({
                    "type": "transcript",
                    "text": segment.text,
                    "start": segment.start_time,
                    "end": segment.end_time,
                    "confidence": segment.confidence,
                    "partial": segment.is_partial,
                    "words": segment.words
                })
            )
        else:
            asyncio.create_task(self._broadcast({
                "type": "transcript",
                "text": segment.text,
                "start": segment.start_time,
                "end": segment.end_time,
                "confidence": segment.confidence,
                "partial": segment.is_partial,
                "words": segment.words
            }))
    
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
                    "session_id": self._current_session_id
                }))
        
        elif action == "stop":
            if self.transcriber:
                transcript = self.transcriber.stop_session()
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

            # Vibe toggle (hot-swappable)
            if "vibe_enabled" in config_data:
                self.vibe.enabled = config_data["vibe_enabled"]
                applied["vibe_enabled"] = config_data["vibe_enabled"]

            # Device change (hot-swappable)
            if "device" in config_data and self.transcriber:
                self.transcriber.config.device = config_data["device"]
                applied["device"] = config_data["device"]

            # Model change requires restart — queue it
            if "model" in config_data:
                applied["model"] = config_data["model"]
                applied["model_note"] = "Model change takes effect on next session start"
                self._pending_model = config_data["model"]

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
        
        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown action: {action}"
            }))
    
    async def start(self, config: TranscriberConfig = None):
        """Start the WebSocket server."""
        self._loop = asyncio.get_running_loop()
        
        if not WEBSOCKETS_AVAILABLE:
            print("websockets not installed. Run: pip install websockets",
                  file=sys.stderr)
            return False
        
        # Initialize transcriber
        config = config or TranscriberConfig()
        self.transcriber = StreamingTranscriber(config)
        self.transcriber.on_state_change(self._on_state_change)
        self.transcriber.on_transcript(self._on_transcript)

        # Optional test/CI bypass for model loading to keep integration tests
        # deterministic when whisper dependencies are intentionally absent.
        skip_model_load = os.environ.get("WINDY_SKIP_MODEL_LOAD", "0") in ("1", "true", "yes")
        
        # Load model
        if skip_model_load:
            print("WINDY_SKIP_MODEL_LOAD=1 set; skipping model load (test mode)")
        else:
            print("Loading transcription model...")
            if not self.transcriber.load_model():
                print("Failed to load model", file=sys.stderr)
                return False
        
        # Start server
        print(f"\n{'='*50}")
        print(f"  Windy Pro Server v{SERVER_VERSION}")
        print(f"  ws://{self.host}:{self.port}")
        print(f"  Model: {config.model_size} | Device: {config.device}")
        print(f"{'='*50}\n")
        self._server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port
        )
        
        # Start heartbeat task to detect zombie connections
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        print(f"Server running. Waiting for connections...")
        return True
    
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
