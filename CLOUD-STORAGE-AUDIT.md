# Cloud Storage Service Audit

**Date:** 2026-03-04  
**Author:** Automated audit  
**Services:** `account-server` (port 8098) · `services/cloud-storage` (port 8099)

---

## 1. Current Architecture

```
┌──────────────────────────────┐
│  Electron Desktop App        │
│  (src/client/desktop/main.js)│
└──────┬──────────┬────────────┘
       │          │
       │ API calls│ File uploads
       │ port 8098│ port 8099
       ▼          ▼
┌──────────────┐  ┌─────────────────────┐
│ account-server│  │ cloud-storage       │
│ TypeScript    │  │ Plain JS            │
│ SQLite DB     │  │ JSON-file DB        │
│ Zod validation│  │ No validation       │
│ 8 route files │  │ 1 monolith (1212 ln)│
└──────────────┘  └─────────────────────┘
```

The Electron desktop app connects to **two separate backend services**:

| Aspect | account-server (8098) | cloud-storage (8099) |
|---|---|---|
| Language | TypeScript | Plain JavaScript |
| Database | SQLite via better-sqlite3 | JSON files on disk |
| Auth | JWT (bcrypt, Zod-validated) | JWT (bcrypt, no validation) |
| User DB | `users` table in SQLite | `data/_db/users.json` |
| JWT Secret | Shared env or random | Separate random |
| Routes | `/api/v1/*` prefixed | Flat (`/auth/*`, `/files/*`, `/admin/*`) |
| Stripe | Not integrated | Full webhook + billing |
| File Storage | Not integrated | multer → `data/uploads/` |
| Admin | None | Full admin dashboard API |
| Port | 8098 | 8099 |

**Mobile app** (`windy-pro-mobile`) connects **only** to account-server at `windypro.thewindstorm.uk` (port 8098). It does **not** use cloud-storage.

---

## 2. Cloud Storage Endpoints

### Public
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health + disk info |
| POST | `/auth/register` | Create user (email, password, deviceId) |
| POST | `/auth/login` | Login → JWT |

### Authenticated (user)
| Method | Path | Purpose |
|---|---|---|
| POST | `/files/upload` | Upload file (multer multipart) |
| GET | `/files` | List user's files |
| GET | `/files/:fileId` | Download file |
| DELETE | `/files/:fileId` | Delete file |

