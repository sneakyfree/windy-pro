# Windy Pro — REST API Reference

> Base URL: `https://windypro.thewindstorm.uk` (production) or `http://localhost:8098` (local)

## Authentication

All authenticated endpoints require an `Authorization: Bearer <token>` header. Tokens are JWT with a 24-hour expiry.

### Error Format

All errors return JSON:
```json
{ "error": "Description of the error" }
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 206 | Partial Content (range requests) |
| 400 | Bad Request |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (admin-only) |
| 404 | Not Found |
| 409 | Conflict (duplicate) |
| 429 | Rate Limited |
| 500 | Internal Server Error |

---

## Health

### `GET /health`

Health check. No auth required.

```bash
curl http://localhost:8098/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "windy-pro-account-server",
  "version": "2.0.0",
  "users": 3,
  "devices": 7,
  "maxDevicesPerAccount": 5,
  "timestamp": "2026-03-02T22:00:00.000Z"
}
```

---

## Authentication

### `POST /api/v1/auth/register`

Create a new account.

```bash
curl -X POST http://localhost:8098/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "name": "John Doe"
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | ✅ | Valid email address |
| `password` | string | ✅ | Min 8 characters |
| `name` | string | ✅ | Display name |

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "tier": "free"
  }
}
```

**Errors:** `409` — email already registered

---

### `POST /api/v1/auth/login`

Authenticate and receive a JWT token.

```bash
curl -X POST http://localhost:8098/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "tier": "free"
  }
}
```

**Errors:** `401` — invalid credentials

---

### `GET /api/v1/auth/me` 🔒

Get current user profile.

```bash
curl http://localhost:8098/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "tier": "free",
  "created_at": "2026-03-02T20:00:00Z"
}
```

---

### `GET /api/v1/auth/devices` 🔒

List all registered devices for the current user.

```bash
curl http://localhost:8098/api/v1/auth/devices \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "devices": [
    {
      "id": "uuid",
      "device_id": "DESKTOP-ABC123",
      "device_name": "MacBook Pro",
      "platform": "desktop",
      "last_seen": "2026-03-02T22:00:00Z"
    }
  ],
  "max_devices": 5
}
```

---

### `POST /api/v1/auth/devices/register` 🔒

Register a new device. Max 5 per account.

```bash
curl -X POST http://localhost:8098/api/v1/auth/devices/register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PHONE-XYZ789",
    "device_name": "iPhone 15",
    "platform": "ios"
  }'
```

**Errors:** `409` — device limit reached

---

### `POST /api/v1/auth/devices/remove` 🔒

Remove a registered device.

```bash
curl -X POST http://localhost:8098/api/v1/auth/devices/remove \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "device_id": "PHONE-XYZ789" }'
```

---

### `POST /api/v1/auth/refresh`

Refresh an expired token (if within refresh window).

```bash
curl -X POST http://localhost:8098/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "token": "eyJhbGci..." }'
```

---

### `POST /api/v1/auth/change-password` 🔒

Change account password.

```bash
curl -X POST http://localhost:8098/api/v1/auth/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "OldPass123!",
    "newPassword": "NewPass456!"
  }'
```

---

### `GET /api/v1/auth/billing` 🔒

Get billing info and subscription status.

```bash
curl http://localhost:8098/api/v1/auth/billing \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "tier": "pro",
  "stripe_customer_id": "cus_...",
  "subscription_status": "active",
  "billing_history": []
}
```

---

### `POST /api/v1/auth/create-portal-session` 🔒

Create a Stripe customer portal session for billing management.

```bash
curl -X POST http://localhost:8098/api/v1/auth/create-portal-session \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{ "url": "https://billing.stripe.com/session/..." }
```

---

## Translation

### `POST /api/v1/translate/text` 🔒

Translate text between languages.

```bash
curl -X POST http://localhost:8098/api/v1/translate/text \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, how are you?",
    "source": "en",
    "target": "es"
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | Text to translate (max 5000 chars) |
| `source` | string | ✅ | Source language code (ISO 639-1) |
| `target` | string | ✅ | Target language code |

**Response (200):**
```json
{
  "translation": "Hola, ¿cómo estás?",
  "source": "en",
  "target": "es",
  "confidence": 0.95
}
```

---

### `POST /api/v1/translate/speech` 🔒

Translate spoken audio. Accepts multipart form data.

