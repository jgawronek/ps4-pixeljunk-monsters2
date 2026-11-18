// src/data/waveResource.ts
// Phase-1 wave-resource data plumbing: builds the Q4.WaveResource /
// Q4.StageMain view contracts for one stage from the extracted tables of the
// user's own copy (all under decomp/data/):
//   stages_WaveResource.json    — 17 raw Q4.WaveResource records
//                                 (spawn enemyObject PPtrs UNRESOLVED here)
//   stage_waves_resolved.json   — same waves with enemy names resolved
//                                 (join key: same wave/difficulty/spawn order
//                                 + m_pathName; verified 1:1 for all 1873)
//   enemies_EnemyBase.json      — 57 full Q4.EnemyBase records, UNNAMED
//                                 (__gameObject is null in the extraction)
//   stages_StageMain.json       — 17 Q4.StageMain records (initial economy)
//
// C# provenance (skeleton/Q4.cs + decompiled bodies):
//   Q4.SpawnData.get_pathCurve @0x761AB0: lazily constructs
//       new CatmullCurve(Animator.StringToHash(m_pathName), m_pathList,
//                        m_activateIndex)
//     cached in m_pathCurve (0x60) — ONE curve instance per SpawnData, built
//     from the spawn's own serialized path (spawns sharing a pathName carry
//     identical path data; CorePathMove.IsSameCurve compares curve IDs).
//   Q4.EnemyBase.get_IsBoss @0x7F9820 = (m_bossType != EBossType.None).
//   Q4.SpawnData fields: enemyObject 0x10, enemySpawnNum 0x18,
//     enemySpawnInterval 0x1C, delay 0x20, enemyTrackerEnable 0x24,
//     offsetStartAngle 0x28, offsetFreq 0x2C, offsetDist 0x30,
//     walkDriftFreq 0x34, walkDriftDist 0x38, m_pathName 0x40, m_pathList 0x48,
//     m_segTypeList 0x50, m_activateIndex 0x58, pathStartTime 0x5C.
//   Q4.WaveData arrays are float[] (delay/hpRatio/speedRatio) and int[]
//     (totalMoney/totalGem/money/gem/dialogIcon), indexed [Easy,Medium,Hard].
//
// TS ADAPTATION: the EnemyBase records carry no names, so the join uses the
// baked ENEMY_BASE_INDEX table below (prefab name → array index into
// enemies_EnemyBase.json). Derivation: UnityPy pass over the user's enemies
// bundle mapping GameObject name → EnemyBase component path_id → record
// index (the raw int64 path_ids exceed 2^53 and cannot round-trip through
// JSON.parse, hence indices). All 57/57 resolved; cross-checked field-equal
// against enemy_roster.json (maxLife/speed/fireSpeed/balloonSpeed/
// enemyMoveType/spawnMode/expValue all match).
//
// TS ADAPTATION: the enum values are cast onto the core/enums types the
// contracts expect (src/core/enums and src/data/enums are value-identical
// ports of the same metadata; see the cross-check note in core/enums.ts).

import { CatmullCurve } from '../core/CatmullCurve';
import { EBossType, EEnemyMoveTypeDef, ESpawnMode } from '../core/enums';
import type {
  BossMinionSpawnDataContract,
  EnemyBaseContract,
  SpawnDataContract,
  StageMainContract,
  Vector3Like,
  WaveDataContract,
  WaveManagerViewContract,
  WaveResourceContract,
} from '../view/q4-contracts';
import type { ReadJson } from './loader';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const f = Math.fround;

