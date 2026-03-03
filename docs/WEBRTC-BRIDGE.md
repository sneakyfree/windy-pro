# Windy Pro — WebRTC Phone-as-Camera Protocol

## Overview

The Phone-as-Camera bridge allows users to use their phone's camera as a webcam on desktop. It uses WebRTC for real-time video streaming with HTTP-based signaling through the account server.

---

## Signaling Flow

```
   Desktop (Initiator)                  Server                    Phone (Responder)
   ───────────────────                ──────────                ─────────────────────
         │                               │                              │
    1.   │ Generate session token        │                              │
         │ Display QR code               │                              │
         │                               │                              │
    2.   │                               │         Scan QR / enter code │
         │                               │◀─────────────────────────────│
         │                               │                              │
    3.   │ createOffer()                 │                              │
         │ setLocalDescription(offer)    │                              │
         │ POST /rtc/signal              │                              │
         │  { type: "offer",             │                              │
         │    token: "abc",              │                              │
         │    sdp: offer.sdp }           │                              │
         │──────────────────────────────▶│                              │
         │                               │                              │
    4.   │                               │  GET /rtc/signal?type=offer  │
         │                               │◀─────────────────────────────│
         │                               │  → returns { sdp: "..." }    │
         │                               │──────────────────────────────▶│
         │                               │                              │
    5.   │                               │  setRemoteDescription(offer) │
         │                               │  createAnswer()              │
         │                               │  setLocalDescription(answer) │
         │                               │                              │
    6.   │                               │  POST /rtc/signal            │
         │                               │  { type: "answer",           │
         │                               │    token: "abc",             │
         │                               │    sdp: answer.sdp }         │
         │                               │◀─────────────────────────────│
         │                               │                              │
    7.   │ GET /rtc/signal?type=answer   │                              │
         │──────────────────────────────▶│                              │
         │  ← { sdp, candidates }        │                              │
         │  setRemoteDescription(answer) │                              │
         │                               │                              │
    8.   │◀═══════════ WebRTC P2P ═══════▶│  (ICE negotiation)        │
         │           Video Stream         │                              │
         │                               │                              │
```

---

## ICE Negotiation

### STUN Servers

```javascript
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
```

### ICE Candidate Exchange

```javascript
// Desktop: collect ICE candidates
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    fetch('/api/v1/rtc/signal', {
      method: 'POST',
      body: JSON.stringify({
        type: 'ice-candidate',
        token: sessionToken,
        candidate: event.candidate
      })
    });
  }
};

// Phone: poll for candidates and add them
const { candidates } = await fetch(`/api/v1/rtc/signal?token=${token}&type=answer`);
for (const candidate of candidates) {
  await peerConnection.addIceCandidate(candidate);
}
```

### ICE Connection States

| State | Action |
|-------|--------|
| `new` | Initial state, not yet negotiating |
| `checking` | ICE agent is checking candidates |
| `connected` | At least one candidate pair is viable |
| `completed` | All candidates checked, best pair selected |
| `disconnected` | Connection temporarily lost |
| `failed` | ICE negotiation failed → show error |
| `closed` | Connection closed by either party |

---

## Codec Preferences

### Video

| Priority | Codec | Profile | Reason |
|----------|-------|---------|--------|
| 1 | VP9 | Profile 0 | Best quality:size ratio, wide support |
| 2 | VP8 | — | Fallback for older devices |
| 3 | H.264 | Baseline | iOS hardware encoding |

### Audio

| Priority | Codec | Reason |
|----------|-------|--------|
| 1 | Opus | Best at low bitrate |
| 2 | G.711 | Universal fallback |

### MediaRecorder Codec String

```javascript
const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
  ? 'video/webm;codecs=vp9,opus'
  : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
  ? 'video/webm;codecs=vp8,opus'
  : 'video/webm';
```

---

## MJPEG Fallback

If WebRTC fails (e.g., symmetric NAT, no TURN server), the phone can fall back to MJPEG streaming over HTTP:

```
Phone (MJPEG Server):
  1. Capture frames from camera at 15fps
  2. JPEG-encode each frame
  3. Serve as multipart/x-mixed-replace stream

Desktop (MJPEG Client):
  1. Connect to phone's MJPEG endpoint
  2. Display frames in <img> tag with src=stream URL
  3. Lower quality but works through any NAT
```

### Fallback Detection

```javascript
peerConnection.onconnectionstatechange = () => {
  if (peerConnection.connectionState === 'failed') {
    console.warn('[WebRTC] P2P failed, falling back to MJPEG');
    startMjpegFallback();
  }
};

// Timeout: if no connection in 15 seconds, try MJPEG
setTimeout(() => {
  if (peerConnection.connectionState !== 'connected') {
    startMjpegFallback();
  }
}, 15000);
```

---

## QR Code Format

The QR code encodes a JSON payload:

```json
{
  "action": "windy-pro-camera-link",
  "token": "a1b2c3d4e5f6",
  "server": "https://windypro.thewindstorm.uk",
  "version": 1
}
```

### QR Code URL Format

```
windypro://camera-link?token=a1b2c3d4e5f6&server=https://windypro.thewindstorm.uk
```

### Manual Code

For phones that can't scan QR codes, a 6-character alphanumeric code is displayed:

```
Token: a1b2c3d4e5f6
Manual code: A1B2C3 (first 6 chars, uppercase)
```

The phone enters this code, which the server uses to look up the full session token.

---

## Connection Quality Monitoring

```javascript
// Poll every 2 seconds
setInterval(async () => {
  const stats = await peerConnection.getStats();
  
  stats.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      const fps = report.framesPerSecond || 0;
      const width = report.frameWidth || 0;
      const height = report.frameHeight || 0;
      const bytesReceived = report.bytesReceived;
    }
    
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      const latency = report.currentRoundTripTime * 1000; // ms
    }
  });
}, 2000);
```

### Quality Indicators

| Metric | Good | Acceptable | Poor |
|--------|------|------------|------|
| Latency | <50ms | <150ms | >150ms |
| FPS | ≥25 | ≥15 | <15 |
| Resolution | ≥720p | ≥480p | <480p |

---

## Camera Switching

Desktop can request the phone to switch between front and back cameras:

```javascript
// Desktop sends switch request
await fetch('/api/v1/rtc/signal', {
  method: 'POST',
  body: JSON.stringify({
    type: 'switch-camera',
    token: sessionToken
  })
});

// Phone polls for switch request and applies
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: currentCamera === 'front' ? 'environment' : 'user' }
});
const [videoTrack] = stream.getVideoTracks();
const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
await sender.replaceTrack(videoTrack);
```

---

## Security

- **Session tokens** are UUIDv4, unpredictable
- **No auth required** on signaling endpoint (token-based isolation)
- **Sessions are ephemeral**: stored in memory, lost on server restart
- **Tokens expire**: sessions should be cleaned up after 30 minutes of inactivity
- **P2P connection**: video never passes through the server after signaling
