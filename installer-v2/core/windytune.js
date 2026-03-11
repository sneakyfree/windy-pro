/**
 * Windy Pro v2.0 — WindyTune Recommendation & Auto-Switching Engine
 * "It Adapts So You Don't Have To." 🌪️
 *
 * THREE MODES:
 * - Automatic (default): WindyTune monitors hardware and auto-switches engines
 * - Manual: User picks one engine, no auto-switching
 * - Hybrid: User sets a range, WindyTune optimizes within it
 *
 * AUTO-SWITCHING TRIGGERS:
 * - GPU temperature >85°C → switch to CPU variant
 * - Transcription latency >10s → downgrade to smaller engine
 * - Latency <3s and quality could improve → upgrade to larger engine
 * - Battery low (<20%) → switch to more efficient engine
 * - Available RAM drops below engine requirement → downgrade
 *
 * Notifies user when switching: "WindyTune: Switched to Windy Turbo for better quality ⚡"
 */

const { ENGINE_CATALOG, ENGINE_FAMILIES, getTotalSize, formatSize } = require('./models');

/**
 * WindyTune operating modes
 */
const WINDYTUNE_MODES = {
  AUTOMATIC: 'automatic',  // Full auto-switching based on conditions
  MANUAL: 'manual',        // User picks, no switching
  HYBRID: 'hybrid'         // User sets range, WindyTune optimizes within
};

/**
 * Thresholds for auto-switching decisions
 */
const THRESHOLDS = {
  GPU_TEMP_HIGH: 85,           // °C - switch to CPU variant
  GPU_TEMP_NORMAL: 75,         // °C - can switch back to GPU
  LATENCY_HIGH: 10,            // seconds - downgrade engine
  LATENCY_LOW: 3,              // seconds - upgrade engine
  BATTERY_LOW: 20,             // % - switch to efficient engine
  BATTERY_NORMAL: 50,          // % - can switch back
  RAM_RESERVE_GB: 2,           // GB - keep this much free
  CHECK_INTERVAL_MS: 30000     // 30 seconds between checks
};

/**
 * Device classification based on hardware
 */
