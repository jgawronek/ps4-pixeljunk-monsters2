// src/view/projectiles/ProjectileViewer.ts
// Port of the Q4.Projectile* VIEW components (props bundle prefabs): the object the
// sim instantiates through `instantiateProjectileViewer(tower.projectile, handle,
// firePoint)` and registers with the GameCoreBridge. See docs/PROJECTILE_ANALYSIS.md
// for the per-tower table and evidence.
//
// Lifecycle (Q4.Projectile / ProjectileTrajectory / ProjectileInstant):
//   Instantiate  at the tower FIRE POINT (GetFirePointByRemainingMag), identity rot.
//                PrefabLoader.Awake adds the visual model child (bullet_001_pa, ...).
//                Projectile.Awake subscribes projectileHitEvent; Trajectory.Awake starts
//                the looping `flyingSound` (missile engine) when set.
//   Start        (first frame) PlaySFX(fireSound) and Instantiate(fireEffect,
//                tower.GetFireEffectLocation()) — first fire-point position + rotation.
//   Update       Trajectory: UpdateVisibility(dt) + UpdateViewPosition (blend view -> sim
//                over the first second; aim LookRotation(Vector3.forward, delta)).
//                Instant: Destroy(gameObject) once the sim object IsDestroyed.
//   OnProjectileHit(proj, enemy) — only for THIS view's own projectile:
//                Trajectory: hitSound at the enemy (or the view), hitEffect at the SIM
//                position (identity rot, scale hitEffectScale), detach+stop looping
//                particle groups (rocket burner), Destroy.
//                Instant: hitSound at the enemy; EmitProjectileHitEffect at the enemy's
//                Hips_Bn (else its root); Destroy. Beam/Electric/Lightning: same but the
//                view lives on until the sim object dies.
//
// TS ADAPTATIONS: positions snap/blend at render-frame cadence from the sim record
// (same as the original, which also reads GameCoreObject.position each Update);
// audio is 2D (AudioManager has no spatialisation); BuffSetting/Gaseous/Insect/
// Lightning-bolt/Beam-line visuals are not ported (documented).

import * as THREE from 'three';
import type { GameCoreProjectile } from '../../core/GameCoreProjectile';
import { GameCoreProjectileGaseous } from '../../core/GameCoreProjectileGaseous';
import type { ProjectileViewContract } from '../q4-contracts';
import { ProjectilePrefabContract, projectileContract } from './projectileContracts';
import {
  estimateImpactTime,
  isVisibleAt,
  mirrorQuat4,
  viewStep,
  type Q4,
  type V3,
} from './projectileMath';
import type { ProjectileEffects } from './projectileEffects';
import { BeamLine, BoltEffects } from './BoltEffects';

const f = Math.fround;
const IDENT: Q4 = { x: 0, y: 0, z: 0, w: 1 };

/** Shortest-arc quaternion taking +Z onto `dir` (emitter cone axis = child +Z, projectileEffects.ts). */
function quatFromZTo(dir: V3): Q4 {
  const l = Math.hypot(dir.x, dir.y, dir.z);
  if (l < 1e-6) return { ...IDENT };
  const x = dir.x / l, y = dir.y / l, z = dir.z / l;
  // cross((0,0,1), d) = (-y, x, 0); w = 1 + dot
  const w = 1 + z;
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 }; // opposite: 180 deg about X
  const n = Math.hypot(-y, x, 0, w);
  return { x: -y / n, y: x / n, z: 0, w: w / n };
}
const num2 = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const s0 = (v: ProjectileViewInstance): ProjectileViewerSystem => (v as unknown as { sys: ProjectileViewerSystem }).sys;

export interface ProjectileAudioSink {
  play(name: string, opts?: { volume?: number; throttleMs?: number }): unknown;
  startLoop(name: string, opts?: { volume?: number }): { stop(): void };
}

/** World pose of a tower's FIRST fire point (Q4.TowerBase.GetFireEffectLocation). */
export interface FirePose {
  pos: V3;
  rot: Q4;
}

