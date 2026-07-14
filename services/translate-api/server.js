/**
 * Windy Translate API — Tier 2 Dynamic Translation Service
 * 
 * Express.js API server that translates text using CTranslate2 + NLLB-200-600M.
 * Caches results in SQLite. Designed for Tier 2 languages (11-99) in the
 * Windy Word two-tier i18n system.
 * 
 * Architecture:
 *   Express.js (HTTP, caching, rate-limit, CORS)
 *       ↕ JSON Lines over stdin/stdout
 *   Python worker (CTranslate2 + NLLB model, stays resident in memory)
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const md5 = require('md5');
const { spawn } = require('child_process');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 8099;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cache.db');
const MODEL_PATH = process.env.MODEL_PATH || path.join(__dirname, 'models', 'nllb-200-600M');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const SERVICE_NAME = 'windy-translate';
const SERVICE_VERSION = require('./package.json').version;
const STARTED_AT = new Date().toISOString();
// Steamroller (ADR-060 §5) — check_for_update resolves this deployment's
// version against admin's fleet-version manifest.
const FLEET_VERSIONS_URL = process.env.FLEET_VERSIONS_URL || 'https://admin.windyword.ai/v1/fleet-versions';
const FLEET_PRODUCT = process.env.FLEET_PRODUCT || 'windy-translate';
const FLEET_CHANNEL = process.env.FLEET_CHANNEL || 'stable';
const ALLOWED_ORIGINS = [
    'https://windyword.ai',
    'https://windyword.ai', // legacy — remove after full migration
    'http://localhost:3000',
    'http://localhost:5173',
    'file://'   // Electron wizard
];

// NLLB-200 language code mapping (ISO 639-1 → NLLB flores200 code)
// NLLB uses flores200 codes like "eng_Latn", "spa_Latn", etc.
const LANG_TO_NLLB = {
    'en': 'eng_Latn', 'es': 'spa_Latn', 'fr': 'fra_Latn', 'de': 'deu_Latn',
    'pt': 'por_Latn', 'it': 'ita_Latn', 'zh': 'zho_Hans', 'zh-tw': 'zho_Hant',
    'ja': 'jpn_Jpan', 'ko': 'kor_Hang', 'ar': 'arb_Arab', 'hi': 'hin_Deva',
    'ru': 'rus_Cyrl', 'tr': 'tur_Latn', 'vi': 'vie_Latn', 'th': 'tha_Thai',
    'nl': 'nld_Latn', 'pl': 'pol_Latn', 'sv': 'swe_Latn', 'no': 'nob_Latn',
    'da': 'dan_Latn', 'fi': 'fin_Latn', 'id': 'ind_Latn', 'ms': 'zsm_Latn',
    'tl': 'tgl_Latn', 'uk': 'ukr_Cyrl', 'cs': 'ces_Latn', 'ro': 'ron_Latn',
    'hu': 'hun_Latn', 'el': 'ell_Grek', 'he': 'heb_Hebr', 'fa': 'pes_Arab',
    'ur': 'urd_Arab', 'bn': 'ben_Beng', 'ta': 'tam_Taml', 'te': 'tel_Telu',
    'sw': 'swh_Latn', 'am': 'amh_Ethi', 'ha': 'hau_Latn', 'yo': 'yor_Latn',
    'ig': 'ibo_Latn', 'zu': 'zul_Latn', 'af': 'afr_Latn', 'ca': 'cat_Latn',
    'eu': 'eus_Latn', 'bg': 'bul_Cyrl', 'hr': 'hrv_Latn', 'sk': 'slk_Latn',
    'sl': 'slv_Latn', 'lt': 'lit_Latn', 'lv': 'lvs_Latn', 'et': 'est_Latn',
    'ka': 'kat_Geor', 'hy': 'hye_Armn', 'az': 'azj_Latn', 'kk': 'kaz_Cyrl',
    'uz': 'uzn_Latn', 'mn': 'khk_Cyrl', 'my': 'mya_Mymr', 'km': 'khm_Khmr',
    'lo': 'lao_Laoo', 'ne': 'npi_Deva', 'si': 'sin_Sinh', 'ml': 'mal_Mlym',
    'kn': 'kan_Knda', 'mr': 'mar_Deva', 'gu': 'guj_Gujr', 'pa': 'pan_Guru',
    'jv': 'jav_Latn', 'sr': 'srp_Cyrl', 'bs': 'bos_Latn', 'sq': 'als_Latn',
    'mk': 'mkd_Cyrl', 'ps': 'pbt_Arab', 'ku': 'ckb_Arab', 'gl': 'glg_Latn',
    'cy': 'cym_Latn', 'mt': 'mlt_Latn', 'or': 'ory_Orya', 'as': 'asm_Beng',
    'sd': 'snd_Arab', 'su': 'sun_Latn', 'ceb': 'ceb_Latn', 'mg': 'plt_Latn',
    'so': 'som_Latn', 'ti': 'tir_Ethi', 'wo': 'wol_Latn', 'xh': 'xho_Latn',
    'st': 'sot_Latn', 'sn': 'sna_Latn', 'rw': 'kin_Latn', 'rn': 'run_Latn',
    'ln': 'lin_Latn', 'tn': 'tsn_Latn', 'sm': 'smo_Latn', 'fj': 'fij_Latn',
};

// ═══════════════════════════════════════════════════════════════════════════════
// SQLITE CACHE
// ═══════════════════════════════════════════════════════════════════════════════

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
        cache_key TEXT PRIMARY KEY,
        source_text TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        hit_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lang ON translations(target_lang);
`);

const stmtGet = db.prepare('SELECT translated_text, hit_count FROM translations WHERE cache_key = ?');
const stmtSet = db.prepare(`
    INSERT OR REPLACE INTO translations (cache_key, source_text, target_lang, translated_text)
    VALUES (?, ?, ?, ?)
`);
const stmtHit = db.prepare('UPDATE translations SET hit_count = hit_count + 1 WHERE cache_key = ?');

function getCached(text, targetLang) {
    const key = md5(text + '||' + targetLang);
    const row = stmtGet.get(key);
    if (row) {
        stmtHit.run(key);
        return { translated: row.translated_text, cached: true };
    }
    return null;
}

function setCache(text, targetLang, translated) {
    const key = md5(text + '||' + targetLang);
    stmtSet.run(key, text, targetLang, translated);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPS LOG RING (ADR-060 get_logs — content-free BY CONSTRUCTION)
// ═══════════════════════════════════════════════════════════════════════════════
// Entries are {ts, level, event, code?} with event drawn from a fixed
// vocabulary and code a number/short enum — never free text. Worker errors
// and tracebacks can embed the text being translated, so raw messages are
// CATEGORIZED here, never stored (privacy hard line: no user content in logs).

const OPS_LOG_MAX = 500;
const opsLogRing = [];

function opsLog(level, event, code) {
    const entry = { ts: new Date().toISOString(), level, event };
    if (code !== undefined) entry.code = code;
    opsLogRing.push(entry);
    if (opsLogRing.length > OPS_LOG_MAX) opsLogRing.shift();
}

function categorizeTranslationError(message) {
    if (/timeout/i.test(message)) return 'timeout';
    if (/not ready/i.test(message)) return 'worker_not_ready';
    if (/crashed/i.test(message)) return 'worker_crashed';
    return 'other';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PYTHON TRANSLATION WORKER
// ═══════════════════════════════════════════════════════════════════════════════

let worker = null;
let workerReady = false;
const pendingRequests = new Map();
let requestId = 0;

function startWorker() {
    const workerPath = path.join(__dirname, 'translate-worker.py');
    worker = spawn(PYTHON_BIN, ['-u', workerPath], {
        env: { ...process.env, MODEL_PATH },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    opsLog('info', 'worker_start');

    let buffer = '';
    worker.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.type === 'ready') {
                    workerReady = true;
                    console.log('✅ Translation worker ready — model loaded');
                    opsLog('info', 'worker_ready');
                } else if (msg.type === 'result' && pendingRequests.has(msg.id)) {
                    const { resolve } = pendingRequests.get(msg.id);
                    pendingRequests.delete(msg.id);
                    resolve(msg);
                } else if (msg.type === 'error' && pendingRequests.has(msg.id)) {
                    const { reject } = pendingRequests.get(msg.id);
                    pendingRequests.delete(msg.id);
                    reject(new Error(msg.error));
                }
            } catch (e) {
                // Non-JSON output from Python (e.g. warnings)
                console.log(`[worker] ${line}`);
            }
        }
    });

    worker.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.error(`[worker stderr] ${msg}`);
    });

    worker.on('exit', (code) => {
        console.error(`❌ Worker exited with code ${code}. Restarting in 3s...`);
        opsLog('error', 'worker_exit', code === null ? 'signal' : code);
        workerReady = false;
        // Reject all pending requests
        for (const [id, { reject }] of pendingRequests) {
            reject(new Error('Worker crashed'));
        }
        pendingRequests.clear();
        setTimeout(startWorker, 3000);
    });

    console.log('🔄 Starting translation worker (loading NLLB model)...');
}

function translate(text, sourceLang, targetLang) {
    return new Promise((resolve, reject) => {
        if (!workerReady) {
            return reject(new Error('Translation worker not ready — model still loading'));
        }

        const id = ++requestId;
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Translation timeout (30s)'));
        }, 30000);

        pendingRequests.set(id, {
            resolve: (result) => { clearTimeout(timeout); resolve(result); },
            reject: (err) => { clearTimeout(timeout); reject(err); }
        });

        const request = JSON.stringify({
            id,
            text,
            source: LANG_TO_NLLB[sourceLang] || 'eng_Latn',
            target: LANG_TO_NLLB[targetLang]
        }) + '\n';

        worker.stdin.write(request);
    });
}

// Indirection so the selftest and tests can exercise the pipeline without a
// resident NLLB model; production always uses the real worker path.
let translateImpl = translate;

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS
app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (curl, Electron, server-to-server)
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
        cb(new Error('CORS not allowed'));
    }
}));

// Rate limit: 100 requests/min per IP
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Max 100 requests/minute.' }
});
app.use('/translate', limiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        worker: workerReady ? 'ready' : 'loading',
        cache_size: db.prepare('SELECT COUNT(*) as n FROM translations').get().n,
        uptime: process.uptime()
    });
});

// ─── GET /version — MF1 deployment identity (no auth, no DB, no worker) ───
app.get('/version', (req, res) => {
    const commitSha = process.env.COMMIT_SHA || null;
    res.json({
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        commit_sha: commitSha,
        commit_sha_short: commitSha ? commitSha.slice(0, 7) : null,
        build_timestamp: process.env.BUILD_TIMESTAMP || null,
        started_at: STARTED_AT,
        environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    });
});

// ─── Bearer-token wall (ADR-060 §3.3) — everything below this point ───
// Opt-in: enforced only when WINDY_TRANSLATE_TOKEN is set (read per-request,
// constant-time compare). Unset = today's open-loopback behavior, so turning
// the wall on is a deploy-env decision, not a code change. /health and
// /version stay tokenless above (orchestrator probes + MF1 must never
// depend on auth).
const crypto = require('crypto');
app.use((req, res, next) => {
    const expected = process.env.WINDY_TRANSLATE_TOKEN;
    if (!expected) return next();
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    const presented = match ? match[1] : '';
    const a = crypto.createHash('sha256').update(presented).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    if (!match || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({
            ok: false,
            error: match ? 'invalid_token' : 'missing_authorization',
            remediation: 'Send `Authorization: Bearer <token>` matching this service\'s WINDY_TRANSLATE_TOKEN (set in its systemd/service environment).',
        });
    }
    next();
});

// ─── POST /translate ───
app.post('/translate', async (req, res) => {
    try {
        const { text, targetLang, sourceLang = 'en' } = req.body;

        if (!text || !targetLang) {
            return res.status(400).json({ error: 'Missing required fields: text, targetLang' });
        }
        if (!LANG_TO_NLLB[targetLang]) {
            return res.status(400).json({ error: `Unsupported language: ${targetLang}` });
        }
        if (targetLang === sourceLang) {
            return res.json({ translated: text, cached: false, lang: targetLang });
        }

        // Check cache first
        const cached = getCached(text, targetLang);
        if (cached) {
            return res.json({ ...cached, lang: targetLang });
        }

        // Translate via Python worker
        const result = await translateImpl(text, sourceLang, targetLang);
        setCache(text, targetLang, result.translated);

        res.json({ translated: result.translated, cached: false, lang: targetLang });
    } catch (err) {
        console.error('Translation error:', err.message);
        opsLog('error', 'translation_error', categorizeTranslationError(err.message));
        res.status(503).json({ error: err.message });
    }
});

// ─── POST /translate/batch ───
app.post('/translate/batch', async (req, res) => {
    try {
        const { texts, targetLang, sourceLang = 'en' } = req.body;

        if (!texts || !Array.isArray(texts) || !targetLang) {
            return res.status(400).json({ error: 'Missing required fields: texts (array), targetLang' });
        }
        if (texts.length > 200) {
            return res.status(400).json({ error: 'Max 200 texts per batch' });
        }
        if (!LANG_TO_NLLB[targetLang]) {
            return res.status(400).json({ error: `Unsupported language: ${targetLang}` });
        }

        const results = [];
        const toTranslate = []; // { index, text } — items not in cache

        // Check cache for each text
        for (let i = 0; i < texts.length; i++) {
            if (texts[i] === '' || targetLang === sourceLang) {
                results[i] = { translated: texts[i], cached: false };
                continue;
            }
            const cached = getCached(texts[i], targetLang);
            if (cached) {
                results[i] = cached;
            } else {
                toTranslate.push({ index: i, text: texts[i] });
            }
        }

        // Translate uncached items
        if (toTranslate.length > 0) {
            const translations = await Promise.all(
                toTranslate.map(({ text }) => translateImpl(text, sourceLang, targetLang))
            );

            for (let j = 0; j < toTranslate.length; j++) {
                const { index, text } = toTranslate[j];
                const translated = translations[j].translated;
                setCache(text, targetLang, translated);
                results[index] = { translated, cached: false };
            }
        }

        const cacheHits = results.filter(r => r.cached).length;
        res.json({
            translations: results.map(r => r.translated),
            lang: targetLang,
            total: texts.length,
            cached: cacheHits,
            translated: texts.length - cacheHits
        });
    } catch (err) {
        console.error('Batch translation error:', err.message);
        opsLog('error', 'translation_error', categorizeTranslationError(err.message));
        res.status(503).json({ error: err.message });
    }
});

// ─── POST /detect — Language auto-detection via script analysis ───
app.post('/detect', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // Simple script-based detection (fast, no ML needed)
    const sample = text.slice(0, 200);
    const scripts = {
        cyrillic: /[\u0400-\u04FF]/g,
        arabic: /[\u0600-\u06FF]/g,
        devanagari: /[\u0900-\u097F]/g,
        cjk: /[\u4E00-\u9FFF]/g,
        hangul: /[\uAC00-\uD7AF]/g,
        kana: /[\u3040-\u30FF]/g,
        thai: /[\u0E00-\u0E7F]/g,
        greek: /[\u0370-\u03FF]/g,
        hebrew: /[\u0590-\u05FF]/g,
        georgian: /[\u10A0-\u10FF]/g,
        armenian: /[\u0530-\u058F]/g,
        bengali: /[\u0980-\u09FF]/g,
        tamil: /[\u0B80-\u0BFF]/g,
    };

    const scriptMap = {
        cyrillic: 'ru', arabic: 'ar', devanagari: 'hi', cjk: 'zh',
        hangul: 'ko', kana: 'ja', thai: 'th', greek: 'el',
        hebrew: 'he', georgian: 'ka', armenian: 'hy', bengali: 'bn', tamil: 'ta'
    };

    let detected = 'en';
    let maxCount = 0;
    for (const [script, regex] of Object.entries(scripts)) {
        const matches = sample.match(regex);
        if (matches && matches.length > maxCount) {
            maxCount = matches.length;
            detected = scriptMap[script] || 'en';
        }
    }

    res.json({ detected, confidence: maxCount > 10 ? 'high' : maxCount > 3 ? 'medium' : 'low' });
});

// ─── GET /languages ───
app.get('/languages', (req, res) => {
    res.json({
        supported: Object.keys(LANG_TO_NLLB),
        total: Object.keys(LANG_TO_NLLB).length
    });
});

// ─── Steamroller: check_for_update (ADR-060 §5) ───
// Semver-lenient compare (mirrors windy-contracts loom/discovery.py so the
// whole fleet agrees on what "newer" means).
function semverTuple(v) {
    return String(v).replace(/-/g, '.').split('.').map((p) => (/^\d+$/.test(p) ? [0, parseInt(p, 10)] : [1, p]));
}
function semverLess(a, b) {
    const ta = semverTuple(a), tb = semverTuple(b);
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
        const x = ta[i] || [0, 0], y = tb[i] || [0, 0];
        if (x[0] !== y[0]) return x[0] < y[0];
        if (x[1] !== y[1]) return x[1] < y[1];
    }
    return false;
}
function compareVersion(installed, current, minimum) {
    try {
        if (minimum && semverLess(installed, minimum)) return 'must-update';
        if (semverLess(installed, current)) return 'update-available';
        return 'current';
    } catch { return 'unknown'; }
}

app.get('/ops/check-update', async (req, res) => {
    const result = { service: FLEET_PRODUCT, installed: SERVICE_VERSION, status: 'unknown' };
    let manifest;
    try {
        const r = await fetch(FLEET_VERSIONS_URL, { signal: AbortSignal.timeout(4000) });
        if (r.status !== 200) { result.detail = `fleet manifest http ${r.status}`; return res.json(result); }
        manifest = await r.json();
    } catch (err) {
        result.detail = `fleet manifest unreachable: ${err.name || err.message}`;
        return res.json(result);
    }
    const chan = manifest?.products?.[FLEET_PRODUCT]?.channels?.[FLEET_CHANNEL];
    if (!chan || !chan.current) { result.detail = 'no fleet-version entry for this product/channel'; return res.json(result); }
    const status = compareVersion(SERVICE_VERSION, chan.current, chan.minimum);
    Object.assign(result, { status, current: chan.current, minimum: chan.minimum || null,
        kind: chan.kind || null, source: chan.source || null, notes: chan.notes || null });
    if (status === 'update-available' || status === 'must-update') {
        result.remediation = `redeploy windy-translate (Grant-gated restart) to move from ${SERVICE_VERSION} to ${chan.current}`;
    }
    res.json(result);
});

// ─── GET /ops/logs — recent ops events (ADR-060 get_logs) ───
// Content-free by construction: the ring only ever holds fixed-vocabulary
// events + numeric/enum codes (see opsLog above) — no message text, ever.
app.get('/ops/logs', (req, res) => {
    res.json({
        service: SERVICE_NAME,
        count: opsLogRing.length,
        max: OPS_LOG_MAX,
        entries: opsLogRing,
    });
});

// ─── POST /ops/selftest — exercise the core path (ADR-060 run_selftest) ───
// Canary-translates a fixed constant phrase through the REAL pipeline and
// round-trips the SQLite cache; pass/fail per stage so an agent sees WHERE
// it broke (worker loading vs translation vs cache).
const SELFTEST_PHRASE = 'hello world';
app.post('/ops/selftest', async (req, res) => {
    const startedAt = Date.now();
    const stages = [];

    const workerOk = workerReady;
    stages.push({
        name: 'worker',
        ok: workerOk,
        detail: workerOk ? 'ready' : 'loading — model not resident yet',
    });

    if (workerOk) {
        try {
            const result = await translateImpl(SELFTEST_PHRASE, 'en', 'es');
            stages.push({
                name: 'translate',
                ok: typeof result.translated === 'string' && result.translated.length > 0,
                detail: `canary '${SELFTEST_PHRASE}' → '${result.translated}'`,
            });
        } catch (err) {
            stages.push({
                name: 'translate',
                ok: false,
                detail: categorizeTranslationError(err.message),
            });
        }
    } else {
        stages.push({ name: 'translate', ok: false, detail: 'skipped — worker not ready' });
    }

    try {
        const key = '__selftest__||xx';
        stmtSet.run(key, '__selftest__', 'xx', 'ok');
        const row = stmtGet.get(key);
        db.prepare('DELETE FROM translations WHERE cache_key = ?').run(key);
        stages.push({ name: 'cache', ok: !!row && row.translated_text === 'ok' });
    } catch (err) {
        stages.push({ name: 'cache', ok: false, detail: 'sqlite error' });
    }

    const passed = stages.every(s => s.ok);
    opsLog(passed ? 'info' : 'error', 'selftest', passed ? 'pass' : 'fail');
    // `passed`, not `ok`: the ADR-060 invoke envelope reserves top-level `ok`
    // for call success — a failing canary is still a SUCCESSFUL observation,
    // and a top-level `ok:false` here would make the woven MCP packet report
    // the tool call itself as errored.
    res.json({ passed, stages, duration_ms: Date.now() - startedAt });
});

// ─── GET /cache/stats ───
app.get('/cache/stats', (req, res) => {
    const stats = db.prepare(`
        SELECT target_lang as lang, COUNT(*) as entries, SUM(hit_count) as hits
        FROM translations GROUP BY target_lang ORDER BY entries DESC
    `).all();
    const total = db.prepare('SELECT COUNT(*) as n, SUM(hit_count) as hits FROM translations').get();
    res.json({ total: total.n, total_hits: total.hits, by_language: stats });
});

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

if (require.main === module) {
    opsLog('info', 'server_start');
    if (!process.env.WINDY_TRANSLATE_TOKEN) {
        console.warn('⚠️  WINDY_TRANSLATE_TOKEN not set — API is open on loopback (set it to enforce bearer auth)');
    }
    startWorker();

    app.listen(PORT, () => {
        console.log(`🌪️  Windy Translate API running on http://localhost:${PORT}`);
        console.log(`   POST /translate       — single translation`);
        console.log(`   POST /translate/batch — batch translation`);
        console.log(`   GET  /health          — status check`);
        console.log(`   GET  /version         — deployment identity (MF1)`);
        console.log(`   GET  /languages       — supported languages`);
        console.log(`   GET  /cache/stats     — cache statistics`);
        console.log(`   GET  /ops/logs        — recent ops events (content-free)`);
        console.log(`   POST /ops/selftest    — canary self-test`);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    if (worker) worker.kill();
    db.close();
    process.exit(0);
});
process.on('SIGINT', () => {
    if (worker) worker.kill();
    db.close();
    process.exit(0);
});

// Exported for tests (node --test); production entry is `node server.js`.
module.exports = {
    app,
    _internals: {
        setTranslate(fn) { translateImpl = fn || translate; },
        setWorkerReady(v) { workerReady = !!v; },
        opsLog,
    },
};
