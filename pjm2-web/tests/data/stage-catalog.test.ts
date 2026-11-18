// Per-stage data loading + catalogue integrity (multi-stage plumbing).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { headlessWaveManagerView, loadStageMainContract, loadWaveResource } from '../../src/data/waveResource';
import { STAGE_CATALOG, STAGE_COUNT, nextStage, stageByNumber, stageByScene, stageConfigFor, stageFromSearch } from '../../src/data/stageCatalog';

const ROOT = resolve(__dirname, '../..');
const DATA = resolve(ROOT, 'public/assets/data');
const DECOMP = resolve(ROOT, '../decomp/data');
const readBundle = (n: number): Record<string, unknown> => JSON.parse(readFileSync(resolve(DATA, `stage${n}-bundle.json`), 'utf8'));

describe('stage catalogue', () => {
  it('has the 15 shipped stages in AreaStageInfoMap order', () => {
    expect(STAGE_COUNT).toBe(15);
    STAGE_CATALOG.forEach((s, i) => {
      expect(s.stage).toBe(i + 1);
      expect(s.scene).toBe(`3d_stage_${String(i + 1).padStart(3, '0')}`);
      expect(s.areaIndex).toBe(Math.floor(i / 3));
      expect(s.stageIndexInArea).toBe(i % 3);
    });
    expect(STAGE_CATALOG.filter((s) => !s.initialLocked).map((s) => s.stage)).toEqual([1]);
  });

  it('unlock chain: stage N unlocks N+1 inside an area, last stage of an area unlocks nothing', () => {
    for (const s of STAGE_CATALOG) {
      if (s.stageIndexInArea < 2) expect(s.unlocks).toBe(STAGE_CATALOG[s.stage].scene);
      else expect(s.unlocks).toBeNull();
    }
  });

  it('matches the stage-scene attribution table (initCoin / waveCount per scene)', () => {
    const attr = JSON.parse(readFileSync(resolve(DECOMP, 'stage_scene_attribution.json'), 'utf8')) as Array<{ scene: string; initCoin: number; waveCount: number; areaName: string; stageName: string }>;
    for (const s of STAGE_CATALOG) {
      const a = attr.find((x) => x.scene === s.scene)!;
      expect([s.initCoin, s.waveCount, s.areaName, s.stageName]).toEqual([a.initCoin, a.waveCount, a.areaName, a.stageName]);
    }
  });

  it('?stage= parsing defaults to stage 1 and rejects junk', () => {
    expect(stageFromSearch('').stage).toBe(1);
    expect(stageFromSearch('?stage=2').stage).toBe(2);
    expect(stageFromSearch('?stage=15').stage).toBe(15);
    expect(stageFromSearch('?stage=16').stage).toBe(1);
    expect(stageFromSearch('?stage=0').stage).toBe(1);
    expect(stageFromSearch('?stage=abc&notitle').stage).toBe(1);
    expect(stageByScene('3d_stage_004')?.stage).toBe(4);
    expect(nextStage(15)).toBeNull();
    expect(nextStage(3)?.stage).toBe(4);
  });

  it('stageConfigFor derives every URL the game used to hard-wire', () => {
    const c = stageConfigFor(stageByNumber(2)!);
    expect(c.bundleUrl).toBe('/assets/data/stage2-bundle.json');
    expect(c.sceneBaseUrl).toBe('/assets/stages/3d_stage_002/');
    expect(c.physicsUrl).toBe('/assets/stages/3d_stage_002/physics/3d_stage_002_colliders.json');
    expect(c.saveKey).toBe('3d_stage_002');
    expect(c.bundleIdx).toBe(0);
  });
});

describe('per-stage data bundles (tools/data/export_stage_bundles.py)', () => {
  for (const s of STAGE_CATALOG) {
    it(`stage ${s.stage} (${s.scene}) loads wave resource + StageMain at idx 0 and matches the catalogue`, () => {
      const b = readBundle(s.stage);
      const rj = (f: string): never => b[f] as never;
      const wr = loadWaveResource(0, rj);
      const sm = loadStageMainContract(0, rj);
      expect(wr.waveDataList.length).toBe(s.waveCount);
      expect(sm.initCoin).toBe(s.initCoin);
      const view = headlessWaveManagerView(0, rj);
      expect(view).toBeDefined();
      const resolved = (b['stage_waves_resolved.json'] as Array<{ stageName: string; areaName: string }>)[0];
      expect([resolved.stageName, resolved.areaName]).toEqual([s.stageName, s.areaName]);
    });
  }

  it('stage 1 bundle equals decomp record idx 12 (baseline for the pinned replay hash)', () => {
    const b = readBundle(1);
    const raw = JSON.parse(readFileSync(resolve(DECOMP, 'stages_WaveResource.json'), 'utf8'))[12];
    expect((b['stages_WaveResource.json'] as unknown[])[0]).toEqual(raw);
  });

  it('scene assets exist for the extracted stages (skips stages not extracted on this machine)', () => {
    for (const s of STAGE_CATALOG) {
      const dir = resolve(ROOT, 'public/assets/stages', s.scene);
      if (!existsSync(resolve(dir, 'scene.json'))) continue;
      expect(existsSync(resolve(dir, 'physics', `${s.scene}_colliders.json`))).toBe(true);
      const scene = JSON.parse(readFileSync(resolve(dir, 'scene.json'), 'utf8')) as { nodes: Array<{ name: string; parent: number }> };
      expect(scene.nodes.some((n) => n.name === 'home_001' && n.parent >= 0)).toBe(true);
      expect(scene.nodes.filter((n) => /^tree_\d+/.test(n.name)).length).toBeGreaterThan(100);
    }
  });
});
