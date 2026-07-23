// Runtime GPU capability detection for the GPU engine pack.
//
// The transcription engine is faster-whisper/CTranslate2, which accelerates on
// CUDA only. So for v1 the pack is offered ONLY on NVIDIA machines with enough
// VRAM to hold the heaviest pack engine (windy-pro-engine-ct2, ~1.5 GB int8,
// plus activation headroom). Apple Silicon is detected but NOT offered the
// pack: CT2 has no Metal backend — Apple GPU support lands later via CoreML/
// whisper.cpp variants of the same fine-tuned weights (see MODEL_GLOSSARY).
//
// detectGpu() shells out (nvidia-smi / system_profiler); assessGpu() is pure
// so the gate logic is unit-testable without hardware.

const { exec } = require('child_process');
const os = require('os');

const GPU_PACK_MIN_NVIDIA_VRAM_GB = 6;

function execAsync(cmd, timeoutMs = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/**
 * Probe the hardware. Never throws; every failure degrades to 'none'.
 * @returns {Promise<{kind: 'nvidia'|'apple'|'none', name: string, vramGB: number, unifiedGB: number}>}
 */
async function detectGpu() {
  const profile = { kind: 'none', name: '', vramGB: 0, unifiedGB: 0 };

  // NVIDIA first — nvidia-smi exists on any platform with the driver installed.
  const smi = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
  if (smi.trim()) {
    const [name, memMB] = smi.trim().split('\n')[0].split(',').map(s => s.trim());
    profile.kind = 'nvidia';
    profile.name = name || 'NVIDIA GPU';
    profile.vramGB = Math.round((parseInt(memMB, 10) || 0) / 1024);
    return profile;
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    profile.kind = 'apple';
    profile.unifiedGB = Math.round(os.totalmem() / (1024 ** 3));
    const chip = await execAsync("sysctl -n machdep.cpu.brand_string");
    profile.name = chip.trim() || 'Apple Silicon';
    return profile;
  }

  return profile;
}

/**
 * Pure gate: should this machine be offered the GPU pack?
 * @param {{kind: string, vramGB?: number, unifiedGB?: number, name?: string}} profile
 */
function assessGpu(profile) {
  if (!profile || profile.kind === 'none') {
    return { capable: false, kind: 'none', reason: 'No supported GPU detected' };
  }
  if (profile.kind === 'nvidia') {
    if ((profile.vramGB || 0) >= GPU_PACK_MIN_NVIDIA_VRAM_GB) {
      return {
        capable: true, kind: 'nvidia', cudaReady: true,
        reason: `${profile.name} with ${profile.vramGB}GB VRAM — can run the full GPU engine pack`,
      };
    }
    return {
      capable: false, kind: 'nvidia',
      reason: `${profile.name} has ${profile.vramGB}GB VRAM — the pack needs ≥${GPU_PACK_MIN_NVIDIA_VRAM_GB}GB`,
    };
  }
  // Apple Silicon: hardware is plenty capable, but the CT2 engine has no Metal
  // backend yet. Explicitly not offered rather than silently broken.
  return {
    capable: false, kind: 'apple',
    reason: `${profile.name || 'Apple Silicon'} detected — GPU engines arrive with the CoreML runtime`,
  };
}

module.exports = { detectGpu, assessGpu, GPU_PACK_MIN_NVIDIA_VRAM_GB };
