// src/core/TowerHelper.ts
// TypeScript port of decomp/src/GameCore/TowerHelper.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3379,
// RVA 0x4C5ED0..0x4E0C60). Static tower targeting + construction utilities.
//
// Rodata CONFIRMED: DAT_00b7c4a4 = 0.5 (LoS probe raise), DAT_00b7c4a8 = 100.0
// (tree query height scale), DAT_00b7c4ac = 360.0 (full yaw sweep).
//
// TS ADAPTATIONS: the two GetNearestTargets overloads → getNearestTargets
// (3-arg) + getNearestTargetsWithFilters (5-arg); `(IDamageable)obj` casts →
// asDamageable; Q4.TowerBase prefab → TowerBaseContract + viewer factory hook;
// DifficultySettings.TowerBuildTimeByDifficulty → provider (SP default identity).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import {
  getTowerBuildTimeByDifficulty,
  instantiateTowerViewer,
  registerUnityObject,
  type NatureTreeViewContract,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { EEnemyMoveTypeDef, ETowerAttackDef } from './enums';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from './GameCoreEnemyAttackPoint';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCoreTower } from './GameCoreTower';
import { GameCoreTree } from './GameCoreTree';
import { asDamageable, type IDamageable } from './interfaces';
import { getSimPhysics, Q4Layers } from './physics-seam';
import { TowerStateBuild } from './TowerStateBuild';

const f = Math.fround;

export class TowerHelper {
  private constructor() {}

  /** Scratch buffer reused by every GetNearestTargets call (.cctor @0x4E0C60). */
  private static targetsCache: GameCoreObject[] = [];

  private static readonly treeQueryHeightScale = f(100.0); // DAT_00b7c4a8

  // GetProjectileGameCoreHitPoisition @0x4C5ED0 [sic — original typo]
  static getProjectileGameCoreHitPoisition(tower: GameCoreTower | null, targetPos: Vector3): Vector3 {
    if (tower === null) return Vector3.zero;

    const delta = targetPos.sub(tower.position);
    if (delta.magnitude < tower.attackRangeInner) {
      // Impact pushed OUT to the inner-range sphere, keeping relative height.
      return tower.position
        .add(delta.normalized.mulScalar(tower.attackRangeInner))
        .add(Vector3.up.mulScalar(delta.y));
    }
    return targetPos;
  }

  // IsTarget @0x4CAD00 — 3-bit key fold: ground(1)→4, air(2)→5, all(3)→6.
  static isTarget(movementType: EEnemyMoveTypeDef, attackType: ETowerAttackDef): boolean {
    const key = ((attackType < 4 ? attackType + 3 : 0) & 7) | 0;
    switch (key) {
      case 6:
        return true; // all
      case 5:
        return movementType === EEnemyMoveTypeDef.air;
      case 4:
        return movementType === EEnemyMoveTypeDef.ground;
      default:
        return false;
    }
  }

  // GetNearestTargets @0x4CF510 (3-arg) — nearest-first valid targets inside
  // the affect cylinder; the foundAny detection test is STICKY after the first
  // candidate (faithful); nothing detected → result cleared entirely.
  static getNearestTargets(
    tower: GameCoreTower,
    result: IDamageable[],
    ignoreInnerRange = true,
  ): void {
    // FAITHFUL: NRE when tower or its detector is null.
    const detector = tower.enemyDetector!;

    const collision = detector.getCollisionCylinder();
    const affect = detector.getAffectCylinder();

    // Lowered anchor ONLY for the spatial query; InAttack/InDetection below
    // use the un-lowered detector position (faithful).
    const detectorPos = tower.position.add(detector.getOffset());
    const queryPos = detectorPos.add(
      Vector3.down.mulScalar(f(collision.height * detector.getAnchorV())),
    );

    TowerHelper.targetsCache.length = 0;
    for (const enemy of GameCore.instance!.allObjectsIn<GameCoreEnemy>(GameCoreEnemy, queryPos, affect)) {
      TowerHelper.targetsCache.push(enemy);
    }
    // Attack points gathered GLOBALLY (no spatial filter — faithful).
    for (const point of GameCore.instance!.allObjects<GameCoreEnemyAttackPoint>(GameCoreEnemyAttackPoint)) {
      TowerHelper.targetsCache.push(point);
    }

    let foundAny = false;
    for (let i = 0; i < TowerHelper.targetsCache.length; i++) {
      const obj = TowerHelper.targetsCache[i];
      const d = asDamageable(obj)!; // C# hard cast — enemies/points implement it

      if (!d.validateTarget()) continue;
      if (!TowerHelper.isTarget(d.moveType(), tower.attackType)) continue;
      if (!d.isAimableTarget(tower)) continue;

      let pass = true;
      if (!ignoreInnerRange) {
        const delta = tower.position.sub(d.position);
        pass = f(tower.attackRangeInner * tower.attackRangeInner) <= delta.sqrMagnitude;
      }

      if (!detector.inAttack(detectorPos, obj)) continue;

      if (pass && TowerHelper.clearViewOnTarget(tower, d)) {
        if (!foundAny) {
          // First candidate decides foundAny via the detection test; later
          // candidates skip it and keep it sticky — faithful.
          pass = detector.inDetection(detectorPos, obj);
        }
        result.push(d);
        foundAny = pass;
      }
    }

    if (!foundAny) result.length = 0;
  }

