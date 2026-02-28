/**
 * Windy Pro v2.0 — Model Catalog
 * 15 proprietary models in 3 families: Core (GPU), Edge (CPU), Lingua (language specialists)
 * All models are .wpr encrypted, fingerprinted per account, steganographically watermarked.
 * 
 * THESE ARE OUR MODELS. Developed in our lab. Fine-tuned by our engineers on Veron 1.
 * Not available anywhere else.
 */

const MODEL_FAMILIES = {
  core: {
    name: 'Windy Core',
    emoji: '⚡',
    tagline: 'GPU-Accelerated Power',
    description: 'Seven models for desktops and workstations with dedicated GPUs. Maximum speed. Maximum accuracy.',
    color: '#3B82F6',
    requiresGPU: true
  },
  edge: {
    name: 'Windy Edge',
    emoji: '🛡️',
    tagline: 'Runs Anywhere. No GPU Required.',
    description: 'Five models optimized for laptops, phones, tablets, and older hardware. Fully local, fully private, fully offline.',
    color: '#22C55E',
    requiresGPU: false
  },
  lingua: {
    name: 'Windy Lingua',
    emoji: '🌍',
    tagline: 'Dedicated Language Excellence',
    description: 'Purpose-built models for specific languages. Not a generalist — a specialist.',
    color: '#A855F7',
    requiresGPU: false
  }
};

/**
 * All 15 proprietary Windy Pro models
 * Sizes are approximate .wpr file sizes
 */