export interface ProjectileViewerDeps {
  /** Scene parent for projectile models. */
  parent: THREE.Object3D;
  /** Model templates keyed by visual prefab name (bullet_001_pa, ...). */
  models: ReadonlyMap<string, THREE.Object3D>;
  effects: ProjectileEffects | null;
  audio: ProjectileAudioSink | null;
  /** Tower viewer's first fire-point pose, by tower handle id. */
  towerFirePose?: (towerHandleId: number) => FirePose | null;
  /** Unity-space world anchor of an enemy for hit effects (Hips_Bn else root). */
  enemyAnchor?: (enemy: { handle: { m_handle: number }; position: V3 }) => V3 | null;
}

/** Per-class one-shot volume (the original uses the AudioSource/clip defaults; the
 *  web mixer needs a gentle trim so stacked shots don't clip). */
const SFX_VOLUME = 0.7;

export class ProjectileViewInstance extends ProjectilePrefabContract {
  readonly handleId: number;
  private readonly sys: ProjectileViewerSystem;
  /** Unity-space VIEW transform. */
  viewPos: V3;
  viewRot: Q4 = { ...IDENT };
  elapsed = 0;
  estimate: number;
  private started = false;
  private dead = false;
  private readonly root: THREE.Object3D | null;
  private flyingLoop: { stop(): void } | null = null;
  private burner: { update(p: V3, r: Q4): void; stop(): void } | null = null;
  /** ProjectileGaseous: flowEffect (while flying) -> affectEffect (ground fire / frost cloud once grounded). */
  private gasFlow: { update(p: V3, r: Q4): void; stop(): void } | null = null;
  private gasAffect: { update(p: V3, r: Q4): void; stop(): void } | null = null;
  private gasLanded = false;
  /** ProjectileBeam: LineRenderer (head = sim pos, tail = head - dir*min(beamLength, dist from muzzle)). */
  private beamLine: BeamLine | null = null;
  private beamMuzzle: V3 | null = null;
  private beamPrev: V3 | null = null;
  private beamDir: V3 = { x: 0, y: 0, z: 1 };
  /** ProjectileElectric chain: previous bolt end (starts at the muzzle). */
  private chainPrev: V3 | null = null;
  /** ProjectileInsect: the bee-swarm effect riding the sim bee. */
  private beeFx: { update(p: V3, r: Q4): void; stop(): void } | null = null;
  /** Last sim position seen (unity) — used by hit handling after the sim object is gone. */
  private lastSim: V3 | null = null;

  constructor(prefab: ProjectilePrefabContract, handleId: number, firePoint: V3, sys: ProjectileViewerSystem) {
    super(prefab.data);
    this.handleId = handleId;
    this.sys = sys;
    this.viewPos = { x: firePoint.x, y: firePoint.y, z: firePoint.z };
    this.estimate = this.fixedImpactTime ? f(this.impactTime) : f(this.impactTime);

    // PrefabLoader.Awake: instantiate the visual child (mesh model).
    const modelName = this.modelName;
    const tpl = modelName !== null ? sys.deps.models.get(modelName) : undefined;
    if (tpl !== undefined) {
      this.root = new THREE.Group();
      this.root.name = `projectile:${this.prefabName}`;
      const m = tpl.clone(true);
      m.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.root.add(m);
      this.root.visible = false; // UpdateVisibility enables it on the first Update
      this.syncTransform();
      sys.deps.parent.add(this.root);
    } else {
      this.root = null;
    }

    // ProjectileTrajectory.Awake: looping flyingSound (missile engine).
    const fly = this.data.fields['flyingSound'];
    if (this.className === 'ProjectileTrajectory' && typeof fly === 'string' && sys.deps.audio !== null) {
      this.flyingLoop = sys.deps.audio.startLoop(`sfx/${fly}`, { volume: 0.35 });
    }
    // PrefabLoader may also instantiate EFFECT groups (missile: ef_tower_rocket_burner_pv).
    for (const n of this.data.prefabList) {
      if (n !== modelName && sys.deps.effects?.has(n) === true) {
        this.burner = sys.deps.effects.startLooping(n, this.viewPos, this.viewRot);
      }
    }
  }