  // GetNearestTargets @0x4E0150 (5-arg) — collection + fire-range filter + truncation.
  static getNearestTargetsWithFilters(
    tower: GameCoreTower,
    result: IDamageable[],
    filterInFireRange = false,
    count = 0,
    ignoreInnerRange = true,
  ): void {
    TowerHelper.getNearestTargets(tower, result, ignoreInnerRange);

    if (result === null || !filterInFireRange) return;

    // Reverse walk so removals keep indices valid.
    for (let i = result.length - 1; i >= 0; i--) {
      const item = result[i];
      if (item === null || !TowerHelper.isTargetInFireRange(tower, item)) {
        result.splice(i, 1);
      }
    }
    if (count !== 0 && count < result.length) {
      result.splice(count, result.length - count);
    }
  }

  // ClearViewOnTarget @0x4DFFA0 — terrain must not block muzzle → target+0.5.
  static clearViewOnTarget(tower: GameCoreTower, target: IDamageable): boolean {
    const from = tower.position.add(Vector3.up.mulScalar(tower.height));
    const to = target.position.add(Vector3.up.mulScalar(f(0.5))); // DAT_00b7c4a4
    return (
      getSimPhysics().linecast(from.x, from.y, from.z, to.x, to.y, to.z, Q4Layers.terrainMask) === null
    );
  }

  // IsTargetInFireRange @0x4E02D0 — projectile aim solution vs fort direction.
  static isTargetInFireRange(tower: GameCoreTower | null, enemy: IDamageable | null): boolean {
    if (tower === null || enemy === null) return false;

    // FAITHFUL: NRE when the viewer (or its projectile) is null.
    const viewer = tower.getUnityObjectAs<TowerBaseContract>()!;
    const projectile = viewer.projectile!;

    const firePos = tower.position.add(Vector3.up.mulScalar(tower.height));
    const fd = projectile.getFireDirection(
      { x: firePos.x, y: firePos.y, z: firePos.z },
      { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z },
      { x: 0, y: 0, z: 0 },
    );
    const fireDir = new Vector3(fd.x, fd.y, fd.z);
    return Vector3.Angle(tower.fortDirection, fireDir) <= tower.fireAngleThreshold;
  }

  // GetNextTargetFromTowerTargetQueue @0x4DFE50
  // FAITHFUL ODDITY: `index` is DEAD — element 0 is always used.
  static getNextTargetFromTowerTargetQueue(tower: GameCoreTower | null, _index: number): IDamageable | null {
    if (tower === null || tower.targetQueue === null || tower.targetQueue.length < 1) return null;
    const handle = tower.targetQueue[0];
    return asDamageable(handle.getMostRecentObjectVersion<GameCoreObject>());
  }

  // FilterEnemiesByAttackType @0x4DFB50 — key = attackType & 7 (direct, NOT
  // the +3 fold of IsTarget); dead branch for key 5 / >3 kept faithful.
  static filterEnemiesByAttackType(raw: IDamageable[] | null, attackType: ETowerAttackDef): IDamageable[] | null {
    if (raw === null || raw.length < 1) return null;

    const result: IDamageable[] = [];
    const key = (attackType & 7) | 0;

    if (key === 5 || attackType > 3) {
      // Dead branch: MoveType() evaluated and discarded (faithful).
      for (let i = 0; i < raw.length; i++) raw[i].moveType();
    } else {
      for (let i = 0; i < raw.length; i++) {
        const moveType = raw[i].moveType();
        if (key === 1) {
          if (moveType === EEnemyMoveTypeDef.ground) result.push(raw[i]);
        } else if (key === 3 || (key === 2 && moveType === EEnemyMoveTypeDef.air)) {
          result.push(raw[i]);
        }
      }
    }
    return result;
  }

