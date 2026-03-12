/**
 * Windy Chat — Push Notification Gateway
 * K6: Push Notifications (DNA Strand K)
 *
 * Matrix push gateway that receives events from Synapse and forwards
 * to FCM (Android) and APNs (iOS).
 *
 * K6.1 Matrix Push Gateway (receives POST /_matrix/push/v1/notify)
 * K6.2 Firebase Cloud Messaging (Android)
 * K6.3 Apple Push Notification Service (iOS)
 * K6.4 Per-conversation mute
 *
 * Port: 8103
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8103;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── In-memory stores (replace with Redis/DB in production) ──
const pushTokens = new Map();  // pushkey → { userId, platform, appId, token, deviceName }
const muteSettings = new Map();  // `${userId}:${roomId}` → { mutedUntil, mentionOverride }

// ── FCM / APNs setup ──

let fcmApp = null;
let apnProvider = null;

function initFCM() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountPath) {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not set — FCM pushes will be stubbed');
    return;
  }
  try {
    const admin = require('firebase-admin');
    const serviceAccount = require(serviceAccountPath);
    fcmApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('🔥 FCM initialized');
  } catch (err) {
    console.error('FCM init error:', err.message);
  }
}

function initAPNs() {
  const keyPath = process.env.APNS_KEY_PATH;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;

  if (!keyPath || !keyId || !teamId) {
    console.warn('⚠️  APNs not configured — iOS pushes will be stubbed');
    return;
  }
  try {
    const apn = require('apn');
    apnProvider = new apn.Provider({
      token: { key: keyPath, keyId, teamId },
      production: process.env.NODE_ENV === 'production',
    });
    console.log('🍎 APNs initialized');
  } catch (err) {
    console.error('APNs init error:', err.message);
  }
}

// ── K6.1: Matrix Push Gateway endpoint ──
// Synapse sends POST /_matrix/push/v1/notify with notification payload

app.post('/_matrix/push/v1/notify', async (req, res) => {
  try {
    const { notification } = req.body;

    if (!notification) {
      return res.status(400).json({ rejected: [] });
    }

    const {
      room_id,
      event_id,
      sender,
      sender_display_name,
      type,
      prio,
      devices,
      counts,
    } = notification;

    const rejected = [];

    for (const device of (devices || [])) {
      const { pushkey, app_id } = device;

      // Check mute settings
      const tokenEntry = pushTokens.get(pushkey);
      if (tokenEntry) {
        const muteKey = `${tokenEntry.userId}:${room_id}`;
        const mute = muteSettings.get(muteKey);
        if (mute && mute.mutedUntil > Date.now()) {
          // Check mention override
          const isMention = type === 'm.room.message' && notification.content?.body?.includes('@');
          if (!mute.mentionOverride || !isMention) {
            continue; // Skip — muted
          }
        }
      }

      // K6.1.3: Privacy — strip message content
      const title = sender_display_name || sender || 'Windy Chat';
      const body = 'New message'; // Never leak content in notification
      const badge = counts?.unread || 0;

      // Route to FCM or APNs based on pushkey/app_id
      const platform = tokenEntry?.platform || (app_id?.includes('ios') ? 'ios' : 'android');

      if (platform === 'ios') {
        const result = await sendAPNs(pushkey, { title, body, badge, roomId: room_id, eventId: event_id });
        if (!result.success) rejected.push(pushkey);
      } else {
        const result = await sendFCM(pushkey, { title, body, badge, roomId: room_id, eventId: event_id });
        if (!result.success) rejected.push(pushkey);
      }
    }

    // Matrix spec: return { rejected: [...pushkeys that failed] }
    res.json({ rejected });

  } catch (err) {
    console.error('Push notify error:', err);
    res.status(500).json({ rejected: [] });
  }
});

// ── K6.2: FCM (Android) ──

async function sendFCM(pushkey, payload) {
  if (!fcmApp) {
    console.log(`📱 [STUB] FCM → ${pushkey.slice(0, 12)}...: ${payload.title} — ${payload.body}`);
    return { success: true, stub: true };
  }

  try {
    const admin = require('firebase-admin');
    const message = {
      token: pushkey,
      data: {
        room_id: payload.roomId || '',
        event_id: payload.eventId || '',
        type: 'chat_message',
      },
      notification: {
        title: payload.title,
        body: payload.body,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          sound: 'default',
          defaultVibrateTimings: true,
          notificationCount: payload.badge,
        },
      },
    };

    await admin.messaging().send(message);
    console.log(`📱 FCM sent to ${pushkey.slice(0, 12)}...`);
    return { success: true };
  } catch (err) {
    console.error('FCM send error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── K6.3: APNs (iOS) ──

async function sendAPNs(pushkey, payload) {
  if (!apnProvider) {
    console.log(`🍎 [STUB] APNs → ${pushkey.slice(0, 12)}...: ${payload.title} — ${payload.body}`);
    return { success: true, stub: true };
  }

  try {
    const apn = require('apn');
    const note = new apn.Notification();
    note.alert = { title: payload.title, body: payload.body };
    note.badge = payload.badge;
    note.sound = 'default';
    note.topic = process.env.APNS_BUNDLE_ID || 'com.windypro.chat';
    note.payload = { room_id: payload.roomId, event_id: payload.eventId };
    note.pushType = 'alert';
    note.priority = 10;

    const result = await apnProvider.send(note, pushkey);
    if (result.failed.length > 0) {
      return { success: false, error: result.failed[0].response?.reason || 'Unknown' };
    }
    console.log(`🍎 APNs sent to ${pushkey.slice(0, 12)}...`);
    return { success: true };
  } catch (err) {
    console.error('APNs send error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Push token registration ──

app.post('/api/v1/chat/push/register', (req, res) => {
  const { pushkey, userId, platform, appId, deviceName } = req.body;

  if (!pushkey || !userId || !platform) {
    return res.status(400).json({ error: 'pushkey, userId, and platform required' });
  }

  pushTokens.set(pushkey, {
    userId,
    platform,
    appId: appId || `com.windypro.chat.${platform}`,
    deviceName: deviceName || 'Unknown',
    registeredAt: Date.now(),
  });

  console.log(`🔔 Push token registered: ${platform} for ${userId.slice(0, 12)}`);
  res.status(201).json({ success: true });
});

// ── K6.4: Per-conversation mute ──

app.post('/api/v1/chat/push/mute', (req, res) => {
  const { userId, roomId, duration, mentionOverride } = req.body;

  if (!userId || !roomId) {
    return res.status(400).json({ error: 'userId and roomId required' });
  }

  const durations = {
    '1h': 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    'forever': 100 * 365 * 24 * 60 * 60 * 1000,
  };

  const ms = durations[duration] || durations['1h'];
  const muteKey = `${userId}:${roomId}`;

  muteSettings.set(muteKey, {
    mutedUntil: Date.now() + ms,
    mentionOverride: mentionOverride !== false,
  });

  res.json({ success: true, mutedUntil: new Date(Date.now() + ms).toISOString() });
});

app.post('/api/v1/chat/push/unmute', (req, res) => {
  const { userId, roomId } = req.body;
  muteSettings.delete(`${userId}:${roomId}`);
  res.json({ success: true });
});

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    service: 'windy-chat-push-gateway',
    status: 'ok',
    version: '1.0.0',
    fcm: !!fcmApp,
    apns: !!apnProvider,
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ──
initFCM();
initAPNs();

app.listen(PORT, () => {
  console.log(`🌪️  Windy Chat Push Gateway — listening on port ${PORT}`);
  console.log(`   Push: POST /_matrix/push/v1/notify`);
  console.log(`   FCM: ${fcmApp ? 'active' : 'stubbed'}`);
  console.log(`   APNs: ${apnProvider ? 'active' : 'stubbed'}`);
});

module.exports = app;
