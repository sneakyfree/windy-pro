/**
 * Cloud routes — phone provisioning, phone release, push notifications.
 *
 * Each endpoint activates when the required third-party credentials are
 * configured (Twilio for phone, FCM for push). Without credentials,
 * endpoints return a dev-stub success so callers don't crash.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── POST /api/v1/cloud/phone/provision ──────────────────────
//
// Provision a phone number via Twilio Incoming Phone Numbers API.
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
//
router.post('/phone/provision', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { areaCode, country } = req.body || {};

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            console.log(`[cloud] Phone provision (dev stub) for user ${userId.slice(0, 8)}`);
            return res.json({
                provisioned: false,
                stub: true,
                message: 'Phone provisioning not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
                phoneNumber: null,
            });
        }

        try {
            const twilio = require('twilio');
            const client = twilio(accountSid, authToken);

            // Search for available numbers
            const searchParams: any = {};
            if (areaCode) searchParams.areaCode = areaCode;
            if (country) searchParams.country = country;
            else searchParams.country = 'US';

            const available = await client.availablePhoneNumbers(searchParams.country)
                .local.list({ ...searchParams, limit: 1 });

            if (!available || available.length === 0) {
                return res.status(404).json({
                    error: 'No phone numbers available',
                    message: 'No numbers found matching criteria. Try a different area code or country.',
                });
            }

            // Purchase the first available number
            const purchased = await client.incomingPhoneNumbers.create({
                phoneNumber: available[0].phoneNumber,
            });

            console.log(`📞 Phone provisioned: ${purchased.phoneNumber} for user ${userId.slice(0, 8)}`);

            res.json({
                provisioned: true,
                phoneNumber: purchased.phoneNumber,
                phoneSid: purchased.sid,
                friendlyName: purchased.friendlyName,
            });
        } catch (err: any) {
            console.error('[cloud] Twilio provision error:', err.message);
            res.status(502).json({ error: 'Phone provisioning failed' });
        }
    } catch (err: any) {
        console.error('[cloud] Phone provision error:', err);
        res.status(500).json({ error: 'Phone provisioning failed' });
    }
});

// ─── POST /api/v1/cloud/phone/release ────────────────────────
//
// Release a provisioned phone number. Requires phoneSid in body.
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//
router.post('/phone/release', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { phoneSid } = req.body || {};

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            console.log(`[cloud] Phone release (dev stub) for user ${userId.slice(0, 8)}`);
            return res.json({
                released: false,
                stub: true,
                message: 'Phone release not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
            });
        }

        if (!phoneSid) {
            return res.status(400).json({ error: 'phoneSid is required' });
        }

        try {
            const twilio = require('twilio');
            const client = twilio(accountSid, authToken);

            await client.incomingPhoneNumbers(phoneSid).remove();

            console.log(`📞 Phone released: ${phoneSid} for user ${userId.slice(0, 8)}`);

            res.json({
                released: true,
                phoneSid,
            });
        } catch (err: any) {
            console.error('[cloud] Twilio release error:', err.message);
            res.status(502).json({ error: 'Phone release failed' });
        }
    } catch (err: any) {
        console.error('[cloud] Phone release error:', err);
        res.status(500).json({ error: 'Phone release failed' });
    }
});

// ─── POST /api/v1/cloud/push/send ───────────────────────────
//
// Send a push notification. Uses FCM HTTP v1 API when FCM_SERVER_KEY
// is configured, otherwise returns a dev stub.
//
router.post('/push/send', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { token, title, body, data } = req.body || {};

        const fcmKey = process.env.FCM_SERVER_KEY;

        if (!fcmKey) {
            console.log(`[cloud] Push send (dev stub) for user ${userId.slice(0, 8)}: ${title || '(no title)'}`);
            return res.json({
                sent: false,
                stub: true,
                message: 'Push notifications not configured. Set FCM_SERVER_KEY.',
            });
        }

        if (!token) {
            return res.status(400).json({ error: 'Device push token is required' });
        }
        if (!title && !body) {
            return res.status(400).json({ error: 'At least one of title or body is required' });
        }

        try {
            const payload: any = {
                to: token,
                notification: {},
            };
            if (title) payload.notification.title = title;
            if (body) payload.notification.body = body;
            if (data && typeof data === 'object') payload.data = data;

            const fcmRes = await fetch('https://fcm.googleapis.com/fcm/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `key=${fcmKey}`,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            });

            if (!fcmRes.ok) {
                const errText = await fcmRes.text();
                console.warn(`[cloud] FCM returned ${fcmRes.status}: ${errText}`);
                return res.status(502).json({ error: 'Push notification delivery failed' });
            }

            // FCM legacy v1 response shape: { success: number, failure: number,
            // results: [{ message_id?: string, error?: string }, ...] }.
            // .json() returns `unknown` in recent TS so we narrow to a minimal
            // shape — these are the only fields we read.
            const result = (await fcmRes.json()) as {
                success?: number;
                failure?: number;
                results?: Array<{ message_id?: string; error?: string }>;
            };
            console.log(`🔔 Push sent to user ${userId.slice(0, 8)}: ${title || '(no title)'}`);

            res.json({
                sent: true,
                success: result.success || 0,
                failure: result.failure || 0,
                messageId: result.results?.[0]?.message_id || null,
            });
        } catch (err: any) {
            console.error('[cloud] FCM send error:', err.message);
            res.status(502).json({ error: 'Push notification delivery failed' });
        }
    } catch (err: any) {
        console.error('[cloud] Push send error:', err);
        res.status(500).json({ error: 'Push notification failed' });
    }
});

export default router;
