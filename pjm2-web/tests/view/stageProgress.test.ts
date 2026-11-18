// Stage-select progression + result score/count-up logic (pure; fake storage).
import { describe, expect, it } from 'vitest';

import { STAGE_CATALOG, stageByNumber } from '../../src/data/stageCatalog';
import { SaveData, type StorageLike } from '../../src/view/save/SaveData';
import { StageSelectModel } from '../../src/view/ui/StageSelectModel';
import {
  AREA_LOCKS, allStageRows, applyStageClear, areaLockFor, openAreaLock, canPlay, canUnlockArea, highestAvailableDifficulty, initialCursorStage, isStageUnlocked, stageSelectRow,
} from '../../src/view/save/StageProgress';
import { COUNT_UP_CURVE, CountUp, SCORE_SETTINGS, computeInventoryScore, computeScore, evalCurve } from '../../src/view/ui/ResultScore';

class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}
const S = (n: number): string => stageByNumber(n)!.scene;

describe('stage progression', () => {
  it('fresh save: only stage 1 is unlocked, Fun only', () => {
    const save = new SaveData(new Mem());
    const rows = allStageRows(save);
    expect(rows.filter((r) => r.unlocked).map((r) => r.entry.stage)).toEqual([1]);
    expect(highestAvailableDifficulty(save, S(1))).toBe(0);
    expect(canPlay(save, stageByNumber(1)!, 0)).toBe(true);
    expect(canPlay(save, stageByNumber(1)!, 1)).toBe(false);
    expect(canPlay(save, stageByNumber(2)!, 0)).toBe(false);
    expect(initialCursorStage(save)).toBe(1);
  });

  it('clearing stage 1 on Fun unlocks stage 2 and Tricky on stage 1; persists across reload', () => {
    const mem = new Mem();
    const save = new SaveData(mem);
    const o = applyStageClear(save, S(1), 0, 12345, false);
    expect(o).toMatchObject({ newBest: true, newPerfect: false, newlyUnlockedStage: S(2), newlyAvailableDifficulty: 1, unlockedHardMode: false });
    expect(isStageUnlocked(save, stageByNumber(2)!)).toBe(true);
    expect(highestAvailableDifficulty(save, S(1))).toBe(1);
    const again = new SaveData(mem);
    expect(isStageUnlocked(again, stageByNumber(2)!)).toBe(true);
    expect(again.getLastPlayStageName()).toBe(S(1));
    expect(initialCursorStage(again)).toBe(1);
    // replay: no new unlock, lower score is not a new best
    const o2 = applyStageClear(again, S(1), 0, 100, false);
    expect(o2).toMatchObject({ newBest: false, newlyUnlockedStage: null, newlyAvailableDifficulty: null });
    expect(again.getStageRecord(S(1), 0)).toBe(12345);
  });

  it('Tricky clear opens Mayhem; perfect is sticky and reported once', () => {
    const save = new SaveData(new Mem());
    applyStageClear(save, S(1), 0, 10, false);
    const o = applyStageClear(save, S(1), 1, 20, true);
    expect(o.newlyAvailableDifficulty).toBe(2);
    expect(o.newPerfect).toBe(true);
    expect(applyStageClear(save, S(1), 1, 15, true).newPerfect).toBe(false);
    expect(save.getStagePerfect(S(1), 1)).toBe(true);
    expect(save.getTotalPerfectCount()).toBe(1);
  });

  it('stage row mirrors UpdateStagePortal: score shows only when cleared and > 0', () => {
    const save = new SaveData(new Mem());
    applyStageClear(save, S(1), 1, 777, true);
    const r = stageSelectRow(save, stageByNumber(1)!);
    expect(r.score).toEqual([0, 777, 0]);
    expect(r.perfect).toEqual([false, true, false]);
    expect(r.cleared).toEqual([false, true, false]);
  });

  it('HasUnlockedHard flips once every stage has a perfect record', () => {
    const save = new SaveData(new Mem());
    let last = false;
    for (const s of STAGE_CATALOG) last = applyStageClear(save, s.scene, 0, 1, true).unlockedHardMode;
    expect(last).toBe(true);
    expect(save.hasUnlockedHard).toBe(true);
    expect(highestAvailableDifficulty(save, S(7))).toBe(2);
  });

  it('migrates the legacy stage-1 key (tl_stage_001) to the scene name', () => {
    const mem = new Mem();
    mem.setItem('pjm2-web.save', JSON.stringify({ version: 3, stages: { 'tl_stage_001|1': { score: 5, perfect: true, cleared: true } }, preferences: { muted: false } }));
    const save = new SaveData(mem);
    expect(save.getStageRecord('3d_stage_001', 1)).toBe(5);
    expect(highestAvailableDifficulty(save, '3d_stage_001')).toBe(2);
  });

  it('AreaLock rule: rainbow count + required stages cleared', () => {
    const save = new SaveData(new Mem());
    expect(canUnlockArea(save, 0, [])).toBe(true);
    expect(canUnlockArea(save, 1, [S(3)])).toBe(false);
    applyStageClear(save, S(3), 0, 1, true);
    expect(canUnlockArea(save, 1, [S(3)])).toBe(true);
    expect(canUnlockArea(save, 2, [S(3)])).toBe(false);
  });
});

