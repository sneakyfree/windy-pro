# WindyCloud Architecture

> "iCloud for the AI era" — Record offline → Wi-Fi sync → Encrypted storage → Digital twin

## Overview

WindyCloud is the storage and compute backbone of the Windy ecosystem. It provides:
- **Encrypted file storage** — voice recordings, transcripts, documents, photos
- **Background sync** — record offline, sync when on Wi-Fi
- **Digital twin pipeline** — feeds voice/video data into WindyClone
- **Multi-device** — access from desktop, mobile, web

## The Windy Flywheel

```
┌─────────────┐    record    ┌─────────────┐    sync     ┌─────────────┐
│  WindyWord   │ ──────────► │  WindyCloud  │ ─────────► │  WindyClone  │
│  (voice→text)│             │  (storage)   │            │  (AI twin)   │
└─────────────┘             └──────┬──────┘            └──────┬──────┘
                                    │                          │
                                    │ chat data                │ avatar + voice
                                    ▼                          ▼
                            ┌─────────────┐           ┌─────────────┐
                            │  WindyChat   │ ◄─────── │  Digital You │
                            │  (messaging) │           │  (your twin) │
                            └─────────────┘           └─────────────┘
```

**WindyWord.ai** → Record and transcribe (the app)
**WindyCloud.com** → Store and sync (this document)
**WindyClone.com** → Generate your virtual AI twin
**WindyChat.ai** → Agent-first messaging platform

## Storage Tiers (by subscription)

| Tier | Storage | Notes |
|------|---------|-------|
| Free | 500 MB | ~10 hours of transcripts |
| Windy Pro ($4.99/mo · $49/yr · $99 lifetime) | 5 GB | Cloud sync enabled |
| Windy Ultra ($8.99/mo · $79/yr · $199 lifetime) | 10 GB | + translation data |
| Windy Max ($14.99/mo · $149/yr · $299 lifetime) | 25 GB | + medical/legal archives |

Storage is included with your subscription — no separate WindyCloud billing.

## Cloud STT Policy

- **Monthly/Annual subscribers**: ☁️ Cloud STT included (Groq whisper-large-v3, ~$0.002/min)
- **Lifetime buyers**: 🏠 Local engines only ("Own Your Stack")
- Users never see "Groq" — UI shows "☁️ Windy Cloud" only

## Infrastructure

### Phase 1 (Launch)
- **Storage**: Cloudflare R2 (S3-compatible, no egress fees)
- **Estimated cost**: ~$0.015/GB/month storage + $0.00/GB egress
- **Per-user cost**: ~$0.075/mo for 5 GB (97%+ margin on Pro tier)
- **API**: REST endpoints via account-server (`/api/v1/cloud/*`)
- **Auth**: JWT tokens from Windy account server
- **Encryption**: E2E — client encrypts before upload, server never sees plaintext

### Phase 2 (Scale)
- Multi-region R2 buckets (US, EU, APAC)
- Custom CDN for model distribution
- Dedicated compute for WindyClone processing
- Own infrastructure replacing R2 when economics justify it

### Phase 3 (WindyCloud as Product)
- General-purpose encrypted storage
- Compete with iCloud/Dropbox/Google Drive
- Privacy-first differentiator
- API for third-party apps

## API Endpoints

```
POST   /api/v1/cloud/upload       — Upload file (multipart, encrypted)
GET    /api/v1/cloud/files         — List user files
GET    /api/v1/cloud/files/:id     — Download file
DELETE /api/v1/cloud/files/:id     — Delete file
GET    /api/v1/cloud/usage         — Storage usage stats
POST   /api/v1/cloud/sync          — Sync manifest (delta sync)
```

## Sync Protocol

1. **Client records** → stores locally with metadata
2. **Wi-Fi detected** → sync daemon wakes
3. **Delta check** → client sends manifest hash to server
4. **Upload queue** → new/modified files encrypted + uploaded
5. **Conflict resolution** → server wins for metadata, client wins for content
6. **Notification** → other devices receive push to pull updates

## Data Flow to WindyClone

When users opt in to "Build My Digital Twin":
1. Voice recordings accumulate in WindyCloud
2. At milestones (5h, 20h, 50h, 200h), clone quality improves
3. WindyClone service pulls voice data + optional video data
4. Generates voice model → avatar model → personality model
5. Digital twin available via WindyChat for conversations

## Security

- **E2E encryption**: AES-256-GCM, keys derived from user password
- **Zero-knowledge**: Server cannot decrypt user data
- **No data mining**: We never use data (or metadata) for training or analytics
- **Secure delete**: Cryptographic erasure — delete the key, data becomes random noise
- **Compliance**: GDPR-ready (data portability + right to erasure)

## Economics

| Metric | Value |
|--------|-------|
| R2 Storage | $0.015/GB/month |
| R2 Class A ops | $4.50/million |
| R2 Class B ops | $0.36/million |
| R2 Egress | $0.00 |
| Pro user avg storage | ~2 GB |
| Pro user monthly cost | ~$0.03 |
| Pro monthly revenue | $4.99 |
| **Gross margin** | **~99%** |

---

*WindyCloud: Your data. Your encryption keys. Your privacy. Period.*
