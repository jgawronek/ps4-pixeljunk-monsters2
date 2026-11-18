// tests/core/wave-manager.test.ts
// Semantics tests for the full GameCoreWaveManager port: SetupWaveData
// (difficulty selection, negative-delay truncation, boss-minion lists),
// CreateWaveProgress (activate-delay minimum incl. spawn-mode speed
// overrides and the jumping-boss AverageSpeed formula, wave-time formula,
// EnemyToSpawnByDifficulty counts, money/gem distribution branches), the
// tick driver (intro gate + 4.75s stage start delay, spawn cadence and
// group/wave event ids, early-clear next-wave shortening by the verified
// initWaveTimeRate = 1.75, boss-minion release by boss path time, the
// 5.0s VERIFIED stage-clear countdown, deferred destroy on game over,
// walkthrough gate).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EBossType, EEnemyMoveTypeDef, ESpawnMode } from '../../src/core/enums';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { EventTime } from '../../src/core/event/CoreEvent';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { Difficulty, GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  setCurrentStageProvider,
  setDifficultySettingsProvider,
  setEnemyViewerFactory,
  setGameInfoControllerProvider,
  setGamePreferencesProvider,
  setJarvisProvider,
  type CatmullCurveContract,
  type EnemyBaseContract,
  type EnemyViewerContract,
  type SpawnDataContract,
  type WaveDataContract,
  type WaveManagerViewContract,
  type WaveResourceContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;
const DT = 1 / 60;

// ---- fixtures ----------------------------------------------------------------

class FakeCurve implements CatmullCurveContract {
  constructor(
    public id: number,
    public curveLengthB4Activation = 2,
  ) {}
  curveLength = 100;
  sampleLinearDistance(distance: number) {
    return { x: distance, y: 0, z: 0 };
  }
  distanceToTime(distance: number, _lastTime: number): number {
    return distance / 10;
  }
  sampleDirect(time: number, sideOffset: number) {
    return { x: time * 10, y: sideOffset, z: 0 };
  }
  sampleVelDirect(_time: number) {
    return { x: 1, y: 0, z: 0 };
  }
  nodeTimeToDistance(time: number): number {
    return time * 10;
  }
}

const MODEL_BOUNDS = {
  size: { x: 0.6, y: 1.0, z: 0.6 },
  extents: { x: 0.3, y: 0.5, z: 0.3 },
};

function enemyPrefab(overrides: Partial<EnemyBaseContract> = {}): EnemyBaseContract {
  return {
    name: 'kuri_00_001',
    speed: 2,
    fireSpeed: 3,
    balloonSpeed: 4,
    collisionScaleH: 1,
    collisionScaleV: 1,
    lowHPThreshold: 10,
    lowHPSpeed: 1.5,
    damagedHpThreshold: 20,
    maxLife: 100,
    spawnMode: ESpawnMode.Normal,
    enemyMoveType: EEnemyMoveTypeDef.ground,
    balloonAccScale: 1,
    balloonDamping: 1,
    balloonHeight: 2,
    balloonSpawnHeight: 3,
    balloonTargetHeight: 1.5,
    groundOffsetY: 0.5,
    drownDepth: 0.3,
    isBoss: false,
    isJumpingBoss: false,
    bossType: EBossType.None,
    bossRestDur: 1,
    bossJumpDur: 0.5,
    attackFreq: 4,
    bossAttackDur: 1,
    bossAttackDist: 1.5,
    bossAttackHeightForward: 1.5,
    bossAttackHeightBack: 0.5,
    bossSpawnWaitDur: 2,
    sounds: null,
    chibiAvoidRadius: 1.2,
    expValue: 10,
    ...overrides,
  };
}