function classifyDevice(hardware) {
  const { cpu, ram, gpu, battery, platform } = hardware;

  // Mobile (Android/iOS)
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
 * Recommend engines based on hardware profile
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
      recommended = ['windy-stt-nano-cpu', 'windy-stt-lite-cpu'];
      optional = ['windy-stt-core-cpu'];
      explanation = `Your phone is perfect for our lightweight CPU engines. ${formatSize(getTotalSize(recommended))} total — smaller than most selfies combined. Go MoboLoco! 🐕`;
      break;

    case 'desktop-gpu-heavy':
      // Beast mode — 8+ GB VRAM, recommend GPU powerhouses
      recommended = ['windy-stt-core', 'windy-stt-turbo', 'windy-stt-pro'];
      optional = ['windy-stt-edge', 'windy-stt-plus', 'windy-stt-nano', 'windy-stt-lite'];
      explanation = `${gpu.name} with ${gpu.vramGB} GB VRAM — you've got a powerhouse. We recommend Windy Core as your default. WindyTune will auto-switch between engines based on workload and temperature. Maximum everything. 🚀`;
      break;

    case 'desktop-gpu':
      // 4-8 GB VRAM
      recommended = ['windy-stt-core', 'windy-stt-lite', 'windy-stt-edge'];
      optional = ['windy-stt-turbo', 'windy-stt-plus', 'windy-stt-nano'];
      explanation = `${gpu.name} with ${gpu.vramGB} GB VRAM — solid GPU. Windy Core is your daily driver. WindyTune switches to lighter engines when your GPU is busy or gets hot.`;
      break;

    case 'desktop-apple':
      // Apple Silicon desktop with unified memory
      recommended = ['windy-stt-core', 'windy-stt-turbo', 'windy-stt-lite'];
      optional = ['windy-stt-edge', 'windy-stt-plus', 'windy-stt-nano'];
      explanation = `${gpu.name} with ${ram.totalGB} GB unified memory — Apple Silicon runs our engines beautifully via Metal GPU acceleration. Near-desktop-GPU performance, completely silent.`;
      break;

    case 'laptop-gpu':
      recommended = ['windy-stt-core', 'windy-stt-lite', 'windy-stt-core-cpu'];
      optional = ['windy-stt-turbo', 'windy-stt-lite-cpu', 'windy-stt-edge'];
      explanation = `Your laptop has a dedicated GPU — you get GPU-accelerated engines for when you're plugged in, and CPU variants for battery mode. WindyTune switches automatically based on power and temperature.`;
      break;

    case 'laptop-apple':
      recommended = ['windy-stt-core', 'windy-stt-lite', 'windy-stt-core-cpu'];
      optional = ['windy-stt-turbo', 'windy-stt-edge', 'windy-stt-lite-cpu'];
      explanation = `Apple Silicon runs our engines with Metal GPU acceleration. Windy Core is your daily driver. WindyTune drops to CPU engines when battery is low or temperature rises.`;
      break;

    case 'laptop-powerful':
      // 16+ GB RAM, no GPU
      recommended = ['windy-stt-core-cpu', 'windy-stt-lite-cpu', 'windy-stt-edge-cpu'];
      optional = ['windy-stt-turbo-cpu', 'windy-stt-plus-cpu', 'windy-stt-nano-cpu'];
      explanation = `${ram.totalGB} GB RAM gives you room for our mid-range CPU engines. Windy Core (CPU) will be your daily driver — great accuracy, no GPU needed. WindyTune adapts when RAM gets tight.`;
      break;

    case 'laptop-standard':
      // 8-16 GB RAM
      recommended = ['windy-stt-core-cpu', 'windy-stt-lite-cpu', 'windy-stt-nano-cpu'];
      optional = ['windy-stt-edge-cpu'];
      explanation = `${ram.totalGB} GB RAM — Windy Core (CPU) and Windy Lite (CPU) are perfect for your hardware. Great accuracy, efficient on CPU. WindyTune switches to Nano if memory gets tight.`;
      break;

    case 'laptop-light':
      // Under 8 GB
      recommended = ['windy-stt-nano-cpu', 'windy-stt-lite-cpu'];
      optional = ['windy-stt-core-cpu'];
      explanation = `With ${ram.totalGB} GB RAM, our lightweight CPU engines are your best bet. Windy Nano (CPU) is only 406 MB and runs beautifully on any hardware. No internet, no problem.`;
      break;

    case 'desktop-cpu':
      // Desktop, no GPU, good RAM
      recommended = ['windy-stt-core-cpu', 'windy-stt-edge-cpu', 'windy-stt-lite-cpu'];
      optional = ['windy-stt-turbo-cpu', 'windy-stt-plus-cpu', 'windy-stt-nano-cpu'];
      explanation = `No GPU detected, but ${ram.totalGB} GB RAM means our CPU lineup runs great. Windy Core (CPU) gives you excellent accuracy without a GPU.`;
      break;

    case 'desktop-light':
    case 'desktop-minimal':
      recommended = ['windy-stt-nano-cpu', 'windy-stt-lite-cpu'];
      optional = ['windy-stt-core-cpu'];
      explanation = `We'll start you with our most efficient engines. Small footprint, fast performance. You can always add more later.`;
      break;

    default:
      recommended = ['windy-stt-nano-cpu', 'windy-stt-lite-cpu', 'windy-stt-core-cpu'];
      optional = [];
      explanation = 'WindyTune selected a balanced set of engines for your hardware.';
  }

  // Filter by available disk space — don't recommend more than 60% of free space
  const maxMB = disk.freeGB * 1024 * 0.6;
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
 * WindyTune Auto-Switching Logic
 * Monitors system conditions and recommends engine switches
 */
class WindyTune {
  constructor(mode = WINDYTUNE_MODES.AUTOMATIC) {
    this.mode = mode;
    this.currentEngineId = null;
    this.availableEngineIds = [];
    this.userMinEngineId = null;  // For hybrid mode
    this.userMaxEngineId = null;  // For hybrid mode
    this.lastCheck = null;
    this.switchHistory = [];
  }

  /**
   * Set available engines (what user has downloaded)
   */
  setAvailableEngines(engineIds) {
    this.availableEngineIds = engineIds;
  }

  /**
   * Set current active engine
   */
  setCurrentEngine(engineId) {
    this.currentEngineId = engineId;
  }

