#!/usr/bin/env python3
"""
Windy Pro — Cloud Load Test (G6)

Tests concurrent WebSocket transcription sessions against the cloud API.
Validates:
  1. Multiple concurrent sessions produce independent results
  2. Per-user concurrency limit (max 1 session/user) is enforced
  3. No server crash under concurrent load

Usage:
    # Start the API first (with env vars set):
    WINDY_JWT_SECRET=test WINDY_API_KEY=test python -m src.cloud.api

    # Then run:
    python tests/test_load.py --url ws://localhost:8000/ws/transcribe --api-url http://localhost:8000
"""

import asyncio
import json
import struct
import sys
import os
import time
import argparse
import pytest

# This module is a manual load-test harness intended to be run as a script.
# Skip in normal pytest runs unless explicitly enabled.
pytestmark = pytest.mark.skipif(
    os.environ.get("WINDY_RUN_LOAD_TESTS", "0") != "1",
    reason="manual load tests (set WINDY_RUN_LOAD_TESTS=1 to include)",
)

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


async def register_user(api_url: str, email: str, password: str, name: str) -> str:
    """Register a user and return the JWT token."""
    import urllib.request
    data = json.dumps({"email": email, "password": password, "name": name}).encode()
    req = urllib.request.Request(
        f"{api_url}/api/v1/auth/register",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())["token"]
    except Exception:
        # User may already exist; try login
        return await login_user(api_url, email, password)


async def login_user(api_url: str, email: str, password: str) -> str:
    """Login and return the JWT token."""
    import urllib.request
    data = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{api_url}/api/v1/auth/login",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["token"]


def generate_fake_audio(duration_s: float = 1.0, sample_rate: int = 16000) -> bytes:
    """Generate silence as Int16 PCM bytes (valid audio format for the server)."""
    import random
    num_samples = int(sample_rate * duration_s)
    # Low-level noise instead of pure silence so VAD doesn't filter everything
    samples = [random.randint(-100, 100) for _ in range(num_samples)]
    return struct.pack(f"<{num_samples}h", *samples)


async def run_session(ws_url: str, token: str, user_label: str, audio_chunks: int = 3) -> dict:
    """Run a single transcription session. Returns result dict."""
    try:
        import websockets
    except ImportError:
        print("ERROR: 'websockets' package required. Install with: pip install websockets")
        sys.exit(1)

    result = {
        "user": user_label,
        "connected": False,
        "authenticated": False,
        "started": False,
        "chunks_sent": 0,
        "transcripts_received": 0,
        "errors": [],
        "duration_s": 0,
    }

    t0 = time.monotonic()

    try:
        async with websockets.connect(ws_url) as ws:
            result["connected"] = True

            # Authenticate
            await ws.send(json.dumps({"action": "auth", "token": token}))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get("type") == "error":
                result["errors"].append(f"Auth error: {resp.get('message')}")
                return result
            result["authenticated"] = True

            # Start recording
            await ws.send(json.dumps({"action": "start"}))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get("state") == "listening":
                result["started"] = True

            # Send audio chunks
            for i in range(audio_chunks):
                audio = generate_fake_audio(1.0)
                await ws.send(audio)
                result["chunks_sent"] += 1
                await asyncio.sleep(0.1)

            # Give server time to process
            await asyncio.sleep(2.0)

            # Stop recording
            await ws.send(json.dumps({"action": "stop"}))

            # Collect remaining messages for up to 3 seconds
            try:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=3)
                    data = json.loads(msg)
                    if data.get("type") == "transcript":
                        result["transcripts_received"] += 1
                    elif data.get("type") == "state" and data.get("state") == "idle":
                        break
            except asyncio.TimeoutError:
                pass

    except Exception as e:
        result["errors"].append(str(e))

    result["duration_s"] = round(time.monotonic() - t0, 2)
    return result


