# MODEL_PROTECTION_SPEC.md — Desktop (Electron)

_Last updated: 19 March 2026_
_Adapted from mobile spec (AG Opus, OC5) for Windy Pro Desktop_
_Canonical brand reference: /BRAND-ARCHITECTURE.md_

---

## Overview

Four-layer defense system to prevent model piracy, refund abuse, and unauthorized redistribution of Windy Word / Windy Traveler translation pair models on the desktop Electron app.

**Design principles:**
- Never punish legitimate customers
- Encryption is the primary defense (not connectivity requirements)
- Desktop users have full filesystem access — assume hostile environment
- All protection is transparent to the user experience when licenses are valid

---

## ⚠️ SAFETY PRINCIPLES — INVIOLABLE RULES

These rules override ALL other implementation details. No code path may violate them.

### 1. Default State = UNLOCKED
If anything goes wrong — server down, fingerprint mismatch, network timeout, unexpected error — the default behavior is **let them use their models**. Only an explicit, confirmed `{ valid: false }` response from a healthy server triggers any lock action. When in doubt, trust the user.

### 2. Server Errors ≠ Revocation
- `HTTP 5xx` or network timeout → "try again next cycle" (no lock, no warning)
- `HTTP 200 { valid: true }` → normal operation
- `HTTP 200 { valid: false }` → this is the ONLY signal that triggers the lock path
- DNS failure, TLS error, connection refused → same as 5xx, try again later

### 3. Lock, Never Delete (First Offense)
When a license cannot be verified, models are **locked** (decryption key removed from memory/keychain). The encrypted files stay on disk. The user can unlock instantly by reconnecting and verifying. Deletion of model files happens ONLY after:
- Confirmed refund/chargeback AND
- 7-day warning period has elapsed AND
- User has been notified at least twice (in-app + email if available)

### 4. Every Lock Gets a Warning First
No user should ever be surprised by a lockout. Before any lock action:
- Show in-app warning: "Your license couldn't be verified. You have 7 days to connect and resolve this."
- Start a visible countdown
- Only lock after the warning period expires
- Exception: confirmed fraud/chargeback may use a shorter (48-hour) warning

### 5. Fuzzy Device Fingerprinting
Device fingerprint is used for tracking and analytics, NOT for encryption key derivation. This prevents users from being locked out by:
- OS upgrades
- Hardware changes (new RAM, new SSD)
- System reinstalls
- Migrating to a new machine (just sign in again)

The encryption key is derived from `HKDF(licenseToken + APP_SECRET)` only. Device fingerprint is sent as a header for multi-device tracking but does not affect model access.

### 6. Generous Grace Periods
Grace periods assume the user is a legitimate customer in a low-connectivity situation (airplane, rural area, international travel):
- Free: 72 hours (not 24 — even free users deserve grace)
- Pro: 7 days
- Ultra: 14 days
- Max / Marco Polo: 30 days
- "Travel mode" toggle: extends any tier to 30 days when manually activated

### 7. Multi-Device Tolerance
- Allow up to 5 devices per license by default
- When device limit is reached: warn, don't lock. "You've reached your device limit. Manage devices at windyword.com/account."
- Deactivating a device is self-service, not support-ticket

### 8. Manual Override
Grant (and future support staff) must have a dashboard to:
- Instantly unlock any user's models with one click
- Override any revocation
- Extend grace periods
- View heartbeat history per user
- This is non-negotiable. Build it before launch.

### 9. The Golden Rule
**It is better to let 10 pirates use free models than to lock out 1 paying customer.**
Piracy is a rounding error. Customer trust is everything. When any implementation decision is ambiguous, choose the option that favors the user.

---

## Layer 1: Encrypted Model Files (CRITICAL — implement first)

### Why This Matters More on Desktop
Mobile OSes sandbox app data — users can't browse to model files without jailbreaking. On desktop, users can navigate directly to the model directory and copy `.bin` files. **Encryption is non-negotiable for desktop.**

### Implementation