describe('result score (Q4.StageResultMenuController)', () => {
  it('ScoreSettings constants from the globalsettings bundle', () => {
    expect(SCORE_SETTINGS).toEqual({ chibiPoints: 50, allChibisSafeBonus: 500, clearBonus: 10000, allWaveEnemiesKilledPoints: 100, coinPoints: 1, gemPoints: 100 });
  });

  it('perfect 10-wave run, 20 chibis', () => {
    const per = 50 * 20 + 100 + 500; // chibiPoints*20 + nothing-lost + all-safe
    const score = computeScore({ startingChibis: 20, chibisAtEndOfWave: Array(10).fill(20), coins: 600, gems: 3, interestCoins: 40 });
    expect(score).toBe(10 * per + (600 + 40) * 1 + 3 * 100 + 10000);
  });

  it('chibi loss mid-run drops the safe/no-loss bonuses for that wave only', () => {
    const score = computeScore({ startingChibis: 20, chibisAtEndOfWave: [20, 18, 18, 10], coins: 0, gems: 0, interestCoins: 0 });
    // w0: 1000+100+500 ; w1: 900 (lost 2) ; w2: 900+100 (no loss) ; w3: 500 (lost 8) ; + clear bonus
    expect(score).toBe(1600 + 900 + 1000 + 500 + 10000);
    expect(computeInventoryScore(10, 2, 5)).toBe(2 * 100 + 15);
  });

  it('count-up: Hermite curve endpoints/monotone, 3 s, skip and confirm semantics', () => {
    expect(evalCurve(COUNT_UP_CURVE, 0)).toBe(0);
    expect(evalCurve(COUNT_UP_CURVE, 1)).toBe(1);
    expect(evalCurve(COUNT_UP_CURVE, 0.8406797647476196)).toBeCloseTo(0.33161282539367676, 9);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) { const v = evalCurve(COUNT_UP_CURVE, Math.min(t, 1)); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    const cu = new CountUp({ score: 50000, coins: 600, gems: 3, wavesCleared: 10, interest: 40, clearBonus: 10000, chibisRemaining: 20 });
    let f = cu.tick(1 / 60);
    expect(f.playCountSfx).toBe(true);
    expect(f.values.score).toBeLessThan(50000);
    expect(cu.confirm()).toBe(false); // jumps to 0.99, does not leave
    expect(cu.alpha).toBeCloseTo(0.99, 6);
    f = cu.tick(1 / 60);
    expect(f.finishedNow).toBe(false); // 0.99 + dt/3 still < 1 on the first frame
    f = cu.tick(1 / 60);
    expect(f.finishedNow).toBe(true);
    expect(f.values).toMatchObject({ score: 50000, coins: 600, gems: 3, chibisRemaining: 20 });
    expect(cu.tick(1 / 60).finishedNow).toBe(false);
    expect(cu.confirm()).toBe(true);
  });

  it('full-duration count-up needs 3 seconds of ticks', () => {
    const cu = new CountUp({ score: 100, coins: 0, gems: 0, wavesCleared: 0, interest: 0, clearBonus: 0, chibisRemaining: 0 });
    let t = 0; let fin = -1;
    for (let i = 0; i < 400 && fin < 0; i++) { t += 1 / 60; if (cu.tick(1 / 60).finishedNow) fin = t; }
    expect(fin).toBeGreaterThan(2.95);
    expect(fin).toBeLessThan(3.05);
  });
});

describe('world-map AreaLocks (serialized in BuildPlayer-3d_stage_000_env)', () => {
  it('lock table matches the dump: 2 -> {4,7}, 6 -> {8..12}, 9 -> {13}', () => {
    expect(AREA_LOCKS.map((l) => [l.requiredRainbows, l.unlockStages.length])).toEqual([[2, 2], [6, 5], [9, 1]]);
    expect(areaLockFor('3d_stage_007')?.requiredRainbows).toBe(2);
    expect(areaLockFor('3d_stage_001')).toBeUndefined();
    expect(areaLockFor('3d_stage_013')?.requiredRainbows).toBe(9);
  });

  it('two perfect clears open areas 2+3; the select screen reports it instead of starting', () => {
    const save = new SaveData(new Mem());
    const m = new StageSelectModel(save, 4);
    expect(m.pick()).toMatchObject({ ok: false, reason: 'locked' });
    expect(m.rainbowsMissing).toBe(2);
    applyStageClear(save, S(1), 0, 1, true);
    expect(m.rainbowsMissing).toBe(1);
    applyStageClear(save, S(2), 0, 1, true);
    const r = m.pick();
    expect(r).toMatchObject({ ok: false, reason: 'area-opened', opened: [S(4), S(7)] });
    expect(m.pick()).toMatchObject({ ok: true });
    expect(openAreaLock(save, S(4))).toEqual([]); // already open
  });
});
