/**
 * queries.ts — Unity-compatible physics query API on top of Rapier.
 *
 * Mirrors the exact call shapes used by the ported simulation
 * (decomp/src/GameCore/*.cs):
 *   Physics.Linecast(a, b[, out hit], layerMask)
 *   Physics.Raycast(ray/origin, dir, maxDist, mask)
 *   Physics.SphereCast(ray, radius, out hit, maxDist, mask[, QueryTriggerInteraction])
 *   Physics.CheckSphere(pos, r, mask[, QueryTriggerInteraction])
 *
 * ADDITIVE port extension (not a Unity API): groundHeight(x, z) — wide-span
 * vertical terrain probe for the view-side GroundConform helper, plus the
 * null-safe GroundHeightQuery seam wrapper at the bottom of this file.
 *
 * All functions are Promise-free (call after PhysicsWorld.init/load).
 *
 * SEMANTIC NOTES (verified empirically against rapier3d-compat 0.14.0 — see
 * .work/physics-spike/rapier-semantics*.mjs):
 *
 * 1. LAYER MASKS: Unity-style signed 32-bit masks (e.g. TerrainMask =
 *    0xE0000000 = -536870912). Filtering happens via Rapier's filterPredicate
 *    (per-candidate, inside traversal) so the returned hit is the CLOSEST hit
 *    that passes mask+trigger rules — identical to Unity semantics. Bit test
 *    is `(mask & (1 << layer)) !== 0`, which is exact for all 32 layers incl.
 *    negative masks (JS bitwise ops are int32).
 *
 * 2. TRIGGERS: default QueryTriggerInteraction is 'Ignore' (parity with the
 *    GameCore call sites). 'Collide' opts in (GameCoreFruit water probes).
 *    'UseGlobal' behaves like 'Collide' because the shipped game never sets
 *    Physics.queriesHitTriggers = false (Unity's global default is true).
 *
 * 3. SPHERECAST INITIAL-OVERLAP: Unity SphereCast never reports a collider the
 *    sphere already overlaps at the origin (no hit). Rapier's shape-cast
 *    reports time_of_impact ≈ 0 in that case; we treat toi <= 1e-6 as a MISS to
 *    replicate Unity. Legitimate grazing starts (toi≈0) are also misses in
 *    Unity, so this is faithful, not a hack.
 *
 * 4. SPHERECAST RESULT FRAMES: rapier's castShape returns witness1/normal1 in
 *    WORLD space: witness1 = contact point on the cast sphere at impact
 *    (== Unity hit.point), normal1 = surface normal oriented against the cast
 *    direction (== Unity hit.normal). distance = time_of_impact when the
 *    velocity vector is unit length (we always pass a unit dir).
 *
 * 5. RAY NORMALS: rapier returns world-space normals for rays. For trimesh
 *    BACKFACE hits rapier orients the normal against the ray direction, while
 *    Unity returns the geometric (winding) normal — divergence only for casts
 *    that hit triangle backfaces (e.g. from under terrain); no GameCore call
 *    site depends on backface normals. Front-face hits (all gameplay cases,
 *    verified on stage-001 terrain) agree exactly: Rapier's right-hand-rule
 *    normal of the Unity-wound triangle equals Unity's baked normal
 *    (empirically 1999/2000 sampled terrain triangles).
 *
 * 6. `solid=true` for ray queries: a ray ORIGINATING inside a closed primitive
 *    reports a zero-distance hit (PhysX/Unity initial-overlap behavior);
 *    trimeshes have no interior so terrain queries are unaffected.
 *
 * 7. DETERMINISM: pinned @dimforge/rapier3d-compat 0.14.0; WASM results are
 *    platform-independent for identical inputs.
 */

import type RAPIER from '@dimforge/rapier3d-compat';

import type { PhysicsWorld } from './world.js';

/** Unity RaycastHit (subset the sim uses), all values in Unity world space. */
export interface RaycastHit {
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
  colliderName: string;
  layer: number;
  layerName: string;
  /** true when the hit collider is a Unity trigger (only with 'Collide'). */
  isTrigger: boolean;
}

export type QueryTriggerInteraction = 'UseGlobal' | 'Ignore' | 'Collide';

/** toi at/below this is treated as "already overlapping at origin" → miss (Unity parity). */
const INITIAL_OVERLAP_EPS = 1e-6;

export class PhysicsQueries {
  constructor(private readonly pw: PhysicsWorld) {}

