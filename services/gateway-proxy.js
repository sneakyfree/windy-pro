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
    // Add CORS headers for mobile app
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = 'Content-Type, Authorization';

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
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
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
