// Windy Pro — Service Worker for PWA offline shell v2
const CACHE_NAME = 'windy-pro-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg'
];

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Windy Pro — Offline</title>
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
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
</style></head>
<body>
    <div class="icon">🌪️</div>
    <h1>You're Offline</h1>
    <p>Windy Pro needs an internet connection for cloud features. Your local desktop app works offline!</p>
    <button onclick="location.reload()">Try Again</button>
</body></html>`;

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches + take control immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for API, stale-while-revalidate for static
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip WebSocket, non-GET, and API calls
    if (request.method !== 'GET' || request.url.includes('/ws/') || request.url.includes('/api/')) {
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
