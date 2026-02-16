"""
Tests for Windy Pro Server — WebSocket Integration
"""

import pytest
import asyncio
import json
import websockets
import threading
import time
from src.engine.server import WindyServer

# Use a random available port to avoid conflict with running server
import socket

def _get_free_port():
    with socket.socket() as s:
        s.bind(('', 0))
        return s.getsockname()[1]

TEST_PORT = _get_free_port()


@pytest.fixture
async def server():
    """Start server in a background thread."""
    srv = WindyServer(host="127.0.0.1", port=TEST_PORT)
    
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=_run_server, args=(srv, loop))
    thread.daemon = True
    thread.start()
    
    # Give server time to start
    await asyncio.sleep(0.3)
    
    yield srv
    
    # Cleanup
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=2)


def _run_server(server, loop):
    asyncio.set_event_loop(loop)
    loop.run_until_complete(server.start())


@pytest.mark.asyncio
async def test_websocket_connects(server):
    """Test basic WebSocket connection."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        # Should receive initial state message
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "state"
        assert data["state"] == "idle"


@pytest.mark.asyncio
async def test_ping_pong(server):
    """Test ping/pong protocol."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        # Consume initial state message
        await ws.recv()
        
        # Send ping
        await ws.send(json.dumps({"action": "ping", "timestamp": 12345}))
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "pong"
        assert data["timestamp"] == 12345


@pytest.mark.asyncio
async def test_start_stop_commands(server):
    """Test start/stop command flow."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        # Consume initial state
        await ws.recv()
        
        # Send start
        await ws.send(json.dumps({"action": "start"}))
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "state"
        assert data["state"] == "listening"
        
        # Send stop
        await ws.send(json.dumps({"action": "stop"}))
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "state"
        assert data["state"] == "idle"


@pytest.mark.asyncio
async def test_binary_audio_accepted(server):
    """Test that binary audio data is accepted without error."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        # Consume initial state
        await ws.recv()
        
        # Start recording
        await ws.send(json.dumps({"action": "start"}))
        await ws.recv()  # state change
        
        # Send binary audio (16kHz, 100ms of silence)
        import numpy as np
        silence = np.zeros(1600, dtype=np.int16).tobytes()
        await ws.send(silence)
        
        # Should not crash — send another ping to verify
        await ws.send(json.dumps({"action": "ping", "timestamp": 999}))
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "pong"


@pytest.mark.asyncio
async def test_invalid_json(server):
    """Test error handling for invalid JSON."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        await ws.recv()  # initial state
        
        await ws.send("not-valid-json")
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "error"


@pytest.mark.asyncio
async def test_vault_list_command(server):
    """Test vault_list WebSocket command."""
    async with websockets.connect(f"ws://127.0.0.1:{TEST_PORT}") as ws:
        await ws.recv()  # initial state
        
        await ws.send(json.dumps({"action": "vault_list"}))
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["type"] == "vault_list"
        assert "sessions" in data
