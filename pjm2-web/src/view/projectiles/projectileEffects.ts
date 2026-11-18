// src/view/projectiles/projectileEffects.ts
// Plays the effect PREFABS referenced by the projectile prefabs (fireEffect /
// hitEffect / rocket burner) through the extracted-emitter particle pool.
//
// Original: Object.Instantiate(effectPrefab, position, rotation) — the prefab's own
// root TRS is replaced by the arguments; each child ParticleSystem keeps its local
// TRS relative to that root. Cone-family shapes emit along the system's local +Z, so
// a muzzle flash authored at child (0,0,+0.7) with the tower's fire-point rotation
// flies out of the barrel. One-shot groups (non-looping) destroy themselves when
// their particles finish (Q4.ParticleGroup.DestroyIfFinished / SimpleEffectDestroy);
// looping groups (rocket burner) run until StopLoopingThenDestroy (Q4.ParticleGroup
// @003dcbb0, called from ProjectileTrajectory.OnProjectileHit/OnDestroy).
//
// Space handling: prefab data and sim are UNITY (left-handed); particles live in
// three space (x mirrored). Rotations compose in Unity space then the resulting
// axis vector is mirrored.

import * as THREE from 'three';
import type { EmitterRecord } from '../particles/ExtractedEmitter';
import { emitterToBurstOptions } from '../particles/ExtractedEmitter';
import type { LoopHandle, ParticleSystem } from '../particles/ParticleSystem';
import { getMeshParticles, type MeshHandle } from '../particles/MeshParticles';
import type { EffectNode } from './projectileTypes';
import type { Q4, V3 } from './projectileMath';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export interface EffectChildPose {
  emitter: string;
  /** Unity-space world position of the child ParticleSystem GameObject. */
  pos: V3;
  /** Unity-space world rotation. */
  rot: Q4;
}

/** Flatten an effect prefab under a root pose (Unity space). Only nodes that carry a
 *  ParticleSystem become entries. */
export function flattenEffect(node: EffectNode, rootPos: V3, rootRot: Q4, scale = 1): EffectChildPose[] {
  const out: EffectChildPose[] = [];
  const rq = new THREE.Quaternion(rootRot.x, rootRot.y, rootRot.z, rootRot.w);
  const walk = (n: EffectNode, parentPos: THREE.Vector3, parentRot: THREE.Quaternion, isRoot: boolean): void => {
    let pos = parentPos;
    let rot = parentRot;
    if (!isRoot) {
      // child world = parent * local (uniform scale folded into the offset)
      const lp = new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]).multiplyScalar(scale).applyQuaternion(parentRot);
      pos = parentPos.clone().add(lp);
      rot = parentRot.clone().multiply(new THREE.Quaternion(n.rot[0], n.rot[1], n.rot[2], n.rot[3]));
    }
    if (n.components.includes('ParticleSystem')) {
      out.push({
        emitter: n.name,
        pos: { x: pos.x, y: pos.y, z: pos.z },
        rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      });
    }
    for (const c of n.children) walk(c, pos, rot, false);
  };
  walk(node, new THREE.Vector3(rootPos.x, rootPos.y, rootPos.z), rq, true);
  return out;
}

/** Unity-space unit +Z of a rotation, mirrored into three space (the cone axis). */
export function emissionAxisThree(rot: Q4, out = new THREE.Vector3()): THREE.Vector3 {
  _q.set(rot.x, rot.y, rot.z, rot.w);
  _v.set(0, 0, 1).applyQuaternion(_q);
  return out.set(-_v.x, _v.y, _v.z).normalize();
}

export class ProjectileEffects {
  readonly counters = { burstsPlayed: 0, particlesSpawned: 0, loopsStarted: 0 };

  constructor(
    private readonly ps: ParticleSystem,
    private readonly emitters: ReadonlyMap<string, EmitterRecord>,
    private readonly effects: Readonly<Record<string, EffectNode>>,
  ) {}

  has(prefab: string): boolean {
    return this.effects[prefab] !== undefined;
  }

  /** Instantiate a one-shot effect prefab at a Unity-space pose. Returns the
   *  number of particles spawned (0 when the prefab/emitters are unknown). */
  play(prefab: string, pos: V3, rot: Q4 = { x: 0, y: 0, z: 0, w: 1 }, scale = 1): number {
    const node = this.effects[prefab];
    if (node === undefined) return 0;
    let spawned = 0;
    for (const c of flattenEffect(node, pos, rot, scale)) {
      const rec = this.emitters.get(c.emitter);
      if (rec === undefined) continue;
      const at = new THREE.Vector3(-c.pos.x, c.pos.y, c.pos.z);
      const mesh = getMeshParticles();
      if (mesh !== null && mesh.handles(c.emitter)) {
        // ParticleSystemRenderer RenderMode Mesh (ice shards, rock chunks): lit 3D meshes, not billboards
        spawned += mesh.burst(rec, at, emissionAxisThree(c.rot), scale);
        continue;
      }
      const opts = emitterToBurstOptions(rec, at);
      opts.axis = emissionAxisThree(c.rot);
      if (scale !== 1) {
        opts.size = [opts.size[0] * scale, opts.size[1] * scale];
        opts.speed = [opts.speed[0] * scale, opts.speed[1] * scale];
      }
      spawned += this.ps.burst(opts);
    }
    this.counters.burstsPlayed++;
    this.counters.particlesSpawned += spawned;
    return spawned;
  }

  /** Looping effect prefab (rocket burner) following a moving pose. `update`
   *  re-poses it every frame; `stop` = ParticleGroup.StopLoopingThenDestroy. */
  startLooping(prefab: string, pos: V3, rot: Q4): { update(pos: V3, rot: Q4): void; stop(): void } {
    const node = this.effects[prefab];
    const parts: { handle: LoopHandle | MeshHandle; origin: THREE.Vector3; axis: THREE.Vector3; child: EffectNode }[] = [];
    const mesh = getMeshParticles();
    if (node !== undefined) {
      const kids: EffectNode[] = [];
      const collect = (n: EffectNode): void => {
        if (n.components.includes('ParticleSystem')) kids.push(n);
        n.children.forEach(collect);
      };
      collect(node);
      for (const k of kids) {
        const rec = this.emitters.get(k.name);
        if (rec === undefined) continue;
        const origin = new THREE.Vector3();
        const axis = new THREE.Vector3(0, 1, 0);
        const handle = mesh !== null && mesh.handles(k.name) ? mesh.startLoop(rec, origin, axis) : this.ps.startLoop({ rec, origin, axis });
        parts.push({ handle, origin, axis, child: k });
        this.counters.loopsStarted++;
      }
    }
    const pose = (p: V3, r: Q4): void => {
      const rq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      for (const part of parts) {
        const local = new THREE.Vector3(part.child.pos[0], part.child.pos[1], part.child.pos[2]).applyQuaternion(rq);
        part.origin.set(-(p.x + local.x), p.y + local.y, p.z + local.z);
        const cr = rq.clone().multiply(new THREE.Quaternion(part.child.rot[0], part.child.rot[1], part.child.rot[2], part.child.rot[3]));
        emissionAxisThree({ x: cr.x, y: cr.y, z: cr.z, w: cr.w }, part.axis);
      }
    };
    pose(pos, rot);
    return {
      update: pose,
      stop: (): void => {
        for (const part of parts) part.handle.stop();
      },
    };
  }
}
