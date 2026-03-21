/**
 * Windy Pro v2.0 — Brand Experience Content
 * Monikers, tips, quotes, feature cards — everything shown during download/install.
 * This is the captive audience content. Make them believers before the install finishes.
 */

/**
 * Moniker carousel — cycles every 8-10 seconds during download
 */
const MONIKERS = [
  { emoji: '🌪️', text: 'No Internet, No Problem.', sub: 'Your voice never leaves your device.' },
  { emoji: '🟢', text: 'The Green Strobe Never Lies.', sub: 'If it\'s green, you\'re recording. Always. No guessing.' },
  { emoji: '🔒', text: 'Stay Local. Stay Private.', sub: 'Unlike competitors who upload your voice to the cloud — we don\'t.' },
  { emoji: '💊', text: 'Get Voice-Pilled.', sub: 'Once you try fully local voice-to-text, you can\'t go back.' },
  { emoji: '🐕', text: '"Windy Pro make me go MoboLoco!"', sub: '406 MB engine on your phone. Runs anywhere, no GPU needed.' },
  { emoji: '💰', text: 'Pay Once. Use Forever.', sub: 'No subscription. No monthly fees. This is yours for life.' },
  { emoji: '🧬', text: 'Talk Today. Live Forever.', sub: 'Build your voice clone dataset automatically while you work.' },
  { emoji: '⌨️', text: 'Never Touch a Keyboard Again.', sub: 'Dictate everything. Paste anywhere. One hotkey.' },
  { emoji: '🌍', text: '99 Languages. Zero Internet.', sub: 'From Arabic to Yoruba — all processed locally on your device.' },
  { emoji: '✝️', text: 'By the Words of His Mouth, the Heavens Were Created.', sub: 'Your voice is the most powerful creation tool you own.' },
  { emoji: '🎤', text: 'It Learns Your Voice.', sub: 'After 2 hours, Windy Pro knows you better than your best friend.' },
  { emoji: '🧠', text: 'WindyTune: It Adapts So You Don\'t Have To.', sub: 'Auto-switches models based on your hardware, battery, and conditions.' },
  { emoji: '✈️', text: 'Airplane Mode? No Problem.', sub: '35,000 feet, no Wi-Fi, perfect transcription. Always.' },
  { emoji: '📱', text: 'One Download. A Partner for Life.', sub: '15 models. One mission. Your words, perfectly.' },
  { emoji: '🏔️', text: 'Zero Bars? No Problem.', sub: 'Mountains, countryside, off-grid — your voice still works.' },
  { emoji: '🔄', text: '16 Engines. One Mission.', sub: 'Your words, perfectly. On any device. In any language.' }
];

/**
 * Feature education cards — shown during download to teach users about features
 */
