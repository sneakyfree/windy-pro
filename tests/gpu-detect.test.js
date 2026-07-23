// lib/gpu-detect.js — the GPU engine pack gate. assessGpu() is pure so the
// offer logic is testable without hardware.

const { assessGpu, GPU_PACK_MIN_NVIDIA_VRAM_GB } = require('../src/client/desktop/lib/gpu-detect');

describe('gpu-detect assessGpu', () => {
  test('NVIDIA with enough VRAM is capable and CUDA-ready', () => {
    const v = assessGpu({ kind: 'nvidia', name: 'RTX 4070', vramGB: 12 });
    expect(v.capable).toBe(true);
    expect(v.cudaReady).toBe(true);
  });

  test('NVIDIA below the VRAM floor is not offered', () => {
    const v = assessGpu({ kind: 'nvidia', name: 'GTX 1650', vramGB: 4 });
    expect(v.capable).toBe(false);
    expect(v.reason).toContain(`${GPU_PACK_MIN_NVIDIA_VRAM_GB}GB`);
  });

  test('Apple Silicon is detected but never offered (no CT2 Metal backend)', () => {
    const v = assessGpu({ kind: 'apple', name: 'Apple M4', unifiedGB: 16 });
    expect(v.capable).toBe(false);
    expect(v.kind).toBe('apple');
  });

  test('no GPU / missing profile degrade safely', () => {
    expect(assessGpu({ kind: 'none' }).capable).toBe(false);
    expect(assessGpu(null).capable).toBe(false);
    expect(assessGpu(undefined).capable).toBe(false);
  });
});