function makeViewer(): EnemyViewerContract {
  return {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    gameObject: { tag: 'enemyView' },
    getComponentInChildrenBalloon: () => null,
    findTransformWithTag: (tag: string) =>
      tag !== 'Character'
        ? null
        : { gameObject: { getComponentInChildrenRenderer: () => ({ bounds: MODEL_BOUNDS }) } },
    attackPoints: () => null,
    isSlopeMovement: false,
    slopeDownSpeedScale: 1,
    slopeDownAngle: 30,
    slopeUpSpeedScale: 1,
    slopeUpAngle: 30,
    getComponentEnemyAttributesSettings: () => null,
  };
}

function spawnData(overrides: Partial<SpawnDataContract> = {}): SpawnDataContract {
  return {
    enemyObject: enemyPrefab(),
    enemySpawnNum: 3,
    enemySpawnInterval: 0.5,
    delay: 0,
    enemyTrackerEnable: true,
    offsetStartAngle: 0,
    offsetFreq: 1,
    offsetDist: 0,
    walkDriftFreq: 0,
    walkDriftDist: 0,
    pathName: 'test_path',
    pathCurve: new FakeCurve(1),
    pathSegTypeInfos: null,
    pathStartTime: 0,
    ...overrides,
  };
}

function waveData(overrides: {
  delay?: [number, number, number];
  speedRatio?: [number, number, number];
  hpRatio?: [number, number, number];
  totalMoney?: [number, number, number];
  money?: [number, number, number];
  totalGem?: [number, number, number];
  gem?: [number, number, number];
  spawns?: SpawnDataContract[];
}): WaveDataContract {
  const spawns = overrides.spawns ?? [spawnData()];
  return {
    delay: overrides.delay ?? [0, 0, 0],
    speedRatio: overrides.speedRatio ?? [1, 1, 1],
    hpRatio: overrides.hpRatio ?? [1, 1, 1],
    totalMoney: overrides.totalMoney ?? [60, 60, 60],
    totalGem: overrides.totalGem ?? [0, 0, 0],
    money: overrides.money ?? [10, 10, 10],
    gem: overrides.gem ?? [0, 0, 0],
    dialogLabel: ['', '', ''],
    dialogIcon: [0, 0, 0],
    perDifficulyLists: [
      { spawnDataList: spawns },
      { spawnDataList: spawns },
      { spawnDataList: spawns },
    ],
  };
}

function waveResource(waves: WaveDataContract[], bossMedium: { waveData: WaveDataContract; time: number }[] | null = null): WaveResourceContract {
  return {
    waveDataList: waves,
    waveDataBossListEasy: null,
    waveDataBossListMedium: bossMedium,
    waveDataBossListHard: null,
  };
}

function managerView(resource: WaveResourceContract): WaveManagerViewContract {
  return { getWaveResource: () => resource, getEnemyRoot: () => null };
}

let core: GameCore;
const physicsFake: SimPhysics = {
  linecast: (): RaycastHit | null => null,
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 80, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(DT); // installs the frame + sets tickDeltaTime
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics(physicsFake);
  setEnemyViewerFactory(() => makeViewer());
  setCurrentStageProvider(() => ({
    initCoin: 450,
    initGem: 0,
    initWaveCoinRate: 1,
    initWaveTimeRate: 1.75, // VERIFIED stage-1 value
  }));
  unityRandom.InitState(11);
});

