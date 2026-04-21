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

    const title = alreadyHatched ? 'Your helper is ready' : 'Hatch Your Helper'
    const sub = alreadyHatched
        ? agentName
            ? `Say hi to ${agentName} — it already has an email, a chat room, and an identity.`
            : 'Say hi — it already has an email, a chat room, and an identity.'
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
