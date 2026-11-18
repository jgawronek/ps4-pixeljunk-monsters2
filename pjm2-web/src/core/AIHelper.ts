// src/core/AIHelper.ts
// TypeScript port of decomp/src/GameCore/AIHelper.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; static enemy-AI helpers:
// GetBlockingEnemy @0x93B550, GetAvoidanceEnemy @0x93BC70, FindClosestObject<T>
// @0x2C58A0, DetectGroundOrientation @0x93C580; nested BlockingInfo (3084,
// .ctor @0x93BA10), TerrainInfo (3085), TerrainOrientationInterpolator (3087,
// ctor FUN_0093ca50 / Tick FUN_0093cb90)).
//
// Float constants resolved from .rodata: look-ahead height scale 1.5,
// slower-by 0.1, parallel-dot 0.8, lateral pad 0.2, linecast depth 10,
// Rad2Deg 57.29578, predict time 0.25, sample ticks 15.
//
// TS ADAPTATIONS: nested types → exported classes in this module; C# structs
// (TerrainInfo/Interpolator) → classes with value-copy semantics emulated via
// cloning where the original copies structs; FindClosestObject<T> takes the
// ctor explicitly; Physics.Linecast → Rapier seam; Q4.Layers → Q4Layers.

import { Mathf, Vector3 } from '../engine/math';
import type { RaycastHit } from '../engine/physics/queries';
import { Cylinder } from './Cylinder';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { getSimPhysics, Q4Layers } from './physics-seam';

const f = Math.fround;

/** C#: AIHelper.BlockingInfo (TypeDefIndex 3084) — .ctor @0x93BA10. */
export class BlockingInfo {
  enemySameGroup: GameCoreHandle; // 0x10
  distanceSameGroup: number; // 0x30
  speedSameGroup: number; // 0x34
  enemySamePath: GameCoreHandle; // 0x38
  distanceSamePath: number; // 0x58
  speedSamePath: number; // 0x5C
  enemyDiffPath: GameCoreHandle; // 0x60
  distanceDiffPath: number; // 0x80
  speedDiffPath: number; // 0x84

  constructor(
    a_enemySG: GameCoreEnemy | null,
    a_distSG: number,
    a_speedSG: number,
    a_enemySP: GameCoreEnemy | null,
    a_distSP: number,
    a_speedSP: number,
    a_enemyDP: GameCoreEnemy | null,
    a_distDP: number,
    a_speedDP: number,
  ) {
    this.enemySameGroup = a_enemySG !== null ? a_enemySG.handle : GameCoreHandle.nullHandle;
    this.distanceSameGroup = f(a_distSG);
    this.speedSameGroup = f(a_speedSG);
    this.enemySamePath = a_enemySP !== null ? a_enemySP.handle : GameCoreHandle.nullHandle;
    this.distanceSamePath = f(a_distSP);
    this.speedSamePath = f(a_speedSP);
    this.enemyDiffPath = a_enemyDP !== null ? a_enemyDP.handle : GameCoreHandle.nullHandle;
    this.distanceDiffPath = f(a_distDP);
    this.speedDiffPath = f(a_speedDP);
  }
}

/** C#: AIHelper.TerrainInfo (struct, TypeDefIndex 3085) → class. */
export class TerrainInfo {
  facingSlopeAngle = f(0); // 0x0
  forward: Vector3 = Vector3.zero; // 0x4
  normal: Vector3 = Vector3.zero; // 0x10
  terrainHeight = f(0); // 0x1C
}

/** C# struct assignment copies values — emulate for TerrainInfo. */
function cloneTerrainInfo(t: TerrainInfo): TerrainInfo {
  const c = new TerrainInfo();
  c.facingSlopeAngle = t.facingSlopeAngle;
  c.forward = t.forward;
  c.normal = t.normal;
  c.terrainHeight = t.terrainHeight;
  return c;
}

/** C#: AIHelper.TerrainOrientationInterpolator (struct, TypeDefIndex 3087).
 *  Smoothly interpolates terrain orientation samples taken every 15 ticks,
 *  looking slightly ahead of the enemy. */
export class TerrainOrientationInterpolator {
  private static readonly m_ticksBetweenSamples = 15;
  private m_enemyHandle: GameCoreHandle; // 0x0
  private m_previousSample: TerrainInfo; // 0x20
  private m_currentSample: TerrainInfo; // 0x40
  private m_interpolatedSample: TerrainInfo; // 0x60
  private m_ticksToNextSample = 0; // 0x80

  // .ctor @0x93CB60 (body FUN_0093ca50)
  constructor(enemy: GameCoreEnemy) {
    this.m_enemyHandle = enemy.handle;
    const sample = AIHelper.detectGroundOrientation(enemy.position, enemy.moveVec);
    // C# struct copies → three independent copies (TS clone).
    this.m_previousSample = cloneTerrainInfo(sample);
    this.m_currentSample = cloneTerrainInfo(sample);
    this.m_interpolatedSample = cloneTerrainInfo(sample);
    this.m_ticksToNextSample = 0;
  }

