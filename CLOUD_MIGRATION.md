# Windy Cloud — Future Extraction Plan

## Current State (March 2026)
Cloud storage is integrated into the Windy Pro account-server:
- `account-server/src/routes/storage.ts` — file upload/download/list/delete
- R2 backend via environment variables (R2_ACCOUNT_ID, R2_BUCKET, etc.)
- Storage quotas enforced per user tier
- Local disk fallback when R2 credentials not configured

## Why It's Native (For Now)
- Shared auth is automatic — same JWT, same user table
- One deployment, one Docker Compose
- R2 scales automatically (zero capacity planning)
- Account-server can be horizontally scaled if needed
- Extraction is a known 1-day operation (same pattern as windy-chat, windy-mail)

## When to Extract
Extract Windy Cloud into its own repo when ANY of these conditions are met:
1. Storage I/O latency degrades auth endpoint response times (>200ms p95)
2. A second Windy product (Chat media, Mail attachments) needs file storage
3. Windy Cloud launches as a separate product with its own pricing
4. Third-party developers need storage API access

## Extraction Plan (When Ready)
1. Create `windy-cloud` repo (same pattern as windy-chat, windy-mail)
2. Move storage routes + R2 adapter to new service
3. Add JWKS auth from Pro's /.well-known/jwks.json (copy from windy-mail)
4. Add windy_identity_id correlation (copy from windy-chat)
5. Update all clients (mobile cloudApi.ts, desktop, agent windy_cloud.py) to new Cloud URL
6. Add to docker-compose as independent service
7. Update nginx to proxy storage requests to new service

## Features to Add at Extraction Time
- Twilio phone number pool (assign on hatch, return on revocation)
- Push notification gateway (FCM + APNs)
- Model delivery service (Whisper model downloads)
- Cross-device sync protocol
- Storage analytics dashboard
- Overage billing and usage alerts
- Multi-region replication

## Stub Endpoints (Available Now)
These exist as stubs in account-server/src/routes/cloud.ts:
- POST /api/v1/cloud/phone/provision — returns placeholder number
- POST /api/v1/cloud/phone/release — acknowledges
- POST /api/v1/cloud/push/send — logs and acknowledges
All return X-Stub: true header. Replace with real implementations at extraction time.
