/**
 * HatchCard — Dashboard hero card that opens the hatch ceremony.
 *
 * Two states:
 *   1. No hatch yet  → "Hatch Your Helper" CTA → navigates to /hatch
 *   2. Already hatched → "Your helper is ready" + "Open" → navigates to
 *      /app/fly (with dm_room_id if we saved one)
 *
 * Ported from src/client/desktop/renderer/hatch-ceremony.js::mountCard.
 * State read from localStorage via utils/hatchStorage.
 */
import { useNavigate } from 'react-router-dom'
import { getHatchedAt, loadSavedHatch } from '../utils/hatchStorage'

export default function HatchCard() {
    const navigate = useNavigate()
    const hatchedAt = getHatchedAt()
    const saved = hatchedAt ? loadSavedHatch() : null

    const alreadyHatched = !!hatchedAt
    const agentName = saved?.agent_name
    const dmRoomId = saved?.dm_room_id

    // Condition each claim on the actual provisioned artifact so the banner
    // doesn't over-claim when a hatch was partial (e.g. Eternitas failed —
    // no passport_number was saved, so don't claim "an identity" exists).
    const hasIdentity = !!saved?.passport_number
    const hasChat = !!dmRoomId
    const hasEmail = !!(saved?.agent_email || saved?.email)
    const claims = []
    if (hasEmail) claims.push('an email')
    if (hasChat) claims.push('a chat room')
    if (hasIdentity) claims.push('an identity')

    function joinClaims(list) {
        if (list.length === 0) return ''
        if (list.length === 1) return list[0]
        if (list.length === 2) return `${list[0]} and ${list[1]}`
        return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
    }

    const title = alreadyHatched ? 'Your helper is ready' : 'Hatch Your Helper'
    const sub = alreadyHatched
        ? (claims.length > 0
            ? (agentName
                ? `Say hi to ${agentName} — it already has ${joinClaims(claims)}.`
                : `Say hi — it already has ${joinClaims(claims)}.`)
            : (agentName
                ? `Say hi to ${agentName}. Some pieces are still provisioning — check the dashboard tiles below.`
                : 'Say hi. Some pieces are still provisioning — check the dashboard tiles below.'))
        : 'In about 30 seconds, your own AI helper is ready. No setup. No fiddling.'
    const cta = alreadyHatched ? 'Open' : 'Hatch'

    const handleClick = () => {
        if (alreadyHatched) {
            const qs = dmRoomId ? `?dm_room_id=${encodeURIComponent(dmRoomId)}` : ''
            navigate(`/app/fly${qs}`)
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
