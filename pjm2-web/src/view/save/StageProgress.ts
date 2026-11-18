// src/view/save/StageProgress.ts
// Progression rules of the original stage select / world map, as pure functions over SaveData.
// Every rule cites its decompiled source (decomp/decompiled/*.c; Ghidra addresses).
//
//  * Difficulty enum (Q4.DifficultySettings.Difficulty): Easy=0 "Fun" (tl_difficulty_001),
//    Medium=1 "Tricky" (002), Hard=2 "Mayhem" (003). (-1 = "any" in SaveData queries; the enum has a 4th
//    tier in DifficultySettings but the UI only offers these three.)
//  * GetHighestAvailableDifficulty @0075a810: 2 when SaveData.HasUnlockedHard; else 1 when the stage was
//    cleared on Medium(1); else (cleared on Easy ? 1 : 0)... see highestAvailableDifficulty() -- decompiled
//    result is `return HasClearedStage(stage,1) ? 2 : HasClearedStage(stage,0)` (a bool 0/1 otherwise):
//    Easy only -> 0, after clearing Easy -> 1 (Tricky), after clearing Tricky -> 2 (Mayhem).
//  * AreaStageInfoMap.IsStageUnlocked @0072e380: unlocked = !initialLocked || unlockedStages.Contains(scene)
//    (DLC checks for 3d_stage_016/019 omitted: those scenes are not in the stages bundle).
//  * Result screen @OnCameraSwitch (Q4.StageResultMenuController.c ~L261-808): on a CLEAR the stage's
//    StageInfo.stageUnlockName (+0x30) is added to unlockedStages when non-empty and absent
//    (AddUnlockedStage), then UpdateStageRecord(scene, difficulty, score, perfect).
//  * HasUnlockedHard @UpdateStageRecord tail (~L2090-2123): becomes true once EVERY available stage has a
//    perfect record (GetStagePerfect(stage,-1)).
//  * Area locks (Q4.AreaLock.canUnlock @0072b810): the player's total perfect count (rainbow fragments)
//    must be >= requiredRainbows and every requiredStages portal cleared (any difficulty).

import { STAGE_CATALOG, stageByScene, type StageCatalogEntry } from '../../data/stageCatalog';
import type { SaveData } from './SaveData';

export const DIFFICULTY_EASY = 0;
export const DIFFICULTY_MEDIUM = 1;
export const DIFFICULTY_HARD = 2;
export const DIFFICULTIES = [DIFFICULTY_EASY, DIFFICULTY_MEDIUM, DIFFICULTY_HARD] as const;
/** tl_difficulty_00{1,2,3} = Fun / Tricky / Mayhem (strings.json). */
export const DIFFICULTY_LABEL_KEYS = ['tl_difficulty_001', 'tl_difficulty_002', 'tl_difficulty_003'] as const;

export function highestAvailableDifficulty(save: SaveData, scene: string): number {
  if (save.hasUnlockedHard) return DIFFICULTY_HARD;
  if (save.hasClearedStage(scene, DIFFICULTY_MEDIUM)) return DIFFICULTY_HARD;
  return save.hasClearedStage(scene, DIFFICULTY_EASY) ? DIFFICULTY_MEDIUM : DIFFICULTY_EASY;
}

export function isStageUnlocked(save: SaveData, entry: StageCatalogEntry): boolean {
  return !entry.initialLocked || save.unlockedStages.includes(entry.scene);
}

export interface StageSelectRow {
  entry: StageCatalogEntry;
  unlocked: boolean;
  /** Per difficulty (0..2). */
  cleared: boolean[];
  perfect: boolean[];
  /** 0 when not cleared (the UI prints the "no record" label instead). */
  score: number[];
  highestDifficulty: number;
}

/** UpdateStagePortal @00531330: per difficulty a score shows only when record>0 && cleared. */
export function stageSelectRow(save: SaveData, entry: StageCatalogEntry): StageSelectRow {
  const cleared = DIFFICULTIES.map((d) => save.hasClearedStage(entry.scene, d));
  return {
    entry,
    unlocked: isStageUnlocked(save, entry),
    cleared,
    perfect: DIFFICULTIES.map((d) => save.getStagePerfect(entry.scene, d)),
    score: DIFFICULTIES.map((d, i) => (cleared[i] && save.getStageRecord(entry.scene, d) > 0 ? save.getStageRecord(entry.scene, d) : 0)),
    highestDifficulty: highestAvailableDifficulty(save, entry.scene),
  };
}

export function allStageRows(save: SaveData): StageSelectRow[] {
  return STAGE_CATALOG.map((e) => stageSelectRow(save, e));
}

/** True when the player may start `difficulty` on this stage. */
export function canPlay(save: SaveData, entry: StageCatalogEntry, difficulty: number): boolean {
  return isStageUnlocked(save, entry) && difficulty >= 0 && difficulty <= highestAvailableDifficulty(save, entry.scene);
}