const MODEL_CATALOG = [
  // ─── WINDY CORE (GPU-Accelerated) ───
  {
    id: 'core-spark',
    family: 'core',
    name: 'Windy Core Spark',
    shortName: 'Windy Spark',
    sizeMB: 75,
    vramGB: 1,
    ramGB: 4,
    speed: '32x',
    quality: 'Basic',
    languages: 99,
    description: 'Ultra-light GPU model. Lightning fast inference.',
    bestFor: 'Quick dictation, real-time captions, embedded systems',
    tier: 'free' // Available on free tier
  },
  {
    id: 'core-pulse',
    family: 'core',
    name: 'Windy Core Pulse',
    shortName: 'Windy Pulse',
    sizeMB: 142,
    vramGB: 1,
    ramGB: 4,
    speed: '16x',
    quality: 'Good',
    languages: 99,
    description: 'Fast and reliable GPU transcription.',
    bestFor: 'Everyday dictation, emails, casual notes',
    tier: 'plus'
  },
  {
    id: 'core-standard',
    family: 'core',
    name: 'Windy Core Standard',
    shortName: 'Windy Standard',
    sizeMB: 466,
    vramGB: 2,
    ramGB: 8,
    speed: '6x',
    quality: 'Accurate',
    languages: 99,
    description: 'The workhorse. Great accuracy on GPU.',
    bestFor: 'Meetings, technical dictation, content creation',
    tier: 'plus'
  },
  {
    id: 'core-global',
    family: 'core',
    name: 'Windy Core Global',
    shortName: 'Windy Global',
    sizeMB: 1500,
    vramGB: 5,
    ramGB: 16,
    speed: '2x',
    quality: 'High',
    languages: 99,
    description: 'Multilingual powerhouse. Best for non-English and code-switching.',
    bestFor: 'Multilingual users, international meetings, translation prep',
    tier: 'pro'
  },
  {
    id: 'core-pro',
    family: 'core',
    name: 'Windy Core Pro',
    shortName: 'Windy Pro',
    sizeMB: 1500,
    vramGB: 5,
    ramGB: 16,
    speed: '6x',
    quality: 'Excellent',
    languages: 1, // English-optimized
    description: 'Distilled flagship. English excellence at 6x speed.',
    bestFor: 'English power users, professionals, long sessions',
    tier: 'pro'
  },
  {
    id: 'core-turbo',
    family: 'core',
    name: 'Windy Core Turbo',
    shortName: 'Windy Turbo',
    sizeMB: 1600,
    vramGB: 6,
    ramGB: 16,
    speed: '4x',
    quality: 'Excellent',
    languages: 99,
    description: 'Near-Ultra quality at twice the speed.',
    bestFor: 'When you want the best but need it faster',
    tier: 'pro'
  },
  {
    id: 'core-ultra',
    family: 'core',
    name: 'Windy Core Ultra',
    shortName: 'Windy Ultra',
    sizeMB: 2900,
    vramGB: 10,
    ramGB: 24,
    speed: '1x',
    quality: 'Maximum',
    languages: 99,
    description: 'The flagship. Best accuracy in any language. No compromises.',
    bestFor: 'Broadcast, legal, medical, professional, multilingual',
    tier: 'promax',
    badge: '👑 Flagship'
  },

  // ─── WINDY EDGE (CPU, No GPU Required) ───
  {
    id: 'edge-spark',
    family: 'edge',
    name: 'Windy Edge Spark',
    shortName: 'Windy Spark',
    sizeMB: 42,
    vramGB: 0,
    ramGB: 2,
    speed: '32x',
    quality: 'Basic',
    languages: 99,
    description: 'Smallest model. 42 MB. Fits any phone.',
    bestFor: 'Phones, tablets, budget devices, offline emergencies',
    tier: 'free',
    badge: '📱 MoboLoco'
  },
  {
    id: 'edge-pulse',
    family: 'edge',
    name: 'Windy Edge Pulse',
    shortName: 'Windy Pulse',
    sizeMB: 78,
    vramGB: 0,
    ramGB: 3,
    speed: '16x',
    quality: 'Good',
    languages: 99,
    description: 'Phone-optimized. Fast and light.',
    bestFor: 'Mobile dictation, voice memos on the go',
    tier: 'free'
  },
  {
    id: 'edge-standard',
    family: 'edge',
    name: 'Windy Edge Standard',
    shortName: 'Windy Standard',
    sizeMB: 168,
    vramGB: 0,
    ramGB: 4,
    speed: '6x',
    quality: 'Accurate',
    languages: 99,
    description: 'Best balance for laptops and phones with 4GB+ RAM.',
    bestFor: 'Laptop users, coffee shop dictation, everyday use',
    tier: 'plus',
    badge: '⭐ Most Popular'
  },
  {
    id: 'edge-global',
    family: 'edge',
    name: 'Windy Edge Global',
    shortName: 'Windy Global',
    sizeMB: 515,
    vramGB: 0,
    ramGB: 8,
    speed: '2x',
    quality: 'High',
    languages: 99,
    description: 'Multilingual on CPU. Great for travel and translation.',
    bestFor: 'Travelers, multilingual users, translation prep',
    tier: 'pro'
  },
  {
    id: 'edge-pro',
    family: 'edge',
    name: 'Windy Edge Pro',
    shortName: 'Windy Pro',
    sizeMB: 515,
    vramGB: 0,
    ramGB: 8,
    speed: '4x',
    quality: 'Excellent',
    languages: 1, // English-optimized
    description: 'Distilled English excellence on CPU. No GPU needed.',
    bestFor: 'English-first laptop and tablet users',
    tier: 'pro'
  },

  // ─── WINDY LINGUA (Language Specialists) ───
  {
    id: 'lingua-es',
    family: 'lingua',
    name: 'Windy Lingua Español',
    shortName: 'Windy Español',
    sizeMB: 500,
    vramGB: 0,
    ramGB: 6,
    speed: '4x',
    quality: 'Specialist',
    languages: 1,
    languageName: 'Spanish',
    description: 'Purpose-built for Spanish. All dialects — Castilian, Mexican, Caribbean, Andean.',
    bestFor: 'Native Spanish speakers, Spanish-English code-switching',
    tier: 'pro'
  },
  {
    id: 'lingua-fr',
    family: 'lingua',
    name: 'Windy Lingua Français',
    shortName: 'Windy Français',
    sizeMB: 500,
    vramGB: 0,
    ramGB: 6,
    speed: '4x',
    quality: 'Specialist',
    languages: 1,
    languageName: 'French',
    description: 'Purpose-built for French. Metropolitan, Canadian, African dialects.',
    bestFor: 'Native French speakers, French-English environments',
    tier: 'promax'
  },
  {
    id: 'lingua-hi',
    family: 'lingua',
    name: 'Windy Lingua हिन्दी',
    shortName: 'Windy हिन्दी',
    sizeMB: 500,
    vramGB: 0,
    ramGB: 6,
    speed: '4x',
    quality: 'Specialist',
    languages: 1,
    languageName: 'Hindi',
    description: 'Purpose-built for Hindi. Handles Hindi-English code-switching natively.',
    bestFor: 'Hindi speakers, Hinglish environments, Indian professionals',
    tier: 'promax'
  }
];

/**
 * Tier access rules — which models are available at each tier
 */
const TIER_ACCESS = {
  free:    ['core-spark', 'edge-spark', 'edge-pulse'],
  plus:    ['core-spark', 'core-pulse', 'core-standard', 'edge-spark', 'edge-pulse', 'edge-standard'],
  pro:     MODEL_CATALOG.map(m => m.id), // All 15
  promax:  MODEL_CATALOG.map(m => m.id), // All 15 + priority updates
  lifetime: MODEL_CATALOG.map(m => m.id),
  lifetimeplus: MODEL_CATALOG.map(m => m.id)
};

/**
 * Get models available for a given tier
 */
function getModelsForTier(tier) {
  const ids = TIER_ACCESS[tier] || TIER_ACCESS.free;
  return MODEL_CATALOG.filter(m => ids.includes(m.id));
}

/**
 * Get total download size for a set of model IDs (in MB)
 */
function getTotalSize(modelIds) {
  return MODEL_CATALOG
    .filter(m => modelIds.includes(m.id))
    .reduce((sum, m) => sum + m.sizeMB, 0);
}

/**
 * Format size for display
 */
function formatSize(mb) {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

module.exports = { MODEL_FAMILIES, MODEL_CATALOG, TIER_ACCESS, getModelsForTier, getTotalSize, formatSize };