### Admin (30+ endpoints)
| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/bootstrap` | Create admin account |
| GET | `/admin/users` | List all users |
| GET | `/admin/users/search` | Search users |
| GET | `/admin/users/:userId` | Get user detail |
| POST | `/admin/users/:userId/freeze` | Freeze/unfreeze |
| DELETE | `/admin/users/:userId` | Delete user + files |
| POST | `/admin/users/:userId/tier` | Change tier |
| POST | `/admin/users/:userId/reassign` | Reassign node |
| GET/POST/DELETE | `/admin/nodes/*` | Node management |
| GET | `/admin/overview` | Storage overview |
| GET | `/admin/audit` | Audit log |
| POST | `/stripe/webhook` | Stripe webhook handler |
| GET | `/admin/billing/*` | Transactions, summary |
| POST | `/admin/billing/refund` | Refund via Stripe API |
| POST/GET | `/admin/billing/coupons*` | Coupon management |
| GET | `/admin/nodes/health` | Aggregate node health |
| POST | `/admin/migrate` | Migrate users between nodes |
| GET | `/admin/alerts` | System alerts |
| GET | `/admin/reports/*` | Summary + CSV exports |
| POST | `/admin/seed` | Seed test data |

---

## 3. Account Server Endpoints (for comparison)

Route files in `account-server/src/routes/`:

| File | Prefix | Purpose |
|---|---|---|
| `auth.ts` | `/api/v1/auth/*` | Login, register, refresh, logout |
| `recordings.ts` | `/api/v1/recordings/*` | Upload, list, check, get, delete |
| `transcription.ts` | `/api/v1/transcribe` | HTTP + WebSocket transcription |
| `translations.ts` | `/api/v1/translate/*` | Text, speech, languages |
| `clone.ts` | `/api/v1/clone/*` | Voice clone operations |
| `admin.ts` | `/api/v1/admin/*` | Admin operations |
| `downloads.ts` | `/api/v1/downloads/*` | App downloads |
| `misc.ts` | Various | Health, license, OCR, analytics |

---

## 4. Identified Issues

### 🔴 Critical: Dual Auth — Users Must Register Twice

The desktop app calls `POST /auth/register` on **cloud-storage** (port 8099) during onboarding wizard (line 1872). It also calls account-server (port 8098) for license validation and API endpoints. These are **completely separate user databases** with **separate JWT secrets**.

- A user who registers on account-server does **not** exist on cloud-storage
- A user who registers on cloud-storage does **not** exist on account-server
- JWT tokens from one service are **invalid** on the other

### 🔴 Critical: Hardcoded LAN IP

The Electron app hardcodes `CLOUD_STORAGE_DEFAULT_URL = 'http://192.168.4.126:8099'` (line 1518). This only works on the developer's local network. Any external user will fail to connect.

### 🟡 Major: Schema Drift

- account-server uses **SQLite** with typed schemas (Zod-validated)
- cloud-storage uses **JSON files** with no validation
- User schemas differ (cloud-storage has `storageUsed`, `storageLimit`, `assignedNode`, `frozen`; account-server has `devices`, `tier`, `session` fields)

### 🟡 Major: Stripe Webhook Duplication Risk

Both services could potentially receive Stripe webhooks. Cloud-storage has a full Stripe webhook handler. If account-server also handles Stripe events, they'll conflict.

### 🟡 Major: No Rate Limiting on Cloud Storage

Cloud-storage has zero rate limiting. Account-server has rate limiting middleware.

### 🟠 Minor: No Zod/Validation on Cloud Storage

All request bodies are consumed raw with no schema validation, making the API vulnerable to malformed requests and data corruption in the JSON DB.

---

## 5. Recommendation: MERGE into Account Server

**Verdict: Merge.** The cloud-storage service should be absorbed into account-server.

### Rationale

1. **Single auth** — Users register once, one JWT, one session
2. **Single DB** — SQLite is faster and safer than JSON files for concurrent writes
3. **Zod validation** — All inputs validated consistently
4. **Single deployment** — One service to monitor, restart, update
5. **Stripe in one place** — No webhook routing conflicts
6. **Rate limiting** — Applied uniformly
7. **TypeScript** — Type safety for all endpoints

### What Moves Where

| Cloud-storage feature | Destination in account-server |
|---|---|
| `POST /files/upload` | `POST /api/v1/recordings/upload` (already exists — enhance with multer) |
| `GET /files` | `GET /api/v1/recordings/list` (already exists) |
| `GET /files/:fileId` | `GET /api/v1/recordings/:id` (already exists) |
| `DELETE /files/:fileId` | `DELETE /api/v1/recordings/:id` (already exists) |
| `/auth/register` | Already in account-server auth routes |
| `/auth/login` | Already in account-server auth routes |
| `/stripe/webhook` | Move to account-server (or keep as separate microservice) |
| `/admin/*` routes | Move to `admin.ts` route file |
| Billing/coupons | Move to new `billing.ts` route file |
| Node management | **Drop** — unnecessary for single-server deployment |
| Seed data generator | Move to a dev-only script |
| File migration | **Drop** — N/A with single server |
| JSON DB (`JsonDB`) | **Drop** — use SQLite tables |

### New SQLite Tables Needed

```sql
-- File storage metadata (replaces filesDB JSON)
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  type TEXT DEFAULT 'transcript',  -- transcript, audio, video
  session_date TEXT,
  metadata TEXT DEFAULT '{}',
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add to users table
ALTER TABLE users ADD COLUMN storage_used INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 524288000; -- 500MB

-- Transactions (replaces transactionsDB JSON)
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  amount INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  type TEXT,
  status TEXT DEFAULT 'pending',
  stripe_payment_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Coupons (replaces couponsDB JSON)
CREATE TABLE coupons (
  code TEXT PRIMARY KEY,
  discount_percent INTEGER,
  max_uses INTEGER DEFAULT 999,
  usage_count INTEGER DEFAULT 0,
  expires_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Migration Steps (future work)

1. Add SQLite tables above to account-server
2. Add multer to account-server for file upload handling
3. Create `routes/billing.ts` with Stripe webhook + transaction endpoints
4. Enhance `routes/admin.ts` with user management (freeze, tier, etc.)
5. Add storage quota checking to recording upload route
6. Update Electron `main.js` to point all requests at account-server (port 8098)
7. Remove hardcoded `192.168.4.126:8099`
8. Migrate existing JSON data to SQLite (one-time script)
9. Deprecate and remove `services/cloud-storage/`

---

## 6. Immediate Quick Fixes (if NOT merging yet)

If the merge is deferred, these are critical fixes to make cloud-storage usable:

1. **Fix the hardcoded IP** — Use `process.env.CLOUD_STORAGE_URL` or default to `https://windypro.thewindstorm.uk:8099`
2. **Share JWT secret** — Both services must use the same `JWT_SECRET` env var so tokens work cross-service
3. **Add rate limiting** — `express-rate-limit` on auth and upload endpoints
4. **Add CORS origin restriction** — Currently allows all origins
