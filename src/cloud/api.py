"""
Windy Pro - Cloud API
FastAPI server for cloud-hosted transcription service.

DNA Strand: A4 (Cloud Mode)
Helix Repair: T6 (auth), T7 (JWT), T8 (vault), T9 (WS path)
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, Query, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import asyncio
import json
import re
import uuid
import os
import sqlite3
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
import numpy as np
import struct
import logging

logger = logging.getLogger(__name__)

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
    exp_dt = datetime.now(timezone.utc) + timedelta(hours=expires_hours)
    payload_data = {**data, "exp": exp_dt.isoformat()}
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
        if "exp" in data:
            exp = datetime.fromisoformat(data["exp"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
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


@contextmanager
def db_session():
    """Context manager for database connections — ensures cleanup."""
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Email validation regex
_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')


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

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Windy Pro Cloud API",
    description="Cloud-hosted voice-to-text transcription service",
    version="0.1.1",
    lifespan=lifespan,
)

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.getenv("WINDY_CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"]
)

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

API_KEY = os.getenv("WINDY_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "WINDY_API_KEY environment variable is required. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

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
@limiter.limit("5/minute")
async def register(request: Request, body: AuthRegister):
    """Register a new user account."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not re.search(r'[a-zA-Z]', body.password) or not re.search(r'[0-9]', body.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter and one number")
    if not _EMAIL_RE.match(body.email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    with db_session() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (body.email.lower(),)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        user_id = str(uuid.uuid4())
        pw_hash = hash_password(body.password)
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
            (user_id, body.email.lower(), body.name, pw_hash)
        )

        user = {"id": user_id, "email": body.email.lower(), "name": body.name}
        token = create_access_token(user)
        return AuthResponse(token=token, user=user)


@app.post("/api/v1/auth/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: AuthLogin):
    """Login with email and password."""
    with db_session() as conn:
        row = conn.execute(
            "SELECT id, email, name, password_hash FROM users WHERE email = ?",
            (body.email.lower(),)
        ).fetchone()

        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        user = {"id": row["id"], "email": row["email"], "name": row["name"]}
        token = create_access_token(user)
        return AuthResponse(token=token, user=user)


@app.get("/api/v1/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current user profile."""
    return user


@app.post("/api/v1/auth/refresh", response_model=AuthResponse)
async def refresh_token(user: dict = Depends(get_current_user)):
    """Refresh an existing valid JWT token with extended expiry."""
    # Strip out internal claims, keep user info only
    user_data = {"id": user["id"], "email": user["email"], "name": user["name"]}
    new_token = create_access_token(user_data)
    return AuthResponse(token=new_token, user=user_data)


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
    with db_session() as conn:
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


@app.get("/api/v1/vault/sessions/{session_id}")
async def vault_get_session(session_id: int, user: dict = Depends(get_current_user)):
    """Get a session with all its segments."""
    with db_session() as conn:
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


@app.delete("/api/v1/vault/sessions/{session_id}")
async def vault_delete_session(session_id: int, user: dict = Depends(get_current_user)):
    """Delete a transcription session."""
    with db_session() as conn:
        cursor = conn.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user["id"])
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"deleted": True}


@app.get("/api/v1/vault/search")
async def vault_search(q: str = "", limit: int = 50, user: dict = Depends(get_current_user)):
    """Search transcripts for the current user."""
    with db_session() as conn:
        rows = conn.execute("""
            SELECT seg.*, ses.started_at as session_date
            FROM segments seg
            JOIN sessions ses ON seg.session_id = ses.id
            WHERE ses.user_id = ? AND seg.text LIKE ? AND seg.is_partial = 0
            ORDER BY seg.created_at DESC
            LIMIT ?
        """, (user["id"], f"%{q}%", limit)).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/v1/vault/sessions/{session_id}/export")
