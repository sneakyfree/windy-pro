"""
Integration test: spawn src/engine/server.py with WINDY_SKIP_MODEL_LOAD=1,
hit /health via HTTP, assert the response shape.

Pins the contract between the server's process_request hook and
external consumers (main.js liveness probe, load-time regression
detection). A regression that breaks /health would fail here.

Doesn't require faster_whisper to load a model — relies on the
SKIP_MODEL_LOAD env var to bypass the heavy transcriber init.
Still needs `websockets` and Python 3.11+ available.

Addresses CR-008 in docs/CODE-REVIEW-2026-04.md.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

HERE = os.path.dirname(__file__)
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Skip entire file on websockets >= 14 — the library's legacy
# `websockets.serve` API deprecated `process_request`, so the /health
# hook doesn't fire. server.py itself targets the bundled websockets
# version (pinned in requirements-bundle.txt, currently 13.x). Local
# dev installs may pull newer versions where this test can't run.
try:
    import websockets
    _ws_major = int(websockets.__version__.split('.')[0])
    if _ws_major >= 14:
        pytest.skip(
            f"websockets {websockets.__version__} doesn't fire the legacy "
            "process_request hook; install websockets<14 to run this test.",
            allow_module_level=True,
        )
except ImportError:
    pytest.skip("websockets not installed", allow_module_level=True)


def _free_port():
    """Ask the OS for a free port instead of hoping 9876 isn't taken."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def running_engine():
    """Spawn the engine on a free port, wait for /health, yield the
    base URL. Kills the subprocess on teardown."""
    port = _free_port()
    env = {
        **os.environ,
        "WINDY_SKIP_MODEL_LOAD": "1",
        "PYTHONPATH": REPO_ROOT,  # so `src.engine.server` resolves
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "src.engine.server",
         "--host", "127.0.0.1", "--port", str(port)],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    # Wait up to 10s for /health to become reachable.
    deadline = time.time() + 10
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/health", timeout=0.5):
                break
        except (urllib.error.URLError, ConnectionResetError, ConnectionRefusedError) as e:
            last_err = e
            time.sleep(0.25)
    else:
        proc.terminate()
        out, _ = proc.communicate(timeout=2)
        raise RuntimeError(
            f"engine did not come up within 10s at {base}. "
            f"Last error: {last_err}. "
            f"stdout:\n{out.decode('utf-8', errors='replace')}"
        )
    yield base
    proc.terminate()
    try: proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_health_endpoint_returns_json(running_engine):
    with urllib.request.urlopen(f"{running_engine}/health", timeout=2) as r:
        assert r.status == 200 or r.status == 503
        body = json.loads(r.read())
    # Contract shape pinned by docs/ENGINE-PROTOCOL.md
    assert "status" in body
    assert body["status"] in ("ok", "loading", "error")
    assert isinstance(body["uptime_sec"], (int, float))
    assert "model" in body
    assert "device" in body
    assert "clients" in body
    assert "version" in body
    assert "error" in body


def test_health_endpoint_cache_control(running_engine):
    """/health must not be cached by anything between engine and caller."""
    with urllib.request.urlopen(f"{running_engine}/health", timeout=2) as r:
        assert r.getheader("Cache-Control") == "no-store"


def test_non_health_http_gets_no_response(running_engine):
    """Only /health is implemented. Any other HTTP path should not
    return 200 — the WS handshake takes over. urllib will see a
    protocol error or connection drop, not a success."""
    with pytest.raises((urllib.error.URLError, urllib.error.HTTPError, ConnectionResetError)):
        urllib.request.urlopen(f"{running_engine}/not-a-real-endpoint", timeout=2)