const FEATURE_CARDS = [
  {
    title: '🌪️ WindyTune — Your Personal AI DJ',
    body: 'WindyTune monitors your hardware every 30 seconds — CPU temperature, available RAM, GPU load, battery level. If your laptop starts thermal throttling, it seamlessly drops to a lighter model. Plug into power? It upgrades. You never notice. You just keep talking.',
    category: 'technology'
  },
  {
    title: '🧬 Soul File — Your Digital Legacy',
    body: 'Every time you use Windy Pro, you\'re building a dataset of your voice — pitch, timbre, rhythm, accent, emotional range. After 50 hours, you have everything needed for a studio-grade voice clone. Imagine: a thousand years from now, your descendants hear YOUR voice.',
    category: 'soul-file'
  },
  {
    title: '🌍 Windy Translate — Paris, Evening, A Café',
    body: 'Hold up your phone. They speak their language. You read yours. You speak yours. They read theirs. No internet. No cloud. No third-party server. Just two people connecting — in any of 99 languages.',
    category: 'translate'
  },
  {
    title: '☁️ Windy Pro Cloud — YOUR Storage',
    body: 'Your privacy is paramount! We never use your data — or data about your data — for anything. Period. Switch to Windy Pro Cloud for all your storage. Cancel Dropbox. Cancel Google. Cancel iCloud. Your files belong to YOU.',
    category: 'cloud'
  },
  {
    title: '🎙️ Voice Fingerprinting — It Knows You',
    body: 'After just 5 minutes, Windy Pro creates a mathematical fingerprint of your voice. After 2 hours, it can pick YOUR words out of a crowded party with music blaring and everyone talking. Your voice. In any crowd. Crystal clear.',
    category: 'technology'
  },
  {
    title: '📹 Build Your AI Avatar',
    body: 'Turn on video archiving and your camera captures your face, expressions, and mannerisms over time. Combined with your voice data, this becomes the foundation for a digital avatar twin that looks, sounds, and moves like you.',
    category: 'soul-file'
  },
  {
    title: '🔒 Truly Private. Not "Trust Us" Private.',
    body: 'Every competitor sends your voice to the cloud. They "promise" it\'s private. We don\'t promise privacy — we engineered it. Your words never leave your device. Zero telemetry. Zero data collection. Zero.',
    category: 'privacy'
  },
  {
    title: '💎 16 Proprietary Engines',
    body: 'Developed by Windy Pro Labs. Fine-tuned by our engineers. Not available anywhere else. From a 73 MB GPU engine to a 9.5 GB CPU flagship — every engine is optimized, encrypted, and continually refined.',
    category: 'technology'
  },
  {
    title: '🐕 MoboLoco — Mobile Local Power',
    body: '406 megabytes for our CPU-optimized Windy Nano. Runs beautifully on any device. Install it and forget it. It\'s always there when you need it. No internet required. Ever.',
    category: 'mobile'
  },
  {
    title: '☁️ Cloud Storage Plans',
    body: 'Free: 500 MB included. Starter: 50 GB for $9/mo. Pro: 250 GB for $19/mo. Business: 1 TB for $49/mo. Enterprise: Custom pricing. Store everything — not just voice files, but all your documents, photos, and files. Your privacy is paramount!',
    category: 'cloud'
  },
  {
    title: '📊 Your Soul File Journey',
    body: '5 hours → Basic voice profile. 20 hours → Good voice clone quality. 50 hours → Studio-grade clone ready. 200 hours → Full digital twin: voice + avatar + personality. ♾️ → Your legacy, preserved forever.',
    category: 'soul-file'
  },
  {
    title: '🐧 Linux? We Love Linux.',
    body: 'Windows, macOS, AND Linux. Every major operating system. No one gets left out. Linux users are loyal and vocal — and we\'re proud to have you. Full feature parity. No compromises.',
    category: 'platform'
  },
  {
    title: '💳 Pricing That Respects You',
    body: 'Free to start. Windy Pro: $99 lifetime or $49/yr or $4.99/mo. Windy Ultra: $199 lifetime or $79/yr or $8.99/mo. Windy Max: $299 lifetime or $149/yr or $14.99/mo. Pay once, own forever. No tricks.',
    category: 'pricing'
  },
  {
    title: '🔐 Model Security',
    body: 'Every model is encrypted in our proprietary .wpr format. Fingerprinted to your account. Steganographically watermarked. If anyone tries to extract or redistribute our models, we can trace it back to the exact account. And our Terms of Service are very clear about that.',
    category: 'security'
  }
];

/**
 * Creation/divine quotes — interspersed for atmosphere
 */
const CREATION_QUOTES = [
  'And God said, "Let there be light." And there was Windy Pro.',
  'In the beginning was the Word.',
  'By the words of His mouth, the heavens were created.',
  'Your voice is the most ancient and powerful tool of creation.',
  'Speak, and let there be. 🌪️',
  'You\'ll be separating the heavens and the earth in no time.',
  'Parting the Red Sea of bad transcription since 2026.',
  'Let there be voice-to-text. And it was good.',
  'You\'ll be moving mountains with your voice before you know it.'
];

/**
 * Fun loading messages — shown alongside technical progress
 */
const LOADING_MESSAGES = [
  'Tuning the tornado...',
  'Teaching the AI your language...',
  'Calibrating the Green Strobe...',
  'Warming up the voice engine...',
  'Polishing the crystal ball...',
  'Sharpening the transcription pencil...',
  'Downloading wisdom from the cloud (this is the last time we touch the cloud, promise)...',
  'Building your private voice fortress...',
  'Preparing to never need internet again...',
  'Setting up your keyboard retirement plan...',
  'Activating MoboLoco mode... 🐕',
  'Preparing the Soul File vault...',
  'Loading 99 languages into your pocket...',
  'Encrypting your models with military-grade security...',
  'WindyTune is analyzing your hardware...',
  'Almost ready to get you voice-pilled... 💊'
];

