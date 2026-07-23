// lib/engine-catalog.js — the canonical STT engine ladder + legacy mapping.
// Guards the invariants whose violation caused the 2026-07-23 hand-test bug:
// WindyTune ran whisper `base` while the badge claimed "Windy Core".

const catalog = require('../src/client/desktop/lib/engine-catalog');

describe('engine-catalog', () => {
  test('ladder is the 7 lean ct2 engines, fastest → most accurate', () => {
    expect(catalog.LADDER.map(e => e.model)).toEqual([
      'windy-nano-ct2', 'windy-lite-ct2', 'windy-core-ct2', 'windy-edge-ct2',
      'windy-plus-ct2', 'windy-turbo-ct2', 'windy-pro-engine-ct2',
    ]);
    for (const e of catalog.LADDER) {
      expect(e.engineId).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.size).toBeTruthy();
    }
  });

  test('legacy names map by architecture — base is Lite, small is Core (never shifted up)', () => {
    // The old MODEL_INFO alias block was shifted one rung up (base → "Windy
    // Core"), which produced the false engine badge. Pin the honest mapping.
    expect(catalog.canonicalModelId('tiny')).toBe('windy-nano-ct2');
    expect(catalog.canonicalModelId('base')).toBe('windy-lite-ct2');
    expect(catalog.canonicalModelId('small')).toBe('windy-core-ct2');
    expect(catalog.canonicalModelId('medium')).toBe('windy-edge-ct2');
    expect(catalog.canonicalModelId('large-v3')).toBe('windy-pro-engine-ct2');
    expect(catalog.canonicalModelId('turbo')).toBe('windy-turbo-ct2');
  });

  test('canonicalModelId accepts ct2 ids, .en variants, and faster-whisper-* dir names', () => {
    expect(catalog.canonicalModelId('windy-core-ct2')).toBe('windy-core-ct2');
    expect(catalog.canonicalModelId('base.en')).toBe('windy-lite-ct2');
    expect(catalog.canonicalModelId('faster-whisper-base')).toBe('windy-lite-ct2');
    expect(catalog.canonicalModelId('not-a-model')).toBeNull();
    expect(catalog.canonicalModelId(null)).toBeNull();
    expect(catalog.canonicalModelId(undefined)).toBeNull();
  });

  test('displayForModel never dresses a non-ladder model up as a Windy engine', () => {
    expect(catalog.displayForModel('windy-core-ct2')).toEqual(
      { name: 'Windy Core', size: '234 MB', engineId: 'windy-core' });
    const legacy = catalog.displayForModel('base');
    expect(legacy.engineId).toBeNull();
    expect(legacy.name).not.toMatch(/^Windy /);
    expect(legacy.name).toContain('base');
  });

  test('every legacy mapping target exists on the ladder', () => {
    const models = new Set(catalog.LADDER.map(e => e.model));
    for (const target of Object.values(catalog.LEGACY_MODEL_MAP)) {
      expect(models.has(target)).toBe(true);
    }
  });

  test('GPU pack is a subset of the ladder and excludes clinic-flagged engines', () => {
    const models = new Set(catalog.LADDER.map(e => e.model));
    for (const m of catalog.GPU_PACK.models) {
      expect(models.has(m)).toBe(true);
      expect(catalog.GPU_PACK.downloadMB[m]).toBeGreaterThan(0);
    }
    // windy-edge (eval 4.81) and windy-lite (4.18) are known-regressed per
    // docs/MODEL_GLOSSARY.json — they must never ship in the pack.
    expect(catalog.GPU_PACK.models).not.toContain('windy-edge-ct2');
    expect(catalog.GPU_PACK.models).not.toContain('windy-lite-ct2');
  });

  test('every ladder model has an HF repo pointer for download-on-demand', () => {
    for (const e of catalog.LADDER) {
      expect(catalog.HF_REPO_FOR_MODEL[e.model]).toMatch(/^WindyProLabs\//);
    }
  });
});