  // get_interpolatedSample @0x93CB80 (body FUN_0093cb70)
  get interpolatedSample(): TerrainInfo {
    return this.m_interpolatedSample;
  }

  // Tick @0x93CE40 (body FUN_0093cb90)
  tick(): void {
    this.m_ticksToNextSample--;
    if (this.m_ticksToNextSample < 1) {
      this.m_ticksToNextSample += TerrainOrientationInterpolator.m_ticksBetweenSamples;
      this.m_previousSample = this.m_currentSample;
      const enemy = this.m_enemyHandle.getMostRecentObjectVersion<GameCoreEnemy>();
      if (enemy !== null) {
        const pred = enemy.predictPositionAndDirection(0.25);
        this.m_currentSample = AIHelper.detectGroundOrientation(pred.pos, pred.direction);
      }
    }

    // Blend from the previous sample toward the current one over the interval.
    const t = f(1.0 - f(this.m_ticksToNextSample / TerrainOrientationInterpolator.m_ticksBetweenSamples));
    this.m_interpolatedSample.terrainHeight = Mathf.Lerp(
      this.m_previousSample.terrainHeight,
      this.m_currentSample.terrainHeight,
      t,
    );
    this.m_interpolatedSample.normal = Vector3.Normalize(
      Vector3.Lerp(this.m_previousSample.normal, this.m_currentSample.normal, t),
    );
    this.m_interpolatedSample.forward = Vector3.Normalize(
      Vector3.Lerp(this.m_previousSample.forward, this.m_currentSample.forward, t),
    );
    this.m_interpolatedSample.facingSlopeAngle = Mathf.LerpAngle(
      this.m_previousSample.facingSlopeAngle,
      this.m_currentSample.facingSlopeAngle,
      t,
    );
  }
}

export class AIHelper {
  /** C# static class — not instantiable. */
  private constructor() {}

  private static enemyStorage: GameCoreEnemy[] = []; // 0x0 static (.cctor @0x93C990)

  // GetBlockingEnemy @0x93B550
  // Finds the single nearest enemy ahead of a_me within a_dist and reports it
  // in all three blocking categories (same-group / same-path / diff-path).
  static getBlockingEnemy(
    a_me: GameCoreEnemy | null,
    a_dist: number,
    a_speed: number,
  ): BlockingInfo {
    let closest: GameCoreEnemy | null = null;
    let closestDist = Infinity; // float.PositiveInfinity
    let speed = a_speed;

    if (a_me !== null) {
      const pos = a_me.position;
      const moveVec = a_me.moveVec;
      const myRadius = a_me.collision.radius;
      const neighbours = GameCore.instance!.allObjectsIn<GameCoreEnemy>(
        GameCoreEnemy,
        pos,
        new Cylinder(f(myRadius + a_dist), a_me.collision.height),
      );
      for (const enemy of neighbours) {
        if (enemy === a_me) continue;
        const diff = enemy.position.sub(pos);
        if (Vector3.Dot(moveVec, diff) <= 0.0) continue; // behind me
        const dist = f(diff.magnitude - enemy.collision.radius);
        if (closestDist <= dist) continue; // not nearer
        speed = enemy.speedCur;
        closest = enemy;
        closestDist = dist;
      }
    }
    return new BlockingInfo(
      closest, closestDist, speed,
      closest, closestDist, speed,
      closest, closestDist, speed,
    );
  }

