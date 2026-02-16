"""
Windy Pro - Cloud API
FastAPI server for cloud-hosted transcription service.

DNA Strand: A4 (Cloud Mode)
Helix Repair: T6 (auth), T7 (JWT), T8 (vault), T9 (WS path)
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import asyncio
import json
import uuid
import os
import sqlite3
import hashlib
import hmac
from datetime import datetime, timedelta
from pathlib import Path

# ═══════════════════════════════════
#  JWT — lightweight, zero-dep
# ═══════════════════════════════════

import base64

JWT_SECRET = os.getenv("WINDY_JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError(
        "WINDY_JWT_SECRET environment variable is required. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)

def create_access_token(data: dict, expires_hours: int = JWT_EXPIRY_HOURS) -> str:
    """Create a JWT token (HS256, zero-dependency)."""
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_data = {**data, "exp": (datetime.utcnow() + timedelta(hours=expires_hours)).isoformat()}
    payload = _b64url_encode(json.dumps(payload_data).encode())
    signature = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    sig = _b64url_encode(signature)
    return f"{header}.{payload}.{sig}"

def decode_token(token: str) -> dict:
    """Decode and verify a JWT token."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid token format")
        header, payload, sig = parts
        expected_sig = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sig), expected_sig):
            raise ValueError("Invalid signature")
        data = json.loads(_b64url_decode(payload))
        if "exp" in data and datetime.fromisoformat(data["exp"]) < datetime.utcnow():
            raise ValueError("Token expired")
        return data
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# ═══════════════════════════════════
#  Password Hashing (PBKDF2, stdlib)
# ═══════════════════════════════════

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return f"{salt.hex()}:{dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    salt_hex, dk_hex = stored.split(":")
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return hmac.compare_digest(dk, bytes.fromhex(dk_hex))


# ═══════════════════════════════════
#  User Database (SQLite)
# ═══════════════════════════════════

DB_PATH = os.getenv("WINDY_CLOUD_DB", str(Path.home() / ".windy-pro" / "cloud.db"))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at TEXT,
            duration_s REAL DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            confidence REAL DEFAULT 0,
            is_partial INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id);
    """)
    conn.commit()
    conn.close()


# ═══════════════════════════════════
#  App Init
# ═══════════════════════════════════

app = FastAPI(
    title="Windy Pro Cloud API",
    description="Cloud-hosted voice-to-text transcription service",
    version="0.2.0"
)

ALLOWED_ORIGINS = os.getenv("WINDY_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.on_event("startup")
async def startup():
    init_db()


# ═══════════════════════════════════
#  Pydantic Models
# ═══════════════════════════════════

class AuthRegister(BaseModel):
    email: str
    password: str
    name: str

class AuthLogin(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token: str
    user: dict

class TranscriptionRequest(BaseModel):
    model: str = "base"
    language: str = "en"
    device: str = "auto"

class TranscriptionResult(BaseModel):
    id: str
    text: str
    segments: List[dict]
    duration: float
    language: str
    model: str

class HealthResponse(BaseModel):
    status: str
    version: str
    gpu_available: bool
    models_loaded: List[str]
    active_connections: int


# ═══════════════════════════════════
#  Auth Dependencies
# ═══════════════════════════════════

API_KEY = os.getenv("WINDY_API_KEY", "dev-key-change-me")

async def verify_api_key(x_api_key: str = Header(None)):
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

async def get_current_user(authorization: str = Header(None)):
    """Extract user from Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.replace("Bearer ", "")
    data = decode_token(token)  # raises 401 on failure
    return data


# ═══════════════════════════════════
#  Auth Endpoints (T6, T7)
# ═══════════════════════════════════

@app.post("/api/v1/auth/register", response_model=AuthResponse)
async def register(body: AuthRegister):
    """Register a new user account."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not body.email or "@" not in body.email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    conn = get_db()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (body.email.lower(),)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        user_id = str(uuid.uuid4())
        pw_hash = hash_password(body.password)
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
            (user_id, body.email.lower(), body.name, pw_hash)
        )
        conn.commit()

        user = {"id": user_id, "email": body.email.lower(), "name": body.name}
        token = create_access_token(user)
        return AuthResponse(token=token, user=user)
    finally:
        conn.close()


@app.post("/api/v1/auth/login", response_model=AuthResponse)
async def login(body: AuthLogin):
    """Login with email and password."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, email, name, password_hash FROM users WHERE email = ?",
            (body.email.lower(),)
        ).fetchone()

        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        user = {"id": row["id"], "email": row["email"], "name": row["name"]}
        token = create_access_token(user)
        return AuthResponse(token=token, user=user)
    finally:
        conn.close()