  /** Q4.ProjectileTrajectory.SetupEstimateTime — sets the view's expected flight time. */
  override setupEstimateTime(_proj: GameCoreProjectile, predictedPos?: V3): void {
    if (this.fixedImpactTime || predictedPos === undefined) {
      this.estimate = f(this.impactTime);
      return;
    }
    this.estimate = estimateImpactTime(this.viewPos, predictedPos, this.ballistic);
  }

  private syncTransform(): void {
    if (this.root === null) return;
    this.root.position.set(-this.viewPos.x, this.viewPos.y, this.viewPos.z);
    const q = mirrorQuat4(this.viewRot);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
  }

  /** Q4.Projectile.Start — fire sound + fire effect at the tower fire point. */
  private start(proj: GameCoreProjectile): void {
    this.started = true;
    const s = this.sys;
    const fireSound = this.data.fields['fireSound'];
    if (typeof fireSound === 'string') s.deps.audio?.play(`sfx/${fireSound}`, { volume: SFX_VOLUME, throttleMs: 40 });
    const fireEffect = this.data.fields['fireEffect'];
    if (typeof fireEffect === 'string' && s.deps.effects !== null) {
      const pose = s.deps.towerFirePose?.(proj.sourceTower.m_handle) ?? null;
      s.deps.effects.play(fireEffect, pose?.pos ?? this.viewPos, pose?.rot ?? IDENT);
    }
  }

  /** Per-frame Update (Trajectory: visibility + view position; Instant: lifetime). */
  update(dt: number, proj: GameCoreProjectile): void {
    if (this.dead) return;
    if (!this.started) this.start(proj);
    const simPos: V3 = { x: proj.position.x, y: proj.position.y, z: proj.position.z };
    this.lastSim = simPos;
    if (this.className === 'ProjectileGaseous' && proj instanceof GameCoreProjectileGaseous) {
      this.updateGaseous(simPos, proj);
      return;
    }
    if (this.className === 'ProjectileBeam') {
      this.beamMuzzle ??= { ...simPos };
      if (this.beamLine === null) this.beamLine = new BeamLine(this.sys.deps.parent, num2(this.data.fields['beamLength'], 3));
      const prev = this.beamPrev ?? this.beamMuzzle;
      const d = { x: simPos.x - prev.x, y: simPos.y - prev.y, z: simPos.z - prev.z };
      const l = Math.hypot(d.x, d.y, d.z);
      if (l > 1e-5) this.beamDir = { x: d.x / l, y: d.y / l, z: d.z / l };
      this.beamPrev = simPos;
      this.beamLine.update(simPos, this.beamMuzzle, this.beamDir);
      return;
    }
    if (this.className === 'ProjectileInsect') {
      // PrefabLoader/beeEffect: looping bug swarm that rides the sim bee (insectAmountMax bees = 5 sim objects).
      const bee = this.data.fields['beeEffect'];
      const bfx = s0(this).deps.effects;
      if (this.beeFx === null && typeof bee === 'string' && bfx !== null && bfx.has(bee)) {
        this.beeFx = bfx.startLooping(bee, simPos, IDENT);
      }
      this.beeFx?.update(simPos, IDENT);
      this.viewPos = simPos;
      return;
    }
    if (this.className !== 'ProjectileTrajectory') return; // Instant & co: no per-frame motion

    // UpdateVisibility(dt): elapsed capped at the estimate.
    this.elapsed = f(Math.min(f(this.elapsed + dt), this.estimate));
    if (this.root !== null) {
      this.root.visible = isVisibleAt(this.elapsed, this.estimate, this.invisibleStart, this.invisibleEnd);
    }
    // UpdateViewPosition.
    const step = viewStep({ pos: this.viewPos, elapsed: this.elapsed }, simPos);
    this.viewPos = step.pos;
    if (step.rot !== null) this.viewRot = step.rot;
    this.syncTransform();
    this.burner?.update(this.viewPos, this.viewRot);
  }

