# Windy Pro — Mobile Sync Protocol

## Overview

The sync protocol ensures recordings made on any device (phone, tablet, desktop) are automatically available on the desktop "home base" with zero manual steps. It uses a polling-based architecture with offline queue support.

---

## Bundle Format

Every recording produces a standardized bundle:

```json
{
  "bundle_id": "550e8400-e29b-41d4-a716-446655440000",
  "duration_seconds": 127,
  "audio": {
    "format": "opus",
    "sample_rate": 48000,
    "channels": 1,
    "bitrate": 128000,
    "file": "550e8400.webm"
  },
  "video": {
    "format": "vp9",
    "resolution": "1080p",
    "fps": 30,
    "bitrate": 2500000,
    "camera": "front",
    "file": "550e8400.webm"
  },
  "transcript": {
    "language": "en",
    "text": "Full transcript text here",
    "segments": [
      {
        "start": 0.0,
        "end": 2.5,
        "text": "Hello, this is a test",
        "confidence": 0.97,
        "speaker": null
      }
    ],
    "word_count": 150,
    "engine": "whisper-large-v3"
  },
  "device": {
    "device_id": "IPHONE-ABC123",
    "device_name": "iPhone 15 Pro",
    "platform": "ios",
    "os_version": "17.3",
    "app_version": "2.0.0"
  },
  "sync_status": "local",
  "clone_training_ready": true,
  "created_at": "2026-03-02T20:00:00.000Z"
}
```

### Bundle States

| State | Description |
|-------|-------------|
| `local` | Saved on device only |
| `uploading` | Currently being uploaded |
| `uploaded` | Successfully uploaded to cloud |
| `cloud_synced` | Downloaded from cloud to local |
| `cloud_only` | Local copy deleted, exists in cloud |
| `upload_failed` | Upload failed, in retry queue |

---

## Upload Protocol

### Chunked Multipart Upload

```
POST /api/v1/recordings/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Fields:
  media: <binary file> (max 500MB)
  bundle_id: <uuid>
  duration_seconds: <int>
  has_video: <bool>
  video_resolution: <string>
  camera_source: <string>
  transcript_text: <string>
  transcript_segments: <json string>
  device_platform: <string>
  device_id: <string>
  device_name: <string>
  clone_training_ready: <bool>
```

### Upload Flow

```
1. Client creates FormData with bundle metadata + media file
2. POST to /api/v1/recordings/upload
3. Server stores file to disk (uploads/bundles/<timestamp>-<uuid>.webm)
4. Server inserts record into recordings table
5. Server returns { id, bundle_id, file_size }
6. Client updates local bundle: sync_status = "uploaded"
```

---

## Wi-Fi Detection Logic

Mobile devices should only sync when on Wi-Fi to preserve cellular data:

```javascript
// React Native / Expo
import NetInfo from '@react-native-community/netinfo';

const state = await NetInfo.fetch();
const shouldSync = state.isConnected &&
                   state.type === 'wifi' &&
                   !state.isInternetReachable === false;
```

### Sync Trigger Conditions

| Condition | Action |
|-----------|--------|
| Wi-Fi connected + internet reachable | Start sync immediately |
| Wi-Fi connected + no internet | Queue, retry in 30s |
| Cellular only | Queue, wait for Wi-Fi |
| Airplane mode | Queue, no retry |
| Wi-Fi disconnected during upload | Pause, resume on reconnect |

---

## Retry / Backoff Strategy

### Desktop (Auto-Sync Manager)

```
Interval:    5 minutes (300,000ms)
Max retries: 5 per upload
Backoff:     None (fixed 5-min interval)
Queue:       JSON file (~/.config/windy-pro/sync-state.json)
```

### Mobile

```
Initial delay:   0 (immediate on Wi-Fi)
Retry interval:  30s, 60s, 120s, 300s, 600s (exponential)
Max retries:     5
Queue:           AsyncStorage (React Native)
Resume:          On app foreground + Wi-Fi
```

### Upload Queue Entry

```json
{
  "bundle_id": "uuid",
  "queued_at": "2026-03-02T20:00:00Z",
  "retries": 0,
  "max_retries": 5,
  "last_error": null,
  "file_path": "/path/to/recording.webm"
}
```

---

## Conflict Resolution

### Rules

1. **Bundle ID is unique**: UUIDv4 generated on device. No duplicates possible.
2. **Server is source of truth**: If a bundle_id exists on server, skip re-upload.
3. **Last-write-wins for metadata**: If same bundle_id is uploaded from two devices (shouldn't happen), server keeps the latest.
4. **Download idempotent**: Downloading a bundle that already exists locally is a no-op (matched by bundle_id).

### Deduplication Check

```
Desktop polling:
  1. GET /api/v1/recordings/list?since=<lastSyncTimestamp>
  2. Get remote bundle_ids
  3. Get local bundle_ids from manifest
  4. new_bundles = remote - local
  5. Download only new_bundles
```

---

## Sync State Persistence

```json
// ~/.config/windy-pro/sync-state.json
{
  "lastSync": 1709424000000,
  "uploadQueue": [
    { "bundle_id": "uuid", "queued_at": "...", "retries": 2, "max_retries": 5 }
  ],
  "devices": {
    "IPHONE-ABC": {
      "name": "iPhone 15 Pro",
      "platform": "ios",
      "lastSync": "2026-03-02T22:00:00Z",
      "bundleCount": 15
    },
    "DESKTOP-XYZ": {
      "name": "MacBook Pro",
      "platform": "desktop",
      "lastSync": "2026-03-02T22:05:00Z",
      "bundleCount": 42
    }
  }
}
```

---

## Storage Management

### Local Storage Layout

```
~/.config/windy-pro/
├── clone-bundles/
│   ├── <uuid1>.webm
│   ├── <uuid2>.webm
│   └── ...
├── clone-bundles.json      (manifest)
├── sync-state.json          (sync state)
└── voice-clones.json        (voice clone metadata)
```

### Cleanup Operations

| Action | Effect |
|--------|--------|
| Delete local copy | Remove .webm file, set sync_status="cloud_only" |
| Full delete | Remove .webm + remove from manifest |
| Clean cloud-synced | Delete all local copies where sync_status="cloud_synced" |
