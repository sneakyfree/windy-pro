#!/bin/sh
# Windy Pro — Production entrypoint
# Starts all 3 services: web, account-server, transcription API

set -e

echo "🌪️  Windy Pro — Starting production services..."

# Start account server (background)
cd /app/account-server
node server.js &
ACCOUNT_PID=$!
echo "   ✅ Account server started (PID $ACCOUNT_PID)"

# Start transcription API (background)
cd /app
python -m uvicorn src.cloud.api:app --host 0.0.0.0 --port 8000 --workers 2 &
TRANSCRIPTION_PID=$!
echo "   ✅ Transcription API started (PID $TRANSCRIPTION_PID)"

# Serve web frontend via simple Node server (foreground)
cd /app
node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');
const WEB_ROOT = '/app/web-dist';
const PORT = 3000;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
http.createServer((req, res) => {
  let filePath = path.join(WEB_ROOT, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) filePath = path.join(WEB_ROOT, 'index.html'); // SPA fallback
  const ext = path.extname(filePath);
  res.writeHead(200, {'Content-Type': MIME[ext]||'application/octet-stream'});
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => console.log('   ✅ Web server on port ' + PORT));
" &
WEB_PID=$!
echo "   ✅ Web frontend started (PID $WEB_PID)"

echo ""
echo "🌪️  All services running:"
echo "   Web:           http://localhost:3000"
echo "   Account API:   http://localhost:8098"
echo "   Transcription: http://localhost:8000"
echo ""

# Wait for any process to exit, then kill all
wait -n $ACCOUNT_PID $TRANSCRIPTION_PID $WEB_PID
EXIT_CODE=$?
echo "⚠️  Service exited with code $EXIT_CODE — shutting down..."
kill $ACCOUNT_PID $TRANSCRIPTION_PID $WEB_PID 2>/dev/null || true
exit $EXIT_CODE
