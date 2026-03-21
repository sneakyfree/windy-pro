"""
Windy Pro - Translation WebSocket Server
Serves M2M-100 translation on port 9877.

Protocol:
- Client sends JSON: {"text": "...", "source_lang": "en", "target_lang": "es"}
- Server responds with: {"translated_text": "...", "source_lang": "en", "target_lang": "es", "model": "m2m100_418M", "inference_ms": 123}
- Supports {"type": "health"} for health checks
"""

import asyncio
import json
import sys
import os
from typing import Set, Any
from pathlib import Path

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None

WebSocketServerProtocol = Any

from .translator import Translator, TranslationConfig

SERVER_VERSION = "0.1.0"


class TranslationServer:
    """
    WebSocket server for Windy Pro Translation.

    Handles:
    - Text-to-text translation requests
    - Health checks
    - Auto language detection
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 9877):
        self.host = host
        self.port = port
        self.translator: Translator = None
        self.clients: Set[WebSocketServerProtocol] = set()
        self._server = None
        self._loop = None

    async def _safe_send(self, ws: WebSocketServerProtocol, data: str):
        """Send data to a single client, removing it on failure."""
        try:
            await ws.send(data)
        except Exception:
            self.clients.discard(ws)

    async def _handle_client(self, websocket: WebSocketServerProtocol):
        """Handle a client connection."""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(f"Client connected: {client_addr}")

        # Get model name
        model_name = "m2m100_418M"
        if self.translator and hasattr(self.translator, 'config'):
            if self.translator.config.model_type == "finetuned":
                model_name = "windy-translate-spark"
            elif self.translator.config.model_type == "lora":
                model_name = "m2m100_418M_lora"

        # Send welcome message
        await websocket.send(json.dumps({
            "type": "connected",
            "server_version": SERVER_VERSION,
            "model": model_name,
            "status": "ready"
        }))

        try:
            async for message in websocket:
                if isinstance(message, str):
                    # JSON command
                    try:
                        request = json.loads(message)
                        response = await self._handle_request(request)
                        await websocket.send(json.dumps(response))
                    except json.JSONDecodeError:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "error": "Invalid JSON"
                        }))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "error": str(e)
                        }))
                else:
                    # Unexpected binary data
                    await websocket.send(json.dumps({
                        "type": "error",
                        "error": "Expected text message, got binary"
                    }))

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"Client disconnected: {client_addr}")

    async def _handle_request(self, request: dict) -> dict:
        """Handle a translation request."""
        request_type = request.get("type", "translate")

        # Health check
        if request_type == "health":
            vram_usage = self.translator.get_vram_usage() if self.translator else {}
            model_name = "m2m100_418M"
            if self.translator and hasattr(self.translator, 'config'):
                if self.translator.config.model_type == "finetuned":
                    model_name = "windy-translate-spark"
                elif self.translator.config.model_type == "lora":
                    model_name = "m2m100_418M_lora"
            return {
                "type": "health",
                "status": "ok",
                "server_version": SERVER_VERSION,
                "model": model_name,
                "model_loaded": self.translator is not None and self.translator._loaded,
                "device": self.translator.device if self.translator else None,
                "vram_usage": vram_usage
            }

        # Get supported languages
        if request_type == "languages":
            languages = self.translator.get_supported_languages() if self.translator else []
            return {
                "type": "languages",
                "languages": languages
            }

        # Translation request
        if request_type == "translate" or "text" in request:
            text = request.get("text", "").strip()
            source_lang = request.get("source_lang", "auto")
            target_lang = request.get("target_lang", "en")

            # Validation
            if not text:
                return {
                    "type": "error",
                    "error": "Missing or empty 'text' field"
                }

            if not target_lang:
                return {
                    "type": "error",
                    "error": "Missing 'target_lang' field"
                }

            if not self.translator or not self.translator._loaded:
                return {
                    "type": "error",
                    "error": "Translation model not loaded"
                }

            # Perform translation (run in thread pool to avoid blocking event loop)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self.translator.translate,
                text,
                source_lang,
                target_lang,
                True  # return_timing
            )

            # Add type field
            result["type"] = "translation"

            # Log to console
            if "error" not in result:
                print(f"[{result['source_lang']} → {result['target_lang']}] {result['inference_ms']}ms")

            return result

        # Unknown request type
        return {
            "type": "error",
            "error": f"Unknown request type: {request_type}"
        }

    async def start(self, config: TranslationConfig = None):
        """Start the WebSocket server."""
        self._loop = asyncio.get_running_loop()

        if not WEBSOCKETS_AVAILABLE:
            print("websockets not installed. Run: pip install websockets",
                  file=sys.stderr)
            return False

        # Initialize translator
        config = config or TranslationConfig()
        self.translator = Translator(config)

        # Load model
        print("Loading translation model...")
        if not self.translator.load_model():
            print("Failed to load model", file=sys.stderr)
            return False

        # Get model name for display
        model_display = "m2m100_418M"
        if hasattr(self.translator, 'config'):
            if self.translator.config.model_type == "finetuned":
                model_display = "windy-translate-spark"
            elif self.translator.config.model_type == "lora":
                model_display = "m2m100_418M_lora"

        # Start server
        print(f"\n{'='*50}")
        print(f"  Windy Pro Translation Server v{SERVER_VERSION}")
        print(f"  ws://{self.host}:{self.port}")
        print(f"  Model: {model_display} | Device: {self.translator.device}")
        print(f"{'='*50}\n")

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
        print("Server stopped")


async def main():
    """Run the server."""
    import argparse

    parser = argparse.ArgumentParser(description="Windy Pro Translation WebSocket Server")
    parser.add_argument("--host", default=os.environ.get("WINDY_TRANSLATION_HOST", "127.0.0.1"), help="Host to bind to")
    parser.add_argument("--port", type=int, default=int(os.environ.get("WINDY_TRANSLATION_PORT", "9877")), help="Port to listen on")
    parser.add_argument("--device", default="auto", help="Device (auto/cpu/cuda)")
    parser.add_argument("--model-path", default=None, help="Path to M2M-100 model")
    parser.add_argument("--model-type", default="base", choices=["base", "finetuned", "lora"], help="Model type (base/finetuned/lora)")
    parser.add_argument("--lora-adapter", default=None, help="Path to LoRA adapter (if model-type=lora)")
    args = parser.parse_args()

    config = TranslationConfig(
        device=args.device,
        model_path=args.model_path,
        model_type=args.model_type,
        lora_adapter_path=args.lora_adapter
    )

    server = TranslationServer(host=args.host, port=args.port)

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
