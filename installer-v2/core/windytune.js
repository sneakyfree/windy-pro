/**
 * Windy Pro v2.0 — WindyTune Recommendation Engine
 * Takes a hardware profile and recommends the optimal model set.
 * 
 * "WindyTune: It Adapts So You Don't Have To." 🌪️
 */

const { MODEL_CATALOG, MODEL_FAMILIES, getTotalSize, formatSize } = require('./models');

/**
 * Device classification based on hardware
 */
function classifyDevice(hardware) {
  const { cpu, ram, gpu, battery, platform } = hardware;

  // Mobile (Android/iOS would set this explicitly, but detect from specs too)
  if (platform === 'android' || platform === 'ios') {
    return 'phone';
  }

  // Desktop with powerful GPU
  if (gpu.nvidia && gpu.vramGB >= 8) return 'desktop-gpu-heavy';
  if (gpu.nvidia && gpu.vramGB >= 4) return 'desktop-gpu';
  if (gpu.appleSilicon && ram.totalGB >= 16) return 'desktop-apple';

  // Laptop (has battery)
  if (battery.hasBattery) {
    if (gpu.nvidia && gpu.vramGB >= 4) return 'laptop-gpu';
    if (gpu.appleSilicon) return 'laptop-apple';
    if (ram.totalGB >= 16) return 'laptop-powerful';
    if (ram.totalGB >= 8) return 'laptop-standard';
    return 'laptop-light';
  }

  // Desktop without GPU
  if (ram.totalGB >= 16) return 'desktop-cpu';
  if (ram.totalGB >= 8) return 'desktop-light';
  return 'desktop-minimal';
}

/**
 * Recommend models based on hardware profile
 * Returns: { recommended: [...ids], optional: [...ids], deviceType, explanation }
 */