afterEach(() => {
  setInstanceProvider(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setEnemyViewerFactory(null);
  setCurrentStageProvider(() => null);
  setDifficultySettingsProvider(null);
  setGamePreferencesProvider(null);
  setGameInfoControllerProvider(null);
  setJarvisProvider(null);
  resetUnityObjectRegistryForTests();
});

function tickN(wm: GameCoreWaveManager, n: number): void {
  for (let i = 0; i < n; i++) wm.tick();
}
/** Burn through the 4.75s post-intro stage start delay. */
function finishIntro(wm: GameCoreWaveManager): void {
  Events.introSequenceFinishedEvent.invoke(null as unknown as GameCorePlayer);
  tickN(wm, 300); // 5.0s > 4.75s
}

// ---- SetupWaveData / CreateWaveProgress ---------------------------------------

describe('GameCoreWaveManager.SetupWaveData', () => {
  it('builds wave progress from the resource; negative delay truncates; difficulty picks boss list', () => {
    const resource = waveResource(
      [
        waveData({}),
        waveData({ delay: [5, 5, -1] }), // Hard ends after wave 1
        waveData({}),
      ],
      [{ waveData: waveData({}), time: 12.5 }],
    );
    setGamePreferencesProvider(() => ({ difficultySetting: Difficulty.Medium }));
    const wm = new GameCoreWaveManager(managerView(resource));
    expect(wm.waveProgressList.length).toBe(3);
    expect(wm.waveBossMinionProgress.length).toBe(1);
    expect(wm.waveBossMinionProgress[0].remainingSpawnStartDelay).toBe(12.5);

    setGamePreferencesProvider(() => ({ difficultySetting: Difficulty.Hard }));
    const wmHard = new GameCoreWaveManager(managerView(resource));
    expect(wmHard.waveProgressList.length).toBe(1); // negative-delay wave is excluded entirely
    expect(wmHard.waveBossMinionProgress.length).toBe(0); // Hard list is null
  });

  it('activate delay = min over spawners with spawn-mode speed overrides; boss AverageSpeed formula', () => {
    const ground = spawnData({ pathCurve: new FakeCurve(1, 2), enemyObject: enemyPrefab({ speed: 2 }) });
    const balloon = spawnData({
      pathCurve: new FakeCurve(2, 4),
      enemyObject: enemyPrefab({ spawnMode: ESpawnMode.Balloon, speed: 99, balloonSpeed: 4 }),
    });
    const jumpingBoss = spawnData({
      pathCurve: new FakeCurve(3, 3),
      enemyObject: enemyPrefab({
        bossType: EBossType.Bero,
        isJumpingBoss: true,
        speed: 2,
        bossJumpDur: 0.5,
        bossRestDur: 1.5,
      }),
    });
    const wm = new GameCoreWaveManager(managerView(waveResource([waveData({ spawns: [ground, balloon, jumpingBoss] })])));
    const p = wm.waveProgressList[0];
    // ground: 2/(1×2) = 1.0; balloon: 4/(1×4) = 1.0;
    // boss: avg = (0.5×2)/(0.5+1.5) = 0.5 → 3/0.5 = 6.0 → min = 1.0
    expect(p.remainingWaveActivateDelay).toBeCloseTo(1.0, 6);
  });

  it('wave time formula and EnemyToSpawnByDifficulty counts', () => {
    setDifficultySettingsProvider(() => ({
      valueCoinByDifficulty: (v: number) => v,
      enemyHPByDifficulty: (v: number) => v,
      towerBuildTimeByDifficulty: (v: number) => v,
      enemyToSpawnByDifficulty: (n: number) => Math.max(1, Math.round(n * 1.5)), // ×1.5 rate
    }));
    const sp = spawnData({ enemySpawnNum: 4, enemySpawnInterval: 0.5, delay: 2 });
    const wm = new GameCoreWaveManager(managerView(waveResource([waveData({ spawns: [sp] })])));
    const p = wm.waveProgressList[0];
    expect(p.totalNumEnemy).toBe(6); // round(4×1.5)
    // remainingWaveTime = delay + (numToSpawn−1)×interval = 2 + 5×0.5 = 4.5
    expect(p.remainingWaveTime).toBeCloseTo(4.5, 6);
  });

  it('currency distribution: uneven split sums to total with +1 bonuses; flat-covering zeroes + remainder', () => {
    // Uneven: total=200, money=10, 7 enemies → base 28, four 29s.
    const sp7 = spawnData({ enemySpawnNum: 7 });
    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [sp7], totalMoney: [200, 200, 200], money: [10, 10, 10] })])),
    );
    const arr = wm.waveProgressList[0].moneyArray;
    expect(arr.length).toBe(7);
    expect(arr.reduce((a, b) => a + b, 0)).toBe(200);
    expect(Math.min(...arr)).toBe(28);
    expect(arr.filter((v) => v === 29).length).toBe(4);

    // Flat-covering with remainder: total=35, money=10, 5 enemies →
    // three 10s, one 0, one 5 (remainder placed on the last picked).
    const wm2 = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [spawnData({ enemySpawnNum: 5 })], totalMoney: [35, 35, 35] })])),
    );
    const arr2 = wm2.waveProgressList[0].moneyArray;
    expect(arr2.reduce((a, b) => a + b, 0)).toBe(35);
    expect(arr2.filter((v) => v === 10).length).toBe(3);
    expect(arr2.filter((v) => v === 0).length).toBe(1);
    expect(arr2.filter((v) => v === 5).length).toBe(1);
  });
});

