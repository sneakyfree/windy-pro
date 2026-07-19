/**
 * windy.panel.v1 client — the hub's thin wrapper over the agent control-panel
 * API (DASHBOARD_API_CONTRACT.md §4).
 *
 * The panel API lives on chat.windychat.ai, NOT this origin — so this uses
 * the absolute PANEL_BASE with the hub JWT as a Bearer, never the relative
 * same-origin apiFetch helper. Auth is the same account-server token; the
 * panel service verifies it against the account-server JWKS.
 *
 * Every call resolves to { status, data } — callers branch on status
 * (404 no_agent → hatch CTA, 501 → absent capability) instead of throwing,
 * so the panel can always render an honest state.
 */
import { PANEL_BASE } from './panelContract'

async function panelFetch(path, options = {}) {
    const token = localStorage.getItem('windy_token')
    let res
    try {
        res = await fetch(`${PANEL_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...options.headers,
            },
        })
    } catch {
        // Network failure — distinct from any HTTP answer.
        return { status: 0, data: null }
    }
    let data = null
    try { data = await res.json() } catch { /* non-JSON body */ }
    return { status: res.status, data }
}

export function getPanelSummary() {
    return panelFetch('/summary')
}

export function getSlidersInfo() {
    return panelFetch('/sliders/info')
}

export function putSlider(name, value, updatedBy) {
    return panelFetch(`/sliders/${name}`, {
        method: 'PUT',
        body: JSON.stringify(updatedBy ? { value, updated_by: updatedBy } : { value }),
    })
}

export function getPersonalityHistory(limit = 20) {
    return panelFetch(`/personality/history?limit=${limit}`)
}
