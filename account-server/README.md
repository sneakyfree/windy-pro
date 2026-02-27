# Windy Pro v2.0 — Account Server

Express.js auth server with SQLite, bcrypt passwords, JWT tokens, and 5-device limit.

## Quick Start

```bash
npm install
node server.js
# → http://localhost:8098
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `POST` | `/v1/auth/register` | No | Create account |
| `POST` | `/v1/auth/login` | No | Login |
| `GET` | `/v1/auth/me` | JWT | Current user info |
| `GET` | `/v1/auth/devices` | JWT | List devices |
| `POST` | `/v1/auth/devices/register` | JWT | Register device (5 max) |
| `POST` | `/v1/auth/devices/remove` | JWT | Remove device |
| `POST` | `/v1/auth/refresh` | No | Refresh JWT |

## Register / Login

```bash
# Register
curl -X POST http://localhost:8098/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","email":"jane@example.com","password":"secret123","deviceId":"abc123","deviceName":"MacBook","platform":"darwin"}'

# Login
curl -X POST http://localhost:8098/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"secret123","deviceId":"abc123"}'
```

Both return `{ userId, name, email, tier, token, refreshToken, devices }`.

## Device Limit

Each account supports up to **5 devices**. The 6th registration returns 403.

## Run Tests

```bash
bash test-api.sh
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8098` | Server port |
| `JWT_SECRET` | dev secret | JWT signing key |

## Storage

SQLite database: `accounts.db` (auto-created on first run).