  /** Tesla chain segment (previous point -> enemy) / lightning sky strike (above the enemy -> enemy). */
  private spawnBolt(proj: GameCoreProjectile, enemy: { position: V3 }): void {
    const bolts = this.sys.bolts;
    if (bolts === null) return;
    const tgt: V3 = { x: enemy.position.x, y: enemy.position.y + 1.0, z: enemy.position.z };
    if (this.className === 'ProjectileLightning') {
      bolts.spawn({ x: tgt.x + 1.5, y: tgt.y + 22, z: tgt.z - 1.5 }, tgt, { color: 0x9ec8ff, life: 0.25, amp: 0.9, segments: 12 });
      return;
    }
    const from = this.chainPrev ?? this.sys.deps.towerFirePose?.(proj.sourceTower.m_handle)?.pos ?? { x: proj.position.x, y: proj.position.y, z: proj.position.z };
    bolts.spawn(from, tgt, { color: 0x6ab8ff, life: 0.3, amp: 0.3, segments: 8 });
    this.chainPrev = tgt;
  }

  /** Q4.ProjectileGaseous.Update/UpdateFlow: the flow particle stream follows the sim parcel along its velocity;
   *  at landing it is swapped for the affect (ground fire / frost) effect, which stays until the sim object dies. */
  private updateGaseous(simPos: V3, proj: GameCoreProjectileGaseous): void {
    const fx = this.sys.deps.effects;
    if (fx === null) return;
    if (!proj.grounded) {
      const flow = this.data.fields['flowEffect'];
      const mv = proj.moveVector;
      const rot = quatFromZTo({ x: mv.x, y: mv.y, z: mv.z });
      if (this.gasFlow === null && typeof flow === 'string' && fx.has(flow)) this.gasFlow = fx.startLooping(flow, simPos, rot);
      this.gasFlow?.update(simPos, rot);
      this.viewPos = simPos;
      return;
    }
    if (!this.gasLanded) {
      this.gasLanded = true;
      this.gasFlow?.stop();
      this.gasFlow = null;
      const hitSound = this.data.fields['hitGroundSound'] ?? this.data.fields['hitSound'];
      if (typeof hitSound === 'string') this.sys.deps.audio?.play(`sfx/${hitSound}`, { volume: SFX_VOLUME, throttleMs: 40 });
      const aff = this.data.fields['affectEffect'];
      if (typeof aff === 'string' && fx.has(aff)) this.gasAffect = fx.startLooping(aff, simPos, IDENT);
    }
    this.gasAffect?.update(simPos, IDENT);
    this.viewPos = simPos;
  }

  /** Unity-space pose for ctor-time tests/probes. */
  get viewTransform(): { pos: V3; rot: Q4; visible: boolean } {
    return { pos: this.viewPos, rot: this.viewRot, visible: this.root?.visible ?? false };
  }
  get object3d(): THREE.Object3D | null {
    return this.root;
  }

  /** Q4.Projectile*.OnProjectileHit(proj, enemy). */
  onHit(proj: GameCoreProjectile, enemy: { handle: { m_handle: number }; position: V3 } | null): void {
    if (this.dead) return;
    const s = this.sys;
    const hitSound = this.data.fields['hitSound'];
    const hitEffect = this.data.fields['hitEffect'];
    const simPos: V3 = { x: proj.position.x, y: proj.position.y, z: proj.position.z };

    if (this.className === 'ProjectileTrajectory') {
      if (typeof hitSound === 'string') s.deps.audio?.play(`sfx/${hitSound}`, { volume: SFX_VOLUME, throttleMs: 40 });
      if (typeof hitEffect === 'string') {
        const scale = (proj as unknown as { hitEffectScale?: number }).hitEffectScale ?? 1;
        s.deps.effects?.play(hitEffect, simPos, IDENT, scale > 0 ? scale : 1);
      }
      this.destroy();
      return;
    }
    if (enemy !== null && (this.className === 'ProjectileElectric' || this.className === 'ProjectileLightning')) {
      this.spawnBolt(proj, enemy);
    }
    // Instant / Beam / Electric / Lightning / (Gaseous, Insect stand-ins): the enemy is
    // the hit location; EmitProjectileHitEffect parents the effect to its Hips_Bn / root.
    if (enemy !== null) {
      if (typeof hitSound === 'string') s.deps.audio?.play(`sfx/${hitSound}`, { volume: SFX_VOLUME, throttleMs: 40 });
      if (typeof hitEffect === 'string') {
        const at = s.deps.enemyAnchor?.(enemy) ?? { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z };
        s.deps.effects?.play(hitEffect, at, IDENT);
      }
    }
    // Gaseous: projectileHitEvent fires every buff tick of the ground zone — its view lives until the sim object dies.
    if (this.className === 'ProjectileInstant' || this.className === 'ProjectileInsect') {
      this.destroy();
    }
  }

