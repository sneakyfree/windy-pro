/**
 * Windy Pro v2.0 — Local Model Server (Development)
 * Serves real faster-whisper models as branded Windy Pro downloads.
 * Port 8099
 * 
 * Maps branded model IDs → real faster-whisper model directories:
 *   edge-spark    → faster-whisper-tiny   (73 MB)
 *   edge-pulse    → faster-whisper-tiny   (73 MB)  
 *   edge-standard → faster-whisper-base   (139 MB)
 *   core-spark    → faster-whisper-tiny   (73 MB)
 *   core-pulse    → faster-whisper-base   (139 MB)
 *   core-standard → faster-whisper-small  (462 MB)
 *   (all others)  → faster-whisper-tiny   (73 MB fallback)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8099;
const HF_CACHE = path.join(process.env.HOME, '.cache/huggingface/hub');

// Map branded model IDs to real model directories
const MODEL_MAP = {
  'edge-spark':    'models--Systran--faster-whisper-tiny',
  'edge-pulse':    'models--Systran--faster-whisper-tiny',
  'edge-standard': 'models--Systran--faster-whisper-base',
  'edge-global':   'models--Systran--faster-whisper-small',
  'edge-pro':      'models--Systran--faster-whisper-small',
  'core-spark':    'models--Systran--faster-whisper-tiny',
  'core-pulse':    'models--Systran--faster-whisper-base',
  'core-standard': 'models--Systran--faster-whisper-small',
  'core-global':   'models--Systran--faster-whisper-small',
  'core-pro':      'models--Systran--faster-whisper-small',
  'core-turbo':    'models--Systran--faster-whisper-small',
  'core-ultra':    'models--Systran--faster-whisper-small',
  'lingua-es':     'models--Systran--faster-whisper-small',
  'lingua-fr':     'models--Systran--faster-whisper-small',
  'lingua-hi':     'models--Systran--faster-whisper-small',
};

function findModelBin(hfDir) {
  // Find the model.bin in the snapshot directory
  const snapshotsDir = path.join(HF_CACHE, hfDir, 'snapshots');
  if (!fs.existsSync(snapshotsDir)) return null;
  const snapshots = fs.readdirSync(snapshotsDir);
  if (!snapshots.length) return null;
  const binPath = path.join(snapshotsDir, snapshots[0], 'model.bin');
  // model.bin is a symlink to blobs - resolve it
  if (fs.existsSync(binPath)) return fs.realpathSync(binPath);
  return null;
}

const server = http.createServer((req, res) => {
  // Expected URL: /v2/models/<modelId>.wpr
  const match = req.url.match(/^\/v2\/(?:models\/)?([^/]+)\.wpr/);
  
  if (!match) {
    // Also handle /v2/catalog for model listing
    if (req.url === '/v2/catalog') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const catalog = Object.entries(MODEL_MAP).map(([id, hfDir]) => {
        const binPath = findModelBin(hfDir);
        return { id, available: !!binPath, size: binPath ? fs.statSync(binPath).size : 0 };
      });
      return res.end(JSON.stringify({ models: catalog }));
    }
    
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', service: 'windy-model-server' }));
    }
    
    res.writeHead(404);
    return res.end('Not found');
  }

  const modelId = match[1];
  const hfDir = MODEL_MAP[modelId] || 'models--Systran--faster-whisper-tiny';
  const binPath = findModelBin(hfDir);

  if (!binPath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Model ${modelId} not available locally` }));
  }

  const stat = fs.statSync(binPath);
  
  // Support range requests for resume
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'application/octet-stream',
    });
    fs.createReadStream(binPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(binPath).pipe(res);
  }

  console.log(`📦 Serving ${modelId} (${(stat.size / 1024 / 1024).toFixed(1)} MB) from ${path.basename(hfDir)}`);
});

server.listen(PORT, () => {
  console.log('');
  console.log('📦 Windy Pro Model Server (Development)');
  console.log(`   Port: http://localhost:${PORT}`);
  console.log(`   Cache: ${HF_CACHE}`);
  console.log('');
  console.log('   Available models:');
  Object.entries(MODEL_MAP).forEach(([id, hfDir]) => {
    const binPath = findModelBin(hfDir);
    const status = binPath ? `✅ ${(fs.statSync(binPath).size / 1024 / 1024).toFixed(1)} MB` : '❌ Not found';
    console.log(`     ${id.padEnd(16)} → ${status}`);
  });
  console.log('');
});
