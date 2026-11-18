// src/data/stageCatalog.ts
// Multi-stage catalogue: the 15 shipped stages (AreaStageInfoMap.numStagesAvailable = 15; areas 6/7 =
// 3d_stage_016..021 are DLC and have no scene in the stages bundle).
//
// Stage NUMBER N (1..15) = position in the original AreaStageInfoMap order (area-major,
// 3 stages per area) = the scene name 3d_stage_NNN. `tl_stage_00X` labels are per-AREA, so the
// SaveData key (StageMain.GetStageNameFromCurrentScene = scene name minus "_env") is the SCENE name.
// Evidence: decomp/decompiled/Q4.StageMain.c @00525c30 (Replace("_env","")), Q4.AreaStageInfoMap.c.
//
// Generated rows: stageCatalog.generated.ts (tools/data/export_stage_bundles.py).

import { STAGE_CATALOG } from './stageCatalog.generated';

export interface StageCatalogEntry {
  /** 1-based stage number (= scene suffix). */
  stage: number;
  /** Scene / SaveData stage key, e.g. '3d_stage_002'. */
  scene: string;
  /** Per-stage data bundle file in public/assets/data. */
  bundle: string;
  /** tl_stage_00X string key (unique only within an area). */
  stageName: string;
  /** tl_area_00X string key. */
  areaName: string;
  areaIndex: number;
  stageIndexInArea: number;
  initCoin: number;
  waveCount: number;
  /** AreaStageInfo.initialLocked */
  initialLocked: boolean;
  /** AreaStageInfo.stageUnlockName: scene unlocked by clearing this one (null = last of area). */
  unlocks: string | null;
  /** AreaStageInfo.areaIDOverride (-1 = none); stage additionally requires (that area, stage 0) unlocked. */
  areaIDOverride: number;
}

export { STAGE_CATALOG };

export const STAGE_COUNT = STAGE_CATALOG.length;

export function stageByNumber(n: number): StageCatalogEntry | undefined {
  return STAGE_CATALOG.find((s) => s.stage === n);
}

export function stageByScene(scene: string): StageCatalogEntry | undefined {
  return STAGE_CATALOG.find((s) => s.scene === scene);
}

/** `?stage=N` (1..STAGE_COUNT) -> catalogue entry; missing/invalid -> stage 1 (default). */
export function stageFromSearch(search: string): StageCatalogEntry {
  const raw = new URLSearchParams(search).get('stage');
  const n = raw === null ? 1 : Number.parseInt(raw, 10);
  return stageByNumber(n) ?? STAGE_CATALOG[0];
}

/** Per-stage URLs / indices (everything game.ts used to hard-wire for stage 1). */
export interface StageConfig {
  entry: StageCatalogEntry;
  /** Stage record index inside the per-stage bundle (always 0; stage 1 baseline bundle idx 0 = source idx 12). */
  bundleIdx: number;
  bundleUrl: string;
  /** '/assets/stages/<scene>/' */
  sceneBaseUrl: string;
  sceneJsonUrl: string;
  physicsUrl: string;
  /** Key used for SaveData records (scene name). */
  saveKey: string;
}

export function stageConfigFor(entry: StageCatalogEntry): StageConfig {
  const base = `/assets/stages/${entry.scene}/`;
  return {
    entry,
    bundleIdx: 0,
    bundleUrl: `/assets/data/${entry.bundle}`,
    sceneBaseUrl: base,
    sceneJsonUrl: `${base}scene.json`,
    physicsUrl: `${base}physics/${entry.scene}_colliders.json`,
    saveKey: entry.scene,
  };
}

/** Next stage in AreaStageInfoMap order (null after the last). */
export function nextStage(n: number): StageCatalogEntry | null {
  return stageByNumber(n + 1) ?? null;
}
