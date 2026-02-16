"""
Windy Pro - Cloud API
FastAPI server for cloud-hosted transcription service.

DNA Strand: A4 (Cloud Mode)
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import json
import uuid
import os
import secrets
import bcrypt
from datetime import datetime, timedelta, timezone

app = FastAPI(
    title="Windy Pro Cloud API",
    description="Cloud-hosted voice-to-text transcription service",
    version="0.1.0"
)

# CORS — configurable via CORS_ORIGINS env var
_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# ═══════════════════════════════════
#  Models
# ═══════════════════════════════════

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


# ═══════════════════════════════════
#  API Key Auth (Simple)
# ═══════════════════════════════════

API_KEY = os.getenv("WINDY_API_KEY", "dev-key-change-me")

async def verify_api_key(x_api_key: str = Header(None)):
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


# ═══════════════════════════════════
#  REST Endpoints
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
        version="0.1.0",
        gpu_available=gpu_available,
        models_loaded=[]
    )


# ═══════════════════════════════════
#  Auth Endpoints (In-Memory Stub)
#  TODO: Replace with PostgreSQL + JWT
# ═══════════════════════════════════

TOKEN_EXPIRY_HOURS = 24

# In-memory stores (reset on restart)
_users = {}   # email -> {user, password_hash}
_tokens = {}  # token -> {email, created_at}

class AuthRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class AuthResponse(BaseModel):
    token: str
    user: dict
    expires_in: int  # seconds until expiry

def _create_token(email: str) -> tuple[str, int]:
    """Create a token with expiration."""
    token = secrets.token_urlsafe(32)
    _tokens[token] = {"email": email, "created_at": datetime.now(timezone.utc)}
    expires_in = TOKEN_EXPIRY_HOURS * 3600
    return token, expires_in

def _verify_token(token: str) -> str | None:
    """Verify token is valid and not expired. Returns email or None."""
    record = _tokens.get(token)
    if not record:
        return None
    age = datetime.now(timezone.utc) - record["created_at"]
    if age > timedelta(hours=TOKEN_EXPIRY_HOURS):
        del _tokens[token]  # cleanup expired
        return None
    return record["email"]

@app.post("/api/v1/auth/register", response_model=AuthResponse)
async def register(req: AuthRequest):
    """Register a new user account."""
    if req.email in _users:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    password_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt())
    user = {"email": req.email, "name": req.name or req.email.split("@")[0]}
    _users[req.email] = {"user": user, "password_hash": password_hash}
    
    token, expires_in = _create_token(req.email)
    return AuthResponse(token=token, user=user, expires_in=expires_in)

@app.post("/api/v1/auth/login", response_model=AuthResponse)
async def login(req: AuthRequest):
    """Login with email and password."""
    record = _users.get(req.email)
    if not record:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not bcrypt.checkpw(req.password.encode(), record["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token, expires_in = _create_token(req.email)
    return AuthResponse(token=token, user=record["user"], expires_in=expires_in)


@app.post("/api/v1/transcribe", response_model=TranscriptionResult)
async def transcribe_file(
    config: TranscriptionRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Transcribe an uploaded audio file (batch mode).
    Accepts WAV, MP3, FLAC, OGG.
    """
    # Placeholder — would accept file upload and run transcription
    return TranscriptionResult(
        id=str(uuid.uuid4()),
        text="[Cloud transcription placeholder]",
        segments=[],
        duration=0.0,
        language=config.language,
        model=config.model
    )


# ═══════════════════════════════════
#  WebSocket Streaming
# ═══════════════════════════════════

active_connections: dict = {}

@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time audio streaming.
    Same protocol as local server for seamless switching.
    """
    await websocket.accept()
    connection_id = str(uuid.uuid4())
    active_connections[connection_id] = websocket
    
    try:
        # Send initial state
        await websocket.send_json({
            "type": "state",
            "state": "idle",
            "connection_id": connection_id
        })
        
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Binary = audio data
                audio_data = message["bytes"]
                # TODO: Feed to cloud transcriber
                pass
            
            elif "text" in message:
                # Text = command
                try:
                    cmd = json.loads(message["text"])
                    action = cmd.get("action")
                    
                    if action == "start":
                        await websocket.send_json({
                            "type": "ack", "action": "start", "success": True
                        })
                    elif action == "stop":
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