/** Field readers mirroring loader.ts's F/I/S/B helpers (same defaults). */
function F(e: Json, n: string, d = 0): number {
  const v = e?.[n];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function I(e: Json, n: string, d = 0): number {
  const v = e?.[n];
  return typeof v === 'number' && Number.isFinite(v) ? v | 0 : d;
}
function S(e: Json, n: string): string | null {
  const v = e?.[n];
  return typeof v === 'string' ? v : null;
}
function B(e: Json, n: string): boolean {
  const v = e?.[n];
  return typeof v === 'number' ? v !== 0 : v === true;
}

// ---- enemy prefab name → enemies_EnemyBase.json record index ----------------
// VERIFIED against the user's copy (UnityPy pass, 57/57 resolved, roster
// cross-check clean). Extraction artifact order is load-bearing; the test
// suite pins the stage-1 entries.
const ENEMY_BASE_INDEX: Readonly<Record<string, number>> = {
  bat_00_001: 3,
  bat_00_001_lessJoints: 1,
  bee_00_001: 42,
  boss_bero_00: 11,
  boss_bero_01: 10,
  boss_bero_02: 45,
  boss_bero_03: 31,
  boss_bero_04: 20,
  boss_fat_00: 30,
  boss_fat_01: 13,
  boss_fat_02: 21,
  boss_fat_03: 53,
  boss_fat_04: 43,
  boss_kao_00: 7,
  boss_kao_01: 17,
  boss_kao_02: 26,
  boss_kao_03: 25,
  boss_ude_00: 54,
  boss_ude_01: 18,
  boss_ude_02: 35,
  boss_ude_03: 0,
  boss_ude_04: 15,
  boss_ude_05: 2,
  boss_ude_06: 40,
  cisors_00_001: 23,
  cisors_01_001: 24,
  cisors_02_001: 5,
  cisors_03_001: 29,
  cisors_04_001: 33,
  cisors_05_001: 6,
  cisors_06_001: 9,
  giant_00_001: 8,
  giant_01_001: 16,
  giant_02_001: 39,
  giant_03_001: 50,
  giant_04_001: 51,
  giant_05_001: 38,
  giant_06_001: 49,
  giant_07_001: 28,
  kuri_00_001: 44,
  kuri_01_001: 46,
  kuri_02_001: 14,
  kuri_03_001: 19,
  kuri_04_001: 41,
  kuri_05_001: 56,
  kuri_06_001: 36,
  kuri_07_001: 32,
  kurukuru_00_001: 22,
  kurukuru_07_001: 34,
  spider_00_001: 48,
  spider_01_001: 55,
  spider_02_001: 47,
  spider_03_001: 52,
  spider_04_001: 4,
  spider_05_001: 37,
  spider_06_001: 27,
  spider_07_001: 12,
};

// ---- UnityEngine.Animator.StringToHash ---------------------------------------
// Unity docs (all versions incl. 5.6): "This method uses CRC32 to generate an
// id from a string." Standard CRC-32 (poly 0xEDB88320 reflected, init/xorout
// 0xFFFFFFFF) over the string's UTF-8 bytes, returned as signed int32.
const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** C#: Animator.StringToHash(name) — CRC32 (UTF-8 bytes) as int32. */
export function animatorStringToHash(name: string): number {
  const bytes = new TextEncoder().encode(name);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0;
}

// ---- per-difficulty array readers (float[] vs int[] per dump.cs) -------------
function fArr(a: Json): number[] {
  if (!Array.isArray(a)) return [];
  return a.map((v) => f(typeof v === 'number' && Number.isFinite(v) ? v : 0));
}
function iArr(a: Json): number[] {
  if (!Array.isArray(a)) return [];
  return a.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v | 0 : 0));
}
function sArr(a: Json): string[] {
  if (!Array.isArray(a)) return [];
  return a.map((v) => (typeof v === 'string' ? v : ''));
}

/** Q4.EnemyBase serialized record → EnemyBaseContract (fields the sim reads;
 *  get_IsBoss @0x7F9820 = m_bossType != None). Cached per prefab name — the
 *  contract record stands in for the shared prefab asset. */
