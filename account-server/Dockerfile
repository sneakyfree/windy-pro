# Windy Pro Account Server — Production Dockerfile
# Build context: repository root (set via docker-compose build.context)
#
# Multi-stage build:
#   1. Install deps + compile TypeScript
#   2. Copy compiled JS + production deps into slim image

# ── Stage 1: Build TypeScript ─────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Copy shared contracts first (local "file:" dependency). Its
# package.json declares `main: dist/index.js` and `types:
# dist/index.d.ts`, and shared/contracts/dist is NOT committed to
# git (generated artifact). So we must install the contracts' own
# deps (zod) and `tsc` compile its sources here before
# account-server's tsc can resolve @windy-pro/contracts at all.
# Without this step the build fails with:
#   error TS2307: Cannot find module 'zod' or its corresponding type declarations.
COPY shared/contracts ./shared/contracts
RUN cd shared/contracts && npm ci && npm run build

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
FROM node:22-alpine

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

# NOTE: The original Dockerfile had a COPY for
# `account-server/src/client/web/dist*` here, but the web client
# actually lives at src/client/web/ at the repo root (not inside
# account-server/), AND a COPY glob with a missing parent dir is
# a hard Docker build failure despite the old comment claiming
# otherwise. Phase 1 is API-only; the Express server's
# express.static() is a no-op when the target dir is missing and
# simply falls through to the API handlers.

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
