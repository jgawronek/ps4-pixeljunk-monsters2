// src/view/characters/enemyEffects.ts
// Q4.ParticleGroupEvent.TriggerEffect(label) for enemy views (the effects of
// decomp/decompiled/Q4.EnemyBase.c: Die, Attack, Fire, Ice, Damage, FootLeft/Right, Sink, Land, ArmLeft/Right,
// WaterSplash, Drowning). Data: enemyViewData.generated.ts `fx` (label -> bone + ParticleGroup prefab)
// and `effects` (prefab child trees), emitters public/assets/particles-enemy/particles.json
// (tools/assets/extract_particles.py --bundles enemies --out public/assets/particles-enemy).
//
// Original (Q4.ParticleGroupEvent.TriggerEffect @003de150): Object.Instantiate(effect prefab, bone.position,
// bone.rotation) with the group following the bone (ParticleGroup +0x30), destroyed when its systems finish
// (DestroyIfFinished); looping systems (Fire, Ice, Drowning, Sink) run until Q4.ParticleGroup.FreeParticleGroup
// (finishCurrentLoopWhenDestroyed = 1: live particles finish). Port: per ParticleSystem child of the prefab a
// non-looping emitter plays once at the bone, a looping emitter becomes a loop that follows the bone each frame.

import * as THREE from 'three';
import type { EffectNode } from '../projectiles/projectileTypes';
import { type EmitterHandle, type EnemyEmitter, type EnemyParticles } from './enemyParticles';
import { getMeshParticles } from '../particles/MeshParticles';
import type { EmitterRecord } from '../particles/ExtractedEmitter';

export interface EnemyFxHandle {
  /** Q4.ParticleGroup.FreeParticleGroup: stop emitting (live particles finish). */
  stop(): void;
  /** Re-pose looping parts onto the bone (call each frame while alive). */
  follow(): void;
  /** Q4.ParticleGroup.DetachTransform: stop following the bone. */
  detach(): void;
  readonly active: boolean;
}

export interface EnemyFxAnchor {
  /** three-space world position of the attach bone (or the root). */
  worldPosition(out: THREE.Vector3): THREE.Vector3;
  /** three-space world quaternion of the attach bone. */
  worldQuaternion(out: THREE.Quaternion): THREE.Quaternion;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _cq = new THREE.Quaternion();
const _lp = new THREE.Vector3();

/** Compose prefab-local TRS (RAW Unity; mirrored into three) onto a parent pose. */
function compose(pos: THREE.Vector3, q: THREE.Quaternion, n: EffectNode, scale: number): void {
  _lp.set(-n.pos[0], n.pos[1], n.pos[2]).multiplyScalar(scale).applyQuaternion(q);
  pos.add(_lp);
  q.multiply(_cq.set(n.rot[0], -n.rot[1], -n.rot[2], n.rot[3]));
}

export class EnemyEffects {
  readonly counters = { effects: 0, loops: 0 };

  constructor(
    readonly particles: EnemyParticles,
    private readonly emitters: ReadonlyMap<string, EnemyEmitter>,
    private readonly effects: Readonly<Record<string, EffectNode>>,
  ) {}

  has(effect: string): boolean { return this.effects[effect] !== undefined; }

  /** Instantiate `effect` on `anchor`. Returns a handle (inactive when nothing loops).
   *  `oneShot`: the trigger is a momentary effect (footprint, land, attack, damage, die ...). Several of those prefabs
   *  contain emitters authored `looping` (boss rock / smoke / spark); started as endless loops every footstep stacked a
   *  permanent trail of white particles behind the boss. A one-shot emits for the emitter's own `duration` only. */
  spawn(effect: string, anchor: EnemyFxAnchor, scale = 1, oneShot = false): EnemyFxHandle | null {
    const root = this.effects[effect];
    if (root === undefined) return null;
    anchor.worldPosition(_p);
    anchor.worldQuaternion(_q);
    const loops: { handle: EmitterHandle; chain: EffectNode[]; origin: THREE.Vector3; quat: THREE.Quaternion }[] = [];
    const walk = (n: EffectNode, pos: THREE.Vector3, q: THREE.Quaternion, chain: EffectNode[]): void => {
      if (n.components.includes('ParticleSystem')) {
        const rec = this.emitters.get(n.name);
        if (rec !== undefined) {
          // ParticleSystem scaling mode "Local": sizes / speeds follow the child's own localScale
          const ls = chain.length <= 1 ? 1 : (Math.abs(n.scale[0]) + Math.abs(n.scale[1])) / 2;
          const k = ls * scale;
          const mesh = getMeshParticles();
          if (mesh !== null && mesh.handles(n.name)) {
            // RenderMode Mesh (boss rock chunks): lit 3D meshes; emission axis = local +Z of the prefab child.
            const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
            if (rec.looping) {
              const origin = pos.clone();
              const quat = q.clone();
              const maxSeconds = oneShot ? Math.max(0.05, rec.duration) : Infinity;
              const mh = mesh.startLoop(rec as unknown as EmitterRecord, origin, axis, k, maxSeconds);
              loops.push({ handle: mh, chain, origin, quat });
              this.counters.loops++;
            } else {
              mesh.burst(rec as unknown as EmitterRecord, pos, axis, k);
              this.counters.effects++;
            }
          } else if (rec.looping) {
            const origin = pos.clone();
            const quat = q.clone();
            const maxSeconds = oneShot ? Math.max(0.05, rec.duration) : Infinity;
            loops.push({ handle: this.particles.startLoop(rec, origin, quat, k, maxSeconds), chain, origin, quat });
            this.counters.loops++;
          } else {
            this.particles.play(rec, pos, q, k);
            this.counters.effects++;
          }
        }
      }
      for (const c of n.children) {
        const cp = pos.clone();
        const cq = q.clone();
        compose(cp, cq, c, scale);
        walk(c, cp, cq, [...chain, c]);
      }
    };
    walk(root, _p.clone(), _q.clone(), [root]);
    if (loops.length === 0) return { stop() {}, follow() {}, detach() {}, active: false };
    let active = true;
    let following = true;
    const pose = (): void => {
      anchor.worldPosition(_p);
      anchor.worldQuaternion(_q);
      for (const l of loops) {
        const pos = _p.clone();
        const q = _q.clone();
        for (const n of l.chain.slice(1)) compose(pos, q, n, scale);
        l.origin.copy(pos);
        l.quat.copy(q);
      }
    };
    return {
      stop: (): void => { if (active) { active = false; for (const l of loops) l.handle.stop(); } },
      follow: (): void => { if (active && following && loops.some((l) => l.handle.active)) pose(); },
      detach: (): void => { following = false; },
      get active(): boolean { return active && loops.some((l) => l.handle.active); },
    };
  }
}