  // GetCostTrees @0x4E04F0 — unclaimed trees within range (flat y=0 distance).
  static getCostTrees(center: GameCoreTree, range: number, costTrees: GameCoreTree[]): void {
    const centerPos = center.position;
    const flatCenter = new Vector3(centerPos.x, 0.0, centerPos.z);

    // Broad-phase cylinder: radius 2×range, height 100×range (DAT_00b7c4a8).
    for (const tree of GameCore.instance!.allObjectsIn<GameCoreTree>(
      GameCoreTree,
      centerPos,
      new Cylinder(f(range + range), f(range * TowerHelper.treeQueryHeightScale)),
    )) {
      if (tree.referenceCount !== 0) continue;
      const treePos = tree.position;
      const flatTree = new Vector3(treePos.x, 0.0, treePos.z);
      if (Vector3.Distance(flatTree, flatCenter) <= range) costTrees.push(tree);
    }
  }

  // FromTreeToTower @0x4D6170 — tree → tower conversion (claims cost trees,
  // structureBreakEvent, spawns viewer, boots FSM, queues Build state).
  static fromTreeToTower(tree: GameCoreTree | null, towerPrefab: TowerBaseContract | null): GameCoreTower | null {
    if (tree === null || towerPrefab === null) return null;

    const treeView = tree.getUnityObjectAs<NatureTreeViewContract>();

    const costTrees: GameCoreTree[] = [];
    TowerHelper.getCostTrees(tree, towerPrefab.buildRange, costTrees); // float @0x84
    if (costTrees.length < 1) return null; // no valid build site

    const handles: GameCoreHandle[] = [];
    for (const costTree of costTrees) {
      handles.push(costTree.handle);
      Events.structureBreakEvent.invoke(costTree);
      costTree.referenceCount += 1; // claim the tree
    }

    const tower = new GameCoreTower(towerPrefab.name, handles);
    tower.position = tree.position;

    // CONFIRMED: NatureTree.towerDirection (@0x74) seeds body AND fort.
    // FAITHFUL: treeView dereferenced without a null check.
    const td = treeView!.towerDirection;
    tower.bodyDirection = new Vector3(td.x, td.y, td.z);
    tower.fortDirection = tower.bodyDirection;

    // Object.Instantiate(prefab.gameObject, pos + down×height, Quaternion.Euler(bodyDirection)).
    // The viewer contract receives the Euler ANGLES (degrees, = bodyDirection's
    // components — the original feeds the direction vector to Quaternion.Euler);
    // the viewer builds the quaternion itself. (Passing Quaternion.Euler's
    // x/y/z here was a port bug: quaternion components are not angles.)
    const spawnPos = tower.position.add(Vector3.down.mulScalar(tower.height));
    const instance = instantiateTowerViewer(
      towerPrefab,
      tower.handle.m_handle,
      { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
      { x: tower.bodyDirection.x, y: tower.bodyDirection.y, z: tower.bodyDirection.z },
    );
    registerUnityObject(tower.handle.m_handle, instance);

    tower.initialize();

    // buildTime int @0x64; difficulty scales the raise time.
    const buildTime = getTowerBuildTimeByDifficulty(f(towerPrefab.buildTime));
    tower.setTowerState(new TowerStateBuild(buildTime));

    return tower;
  }

  // RandomCautionDirection @0x4E0B10 — random idle look-around; SIDE EFFECT:
  // zeroes both current rotation speeds (faithful single 8-byte store).
  static randomCautionDirection(
    tower: GameCoreTower,
    towerView: TowerBaseContract,
    directionBeforeCaution: Vector3,
  ): Vector3 {
    const yaw = GameCoreObject.randomRangeF(0.0, tower.cautionAngleRange, tower.handle);
    const minPitch = towerView.cautionRotateAngleMin; // TowerBase @0x178
    const pitch = GameCoreObject.randomRangeF(minPitch, f(360.0 - minPitch), tower.handle);

    const cross = Vector3.Cross(tower.fortDirection, Vector3.up);
    const tiltedAxis = Quaternion.AngleAxis(pitch, tower.fortDirection).multiplyVector(cross);

    tower.currentRotateSpeedX = f(0);
    tower.currentRotateSpeedY = f(0);

    return Quaternion.AngleAxis(yaw, tiltedAxis).multiplyVector(directionBeforeCaution);
  }
}
