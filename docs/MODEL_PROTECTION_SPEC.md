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

## Layer 1: Encrypted Model Files (CRITICAL — implement first)

### Why This Matters More on Desktop
Mobile OSes sandbox app data — users can't browse to model files without jailbreaking. On desktop, users can navigate directly to the model directory and copy `.bin` files. **Encryption is non-negotiable for desktop.**

### Implementation

**Key Derivation:**
```
decryptionKey = HKDF-SHA256(
  ikm: licenseToken,
  salt: deviceFingerprint,
  info: APP_SECRET + "windy-model-v1"
)
```

**Device Fingerprint (Desktop):**
Combine at least 3 of:
- Machine UUID (`/etc/machine-id` on Linux, `IOPlatformUUID` on macOS, `MachineGuid` on Windows)
- CPU model string
- Primary disk serial number
- OS install date

Use a hash of the combination — tolerant of minor hardware changes but unique enough to bind to a specific machine.

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
| Free | 24 hours | Minimal investment, minimal trust |
| Pro ($99) | 7 days | Standard grace |
| Ultra ($199) | 14 days | Higher trust |
| Max ($299) | 30 days | Premium customer |
| Marco Polo ($999) | 30 days | VIP — treat with maximum respect |

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
