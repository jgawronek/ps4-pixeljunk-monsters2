// src/view/characters/ProjectileView.ts
// Pooled arrow visuals for sim projectiles (GameCoreProjectile and subclasses).
// Replaces the plain ConeGeometry position-follow stand-in in the integration
// lane with velocity-oriented arrows. No new assets: shaft + head are merged
// primitive geometries; the old cone remains as the merge-failure fallback.
//
// Coordinate policy (PORTING_CONVENTIONS + manifest coordinateConvention):
// sim records are UNITY LH space; this view mirrors at the boundary —
//     unity position (x,y,z) → three (−x, y, z)
//     unity velocity (x,y,z) → three (−x, y, z)
//     unity quat (x,y,z,w)   → three (x, −y, −z, w)   (mirrorQuat)
//
// Orientation evidence: Q4.ProjectileTrajectory.UpdateViewPosition @0074d8d0
// derives the view direction from the sim/view position DELTA (simPos −
// viewPos, normalized) and re-aims the transform every frame while the delta
// exceeds an epsilon; the sim itself keeps m_moveVector private (no velocity
// getter on GameCoreProjectileTrajectory), so the delta path is the faithful
// default. TS ADAPTATION: the decompiled call passes (Vector3.forward, delta)
// as LookRotation(forward, upwards), which only constrains the arrow's +Y
// axis to delta's component perpendicular to Z; the port aims the arrow's
// +Y axis FULLY along the direction (orientAlong / setFromUnitVectors),
// matching the intended "arrow along its flight path" visual. When the
// integration lane can supply velocity or a sim rotation, those win.
//
// Position follow: the original interpolates view→sim over ~1s (elapsed
// clamp01 in UpdateViewPosition) because it renders between sim ticks; this
// port syncs at sim cadence, so positions snap to the sim record. `dt` is
// accepted for API parity / future sub-tick interpolation and is otherwise
// unused. Meshes are pooled by handle.m_handle and removed when the record
// disappears (sim destroy → handle gone from the iteration).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vector3Like } from '../q4-contracts';
import { mirrorQuat } from './EnemyStageView';

/** One sim projectile record, duck-typed so the view layer does not depend
 *  on core class identities. All fields UNITY space; velocity/rotation are
 *  optional (GameCoreProjectile exposes neither publicly today — the view
 *  falls back to the position delta, exactly like the original). */
export interface ProjectileSimRecord {
  handle: { m_handle: number };
  position: Vector3Like;
  /** Units/sec, Unity space (e.g. Trajectory m_moveVector if exposed). */
  velocity?: Vector3Like;
  /** Unity quaternion; mirrored via (x,−y,−z,w) when present. */
  rotation?: { x: number; y: number; z: number; w: number };
}

const UP = new THREE.Vector3(0, 1, 0);
const ORIENT_EPSILON = 1e-6;
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Orient the arrow's +Y axis (cone/cylinder default axis) along a
 *  THREE-space direction. Pure: returns a fresh quaternion.
 *   - dir +Z → Rx(+90°) (+Y→+Z), dir −X → Rz(+90°) (+Y→−X), dir +Y → identity.
 *   - zero/epsilon dir → identity fallback (arrow stays upright).
 *  The caller mirrors unity directions into three space BEFORE calling. */
export function orientAlong(dirThree: Vector3Like): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const len = Math.hypot(dirThree.x, dirThree.y, dirThree.z);
  if (len <= ORIENT_EPSILON) return q;
  _dir.set(dirThree.x / len, dirThree.y / len, dirThree.z / len);
  return q.setFromUnitVectors(UP, _dir);
}

/** Build the arrow geometry: shaft (thin cylinder) + head (cone), both along
 *  +Y, merged into one buffer geometry (one draw call per arrow). Total
 *  length 0.5 centered on the origin — same footprint as the old
 *  ConeGeometry(0.07, 0.5, 6) stand-in. Falls back to that cone if the
 *  merge ever fails (attribute mismatch). */
function buildArrowGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.022, 0.022, 0.34, 5);
  shaft.translate(0, -0.08, 0); // spans y ∈ [−0.25, 0.09]
  const head = new THREE.ConeGeometry(0.07, 0.16, 6);
  head.translate(0, 0.17, 0); // spans y ∈ [0.09, 0.25], tip at +Y
  const merged = mergeGeometries([shaft, head]);
  shaft.dispose();
  head.dispose();
  if (merged !== null) return merged;
  return new THREE.ConeGeometry(0.07, 0.5, 6); // fallback: the old stand-in look
}

interface PooledArrow {
  mesh: THREE.Mesh;
  /** Last synced position in THREE space (for the delta-orientation path). */
  lastPos: THREE.Vector3;
  hasLast: boolean;
}

export class ProjectileView {
  private readonly pool = new Map<number, PooledArrow>();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  /** @param scene parent for the pooled arrow meshes (e.g. characterRoot). */
  constructor(private readonly scene: THREE.Object3D) {
    this.geometry = buildArrowGeometry();
    // Same bone-white as the integration lane's previous stand-in material.
    this.material = new THREE.MeshStandardMaterial({ color: 0xf5f0e0 });
  }

  /** Live pooled arrow count (tests / HUD). */
  get count(): number {
    return this.pool.size;
  }

  /** Sync the pool to the current sim projectiles: create-on-first-sight,
   *  mirror position, orient (sim rotation > velocity > position delta >
   *  hold), remove meshes whose handle disappeared. Call once per frame. */
  sync(projectiles: Iterable<ProjectileSimRecord>, dt: number): void {
    void dt; // sim-cadence sync: positions snap (see header); reserved for interpolation
    const seen = new Set<number>();
    for (const p of projectiles) {
      const id = p.handle.m_handle;
      seen.add(id);
      let entry = this.pool.get(id);
      if (entry === undefined) {
        const mesh = new THREE.Mesh(this.geometry, this.material);
        entry = { mesh, lastPos: new THREE.Vector3(), hasLast: false };
        this.pool.set(id, entry);
        this.scene.add(mesh);
      }
      // unity → three position mirror
      _target.set(-p.position.x, p.position.y, p.position.z);

      if (p.rotation !== undefined) {
        // Sim rotation wins; mirror (x,−y,−z,w) once.
        const m = mirrorQuat(p.rotation);
        entry.mesh.quaternion.set(m.x, m.y, m.z, m.w);
      } else {
        let dir: THREE.Vector3 | null = null;
        if (p.velocity !== undefined && Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z) > ORIENT_EPSILON) {
          dir = _dir.set(-p.velocity.x, p.velocity.y, p.velocity.z);
        } else if (entry.hasLast) {
          // Original UpdateViewPosition path: aim along simPos − viewPos.
          dir = _dir.copy(_target).sub(entry.lastPos);
          if (dir.length() <= ORIENT_EPSILON) dir = null;
        }
        if (dir !== null) entry.mesh.quaternion.copy(orientAlong(dir));
        // else: fresh spawn with no data → keep identity (upright cone look)
      }

      entry.mesh.position.copy(_target);
      entry.lastPos.copy(_target);
      entry.hasLast = true;
    }
    for (const [id, entry] of this.pool) {
      if (!seen.has(id)) {
        this.scene.remove(entry.mesh);
        this.pool.delete(id);
      }
    }
  }

  /** Remove every arrow and free the owned geometry/material. */
  dispose(): void {
    for (const [, entry] of this.pool) this.scene.remove(entry.mesh);
    this.pool.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
