// src/view/stage/GroundConform.ts
// View-side terrain conform: entities must sit ON the stage surface, not on a
// flat y=0 plane ("everything moves on a single ground plane" bug).
//
// ORIGINAL ground handling (decomp evidence):
//  - Enemies: SIM-side. GameCoreEnemy.RaycastGroundSlope @0x4B0680 sets
//    pos.y = TerrainInfo.terrainHeight (decomp/src/GameCore/GameCoreEnemy.cs
//    :810-827); the height comes from AIHelper.TerrainOrientationInterpolator
//    (15-tick samples of AIHelper.DetectGroundOrientation @0x93C580 — vertical
//    Physics.Linecast(pos+up, pos−up*10, TerrainMask), AIHelper.cs:183-209,
//    266-324). Already ported 1:1 (src/core/GameCoreEnemy.ts, AIHelper.ts)
//    through the physics seam; the enemy view just follows core.position
//    (Q4.EnemyBase.StateMove @0x7FC140).
//  - Chibis: SIM-side spawn snap. GameCoreHome.SpawnChibi @0x4BB410 linecasts
//    +0.25/−1.0 (DAT_00b7c388/00b7c38c) and takes hit.point.y
//    (GameCoreHome.cs:193-200). Already ported. The short segment assumes the
//    spawn y is already near the surface — it misses relief that rises ABOVE
//    pos.y+0.25 (e.g. the home stump mound, y≈1.76 at the origin).
//  - Player: VIEW-side. Movement is presentation-driven: Q4.PlayerMotor owns
//    a Unity CharacterController whose collision keeps the avatar on the
//    ground (decomp/src/Q4/_Player_EnemyBase_NOTES.md §1.3); GameCorePlayer
//    .position is only written from the view's pose sample (GameCorePlayer.cs
//    header, NOTES §1.4). The port's demo mover is view-side too and never
//    sets y — THIS helper is its ground conform.
//
// VIEW-ONLY: never writes sim state, so the headless replay hash is untouched.
// Coordinates are Unity LH (x,z in → y out); the caller mirrors x at the
// three.js boundary like every other view module (PORTING_CONVENTIONS §6).
//
// Probe: downward linecast (x,+40,z) → (x,−40,z) with Q4.Layers.TerrainMask
// (0xE0000000 = Terrain|LargeProps|SmallProps, layers 29|30|31). Null seam or
// miss → fallback 0 (same as the headless null seam).
// Smoothing: exponential approach y += (target−y)*(1−exp(−k*dt)), k=12/s.
// |delta|>2 snaps (teleports); the FIRST sample per entity also snaps (spawn
// placement must not lerp up from underground). Plain JS numbers: view-only,
// no sim-visible fp32 discipline required.

import { Q4Layers } from '../../core/physics-seam';
import { GROUND_RAY_UP, GROUND_RAY_DOWN } from '../../engine/physics/queries';
import type { LinecastQuery } from '../../engine/physics/queries';

export interface GroundConformOptions {
  /** Probe start height (Unity y). Default +40. */
  rayUp?: number;
  /** Probe end height (Unity y). Default −40. */
  rayDown?: number;
  /** Exponential approach rate k (1/s). Default 12. */
  smoothing?: number;
  /** Probe layer mask. Default Q4Layers.terrainMask (0xE0000000). */
  mask?: number;
}

/** |target − cached| above this snaps instead of smoothing (teleport/spawn). */
const SNAP_DELTA = 2;

export class GroundConform {
  private readonly queries: LinecastQuery | null;
  private readonly rayUp: number;
  private readonly rayDown: number;
  private readonly k: number;
  private readonly mask: number;
  /** Per-entity smoothed heights (key = handle/view id; default key 0). */
  private readonly heights = new Map<string | number, number>();

  constructor(queries: LinecastQuery | null, opts: GroundConformOptions = {}) {
    this.queries = queries;
    this.rayUp = opts.rayUp ?? GROUND_RAY_UP;
    this.rayDown = opts.rayDown ?? GROUND_RAY_DOWN;
    this.k = opts.smoothing ?? 12;
    this.mask = opts.mask ?? Q4Layers.terrainMask;
  }

  /** Raw terrain height under unity (x,z) — null seam / miss → 0. No cache. */
  groundHeight(x: number, z: number): number {
    if (this.queries === null) return 0;
    const hit = this.queries.linecast(x, this.rayUp, z, x, this.rayDown, z, this.mask);
    return hit === null ? 0 : hit.point[1];
  }

  /**
   * Smoothed ground y for the entity at unity (x,z). `key` separates entities
   * sharing one instance (omit when each entity owns its instance). First
   * sample and |delta|>2 snap; otherwise exponential approach with frame dt.
   * dt ≤ 0 holds the cached height (teleport snaps still apply).
   */
  sample(x: number, z: number, dt: number, key: string | number = 0): number {
    const target = this.groundHeight(x, z);
    const prev = this.heights.get(key);
    if (prev === undefined || Math.abs(target - prev) > SNAP_DELTA) {
      this.heights.set(key, target); // spawn / teleport snap
      return target;
    }
    if (!(dt > 0)) return prev;
    const y = prev + (target - prev) * (1 - Math.exp(-this.k * dt));
    this.heights.set(key, y);
    return y;
  }

  /** Drop all cached heights (stage change / respawn): next sample snaps. */
  reset(): void {
    this.heights.clear();
  }
}
