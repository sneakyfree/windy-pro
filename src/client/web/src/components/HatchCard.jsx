/**
 * HatchCard — Dashboard hero card that opens the hatch ceremony.
 *
 * Two states:
 *   1. No hatch yet  → "Hatch Your Helper" CTA → navigates to /hatch
 *   2. Already hatched → "Your helper is ready" + "Open" → navigates to
 *      /app/fly (with dm_room_id if we saved one)
 *
 * Source of truth for the "already hatched" decision is the server's
 * `/identity/ecosystem-status` response (passed in via the `ecosystem`
 * prop). Specifically: ecosystem.products.windy_fly.status === 'active'
 * means the operator has hatched an agent (Category 3 per ADR-050).
 *
 * localStorage is consulted only as a first-paint fallback before
 * the API response arrives — this avoids the "Open button shows but
 * agent doesn't exist server-side" stale-cache trap surfaced 2026-05-19
 * (task #75). Once `ecosystem` is non-null, the API answer always wins.
 *
 * Ported from src/client/desktop/renderer/hatch-ceremony.js::mountCard.
 */
import { useNavigate } from 'react-router-dom'
import { getHatchedAt, loadSavedHatch } from '../utils/hatchStorage'
import { openHandoff } from '../lib/ssoHandoff'

export default function HatchCard({ ecosystem = null }) {
    const navigate = useNavigate()

    // Derive hatched state — API-first, localStorage as first-paint fallback only.
    const flyProduct = ecosystem?.products?.windy_fly
    const apiHatched = flyProduct ? flyProduct.status === 'active' : null

    // First-paint fallback: before /identity/ecosystem-status returns,
    // ecosystem is null. Use localStorage to avoid a brief CTA flip on load.
    // Once the API response arrives, apiHatched (true|false) takes over.
    const hatchedAt = getHatchedAt()
    const saved = hatchedAt ? loadSavedHatch() : null
    const alreadyHatched = apiHatched === null ? !!hatchedAt : apiHatched

    // Agent name / room_id: prefer the API response's metadata when available,
    // fall back to localStorage. Stays graceful if either source is missing.
    const flyMeta = (() => {
        try {
            if (!flyProduct) return null
            // The endpoint flattens fly metadata into top-level fields
            // (matrix_user_id, agent_name, passport_number, room_id) per
            // routes/identity.ts:1356-1370.
            return {
                agent_name: flyProduct.agent_name,
                dm_room_id: flyProduct.room_id,
            }
        } catch { return null }
    })()
    const agentName = flyMeta?.agent_name || saved?.agent_name
    const dmRoomId = flyMeta?.dm_room_id || saved?.dm_room_id

    const title = alreadyHatched ? 'Your helper is ready' : 'Hatch Your Helper'
    const sub = alreadyHatched
        ? agentName
            ? `Say hi to ${agentName} — it already has an email, a chat room, and an identity.`
            : 'Say hi — it already has an email, a chat room, and an identity.'
        : 'In about 30 seconds, your own AI helper is ready. No setup. No fiddling.'
    const cta = alreadyHatched ? 'Open' : 'Hatch'

    const handleClick = () => {
        if (alreadyHatched) {
            // Send the user straight to app.windychat.ai where the agent
            // actually responds (windy-chat agent-roster service). The
            // in-product /app/fly panel is legacy — it polls Pro for a
            // local "runtime online" check that never comes up, and
            // grandma ends up staring at "Hatched — runtime offline."
            //
            // SSO handoff: the chat web app reads #token= (+ refreshToken=)
            // and calls /unified-login. The agent_room query param tells
            // ChatPage to auto-select the DM room with the agent. Minting a
            // fresh access+refresh pair keeps the chat session alive past
            // the 15-minute access token. Same-tab navigation, so the async
            // mint can simply precede the redirect.
            const search = dmRoomId ? `agent_room=${encodeURIComponent(dmRoomId)}` : undefined
            openHandoff('https://app.windychat.ai/', { newTab: false, search })
        } else {
            navigate('/hatch')
        }
    }

    return (
        <div className="hatch-card" role="region" aria-label="Your AI helper">
            <div className="hatch-card-art" aria-hidden="true">🪰</div>
            <div className="hatch-card-body">
                <div className="hatch-card-title">{title}</div>
                <div className="hatch-card-sub">{sub}</div>
            </div>
            <button
                type="button"
                className="hatch-card-cta"
                onClick={handleClick}
            >
                {cta}
            </button>
        </div>
    )
}
