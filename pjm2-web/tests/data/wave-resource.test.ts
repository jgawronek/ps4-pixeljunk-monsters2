// tests/data/wave-resource.test.ts
// Pins the Phase-1 wave-resource plumbing (src/data/waveResource.ts) against
// the real extracted tables of the user's own copy. Stage 1 = index 12
// (scene 3d_stage_001; see stage_scene_attribution.json — idx 0 and 2 are
// decoys: the area-2 opener and the 99999-coin dev config).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CatmullCurve } from '../../src/core/CatmullCurve';
import { EBossType, EEnemyMoveTypeDef, ESpawnMode } from '../../src/core/enums';
import {
  animatorStringToHash,
  headlessWaveManagerView,
  loadStageMainContract,
  loadWaveResource,
} from '../../src/data/waveResource';
import type { SpawnDataContract } from '../../src/view/q4-contracts';

const DATA_DIR = resolve(__dirname, '../../../decomp/data');
const STAGE1 = 12;

/* eslint-disable @typescript-eslint/no-explicit-any */
function readJson(file: string): any {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8'));
}

const rawStage = (readJson('stages_WaveResource.json') as any[])[STAGE1];
const resolvedStage = (readJson('stage_waves_resolved.json') as any[])[STAGE1];

const resource = loadWaveResource(STAGE1, readJson);

function* allSpawns(): Generator<SpawnDataContract> {
  for (const w of resource.waveDataList) {
    for (const pdl of w.perDifficulyLists) {
      for (const s of pdl.spawnDataList) yield s;
    }
  }
}

