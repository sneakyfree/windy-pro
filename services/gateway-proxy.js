#!/usr/bin/env node
/**
 * Windy Pro API Gateway Proxy
 * Routes windypro.thewindstorm.uk traffic to the correct backend service.
 * 
 * /api/storage/*  → localhost:8099 (cloud-storage service)
 * /api/auth/*     → localhost:8098 (account server)  
 * /*              → localhost:8098 (account server, default)
 * /health         → gateway health check
 */

const http = require('http');
const PORT = process.env.GATEWAY_PORT || 8100;

// SEC-C5: Explicit CORS origin whitelist — no wildcards
const ALLOWED_ORIGINS = new Set([
  'https://windypro.thewindstorm.uk',
  'http://localhost:8098',
  'http://localhost:8099',
  'http://localhost:8100',
  'file://',  // Electron app
]);

function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  // Allow Electron file:// origins (sent as 'file://' by Chromium)
  if (requestOrigin.startsWith('file://')) return requestOrigin;
  return null;
}

const ROUTES = [
  { prefix: '/api/storage', target: 8099, strip: '/api/storage' },
  { prefix: '/api/auth', target: 8098 },
  { prefix: '/health', handler: healthCheck },
];
const DEFAULT_TARGET = 8098;

function healthCheck(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'windypro-gateway',
    routes: {
      '/api/auth/*': 'localhost:8098',
      '/api/storage/*': 'localhost:8099',
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  }));
}

function proxy(req, res, targetPort, stripPrefix) {
  const path = stripPrefix && req.url.startsWith(stripPrefix) 
    ? req.url.slice(stripPrefix.length) || '/' 
    : req.url;
  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: path,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
    timeout: 30000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // SEC-C5: Reflect allowed origin instead of wildcard
    const headers = { ...proxyRes.headers };
    const allowedOrigin = getCorsOrigin(req.headers.origin);
    if (allowedOrigin) {
      headers['access-control-allow-origin'] = allowedOrigin;
      headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      headers['access-control-allow-headers'] = 'Content-Type, Authorization';
      headers['access-control-allow-credentials'] = 'true';
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error → :${targetPort}${req.url}:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend unavailable', target: targetPort }));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend timeout', target: targetPort }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const allowedOrigin = getCorsOrigin(req.headers.origin);
    if (!allowedOrigin) {
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(204, {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  // Route matching
  for (const route of ROUTES) {
    if (req.url.startsWith(route.prefix)) {
      if (route.handler) return route.handler(req, res);
      return proxy(req, res, route.target, route.strip);
    }
  }

  // Default: account server
  proxy(req, res, DEFAULT_TARGET);
});

server.listen(PORT, () => {
  console.log(`🌪️  Windy Pro API Gateway on http://localhost:${PORT}`);
  console.log(`   /api/auth/*    → :8098 (account server)`);
  console.log(`   /api/storage/* → :8099 (cloud storage)`);
  console.log(`   /health        → gateway status`);
});