export interface ClearOutcome {
  newBest: boolean;
  newPerfect: boolean;
  /** Scene unlocked by this clear (StageInfo.stageUnlockName), if it was newly added. */
  newlyUnlockedStage: string | null;
  /** Difficulty tier that just became available on THIS stage (1 = Tricky, 2 = Mayhem), if any
   *  (tl_mini_dialog_text_001/002). */
  newlyAvailableDifficulty: number | null;
  /** SaveData.HasUnlockedHard flipped to true (all stages perfect). */
  unlockedHardMode: boolean;
}

/** Everything StageResultMenuController.OnCameraSwitch writes to SaveData for a CLEARED single-player stage. */
export function applyStageClear(save: SaveData, scene: string, difficulty: number, score: number, perfect: boolean): ClearOutcome {
  const entry = stageByScene(scene);
  const beforeDiff = highestAvailableDifficulty(save, scene);
  const hardBefore = save.hasUnlockedHard;
  let newlyUnlockedStage: string | null = null;
  if (entry?.unlocks) {
    if (!save.unlockedStages.includes(entry.unlocks)) {
      save.addUnlockedStage(entry.unlocks);
      newlyUnlockedStage = entry.unlocks;
    }
  }
  const { newBest, newPerfect } = save.recordStageClear(scene, difficulty, score, perfect);
  if (!save.hasUnlockedHard && STAGE_CATALOG.every((s) => save.hasPerfectStage(s.scene))) save.setHasUnlockedHard(true);
  const afterDiff = highestAvailableDifficulty(save, scene);
  save.setLastPlayStageName(scene);
  return {
    newBest,
    newPerfect,
    newlyUnlockedStage,
    newlyAvailableDifficulty: afterDiff > beforeDiff && !hardBefore ? afterDiff : null,
    unlockedHardMode: !hardBefore && save.hasUnlockedHard,
  };
}

/** Q4.AreaLock.canUnlock: rainbow fragments (total perfects) + required stages cleared. */
export function canUnlockArea(save: SaveData, requiredRainbows: number, requiredScenes: readonly string[]): boolean {
  if (save.getTotalPerfectCount() < requiredRainbows) return false;
  return requiredScenes.every((s) => save.hasClearedStage(s));
}

/** Stage-select cursor start (SaveData.GetLastPlayStageName, else the first unlocked stage). */
export function initialCursorStage(save: SaveData): number {
  const last = stageByScene(save.getLastPlayStageName());
  if (last !== undefined && isStageUnlocked(save, last)) return last.stage;
  return STAGE_CATALOG.find((s) => isStageUnlocked(save, s))?.stage ?? 1;
}

// ---- world-map AreaLocks (serialized in BuildPlayer-3d_stage_000_env, the world-map scene) ---------------------
// UnityPy dump of the `Q4.AreaLock` MonoBehaviours (stages bundle, scene file ..._env; `requiredStages` is empty on
// all of them): rainbows 2 -> {004, 007}; 6 -> {008, 009, 010, 011, 012}; 9 -> {013}; 99 -> {} (DLC gate).
// (The `_editor`/`_credit_env` variants of the scene carry older values, e.g. 5 -> {010}; the shipped `_env` scene
// is authoritative.) The lock is satisfied when SaveData.GetTotalPerfectCount() >= requiredRainbows
// (AreaLock.canUnlock @0072b810 -- rainbows are NOT spent), and unlocking (AreaLock.OnInteract ->
// SetStagesUnlock @0072c980) adds `unlockStages` to SaveData.unlockedStages.
export interface AreaLockDef {
  requiredRainbows: number;
  requiredScenes: readonly string[];
  unlockStages: readonly string[];
}

export const AREA_LOCKS: readonly AreaLockDef[] = [
  { requiredRainbows: 2, requiredScenes: [], unlockStages: ['3d_stage_004', '3d_stage_007'] },
  { requiredRainbows: 6, requiredScenes: [], unlockStages: ['3d_stage_008', '3d_stage_009', '3d_stage_010', '3d_stage_011', '3d_stage_012'] },
  { requiredRainbows: 9, requiredScenes: [], unlockStages: ['3d_stage_013'] },
];

/** The lock that gates `scene` (undefined = no lock; unlocked only by the clear chain). */
export function areaLockFor(scene: string): AreaLockDef | undefined {
  return AREA_LOCKS.find((l) => l.unlockStages.includes(scene));
}

/** Locked stage -> its AreaLock is satisfiable right now. */
export function canOpenAreaLock(save: SaveData, scene: string): boolean {
  const l = areaLockFor(scene);
  return l !== undefined && canUnlockArea(save, l.requiredRainbows, l.requiredScenes);
}

/** AreaLock.SetStagesUnlock: unlock every stage behind the lock of `scene`; returns the newly unlocked scenes. */
export function openAreaLock(save: SaveData, scene: string): string[] {
  const l = areaLockFor(scene);
  if (l === undefined || !canUnlockArea(save, l.requiredRainbows, l.requiredScenes)) return [];
  const added = l.unlockStages.filter((s) => !save.unlockedStages.includes(s));
  for (const s of added) save.addUnlockedStage(s);
  return added;
}