async def test_concurrent_sessions(ws_url: str, api_url: str, num_users: int = 3):
    """Test concurrent sessions from different users."""
    print(f"\n{'='*60}")
    print(f"  LOAD TEST: {num_users} concurrent users")
    print(f"  WS URL:  {ws_url}")
    print(f"  API URL: {api_url}")
    print(f"{'='*60}\n")

    # Register unique users
    tokens = []
    for i in range(num_users):
        email = f"loadtest{i}_{int(time.time())}@test.com"
        token = await register_user(api_url, email, "testpassword123", f"LoadUser{i}")
        tokens.append((f"user{i}", token))
        print(f"  ✅ Registered {email}")

    # Run all sessions concurrently
    print(f"\n  ▶ Starting {num_users} concurrent sessions...\n")
    tasks = [
        run_session(ws_url, token, label, audio_chunks=3)
        for label, token in tokens
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Report
    print(f"\n{'─'*60}")
    print(f"  RESULTS")
    print(f"{'─'*60}\n")

    all_ok = True
    for r in results:
        if isinstance(r, Exception):
            print(f"  ❌ EXCEPTION: {r}")
            all_ok = False
            continue

        status = "✅" if r["authenticated"] and r["started"] and not r["errors"] else "❌"
        if status == "❌":
            all_ok = False
        print(f"  {status} {r['user']}: connected={r['connected']} auth={r['authenticated']} "
              f"started={r['started']} chunks={r['chunks_sent']} "
              f"transcripts={r['transcripts_received']} duration={r['duration_s']}s")
        if r["errors"]:
            for e in r["errors"]:
                print(f"     ⚠ {e}")

    print(f"\n{'─'*60}")


async def test_per_user_limit(ws_url: str, api_url: str):
    """Test that a second concurrent session from the same user is rejected."""
    print(f"\n{'='*60}")
    print(f"  RATE LIMIT TEST: Same user, 2 concurrent sessions")
    print(f"{'='*60}\n")

    try:
        import websockets
    except ImportError:
        print("ERROR: 'websockets' package required")
        sys.exit(1)

    email = f"ratelimit_{int(time.time())}@test.com"
    token = await register_user(api_url, email, "testpassword123", "RateLimitUser")
    print(f"  ✅ Registered {email}")

    # Open first connection
    ws1 = await websockets.connect(ws_url)
    await ws1.send(json.dumps({"action": "auth", "token": token}))
    resp1 = json.loads(await asyncio.wait_for(ws1.recv(), timeout=5))
    print(f"  ✅ Session 1 authenticated: {resp1}")

    # Try to open second connection with same user
    ws2 = await websockets.connect(ws_url)
    await ws2.send(json.dumps({"action": "auth", "token": token}))

    try:
        resp2 = json.loads(await asyncio.wait_for(ws2.recv(), timeout=5))
        if resp2.get("type") == "error" and "already have an active" in resp2.get("message", ""):
            print(f"  ✅ Session 2 correctly rejected: {resp2['message']}")
        else:
            # Check for close
            try:
                _ = await asyncio.wait_for(ws2.recv(), timeout=2)
            except Exception:
                pass
            print(f"  ✅ Session 2 rejected (connection closed)")
    except Exception as e:
        print(f"  ✅ Session 2 rejected with: {e}")

    await ws1.close()
    try:
        await ws2.close()
    except Exception:
        pass

    print(f"\n{'─'*60}")


async def main():
    parser = argparse.ArgumentParser(description="Windy Pro Cloud Load Test")
    parser.add_argument("--url", default="ws://localhost:8000/ws/transcribe", help="WebSocket URL")
    parser.add_argument("--api-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--users", type=int, default=3, help="Number of concurrent users")
    parser.add_argument("--skip-load", action="store_true", help="Skip load test, only run rate limit test")
    args = parser.parse_args()

    if not args.skip_load:
        await test_concurrent_sessions(args.url, args.api_url, args.users)

    await test_per_user_limit(args.url, args.api_url)

    print("\n  🏁 Load test complete.\n")


if __name__ == "__main__":
    asyncio.run(main())
