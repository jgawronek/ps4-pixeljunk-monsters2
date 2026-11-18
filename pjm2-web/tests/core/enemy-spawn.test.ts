// tests/core/enemy-spawn.test.ts
// Semantics tests for the GameCoreEnemy spawn ctor + lifecycle chunk: pool
// defaults, stat scaling via the data-verified difficulty HP default, collision
// from model bounds × scales + heavy flag, spawn modes (Normal/Fire/Balloon),
// attack-point init (view list / Kao boss config / balloon point), the
// ChibiAvoidRadius-for-both-fields quirk, PostGameCoreTick gameOver flagging,
// DestroySelf teardown, targeting slots, and the early-out paths.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { Buff } from '../../src/core/Buff';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EBossType, EEnemyMoveTypeDef, ESpawnMode } from '../../src/core/enums';
import { CoreEventBase, EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from '../../src/core/GameCoreEnemyAttackPoint';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import type { GameCoreObject } from '../../src/core/GameCoreObject';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  setChibiAvoidanceZoneNotifier,
  setEnemyViewerFactory,
  type BalloonContract,
  type CatmullCurveContract,
  type EnemyAttackPointViewContract,
  type EnemyBaseContract,
  type EnemyViewerContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- fixtures ----------------------------------------------------------------

class FakeCurve implements CatmullCurveContract {
  id = 7;
  curveLength = 10;
  curveLengthB4Activation = 2;
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
    return { x: 0, y: 0, z: 1 };
  }
  nodeTimeToDistance(time: number): number {
    return time * 10;
  }
}

class ExitBuff extends Buff {
  exits = 0;
  override executeBuff(_t: GameCoreObject): void {}
  override onExitBuff(t: GameCoreObject): void {
    this.exits++;
    super.onExitBuff(t);
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
    chibiAvoidRadius: 1.2, expValue: 10,
    ...overrides,
  };
}

function pointView(
  radius: number | null,
  localPosition: { x: number; y: number; z: number },
  setting: { moveTypeOverride: EEnemyMoveTypeDef; afterAirPoints: boolean } | null,
): EnemyAttackPointViewContract {
  return {
    getComponentSphereColliderRadius: () => radius,
    transform: { localPosition },
    getComponentAttackPointSetting: () => setting,
    getComponentEnemyAttributesSettings: () => null,
  };
}

function makeViewer(opts: {
  balloon?: BalloonContract | null;
  points?: EnemyAttackPointViewContract[] | null;
  noCharacter?: boolean;
  noRenderer?: boolean;
} = {}): EnemyViewerContract {
  return {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    gameObject: { tag: 'enemyView' },
    getComponentInChildrenBalloon: () => opts.balloon ?? null,
    findTransformWithTag: (tag: string) =>
      opts.noCharacter || tag !== 'Character'
        ? null
        : {
            gameObject: {
              getComponentInChildrenRenderer: () =>
                opts.noRenderer ? null : { bounds: MODEL_BOUNDS },
            },
          },
    attackPoints: () => opts.points ?? null,
    isSlopeMovement: false,
    slopeDownSpeedScale: 1,
    slopeDownAngle: 30,
    slopeUpSpeedScale: 1,
    slopeUpAngle: 30,
    getComponentEnemyAttributesSettings: () => null,
  };
}

let core: GameCore;
let currentViewer: EnemyViewerContract | null;
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
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 40, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics(physicsFake);
  currentViewer = makeViewer();
  setEnemyViewerFactory(() => currentViewer);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setEnemyViewerFactory(null);
  setChibiAvoidanceZoneNotifier(null);
  resetUnityObjectRegistryForTests();
});

function spawnEnemy(
  prefab: EnemyBaseContract = enemyPrefab(),
  pathStartTime = 0,
  curve: CatmullCurveContract = new FakeCurve(),
): GameCoreEnemy {
  return new GameCoreEnemy(
    prefab, curve, null, pathStartTime, 'path_001',
    /*speedRatio*/ 1, /*hpRatio*/ 1, /*money*/ 20, /*gem*/ 1,
    /*waveIndex*/ 0, /*waveSubIndex*/ 0, /*waveSpawnIndex*/ 0,
    /*spawnInterval*/ 1.5, /*sideCenterOffset*/ 0, /*driftDist*/ 0.2, /*driftFreq*/ 2,
    /*isMinion*/ false, /*isEnemyTrackEnableOnMe*/ true,
  );
}

// ---- tests ---------------------------------------------------------------------