// ---- tick driver ---------------------------------------------------------------

describe('GameCoreWaveManager tick driver', () => {
  it('intro gate: no spawning before introSequenceFinished; 4.75s stage start delay after it', () => {
    const spawned: GameCoreEnemy[] = [];
    const cb = (e: GameCoreEnemy) => spawned.push(e);
    Events.enemySpawnEvent.addListener(cb, EventTime.Immediate);

    const wm = new GameCoreWaveManager(managerView(waveResource([waveData({})])));
    tickN(wm, 600); // 10s without intro
    expect(spawned.length).toBe(0);

    Events.introSequenceFinishedEvent.invoke(null as unknown as GameCorePlayer);
    expect(wm.introSequenceFinished).toBe(true);
    tickN(wm, 60); // 1.0s — still inside the 4.75s delay
    expect(spawned.length).toBe(0);
    tickN(wm, 240); // → 5.0s total
    expect(spawned.length).toBeGreaterThan(0);
    Events.enemySpawnEvent.removeListener(cb);
  });

  it('spawn cadence + group/wave event ids + money assignment from the distribution array', () => {
    const events: string[] = [];
    const spawned: GameCoreEnemy[] = [];
    const cbs = {
      spawn: (e: GameCoreEnemy) => spawned.push(e),
      groupStart: (id: number, _e: unknown, _p: unknown, isMinion: boolean) =>
        events.push(`gs:${id}:${isMinion}`),
      groupEnd: (id: number) => events.push(`ge:${id}`),
      waveStart: (_wm: unknown, idx: number) => events.push(`ws:${idx}`),
      waveActivate: (_wm: unknown, idx: number) => events.push(`wa:${idx}`),
    };
    Events.enemySpawnEvent.addListener(cbs.spawn, EventTime.Immediate);
    Events.spawnGroupStartedEvent.addListener(cbs.groupStart, EventTime.Immediate);
    Events.spawnGroupEndedEvent.addListener(cbs.groupEnd, EventTime.Immediate);
    Events.waveStartedEvent.addListener(cbs.waveStart, EventTime.Immediate);
    Events.waveActivateEvent.addListener(cbs.waveActivate, EventTime.Immediate);

    const sp = spawnData({ enemySpawnNum: 3, enemySpawnInterval: 0.5 });
    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [sp], totalMoney: [60, 60, 60], money: [10, 10, 10] })])),
    );
    finishIntro(wm);
    expect(events).toContain('gs:0:false');
    expect(events).toContain('ws:0');
    expect(spawned.length).toBeGreaterThan(0);
    // interval 0.5 = 30 ticks; 3 enemies → last spawns ~tick 61 post-delay
    tickN(wm, 120);
    expect(spawned.length).toBe(3);
    expect(events).toContain('ge:0'); // 0×1000 + spawner 0
    expect(events).toContain('wa:0'); // activate delay 1.0s elapsed
    expect(spawned[0].getCoinValue()).toBe(20); // 60/3 flat
    expect(spawned.every((e) => e.getWaveIndex() === 0)).toBe(true);
  });

  it('early clear: killing a whole wave fires waveEnded and shortens the next wave start by ×(2−1.75)', () => {
    const ended: number[] = [];
    const spawned: GameCoreEnemy[] = [];
    Events.waveEndedEvent.addListener((_wm, idx) => ended.push(idx), EventTime.Immediate);
    Events.enemySpawnEvent.addListener((e) => spawned.push(e), EventTime.Immediate);

    const wm = new GameCoreWaveManager(
      managerView(
        waveResource([waveData({ spawns: [spawnData({ enemySpawnNum: 2 })] }), waveData({ delay: [8, 8, 8] })]),
      ),
    );
    finishIntro(wm);
    tickN(wm, 120); // spawn both wave-0 enemies; wave 0 completes → wave 1's
    // start delay has already begun burning down (faithful: only the current
    // wave index is ticked, and completion advances it immediately).
    expect(spawned.length).toBe(2);
    const beforeKill = wm.waveProgressList[1].remainingSpawnStartDelay;
    expect(beforeKill).toBeLessThan(8);

    for (const e of spawned) e.dealDamage(null, 10000, 0, null, true); // faithful kill path
    expect(ended).toEqual([0]);
    // startDelay − (startDelay×1.75 − startDelay) = startDelay×(2−1.75) = ×0.25
    expect(wm.waveProgressList[1].remainingSpawnStartDelay).toBeCloseTo(f(beforeKill * 0.25), 4);
  });

  it('enemy reaching home counts as dead (non-boss); boss does not', () => {
    const ended: number[] = [];
    const spawned: GameCoreEnemy[] = [];
    Events.waveEndedEvent.addListener((_wm, idx) => ended.push(idx), EventTime.Immediate);
    Events.enemySpawnEvent.addListener((e) => spawned.push(e), EventTime.Immediate);

    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [spawnData({ enemySpawnNum: 1 })] })])),
    );
    finishIntro(wm);
    tickN(wm, 30);
    expect(spawned.length).toBe(1);
    Events.enemyAttackedHomeEvent.invoke(spawned[0], null as never, null as never);
    expect(ended).toEqual([1 - 1]); // wave 0 ended

    // Boss variant: not counted as dead on home attack.
    const bossSpawn = spawnData({ enemySpawnNum: 1, enemyObject: enemyPrefab({ isBoss: true, bossType: EBossType.Bero }) });
    const wm2 = new GameCoreWaveManager(managerView(waveResource([waveData({ spawns: [bossSpawn] })])));
    const ended2: number[] = [];
    const spawned2: GameCoreEnemy[] = [];
    const cbE = (_wm: unknown, idx: number) => ended2.push(idx);
    const cbS = (e: GameCoreEnemy) => spawned2.push(e);
    Events.waveEndedEvent.addListener(cbE, EventTime.Immediate);
    Events.enemySpawnEvent.addListener(cbS, EventTime.Immediate);
    finishIntro(wm2);
    tickN(wm2, 30);
    expect(spawned2.length).toBe(1);
    expect(wm2.bossHasAppeared).toBe(true); // m_bossHandle latched
    Events.enemyAttackedHomeEvent.invoke(spawned2[0], null as never, null as never);
    expect(ended2).toEqual([]);
  });

  it('boss-minion wave releases by boss path time', () => {
    const groupStarts: Array<[number, boolean]> = [];
    Events.spawnGroupStartedEvent.addListener(
      (id, _e, _p, isMinion) => groupStarts.push([id, isMinion]),
      EventTime.Immediate,
    );
    // Boss spawns at pathStartTime 6 → distance 60 → bossTime 6.0 ≥ minion time 0.5.
    // offsetStartAngle 60° → round(60×Deg2Rad)=1; ×offsetDist 6 → pathStartTime 6.
    const bossSpawn = spawnData({
      enemySpawnNum: 1,
      enemyObject: enemyPrefab({ isBoss: true, bossType: EBossType.Bero }),
      offsetStartAngle: 60,
      offsetDist: 6,
    });
    const minionSpawn = spawnData({ enemySpawnNum: 2 });
    const minionWave = waveData({ spawns: [minionSpawn] });
    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [bossSpawn] })], [{ waveData: minionWave, time: 0.5 }])),
    );
    finishIntro(wm);
    tickN(wm, 90);
    const minionStarts = groupStarts.filter(([, m]) => m);
    expect(minionStarts.length).toBe(1); // minion group 0 released (id 0)
    expect(wm.bossHasAppeared).toBe(true);
  });

  it('stage clear: after the last wave, 5.0s VERIFIED countdown once the field is empty', () => {
    const cleared: number[] = [];
    const spawned: GameCoreEnemy[] = [];
    Events.stageClearedEvent.addListener(() => cleared.push(1), EventTime.Immediate);
    Events.enemySpawnEvent.addListener((e) => spawned.push(e), EventTime.Immediate);

    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ spawns: [spawnData({ enemySpawnNum: 1 })] })])),
    );
    finishIntro(wm);
    tickN(wm, 120); // spawn the enemy; wave completes; currentWaveIndex → 1
    expect(wm.waveCurrentIndex).toBe(1);

    tickN(wm, 600); // enemy still alive → no clear countdown
    expect(cleared.length).toBe(0);

    spawned[0].dealDamage(null, 10000, 0, null, true); // field empty
    tickN(wm, 60); // 1s — countdown (5.0s) running
    expect(cleared.length).toBe(0);
    tickN(wm, 300); // → 6s total
    expect(cleared.length).toBe(1);
    expect(wm.hasClearedStage).toBe(true);
    tickN(wm, 120);
    expect(cleared.length).toBe(1); // fires exactly once
  });

  it('gameOverEvent → destroyed flag now, teardown on next tick (faithful deferral)', () => {
    const wm = new GameCoreWaveManager(managerView(waveResource([waveData({})])));
    Events.gameOverEvent.invoke();
    expect(wm.isDestroyed()).toBe(true);
    // After the teardown tick the listeners are gone: further events do nothing.
    wm.tick();
    const spawned: GameCoreEnemy[] = [];
    Events.enemySpawnEvent.addListener((e) => spawned.push(e), EventTime.Immediate);
    finishIntro(wm); // intro event no longer reaches it
    expect(wm.introSequenceFinished).toBe(false);
  });

  it('walkthroughMode halts all spawning', () => {
    setJarvisProvider(() => ({ walkthroughMode: true }));
    const spawned: GameCoreEnemy[] = [];
    Events.enemySpawnEvent.addListener((e) => spawned.push(e), EventTime.Immediate);
    const wm = new GameCoreWaveManager(managerView(waveResource([waveData({})])));
    finishIntro(wm);
    tickN(wm, 600);
    expect(spawned.length).toBe(0);
  });

  it('skipToWave clamps and zeroes the target wave start delay', () => {
    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ delay: [3, 3, 3] }), waveData({ delay: [4, 4, 4] })])),
    );
    wm.skipToWave(99);
    expect(wm.waveCurrentIndex).toBe(1);
    expect(wm.waveProgressList[1].remainingSpawnStartDelay).toBe(0);
  });

  it('helpers: getTimeUntilWaveActivates / isStartedWave / getEnemyPrefabForWave', () => {
    const wm = new GameCoreWaveManager(
      managerView(waveResource([waveData({ delay: [2, 2, 2] }), waveData({ delay: [3, 3, 3] })])),
    );
    expect(wm.getTimeUntilWaveActivates(9)).toBe(0); // out of range
    expect(wm.getEnemyPrefabForWave(9)).toBeNull();
    expect(wm.getEnemyPrefabForWave(0)!.name).toBe('kuri_00_001');
    expect(wm.isStartedWave(0)).toBe(false);
    expect(f(wm.getTimeUntilWaveActivates(1))).toBeGreaterThan(0);
  });
});
