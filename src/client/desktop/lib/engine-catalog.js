// Canonical STT engine catalog — the ONE source of truth for the lean Windy
// engine ladder: ct2 model ids, consumer names, real bundled (int8) sizes, and
// the legacy-whisper-name mapping. main.js (WindyTune ladder, store migration,
// display maps) and the renderer (via preload's engineCatalog bridge) must all
// read from here — duplicated inline maps are how the "badge says Windy Core,
// engine runs whisper base" bug happened (found in the 2026-07-23 hand test).
//
// NOTE: MODEL_REGISTRY.json is the *translation* model registry; it is NOT the
// STT catalog and must not be conflated with this file.

// Ascending accuracy/cost. `model` is the exact id the Python engine accepts
// and reports, so indexOf() against a running model id works. Sizes are the
// real on-disk bundled int8 sizes (matches `du` on Resources/bundled/model).
const LADDER = [
  { engineId: 'windy-nano',       model: 'windy-nano-ct2',       name: 'Windy Nano',  size: '38 MB',  note: 'Fastest · lightest' },
  { engineId: 'windy-lite',       model: 'windy-lite-ct2',       name: 'Windy Lite',  size: '72 MB',  note: 'Fast · balanced' },
  { engineId: 'windy-core',       model: 'windy-core-ct2',       name: 'Windy Core',  size: '234 MB', note: 'Balanced everyday driver' },
  { engineId: 'windy-edge',       model: 'windy-edge-ct2',       name: 'Windy Edge',  size: '727 MB', note: 'High-accuracy workhorse · types in lowercase' },
  { engineId: 'windy-plus',       model: 'windy-plus-ct2',       name: 'Windy Plus',  size: '734 MB', note: 'Premium accuracy' },
  { engineId: 'windy-turbo',      model: 'windy-turbo-ct2',      name: 'Windy Turbo', size: '777 MB', note: 'State of the art · 99 languages · types in CAPS' },
  { engineId: 'windy-pro-engine', model: 'windy-pro-engine-ct2', name: 'Windy Word',  size: '1.5 GB', note: 'Flagship · most accurate' },
];

// Legacy whisper model name → equivalent ct2 ladder id, matched by actual
// architecture/size (nano≈tiny, lite≈base, core≈small, edge≈medium,
// pro-engine≈large). This is the mapping the WindyTune tracker already anchors
// on ('base' → windy-lite). The old MODEL_INFO alias block in main.js was
// shifted one rung up (claimed base = Windy Core), which is where the false
// "Windy Core" badge came from — do not reintroduce that shift.
const LEGACY_MODEL_MAP = {
  'tiny': 'windy-nano-ct2',      'tiny.en': 'windy-nano-ct2',
  'base': 'windy-lite-ct2',      'base.en': 'windy-lite-ct2',
  'small': 'windy-core-ct2',     'small.en': 'windy-core-ct2',
  'medium': 'windy-edge-ct2',    'medium.en': 'windy-edge-ct2',
  'large': 'windy-pro-engine-ct2',
  'large-v1': 'windy-pro-engine-ct2',
  'large-v2': 'windy-pro-engine-ct2',
  'large-v3': 'windy-pro-engine-ct2',
  'turbo': 'windy-turbo-ct2',
};

// ── GPU engine pack ──────────────────────────────────────────────────────
// The three clinic-approved heavy engines offered to GPU-capable machines
// (NVIDIA + CUDA — see lib/gpu-detect.js). These are the SAME ct2 models as
// the ladder's top rungs, run with device=cuda: CT2 accelerates ct2 weights
// on CUDA natively, so nothing new has to be runnable. Picks follow
// docs/MODEL_GLOSSARY.json eval loss: turbo 0.456 (champion), pro-engine
// 0.577, plus 0.757. windy-edge (4.81) and windy-lite (4.18) are excluded —
// known-regressed patients per the clinic.
// downloadMB is the ct2 int8 payload when a lean build must fetch them.
const GPU_PACK = {
  minNvidiaVramGB: 6,
  models: ['windy-plus-ct2', 'windy-turbo-ct2', 'windy-pro-engine-ct2'],
  downloadMB: { 'windy-plus-ct2': 729, 'windy-turbo-ct2': 772, 'windy-pro-engine-ct2': 1473 },
};

// HuggingFace repos for download-on-demand. Models were renamed from
// WindyLabs/windy-* to WindyProLabs/windy-stt-* (glossary predates the
// rename). NOTE per 2026-07-23 HF audit: -turbo-ct2 and the pro-engine ct2
// repos are NOT yet uploaded to WindyProLabs — flagship builds bundle them so
// downloads never trigger there, but lean builds can't fetch those two until
// the uploads land.
const HF_REPO_FOR_MODEL = {
  'windy-nano-ct2': 'WindyProLabs/windy-stt-nano-ct2',
  'windy-lite-ct2': 'WindyProLabs/windy-stt-lite-ct2',
  'windy-core-ct2': 'WindyProLabs/windy-stt-core-ct2',
  'windy-plus-ct2': 'WindyProLabs/windy-stt-plus-ct2',
  'windy-turbo-ct2': 'WindyProLabs/windy-stt-turbo-ct2',
  'windy-edge-ct2': 'WindyProLabs/windy-stt-edge-ct2',
  'windy-pro-engine-ct2': 'WindyProLabs/windy-stt-pro-ct2',
};

const _byModel = Object.fromEntries(LADDER.map(e => [e.model, e]));
const _byEngineId = Object.fromEntries(LADDER.map(e => [e.engineId, e]));

// Any model spelling (canonical ct2 id, legacy whisper name, or the on-disk
// 'faster-whisper-<name>' form) → canonical ct2 ladder id, or null if it maps
// to nothing on the ladder.
function canonicalModelId(id) {
  if (!id || typeof id !== 'string') return null;
  const bare = id.replace(/^faster-whisper-/, '');
  if (_byModel[bare]) return bare;
  return LEGACY_MODEL_MAP[bare] || null;
}

function entryForModel(modelId) {
  return _byModel[modelId] || null;
}

function entryForEngineId(engineId) {
  return _byEngineId[engineId] || null;
}

// Honest display info for whatever model is actually running. A ladder model
// gets its consumer name; anything else is labeled as the legacy model it is —
// NEVER presented as a Windy engine it isn't.
function displayForModel(modelId) {
  const entry = _byModel[modelId] || null;
  if (entry) return { name: entry.name, size: entry.size, engineId: entry.engineId };
  return { name: `${modelId} (legacy)`, size: '', engineId: null };
}

module.exports = {
  LADDER,
  LEGACY_MODEL_MAP,
  GPU_PACK,
  HF_REPO_FOR_MODEL,
  canonicalModelId,
  entryForModel,
  entryForEngineId,
  displayForModel,
};
