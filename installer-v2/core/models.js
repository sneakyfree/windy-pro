/**
 * Windy Pro v2.0 — Engine Catalog
 * 16 proprietary engines in 2 families: GPU-Accelerated + CPU-Optimized
 * All engines developed by Windy Pro Labs. Fine-tuned, optimized, and secured.
 *
 * USER-FACING NAMES: No "STT" in any displayed name
 * INTERNAL IDs: windy-stt-* for code/downloads
 *
 * 7 ENGINE NAMES (GPU + CPU variants):
 * - Windy Nano, Windy Lite, Windy Core (FREE tier)
 * - Windy Edge, Windy Plus, Windy Turbo, Windy Pro (PAID tiers)
 *
 * 2 TRANSLATION ENGINES:
 * - Windy Translate Spark, Windy Translate Standard
 */

const ENGINE_FAMILIES = {
  gpu: {
    name: 'GPU-Accelerated',
    emoji: '⚡',
    tagline: 'For machines with dedicated graphics cards',
    description: 'Blazing-fast inference with CUDA/Metal acceleration. Recommended for desktops and workstations.',
    color: '#3B82F6',
    requiresGPU: true
  },
  cpu: {
    name: 'CPU-Optimized',
    emoji: '🛡️',
    tagline: 'Runs on any machine',
    description: 'No graphics card needed. Optimized for laptops, older hardware, and resource-constrained devices.',
    color: '#22C55E',
    requiresGPU: false
  },
  translation: {
    name: 'Translation',
    emoji: '🌍',
    tagline: 'Real-time multilingual translation',
    description: 'Live translation across 100+ language pairs. Local, private, instant.',
    color: '#A855F7',
    requiresGPU: false
  }
};

/**
 * All 16 proprietary Windy Pro engines
 * Sizes match MODEL_MANIFEST from Electron app main.js:134
 */
