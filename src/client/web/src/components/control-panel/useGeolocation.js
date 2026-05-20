import { useState, useEffect } from 'react'

// Lightweight geolocation hook for the Control Panel views.
//
// Approach: fetch the viewer's approximate location from a free IP→geo
// service. No browser geolocation permission prompt — city-level accuracy
// is fine for the "where is this machine" display, and we don't want the
// dashboard to fire a permission dialog just to render a header.
//
// Result is cached in localStorage with a 24h TTL so we don't hit the
// service on every page load. If the service is blocked (ad-blocker is
// the common case) or returns an error, the hook returns a clean
// `{ city: null, region: null, country: null, status: 'unavailable' }`
// and views render a "—" instead.
//
// Future v2: have the backend proxy this — keeps the user's IP from
// hitting ipapi directly and works in air-gapped deployments. For now
// the cost of a third-party call from the browser is acceptable for
// the dev-tool use case.

const CACHE_KEY = 'windy_control_panel_geo_v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

function loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed?.cached_at) return null
        if (Date.now() - parsed.cached_at > CACHE_TTL_MS) return null
        return parsed
    } catch {
        return null
    }
}

function saveCache(geo) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            ...geo,
            cached_at: Date.now(),
        }))
    } catch { /* localStorage may be unavailable / full — silently ignore */ }
}

export function useGeolocation() {
    const [geo, setGeo] = useState(() => {
        const cached = loadCache()
        if (cached) return { ...cached, status: 'cached' }
        return { city: null, region: null, country: null, ip: null, status: 'loading' }
    })

    useEffect(() => {
        // If we have a fresh cache hit, don't re-fetch
        if (geo.status === 'cached') return

        let cancelled = false
        async function fetchGeo() {
            try {
                const res = await fetch('https://ipapi.co/json/', {
                    headers: { 'Accept': 'application/json' },
                })
                if (!res.ok) throw new Error(`ipapi ${res.status}`)
                const data = await res.json()
                if (cancelled) return
                const next = {
                    city: data.city || null,
                    region: data.region || data.region_code || null,
                    country: data.country_name || data.country || null,
                    ip: data.ip || null,
                    status: 'ok',
                }
                setGeo(next)
                saveCache(next)
            } catch {
                if (cancelled) return
                setGeo({ city: null, region: null, country: null, ip: null, status: 'unavailable' })
            }
        }
        fetchGeo()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return geo
}

// Helper for views — formats the geo object as a clean display string.
// Returns "—" when location is unknown so views can drop it inline.
export function formatLocation(geo) {
    if (!geo) return '—'
    if (geo.status === 'loading') return 'Detecting…'
    if (geo.city && geo.region) return `${geo.city}, ${geo.region}`
    if (geo.city) return geo.city
    if (geo.region) return geo.region
    if (geo.country) return geo.country
    return '—'
}
