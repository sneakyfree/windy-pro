# Windy Translate API

Dynamic translation service for Windy Pro's Tier 2 languages (11-99). Uses CTranslate2 + NLLB-200-600M for offline-capable machine translation. Results cached in SQLite.

## Architecture

```
Express.js (HTTP, caching, rate-limit, CORS)  ←→  Python worker (CTranslate2 + NLLB)
     ↑                                                     ↑
     │                                                     │
  port 8099                                    JSON Lines via stdin/stdout
     │                                                     │
  Website / Wizard                               NLLB-200-600M model (~600MB)
```

## Quick Start

### 1. Install dependencies
```bash
# Node
npm install

# Python
pip install ctranslate2 sentencepiece
```

### 2. Download the NLLB model (~600MB)
```bash
# Also needs: pip install transformers torch
python3 download-model.py
```

### 3. Start the server
```bash
npm start
# → 🌪️ Windy Translate API running on http://localhost:8099
```

## API Endpoints

### `POST /translate` — Single translation
```bash
curl -X POST http://localhost:8099/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Welcome to Windy Pro", "targetLang": "ja"}'
```
Response:
```json
{"translated": "Windy Proへようこそ", "cached": false, "lang": "ja"}
```

### `POST /translate/batch` — Batch translation
```bash
curl -X POST http://localhost:8099/translate/batch \
  -H "Content-Type: application/json" \
  -d '{"texts": ["Hello", "Goodbye", "Thank you"], "targetLang": "de"}'
```
Response:
```json
{
  "translations": ["Hallo", "Auf Wiedersehen", "Danke"],
  "lang": "de",
  "total": 3,
  "cached": 0,
  "translated": 3
}
```

### `GET /health` — Status check
```json
{"status": "ok", "worker": "ready", "cache_size": 42, "uptime": 3600}
```

### `GET /languages` — Supported languages
### `GET /cache/stats` — Cache statistics by language

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `PORT` | 8099 | HTTP port |
| `MODEL_PATH` | `./models/nllb-200-600M` | Path to CTranslate2 model |
| `DB_PATH` | `./cache.db` | SQLite cache database |
| `PYTHON_BIN` | `python3` | Python binary |

## Production Deployment (Veron)

```bash
# Copy files
sudo mkdir -p /opt/windy-translate-api /var/lib/windy-translate
sudo cp -r . /opt/windy-translate-api/
sudo chown -R windy:windy /opt/windy-translate-api /var/lib/windy-translate

# Install systemd service
sudo cp windy-translate.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now windy-translate

# Check status
sudo systemctl status windy-translate
curl http://localhost:8099/health
```

## Docker

```bash
docker build -t windy-translate .
docker run -p 8099:8099 -v ./models:/app/models windy-translate
```

## Rate Limits

- 100 requests/minute per IP
- Max 200 texts per batch request
- 30-second timeout per translation

## Supported Languages

90+ languages via NLLB-200. See `GET /languages` for the full list.
GPU (CUDA) auto-detected — uses float16 for speed. Falls back to CPU int8.