```bash
curl -X POST http://localhost:8098/api/v1/translate/speech \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "audio=@recording.wav" \
  -F "source=en" \
  -F "target=es"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | file | ✅ | Audio file (WAV, WebM, MP3) — max 10MB |
| `source` | string | ✅ | Source language code |
| `target` | string | ✅ | Target language code |

**Response (200):**
```json
{
  "transcription": "Hello, how are you?",
  "translation": "Hola, ¿cómo estás?",
  "audio_url": null,
  "duration": 2.5
}
```

---

### `GET /api/v1/translate/languages` 🔒

List all supported languages.

```bash
curl http://localhost:8098/api/v1/translate/languages \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "languages": [
    { "code": "en", "name": "English" },
    { "code": "es", "name": "Spanish" },
    { "code": "fr", "name": "French" }
  ]
}
```

---

## User Data

### `GET /api/v1/user/history` 🔒

Get translation history for the current user.

```bash
curl http://localhost:8098/api/v1/user/history \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "translations": [
    {
      "id": "uuid",
      "source_text": "Hello",
      "translated_text": "Hola",
      "source_lang": "en",
      "target_lang": "es",
      "created_at": "2026-03-02T20:00:00Z"
    }
  ]
}
```

---

### `POST /api/v1/user/favorites` 🔒

Toggle a translation as favorite.

```bash
curl -X POST http://localhost:8098/api/v1/user/favorites \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "translation_id": "uuid" }'
```

---

## Recordings & Clone Training

### `POST /api/v1/recordings/upload` 🔒

Upload a recording bundle. Accepts multipart form data (max 500MB).

```bash
curl -X POST http://localhost:8098/api/v1/recordings/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "media=@recording.webm" \
  -F "bundle_id=uuid" \
  -F "duration_seconds=127" \
  -F "has_video=true" \
  -F "video_resolution=1080p" \
  -F "camera_source=front" \
  -F "transcript_text=Hello world" \
  -F "transcript_segments=[{\"start\":0,\"end\":2.5,\"text\":\"Hello world\"}]" \
  -F "device_platform=desktop" \
  -F "clone_training_ready=true"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `media` | file | ❌ | Video/audio file (WebM, MP4) — max 500MB |
| `bundle_id` | string | ❌ | Client-generated UUID |
| `duration_seconds` | int | ❌ | Recording duration |
| `has_video` | bool | ❌ | Whether bundle includes video |
| `video_resolution` | string | ❌ | "480p", "720p", "1080p" |
| `camera_source` | string | ❌ | "front", "back", "webcam" |
| `transcript_text` | string | ❌ | Full transcript text |
| `transcript_segments` | string | ❌ | JSON array of timestamped segments |
| `device_platform` | string | ❌ | "desktop", "ios", "android" |
| `clone_training_ready` | bool | ❌ | Marked for clone training |

**Response (201):**
```json
{
  "id": "uuid",
  "bundle_id": "uuid",
  "file_size": 5242880
}
```

---

### `GET /api/v1/recordings/:id/video` 🔒

Stream recording video. Supports HTTP range requests for seeking.

```bash
# Full download
curl http://localhost:8098/api/v1/recordings/UUID/video \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o video.webm

# Range request (bytes 0-1023)
curl http://localhost:8098/api/v1/recordings/UUID/video \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Range: bytes=0-1023"
```

**Response:** `200` (full) or `206` (partial) with `Content-Type: video/webm`

---

### `GET /api/v1/recordings/list` 🔒

List recordings since a given timestamp. Used by auto-sync.

```bash
curl "http://localhost:8098/api/v1/recordings/list?since=2026-03-01T00:00:00Z" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `since` | string | ❌ | ISO 8601 timestamp (default: epoch) |

---

### `GET /api/v1/recordings/check` 🔒

Check if a specific bundle already exists on the cloud (deduplication).

```bash
curl "http://localhost:8098/api/v1/recordings/check?bundle_id=UUID" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{ "exists": true, "bundle_id": "UUID" }
```

---

### `POST /api/v1/recordings/sync` 🔒

Legacy bulk sync endpoint — upload multiple bundle metadata objects at once.

```bash
curl -X POST http://localhost:8098/api/v1/recordings/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bundles": [
      {
        "bundle_id": "uuid1",
        "created_at": "2026-03-02T20:00:00Z",
        "duration_seconds": 127,
        "audio": {"format": "aac", "file": "rec.aac", "size_bytes": 524288},
        "video": null,
        "transcript": {"text": "Hello", "segments": [], "language": "en"},
        "device": {"platform": "android", "model": "Pixel 8", "app_version": "2.0.0"},
        "sync_status": "pending",
        "clone_training_ready": true,
        "tags": []
      }
    ]
  }'
