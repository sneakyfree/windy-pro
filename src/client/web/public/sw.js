// Windy Pro — Service Worker for PWA offline shell v4
const CACHE_NAME = 'windy-pro-v4';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg',
    '/icon-192.png',
    '/icon-512.png'
];

const API_CACHE_NAME = 'windy-api-v1';
const API_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Windy Word — Offline</title>
<style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:#0B0F1A;color:#94A3B8;font-family:'Inter',-apple-system,sans-serif;text-align:center;padding:24px}
    .icon{font-size:64px;animation:float 3s ease-in-out infinite;margin-bottom:16px}
    h1{font-size:28px;color:#E2E8F0;margin-bottom:8px}
    p{font-size:16px;max-width:400px;line-height:1.5;margin-bottom:24px}
    button{background:#22C55E;color:#000;border:none;padding:12px 32px;border-radius:10px;font-size:15px;
        font-weight:700;cursor:pointer;transition:opacity 0.2s}
    button:hover{opacity:0.9}
    .cached-info{margin-top:24px;font-size:13px;color:#475569}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
</style></head>
<body>
    <div class="icon">🌪️</div>
    <h1>You're Offline</h1>
    <p>Windy Word needs an internet connection for cloud features. Your local desktop app works offline!</p>
    <button onclick="location.reload()">Try Again</button>
    <div class="cached-info">Some cached pages may still be available.</div>
</body></html>`;

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches + take control + notify clients to reload
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE_NAME).map((k) => caches.delete(k)))
            )
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))
            .then((clients) => clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME })))
    );
});

// Fetch: network-first for API, stale-while-revalidate for static
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip WebSocket and non-GET
    if (request.method !== 'GET' || url.pathname.startsWith('/ws/')) {
        return;
    }

    // API responses — cache with expiry for dashboard offline
    if (url.pathname.startsWith('/api/v1/recordings') || url.pathname.startsWith('/api/v1/user/history')) {
        event.respondWith(
            fetch(request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(API_CACHE_NAME).then((cache) => {
                        // Store with timestamp header for expiry check
                        const headers = new Headers(clone.headers);
                        headers.set('sw-cached-at', Date.now().toString());
                        cache.put(request, new Response(clone.body, { status: clone.status, headers }));
                    });
                }
                return response;
            }).catch(() => {
                // Serve cached API response if offline
                return caches.match(request).then((cached) => {
                    if (cached) {
                        const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
                        if (Date.now() - cachedAt < API_CACHE_MAX_AGE) {
                            return cached;
                        }
                    }
                    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
            })
        );
        return;
    }

    // Skip other API calls
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Navigation requests — network first, offline fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => new Response(OFFLINE_PAGE, {
                headers: { 'Content-Type': 'text/html' }
            }))
        );
        return;
    }

    // Static assets — stale-while-revalidate
    event.respondWith(
        caches.match(request).then((cached) => {
            const fetchPromise = fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