function recommend(hardware) {
  const deviceType = classifyDevice(hardware);
  const { ram, gpu, disk } = hardware;
  let recommended = [];
  let optional = [];
  let explanation = '';

  switch (deviceType) {
    case 'phone':
      recommended = ['edge-spark', 'edge-pulse'];
      optional = ['edge-standard'];
      explanation = `Your phone is perfect for our lightweight Edge models. ${formatSize(getTotalSize(recommended))} total — smaller than most selfies combined. Go MoboLoco! 🐕`;
      break;

    case 'desktop-gpu-heavy':
      // Beast mode — 8+ GB VRAM, recommend everything heavy
      recommended = ['core-ultra', 'core-turbo', 'core-pro', 'core-global', 'core-standard'];
      optional = ['core-pulse', 'core-spark', 'edge-standard', 'lingua-es', 'lingua-fr', 'lingua-hi'];
      explanation = `${gpu.name} with ${gpu.vramGB} GB VRAM — you've got a powerhouse. We're giving you the full flagship experience. WindyTune will swap between models based on what you're doing. Maximum everything. 🚀`;
      break;

    case 'desktop-gpu':
      // 4-8 GB VRAM
      recommended = ['core-turbo', 'core-pro', 'core-standard', 'core-pulse'];
      optional = ['core-ultra', 'core-global', 'edge-standard', 'lingua-es', 'lingua-fr', 'lingua-hi'];
      explanation = `${gpu.name} with ${gpu.vramGB} GB VRAM — solid GPU. Core Turbo and Pro will be your daily drivers. WindyTune switches to lighter models when your GPU is busy with other tasks.`;
      break;

    case 'desktop-apple':
      // Apple Silicon desktop/laptop with good RAM
      recommended = ['core-turbo', 'core-standard', 'core-pulse', 'edge-standard'];
      optional = ['core-ultra', 'core-pro', 'core-global', 'lingua-es', 'lingua-fr', 'lingua-hi'];
      explanation = `${gpu.name} with ${ram.totalGB} GB unified memory — Apple Silicon runs our models beautifully via Metal GPU acceleration. Near-desktop-GPU performance, completely silent.`;
      break;

    case 'laptop-gpu':
      recommended = ['core-standard', 'core-pro', 'core-pulse', 'edge-standard'];
      optional = ['core-turbo', 'core-global', 'edge-pulse'];
      explanation = `Your laptop has a dedicated GPU — you get GPU-accelerated Core models for when you're plugged in, and lighter Edge models for battery mode. WindyTune switches automatically.`;
      break;

    case 'laptop-apple':
      recommended = ['core-standard', 'core-pulse', 'edge-standard', 'edge-pulse'];
      optional = ['core-turbo', 'core-pro', 'edge-global'];
      explanation = `Apple Silicon runs our models with Metal GPU acceleration. Core Standard is your daily driver. WindyTune drops to Edge models when battery is low.`;
      break;

    case 'laptop-powerful':
      // 16+ GB RAM, no GPU
      recommended = ['edge-standard', 'edge-global', 'edge-pro', 'edge-pulse'];
      optional = ['edge-spark', 'core-standard', 'lingua-es', 'lingua-fr', 'lingua-hi'];
      explanation = `${ram.totalGB} GB RAM gives you room for our mid-range Edge models. Edge Standard will be your daily driver — great accuracy, no GPU needed. WindyTune adapts when RAM gets tight.`;
      break;

    case 'laptop-standard':
      // 8-16 GB RAM
      recommended = ['edge-standard', 'edge-pulse', 'edge-spark'];
      optional = ['edge-global', 'edge-pro'];
      explanation = `${ram.totalGB} GB RAM — Edge Standard and Pulse are perfect for your hardware. Great accuracy, efficient on CPU. WindyTune switches to Spark if memory gets tight.`;
      break;

    case 'laptop-light':
      // Under 8 GB
      recommended = ['edge-spark', 'edge-pulse'];
      optional = ['edge-standard'];
      explanation = `With ${ram.totalGB} GB RAM, our lightweight Edge models are your best bet. Edge Spark is only 42 MB and runs beautifully on any hardware. No internet, no problem.`;
      break;

    case 'desktop-cpu':
      // Desktop, no GPU, good RAM
      recommended = ['edge-standard', 'edge-global', 'edge-pro', 'edge-pulse'];
      optional = ['edge-spark', 'lingua-es', 'lingua-fr', 'lingua-hi'];
      explanation = `No GPU detected, but ${ram.totalGB} GB RAM means our Edge lineup runs great on your CPU. Edge Pro gives you near-flagship English accuracy without a GPU.`;
      break;

    case 'desktop-light':
    case 'desktop-minimal':
      recommended = ['edge-spark', 'edge-pulse'];
      optional = ['edge-standard'];
      explanation = `We'll start you with our most efficient models. Small footprint, fast performance. You can always add more later.`;
      break;

    default:
      recommended = ['edge-spark', 'edge-pulse', 'edge-standard'];
      optional = [];
      explanation = 'WindyTune selected a balanced set of models for your hardware.';
  }

  // Filter by available disk space — don't recommend more than 80% of free space
  const maxMB = disk.freeGB * 1024 * 0.8;
  let recSize = getTotalSize(recommended);
  while (recSize > maxMB && recommended.length > 1) {
    recommended.pop();
    recSize = getTotalSize(recommended);
  }

  return {
    recommended,
    optional,
    deviceType,
    explanation,
    totalSizeMB: getTotalSize(recommended),
    totalSizeFormatted: formatSize(getTotalSize(recommended)),
    allSelectedSizeMB: getTotalSize([...recommended, ...optional]),
    allSelectedSizeFormatted: formatSize(getTotalSize([...recommended, ...optional]))
  };
}

/**
 * Estimate download time for a set of models
 */
function estimateDownloadTime(modelIds, speedMBps) {
  const totalMB = getTotalSize(modelIds);
  if (speedMBps <= 0) return 'Unknown';
  const seconds = totalMB / speedMBps;
  if (seconds < 60) return `~${Math.ceil(seconds)} seconds`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} minutes`;
  return `~${(seconds / 3600).toFixed(1)} hours`;
}

module.exports = { recommend, classifyDevice, estimateDownloadTime };
