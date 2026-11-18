// src/view/ui/StageSelectModel.ts
// Pure state of the stage-select screen: cursor over the 5x3 stage grid (area rows x stage columns),
// difficulty selection (clamped to GetHighestAvailableDifficulty), pick/back validity.
// The original is a walkable world map (Q4.WorldMap + StagePortal triggers; the player walks onto a portal
// and StageSelectController.OnEnterStagePortal shows the stage panel; "Proceed to Stage" = OnProceedToStage).
// The web port replaces walking with a grid cursor; the PANEL contents/rules are the original's
// (UpdateStagePortal: names, per-difficulty record/perfect, highest available difficulty).

import { STAGE_CATALOG, STAGE_COUNT, stageByNumber, type StageCatalogEntry } from '../../data/stageCatalog';
import type { SaveData } from '../save/SaveData';
import { areaLockFor, canOpenAreaLock, canPlay, highestAvailableDifficulty, initialCursorStage, isStageUnlocked, openAreaLock, stageSelectRow, type StageSelectRow } from '../save/StageProgress';

export type NavDir = 'left' | 'right' | 'up' | 'down';
export const AREAS = Math.ceil(STAGE_COUNT / 3);

export interface PickResult {
  ok: boolean;
  /** Reason when !ok. */
  reason?: 'locked' | 'difficulty-locked' | 'area-opened';
  /** Scenes newly unlocked by this press (AreaLock.SetStagesUnlock). */
  opened?: string[];
  stage: StageCatalogEntry;
  difficulty: number;
}

export class StageSelectModel {
  cursor: number;
  difficulty = 0;

  constructor(private readonly save: SaveData, start?: number) {
    this.cursor = start ?? initialCursorStage(save);
    this.clampDifficulty();
  }

  get entry(): StageCatalogEntry {
    return stageByNumber(this.cursor) ?? STAGE_CATALOG[0];
  }

  get row(): StageSelectRow {
    return stageSelectRow(this.save, this.entry);
  }

  /** Grid move; columns wrap inside the area, rows move area-wise keeping the column. */
  move(dir: NavDir): void {
    const area = Math.floor((this.cursor - 1) / 3);
    const col = (this.cursor - 1) % 3;
    let a = area;
    let c = col;
    if (dir === 'left') c = (col + 2) % 3;
    else if (dir === 'right') c = (col + 1) % 3;
    else if (dir === 'up') a = (area + AREAS - 1) % AREAS;
    else a = (area + 1) % AREAS;
    const n = a * 3 + c + 1;
    if (stageByNumber(n) !== undefined) this.cursor = n;
    this.clampDifficulty();
  }

  /** Cycle difficulty over the tiers available on the cursor's stage. */
  cycleDifficulty(delta: 1 | -1): void {
    const max = highestAvailableDifficulty(this.save, this.entry.scene);
    this.difficulty = (this.difficulty + delta + (max + 1)) % (max + 1);
  }

  clampDifficulty(): void {
    this.difficulty = Math.min(this.difficulty, highestAvailableDifficulty(this.save, this.entry.scene));
  }

  /** Rainbow fragments still missing for the lock gating the cursor's stage (0 = none/not gated). */
  get rainbowsMissing(): number {
    const l = areaLockFor(this.entry.scene);
    return l === undefined || this.row.unlocked ? 0 : Math.max(0, l.requiredRainbows - this.save.getTotalPerfectCount());
  }

  isUnlocked(n: number): boolean {
    const e = stageByNumber(n);
    return e !== undefined && isStageUnlocked(this.save, e);
  }

  pick(): PickResult {
    const stage = this.entry;
    if (!isStageUnlocked(this.save, stage)) {
      // Rainbow-fragment gate (AreaLock): satisfiable -> the press opens the whole area instead of starting.
      if (canOpenAreaLock(this.save, stage.scene)) {
        return { ok: false, reason: 'area-opened', stage, difficulty: this.difficulty, opened: openAreaLock(this.save, stage.scene) };
      }
      return { ok: false, reason: 'locked', stage, difficulty: this.difficulty };
    }
    if (!canPlay(this.save, stage, this.difficulty)) return { ok: false, reason: 'difficulty-locked', stage, difficulty: this.difficulty };
    return { ok: true, stage, difficulty: this.difficulty };
  }
}
