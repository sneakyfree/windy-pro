"""
Tests for Windy Pro Cloud API
"""

import pytest
import os
import json
import asyncio

# Set required env vars BEFORE importing the API
os.environ.setdefault("WINDY_JWT_SECRET", "test-secret-key-for-testing-only-not-production")
os.environ.setdefault("WINDY_API_KEY", "test-api-key-for-testing-only")

from fastapi.testclient import TestClient
from src.cloud.api import app, create_access_token, init_db, DB_PATH


# ═══════════════════════════════════
#  Fixtures
# ═══════════════════════════════════

@pytest.fixture(autouse=True, scope="session")
def setup_db():
    """Initialize the database tables before any tests run."""
    init_db()
    # Disable rate limiter for test runs
    from src.cloud.api import limiter
    limiter.enabled = False
    yield
    # Cleanup test DB after all tests
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except OSError:
            pass

@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def auth_headers(client):
    """Register a test user and return auth headers."""
    import uuid
    email = f"authfix_{uuid.uuid4().hex[:8]}@windypro.com"
    res = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "testpass123",
        "name": "Test User"
    })
    data = res.json()
    token = data.get("token", "")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api_key_headers():
    """Return API key headers."""
    return {"X-API-Key": os.environ["WINDY_API_KEY"]}


# ═══════════════════════════════════
#  Health Check
# ═══════════════════════════════════