**Key Derivation (Updated per Safety Principles §5):**
```
decryptionKey = HKDF-SHA256(
  ikm: licenseToken,
  salt: APP_SECRET,
  info: "windy-model-v1"
)
```

**NOTE:** Device fingerprint is intentionally EXCLUDED from key derivation. Per Safety Principle §5, tying encryption to hardware causes lockouts when users upgrade OS, swap drives, or migrate machines. The license token alone gates access. Device fingerprint is collected separately for analytics and multi-device tracking only.

**Device Fingerprint (Desktop) — for tracking, NOT encryption:**
Combine at least 3 of:
- Machine UUID (`/etc/machine-id` on Linux, `IOPlatformUUID` on macOS, `MachineGuid` on Windows)
- CPU model string
- Primary disk serial number
- OS install date

Sent as `X-Device-Fingerprint` header on heartbeat calls. Used to count devices per license and detect unusual patterns. Does NOT affect model access.

**Encryption:**
- Algorithm: AES-256-GCM (authenticated encryption — detects tampering)
- Models encrypted on download, stored encrypted on disk
- Decryption happens in memory at model load time via streaming decrypt
- Decrypted weights are NEVER written to disk
- Each model file has a unique IV (initialization vector) stored in the file header

**File format:**
```
[4 bytes: magic "WMOD"]
[2 bytes: version]
[12 bytes: IV/nonce]
[16 bytes: auth tag]
[... encrypted model weights ...]
```

**Key rotation:**
- When a license is renewed or tier changes, re-derive the key
- Re-encrypt models in the background (low-priority task)
- Old key is wiped from memory immediately

### Desktop-Specific Considerations
- Electron's `safeStorage` API can protect the license token at rest (OS keychain integration)
- On Windows, use DPAPI via `safeStorage.encryptString()`
- On macOS, uses Keychain automatically
- On Linux, uses libsecret/kwallet

---

## Layer 2: License Heartbeat

### How It Works
The desktop app pings the license server periodically to confirm the subscription/purchase is still valid.

**Check interval:** Every 48 hours (when online)

**Offline grace periods (tiered by spend):**

| Tier | Grace Period | Rationale |
|------|-------------|-----------|
| Free | 72 hours | Even free users deserve grace |
| Pro ($99) | 7 days | Standard grace |
| Ultra ($199) | 14 days | Higher trust |
| Max ($299) | 30 days | Premium customer |
| Marco Polo ($399) | 30 days | VIP — treat with maximum respect |
| Travel Mode (any tier) | 30 days | Manual toggle for travelers — our core users |

**Behavior on grace expiry:**
1. Models are **locked** (not deleted) — decryption key is wiped from memory/keychain
2. App shows: "Please connect to the internet to verify your license"
3. On successful re-verification: key is re-derived, models unlock immediately
4. On failed verification (revoked license): models are deleted, tiers reset to Free

**Desktop advantage:** Desktop machines typically have more reliable internet than phones. The heartbeat is less likely to cause friction here than on mobile.

### Endpoint

```
POST https://api.windyword.com/v1/license/heartbeat
Headers:
  Authorization: Bearer <licenseToken>
  X-Device-Fingerprint: <deviceHash>
  X-App-Version: <version>
  X-Platform: desktop-electron

Response 200:
{
  "valid": true,
  "tier": "ultra",
  "graceHours": 336,
  "nextCheck": "2026-03-21T02:00:00Z",
  "pairsEntitled": 25
}

Response 200 (revoked):
{
  "valid": false,
  "reason": "refund_processed",
  "action": "revoke_models"
}

Response 5xx / timeout:
  → Treat as "offline", decrement grace period
```

---

## Layer 3: Refund Webhooks (Stripe — Desktop Only)

### Difference from Mobile
Mobile uses RevenueCat (Apple/Google IAP). Desktop purchases go through **Stripe directly**. Different webhook, same outcome.

### Stripe Webhook Events to Handle

| Event | Action |
|-------|--------|
| `charge.refunded` | Flag license, revoke on next heartbeat |
| `charge.dispute.created` | Immediate flag + revoke |
| `customer.subscription.deleted` | Downgrade tier, lock excess models |
| `invoice.payment_failed` | Grace period (3 retry attempts over 7 days, then revoke) |