describe('loadWaveResource — stage 1 (index 12, scene 3d_stage_001)', () => {
  it('loads the 10 waves of stage 1', () => {
    expect(resource.waveDataList.length).toBe(10);
    // FAITHFUL DATA SHAPE: the serialized perDifficulyLists carries FOUR
    // entries (Difficulty.Any/-1, Easy, Medium, Hard consume indices 0..2;
    // index 3 is an unused editor artifact and is empty in stage 1).
    for (const w of resource.waveDataList) {
      expect(w.perDifficulyLists.length).toBe(4);
      expect(w.perDifficulyLists[3].spawnDataList.length).toBe(0);
    }
  });

  it('wave 0 carries the verified per-difficulty arrays', () => {
    const w0 = resource.waveDataList[0];
    expect(w0.delay).toEqual([0, 0, 0]);
    expect(w0.speedRatio).toEqual([1, 1, 1]);
    expect(w0.hpRatio).toEqual([0.5, 0.5, 0.5]);
    expect(w0.totalMoney).toEqual([200, 200, 200]);
    expect(w0.totalGem).toEqual([0, 0, 0]);
    expect(w0.money).toEqual([10, 10, 10]);
    expect(w0.gem).toEqual([0, 0, 0]);
    expect(w0.dialogLabel).toEqual(['', '', '']);
    expect(w0.dialogIcon).toEqual([0, 0, 0]);
    // Medium (index 1) spot-checks from the mission spec.
    expect(w0.delay[1]).toBe(0);
    expect(w0.hpRatio[1]).toBe(0.5);
    expect(w0.totalMoney[1]).toBe(200);
  });

  it('fp32 discipline: every float array entry is fround-clean', () => {
    for (const w of resource.waveDataList) {
      for (const arr of [w.delay, w.speedRatio, w.hpRatio]) {
        for (const v of arr) expect(Object.is(v, Math.fround(v))).toBe(true);
      }
    }
    for (const s of allSpawns()) {
      for (const v of [
        s.enemySpawnInterval,
        s.delay,
        s.offsetStartAngle,
        s.offsetFreq,
        s.offsetDist,
        s.walkDriftFreq,
        s.walkDriftDist,
        s.pathStartTime,
      ]) {
        expect(Object.is(v, Math.fround(v))).toBe(true);
      }
    }
  });

  it('spawn counts match stage_waves_resolved for every wave/difficulty', () => {
    expect(resolvedStage.waves.length).toBe(10);
    for (let wi = 0; wi < 10; wi++) {
      for (let di = 0; di < 4; di++) {
        const mine = resource.waveDataList[wi].perDifficulyLists[di].spawnDataList;
        const theirs = resolvedStage.waves[wi][di].spawns;
        expect(mine.length).toBe(theirs.length);
        for (let si = 0; si < mine.length; si++) {
          expect(mine[si].pathName).toBe(theirs[si].m_pathName);
        }
      }
    }
  });

  it('resolves every stage-1 spawn to an EnemyBaseContract (no nulls)', () => {
    let total = 0;
    for (const s of allSpawns()) {
      total++;
      expect(s.enemyObject).not.toBeNull();
      expect(s.enemyObject!.name.length).toBeGreaterThan(0);
    }
    expect(total).toBe(68); // verified: 2+2+2+4+1+7+1+2+1+1 per difficulty ×3
  });

  it('kuri_00_001 resolves with its verified prefab stats', () => {
    const s = resource.waveDataList[0].perDifficulyLists[0].spawnDataList[0];
    const e = s.enemyObject!;
    expect(e.name).toBe('kuri_00_001');
    expect(e.maxLife).toBe(300);
    expect(e.speed).toBe(Math.fround(0.8360000252723694));
    expect(e.fireSpeed).toBe(Math.fround(1.6720000505447388));
    expect(e.balloonSpeed).toBe(Math.fround(0.8360000252723694));
    expect(e.collisionScaleH).toBe(1);
    expect(e.collisionScaleV).toBe(1);
    expect(e.enemyMoveType).toBe(EEnemyMoveTypeDef.ground);
    expect(e.spawnMode).toBe(ESpawnMode.Normal);
    expect(e.expValue).toBe(10);
    expect(e.isBoss).toBe(false);
    expect(e.bossType).toBe(EBossType.None);
  });

  it('the wave-10 boss is boss_bero_00 (isBoss true, jumping Bero)', () => {
    const w9 = resource.waveDataList[9];
    for (let di = 0; di < 3; di++) {
      const spawns = w9.perDifficulyLists[di].spawnDataList;
      expect(spawns.length).toBe(1);
      expect(spawns[0].pathName).toBe('Hill_CenterGroundBoss');
      const e = spawns[0].enemyObject!;
      expect(e.name).toBe('boss_bero_00');
      expect(e.isBoss).toBe(true); // get_IsBoss @0x7F9820: m_bossType != None
      expect(e.bossType).toBe(EBossType.Bero);
      expect(e.isJumpingBoss).toBe(true);
      expect(e.maxLife).toBe(8010);
      expect(e.speed).toBe(Math.fround(0.6687999963760376));
      expect(e.collisionScaleV).toBe(0.75);
    }
  });

  it('enemyTrackerEnable converts 0/1 → boolean', () => {
    const s = resource.waveDataList[0].perDifficulyLists[0].spawnDataList[0];
    expect(rawStage.waveList[0].perDifficulyLists[0].spawnDataList[0].enemyTrackerEnable).toBe(1);
    expect(s.enemyTrackerEnable).toBe(true);
    const minion = resource.waveDataBossListMedium![0].waveData.perDifficulyLists[0].spawnDataList[0];
    expect(
      rawStage.waveBossMinionListMedium[0].waveData.perDifficulyLists[0].spawnDataList[0]
        .enemyTrackerEnable,
    ).toBe(0);
    expect(minion.enemyTrackerEnable).toBe(false);
  });

  it('builds a real CatmullCurve per spawn (get_pathCurve @0x761AB0)', () => {
    for (const s of allSpawns()) {
      expect(s.pathCurve).toBeInstanceOf(CatmullCurve);
      expect(s.pathCurve.curveLength).toBeGreaterThan(0);
      expect(s.pathCurve.curveLengthB4Activation).toBeGreaterThan(0);
      expect(s.pathCurve.id).toBe(animatorStringToHash(s.pathName));
    }
    // Wave 0 spawn 0: m_activateIndex = 4 mid-path → strictly before the end.
    const s0 = resource.waveDataList[0].perDifficulyLists[0].spawnDataList[0];
    expect(
      rawStage.waveList[0].perDifficulyLists[0].spawnDataList[0].m_activateIndex,
    ).toBe(4);
    expect(s0.pathCurve.curveLengthB4Activation).toBeLessThan(s0.pathCurve.curveLength);
    // m_activateIndex honored: identical inputs → bit-identical lengths.
    const raw = rawStage.waveList[0].perDifficulyLists[0].spawnDataList[0];
    const reference = new CatmullCurve(
      animatorStringToHash(raw.m_pathName),
      raw.m_pathList,
      raw.m_activateIndex,
    );
    expect(Object.is(s0.pathCurve.curveLength, reference.curveLength)).toBe(true);
    expect(
      Object.is(s0.pathCurve.curveLengthB4Activation, reference.curveLengthB4Activation),
    ).toBe(true);
  });

  it('pathStartTime passes through fround-clean (stage 1: all 0)', () => {
    for (let wi = 0; wi < 10; wi++) {
      for (let di = 0; di < 4; di++) {
        const rawSpawns = rawStage.waveList[wi].perDifficulyLists[di].spawnDataList;
        const mine = resource.waveDataList[wi].perDifficulyLists[di].spawnDataList;
        for (let si = 0; si < mine.length; si++) {
          expect(mine[si].pathStartTime).toBe(Math.fround(rawSpawns[si].pathStartTime));
        }
      }
    }
  });

  it('boss-minion lists: 4 entries each, verified times, kuri minions', () => {
    for (const list of [
      resource.waveDataBossListEasy,
      resource.waveDataBossListMedium,
      resource.waveDataBossListHard,
    ]) {
      expect(list).not.toBeNull();
      expect(list!.length).toBe(4);
      expect(list!.map((m) => m.time)).toEqual([5, 14, 24, 32]);
      for (const m of list!) {
        const spawn = m.waveData.perDifficulyLists[0].spawnDataList[0];
        expect(spawn.enemyObject!.name).toBe('kuri_00_001');
        expect(spawn.pathName).toBe('Hill_CenterGroundBig');
        // Boss-minion waveData uses the 10000000 "never auto-start" sentinel.
        expect(m.waveData.delay[0]).toBe(10000000);
      }
    }
  });
});

describe('loadStageMainContract — stage 1', () => {
  it('carries the verified initial economy', () => {
    const stage = loadStageMainContract(STAGE1, readJson);
    expect(stage.initCoin).toBe(450);
    expect(stage.initGem).toBe(0);
    expect(stage.initWaveCoinRate).toBe(Math.fround(1.0499999523162842));
    expect(stage.initWaveTimeRate).toBe(1.75); // VERIFIED
  });
});

describe('headlessWaveManagerView', () => {
  it('serves the resource and a null enemy root', () => {
    const view = headlessWaveManagerView(STAGE1, readJson);
    const r = view.getWaveResource();
    expect(r.waveDataList.length).toBe(10);
    expect(view.getEnemyRoot!()).toBeNull();
  });
});