class TestHealth:
    def test_health_check(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "healthy"
        assert "version" in data


# ═══════════════════════════════════
#  Auth Endpoints
# ═══════════════════════════════════

class TestAuth:
    def test_register(self, client):
        import uuid
        email = f"test_{uuid.uuid4().hex[:8]}@windypro.com"
        res = client.post("/api/v1/auth/register", json={
            "email": email,
            "password": "securepass123",
            "name": "New User"
        })
        assert res.status_code == 200
        data = res.json()
        assert "token" in data
        assert data["user"]["email"] == email

    def test_register_duplicate(self, client):
        import uuid
        email = f"dup_{uuid.uuid4().hex[:8]}@windypro.com"
        client.post("/api/v1/auth/register", json={
            "email": email,
            "password": "pass123456",
            "name": "First"
        })
        res = client.post("/api/v1/auth/register", json={
            "email": email,
            "password": "pass123456",
            "name": "Second"
        })
        assert res.status_code == 409

    def test_login_success(self, client):
        import uuid
        email = f"login_{uuid.uuid4().hex[:8]}@windypro.com"
        client.post("/api/v1/auth/register", json={
            "email": email,
            "password": "mypassword1",
            "name": "Login Test"
        })
        res = client.post("/api/v1/auth/login", json={
            "email": email,
            "password": "mypassword1"
        })
        assert res.status_code == 200
        assert "token" in res.json()

    def test_login_wrong_password(self, client):
        import uuid
        email = f"wrong_{uuid.uuid4().hex[:8]}@windypro.com"
        client.post("/api/v1/auth/register", json={
            "email": email,
            "password": "correctpass",
            "name": "Wrong Pass"
        })
        res = client.post("/api/v1/auth/login", json={
            "email": email,
            "password": "wrongpassword"
        })
        assert res.status_code == 401

    def test_login_nonexistent_user(self, client):
        res = client.post("/api/v1/auth/login", json={
            "email": "nobody@nowhere.com",
            "password": "irrelevant"
        })
        assert res.status_code == 401


# ═══════════════════════════════════
#  Vault Endpoints
# ═══════════════════════════════════

class TestVault:
    def test_list_sessions_unauthorized(self, client):
        res = client.get("/api/v1/vault/sessions")
        assert res.status_code == 401

    def test_list_sessions_authorized(self, client, auth_headers):
        res = client.get("/api/v1/vault/sessions", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)

    def test_search_vault(self, client, auth_headers):
        res = client.get("/api/v1/vault/search?q=test", headers=auth_headers)
        assert res.status_code == 200

    def test_get_nonexistent_session(self, client, auth_headers):
        res = client.get("/api/v1/vault/sessions/99999", headers=auth_headers)
        assert res.status_code == 404


# ═══════════════════════════════════
#  Batch Transcription (501)
# ═══════════════════════════════════

class TestBatchTranscription:
    def test_batch_returns_501(self, client, api_key_headers):
        res = client.post("/api/v1/transcribe", json={
            "audio_data": "base64data",
            "language": "en",
            "model": "base"
        }, headers=api_key_headers)
        assert res.status_code == 501
        assert "not yet available" in res.json()["detail"]


# ═══════════════════════════════════
#  WebSocket Auth
# ═══════════════════════════════════

class TestWebSocketAuth:
    def test_ws_no_auth_closes(self, client):
        """WebSocket without auth message should close."""
        with client.websocket_connect("/ws/transcribe") as ws:
            # Send non-auth message
            ws.send_json({"action": "ping"})
            # Should get error and close  
            msg = ws.receive_json()
            assert msg["type"] == "error"

    def test_ws_valid_auth(self, client):
        """WebSocket with valid auth should connect."""
        import uuid
        email = f"ws1_{uuid.uuid4().hex[:8]}@test.com"
        reg = client.post("/api/v1/auth/register", json={
            "email": email, "password": "testpass123", "name": "WS1"
        })
        token = reg.json()["token"]
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_json({"action": "auth", "token": token})
            msg = ws.receive_json()
            assert msg["type"] == "state"
            assert msg["state"] == "idle"
            assert msg["authenticated"] is True
            ws.close()

    def test_ws_invalid_token(self, client):
        """WebSocket with invalid token should close."""
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_json({"action": "auth", "token": "invalid-garbage-token"})
            msg = ws.receive_json()
            assert msg["type"] == "error"

    def test_ws_ping_pong(self, client):
        """Test ping/pong after successful auth."""
        import uuid
        email = f"ws2_{uuid.uuid4().hex[:8]}@test.com"
        reg = client.post("/api/v1/auth/register", json={
            "email": email, "password": "testpass123", "name": "WS2"
        })
        token = reg.json()["token"]
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_json({"action": "auth", "token": token})
            ws.receive_json()  # state message

            ws.send_json({"action": "ping", "timestamp": 42})
            msg = ws.receive_json()
            assert msg["type"] == "pong"
            assert msg["timestamp"] == 42
            ws.close()


# ═══════════════════════════════════
#  Auth Refresh (RP-11)
# ═══════════════════════════════════

class TestAuthRefresh:
    def test_refresh_returns_new_token(self, client, auth_headers):
        """POST /auth/refresh should return a new JWT token."""
        r = client.post("/api/v1/auth/refresh", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] is not None

    def test_refresh_unauthorized(self, client):
        """POST /auth/refresh without token should 401."""
        r = client.post("/api/v1/auth/refresh")
        assert r.status_code in (401, 403)


# ═══════════════════════════════════
#  Password & Email Validation (RP-11)
# ═══════════════════════════════════

class TestInputValidation:
    def test_register_short_password(self, client):
        """Password under 8 chars should be rejected."""
        r = client.post("/api/v1/auth/register", json={
            "email": "short@test.com", "password": "Ab1", "name": "Short"
        })
        assert r.status_code == 400

    def test_register_no_digit_password(self, client):
        """Password with no digit should be rejected."""
        r = client.post("/api/v1/auth/register", json={
            "email": "nodigit@test.com", "password": "abcdefgh", "name": "NoDigit"
        })
        assert r.status_code == 400

    def test_register_no_letter_password(self, client):
        """Password with no letter should be rejected."""
        r = client.post("/api/v1/auth/register", json={
            "email": "noletter@test.com", "password": "12345678", "name": "NoLetter"
        })
        assert r.status_code == 400

    def test_register_invalid_email(self, client):
        """Email without valid format should be rejected."""
        r = client.post("/api/v1/auth/register", json={
            "email": "not-an-email", "password": "Valid1Pass", "name": "BadEmail"
        })
        assert r.status_code == 400


# ═══════════════════════════════════
#  Vault Export & Delete (RP-11)
# ═══════════════════════════════════

class TestVaultExportDelete:
    def test_export_nonexistent_session(self, client, auth_headers):
        """Export of nonexistent session should 404."""
        r = client.get("/api/v1/vault/sessions/99999/export", headers=auth_headers)
        assert r.status_code == 404

    def test_delete_nonexistent_session(self, client, auth_headers):
        """Delete of nonexistent session should 404."""
        r = client.delete("/api/v1/vault/sessions/99999", headers=auth_headers)
        assert r.status_code == 404
