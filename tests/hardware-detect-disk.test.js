/**
 * @jest-environment node
 *
 * Regression test for the wizard "Storage: 0 GB free" bug.
 *
 * detectDiskSpace was using `df -B1` — a GNU coreutils flag that
 * macOS BSD df rejects with `df: illegal option -- B`. The error
 * was caught and silently returned 0, so the wizard hardware-scan
 * card showed "Storage: 0 GB" on every macOS install.
 *
 * Fix: use `df -k` (1024-byte blocks), portable across BSD + GNU.
 *
 * These tests run on the host directly (no mocking) because the
 * bug only reproduces against a real BSD df. CI runners are Linux
 * and would have masked the bug — that's why it shipped.
 */

'use strict';

const { HardwareDetector } = require('../installer-v2/core/hardware-detect');

describe('HardwareDetector.detectDiskSpace', () => {
  test('returns a positive non-zero number on a host that has free disk', async () => {
    const d = new HardwareDetector();
    const free = await d.detectDiskSpace();
    expect(typeof free).toBe('number');
    expect(Number.isFinite(free)).toBe(true);
    // Any modern dev box has > 1 GB free. If a CI runner has less,
    // the build is in trouble for unrelated reasons.
    expect(free).toBeGreaterThan(1);
  }, 10000);
});