function buildEnemyBaseContract(name: string, e: Json): EnemyBaseContract {
  const bossType = I(e, 'm_bossType') as EBossType; // 0x148
  return {
    name,
    speed: f(F(e, 'speed')),
    fireSpeed: f(F(e, 'fireSpeed')),
    balloonSpeed: f(F(e, 'balloonSpeed')),
    collisionScaleH: f(F(e, 'collisionScaleH')),
    collisionScaleV: f(F(e, 'collisionScaleV')),
    lowHPThreshold: f(F(e, 'm_lowHpThreshold')),
    lowHPSpeed: f(F(e, 'm_lowHpSpeed')),
    damagedHpThreshold: f(F(e, 'm_damagedHpThreshold')),
    maxLife: f(F(e, 'maxLife')),
    spawnMode: I(e, 'spawnMode') as ESpawnMode,
    enemyMoveType: I(e, 'enemyMoveType') as EEnemyMoveTypeDef,
    balloonAccScale: f(F(e, 'BalloonAccScale')),
    balloonDamping: f(F(e, 'BalloonDamping')),
    balloonHeight: f(F(e, 'BalloonHeight')),
    balloonSpawnHeight: f(F(e, 'BalloonSpawnHeight')),
    balloonTargetHeight: f(F(e, 'BalloonTargetHeight')),
    groundOffsetY: f(F(e, 'groundOffsetY')),
    drownDepth: f(F(e, 'DrownDepth')),
    isBoss: bossType !== EBossType.None, // get_IsBoss @0x7F9820
    isJumpingBoss: B(e, 'm_isJumpingBoss'),
    bossType,
    bossRestDur: f(F(e, 'm_bossRestDur')),
    bossJumpDur: f(F(e, 'm_bossJumpDur')),
    attackFreq: f(F(e, 'm_attackFreq')),
    bossAttackDur: f(F(e, 'm_bossAttackDur')),
    bossAttackDist: f(F(e, 'm_bossAttackDist')),
    bossAttackHeightForward: f(F(e, 'm_bossAttackHeightForward')),
    bossAttackHeightBack: f(F(e, 'm_bossAttackHeightBack')),
    bossSpawnWaitDur: f(F(e, 'm_bossSpawnWaitDur')),
    sounds: e?.Sounds ?? null, // opaque until the audio iteration
    chibiAvoidRadius: f(F(e, 'ChibiAvoidRadius')),
    expValue: I(e, 'expValue'),
  };
}

interface StageContext {
  enemyBaseRecords: Json[];
  enemyCache: Map<string, EnemyBaseContract | null>;
}

function resolveEnemyContract(ctx: StageContext, name: string | null): EnemyBaseContract | null {
  if (name === null) return null; // unresolved PPtr in the resolved table
  const cached = ctx.enemyCache.get(name);
  if (cached !== undefined) return cached;
  const idx = ENEMY_BASE_INDEX[name];
  const rec = idx !== undefined ? ctx.enemyBaseRecords[idx] : undefined;
  // Missing name/record → null, exactly like a broken prefab PPtr in the
  // original (C# GetComponent<EnemyBase>() on null → null). Never throws:
  // headless runs must surface data gaps as data, not crashes.
  const contract = rec !== undefined && rec !== null ? buildEnemyBaseContract(name, rec) : null;
  ctx.enemyCache.set(name, contract);
  return contract;
}

/** Q4.SpawnData → SpawnDataContract, including the get_pathCurve @0x761AB0
 *  construction (id = Animator.StringToHash(m_pathName), points = m_pathList,
 *  activateIdx = m_activateIndex). One curve per SpawnData, as in C#. */
