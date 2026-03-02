/**
 * Windy Pro — Privacy-First Analytics (H8)
 * 
 * Lightweight, self-hosted event tracking.
 * No third-party scripts, no cookies, no PII collected.
 * 
 * Events are batched and sent to the account server's /api/v1/analytics endpoint.
 * Falls back gracefully if offline or if the endpoint is unavailable.
 */

const API_BASE = '/api/v1'
const BATCH_SIZE = 10
const FLUSH_INTERVAL = 30000 // 30s

class WindyAnalytics {
    constructor() {
        this.queue = []
        this.sessionId = this._generateSessionId()
        this.sessionStart = Date.now()
        this._flushTimer = null

        // Auto-flush on interval
        this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL)

        // Flush on page visibility change (user leaves tab)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flush()
        })

        // Track page view on load
        this.track('page_view', { path: window.location.pathname })
    }

    /**
     * Track an event
     * @param {string} event - Event name (e.g., 'recording_started', 'transcript_exported')
     * @param {object} props - Event properties (no PII!)
     */
    track(event, props = {}) {
        this.queue.push({
            event,
            props,
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            path: window.location.pathname,
            referrer: document.referrer ? new URL(document.referrer).hostname : '',
            screenWidth: window.innerWidth,
            userAgent: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'
        })

        if (this.queue.length >= BATCH_SIZE) {
            this.flush()
        }
    }

    /**
     * Track route navigation
     */
    trackPageView(path) {
        this.track('page_view', { path })
    }

    /**
     * Track a timed event (e.g., recording duration)
     */
    trackDuration(event, startTime, props = {}) {
        const duration = Math.round((Date.now() - startTime) / 1000)
        this.track(event, { ...props, duration_seconds: duration })
    }

    /**
     * Flush queued events to the server
     */
    async flush() {
        if (this.queue.length === 0) return

        const events = [...this.queue]
        this.queue = []

        try {
            const token = localStorage.getItem('windy_token')
            await fetch(`${API_BASE}/analytics`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    events,
                    sessionDuration: Math.round((Date.now() - this.sessionStart) / 1000)
                }),
                keepalive: true // Ensure delivery even if page is closing
            })
        } catch {
            // Re-queue on failure (but cap to prevent memory leak)
            if (this.queue.length + events.length < 200) {
                this.queue.push(...events)
            }
        }
    }

    /**
     * Clean up
     */
    destroy() {
        if (this._flushTimer) clearInterval(this._flushTimer)
        this.flush()
    }

    _generateSessionId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }
}

// Singleton instance
export const analytics = new WindyAnalytics()
export default analytics