  // GetAvoidanceEnemy @0x93BC70
  // Categorises nearby enemies into same-wave-group, same-path and
  // different-path blockers so StateWalk can slow down or steer around them.
  static getAvoidanceEnemy(
    a_me: GameCoreEnemy | null,
    a_lookAheadDist: number,
    a_speed: number,
  ): BlockingInfo {
    let enemySameGroup: GameCoreEnemy | null = null;
    let enemySamePath: GameCoreEnemy | null = null;
    let enemyDiffPath: GameCoreEnemy | null = null;
    let distSameGroup = Infinity;
    let distSamePath = Infinity;
    let distDiffPath = Infinity;
    let speedSameGroup = a_speed;
    let speedSamePath = a_speed;
    let speedDiffPath = a_speed;

    if (a_me !== null) {
      const myRadius = a_me.collision.radius;
      const moveVec = a_me.moveVec;
      // Lateral (side) direction: moveVec rotated 90° in the XZ plane.
      const sideVec = new Vector3(moveVec.z, 0.0, -moveVec.x);
      const pos = a_me.position;
      const isBalloon = a_me.isBalloon;
      const waveGroupID = a_me.waveGroupID;
      const myPathMove = a_me.pathMove;

      AIHelper.enemyStorage.length = 0; // Clear()
      // INFERRED (reconstruction): search cylinder radius = look-ahead dist,
      // height scaled by 1.5.
      for (const e of GameCore.instance!.allObjectsIn<GameCoreEnemy>(
        GameCoreEnemy,
        pos,
        new Cylinder(a_lookAheadDist, f(a_me.collision.height * 1.5)),
      )) {
        AIHelper.enemyStorage.push(e); // AddRange
      }

      const slowerThreshold = f(a_speed - 0.1);
      for (const enemy of AIHelper.enemyStorage) {
        if (enemy === a_me) continue;
        if (enemy.isBalloon !== isBalloon) continue; // same "layer" (air/ground) only

        const otherRadius = enemy.collision.radius;
        const diff = enemy.position.sub(pos);
        const diffH = new Vector3(diff.x, 0.0, diff.z);
        const dotForward = Vector3.Dot(moveVec, diffH);

        if (enemy.waveGroupID === waveGroupID) {
          // Same wave group: only yield to enemies spawned earlier that are ahead.
          if (
            dotForward < distSameGroup &&
            dotForward > 0.0 &&
            enemy.waveSpawnIndex < a_me.waveSpawnIndex
          ) {
            speedSameGroup = enemy.speedCur;
            distSameGroup = dotForward;
            enemySameGroup = enemy;
          }
        } else if (myPathMove!.isSameCurve(enemy.pathMove!)) {
          // FAITHFUL: both PathMove dereferences are unguarded in the binary.
          // Different group but same path: avoid slower, unblocked enemies ahead.
          if (!enemy.isBlocked && enemy.speedCur < slowerThreshold) {
            const dist = f(dotForward - otherRadius);
            if (dist > 0.0 && dist < distSamePath) {
              speedSamePath = enemy.speedCur;
              distSamePath = dist;
              enemySamePath = enemy;
            }
          }
        } else {
          // Different path: avoid crossing enemies roughly ahead and laterally
          // close, moving in a non-parallel direction.
          const dotMoves = Vector3.Dot(moveVec, enemy.moveVec);
          if (Mathf.Abs(dotMoves) < 0.8 && !enemy.isBlocked) {
            const sideDist = Vector3.Dot(sideVec, diffH);
            if (
              Mathf.Abs(sideDist) < dotForward &&
              dotForward < distDiffPath &&
              dotForward > 0.0 &&
              Mathf.Abs(sideDist) < f(otherRadius + myRadius + 0.2)
            ) {
              distDiffPath = f(dotForward - otherRadius);
              speedDiffPath = f(0.0);
              enemyDiffPath = enemy;
            }
          }
        }
      }
    }
    return new BlockingInfo(
      enemySameGroup, distSameGroup, speedSameGroup,
      enemySamePath, distSamePath, speedSamePath,
      enemyDiffPath, distDiffPath, speedDiffPath,
    );
  }

  // FindClosestObject<T> @0x2C58A0 (generic; instantiated for Tower/Enemy/object)
  // TS ADAPTATION: ctor passed explicitly.
  static findClosestObject<T extends GameCoreObject>(
    type: Function,
    a_pos: Vector3,
    a_radius: number,
    a_height: number,
  ): T | null {
    let closest: T | null = null;
    let closestSqr = Infinity;
    for (const obj of GameCore.instance!.allObjectsIn<T>(type, a_pos, new Cylinder(a_radius, a_height))) {
      const sqr = obj.position.sub(a_pos).sqrMagnitude;
      if (sqr < closestSqr) {
        closestSqr = sqr;
        closest = obj;
      }
    }
    return closest;
  }

  // DetectGroundOrientation @0x93C580
  // Samples the terrain under a_pos by a vertical linecast: surface normal,
  // forward projected onto the surface, terrain height, slope angle (degrees).
  // NOTE: a_size is in the metadata signature but unused in the body (linecast
  // depth is the constant 10); kept defaulted for signature fidelity.
  static detectGroundOrientation(
    a_pos: Vector3,
    a_forward: Vector3,
    _a_size = 0.0,
  ): TerrainInfo {
    const result = new TerrainInfo();
    const hit: RaycastHit | null = getSimPhysics().linecast(
      a_pos.x, f(a_pos.y + 1), a_pos.z,
      a_pos.x, f(a_pos.y - 10.0), a_pos.z,
      Q4Layers.terrainMask,
    );
    if (hit === null) {
      // No terrain hit: degenerate fallback (flat normal at the query height).
      result.normal = Vector3.up;
      result.terrainHeight = a_pos.y;
      // FAITHFUL QUIRK: original scales forward by (0,1,0) here (vertical-only)
      // — a degenerate fallback for the no-hit case, reproduced as-is.
      result.forward = Vector3.Normalize(Vector3.Scale(a_forward, new Vector3(0.0, 1.0, 0.0)));
      result.facingSlopeAngle = f(0.0);
    } else {
      result.normal = new Vector3(hit.normal[0], hit.normal[1], hit.normal[2]);
      // Project a_forward onto the plane perpendicular to the surface normal.
      result.forward = Vector3.Cross(Vector3.Cross(result.normal, a_forward), result.normal);
      result.terrainHeight = hit.point[1];
      const horiz = Vector3.Scale(result.forward, new Vector3(1.0, 0.0, 1.0));
      const horizMag = horiz.magnitude;
      result.facingSlopeAngle = f(Mathf.Atan2(result.forward.y, horizMag) * Mathf.Rad2Deg);
    }
    return result;
  }
}