  /**
   * Physics.Linecast(a, b, out hit, layerMask) — segment from a to b.
   * Returns null when nothing is hit (degenerate zero-length segments included).
   */
  linecast(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    mask: number,
    triggers: QueryTriggerInteraction = 'Ignore',
  ): RaycastHit | null {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return null; // Unity Linecast(a,a) is degenerate
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, mask, triggers);
  }

  /**
   * Physics.Raycast(origin, direction, maxDistance, layerMask).
   * `dir` does not need to be normalized (it is normalized here, like Unity).
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    mask: number,
    triggers: QueryTriggerInteraction = 'Ignore',
  ): RaycastHit | null {
    if (!(maxDist > 0)) return null;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return null;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;

    const R = this.pw.rapier;
    const ray = new R.Ray({ x: ox, y: oy, z: oz }, { x: ux, y: uy, z: uz });
    const hit = this.pw.world.castRayAndGetNormal(
      ray,
      maxDist,
      /* solid */ true,
      undefined,
      undefined,
      undefined,
      undefined,
      this.predicate(mask, triggers),
    );
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    const info = this.pw.colliderInfo.get(hit.collider.handle);
    return {
      point: [ox + ux * toi, oy + uy * toi, oz + uz * toi],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      distance: toi,
      colliderName: info?.name ?? `collider#${hit.collider.handle}`,
      layer: info?.layer ?? -1,
      layerName: info?.layerName ?? '?',
      isTrigger: info?.isTrigger ?? false,
    };
  }

  /**
   * Physics.SphereCast(origin, direction, radius, maxDistance, layerMask[,
   * QueryTriggerInteraction]).
   *
   * Unity parity: a collider already overlapping the sphere at the origin is
   * NEVER reported (rapier toi≈0 → treated as miss, see header note 3).
   */
  sphereCast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    radius: number,
    maxDist: number,
    mask: number,
    triggers: QueryTriggerInteraction = 'Ignore',
  ): RaycastHit | null {
    if (!(maxDist > 0) || !(radius > 0)) return null;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return null;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;

    const R = this.pw.rapier;
    const ball = new R.Ball(radius);
    const hit: RAPIER.ColliderShapeCastHit | null = this.pw.world.castShape(
      { x: ox, y: oy, z: oz },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: ux, y: uy, z: uz }, // unit velocity → time_of_impact == distance
      ball,
      /* targetDistance */ 0,
      /* maxToi */ maxDist,
      /* stopAtPenetration */ true,
      undefined,
      undefined,
      undefined,
      undefined,
      this.predicate(mask, triggers),
    );
    if (!hit) return null;
    const toi = hit.time_of_impact;
    // Unity SphereCast ignores initial overlaps → toi≈0 is a miss (note 3).
    if (toi <= INITIAL_OVERLAP_EPS) return null;
    const info = this.pw.colliderInfo.get(hit.collider.handle);
    return {
      // witness1 = world-space contact point on the sphere at impact == Unity hit.point
      point: [hit.witness1.x, hit.witness1.y, hit.witness1.z],
      // normal1 = world-space normal oriented against the cast dir == Unity hit.normal
      normal: [hit.normal1.x, hit.normal1.y, hit.normal1.z],
      distance: toi,
      colliderName: info?.name ?? `collider#${hit.collider.handle}`,
      layer: info?.layer ?? -1,
      layerName: info?.layerName ?? '?',
      isTrigger: info?.isTrigger ?? false,
    };
  }

  /**
   * Physics.CheckSphere(position, radius, layerMask[, QueryTriggerInteraction])
   * — true when any matching collider overlaps the sphere.
   */
  checkSphere(
    x: number, y: number, z: number,
    radius: number,
    mask: number,
    triggers: QueryTriggerInteraction = 'Ignore',
  ): boolean {
    if (!(radius > 0)) return false;
    const R = this.pw.rapier;
    let found = false;
    this.pw.world.intersectionsWithShape(
      { x, y, z },
      { x: 0, y: 0, z: 0, w: 1 },
      new R.Ball(radius),
      () => {
        found = true;
        return false; // stop traversal at the first match
      },
      undefined,
      undefined,
      undefined,
      undefined,
      this.predicate(mask, triggers),
    );
    return found;
  }

  /**
   * Vertical terrain-height probe (ADDITIVE port extension — not a Unity API).
   * Linecast straight down from (x, rayUp, z) to (x, rayDown, z) against the
   * stage's TerrainMask; returns the hit's world y, or 0 on a miss.
   *
   * The +40/−40 default span matches the __pjm2.linecastDown debug probe and
   * covers all stage-001 relief (path y range ≈ −2.4..5.1; home mound 1.76).
   * The ORIGINAL sim probes shorter segments relative to the entity's own y
   * (AIHelper.DetectGroundOrientation @0x93C580: +1/−10; GameCoreHome.SpawnChibi
   * @0x4BB410: +0.25/−1.0) — those stay in the sim port; this wide-span probe
   * serves the view-side GroundConform helper, which has no trustworthy
   * entity y to anchor a short segment.
   */
  groundHeight(
    x: number,
    z: number,
    opts: { rayUp?: number; rayDown?: number } = {},
  ): number {
    const up = opts.rayUp ?? GROUND_RAY_UP;
    const down = opts.rayDown ?? GROUND_RAY_DOWN;
    const hit = this.linecast(x, up, z, x, down, z, this.pw.terrainMask);
    return hit === null ? 0 : hit.point[1];
  }

  /**
   * Per-candidate filter evaluated inside the query traversal:
   *  - rejects triggers unless they are requested,
   *  - rejects colliders whose Unity layer bit is not in the mask.
   */
  private predicate(mask: number, triggers: QueryTriggerInteraction) {
    const hitTriggers = triggers !== 'Ignore'; // 'UseGlobal' == hit triggers (note 2)
    return (c: RAPIER.Collider): boolean => {
      const info = this.pw.colliderInfo.get(c.handle);
      if (!info) return false;
      if (info.isTrigger && !hitTriggers) return false;
      // int32 bitwise AND — exact for all 32 layers, incl. negative masks.
      return (mask & (1 << info.layer)) !== 0;
    };
  }
}

