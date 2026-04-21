/**
 * Hatch ceremony — localStorage persistence.
 *
 * Ported from src/client/desktop/renderer/hatch-ceremony.js (_loadSaved /
 * _saveState). Keys match the desktop client so a user bouncing between
 * surfaces sees a consistent "your helper is ready" state.
 *
 * Storage shape:
 *   windy_agent_hatched_at  — ISO string, presence flips HatchCard into
 *                             "Your helper is ready" mode on next login.
 *   windy_agent_saved       — JSON: {
 *                               hatched_at, passport_number, dm_room_id,
 *                               agent_name, certificate
 *                             }
 */

const HATCHED_AT_KEY = 'windy_agent_hatched_at'
const SAVED_KEY = 'windy_agent_saved'

export function loadSavedHatch() {
    try {
        const raw = localStorage.getItem(SAVED_KEY)
        if (!raw) return null
        return JSON.parse(raw)
    } catch {
        return null
    }
}

export function getHatchedAt() {
    try {
        return localStorage.getItem(HATCHED_AT_KEY) || null
    } catch {
        return null
    }
}

export function isHatched() {
    return !!getHatchedAt()
}

export function saveHatchState(partial) {
    try {
        const prev = loadSavedHatch() || {}
        const next = { ...prev, ...partial }
        localStorage.setItem(SAVED_KEY, JSON.stringify(next))
        if (partial && partial.hatched_at) {
            localStorage.setItem(HATCHED_AT_KEY, partial.hatched_at)
        }
        return next
    } catch {
        return null
    }
}

export function clearHatchState() {
    try {
        localStorage.removeItem(HATCHED_AT_KEY)
        localStorage.removeItem(SAVED_KEY)
    } catch {
        /* noop */
    }
}
