// src/view/characters/towerEffects.ts
// The particle prefabs referenced by Q4.TowerBase.towerBuildEffect (0x158) and
// towerDestroyEffect (0x168), as serialized in the structures bundle
// (UnityPy dump of ParticleGroup roots; see docs/TOWER_CONSTRUCTION_ANALYSIS.md).
//
//   ef_tower_common_build_pv          ParticleGroup root (identity), children:
//     ps_tower_common_build_smoke     localPos (0, 0.1, 0), rot -90 X, looping,
//                                     rate 16..32/s, circleEdge r=0.3,
//                                     LimitVelocity magnitude curve (1.0 → 0.2856@0.166 → 0), dampen 0.9
//     ps_tower_common_build_rock      localPos (0, 0, 0),   rot -90 X, looping,
//                                     rate 8..16/s, coneVolumeShell r=0.5 angle 25
//   ef_tower_common_scrap_pv          children smoke (0,1,0), rock (0,0.4,0), gear (0,0.4,0)
//   ef_tower_common_scrap_organic_pv  children organic_smoke (0,1,0), organic_rock (0,0.4,0)
//   (all children rotated -90 X, so the shape axis is world up.)
//
// Lifecycle (Q4.TowerBase.Update @00549e70, raw-verified):
//   Build state, first frame: Instantiate(towerBuildEffect, towerFinalPosition,
//   Quaternion.identity) (only when no instance exists yet).
//   First non-Build frame: Q4.ParticleGroup.StopLoopingThenDestroy (stop
//   emitting; live particles finish) — also from OnDestroy.

import type * as THREE from 'three';
import type { EmitterRecord } from '../particles/ExtractedEmitter';
import type { LoopHandle, ParticleSystem, SpeedLimit } from '../particles/ParticleSystem';
import * as THREE_ from 'three';
import { getMeshParticles, type MeshHandle } from '../particles/MeshParticles';

const UP_AXIS = new THREE_.Vector3(0, 1, 0);

interface EffectChild {
  emitter: string;
  /** Local offset of the child GameObject (unity Y only — all X/Z are 0). */
  offsetY: number;
  speedLimit?: SpeedLimit;
}

/** Hermite-sampled (8 points, negatives clamped) ClampVelocityModule.magnitude
 *  curve of ps_tower_common_build_smoke; scalar 1.0, dampen 0.9. */
const SMOKE_LIMIT: SpeedLimit = {
  samples: [1.0, 0.3243, 0.162, 0.0672, 0.0172, 0, 0, 0],
  scalar: 1.0,
  dampen: 0.9,
};

export const TOWER_EFFECT_PREFABS: Record<string, readonly EffectChild[]> = {
  ef_tower_common_build_pv: [
    { emitter: 'ps_tower_common_build_smoke', offsetY: 0.1, speedLimit: SMOKE_LIMIT },
    { emitter: 'ps_tower_common_build_rock', offsetY: 0 },
  ],
  ef_tower_common_scrap_pv: [
    { emitter: 'ps_tower_common_scrap_smoke', offsetY: 1.0 },
    { emitter: 'ps_tower_common_scrap_rock', offsetY: 0.4 },
    { emitter: 'ps_tower_common_scrap_gear', offsetY: 0.4 },
  ],
  ef_tower_common_scrap_organic_pv: [
    { emitter: 'ps_tower_common_scrap_organic_smoke', offsetY: 1.0 },
    { emitter: 'ps_tower_common_scrap_organic_rock', offsetY: 0.4 },
  ],
};

function raised(origin: THREE.Vector3, dy: number): THREE.Vector3 {
  const v = origin.clone();
  v.y += dy;
  return v;
}

/** Start the looping build effect at a THREE-space world position (the
 *  tower's final ground position). Returns null when no child emitter is loaded. */
export function startLoopingPrefab(
  ps: ParticleSystem,
  emitters: ReadonlyMap<string, EmitterRecord>,
  prefab: string,
  origin: THREE.Vector3,
): { stop(): void } | null {
  const children = TOWER_EFFECT_PREFABS[prefab];
  if (children === undefined) return null;
  const handles: (LoopHandle | MeshHandle)[] = [];
  const mesh = getMeshParticles();
  for (const c of children) {
    const rec = emitters.get(c.emitter);
    if (rec === undefined) continue;
    if (mesh !== null && mesh.handles(c.emitter)) {
      // ParticleSystemRenderer RenderMode Mesh (rock chunks): lit 3D meshes, not billboards.
      handles.push(mesh.startLoop(rec, raised(origin, c.offsetY), UP_AXIS));
      continue;
    }
    handles.push(
      ps.startLoop({
        rec,
        origin: raised(origin, c.offsetY),
        speedLimit: c.speedLimit,
      }),
    );
  }
  if (handles.length === 0) return null;
  return { stop: (): void => handles.forEach((h) => h.stop()) };
}

/** One-shot prefab (scrap burst on sell): every child emitter bursts once. */
export function burstPrefab(
  ps: ParticleSystem,
  emitters: ReadonlyMap<string, EmitterRecord>,
  prefab: string,
  origin: THREE.Vector3,
): number {
  const children = TOWER_EFFECT_PREFABS[prefab];
  if (children === undefined) return 0;
  let n = 0;
  for (const c of children) {
    const rec = emitters.get(c.emitter);
    if (rec === undefined) continue;
    const mesh = getMeshParticles();
    if (mesh !== null && mesh.handles(c.emitter)) { n += mesh.burst(rec, raised(origin, c.offsetY), UP_AXIS); continue; }
    n += ps.burstFromEmitter(rec, raised(origin, c.offsetY));
  }
  return n;
}
