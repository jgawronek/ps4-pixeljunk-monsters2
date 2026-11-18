// tests/core/data.test.ts
// Mirrors decomp/tools/verify_datalayer.cs (the C# harness that produced
// DATA_LAYER_OK): loads the real extracted tables from ../../decomp/data and
// asserts the same invariants.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GameDataLoader } from '../../src/data/loader';
import { EEnemyMoveTypeDef, ETowerAttackDef } from '../../src/data/enums';

const DATA_DIR = resolve(__dirname, '../../../decomp/data');

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8'));
}

const loader = new GameDataLoader(readJson);
loader.loadAll();

describe('GameDataLoader against the real extracted tables', () => {
  it('loads all tables', () => {
    expect(loader.enemies.size).toBe(57);
    expect(loader.towers.size).toBe(21);
    expect(loader.stages.length).toBe(17);
    expect(loader.difficulties.length).toBe(4);
    expect(loader.areas.length).toBe(7);
    expect(loader.areas.reduce((n, a) => n + a.stageInfos.length, 0)).toBe(21);
  });

  it('spot-checks kuri_00_001 (real prefab stats supersede shipped test JSON)', () => {
    const kuri = loader.enemies.get('kuri_00_001');
    expect(kuri).toBeDefined();
    expect(kuri!.maxLife).toBe(300);
    expect(kuri!.speed).toBeCloseTo(0.836, 3);
    expect(kuri!.enemyMoveType).toBe(EEnemyMoveTypeDef.ground);
    expect(kuri!.expValue).toBe(10);
    expect(kuri!.attributes.length).toBe(1);
    expect(kuri!.attributes[0].strengthDamageInfos.length).toBeGreaterThan(0);
    // TS loader improvement: classDamageInfos populated too
    expect(kuri!.attributes[0].classDamageInfos.length).toBeGreaterThan(0);
  });

  it('spot-checks tower_004 + upgrades', () => {
    const t4 = loader.towers.get('tower_004');
    expect(t4).toBeDefined();
    expect(t4!.attackPower).toBe(110);
    expect(t4!.attackSpeed).toBe(19);
    expect(t4!.costCoin).toBe(350);
    expect(t4!.costGem).toBe(4);
    expect(t4!.attackType).toBe(ETowerAttackDef.ground);
    expect(t4!.upgrades.length).toBe(4);
    expect(t4!.upgrades[0].level).toBe(2);
    expect(t4!.upgrades[0].reachExp).toBe(100);
  });

  it('reconstructs the TRUE first level (3d_stage_001) via scene attribution', () => {
    // CRITICAL disambiguation: stageName "tl_stage_001" is NOT unique — one per
    // area — and a dev/test config (initCoin=99999, 20 waves) also claims
    // (tl_area_001, tl_stage_001). The authoritative first level is the record
    // attributed to scene 3d_stage_001 in stage_scene_attribution.json
    // (AreaStageInfoMap: area[0].stage[0], initially unlocked).
    const attribution = readJson('stage_scene_attribution.json') as Array<{
      scene: string;
      areaName: string;
      stageName: string;
      initCoin: number;
      waveCount: number;
    }>;
    const first = attribution.find((a) => a.scene === '3d_stage_001');
    expect(first).toBeDefined();
    expect(first!.areaName).toBe('tl_area_001');
    expect(first!.stageName).toBe('tl_stage_001');
    expect(first!.initCoin).toBe(450);
    expect(first!.waveCount).toBe(10);

    const s1 = loader.stages.find(
      (s) =>
        s.stageName === first!.stageName &&
        s.areaName === first!.areaName &&
        s.initCoin === first!.initCoin &&
        s.waves.length === first!.waveCount,
    );
    expect(s1).toBeDefined();

    // Wave 1: 10× kuri_00_001 (basic grunts).
    const w1 = s1!.waves[0].perDifficulty[0];
    const totalKuri = w1.spawns.reduce(
      (n, sp) => n + (sp.enemy === 'kuri_00_001' ? sp.enemySpawnNum : 0),
      0,
    );
    expect(totalKuri).toBe(10);
    // World-space paths present (these passed the Rapier ground-snap parity
    // test at 100% hit rate on the 3d_stage_001 terrain).
    expect(w1.spawns[0].pathList.length).toBeGreaterThan(2);

    // Final wave: boss_bero_00 ×1.
    const wLast = s1!.waves[s1!.waves.length - 1].perDifficulty[0];
    const bosses = wLast.spawns.filter((sp) => (sp.enemy ?? '').startsWith('boss_'));
    expect(bosses.length).toBeGreaterThan(0);
    expect(bosses[0].enemy).toBe('boss_bero_00');
  });

  it('documents the decoy records (area-2 first stage + dev config)', () => {
    // idx 0 = tl_area_002/tl_stage_001 → scene 3d_stage_004 (second area's
    // opener: 15 waves, initCoin 400, wave 1 = 17× kuri over 3 ground paths,
    // wave 15 = boss_kao_00). Kept as a regression pin for the disambiguation.
    const decoy = loader.stages.find(
      (s) => s.stageName === 'tl_stage_001' && s.areaName === 'tl_area_002',
    );
    expect(decoy).toBeDefined();
    expect(decoy!.initCoin).toBe(400);
    expect(decoy!.waves.length).toBe(15);
    const w1 = decoy!.waves[0].perDifficulty[0];
    const totalKuri = w1.spawns.reduce(
      (n, sp) => n + (sp.enemy === 'kuri_00_001' ? sp.enemySpawnNum : 0),
      0,
    );
    expect(totalKuri).toBe(17);
    const w15 = decoy!.waves[14].perDifficulty[0];
    expect(w15.spawns[0].enemy).toBe('boss_kao_00');
    // The dev/test record (99999 coins) must never be selected as stage 1.
    const dev = loader.stages.filter(
      (s) => s.stageName === 'tl_stage_001' && s.areaName === 'tl_area_001',
    );
    expect(dev.length).toBe(2);
    expect(dev.some((s) => s.initCoin === 99999)).toBe(true);
  });

  it('resolves EVERY wave spawn to an enemy definition (1873/1873)', () => {
    let total = 0;
    let missing = 0;
    for (const st of loader.stages) {
      for (const w of st.waves) {
        for (const d of w.perDifficulty) {
          for (const sp of d.spawns) {
            total++;
            if (sp.enemy !== null && !loader.enemies.has(sp.enemy)) missing++;
          }
        }
      }
    }
    expect(total).toBe(1873);
    expect(missing).toBe(0);
  });

  it('difficulty tiers carry the extracted multipliers', () => {
    const easy = loader.difficulties[0];
    expect(easy.coinValueRate).toBe(1);
    expect(easy.enemyHPRate).toBeCloseTo(0.9, 5);
    expect(easy.enemyAmountRate).toBeCloseTo(0.75, 5);
  });
});