### Webhook Handler

```
POST https://api.windyword.com/webhooks/stripe

On refund:
1. Look up license by Stripe customer ID
2. Set license.status = "revoked"
3. Set license.revokedAt = now()
4. Set license.revokeReason = "refund" | "dispute" | "payment_failed"
5. Invalidate cached encryption key on server side
6. Next heartbeat from any device → receives "valid: false" → models wiped
```

### Timing
- Stripe refund → webhook fires within seconds
- Desktop app heartbeat → checks within 48 hours max
- Worst case: user has 48 hours of access post-refund
- With encrypted models, those 48 hours don't matter — they can't extract usable files anyway

---

## Layer 4: Model Watermarking (Future — implement at scale)

### What It Is
Each downloaded model gets a micro-modification unique to the buyer's license. Invisible to model performance, forensically traceable.

### Technique: LSB Weight Fingerprinting
- Modify the least significant bits of select weight tensors
- Encode a hash of the license ID into the weight pattern
- Detection: given a suspected leaked model, extract the LSB pattern → recover the license hash → identify the leaker

### When to Implement
- Not needed until 10K+ customers or first confirmed leak on a torrent site
- Estimated effort: 2-3 days for the fingerprinting pipeline
- Can be applied retroactively to already-downloaded models via a background re-encryption pass

### Desktop Relevance
**Higher priority on desktop than mobile.** Desktop users can more easily extract and redistribute files. When you implement this, do desktop first.

---

## Implementation Priority & Timeline

| Layer | Effort | Priority | Dependencies |
|-------|--------|----------|-------------|
| 1. Encrypted Models | 2-3 days | **P0 — before launch** | Device fingerprint lib, safeStorage |
| 2. License Heartbeat | 1-2 days | **P0 — before launch** | License server endpoint |
| 3. Stripe Webhooks | 1 day | **P1 — launch week** | Stripe account configured |
| 4. Model Watermarking | 2-3 days | P3 — at scale | Fingerprinting pipeline |

**Total for launch-critical (Layers 1-3): ~4-6 days**

---

## Config Flags

These flags are remotely configurable via the license server response or local config:

```json
{
  "protection": {
    "encryptModels": true,
    "heartbeatIntervalHours": 48,
    "gracePeriods": {
      "free": 24,
      "pro": 168,
      "ultra": 336,
      "max": 720,
      "marcoPolo": 720
    },
    "revokeOnRefund": true,
    "deleteOnRevoke": true,
    "watermarkEnabled": false
  }
}
```

---

## Shared Infrastructure (Desktop + Mobile)

The following components are **shared** between desktop and mobile — build once, use everywhere:

| Component | Shared? | Notes |
|-----------|---------|-------|
| License server API | ✅ | Same endpoints, different `X-Platform` header |
| Heartbeat endpoint | ✅ | Identical protocol |
| Encryption algorithm | ✅ | Same AES-256-GCM, same key derivation |
| Device fingerprinting | ❌ | Platform-specific (Electron vs React Native) |
| Payment webhooks | ❌ | Desktop=Stripe, Mobile=RevenueCat+Stripe |
| Key storage | ❌ | Desktop=safeStorage, Mobile=Keychain/Keystore |
| Watermarking pipeline | ✅ | Server-side, platform-agnostic |

---

## What This Does NOT Protect Against

- Jailbroken/rooted devices with kernel-level memory inspection
- Nation-state level reverse engineering
- Someone who extracts decrypted weights from RAM during model inference

**This is acceptable.** These attacks require significant technical skill and effort. The people capable of this represent <0.01% of users and were never going to pay. Every DRM system in history (Netflix, Spotify, Adobe, Steam) accepts this tradeoff.

**The goal is not perfect security. The goal is making theft harder than paying.**

---

_This spec should be read alongside the mobile MODEL_PROTECTION_SPEC.md (windy-pro-mobile repo) and BRAND-ARCHITECTURE.md (both repos)._