/** Convenience factory. */
export function createQueries(pw: PhysicsWorld): PhysicsQueries {
  return new PhysicsQueries(pw);
}

// ------------------------------------------------ additive ground-height seam
// Port extension for the "entities render on a flat y=0 plane" bug. NOTHING in
// the sim calls these yet, so the headless null seam and the pinned replay
// hash (0x61889fae2ea828f1; was 0x27227819f56d94ad before the Q4.PickupManager currency-drop port — real drops/gem credit, see docs/ENEMY_DROPS_ANALYSIS.md — and 0x41bb08621c2989ef before the chibi-arc fix + layout hashing) are untouched. See src/view/stage/GroundConform.ts.

/** Default vertical span for groundHeight probes (PhysicsQueries.groundHeight). */
export const GROUND_RAY_UP = 40;
export const GROUND_RAY_DOWN = -40;

/**
 * Structural linecast seam shape — the subset of SimPhysics
 * (src/core/physics-seam.ts) that ground probing needs. PhysicsQueries and
 * headless/test fakes ({ linecast: () => null, ... }) both satisfy it.
 */
export type LinecastQuery = Pick<PhysicsQueries, 'linecast'>;

/**
 * ADDITIVE sim-seam extension contract: a null-safe terrain-height query.
 * FOLLOW-UP (sim owner, requires milestone re-verification before wiring into
 * GameCore movement): add `groundHeight?(x: number, z: number): number` to
 * SimPhysics in src/core/physics-seam.ts. The member is OPTIONAL, so every
 * existing null-seam fake stays valid and returns 0 via `?? 0` at call sites;
 * PhysicsQueries already implements it structurally.
 */
export interface GroundHeightQuery {
  /** Unity-space x,z → terrain surface y; null seam / miss → 0. */
  groundHeight(x: number, z: number): number;
}

/**
 * Wrap any linecast seam (or null) into a GroundHeightQuery. Null queries and
 * misses return 0 — the same fallback the headless null seam produces, so a
 * driver can register this unconditionally without affecting the pinned hash.
 */
export function createGroundHeightQuery(
  queries: LinecastQuery | null,
  mask: number,
  opts: { rayUp?: number; rayDown?: number } = {},
): GroundHeightQuery {
  const up = opts.rayUp ?? GROUND_RAY_UP;
  const down = opts.rayDown ?? GROUND_RAY_DOWN;
  return {
    groundHeight(x: number, z: number): number {
      if (queries === null) return 0;
      const hit = queries.linecast(x, up, z, x, down, z, mask);
      return hit === null ? 0 : hit.point[1];
    },
  };
}
