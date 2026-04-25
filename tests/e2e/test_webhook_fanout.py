"""
End-to-end verification that POST /api/v1/auth/register fans out
identity.created to every configured target with the correct per-target
HMAC-SHA256 signature, within a tight time budget.

Design
------
This is a **producer-side** e2e test. It boots the real account-server as
a subprocess and stands up 5 local HTTP stubs (one per consumer target).
No real consumer services (Windy Mail, Chat, Cloud, Clone, Eternitas) are
required — the stubs record what the producer sends and the assertions
confirm signature + payload + timing. That's enough to prove the
producer-side wiring end-to-end.

When real consumer services are running, point the env vars at those
URLs instead (bypassing this test); see deploy/docs/webhook-env-vars.md
for per-consumer secret setup.

Status of the 5 receivers as of 2026-04-16:
  - Windy Mail     — handler present at api/app/routes/webhooks.py
  - Windy Chat     — handler present at services/onboarding/routes/webhooks.js
  - Windy Cloud    — handler present at api/app/routes/webhooks.py
  - Eternitas      — NO /api/v1/webhooks/identity/created handler yet
  - Windy Clone    — repo not yet present on this machine
The producer-side test below is valid for all 5; full ecosystem e2e
still needs Eternitas + Clone receivers built.

Running
-------
    cd /Users/thewindstorm/windy-pro
    python -m pytest tests/e2e/test_webhook_fanout.py -v

Requires:
  - Node + npx in PATH (account-server is spawned via `npx tsx`)
  - Python packages: pytest, requests
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from queue import Empty, Queue
from typing import Dict

import pytest
import requests


ACCOUNT_SERVER_DIR = "/Users/thewindstorm/windy-pro/account-server"
FANOUT_TIMEOUT_SECONDS = 10
STARTUP_TIMEOUT_SECONDS = 30

# Producer-side target name → (URL env var, SECRET env var).
# Eternitas uses ETERNITAS_* (no WINDY_ prefix) per services/webhook-bus.ts.
TARGETS: Dict[str, Dict[str, str]] = {
    "mail":      {"url_env": "WINDY_MAIL_URL",   "secret_env": "WINDY_MAIL_WEBHOOK_SECRET"},
    "chat":      {"url_env": "WINDY_CHAT_URL",   "secret_env": "WINDY_CHAT_WEBHOOK_SECRET"},
    "cloud":     {"url_env": "WINDY_CLOUD_URL",  "secret_env": "WINDY_CLOUD_WEBHOOK_SECRET"},
    "clone":     {"url_env": "WINDY_CLONE_URL",  "secret_env": "WINDY_CLONE_WEBHOOK_SECRET"},
    "eternitas": {"url_env": "ETERNITAS_URL",    "secret_env": "ETERNITAS_WEBHOOK_SECRET"},
}


def _free_port() -> int:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def _make_handler(queue: Queue):
    """Factory: returns a BaseHTTPRequestHandler subclass that records every
    POST into `queue` and replies 200."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):  # keep the test output clean
            return

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8") if length else ""
            queue.put({
                "path": self.path,
                "headers": {k: v for k, v in self.headers.items()},
                "body": body,
            })
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

    return Handler


@pytest.fixture(scope="module")
def stubs():
    """Spin up one HTTP stub per target. Tears down at module end."""
    targets: Dict[str, Dict] = {}
    for name in TARGETS:
        port = _free_port()
        q: Queue = Queue()
        server = HTTPServer(("127.0.0.1", port), _make_handler(q))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        targets[name] = {
            "url": f"http://127.0.0.1:{port}",
            # Fresh 256-bit secret per run so we know any signature we verify
            # was computed with this exact value — rules out env-var leakage.
            "secret": secrets.token_hex(32),
            "queue": q,
            "server": server,
        }
    yield targets
    for t in targets.values():
        t["server"].shutdown()


def _collect_webhook_per_target(stubs: Dict[str, Dict], deadline: float) -> Dict[str, Dict]:
    """For each target, drain the queue until we find an entry whose path is
    /api/v1/webhooks/identity/created (the event we care about), or the
    deadline passes.

    Targets may receive other requests during startup — e.g. Eternitas gets
    a platform-register call from `registerWithEternitas()`. Those are
    harmless background traffic; we just skip past them.
    """
    found: Dict[str, Dict] = {}
    target_path = "/api/v1/webhooks/identity/created"
    for name_, cfg in stubs.items():
        while time.time() < deadline:
            remaining = max(0.1, deadline - time.time())
            try:
                item = cfg["queue"].get(timeout=remaining)
            except Empty:
                break
            if item["path"] == target_path:
                found[name_] = item
                break
            # Non-matching path — drop it and keep waiting for the webhook
        if name_ not in found:
            pytest.fail(
                f"{name_}: did not receive a POST to {target_path} before deadline "
                f"({FANOUT_TIMEOUT_SECONDS}s total budget)"
            )
    return found


def _wait_for_health(base_url: str, timeout_s: int) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if requests.get(f"{base_url}/health", timeout=1).status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


