# Windy Pro — Deployment Guide

## Prerequisites

- **Docker** and **Docker Compose** installed
- **Domain**: windypro.thewindstorm.uk pointed to your server
- **SSL Certificate**: via Let's Encrypt (certbot) or Cloudflare
- **Environment Variables**: copy `.env.example` → `.env` and fill in all values

---

## 1. Environment Setup

```bash
# Clone the repository
git clone https://github.com/yourorg/windy-pro.git
cd windy-pro

# Copy and configure environment
cp .env.example .env
nano .env
```

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret (min 32 chars) | `your-secret-key-here` |
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `STRIPE_PRO_PRICE_ID` | Stripe Pro plan price ID | `price_...` |
| `DEEPGRAM_API_KEY` | Deepgram API key for speech-to-text | `dg_...` |
| `GROQ_API_KEY` | Groq API key for fast inference | `gsk_...` |
| `OPENAI_API_KEY` | OpenAI API key (fallback translation) | `sk-...` |
| `DATABASE_PATH` | SQLite database path | `./accounts.db` |
| `PORT` | Account server port | `8098` |
| `NODE_ENV` | Environment | `production` |

---

## 2. Docker Deployment

### Build and Start

```bash
# Build all services
docker compose -f deploy/docker-compose.yml build

# Start in detached mode
docker compose -f deploy/docker-compose.yml up -d

# Check health
docker compose -f deploy/docker-compose.yml ps
curl http://localhost:8098/health
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `web` | 5173 | Vite frontend (React SPA) |
| `account-server` | 8098 | Express.js API + Auth + Billing |
| `transcription` | 9123 | Python FastAPI (Whisper) |
| `nginx` | 80/443 | Reverse proxy + SSL |

---

## 3. Nginx Configuration

```nginx
server {
    listen 80;
    server_name windypro.thewindstorm.uk;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name windypro.thewindstorm.uk;

    ssl_certificate /etc/letsencrypt/live/windypro.thewindstorm.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/windypro.thewindstorm.uk/privkey.pem;

    # Frontend (SPA)
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        try_files $uri $uri/ /index.html;
    }

    # Account Server API
    location /api/ {
        proxy_pass http://localhost:8098;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 500M;  # For video uploads
    }

    # WebSocket (for real-time features)
    location /ws {
        proxy_pass http://localhost:8098;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Transcription API
    location /transcribe/ {
        proxy_pass http://localhost:9123/;
        proxy_set_header Host $host;
    }
}
```

---

## 4. SSL Setup

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d windypro.thewindstorm.uk

# Auto-renewal (crontab)
0 12 * * * /usr/bin/certbot renew --quiet
```

---

## 5. Database

SQLite is used by default. The database file is created automatically at `DATABASE_PATH`.

### Backup

```bash
# Backup database
cp accounts.db accounts.db.backup-$(date +%Y%m%d)

# Or use SQLite online backup
sqlite3 accounts.db ".backup accounts.db.backup"
```

---

## 6. Monitoring

```bash
# Check service health
curl https://windypro.thewindstorm.uk/health

# View logs
docker compose -f deploy/docker-compose.yml logs -f

# Check resource usage
docker stats
```

---

## 7. Desktop App Distribution

### Build Packages

```bash
# Linux (AppImage + DEB)
npm run build:linux

# macOS (DMG)
npm run build:mac

# Windows (NSIS)
npm run build:win
```

### Auto-Update

The Electron app checks for updates every 6 hours via `electron-updater`. Point the update server URL in `package.json` `build.publish` to your release endpoint.

---

## 8. Troubleshooting

| Issue | Solution |
|-------|----------|
| Port conflict | Check `lsof -i :8098` and kill conflicting process |
| Database locked | Stop all services, remove `.db-shm` and `.db-wal` files |
| Upload fails | Check `client_max_body_size` in nginx config |
| CORS errors | Verify proxy rules in Vite config and nginx |
| SSL cert expired | Run `certbot renew` |
