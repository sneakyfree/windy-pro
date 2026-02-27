# Windy Pro v2.0 — Model Server

Express.js server that serves `.wpr` model files for the Windy Pro installation wizard.

## Quick Start

```bash
# Install dependencies
npm install

# Generate test model files (1/100th real size)
npm run generate-models

# Start server
npm start
```

Server runs on **http://localhost:8099** by default.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `GET` | `/v2/catalog.json` | No | Full model catalog with availability |
| `GET` | `/v2/:modelId.wpr` | JWT | Download model file (supports Range) |
| `GET` | `/dev/token?tier=pro` | No | Generate a dev JWT token |

## Authentication

All download requests require a JWT Bearer token:

```bash
# Get a dev token
curl http://localhost:8099/dev/token?tier=pro

# Download with auth
curl -H "Authorization: Bearer <token>" http://localhost:8099/v2/edge-spark.wpr -o edge-spark.wpr
```

## Resume Downloads (Range Headers)

```bash
# Resume from byte 1000
curl -H "Authorization: Bearer <token>" \
     -H "Range: bytes=1000-" \
     http://localhost:8099/v2/edge-spark.wpr -o edge-spark.wpr
```

## Test Models

The `generate-test-models.js` script creates placeholder `.wpr` files in `./models/`:

- **WNDY0001** magic bytes header (8 bytes)
- Model tier + family metadata
- Model ID embedded in header
- Random data padded to **1/100th** of real size

Real sizes range from 42 MB to 2.9 GB; test files are 420 KB to 29 MB.

```bash
# Regenerate (clean + rebuild)
node generate-test-models.js --clean
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8099` | Server port |
| `JWT_SECRET` | dev secret | JWT signing secret |

## Download Logging

All authenticated downloads are logged to `downloads.log` as JSONL with:
- Timestamp, account ID, device ID
- Model ID, action (full/resume)
- Range bytes (if resume)
