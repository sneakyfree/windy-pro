"""
Tests for Windy Pro Server — WebSocket Integration
"""

import pytest
import asyncio
import json
import websockets
import threading
import time
import os
from src.engine.server import WindyServer

# Use a random available port to avoid conflict with running server
import socket

def _get_free_port():
    with socket.socket() as s:
        s.bind(('', 0))
        return s.getsockname()[1]


@pytest.fixture
async def server():
    """Start server in a background thread with a fresh port."""
    port = _get_free_port()
    os.environ["WINDY_SKIP_MODEL_LOAD"] = "1"
    srv = WindyServer(host="127.0.0.1", port=port)
    srv._test_port = port  # stash for tests to read
    
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=_run_server, args=(srv, loop))
    thread.daemon = True
    thread.start()
    
    # Give server time to start
    await asyncio.sleep(0.6)
    
    yield srv
    
    # Cleanup
    try:
        fut = asyncio.run_coroutine_threadsafe(srv.stop(), loop)
        fut.result(timeout=2)
    except Exception:
        pass
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=2)
    os.environ.pop("WINDY_SKIP_MODEL_LOAD", None)


def _run_server(server, loop):
    asyncio.set_event_loop(loop)
    started = loop.run_until_complete(server.start())
    if started:
        loop.run_forever()


@pytest.mark.asyncio
async def test_websocket_connects(server):
    """Test basic WebSocket connection."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        # Should receive initial state message
        msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
        data = json.loads(msg)
        assert data["type"] == "state"
        assert data["state"] == "idle"


@pytest.mark.asyncio
async def test_ping_pong(server):
    """Test ping/pong protocol."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        # Consume initial state message
        await ws.recv()
        
        # Send ping
        await ws.send(json.dumps({"action": "ping", "timestamp": 12345}))
        msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
        data = json.loads(msg)
        assert data["type"] == "pong"
        assert data["timestamp"] == 12345


@pytest.mark.asyncio
async def test_start_stop_commands(server):
    """Test start/stop command flow."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        # Consume initial state
        await ws.recv()
        
        # Send start
        await ws.send(json.dumps({"action": "start"}))
        saw_listening = False
        for _ in range(4):
            msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
            data = json.loads(msg)
            if data.get("type") == "state" and data.get("state") == "listening":
                saw_listening = True
                break
        assert saw_listening

        # Send stop
        await ws.send(json.dumps({"action": "stop"}))
        saw_idle = False
        for _ in range(4):
            msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
            data = json.loads(msg)
            if data.get("type") == "state" and data.get("state") == "idle":
                saw_idle = True
                break
        assert saw_idle


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason="Binary audio processing requires a loaded model; stop_session may block in test mode",
    strict=False,
)
async def test_binary_audio_accepted(server):
    """Test that binary audio data is accepted without crashing the server."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        # Consume initial state
        await ws.recv()
        
        # Start recording
        await ws.send(json.dumps({"action": "start"}))
        for _ in range(4):
            msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
            data = json.loads(msg)
            if data.get("type") == "state" and data.get("state") == "listening":
                break

        # Send binary audio (16kHz, 100ms of silence)
        import numpy as np
        silence = np.zeros(1600, dtype=np.int16).tobytes()
        await ws.send(silence)

        # Brief pause — server buffers the data (no model in test mode)
        await asyncio.sleep(0.5)

        # Stop recording — this proves the connection survived binary data
        await ws.send(json.dumps({"action": "stop"}))
        
        # Drain messages until we see idle or stop-ack
        saw_response = False
        for _ in range(10):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
                data = json.loads(msg)
                if data.get("type") in ("state", "ack"):
                    saw_response = True
                    if data.get("state") == "idle" or data.get("action") == "stop":
                        break
            except asyncio.TimeoutError:
                break
        assert saw_response, "Server should respond after binary audio + stop"


@pytest.mark.asyncio
async def test_invalid_json(server):
    """Test error handling for invalid JSON."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        await ws.recv()  # initial state
        
        await ws.send("not-valid-json")
        msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
        data = json.loads(msg)
        assert data["type"] == "error"


@pytest.mark.asyncio
async def test_vault_list_command(server):
    """Test vault_list WebSocket command."""
    async with websockets.connect(f"ws://127.0.0.1:{server._test_port}") as ws:
        await ws.recv()  # initial state
        
        await ws.send(json.dumps({"action": "vault_list"}))
        msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
        data = json.loads(msg)
        assert data["type"] == "vault_list"
        assert "sessions" in data
