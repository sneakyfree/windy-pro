/**
 * GET /api/v1/me/fleet
 *
 * Returns the authenticated user's agents in the Fleet v1 shape
 * (windy.fleet.v1). Per ADR-054:
 *   - Tier-1 free users get `agents: []`.
 *   - Tier-2 credentialed users get one entry per `windy_fly`
 *     `product_account` row (Category 3 per ADR-050).
 *
 * The UNIQUE(identity_id, product) DB constraint means a user has at
 * most ONE windy_fly row today; the schema's array shape is intentional
 * forward-compat for multi-agent users.
 *
 * The `this_machine` block reflects what a SERVER-context caller can
 * assume: no local Vitals source, can't self-report, vitals_url
 * resolves to the SERVER's /api/v1/vitals. Electron hosts override the
 * block client-side with their own IPC bridge before passing the
 * payload to drop templates.
 *
 * Status mapping: account-server has no live heartbeat probe — an
 * `active` product row means "registered," not "running right now." We
 * report `unknown` rather than over-claiming `online`. A future
 * enhancement can fan out a gateway probe in parallel to upgrade
 * `unknown` → `online | offline`.
 *
 * WD-31 M-D.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { makeRateLimiter } from '../services/rate-limiter';
import { getDb } from '../db/schema';
import {
    type FleetV1,
    FLEET_V1_SCHEMA_ID,
} from '../contracts/control-panel';

const router = Router();

const limiter = makeRateLimiter('control-panel-fleet', {
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

function toIso(value: unknown): string {
    if (!value) return new Date().toISOString();
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value as string | number);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function parseMetadata(m: unknown): Record<string, unknown> {
    if (!m) return {};
    if (typeof m === 'object') return m as Record<string, unknown>;
    if (typeof m === 'string') {
        try {
            return JSON.parse(m);
        } catch {
            return {};
        }
    }
    return {};
}

function asString(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}

type FlyRow = {
    external_id: string | null;
    status: string;
    provisioned_at: string | Date;
    metadata: string | object | null;
};

router.get('/', limiter, authenticateToken, async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    let row: FlyRow | undefined;
    try {
        row = db
            .prepare(
                `SELECT external_id, status, provisioned_at, metadata
                 FROM product_accounts
                 WHERE identity_id = ? AND product = 'windy_fly'
                 LIMIT 1`,
            )
            .get(userId) as FlyRow | undefined;
    } catch (err: any) {
        console.error('[me-fleet] DB query failed', err?.message || err);
        return res.status(500).json({ error: 'fleet_query_failed' });
    }

    const agents: FleetV1['agents'] = [];

    // We only emit an agent row when external_id (bot user id) is present;
    // without it we can't honor the schema's `id: min(1)` requirement, and
    // surfacing a half-provisioned row would confuse templates more than
    // showing none at all.
    if (row && row.external_id) {
        const metadata = parseMetadata(row.metadata);
        const agentName = asString(metadata.agent_name) ?? 'Agent';
        const machineModel = asString(metadata.machine_model) ?? 'unknown';
        const provisionedAt = toIso(row.provisioned_at);
        const status: 'online' | 'offline' | 'unknown' =
            row.status === 'active' ? 'unknown' : 'offline';

        agents.push({
            id: row.external_id,
            name: agentName,
            callsign: asString(metadata.callsign),
            product: 'windy_fly',
            status,
            machine: {
                model: machineModel,
                location: null,
            },
            // Placeholder until per-agent VPS vitals land. Schema requires
            // min(1); renderer should tolerate 404s when probing this URL.
            vitals_url: `internal://agents/${row.external_id}/vitals`,
            auth: 'none',
            created_at: provisionedAt,
            last_heartbeat: asString(metadata.last_heartbeat)
                ? toIso(metadata.last_heartbeat as string)
                : provisionedAt,
        });
    }

    const fleet: FleetV1 = {
        schema: FLEET_V1_SCHEMA_ID,
        fetched_at: new Date().toISOString(),
        user_id: userId,
        this_machine: {
            // Server context: the API can't see the caller's box.
            is_user_device: false,
            can_self_report: false,
            // "internal" → call the account-server's /api/v1/vitals
            // (see Vitals v1 schema's `vitals_url` description).
            vitals_url: 'internal',
        },
        agents,
    };

    res.json(fleet);
});

export default router;
