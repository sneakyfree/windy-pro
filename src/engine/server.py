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
from typing import Set

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None

from .transcriber import StreamingTranscriber, TranscriberConfig, TranscriptionState
from .vault import PromptVault
from .vibe import VibeProcessor


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
        
    async def _broadcast(self, message: dict):
        """Send message to all connected clients."""
        if not self.clients:
            return
        
        data = json.dumps(message)
        await asyncio.gather(
            *[client.send(data) for client in self.clients],
            return_exceptions=True
        )
    
    def _on_state_change(self, old_state: TranscriptionState, new_state: TranscriptionState):
        """Handle transcriber state changes."""
        self._loop.call_soon_threadsafe(
            asyncio.ensure_future,
            self._broadcast({
                "type": "state",
                "state": new_state.value,
                "previous": old_state.value
            })
        )
    
    def _on_transcript(self, segment):
        """Handle new transcript segments."""
        # Apply vibe processing if enabled
        if self.vibe.enabled and not segment.is_partial:
            segment.text = self.vibe.process(segment.text)
        
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
                self.transcriber.start_session()
                self._current_session_id = self.vault.create_session()
                await websocket.send(json.dumps({
                    "type": "ack",
                    "action": "start",
                    "success": True,
                    "session_id": self._current_session_id
                }))
        
        elif action == "stop":
            if self.transcriber:
                transcript = self.transcriber.stop_session()
                if self._current_session_id:
                    self.vault.end_session(self._current_session_id)
                    self._current_session_id = None
                await websocket.send(json.dumps({
                    "type": "ack",
                    "action": "stop",
                    "success": True,
                    "transcript": transcript
                }))
        
        elif action == "config":
            config_data = cmd.get("config", {})
            applied = {}

            # Apply language change (hot-swappable)
            if "language" in config_data and self.transcriber:
                self.transcriber.config.language = config_data["language"]
                applied["language"] = config_data["language"]

            # Apply vibe toggle (hot-swappable)
            if "vibe_enabled" in config_data:
                self.vibe.enabled = config_data["vibe_enabled"]
                applied["vibe_enabled"] = config_data["vibe_enabled"]

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
        
        # Load model
        print("Loading transcription model...")
        if not self.transcriber.load_model():
            print("Failed to load model", file=sys.stderr)
            return False
        
        # Start server
        print(f"Starting WebSocket server on ws://{self.host}:{self.port}")
        self._server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port
        )
        print(f"Server running. Waiting for connections...")
        return True
    
    async def stop(self):
        """Stop the server."""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        if self.transcriber:
            self.transcriber.stop_session()


async def main():
    """Run the server."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Windy Pro WebSocket Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=9876, help="Port to listen on")
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
