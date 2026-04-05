# Windy Pro — Ecosystem Deployment

## Local Integration Testing

Start the full ecosystem locally to test cross-service integration.

### Prerequisites

- Docker and Docker Compose installed
- All Windy repos cloned as siblings:
  ```
  ~/windy-pro/
  ~/windy-chat/
  ~/windy-mail/
  ~/windy-cloud/
  ~/eternitas/
  ```

### Step-by-Step

```bash
# 1. Start external services (each from their own repo)
cd ~/eternitas && docker compose up -d
cd ~/windy-chat && docker compose up -d
cd ~/windy-mail && docker compose up -d
cd ~/windy-cloud && docker compose up -d

# 2. Build the web portal
cd ~/windy-pro/src/client/web && npm ci && npm run build

# 3. Start the account server + web portal
cd ~/windy-pro/deploy
docker compose -f docker-compose.ecosystem.yml up -d

# 4. Verify everything is connected
../scripts/test-ecosystem.sh http://localhost:8098

# 5. Open the web portal
open http://localhost:3000
```

### Quick Start (Account Server Only)

If you only need the account server (no other ecosystem services):

```bash
cd ~/windy-pro/deploy
docker compose -f docker-compose.ecosystem.yml up -d account-server redis
```

### Environment Variables

Copy `deploy/.env.production.example` to `deploy/.env` and configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `WINDY_CHAT_URL` | Windy Chat onboarding service | `http://host.docker.internal:8101` |
| `WINDY_MAIL_URL` | Windy Mail API | `http://host.docker.internal:8200` |
| `ETERNITAS_URL` | Eternitas registry | `http://host.docker.internal:8200` |
| `CHAT_SERVICE_TOKEN` | Service-to-service auth for Chat | `dev-chat-token` |
| `ETERNITAS_API_KEY` | Eternitas platform API key | (empty) |

### Health Check

```bash
curl http://localhost:8098/health | jq
```

Returns status of database, JWKS, and all ecosystem services.

### Production Deployment

For production, use `docker-compose.production.yml` instead:

```bash
docker compose -f docker-compose.production.yml up -d
```

This uses proper secrets, TLS, and production database configuration.