@pytest.fixture(scope="module")
def account_server(stubs):
    """Boot the account-server on a free port with TARGET env vars pointed at
    the stubs. Yields the base URL. Terminates on teardown."""
    port = _free_port()
    env = os.environ.copy()
    env["NODE_ENV"] = "development"
    env["PORT"] = str(port)
    env["JWT_SECRET"] = secrets.token_hex(32)
    env["MFA_ENCRYPTION_KEY"] = secrets.token_hex(32)
    env["DATABASE_URL"] = ""        # force SQLite
    env["REDIS_URL"] = ""            # force in-memory
    # Silence optional integrations so startup is quick
    env["STRIPE_SECRET_KEY"] = ""
    env["STRIPE_WEBHOOK_SECRET"] = ""

    # Wire every target's URL + secret to the matching stub
    for name, cfg in stubs.items():
        env[TARGETS[name]["url_env"]] = cfg["url"]
        env[TARGETS[name]["secret_env"]] = cfg["secret"]

    log_file = open(f"/tmp/e2e-account-server-{port}.log", "w")
    proc = subprocess.Popen(
        ["npx", "tsx", "src/server.ts"],
        cwd=ACCOUNT_SERVER_DIR,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )

    base = f"http://127.0.0.1:{port}"
    if not _wait_for_health(base, STARTUP_TIMEOUT_SECONDS):
        proc.terminate()
        log_file.close()
        with open(log_file.name) as f:
            tail = f.read()[-2000:]
        pytest.fail(f"account-server did not become healthy on {base} within "
                    f"{STARTUP_TIMEOUT_SECONDS}s.\n--- server log tail ---\n{tail}")

    yield base

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    log_file.close()


def test_register_fans_out_identity_created_to_all_targets(account_server, stubs):
    """A single POST /api/v1/auth/register should cause every configured
    target to receive a signed identity.created webhook within the budget."""
    email = f"e2e-{int(time.time() * 1000)}-{secrets.token_hex(4)}@example.com"
    name = "E2E Fanout User"

    resp = requests.post(
        f"{account_server}/api/v1/auth/register",
        json={"name": name, "email": email, "password": "SecurePass1"},
        timeout=5,
    )
    assert resp.status_code == 201, f"register failed: {resp.status_code} {resp.text}"
    body = resp.json()
    windy_identity_id = body["windyIdentityId"]

    deadline = time.time() + FANOUT_TIMEOUT_SECONDS
    received = _collect_webhook_per_target(stubs, deadline)

    for name_, cfg in stubs.items():
        got = received[name_]
        assert got["path"] == "/api/v1/webhooks/identity/created", \
            f"{name_}: path={got['path']!r}"
        headers_lower = {k.lower(): v for k, v in got["headers"].items()}
        assert headers_lower.get("x-windy-event") == "identity.created", \
            f"{name_}: x-windy-event={headers_lower.get('x-windy-event')!r}"
        assert headers_lower.get("x-windy-delivery-id"), f"{name_}: missing x-windy-delivery-id"

        expected_sig = "sha256=" + hmac.new(
            cfg["secret"].encode("utf-8"),
            got["body"].encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        assert hmac.compare_digest(
            headers_lower.get("x-windy-signature", ""),
            expected_sig,
        ), (f"{name_}: signature mismatch\n"
            f"  expected={expected_sig}\n"
            f"  actual  ={headers_lower.get('x-windy-signature')}\n"
            f"  body[:200]={got['body'][:200]}")

        payload = json.loads(got["body"])
        assert payload["event"] == "identity.created", f"{name_}: event={payload.get('event')!r}"
        assert payload["email"] == email, f"{name_}: email={payload.get('email')!r}"
        assert payload["windy_identity_id"] == windy_identity_id
        assert payload["tier"] == "free"
        for required in ("display_name", "first_name", "last_name", "preferred_local_part"):
            assert required in payload, f"{name_}: missing {required!r}"


def test_each_target_uses_its_own_secret(account_server, stubs):
    """Per-target secrets are distinct — a signature from target A must NOT
    verify against target B's secret. Guards against env-var bleed between
    targets (which would be an unintended producer bug)."""
    email = f"e2e-sep-{int(time.time() * 1000)}-{secrets.token_hex(4)}@example.com"
    resp = requests.post(
        f"{account_server}/api/v1/auth/register",
        json={"name": "Sep Test", "email": email, "password": "SecurePass1"},
        timeout=5,
    )
    assert resp.status_code == 201

    deadline = time.time() + FANOUT_TIMEOUT_SECONDS
    received = _collect_webhook_per_target(stubs, deadline)

    names = list(TARGETS.keys())
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            sig_a = received[a]["headers"].get("X-Windy-Signature") or \
                    received[a]["headers"].get("x-windy-signature")
            # Verify sig_a against stubs[b]["secret"] — should NOT match
            wrong = "sha256=" + hmac.new(
                stubs[b]["secret"].encode("utf-8"),
                received[a]["body"].encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            assert sig_a != wrong, \
                f"Producer leaked secret: {a}'s signature matches {b}'s secret"
