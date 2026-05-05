/**
 * Cloudflare Pages single-file Worker — Windy Pro web SPA.
 *
 * Why this exists:
 *   The SPA's bundled fetch() calls all use relative paths like
 *   /api/v1/auth/register. Cloudflare Pages serves only static assets,
 *   so without this worker those API calls fall through to the SPA's
 *   404 fallback (returning the index.html shell with HTTP 200) and
 *   silently break — the form submits, the user sees a hang or weird
 *   error, no signup ever lands.
 *
 *   This worker intercepts /api/v1/* on the same origin (app.windyword.ai),
 *   forwards them to the real account-server at account.windyword.ai
 *   while preserving method, headers, and body, and lets every other
 *   request fall through to the static asset bundle.
 *
 *   Same-origin is preserved (no CORS preflight cost on every request),
 *   and we don't need to rebuild the SPA's hardcoded API base URLs.
 *
 * Routing:
 *   /api/v1/*   → reverse-proxy to https://account.windyword.ai/api/v1/*
 *   everything else → env.ASSETS.fetch (the static SPA bundle)
 *
 * Operator notes:
 *   - account.windyword.ai is the windy-pro account-server, deployed
 *     2026-05-05 to the windy-mail EC2 box (54.88.113.79). See lockbox.
 *   - account-server's CORS_ALLOWED_ORIGINS must include
 *     https://app.windyword.ai so direct-from-browser calls work too
 *     (already configured 2026-05-05).
 *   - Tweak ACCOUNT_SERVER_ORIGIN below if the backend hostname ever
 *     changes (e.g. moves to account.windypro.com).
 */

const ACCOUNT_SERVER_ORIGIN = 'https://account.windyword.ai';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/v1/')) {
      // Forward to the real backend. Preserve path + query verbatim;
      // copy method/headers/body via the Request constructor so streaming
      // bodies (POST /auth/register etc.) pass through untouched.
      const target = ACCOUNT_SERVER_ORIGIN + url.pathname + url.search;
      const proxied = new Request(target, request);
      // Strip cookies the SPA never sends (none today, but cheap insurance
      // against accidentally leaking app.windyword.ai cookies upstream).
      proxied.headers.delete('cookie');
      // X-Forwarded-* so the upstream knows the original host (account-server
      // honors TRUST_PROXY=1 and reads these for rate-limit + IP attribution).
      proxied.headers.set('x-forwarded-host', url.hostname);
      proxied.headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
      return fetch(proxied);
    }

    // Everything else: static SPA bundle (index.html, /assets/*, favicon, etc.)
    return env.ASSETS.fetch(request);
  },
};