  /**
   * Set hybrid mode range
   */
  setHybridRange(minEngineId, maxEngineId) {
    this.userMinEngineId = minEngineId;
    this.userMaxEngineId = maxEngineId;
  }

  /**
   * Check if it's time to evaluate conditions
   */
  shouldCheck() {
    if (!this.lastCheck) return true;
    return Date.now() - this.lastCheck >= THRESHOLDS.CHECK_INTERVAL_MS;
  }

  /**
   * Evaluate conditions and recommend engine switch if needed
   * @param {object} conditions - { gpuTemp, latency, batteryPercent, freeRAMGB, gpuLoad }
   * @returns {object|null} { switchTo, reason } or null if no switch needed
   */
  evaluate(conditions) {
    if (this.mode === WINDYTUNE_MODES.MANUAL) {
      return null; // Manual mode = no auto-switching
    }

    if (!this.shouldCheck()) {
      return null;
    }

    this.lastCheck = Date.now();

    const { gpuTemp, latency, batteryPercent, freeRAMGB, gpuLoad } = conditions;
    const currentEngine = ENGINE_CATALOG.find(e => e.id === this.currentEngineId);
    if (!currentEngine) return null;

    // Priority 1: GPU temperature critical → switch to CPU variant
    if (gpuTemp && gpuTemp > THRESHOLDS.GPU_TEMP_HIGH && currentEngine.family === 'gpu') {
      const cpuVariant = this.findCPUVariant(currentEngine);
      if (cpuVariant) {
        return {
          switchTo: cpuVariant.id,
          reason: `GPU temperature ${gpuTemp}°C — switching to CPU variant to cool down`,
          emoji: '🔥→🛡️'
        };
      }
    }

    // Priority 2: RAM critically low → downgrade
    if (freeRAMGB < THRESHOLDS.RAM_RESERVE_GB) {
      const smaller = this.findSmallerEngine(currentEngine);
      if (smaller) {
        return {
          switchTo: smaller.id,
          reason: `Low RAM (${freeRAMGB.toFixed(1)} GB free) — switching to lighter engine`,
          emoji: '⚠️'
        };
      }
    }

    // Priority 3: Latency too high → downgrade
    if (latency && latency > THRESHOLDS.LATENCY_HIGH) {
      const faster = this.findFasterEngine(currentEngine);
      if (faster) {
        return {
          switchTo: faster.id,
          reason: `High latency (${latency.toFixed(1)}s) — switching to faster engine`,
          emoji: '🐌→⚡'
        };
      }
    }

    // Priority 4: Battery low → switch to efficient engine
    if (batteryPercent && batteryPercent < THRESHOLDS.BATTERY_LOW && currentEngine.family === 'gpu') {
      const cpuVariant = this.findCPUVariant(currentEngine);
      if (cpuVariant) {
        return {
          switchTo: cpuVariant.id,
          reason: `Battery low (${batteryPercent}%) — switching to CPU for efficiency`,
          emoji: '🔋'
        };
      }
    }

    // Opportunistic: Latency low and conditions good → upgrade quality
    if (
      latency && latency < THRESHOLDS.LATENCY_LOW &&
      (!batteryPercent || batteryPercent > THRESHOLDS.BATTERY_NORMAL) &&
      (!gpuTemp || gpuTemp < THRESHOLDS.GPU_TEMP_NORMAL) &&
      freeRAMGB > THRESHOLDS.RAM_RESERVE_GB + 2
    ) {
      const better = this.findBetterQualityEngine(currentEngine);
      if (better) {
        return {
          switchTo: better.id,
          reason: `Conditions optimal — upgrading to ${better.displayName} for better quality`,
          emoji: '⚡'
        };
      }
    }

    // Conditions normalized → switch back to GPU if on CPU
    if (
      currentEngine.family === 'cpu' &&
      (!gpuTemp || gpuTemp < THRESHOLDS.GPU_TEMP_NORMAL) &&
      (!batteryPercent || batteryPercent > THRESHOLDS.BATTERY_NORMAL)
    ) {
      const gpuVariant = this.findGPUVariant(currentEngine);
      if (gpuVariant) {
        return {
          switchTo: gpuVariant.id,
          reason: `Conditions normalized — switching back to GPU for better performance`,
          emoji: '🛡️→⚡'
        };
      }
    }

    return null; // No switch needed
  }