describe('GameCoreEnemy pool-default ctor', () => {
  it('faithful defaults (@0x4ACDC0)', () => {
    const e = new GameCoreEnemy();
    expect(e.enemyMoveType).toBe(EEnemyMoveTypeDef.ground);
    expect(e.moveVec.z).toBe(1); // Vector3.forward
    expect(e.speed).toBe(1);
    expect(e.waveGroupID).toBe(-10001); // -1 * 10000 + -1
    expect(e.getLife()).toBe(0);
    expect(e.buffs).toBeNull(); // not created until spawn
    expect(e.attackPoints).toBeNull();
    expect(e.valid()).toBe(true); // no points → body valid
    expect(e.isAimableTarget(e as unknown as GameCoreObject)).toBe(true);
    expect(e.canAttack).toBe(true); // m_canAttack=true default, delay 0
  });
});

describe('GameCoreEnemy spawn ctor', () => {
  it('stats: difficulty-scaled HP (data-verified 0.9 default), values, wave fields, speeds', () => {
    const e = spawnEnemy();
    // Max(1, trunc(0.9 × 100)) = 90; thresholds 10→9, 20→18
    expect(e.getLife()).toBe(90);
    expect(e.getMaxLife()).toBe(90);
    expect(e.getCoinValue()).toBe(20);
    expect(e.getGemValue()).toBe(1);
    expect(e.getWaveIndex()).toBe(0);
    expect(e.waveGroupID).toBe(0);
    expect(e.pathName).toBe('path_001');
    expect(e.enemyTrackerEnable).toBe(true);
    expect(e.isMinion).toBe(false);
    expect(e.speedCur).toBe(2); // speedRatio 1 × view.speed 2 × scale 1
    expect(e.speed).toBe(2);
    expect(e.pathDistance).toBe(0); // nodeTimeToDistance(0)
    expect(e.position.y).toBeCloseTo(0.5, 6); // groundOffsetY landed
    expect(e.validateTarget()).toBe(false); // distance 0 < b4activation 2
  });

  it('collision from Character-tagged model bounds × scales; heavy flag from pre-scale height', () => {
    const e = spawnEnemy(enemyPrefab({ collisionScaleH: 2, collisionScaleV: 0.5 }));
    expect(e.isHeavyEnemy).toBe(true); // bounds height 1.0 ≥ 0.99 (before scaling)
    expect(e.collision.radius).toBeCloseTo(0.6, 6); // 0.3 × 2
    expect(e.collision.height).toBeCloseTo(0.5, 6); // 1.0 × 0.5
  });

  it('FAITHFUL QUIRK: ChibiAvoidDur reads ChibiAvoidRadius too (announcement carries both)', () => {
    const announcements: Array<[number, number]> = [];
    setChibiAvoidanceZoneNotifier((_pos, r, d) => announcements.push([r, d]));
    const e = spawnEnemy(); // post-spawn: m_canAttack=false, delay 1
    expect(e.canAttack).toBe(false); // delay 1 > 0, but announcement fired
    expect(announcements.length).toBe(1);
    expect(announcements[0][0]).toBeCloseTo(1.2, 6); // f32(1.2)
    expect(announcements[0][1]).toBeCloseTo(1.2, 6); // BOTH fields read the radius
  });

  it('Fire spawn mode: on fire, fireSpeed via getter; FAITHFUL ordering quirk on speedCur', () => {
    const e = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Fire }));
    expect(e.isOnFire).toBe(true);
    // FAITHFUL QUIRK (ctor order): m_speedCur is computed BEFORE m_isOnFire is
    // set from spawnMode → initial speedCur uses the NORMAL speed (2).
    expect(e.speedCur).toBe(2);
    expect(e.speed).toBe(3); // the getter reads the current fire flag
    expect(e.enemyMoveType).toBe(EEnemyMoveTypeDef.ground);
    expect(e.isBalloon).toBe(false);
  });

  it('Balloon spawn mode: air type, balloon speed/height, single target point', () => {
    const balloon: BalloonContract = { balloonsRemaining: 3, hp: 30, gameObject: { tag: 'balloon' } };
    currentViewer = makeViewer({ balloon });
    const b = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Balloon }));
    expect(b.isBalloon).toBe(true);
    expect(b.enemyMoveType).toBe(EEnemyMoveTypeDef.air);
    expect(b.moveType()).toBe(EEnemyMoveTypeDef.air);
    expect(b.speed).toBe(4); // balloonSpeed
    expect(b.groundOffsetY).toBe(3); // BalloonSpawnHeight
    expect(b.position.y).toBeCloseTo(3, 6);
    expect(b.attackPoints!.length).toBe(1);
    const ap = b.attackPoints![0].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    expect(ap.localPosition.y).toBeCloseTo(1.5, 6); // up × BalloonTargetHeight
    expect(ap.collision.radius).toBeCloseTo(0.25, 6);
    expect(b.valid()).toBe(false); // has attack points → body not directly valid
    expect(b.isAimableTarget(b as unknown as GameCoreObject)).toBe(false);
  });

  it('ground attack points from the view list: radius fallback 0.5, settings, glued positions', () => {
    currentViewer = makeViewer({
      points: [
        pointView(0.3, { x: 0, y: 1, z: 0 }, { moveTypeOverride: EEnemyMoveTypeDef.air, afterAirPoints: false }),
        pointView(null, { x: 0, y: 0.5, z: 0 }, null),
      ],
    });
    const e = spawnEnemy();
    expect(e.attackPoints!.length).toBe(2);
    const ap0 = e.attackPoints![0].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    const ap1 = e.attackPoints![1].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    expect(ap0.moveType()).toBe(EEnemyMoveTypeDef.air); // override
    expect(ap1.moveType()).toBe(EEnemyMoveTypeDef.ground); // inherits host
    expect(ap1.collision.radius).toBeCloseTo(0.5, 6); // no collider → default
    // TickAttackPoints(0) glued them: enemy at (0,0.5,0), moveVec +z (identity rot)
    expect(ap0.position.y).toBeCloseTo(1.5, 6);
    expect(ap1.position.y).toBeCloseTo(1.0, 6);
    expect(e.valid()).toBe(false); // body has points
  });

  it('Kao boss: only the current-move-type points stay enabled', () => {
    currentViewer = makeViewer({
      points: [
        pointView(0.3, { x: 0, y: 1, z: 0 }, { moveTypeOverride: EEnemyMoveTypeDef.air, afterAirPoints: false }),
        pointView(0.3, { x: 0, y: 0.5, z: 0 }, { moveTypeOverride: EEnemyMoveTypeDef.ground, afterAirPoints: false }),
      ],
    });
    const e = spawnEnemy(enemyPrefab({ isBoss: true, bossType: EBossType.Kao }));
    const apAir = e.attackPoints![0].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    const apGround = e.attackPoints![1].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    expect(apGround.valid()).toBe(true); // ground mode → ground enabled
    expect(apAir.valid()).toBe(false); // air disabled
  });

  it('pathStartTime past activation → validateTarget true; prediction samples the path', () => {
    const e = spawnEnemy(enemyPrefab(), 0.5); // distance = 5
    expect(e.pathDistance).toBe(5);
    expect(e.validateTarget()).toBe(true);
    const pred = e.predictPositionAndDirection(0.25); // 0.25×2 + 5 = 5.5
    expect(pred.pos.x).toBeCloseTo(5.5, 5);
    expect(pred.direction.z).toBe(1);
  });

  it('gameOverEvent flags m_IsGameOver on the PostGameCoreTick replay', () => {
    const e = spawnEnemy();
    Events.gameOverEvent.invoke();
    expect(e.m_IsGameOver).toBe(false); // deferred
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(e.m_IsGameOver).toBe(true);
  });

  it('DestroySelf: disables points, terminates buffs, detaches listeners', () => {
    currentViewer = makeViewer({
      points: [pointView(0.3, { x: 0, y: 1, z: 0 }, null)],
    });
    const e = spawnEnemy();
    const buff = new ExitBuff(5);
    e.buffs.addBuff(buff, e);
    const ap = e.attackPoints![0].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>()!;
    e.destroySelf();
    expect(e.isDestroyed()).toBe(true);
    expect(ap.valid()).toBe(false); // disabled
    expect(buff.exits).toBe(1); // terminated
    Events.gameOverEvent.invoke();
    expect(() => CoreEventBase.invokePendingPostGameCoreTickEvents()).not.toThrow();
  });

  it('early-outs: null path / null viewer / missing Character transform / missing renderer', () => {
    const noPath = new GameCoreEnemy(enemyPrefab(), null, null, 0, 'p', 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, false, false);
    expect(noPath.pathMove).toBeNull();
    expect(noPath.getLife()).toBe(0);

    setEnemyViewerFactory(null); // headless default → null viewer
    const noViewer = spawnEnemy();
    expect(noViewer.getLife()).toBe(0);
    expect(noViewer.pathMove).toBeNull();

    setEnemyViewerFactory(() => makeViewer({ noCharacter: true }));
    expect(spawnEnemy().getLife()).toBe(0);
    setEnemyViewerFactory(() => makeViewer({ noRenderer: true }));
    expect(spawnEnemy().getLife()).toBe(0);
  });

  it('isSameEnemyWaveGroup compares the computed group id', () => {
    const a = spawnEnemy();
    const b = spawnEnemy();
    expect(a.isSameEnemyWaveGroup(b)).toBe(true);
  });
});