  /** Destroy(gameObject) + OnDestroy: stop looping sound, detach+stop particle groups. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.flyingLoop?.stop();
    this.flyingLoop = null;
    this.burner?.stop();
    this.burner = null;
    this.gasFlow?.stop();
    this.gasFlow = null;
    this.gasAffect?.stop();
    this.gasAffect = null;
    this.beeFx?.stop();
    this.beeFx = null;
    this.beamLine?.dispose();
    this.beamLine = null;
    if (this.root !== null) {
      this.root.removeFromParent();
    }
    this.sys.release(this.handleId);
  }

  get isDead(): boolean {
    return this.dead;
  }
  get lastSimPosition(): V3 | null {
    return this.lastSim;
  }
}

export class ProjectileViewerSystem {
  readonly instances = new Map<number, ProjectileViewInstance>();
  readonly stats = { spawned: 0, destroyed: 0 };
  /** Procedural tesla / lightning bolts (BoltEffects.ts). */
  readonly bolts: BoltEffects | null;

  constructor(readonly deps: ProjectileViewerDeps) {
    this.bolts = deps.parent !== undefined ? new BoltEffects(deps.parent) : null;
  }

  /** `setProjectileViewerFactory` target: Object.Instantiate(viewer.projectile, firePoint, identity). */
  factory = (
    prefab: ProjectileViewContract | null,
    handleId: number,
    position?: V3,
  ): ProjectileViewContract | null => {
    if (prefab === null) return null;
    const base = prefab instanceof ProjectilePrefabContract ? prefab : projectileContract((prefab as { prefabName?: string }).prefabName ?? '');
    if (base === null) return prefab; // foreign prefab (headless stand-in): it doubles as its own viewer
    const inst = new ProjectileViewInstance(base, handleId, position ?? { x: 0, y: 0, z: 0 }, this);
    this.instances.set(handleId, inst);
    this.stats.spawned++;
    return inst;
  };

  release(handleId: number): void {
    if (this.instances.delete(handleId)) this.stats.destroyed++;
  }

  /** Once per frame: drive every live view from its sim projectile; views whose sim
   *  object vanished (lifetime expiry, tower sold) are destroyed. */
  update(dt: number, sims: Iterable<GameCoreProjectile>): void {
    this.bolts?.update(dt);
    const seen = new Set<number>();
    for (const p of sims) {
      const id = p.handle.m_handle;
      const inst = this.instances.get(id);
      if (inst === undefined) continue;
      seen.add(id);
      inst.update(dt, p);
    }
    for (const [id, inst] of [...this.instances]) {
      if (!seen.has(id)) inst.destroy();
    }
  }

  /** `Events.projectileHitEvent` listener. */
  onProjectileHit = (proj: GameCoreProjectile, enemy: unknown): void => {
    const inst = this.instances.get(proj.handle.m_handle);
    if (inst === undefined) return;
    inst.onHit(proj, (enemy ?? null) as { handle: { m_handle: number }; position: V3 } | null);
  };

  dispose(): void {
    for (const inst of [...this.instances.values()]) inst.destroy();
    this.bolts?.dispose();
  }
}
