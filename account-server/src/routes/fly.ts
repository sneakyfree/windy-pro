/**
 * Fly routes — proxy chat messages to the agent gateway.
 *
 * POST /api/v1/fly/chat — send a message to the user's agent
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/chat', authenticateToken, async (req: Request, res: Response) => {
    try {
        const { message } = req.body;
        const userId = (req as AuthRequest).user.userId;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'message is required' });
        }

        const agentUrl = process.env.WINDYFLY_GATEWAY_URL || 'http://localhost:3000';

        try {
            const resp = await fetch(`${agentUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, user_id: userId }),
                signal: AbortSignal.timeout(15000),
            });
            const data = await resp.json();
            res.json(data);
        } catch {
            res.json({
                response: "Your agent is offline. Start it with 'windy start' on your computer, or hatch a new one at windyfly.ai.",
                offline: true,
            });
        }
    } catch (err: any) {
        res.status(500).json({ error: 'Chat proxy failed' });
    }
});

export default router;
