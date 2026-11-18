// src/core/physics-seam.ts
// TS ADAPTATION seam for UnityEngine.Physics + Q4.Layers, used by the sim
// modules that query the STATIC scene colliders (GameCorePickup bounce/water,
// later: enemy ground probes, projectiles).
//
// C# calls Physics.CheckSphere/SphereCast/Raycast against the live Unity scene.
// The port queries the Rapier-WASM world built from the extracted stage
// colliders (Phase-0 parity spike: 100% linecast parity on stage-001). The
// driver registers `createQueries(physicsWorld)` here — PhysicsQueries is
// structurally compatible with SimPhysics. Headless unit tests register small
// fakes. An unregistered seam THROWS (explicit failure beats silently wrong
// physics when a driver forgets to load the stage world).
//
// Dependency direction: core → engine (allowed by PORTING_CONVENTIONS).

import { Vector3 } from '../engine/math/Vector3';
import type { RaycastHit, QueryTriggerInteraction } from '../engine/physics/queries';

/** The subset of UnityEngine.Physics the sim uses (Rapier-backed). */
export interface SimPhysics {
  linecast(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    mask: number,
    triggers?: QueryTriggerInteraction,
  ): RaycastHit | null;
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    mask: number,
    triggers?: QueryTriggerInteraction,
  ): RaycastHit | null;
  sphereCast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    radius: number,
    maxDist: number,
    mask: number,
    triggers?: QueryTriggerInteraction,
  ): RaycastHit | null;
  checkSphere(
    x: number, y: number, z: number,
    radius: number,
    mask: number,
    triggers?: QueryTriggerInteraction,
  ): boolean;
}

let simPhysics: SimPhysics | null = null;

/** Driver: setSimPhysics(createQueries(pw)) after loading the stage world.
 *  Tests: a small fake. Null restores the unregistered state. */
export function setSimPhysics(p: SimPhysics | null): void {
  simPhysics = p;
}

export function getSimPhysics(): SimPhysics {
  if (simPhysics === null) {
    throw new Error(
      'SimPhysics not initialized — register createQueries(physicsWorld) (or a test fake) via setSimPhysics before physics-touching sim code runs.',
    );
  }
  return simPhysics;
}

/** Q4.Layers — pure C# runtime singleton reproduced from the decompiled ctor
 *  (@0x004694F0); values cross-verified against the extraction pipeline's
 *  q4Layers dump (signed int32, exactly like Unity LayerMask.value). */
export const Q4Layers = {
  terrainMask: -536870912, // 0xE0000000 — Terrain|LargeProps|SmallProps (29|30|31)
  landscapeMask: 536870912, // Terrain only (29)
  waterMask: 16, // Water (4)
  waterIndex: 4, // Q4.Layers.Instance.WaterIndex
  itemsMask: 4096, // Items (12)
  playersMask: 256, // Players (8)
  enemiesMask: 512, // Enemies (9)
  bounceMask: 4194304, // Bounce (22)
} as const;

/** UnityEngine.Physics.gravity — (0, −9.81, 0), f32. */
export const UNITY_GRAVITY = new Vector3(0, -9.81, 0);