async def vault_export_session(
    session_id: int,
    fmt: str = "txt",
    user: dict = Depends(get_current_user)
):
    """Export a session as plain text or markdown."""
    with db_session() as conn:
        session = conn.execute(
            "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user["id"])
        ).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        segments = conn.execute(
            "SELECT text FROM segments WHERE session_id = ? AND is_partial = 0 ORDER BY start_time",
            (session_id,)
        ).fetchall()
        
        full_text = " ".join(s["text"] for s in segments)
        
        if fmt == "md":
            started = session["started_at"] or "Unknown"
            return {
                "format": "md",
                "text": f"# Transcription — {started}\n\n{full_text}\n"
            }
        return {"format": "txt", "text": full_text}


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
        version="0.1.1",
        gpu_available=gpu_available,
        models_loaded=[],
        active_connections=len(active_connections)
    )


# ═══════════════════════════════════
#  Batch Transcription
# ═══════════════════════════════════

@app.post("/api/v1/transcribe", status_code=501)
async def transcribe_file(
    config: TranscriptionRequest,
    api_key: str = Depends(verify_api_key)
):
    """Batch transcription — not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"detail": "Batch transcription is not yet available. Use the WebSocket endpoint /ws/transcribe for real-time streaming."}
    )


# ═══════════════════════════════════
#  Cloud Transcription Engine (singleton)
# ═══════════════════════════════════

_cloud_model = None
_cloud_model_lock = asyncio.Lock()

async def get_cloud_model():
    """Lazy-load the Whisper model for cloud transcription."""
    global _cloud_model
    if _cloud_model is None:
        async with _cloud_model_lock:
            if _cloud_model is None:
                from faster_whisper import WhisperModel
                model_size = os.getenv("WINDY_CLOUD_MODEL", "base")
                device = "cuda" if os.getenv("WINDY_CLOUD_DEVICE", "auto") == "cuda" else "cpu"
                compute = "float16" if device == "cuda" else "int8"
                logger.info(f"Loading cloud Whisper model: {model_size} on {device} ({compute})")
                _cloud_model = WhisperModel(model_size, device=device, compute_type=compute)
                logger.info("Cloud Whisper model loaded.")
    return _cloud_model


# ═══════════════════════════════════
#  WebSocket Streaming (T9: path → /ws/transcribe)
# ═══════════════════════════════════

active_connections: dict = {}
active_user_sessions: dict = {}  # user_id → connection_id (max 1 per user)
MAX_SESSIONS_PER_USER = 1

# Audio buffer: 16kHz Int16 mono = 32000 bytes per second
CLOUD_AUDIO_CHUNK_THRESHOLD = 32000  # 1 second of audio

# Per-connection frame rate limit: max 80 frames/sec (16kHz at 200-sample frames)
MAX_AUDIO_FRAMES_PER_SECOND = 80


async def _transcribe_buffer(buffer: bytearray, model, segment_start_time: float):
    """Transcribe an audio buffer and return segments.
    
    Deduplicates transcription logic used in both streaming and stop-flush paths.
    
    Returns:
        List of segment dicts and total audio seconds processed.
    """
    int16_array = np.frombuffer(bytes(buffer), dtype=np.int16)
    float32_array = int16_array.astype(np.float32) / 32768.0
    
    loop = asyncio.get_event_loop()
    segments_result, info = await loop.run_in_executor(
        None, lambda: model.transcribe(
            float32_array, language="en", beam_size=5, vad_filter=True,
            condition_on_previous_text=False, initial_prompt="Clear English speech.",
            no_speech_threshold=0.6, log_prob_threshold=-1.0
        )
    )
    segments_list = await loop.run_in_executor(None, lambda: list(segments_result))
    
    results = []
    for seg in segments_list:
        if seg.text.strip():
            results.append({
                "type": "transcript",
                "text": seg.text.strip(),
                "start_time": segment_start_time + seg.start,
                "end_time": segment_start_time + seg.end,
                "is_partial": False
            })
    
    audio_seconds = len(buffer) / (16000 * 2)  # 16kHz, 2 bytes per sample
    return results, audio_seconds

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, token: str = Query(None)):
    """
    WebSocket endpoint for real-time audio streaming.
    Auth via query param (?token=xxx) or first-message: {action: "auth", token: "..."}.
    Then streams binary Int16 PCM audio at 16kHz mono.
    """
    await websocket.accept()
    connection_id = str(uuid.uuid4())
    user = None

    # ─── Query-param authentication (preferred) ───
    if token:
        try:
            user = decode_token(token)
            logger.info(f"WS auth via query param for user {user.get('email', '?')}")
        except Exception as e:
            logger.error(f"Query param token invalid: {e}")
            await websocket.send_json({"type": "error", "message": "Invalid or expired token"})
            await websocket.close(code=4001, reason="Invalid or expired token")
            return

    # ─── First-message authentication (fallback) ───
    if not user:
        try:
            first_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            cmd = json.loads(first_msg)
            if cmd.get("action") != "auth":
                await websocket.send_json({"type": "error", "message": "First message must be {action: 'auth', ...}."})
                await websocket.close(code=4001, reason="Authentication required")
                return

            # Support both token auth and inline email/password auth
            if cmd.get("token"):
                user = decode_token(cmd["token"])
            elif cmd.get("email") and cmd.get("password"):
                email = cmd["email"].lower()
                with db_session() as conn:
                    row = conn.execute("SELECT id, email, name, password_hash FROM users WHERE email = ?", (email,)).fetchone()
                if not row or not verify_password(cmd["password"], row[3]):
                    await websocket.send_json({"type": "error", "message": "Invalid email or password"})
                    await websocket.close(code=4001, reason="Invalid credentials")
                    return
                user = {"id": row[0], "email": row[1], "name": row[2]}
                fresh_token = create_access_token({"id": row[0], "email": row[1], "name": row[2]})
                await websocket.send_json({"type": "token", "token": fresh_token})
            else:
                await websocket.send_json({"type": "error", "message": "Provide token or email+password"})
                await websocket.close(code=4001, reason="Authentication required")
                return
        except (asyncio.TimeoutError, json.JSONDecodeError):
            await websocket.close(code=4001, reason="Authentication timeout or invalid format")
            return
        except HTTPException:
            await websocket.send_json({"type": "error", "message": "Invalid or expired token"})
            await websocket.close(code=4001, reason="Invalid or expired token")
            return

    # ─── Per-user concurrency: evict old session instead of rejecting ───
    user_id = user.get("id")
    if user_id in active_user_sessions:
        old_conn_id = active_user_sessions[user_id]
        logger.warning(f"Evicting stale session {old_conn_id} for user {user_id}")
        old_conn = active_connections.pop(old_conn_id, None)
        if old_conn and old_conn.get("ws"):
            try:
                await old_conn["ws"].close(code=4003, reason="Session replaced by new connection")
            except Exception:
                pass
        del active_user_sessions[user_id]

    active_connections[connection_id] = {"ws": websocket, "user": user}
    active_user_sessions[user_id] = connection_id

    # Create session for authenticated user
    session_id = None
    if user:
        try:
            conn = get_db()
            cursor = conn.execute(
                "INSERT INTO sessions (user_id) VALUES (?)", (user["id"],)
            )
            session_id = cursor.lastrowid
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Could not create DB session (non-fatal): {e}")
            session_id = None

    # Audio accumulation buffer
    audio_buffer = bytearray()
    segment_start_time = 0.0
    total_audio_seconds = 0.0
    is_recording = False

    try:
        logger.info(f"[WS {connection_id}] Sending idle state to client")
        await websocket.send_json({
            "type": "state",
            "state": "idle",
            "connection_id": connection_id,
            "authenticated": True
        })

        logger.info(f"[WS {connection_id}] Entering main loop")
        while True:
            message = await websocket.receive()

            # Starlette may deliver an explicit disconnect event; exit loop cleanly.
            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message:
                if not is_recording:
                    continue
                audio_data = message["bytes"]
                audio_buffer.extend(audio_data)

                # When we have enough audio, transcribe
                if len(audio_buffer) >= CLOUD_AUDIO_CHUNK_THRESHOLD:
                    try:
                        model = await get_cloud_model()
                        # Convert Int16 PCM bytes to float32 numpy array
                        int16_array = np.frombuffer(bytes(audio_buffer), dtype=np.int16)
                        float32_array = int16_array.astype(np.float32) / 32768.0

                        # Run transcription in thread pool to avoid blocking
                        loop = asyncio.get_event_loop()
                        segments_result, info = await loop.run_in_executor(
                            None, lambda: model.transcribe(
                                float32_array, language="en", beam_size=5, vad_filter=True,
                                condition_on_previous_text=False, initial_prompt="Clear English speech.",
                                no_speech_threshold=0.6, log_prob_threshold=-1.0
                            )
                        )
                        segments_list = await loop.run_in_executor(None, lambda: list(segments_result))

                        for seg in segments_list:
                            segment_data = {
                                "type": "transcript",
                                "text": seg.text.strip(),
                                "start_time": segment_start_time + seg.start,
                                "end_time": segment_start_time + seg.end,
                                "is_partial": False
                            }
                            await websocket.send_json(segment_data)

                            # Save to vault if we have a session
                            if session_id and seg.text.strip():
                                conn = get_db()
                                conn.execute(
                                    "INSERT INTO segments (session_id, text, start_time, end_time, confidence) VALUES (?, ?, ?, ?, ?)",
                                    (session_id, seg.text.strip(), segment_start_time + seg.start, segment_start_time + seg.end, 0.9)
                                )
                                conn.commit()
                                conn.close()

                        total_audio_seconds += len(audio_buffer) / (16000 * 2)  # 16kHz, 2 bytes per sample
                        segment_start_time = total_audio_seconds
                    except Exception as e:
                        logger.error(f"Transcription error: {e}")
                        await websocket.send_json({"type": "error", "message": f"Transcription failed: {str(e)}"})
                    finally:
                        audio_buffer.clear()

            elif "text" in message:
                try:
                    cmd = json.loads(message["text"])
                    action = cmd.get("action")

                    if action == "start":
                        logger.info(f"[WS {connection_id}] Start recording")
                        is_recording = True
                        audio_buffer.clear()
                        total_audio_seconds = 0.0
                        segment_start_time = 0.0
                        await websocket.send_json({
                            "type": "ack", "action": "start", "success": True
                        })
                        await websocket.send_json({
                            "type": "state", "state": "listening"
                        })
                    elif action == "stop":
                        is_recording = False

                        # Transcribe remaining buffer
                        if len(audio_buffer) > 0:
                            try:
                                model = await get_cloud_model()
                                int16_array = np.frombuffer(bytes(audio_buffer), dtype=np.int16)
                                float32_array = int16_array.astype(np.float32) / 32768.0
                                loop = asyncio.get_event_loop()
                                segments_result, _ = await loop.run_in_executor(
                                    None, lambda: model.transcribe(
                                        float32_array, language="en", beam_size=5, vad_filter=True,
                                        condition_on_previous_text=False, initial_prompt="Clear English speech.",
                                        no_speech_threshold=0.6, log_prob_threshold=-1.0
                                    )
                                )
                                segments_list = await loop.run_in_executor(None, lambda: list(segments_result))
                                for seg in segments_list:
                                    if seg.text.strip():
                                        await websocket.send_json({
                                            "type": "transcript",
                                            "text": seg.text.strip(),
                                            "start_time": segment_start_time + seg.start,
                                            "end_time": segment_start_time + seg.end,
                                            "is_partial": False
                                        })
                                        if session_id:
                                            conn = get_db()
                                            conn.execute(
                                                "INSERT INTO segments (session_id, text, start_time, end_time, confidence) VALUES (?, ?, ?, ?, ?)",
                                                (session_id, seg.text.strip(), segment_start_time + seg.start, segment_start_time + seg.end, 0.9)
                                            )
                                            conn.commit()
                                            conn.close()
                            except Exception as e:
                                logger.error(f"Final transcription error: {e}")
                            finally:
                                audio_buffer.clear()

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
                            "type": "state", "state": "idle"
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
        # Remove user session tracking
        user_id = user.get("id") if user else None
        if user_id and active_user_sessions.get(user_id) == connection_id:
            active_user_sessions.pop(user_id, None)


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