```

**Response (200):**
```json
{ "synced": 1, "skipped": 0, "errors": [] }
```

**Response (200):**
```json
{
  "bundles": [
    {
      "id": "uuid",
      "bundle_id": "uuid",
      "duration_seconds": 127,
      "has_video": 1,
      "video_resolution": "1080p",
      "camera_source": "front",
      "transcript_text": "Hello world",
      "file_size": 5242880,
      "device_platform": "ios",
      "device_id": "IPHONE-ABC",
      "device_name": "iPhone 15",
      "clone_training_ready": 1,
      "sync_status": "uploaded",
      "created_at": "2026-03-02T20:00:00Z"
    }
  ],
  "total": 1,
  "since": "2026-03-01T00:00:00Z"
}
```

---

### `GET /api/v1/clone/training-data` 🔒

List bundles marked as training-ready.

```bash
curl http://localhost:8098/api/v1/clone/training-data \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "bundles": [ /* same format as recordings/list */ ],
  "total": 5
}
```

---

### `POST /api/v1/clone/start-training` 🔒

Start a clone training job. Requires minimum 3 training-ready bundles.

```bash
curl -X POST http://localhost:8098/api/v1/clone/start-training \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bundle_ids": ["uuid1", "uuid2", "uuid3"]
  }'
```

**Response (200):**
```json
{
  "jobId": "uuid",
  "status": "queued",
  "bundle_count": 3,
  "estimated_time": "45 minutes",
  "message": "Clone training job queued successfully"
}
```

**Errors:** `400` — fewer than 3 bundles, or bundles not training-ready

---

## WebRTC Signaling

### `POST /api/v1/rtc/signal`

Send a signaling message. No auth required (token-based session isolation).

```bash
# Send offer
curl -X POST http://localhost:8098/api/v1/rtc/signal \
  -H "Content-Type: application/json" \
  -d '{
    "type": "offer",
    "token": "SESSION_TOKEN",
    "sdp": "v=0\r\no=- ..."
  }'

# Send answer
curl -X POST http://localhost:8098/api/v1/rtc/signal \
  -H "Content-Type: application/json" \
  -d '{
    "type": "answer",
    "token": "SESSION_TOKEN",
    "sdp": "v=0\r\no=- ..."
  }'

# Send ICE candidate
curl -X POST http://localhost:8098/api/v1/rtc/signal \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ice-candidate",
    "token": "SESSION_TOKEN",
    "candidate": {
      "candidate": "candidate:1 1 UDP 2013266431 ...",
      "sdpMLineIndex": 0
    }
  }'

# Request camera switch
curl -X POST http://localhost:8098/api/v1/rtc/signal \
  -H "Content-Type: application/json" \
  -d '{
    "type": "switch-camera",
    "token": "SESSION_TOKEN"
  }'
```

| type | Description |
|------|-------------|
| `offer` | WebRTC SDP offer from initiator |
| `answer` | WebRTC SDP answer from responder |
| `ice-candidate` | ICE connectivity candidate |
| `switch-camera` | Request phone to toggle front/back camera |

---

### `GET /api/v1/rtc/signal`

Poll for signaling data.

```bash
# Get offer (phone polls for desktop's offer)
curl "http://localhost:8098/api/v1/rtc/signal?token=SESSION_TOKEN&type=offer"

# Get answer + ICE candidates (desktop polls for phone's response)
curl "http://localhost:8098/api/v1/rtc/signal?token=SESSION_TOKEN&type=answer"
```

---

## Admin (Requires `role: admin`)

### `GET /api/v1/admin/users` 🔒 👑

List all users with pagination.

```bash
curl http://localhost:8098/api/v1/admin/users \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

### `GET /api/v1/admin/stats` 🔒 👑

System statistics.

```bash
curl http://localhost:8098/api/v1/admin/stats \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

**Response (200):**
```json
{
  "totalUsers": 150,
  "totalTranslations": 12500,
  "activeDevices": 87,
  "translationsToday": 340
}
```

---

### `GET /api/v1/admin/revenue` 🔒 👑

Revenue breakdown by plan tier.

```bash
curl http://localhost:8098/api/v1/admin/revenue \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

**Response (200):**
```json
{
  "total": 149000,
  "mrr": 7990,
  "planCounts": {
    "free": 100,
    "pro": 30,
    "translate": 10,
    "translate_pro": 10
  }
}
```

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔒 | Requires `Authorization: Bearer <token>` header |
| 👑 | Requires admin role |