function buildSpawnData(ctx: StageContext, s: Json, enemyName: string | null): SpawnDataContract {
  const pathName = S(s, 'm_pathName') ?? ''; // 0x40
  const pathList: Vector3Like[] = [];
  const pl = s?.m_pathList; // 0x48
  if (Array.isArray(pl)) {
    for (const p of pl) pathList.push({ x: f(F(p, 'x')), y: f(F(p, 'y')), z: f(F(p, 'z')) });
  }
  let segTypeList: number[] | null = null; // 0x50
  const sg = s?.m_segTypeList;
  if (Array.isArray(sg)) {
    segTypeList = [];
    for (const g of sg) segTypeList.push(typeof g === 'number' ? g | 0 : 0);
  }
  const activateIndex = I(s, 'm_activateIndex'); // 0x58
  return {
    enemyObject: resolveEnemyContract(ctx, enemyName), // 0x10 (prefab component)
    enemySpawnNum: I(s, 'enemySpawnNum'), // 0x18
    enemySpawnInterval: f(F(s, 'enemySpawnInterval')), // 0x1C
    delay: f(F(s, 'delay')), // 0x20
    enemyTrackerEnable: B(s, 'enemyTrackerEnable'), // 0x24
    offsetStartAngle: f(F(s, 'offsetStartAngle')), // 0x28
    offsetFreq: f(F(s, 'offsetFreq')), // 0x2C
    offsetDist: f(F(s, 'offsetDist')), // 0x30
    walkDriftFreq: f(F(s, 'walkDriftFreq')), // 0x34
    walkDriftDist: f(F(s, 'walkDriftDist')), // 0x38
    pathName,
    pathCurve: new CatmullCurve(animatorStringToHash(pathName), pathList, activateIndex),
    pathSegTypeInfos: segTypeList,
    pathStartTime: f(F(s, 'pathStartTime')), // 0x5C
  };
}

/** Q4.WaveData → WaveDataContract. `resolvedDiffs` is the matching
 *  per-difficulty spawn list from stage_waves_resolved.json (same wave/group/
 *  spawn order + m_pathName — the join key). */
function buildWaveData(
  ctx: StageContext,
  w: Json,
  resolvedDiffs: Json[] | null,
  label: string,
): WaveDataContract {
  const pdlRaw: Json[] = Array.isArray(w?.perDifficulyLists) ? w.perDifficulyLists : [];
  const perDifficulyLists = pdlRaw.map((pdl, di) => {
    const rawSpawns: Json[] = Array.isArray(pdl?.spawnDataList) ? pdl.spawnDataList : [];
    const resSpawns: Json[] =
      resolvedDiffs !== null && Array.isArray(resolvedDiffs[di]?.spawns)
        ? resolvedDiffs[di].spawns
        : [];
    return {
      spawnDataList: rawSpawns.map((s, si) => {
        const res = resSpawns[si];
        if (res !== undefined && S(res, 'm_pathName') !== S(s, 'm_pathName')) {
          // binary: no such check — TS data-pipeline guard. A shifted join
          // would silently bind the wrong enemy prefab to a path.
          throw new Error(
            `waveResource: resolved/raw spawn misaligned at ${label} difficulty ${di} spawn ${si} ` +
              `(${S(s, 'm_pathName')} vs ${S(res, 'm_pathName')})`,
          );
        }
        return buildSpawnData(ctx, s, res !== undefined ? S(res, 'enemy') : null);
      }),
    };
  });
  return {
    delay: fArr(w?.delay), // float[] 0x18; <0 ends the wave list
    speedRatio: fArr(w?.speedRatio), // 0x28
    hpRatio: fArr(w?.hpRatio), // 0x20
    totalMoney: iArr(w?.totalMoney), // int[] 0x30
    totalGem: iArr(w?.totalGem), // 0x38
    money: iArr(w?.money), // 0x40
    gem: iArr(w?.gem), // 0x48
    dialogLabel: sArr(w?.dialogLabel), // 0x50
    dialogIcon: iArr(w?.dialogIcon), // 0x58
    perDifficulyLists, // 0x10 (C# typo kept)
  };
}

