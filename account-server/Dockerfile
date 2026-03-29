# Windy Pro Account Server — Production Dockerfile
# Build context: repository root (set via docker-compose build.context)
#
# Multi-stage build:
#   1. Install deps + compile TypeScript
#   2. Copy compiled JS + production deps into slim image

# ── Stage 1: Build TypeScript ─────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Copy shared contracts first (local "file:" dependency)
COPY shared/contracts ./shared/contracts

# Copy account-server package files
COPY account-server/package.json account-server/package-lock.json ./account-server/

# Install all deps (including devDependencies for tsc)
WORKDIR /build/account-server
RUN npm ci

# Copy source and compile
COPY account-server/tsconfig.json ./
COPY account-server/src ./src
RUN npx tsc

# ── Stage 2: Production Image ────────────────────────────────────
FROM node:20-alpine

# Security: run as non-root
RUN addgroup -S windy && adduser -S windy -G windy

WORKDIR /app

# Copy shared contracts (needed at runtime for the file: link)
COPY --from=builder /build/shared/contracts ./shared/contracts

# Copy package files and install production deps only
COPY account-server/package.json account-server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS from builder
COPY --from=builder /build/account-server/dist ./dist

# Copy web client dist if it exists (static site served by account-server)
# This is optional — the build won't fail if the directory doesn't exist
COPY account-server/src/client/web/dist* ./src/client/web/dist/

# Create data directories
RUN mkdir -p /app/data/uploads /keys && chown -R windy:windy /app /keys

USER windy

# Environment defaults
ENV NODE_ENV=production
ENV PORT=8098
ENV DATA_ROOT=/app/data

EXPOSE 8098

# Health check — /health endpoint returns 200 when server is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8098/health || exit 1

CMD ["node", "dist/server.js"]