const ENGINE_CATALOG = [
  // ─── GPU-ACCELERATED ENGINES ───
  {
    id: 'windy-stt-nano',
    family: 'gpu',
    name: 'Windy Nano',
    displayName: 'Windy Nano',
    sizeMB: 73,
    sizeDisplay: '73 MB',
    vramGB: 1,
    ramGB: 4,
    speed: '32×',
    speedRating: 32,
    quality: 3,
    qualityLabel: 'Good',
    parameters: '39M',
    languages: 99,
    description: 'Fastest GPU engine. Lightning-fast dictation and real-time captions.',
    bestFor: 'Quick dictation, real-time captions, speed-first workflows',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors',
    badge: '⚡ Fastest'
  },
  {
    id: 'windy-stt-lite',
    family: 'gpu',
    name: 'Windy Lite',
    displayName: 'Windy Lite',
    sizeMB: 140,
    sizeDisplay: '140 MB',
    vramGB: 1,
    ramGB: 4,
    speed: '16×',
    speedRating: 16,
    quality: 3.5,
    qualityLabel: 'Great',
    parameters: '74M',
    languages: 99,
    description: 'Lightweight, balanced speed and quality. Excellent for everyday use.',
    bestFor: 'Emails, casual notes, meetings, everyday dictation',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors'
  },
  {
    id: 'windy-stt-core',
    family: 'gpu',
    name: 'Windy Core',
    displayName: 'Windy Core',
    sizeMB: 462,
    sizeDisplay: '462 MB',
    vramGB: 2,
    ramGB: 8,
    speed: '6×',
    speedRating: 6,
    quality: 4,
    qualityLabel: 'Excellent',
    parameters: '244M',
    languages: 99,
    description: 'Recommended for most users. Great accuracy on GPU hardware.',
    bestFor: 'Meetings, technical dictation, content creation, professional use',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors',
    badge: '⭐ Recommended'
  },
  {
    id: 'windy-stt-edge',
    family: 'gpu',
    name: 'Windy Edge',
    displayName: 'Windy Edge',
    sizeMB: 1444,
    sizeDisplay: '1.4 GB',
    vramGB: 5,
    ramGB: 16,
    speed: '4×',
    speedRating: 4,
    quality: 4.5,
    qualityLabel: 'Outstanding',
    parameters: '1550M',
    languages: 99,
    description: 'High-accuracy, professional-grade transcription.',
    bestFor: 'Professional meetings, multilingual content, broadcast quality',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors'
  },
  {
    id: 'windy-stt-plus',
    family: 'gpu',
    name: 'Windy Plus',
    displayName: 'Windy Plus',
    sizeMB: 1458,
    sizeDisplay: '1.5 GB',
    vramGB: 5,
    ramGB: 16,
    speed: '5×',
    speedRating: 5,
    quality: 4.5,
    qualityLabel: 'Outstanding',
    parameters: '1550M',
    languages: 99,
    description: 'Premium accuracy, production-grade quality.',
    bestFor: 'Production workflows, legal, medical, technical documentation',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors'
  },
  {
    id: 'windy-stt-turbo',
    family: 'gpu',
    name: 'Windy Turbo',
    displayName: 'Windy Turbo',
    sizeMB: 1544,
    sizeDisplay: '1.5 GB',
    vramGB: 6,
    ramGB: 16,
    speed: '4×',
    speedRating: 4,
    quality: 5,
    qualityLabel: 'Champion',
    parameters: '809M',
    languages: 99,
    description: 'Champion engine. Best balance of speed and quality.',
    bestFor: 'Power users who want the best without compromises',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors',
    badge: '🏆 Champion'
  },
  {
    id: 'windy-stt-pro',
    family: 'gpu',
    name: 'Windy Pro',
    displayName: 'Windy Pro',
    sizeMB: 2945,
    sizeDisplay: '2.9 GB',
    vramGB: 10,
    ramGB: 24,
    speed: '1×',
    speedRating: 1,
    quality: 5,
    qualityLabel: 'Flagship',
    parameters: '1550M',
    languages: 99,
    description: 'The flagship. Maximum accuracy in any language. No compromises.',
    bestFor: 'Broadcast, legal, medical, multilingual professionals, maximum quality',
    tier: 'translate_pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'LoRA-optimized by Windy Pro Labs',
    format: 'Safetensors',
    badge: '👑 Flagship'
  },

  // ─── CPU-OPTIMIZED ENGINES ───
  {
    id: 'windy-stt-nano-cpu',
    family: 'cpu',
    name: 'Windy Nano',
    displayName: 'Windy Nano (CPU)',
    sizeMB: 406,
    sizeDisplay: '406 MB',
    vramGB: 0,
    ramGB: 2,
    speed: '8×',
    speedRating: 8,
    quality: 3,
    qualityLabel: 'Good',
    parameters: '39M',
    languages: 99,
    description: 'CPU-optimized for resource-constrained devices.',
    bestFor: 'Older hardware, low-RAM devices, offline emergencies',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized',
    badge: '📱 Mobile-Ready'
  },
  {
    id: 'windy-stt-lite-cpu',
    family: 'cpu',
    name: 'Windy Lite',
    displayName: 'Windy Lite (CPU)',
    sizeMB: 668,
    sizeDisplay: '668 MB',
    vramGB: 0,
    ramGB: 3,
    speed: '6×',
    speedRating: 6,
    quality: 3.5,
    qualityLabel: 'Great',
    parameters: '74M',
    languages: 99,
    description: 'CPU-optimized, good balance for everyday use.',
    bestFor: 'Laptop users, coffee shop dictation, mobile workflows',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized'
  },
  {
    id: 'windy-stt-core-cpu',
    family: 'cpu',
    name: 'Windy Core',
    displayName: 'Windy Core (CPU)',
    sizeMB: 1760,
    sizeDisplay: '1.7 GB',
    vramGB: 0,
    ramGB: 4,
    speed: '3×',
    speedRating: 3,
    quality: 4,
    qualityLabel: 'Excellent',
    parameters: '244M',
    languages: 99,
    description: 'Recommended CPU engine. No GPU needed.',
    bestFor: 'Laptops, desktops without GPU, everyday professional use',
    tier: 'free',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized',
    badge: '⭐ CPU Recommended'
  },
  {
    id: 'windy-stt-edge-cpu',
    family: 'cpu',
    name: 'Windy Edge',
    displayName: 'Windy Edge (CPU)',
    sizeMB: 3824,
    sizeDisplay: '3.8 GB',
    vramGB: 0,
    ramGB: 8,
    speed: '2×',
    speedRating: 2,
    quality: 4.5,
    qualityLabel: 'Outstanding',
    parameters: '1550M',
    languages: 99,
    description: 'CPU-optimized, high accuracy for professional work.',
    bestFor: 'Professional CPU workflows, high-quality transcription',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized'
  },
  {
    id: 'windy-stt-plus-cpu',
    family: 'cpu',
    name: 'Windy Plus',
    displayName: 'Windy Plus (CPU)',
    sizeMB: 4872,
    sizeDisplay: '4.9 GB',
    vramGB: 0,
    ramGB: 8,
    speed: '2×',
    speedRating: 2,
    quality: 4.5,
    qualityLabel: 'Outstanding',
    parameters: '1550M',
    languages: 99,
    description: 'CPU-optimized premium accuracy.',
    bestFor: 'Production CPU workflows, legal, medical transcription',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized'
  },
  {
    id: 'windy-stt-turbo-cpu',
    family: 'cpu',
    name: 'Windy Turbo',
    displayName: 'Windy Turbo (CPU)',
    sizeMB: 4200,
    sizeDisplay: '4.2 GB',
    vramGB: 0,
    ramGB: 8,
    speed: '2×',
    speedRating: 2,
    quality: 5,
    qualityLabel: 'Champion',
    parameters: '809M',
    languages: 99,
    description: 'CPU-optimized state-of-the-art quality.',
    bestFor: 'Power CPU users who demand maximum quality',
    tier: 'pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized',
    badge: '🏆 CPU Champion'
  },
  {
    id: 'windy-stt-pro-cpu',
    family: 'cpu',
    name: 'Windy Pro',
    displayName: 'Windy Pro (CPU)',
    sizeMB: 9456,
    sizeDisplay: '9.5 GB',
    vramGB: 0,
    ramGB: 16,
    speed: '1×',
    speedRating: 1,
    quality: 5,
    qualityLabel: 'Flagship',
    parameters: '1550M',
    languages: 99,
    description: 'CPU-optimized flagship. Maximum performance without GPU.',
    bestFor: 'Broadcast, legal, medical on CPU hardware',
    tier: 'translate_pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'INT8 Quantized by Windy Pro Labs',
    format: 'INT8 Quantized',
    badge: '👑 CPU Flagship'
  },

  // ─── TRANSLATION ENGINES ───
  {
    id: 'windy-translate-spark',
    family: 'translation',
    name: 'Windy Translate Spark',
    displayName: 'Windy Translate Spark',
    sizeMB: 929,
    sizeDisplay: '929 MB',
    vramGB: 0,
    ramGB: 4,
    speed: '8×',
    speedRating: 8,
    quality: 4,
    qualityLabel: 'Fast & Accurate',
    parameters: '418M',
    languages: 100,
    description: 'Fast multilingual translation across 100+ languages.',
    bestFor: 'Quick translations, real-time conversation, travelers',
    tier: 'translate',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'Multilingual by Windy Pro Labs',
    format: 'Safetensors'
  },
  {
    id: 'windy-translate-standard',
    family: 'translation',
    name: 'Windy Translate Standard',
    displayName: 'Windy Translate Standard',
    sizeMB: 2371,
    sizeDisplay: '2.4 GB',
    vramGB: 0,
    ramGB: 8,
    speed: '4×',
    speedRating: 4,
    quality: 5,
    qualityLabel: 'Professional',
    parameters: '1200M',
    languages: 100,
    description: 'Higher quality than Spark. Professional-grade translation.',
    bestFor: 'Professional translation, business meetings, documentation',
    tier: 'translate_pro',
    architecture: 'Proprietary encoder-decoder',
    fineTuned: 'Multilingual by Windy Pro Labs',
    format: 'Safetensors',
    badge: '🌍 Pro Translation'
  }
];