function buildBossMinionList(
  ctx: StageContext,
  rawList: Json,
  resolvedList: Json[] | null,
  label: string,
): BossMinionSpawnDataContract[] | null {
  if (!Array.isArray(rawList)) return null; // absent → null (contract allows)
  return rawList.map((entry, i) => {
    const resEntry = resolvedList !== null ? resolvedList[i] : undefined;
    const resDiffs: Json[] | null = Array.isArray(resEntry) ? resEntry : null;
    return {
      waveData: buildWaveData(ctx, entry?.waveData, resDiffs, `${label}[${i}]`),
      time: f(F(entry, 'time')), // boss-path time at which the group is released
    };
  });
}

/** Loads the stage's full Q4.WaveResource view contract.
 *  stageIndex is the index into stages_WaveResource.json /
 *  stage_waves_resolved.json (stage 1 = 12; see stage_scene_attribution.json,
 *  scene 3d_stage_001). */
export function loadWaveResource(stageIndex: number, readJson: ReadJson): WaveResourceContract {
  const rawDoc = readJson('stages_WaveResource.json') as Json[];
  const resolvedDoc = readJson('stage_waves_resolved.json') as Json[];
  const enemyBaseRecords = readJson('enemies_EnemyBase.json') as Json[];
  const raw = rawDoc[stageIndex | 0];
  if (raw === undefined || raw === null) {
    throw new RangeError(`waveResource: no WaveResource record at index ${stageIndex}`);
  }
  const resolved = resolvedDoc[stageIndex | 0] ?? null;
  const ctx: StageContext = { enemyBaseRecords, enemyCache: new Map() };

  const rawWaves: Json[] = Array.isArray(raw.waveList) ? raw.waveList : [];
  const resWaves: Json[] =
    resolved !== null && Array.isArray(resolved.waves) ? resolved.waves : [];
  const waveDataList = rawWaves.map((w, wi) =>
    buildWaveData(
      ctx,
      w,
      Array.isArray(resWaves[wi]) ? resWaves[wi] : null,
      `wave ${wi}`,
    ),
  );

  const resBoss = resolved !== null ? resolved.bossMinions : null;
  return {
    waveDataList, // Q4.WaveResource.waveList 0x18
    waveDataBossListEasy: buildBossMinionList(
      ctx,
      raw.waveBossMinionListEasy, // 0x20
      resBoss !== null && Array.isArray(resBoss.easy) ? resBoss.easy : null,
      'bossMinionEasy',
    ),
    waveDataBossListMedium: buildBossMinionList(
      ctx,
      raw.waveBossMinionListMedium, // 0x28
      resBoss !== null && Array.isArray(resBoss.medium) ? resBoss.medium : null,
      'bossMinionMedium',
    ),
    waveDataBossListHard: buildBossMinionList(
      ctx,
      raw.waveBossMinionListHard, // 0x30
      resBoss !== null && Array.isArray(resBoss.hard) ? resBoss.hard : null,
      'bossMinionHard',
    ),
  };
}

/** Loads the stage's Q4.StageMain initial-economy contract from
 *  stages_StageMain.json (same stage index as the WaveResource record). */
export function loadStageMainContract(
  stageIndex: number,
  readJson: ReadJson,
): StageMainContract {
  const doc = readJson('stages_StageMain.json') as Json[];
  const e = doc[stageIndex | 0];
  if (e === undefined || e === null) {
    throw new RangeError(`waveResource: no StageMain record at index ${stageIndex}`);
  }
  return {
    initCoin: I(e, 'm_initCoin'),
    initGem: I(e, 'm_initGem'),
    initWaveCoinRate: f(F(e, 'm_initWaveCoinRate')),
    initWaveTimeRate: f(F(e, 'm_initWaveTimeRate')),
  };
}

/** Convenience: a headless WaveManagerViewContract for the stage
 *  (getEnemyRoot → null — the view-side parenting is a no-op headless,
 *  exactly like the original's missing-enemyRoot path). */
export function headlessWaveManagerView(
  stageIndex: number,
  readJson: ReadJson,
): WaveManagerViewContract {
  const resource = loadWaveResource(stageIndex, readJson);
  return {
    getWaveResource: () => resource,
    getEnemyRoot: () => null,
  };
}