@app.get("/api/v1/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current user profile."""
    return user


# ═══════════════════════════════════
#  Vault Endpoints (T8)
# ═══════════════════════════════════

@app.get("/api/v1/vault/sessions")
async def vault_list_sessions(
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user)
):
    """List transcription sessions for the current user."""
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT s.*,
                   (SELECT text FROM segments WHERE session_id = s.id AND is_partial = 0
                    ORDER BY start_time LIMIT 1) as preview
            FROM sessions s
            WHERE s.user_id = ?
            ORDER BY s.started_at DESC
            LIMIT ? OFFSET ?
        """, (user["id"], limit, offset)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/v1/vault/sessions/{session_id}")
async def vault_get_session(session_id: int, user: dict = Depends(get_current_user)):
    """Get a session with all its segments."""
    conn = get_db()
    try:
        session = conn.execute(
            "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user["id"])
        ).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        segments = conn.execute(
            "SELECT * FROM segments WHERE session_id = ? AND is_partial = 0 ORDER BY start_time",
            (session_id,)
        ).fetchall()

        result = dict(session)
        result["segments"] = [dict(s) for s in segments]
        return result
    finally:
        conn.close()


@app.delete("/api/v1/vault/sessions/{session_id}")
async def vault_delete_session(session_id: int, user: dict = Depends(get_current_user)):
    """Delete a transcription session."""
    conn = get_db()
    try:
        cursor = conn.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user["id"])
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"deleted": True}
    finally:
        conn.close()


@app.get("/api/v1/vault/search")
async def vault_search(q: str = "", limit: int = 50, user: dict = Depends(get_current_user)):
    """Search transcripts for the current user."""
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT seg.*, ses.started_at as session_date
            FROM segments seg
            JOIN sessions ses ON seg.session_id = ses.id
            WHERE ses.user_id = ? AND seg.text LIKE ? AND seg.is_partial = 0
            ORDER BY seg.created_at DESC
            LIMIT ?
        """, (user["id"], f"%{q}%", limit)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ═══════════════════════════════════
#  Health (updated)
# ═══════════════════════════════════

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for load balancers and monitoring."""
    gpu_available = False
    try:
        import torch
        gpu_available = torch.cuda.is_available()
    except ImportError:
        pass

    return HealthResponse(
        status="healthy",
        version="0.2.0",
        gpu_available=gpu_available,
        models_loaded=[],
        active_connections=len(active_connections)
    )


# ═══════════════════════════════════
#  Batch Transcription
# ═══════════════════════════════════

@app.post("/api/v1/transcribe", response_model=TranscriptionResult)
async def transcribe_file(
    config: TranscriptionRequest,
    api_key: str = Depends(verify_api_key)
):
    """Transcribe an uploaded audio file (batch mode)."""
    return TranscriptionResult(
        id=str(uuid.uuid4()),
        text="[Cloud transcription placeholder]",
        segments=[],
        duration=0.0,
        language=config.language,
        model=config.model
    )


# ═══════════════════════════════════
#  WebSocket Streaming (T9: path → /ws/transcribe)
# ═══════════════════════════════════

active_connections: dict = {}

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, token: Optional[str] = Query(None)):
    """
    WebSocket endpoint for real-time audio streaming.
    Same protocol as local server for seamless switching.
    Accepts optional JWT token via query param for auth.
    """
    # Auth required — reject unauthenticated connections
    if not token:
        await websocket.accept()
        await websocket.close(code=4001, reason="Authentication required")
        return
    try:
        user = decode_token(token)
    except HTTPException:
        await websocket.accept()
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()
    connection_id = str(uuid.uuid4())
    active_connections[connection_id] = {"ws": websocket, "user": user}

    # Create session if authenticated
    session_id = None
    if user:
        conn = get_db()
        cursor = conn.execute(
            "INSERT INTO sessions (user_id) VALUES (?)", (user["id"],)
        )
        session_id = cursor.lastrowid
        conn.commit()
        conn.close()

    try:
        await websocket.send_json({
            "type": "state",
            "state": "idle",
            "connection_id": connection_id,
            "authenticated": user is not None
        })

        while True:
            message = await websocket.receive()

            if "bytes" in message:
                audio_data = message["bytes"]
                # TODO: Feed to cloud transcriber instance
                # TODO: Opus decoding when client supports it
                pass

            elif "text" in message:
                try:
                    cmd = json.loads(message["text"])
                    action = cmd.get("action")

                    if action == "start":
                        await websocket.send_json({
                            "type": "ack", "action": "start", "success": True
                        })
                    elif action == "stop":
                        # End session if authenticated
                        if session_id and user:
                            conn = get_db()
                            conn.execute("""
                                UPDATE sessions SET
                                    ended_at = datetime('now'),
                                    duration_s = (julianday(datetime('now')) - julianday(started_at)) * 86400
                                WHERE id = ?
                            """, (session_id,))
                            conn.commit()
                            conn.close()

                        await websocket.send_json({
                            "type": "ack", "action": "stop", "success": True,
                            "transcript": ""
                        })
                    elif action == "ping":
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": cmd.get("timestamp")
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Unknown action: {action}"
                        })
                except json.JSONDecodeError:
                    await websocket.send_json({
                        "type": "error", "message": "Invalid JSON"
                    })

    except WebSocketDisconnect:
        pass
    finally:
        active_connections.pop(connection_id, None)


# ═══════════════════════════════════
#  Main
# ═══════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.cloud.api:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
