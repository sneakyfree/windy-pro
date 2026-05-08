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
// RETIRED — push sending lives at the chat push-gateway now.
//
// This route used to call FCM's legacy HTTP API directly (sunset
// by Google on 2024-06-20). Per ADR-006, push registration moved
// to the chat-side push-gateway (chat.windychat.ai); push SENDING
// belongs there too via the cross-service push bus
// (POST /api/v1/push/notify, see services/push-gateway/server.js
// in sneakyfree/windy-chat).
//
// Kept as 501 Not Implemented so any straggling client gets a
// clear migration signal. GAP_ANALYSIS.md (line 46) already
// described this as the desired state — the actual code lagged.
//
router.post('/push/send', authenticateToken, (_req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not Implemented',
        moved_to: 'chat push-gateway POST /api/v1/push/notify',
        message: 'Push notification sending moved to the chat push-gateway per ADR-006. Publish to the cross-service push bus instead of calling account-server directly.',
    });
});

export default router;
