/**
 * Windy Pro Web Proxy
 * Port 5173 — serves static frontend + proxies /api/* to account-server (8098)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_DIR = path.join(__dirname, 'src/client/web/dist');
const API_HOST = '127.0.0.1';
const API_PORT = 8098;
const PORT = process.env.PORT || 5173;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function proxyToApi(req, res) {
  const opts = { hostname: API_HOST, port: API_PORT, path: req.url, method: req.method, headers: req.headers };
  const prx = http.request(opts, (apiRes) => {
    res.writeHead(apiRes.statusCode, apiRes.headers);
    apiRes.pipe(res);
  });
  prx.on('error', (e) => {
    console.error('API proxy error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    // SEC-H7: Don't expose internal error details to client
    res.end(JSON.stringify({ error: 'API server unavailable' }));
  });
  req.pipe(prx);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // Proxy API, WebSocket, health, and download endpoints
  if (url.startsWith('/api/') || url.startsWith('/ws/') || url === '/health' || url.startsWith('/download/')) {
    return proxyToApi(req, res);
  }
  // Serve static files
  let filePath = path.join(STATIC_DIR, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, 'index.html'); // SPA fallback
  const ext = path.extname(filePath);
  const fileName = path.basename(filePath);

  // Cache strategy:
  // - index.html, sw.js, manifest.json: NEVER cache (always fetch fresh)
  // - /assets/*.js, /assets/*.css (Vite hashed names): cache 1 year immutable
  // - everything else: revalidate every hour
  const noCacheFiles = ['index.html', 'sw.js', 'manifest.json'];
  let cacheControl;
  if (noCacheFiles.includes(fileName)) {
    cacheControl = 'no-cache, no-store, must-revalidate';
  } else if (url.startsWith('/assets/')) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else {
    cacheControl = 'public, max-age=3600';
  }

  // SEC-L3: Standard security headers on all static responses
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl,
    'Vary': 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '0',
  });
  fs.createReadStream(filePath).pipe(res);
});

// WebSocket upgrade proxy
server.on('upgrade', (req, socket, head) => {
  const opts = { hostname: API_HOST, port: API_PORT, path: req.url, headers: req.headers };
  const prx = http.request(opts);
  prx.on('upgrade', (apiRes, apiSocket, apiHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n`);
    Object.entries(apiRes.headers).forEach(([k, v]) => socket.write(`${k}: ${v}\r\n`));
    socket.write('\r\n');
    apiSocket.pipe(socket);
    socket.pipe(apiSocket);
  });
  prx.on('error', () => socket.destroy());
  prx.end();
});

server.listen(PORT, () => console.log(`🌐 Windy Pro web proxy → http://localhost:${PORT} (api→${API_PORT})`));