/**
 * Tier access rules — which engines are available at each tier
 * Matches Electron app's MODEL_MANIFEST.tierModels
 */
const TIER_ACCESS = {
  free: [
    'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core',
    'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu'
  ],
  pro: [
    'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core',
    'windy-stt-edge', 'windy-stt-plus', 'windy-stt-turbo', 'windy-stt-pro',
    'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu',
    'windy-stt-edge-cpu', 'windy-stt-plus-cpu', 'windy-stt-turbo-cpu', 'windy-stt-pro-cpu'
  ],
  translate: [
    'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core',
    'windy-stt-edge', 'windy-stt-plus', 'windy-stt-turbo', 'windy-stt-pro',
    'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu',
    'windy-stt-edge-cpu', 'windy-stt-plus-cpu', 'windy-stt-turbo-cpu', 'windy-stt-pro-cpu',
    'windy-translate-spark'
  ],
  translate_pro: [
    'windy-stt-nano', 'windy-stt-lite', 'windy-stt-core',
    'windy-stt-edge', 'windy-stt-plus', 'windy-stt-turbo', 'windy-stt-pro',
    'windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu',
    'windy-stt-edge-cpu', 'windy-stt-plus-cpu', 'windy-stt-turbo-cpu', 'windy-stt-pro-cpu',
    'windy-translate-spark', 'windy-translate-standard'
  ]
};

/**
 * Get engines available for a given tier
 */
function getEnginesForTier(tier) {
  const ids = TIER_ACCESS[tier] || TIER_ACCESS.free;
  return ENGINE_CATALOG.filter(m => ids.includes(m.id));
}

/**
 * Get total download size for a set of engine IDs (in MB)
 */
function getTotalSize(engineIds) {
  return ENGINE_CATALOG
    .filter(m => engineIds.includes(m.id))
    .reduce((sum, m) => sum + m.sizeMB, 0);
}

/**
 * Format size for display
 */
function formatSize(mb) {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Get engine by ID
 */
function getEngineById(id) {
  return ENGINE_CATALOG.find(e => e.id === id);
}

/**
 * Get GPU variants of all engines
 */
function getGPUEngines() {
  return ENGINE_CATALOG.filter(e => e.family === 'gpu');
}

/**
 * Get CPU variants of all engines
 */
function getCPUEngines() {
  return ENGINE_CATALOG.filter(e => e.family === 'cpu');
}

/**
 * Get translation engines
 */
function getTranslationEngines() {
  return ENGINE_CATALOG.filter(e => e.family === 'translation');
}

/**
 * Check if user has access to an engine based on tier
 */
function hasAccessToEngine(engineId, userTier) {
  const tierEngines = TIER_ACCESS[userTier] || TIER_ACCESS.free;
  return tierEngines.includes(engineId);
}

module.exports = {
  ENGINE_FAMILIES,
  ENGINE_CATALOG,
  TIER_ACCESS,
  getEnginesForTier,
  getTotalSize,
  formatSize,
  getEngineById,
  getGPUEngines,
  getCPUEngines,
  getTranslationEngines,
  hasAccessToEngine
};