/**
 * Installation step descriptions — the "tell them what you're doing" messages
 */
const INSTALL_STEP_MESSAGES = {
  'detect-hardware': {
    title: '🔍 Scanning Your Hardware',
    detail: 'We\'re checking your CPU, RAM, GPU, and storage to find the perfect model configuration for YOUR machine.',
    tip: 'Every device gets a great experience. WindyTune customizes everything.'
  },
  'check-deps': {
    title: '🌪️ Preparing the Windy Ecosystem',
    detail: 'Setting up everything Windy Pro needs to transform your voice into text. Prepare to get Windy, baby!',
    tip: 'We bundle everything. No chasing downloads. No terminal commands. That\'s Windy.'
  },
  'install-python': {
    title: '🌪️ Setting Up the Windy Engine Room',
    detail: 'Building your private Windy voice processing environment. Everything stays inside Windy Pro — isolated, secure, yours.',
    tip: 'Your system stays clean. The Windy ecosystem lives in its own space.'
  },
  'install-ffmpeg': {
    title: '🎙️ Configuring Windy Audio Capture',
    detail: 'Setting up the Windy audio pipeline — the bridge between your microphone and our 15 voice engines.',
    tip: 'Broadcast-quality audio processing. That\'s Windy.'
  },
  'install-cuda': {
    title: '⚡ Activating Windy GPU Turbo Mode',
    detail: 'Your NVIDIA GPU is about to make Windy fly. Real-time transcription at GPU speed.',
    tip: 'GPU + Windy Core = instant transcription. That\'s WINDY, baby! 🌪️'
  },
  'download-model': {
    title: '🧠 Downloading Windy Pro Engine',
    detail: 'Pulling your engine from WindyLabs on HuggingFace. This engine was fine-tuned by our team specifically for Windy Pro.',
    tip: 'Engines are optimized for local, private transcription. Nobody else has these configurations.'
  },
  'verify': {
    title: '✅ Verifying Installation',
    detail: 'Running a quick test to make sure everything works perfectly.',
    tip: 'We test before you test. Quality is non-negotiable.'
  },
  'permissions': {
    title: '🔑 Setting Up Permissions',
    detail: 'Requesting microphone access and any platform-specific permissions needed.',
    tip: 'Microphone access stays local. We never transmit audio anywhere.'
  },
  'complete': {
    title: '🌪️ You\'re Ready!',
    detail: 'Windy Pro is installed and ready to go. The Green Strobe awaits.',
    tip: 'Press Ctrl+Shift+Space to start recording. The Green Strobe never lies.'
  }
};

/**
 * Get a random moniker for the carousel
 */
function getRandomMoniker(excludeIndex = -1) {
  let idx;
  do {
    idx = Math.floor(Math.random() * MONIKERS.length);
  } while (idx === excludeIndex && MONIKERS.length > 1);
  return { ...MONIKERS[idx], index: idx };
}

/**
 * Get a random feature card
 */
function getRandomFeatureCard(excludeIndex = -1) {
  let idx;
  do {
    idx = Math.floor(Math.random() * FEATURE_CARDS.length);
  } while (idx === excludeIndex && FEATURE_CARDS.length > 1);
  return { ...FEATURE_CARDS[idx], index: idx };
}

/**
 * Get a random creation quote
 */
function getRandomQuote() {
  return CREATION_QUOTES[Math.floor(Math.random() * CREATION_QUOTES.length)];
}

/**
 * Get a random loading message
 */
function getRandomLoadingMessage() {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

module.exports = {
  MONIKERS,
  FEATURE_CARDS,
  CREATION_QUOTES,
  LOADING_MESSAGES,
  INSTALL_STEP_MESSAGES,
  getRandomMoniker,
  getRandomFeatureCard,
  getRandomQuote,
  getRandomLoadingMessage
};
