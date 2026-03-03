# ══════════════════════════════════════════════
# Windy Pro — Multi-stage Production Dockerfile
# Builds: Web frontend + Account Server + Transcription API
# ══════════════════════════════════════════════

# ── Stage 1: Build web frontend ──────────────
FROM node:20-alpine AS web-builder
WORKDIR /build
COPY src/client/web/package*.json ./
RUN npm ci --production=false
COPY src/client/web/ ./
RUN npm run build

# ── Stage 2: Account server dependencies ─────
FROM node:20-alpine AS api-deps
WORKDIR /deps
COPY account-server/package*.json ./
RUN npm ci --production

# ── Stage 3: Production image ────────────────
FROM python:3.11-slim

# System dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir fastapi uvicorn[standard]

# Account server
COPY --from=api-deps /deps/node_modules /app/account-server/node_modules
COPY account-server/ /app/account-server/

# Web frontend (pre-built static files)
COPY --from=web-builder /build/dist /app/web-dist

# Python transcription engine
COPY src/engine/ /app/src/engine/
COPY src/cloud/ /app/src/cloud/

# Pre-download the base Whisper model
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# Entrypoint script
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Ports: 3000 (web), 8098 (account API), 8000 (transcription)
EXPOSE 3000 8098 8000

# Health check — account server
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8098/health || exit 1

ENV NODE_ENV=production
CMD ["/app/entrypoint.sh"]