  /**
   * Find CPU variant of current engine
   */
  findCPUVariant(currentEngine) {
    if (currentEngine.family !== 'gpu') return null;
    const cpuId = `${currentEngine.id}-cpu`;
    const cpuEngine = ENGINE_CATALOG.find(e => e.id === cpuId);
    if (cpuEngine && this.isInRange(cpuEngine) && this.availableEngineIds.includes(cpuEngine.id)) {
      return cpuEngine;
    }
    return null;
  }

  /**
   * Find GPU variant of current engine
   */
  findGPUVariant(currentEngine) {
    if (currentEngine.family !== 'cpu') return null;
    const gpuId = currentEngine.id.replace('-cpu', '');
    const gpuEngine = ENGINE_CATALOG.find(e => e.id === gpuId);
    if (gpuEngine && this.isInRange(gpuEngine) && this.availableEngineIds.includes(gpuEngine.id)) {
      return gpuEngine;
    }
    return null;
  }

  /**
   * Find smaller/lighter engine in same family
   */
  findSmallerEngine(currentEngine) {
    const sameFamilyEngines = ENGINE_CATALOG
      .filter(e =>
        e.family === currentEngine.family &&
        e.sizeMB < currentEngine.sizeMB &&
        this.isInRange(e) &&
        this.availableEngineIds.includes(e.id)
      )
      .sort((a, b) => b.sizeMB - a.sizeMB); // Largest smaller one first

    return sameFamilyEngines[0] || null;
  }

  /**
   * Find faster engine (higher speedRating)
   */
  findFasterEngine(currentEngine) {
    const fasterEngines = ENGINE_CATALOG
      .filter(e =>
        e.family === currentEngine.family &&
        e.speedRating > currentEngine.speedRating &&
        this.isInRange(e) &&
        this.availableEngineIds.includes(e.id)
      )
      .sort((a, b) => b.speedRating - a.speedRating); // Fastest first

    return fasterEngines[0] || null;
  }

  /**
   * Find better quality engine
   */
  findBetterQualityEngine(currentEngine) {
    const betterEngines = ENGINE_CATALOG
      .filter(e =>
        e.family === currentEngine.family &&
        e.quality > currentEngine.quality &&
        this.isInRange(e) &&
        this.availableEngineIds.includes(e.id)
      )
      .sort((a, b) => a.quality - b.quality); // Smallest upgrade first

    return betterEngines[0] || null;
  }

  /**
   * Check if engine is in user-specified range (for hybrid mode)
   */
  isInRange(engine) {
    if (this.mode !== WINDYTUNE_MODES.HYBRID) return true;

    const minEngine = ENGINE_CATALOG.find(e => e.id === this.userMinEngineId);
    const maxEngine = ENGINE_CATALOG.find(e => e.id === this.userMaxEngineId);

    if (!minEngine || !maxEngine) return true;

    // Must be in same family and between min/max quality
    return (
      engine.family === minEngine.family &&
      engine.quality >= minEngine.quality &&
      engine.quality <= maxEngine.quality
    );
  }

  /**
   * Record a switch event
   */
  recordSwitch(fromEngineId, toEngineId, reason) {
    this.switchHistory.push({
      timestamp: Date.now(),
      from: fromEngineId,
      to: toEngineId,
      reason
    });

    // Keep only last 100 switches
    if (this.switchHistory.length > 100) {
      this.switchHistory.shift();
    }
  }

  /**
   * Get switch statistics
   */
  getStats() {
    return {
      mode: this.mode,
      currentEngine: this.currentEngineId,
      totalSwitches: this.switchHistory.length,
      recentSwitches: this.switchHistory.slice(-10)
    };
  }
}

/**
 * Estimate download time for a set of engines
 */
function estimateDownloadTime(engineIds, speedMBps) {
  const totalMB = getTotalSize(engineIds);
  if (speedMBps <= 0) return 'Unknown';
  const seconds = totalMB / speedMBps;
  if (seconds < 60) return `~${Math.ceil(seconds)} seconds`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} minutes`;
  return `~${(seconds / 3600).toFixed(1)} hours`;
}

module.exports = {
  WindyTune,
  WINDYTUNE_MODES,
  THRESHOLDS,
  recommend,
  classifyDevice,
  estimateDownloadTime
};
