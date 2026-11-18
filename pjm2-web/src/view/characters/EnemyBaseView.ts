// src/view/characters/EnemyBaseView.ts
// View-side port of Q4.EnemyBase (decomp/decompiled/Q4.EnemyBase.c, il2cpp RVAs in brackets):
//   Start @007f9af0 / InitAnimation @007fa210   parameter hashes, WalkCycleOffset = Range(0,10) * 0.1,
//                             spawnMode Balloon -> Balloon trigger, spawnMode Fire -> EnableFire
//   BossInit @007fb740        BossWalkSpeed 1, BossGrounded 1, BossInjured 0
//   Update @007fb8e0          UpdateFrozen, UpdateHitShock, state switch, BossUpdate
//   UpdateFrozen @007fbd30    Animator.speed while an ice effect is alive (stop-motion stepping)
//   UpdateHitShock @007fbe30  spring (air) / ballistic (ground) vertical hit bounce added to the position
//   StateMove @007fc140       position + shock, turn-towards-travel, MoveSpeedScale
//   StateBossAttack @007fc490 / StateJumpAttack @007fc670 / StateGroundAttack @007fca40
//   StateDead @007fce90       ballistic corpse (normal), fall-then-sink (Fat boss), sink (other bosses)
//   StateDrown @007fd770      fall to the water, bob (buoyancy), destroyed at the DrownDead state tag
//   BossUpdate @007fdde0      BossDamageWeight ramp, FastSlowTransition (slow mode), BossGrounded, BossInjured
//   LateUpdate @007fe1a0      balloon rig follows the Balloon_Be hand bone
//   OnJumpReaction @007fe4e0 / OnBossJump @007fe5e0 / OnEnemyHit @007fe710 / BossTakeStrongDamage @007fec20
//   OnSpawnGroupStarted @007feed0 (SpawnMinion trigger), OnEnemyDrown @007ff010, StateDeadInit @007ff1c0
//   PopBalloons @007ffa70, OnEnemyAttack @007ffdc0, OnBossAttackEffectEvent @00800530
//   OnBuffStart @007fb400 / OnBuffEnd @007fb590 / EnableFire @007faeb0 / EnableIce @007fb2f0
// Every numeric constant was checked in raw x86-64 (Il2CppUserAssemblies.elf, file offset = vaddr + 0x4000);
// see docs/ENEMY_BOSS_VIEW_ANALYSIS.md for the constant table.
// UNPORTED (documented): sounds, EnemyQuotePlayer speech, giants' QGames.CrumbleAnimator debris (approximated).

import * as THREE from 'three';
import { AttenuationCurve } from '../../core/AttenuationCurve';
import type { Vector3Like } from '../q4-contracts';
import type { EnemyViewRecord } from './enemyViewTypes';
import type { EnemyAnimator } from './EnemyAnimatorLogic';
import type { EnemyFxHandle } from './enemyEffects';

const GRAVITY = 20; // EnemyBase ctor @007f9470: +0x378 = 0x41a00000
const PHYSICS_GRAVITY_Y = -9.81; // PhysicsManager.m_Gravity (globalgamemanagers) = (0,-9.81,0)
const TURN_DEG_PER_SEC = 75; // DAT_00b92994
const TURN_SPEED_DIV = 1.75; // DAT_00b92988
const TURN_SCALE_MIN = 0.5; // DAT_00b9298c
const TURN_SCALE_MAX = 1.0; // DAT_00b92990
const MOVE_MIN_SQR = 1e-6; // DAT_00b92998
const ANIM_MIN_DT = 0.001; // DAT_00b9299c
const DEATH_RAND_MIN = 0.8; // DAT_00b929f8
const DEATH_RAND_MAX = 1.2; // DAT_00b929fc
const CORPSE_ROT_DEG_PER_SEC = 180; // DAT_00b929c4
const GROUND_HIT_MAX_DIST = 0.99; // DAT_00b929c0
const DEAD_RAY_UP = 1.0; // DAT_00b929b8 (origin lift)
const DEAD_RAY_MAX = 1.25; // DAT_00b929bc
const SHOCK_EPS = 0.05; // DAT_00b92984
const FROZEN_STEP_SCALE = 60; // DAT_00b92978: speed of the single stepped frame = interval * 60
const WALK_CYCLE_STEP = 0.1; // DAT_00b92970
const JUMP_ATTACK_DUR = 0.5; // 0x3f000000 in OnEnemyAttack (jump attack: lerp time)
const JUMP_ATTACK_HEIGHT = 1.0; // 0x3f800000
const GROUND_ATTACK_DUR = 1.2; // 0x3f99999a
const BOSS_ATTACK_DUR = 0.8; // 0x3f4ccccd
const ATTACK_TURN_DEG_PER_SEC = 1080; // DAT_00b929ac / b4
const ATTACK_TURN_MIN_SQR = 1e-6; // DAT_00b929a8 / b0
const DROWN_RAY_UP = 3.0; // DAT_00b929d4
const DROWN_RAY_MAX = 5.0; // DAT_00b929d8
const DROWN_GRAV_SCALE = 0.5; // DAT_00b929c8
const DROWN_FLOAT_RANGE = 0.3; // DAT_00b929cc
const DROWN_BUOYANCY = -1.35; // DAT_00b929d0
const BOSS_GROUNDED_EPS = 0.001; // DAT_00b929e4
const BOSS_GROUNDED_HALF = 0.5; // DAT_00b929e8
const JUMP_REACTION_STRONG_WEIGHT = 0.5; // DAT_00b929ec
const WEAK_SHOCK_RATE = 1.0; // DAT_00b929f0

export interface EnemyFrameInput {
  /** Sim position (UNITY space). */
  position: Vector3Like;
  /** Position at the previous frame/tick (UNITY space) for MoveSpeedScale / heading. */
  previousPosition: Vector3Like;
  /** GameCoreEnemy.SpeedCur. */
  speedCur: number;
  /** GameCoreEnemy.GroundOffsetY (boss BossGrounded, BalloonFallLand). */
  groundOffsetY?: number;
  /** GameCoreEnemy.IsSlowMode / IsDamagedMode (boss low-HP states). */
  slowMode?: boolean;
  damagedMode?: boolean;
  /** GameCoreEnemy.enemyMoveType === air (UpdateHitShock picks the spring branch). */
  air?: boolean;
  /** GameCoreEnemy.IsBalloon (LateUpdate keeps the balloon on the hand). */
  isBalloon?: boolean;
}

export interface DeathInfo {
  /** hitInfo.strongToDamage of the killing blow. */
  strong: boolean;
  /** Killer tower position (UNITY) or null. */
  towerPos: Vector3Like | null;
  /** hitInfo.damageSource position (UNITY) or null. */
  sourcePos: Vector3Like | null;
  distanceToCenterRate: number;
  enemyPos: Vector3Like;
}

export interface HitInfoView {
  /** hitInfo.damageSource != null (else: hip attack -> TakeAttackDamage). */
  hasSource: boolean;
  strongReaction: boolean;
  strongToDamage: boolean;
  distanceToCenterRate: number;
  reactionRate: number;
}

export interface AttackInfoView {
  isBoss: boolean;
  /** Enemy sim position (UNITY). */
  enemyPos: Vector3Like;
  /** Home position + GameCoreHome.EnemyAttackDistance (UNITY). */
  homePos: Vector3Like;
  homeAttackDistance: number;
  /** ChibiData.pos (UNITY) of the attacked chibi, null = none. */
  chibiPos: Vector3Like | null;
}

export type EnemyViewState = 'move' | 'attack' | 'dead' | 'drown';

export interface EnemyFxApi {
  /** Q4.ParticleGroupEvent.TriggerEffect(label): null when the prefab has no such mapping. */
  trigger(label: string): EnemyFxHandle | null;
}

export interface EnemyBaseViewDeps {
  root: THREE.Object3D;
  animator: EnemyAnimator;
  record: EnemyViewRecord;
  /** Ground height (three space) under (x,z) looking down from y, or null (no ground). */
  groundY?: (x: number, y: number, z: number) => number | null;
  /** Water surface height (three space) under (x,z) looking down from y, or null. */
  waterY?: (x: number, y: number, z: number) => number | null;
  fx?: EnemyFxApi;
  /** Balloon rig present (spawnMode Balloon with an extracted balloon). Number of balloons it carries. */
  balloonCount?: number;
  random?: () => number;
}

const _look = new THREE.Matrix4();
const _target = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Q4.Boss type ids (EBossType): 0 none, 1 Bero, 2 Fat, 3 Tall (ude), 4 Kao. */
export const BOSS_BERO = 1;
export const BOSS_FAT = 2;
export const BOSS_TALL = 3;
export const BOSS_KAO = 4;

export class EnemyBaseView {
  state: EnemyViewState = 'move';
  private randomWalkTime: number;
  private readonly vel = new THREE.Vector3(); // corpse / drown velocity (THREE space)
  private readonly corpseTarget = new THREE.Quaternion();
  private readonly deadPos = new THREE.Vector3();
  private deathTimer = 0;
  private deathStrong = false;
  private deathGroundY: number | null = null;
  private bossSinking = false; // bossType rewritten to 1 by the Fat boss when it has landed
  private sinkFx: EnemyFxHandle | null = null;
  private readonly rand: () => number;
  /** True once the view must be removed (destroy delay elapsed / attack finished / drowned). */
  expired = false;
  private landed = false;
  private readonly lastPos = new THREE.Vector3();
  private readonly lastDisp = new THREE.Vector3(); // m_vel: last per-frame displacement (three space)
  private haveLast = false;

  // hit shock (0x370 active, 0x374 height, 0x37c speed)
  private shockActive = false;
  private shockPos = 0;
  private shockVel = 0;
  private wasDamaged = false; // 0x2a8
  // frozen stepping
  private frozenTimer = 0; // 0x380
  // boss (0x384 slow, 0x385 damaging, 0x388 damage progress, 0x3a4 injured)
  private bossSlow = false;
  private bossDamaging = false;
  private bossDamageProg = 0;
  private bossInjured = false;
  // attack choreography (0x2e8.. )
  private atkTimer = 0;
  private atkJumpDur = 0;
  private atkDestroyDur = 0;
  private atkHeight = 0;
  private readonly atkStart = new THREE.Vector3(); // THREE space
  private readonly atkDst = new THREE.Vector3();
  private atkHasChibi = false;
  private atkTriggered = false; // HasTriggeredAttack (0x3ac)
  private atkKind: 'boss' | 'jump' | 'ground' = 'jump';
  // drown
  private inWater = false;
  private floatY = 0;
  private drownFx: EnemyFxHandle | null = null;
  // balloons
  private balloonsLeft: number;
  private balloonFall = false;
  // fx
  private fireFx: EnemyFxHandle | null = null;
  private iceFx: EnemyFxHandle | null = null;
  private readonly fxLive: EnemyFxHandle[] = [];
  private gameOver = false;
  /** Crumble-death approximation clock (giants; QGames.CrumbleAnimator is not ported). */
  crumbleT = -1;
  /** Host hook: Q4.Balloon.PopBalloons(count) with `before` balloons flying (visual rig). */
  onBalloonsPopped: ((before: number, count: number) => void) | null = null;
  /** Hook for the host: attack choreography finished a "kill the chibi" beat (0.5 s jump / 0.8 s boss / 1.2 s ground). */
  onChibiBeat: (() => void) | null = null;

  constructor(private readonly d: EnemyBaseViewDeps) {
    this.rand = d.random ?? Math.random;
    this.randomWalkTime = this.range(d.record.randomWalkAnimIntervalMin, d.record.randomWalkAnimIntervalMax);
    d.animator.random = this.rand;
    this.balloonsLeft = d.balloonCount ?? 0;
    this.initAnimation();
  }

  private range(a: number, b: number): number { return a + (b - a) * this.rand(); }
  private get a(): EnemyAnimator { return this.d.animator; }
  private get r(): EnemyViewRecord { return this.d.record; }
  private get bossType(): number { return this.bossSinking ? BOSS_BERO : this.d.record.m_bossType; }
  private fx(label: string): EnemyFxHandle | null {
    const h = this.d.fx?.trigger(label) ?? null;
    if (h !== null) this.fxLive.push(h);
    return h;
  }

  /** InitAnimation @007fa210 + BossInit @007fb740. */
  private initAnimation(): void {
    const a = this.a;
    a.resetTrigger('DeathImpact');
    a.setInteger('DeathType', 0);
    // WalkCycleOffset = Random.Range(0, 10) * 0.1 (int Range: [0, 10))
    a.setFloat('WalkCycleOffset', Math.floor(this.rand() * 10) * WALK_CYCLE_STEP);
    if (this.r.spawnMode === 2) a.setTrigger('Balloon'); // spawnMode Balloon: ride the balloon
    if (this.r.m_bossType !== 0) {
      a.setFloat('BossWalkSpeed', 1);
      a.setFloat('BossGrounded', 1);
      a.setFloat('BossInjured', 0);
      a.resetTrigger('SpawnMinion');
    }
    if (this.r.spawnMode === 1) this.enableFire(); // spawnMode Fire: burning from the start
  }

  // ---- Q4.EnemyBase fire / ice (EnableFire @007faeb0, EnableIce @007fb2f0, Extinguish* @007fb0f0/1f0) ----

  // m_fireEffect / m_iceEffect (0x318 / 0x310) are the TriggerEffect handles; `fireOn` / `iceOn` mirror
  // "handle != null" so UpdateFrozen works even when the particle player is unavailable.
  private fireOn = false;
  private iceOn = false;
  enableFire(): void {
    if (!this.fireOn) { this.fireOn = true; this.fireFx = this.fx('Fire'); }
    this.extinguishIce();
  }
  /** Q4.ParticleGroup.FreeEffectsOnObjectDestroy: the enemy is destroyed -> every effect it owns stops emitting
   *  (live particles finish). Without this the sink / fire / ice loops of a removed enemy would run forever. */
  freeEffects(): void {
    for (const h of this.fxLive) h.stop();
    this.fxLive.length = 0;
    this.fireFx = null; this.iceFx = null; this.sinkFx = null; this.drownFx = null;
  }

  extinguishFire(): void { this.fireFx?.stop(); this.fireFx = null; this.fireOn = false; }
  enableIce(): void {
    if (!this.iceOn) { this.iceOn = true; this.iceFx = this.fx('Ice'); }
    this.extinguishFire();
  }
  extinguishIce(): void { this.iceFx?.stop(); this.iceFx = null; this.iceOn = false; }
  get hasFire(): boolean { return this.fireOn; }
  get hasIce(): boolean { return this.iceOn; }

  /** Q4.ParticleGroupEventHandler.TriggerEffect(label), fired by clip AnimationEvents. */
  animationEffect(label: string): void { this.fx(label); }

  /** OnBuffStart @007fb400 (target check done by the caller). */
  onBuffStart(kind: 'fire' | 'ice'): void { if (kind === 'fire') this.enableFire(); else this.enableIce(); }
  /** OnBuffEnd @007fb590. */
  onBuffEnd(kind: 'fire' | 'ice'): void { if (kind === 'fire') this.extinguishFire(); else this.extinguishIce(); }
  /** OnFireExtinguished @007fafc0. */
  onFireExtinguished(): void { if (this.fireOn) this.extinguishFire(); }
  onGameOver(): void { this.gameOver = true; }

  // ---- events (EnemyBase listeners) ----

  /** OnEnemyHit @007fe710. */
  onHit(h: HitInfoView): void {
    if (this.state === 'dead' || this.state === 'drown') return;
    const a = this.a;
    if (!h.hasSource) { a.setTrigger('TakeAttackDamage'); return; }
    const r = this.r;
    if (!this.shockActive) {
      // shock impulse = Sample(curve, distanceToCenterRate) * maxShockSpeed * (strong ? additionShockRate : 1)
      //                 * shockScale * reactionRate
      const att = AttenuationCurve.sample(r.shockCurveInfos.map((c) => ({ rate: c.rate, attenuation: c.attenuation, snap: c.snap !== 0 })),
        h.distanceToCenterRate);
      this.shockActive = true;
      this.shockVel = att * r.maxShockSpeed * (h.strongToDamage ? r.additionShockRate : WEAK_SHOCK_RATE) * r.shockScale * h.reactionRate;
    }
    if (!h.strongReaction) a.setTrigger('TakeDamageWeak');
    else { a.setTrigger('TakeDamageStrong'); this.bossTakeStrongDamage(); }
    if (r.m_bossType >= 1 && r.m_bossType <= 4) { this.fx('Damage'); this.wasDamaged = true; }
  }

  /** BossTakeStrongDamage @007fec20. */
  private bossTakeStrongDamage(): void {
    if (!this.bossDamaging) { this.bossDamaging = true; this.bossDamageProg = 0; }
    if (this.r.m_bossType === BOSS_TALL) { this.fx('Damage'); this.wasDamaged = true; }
  }

  /** OnJumpReaction @007fe4e0: hop of every enemy near a jumping structure (weight). */
  onJumpReaction(weight: number): void {
    if (!this.shockActive) { this.shockActive = true; this.shockVel = weight * this.r.m_TrampolineSpeed; }
    this.a.setTrigger(weight >= JUMP_REACTION_STRONG_WEIGHT ? 'TakeDamageStrong' : 'TakeDamageWeak');
  }

  /** OnBossJump @007fe5e0: the jumping boss leaves the ground with m_bossJumpUpSpeed. */
  onBossJump(): void {
    if (!this.shockActive) { this.shockActive = true; this.shockVel = this.r.m_bossJumpUpSpeed; }
  }

  /** OnBossAttackEffectEvent @00800530: Attack effect + puff (the boss slams the ground). */
  onBossAttackEffect(): void { this.fx('Attack'); this.wasDamaged = false; }

  /** OnSpawnGroupStarted @007feed0 (bosses; minion groups only). */
  onSpawnGroupStarted(isMinion: boolean): void {
    if (!isMinion || this.r.m_bossType === 0 || !this.a.hasParameter('SpawnMinion')) return;
    this.a.setTrigger('SpawnMinion');
  }

  /** OnPopBalloons @007ffc00 -> PopBalloons @007ffa70. */
  onPopBalloons(n: number): void {
    if (this.balloonsLeft <= 0 && !(this.d.balloonCount ?? 0)) return;
    const before = this.balloonsLeft;
    if (n > 0) this.balloonsLeft = Math.max(0, this.balloonsLeft - n);
    if (before - this.balloonsLeft > 0) this.onBalloonsPopped?.(before, before - this.balloonsLeft);
    if (this.balloonsLeft > 0) return;
    this.a.setTrigger('BalloonFall');
    this.balloonFall = true;
  }
  get balloons(): number { return this.balloonsLeft; }

  /** OnEnemyDrown @007ff010: mode Drown + Drown trigger, vertical velocity reset. */
  onDrown(): void {
    if (this.state === 'dead' || this.state === 'drown') return;
    this.state = 'drown';
    this.a.setTrigger('Drown');
    this.vel.y = 0;
    this.vel.x = this.lastDisp.x; this.vel.z = this.lastDisp.z; // m_vel: last per-frame displacement
    this.vel.y = 0;
    this.inWater = false;
    this.extinguishFire();
  }

  /** OnEnemyAttack @007ffdc0. */
  onAttack(info: AttackInfoView): void {
    const a = this.a;
    const r = this.r;
    if (this.state === 'dead' || this.state === 'drown') return;
    this.atkHasChibi = info.chibiPos !== null;
    // destination: chibi position, or the home edge when the chibi is farther away than the home itself
    const enemy = new THREE.Vector3(info.enemyPos.x, info.enemyPos.y, info.enemyPos.z);
    const dst = info.chibiPos !== null ? new THREE.Vector3(info.chibiPos.x, info.chibiPos.y, info.chibiPos.z)
      : new THREE.Vector3(info.homePos.x, info.homePos.y, info.homePos.z);
    const toHome = enemy.clone().sub(new THREE.Vector3(info.homePos.x, info.homePos.y, info.homePos.z));
    const toDst = enemy.clone().sub(dst);
    if (toHome.lengthSq() <= toDst.lengthSq()) {
      dst.set(info.homePos.x, info.homePos.y, info.homePos.z).addScaledVector(toHome.normalize(), info.homeAttackDistance);
    }
    this.state = 'attack';
    this.atkTimer = 0;
    this.atkTriggered = false;
    this.atkDestroyDur = r.AttackDestroySelfDur;
    if (info.isBoss) {
      this.atkKind = 'boss';
      this.atkJumpDur = BOSS_ATTACK_DUR;
      a.setFloat('MoveSpeedScale', 0);
      a.setTrigger('Attack');
      return;
    }
    const start = this.d.root.position;
    dst.y += r.AttackDstHeightOffset;
    if (r.AttackType === 1) {
      this.atkKind = 'jump';
      this.atkJumpDur = JUMP_ATTACK_DUR;
      this.atkHeight = JUMP_ATTACK_HEIGHT;
      this.atkStart.set(-info.enemyPos.x, info.enemyPos.y, info.enemyPos.z);
      this.atkDst.set(-dst.x, dst.y, dst.z);
      a.setTrigger('Attack');
    } else {
      this.atkKind = 'ground';
      this.atkJumpDur = GROUND_ATTACK_DUR;
      this.atkHeight = 0;
      this.atkStart.copy(start);
      this.atkDst.set(-dst.x, dst.y, dst.z);
      // SetCrumbleParams(forward + up) : CrumbleDir* for the crumble attack states (QGames.CrumbleBehaviour, unported)
    }
  }

  /** OnEnemyDestroyed -> StateDeadInit @007ff1c0. */
  onDestroyed(info: DeathInfo): void {
    if (this.state === 'dead') return;
    const a = this.a;
    const r = this.r;
    const root = this.d.root;
    this.state = 'dead';
    this.deathStrong = info.strong;
    this.onPopBalloons(1000000); // OnEnemyDestroyed pops every remaining balloon
    // launch direction + attenuation
    let dx: number; let dz: number; let scale = 1;
    const useSource = info.sourcePos !== null && info.distanceToCenterRate > 0;
    if (!useSource) {
      if (info.towerPos === null) {
        const th = this.rand() * Math.PI * 2; // Random.onUnitSphere (xz taken, normalised below)
        dx = Math.cos(th); dz = Math.sin(th);
      } else {
        dx = info.enemyPos.x - info.towerPos.x; dz = info.enemyPos.z - info.towerPos.z;
      }
    } else {
      dx = info.enemyPos.x - info.sourcePos!.x; dz = info.enemyPos.z - info.sourcePos!.z;
      const t = Math.max(0, Math.min(1, info.distanceToCenterRate));
      scale = r.BombAttenuationCenter + (r.BombAttenuationOutside - r.BombAttenuationCenter) * t;
    }
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = 0; dz = 1; }
    a.setTrigger('Die');
    a.setInteger('DeathType', (info.strong ? 1 : 0) + 1);
    a.resetTrigger('TakeDamageWeak');
    a.resetTrigger('TakeDamageStrong');
    a.resetTrigger('TakeAttackDamage');
    this.deathTimer = 0;
    this.landed = false;
    this.deathGroundY = this.d.groundY?.(root.position.x, root.position.y, root.position.z) ?? null;
    if (r.IsCrumbleDeath) {
      // crumble branch: Crumble params (a.CrumbleDir*/CrumbleStrong), ExtinguishFire, Die effect, no launch velocity
      a.setFloat('CrumbleDirX', -dx); a.setFloat('CrumbleDirY', 0); a.setFloat('CrumbleDirZ', dz);
      a.setBool('CrumbleStrong', info.strong);
      this.extinguishFire();
      this.fx('Die');
      this.vel.set(0, 0, 0);
      this.crumbleT = 0;
      this.corpseTarget.copy(root.quaternion);
      return;
    }
    this.extinguishFire();
    if (this.r.m_bossType === 0) {
      // faces LookRotation(dir) (mirrored into three space); launched along it
      _v.set(root.position.x - dx, root.position.y, root.position.z + dz);
      _look.lookAt(_v, root.position, _up);
      this.corpseTarget.setFromRotationMatrix(_look);
      const h = (info.strong ? r.StrongDeathSpeedH : r.WeakDeathSpeedH) * this.range(DEATH_RAND_MIN, DEATH_RAND_MAX);
      const v = (info.strong ? r.StrongDeathSpeedV : r.WeakDeathSpeedV) * this.range(DEATH_RAND_MIN, DEATH_RAND_MAX);
      this.vel.set(-dx * h * scale, v * scale, dz * h * scale);
    } else {
      if (r.m_bossType === BOSS_KAO || r.m_bossType === BOSS_BERO) this.fx('Die');
      this.deadPos.copy(root.position);
      this.corpseTarget.copy(root.quaternion);
      this.vel.set(0, 0, 0);
    }
  }

  // ---- per-frame ----

  /** EnemyBase.Update @007fb8e0. `frame` = null when the sim object is gone (core == null). */
  update(dt: number, frame: EnemyFrameInput | null): void {
    const a = this.a;
    this.updateFrozen(dt);
    if (frame !== null) this.updateHitShock(dt, frame);
    switch (this.state) {
      case 'move':
        if (frame !== null) {
          this.stateMove(dt, frame);
          this.randomWalk(dt);
        }
        break;
      case 'attack': this.stateAttack(dt, frame); break;
      case 'dead': this.stateDead(dt); break;
      case 'drown': this.stateDrown(dt); break;
    }
    if (frame !== null && this.balloonFall && (frame.groundOffsetY ?? 1) <= 0) {
      a.setTrigger('BalloonFallLand');
      this.balloonFall = false;
    }
    this.bossUpdate(dt, frame);
    for (const h of this.fxLive) h.follow();
    // Drop finished handles; a handle that is pushed out of the cap is STOPPED (dropping it would leave an endless emitter
    // running at its last pose forever).
    for (let i = this.fxLive.length - 1; i >= 0; i--) if (!this.fxLive[i].active) this.fxLive.splice(i, 1);
    if (this.fxLive.length > 24) for (const h of this.fxLive.splice(0, this.fxLive.length - 24)) h.stop();
    a.update(dt);
  }

  /** UpdateFrozen @007fbd30: while an ice effect is alive the Animator is stepped like stop-motion:
   *  speed = freezeAnimSpeed for `freezeAnimInterval` seconds, then one frame at interval * 60. */
  private updateFrozen(dt: number): void {
    const r = this.r;
    if (r.m_freezeAnimEnable !== 0 && this.hasIce) {
      this.frozenTimer -= dt;
      if (this.frozenTimer > 0) { this.a.speed = r.m_freezeAnimSpeed; return; }
      this.frozenTimer = r.m_freezeAnimInterval;
      this.a.speed = r.m_freezeAnimInterval * FROZEN_STEP_SCALE;
      return;
    }
    this.a.speed = 1;
  }

  /** UpdateHitShock @007fbe30. */
  private updateHitShock(dt: number, f: EnemyFrameInput): void {
    if (!this.shockActive) return;
    const r = this.r;
    if (f.air === true) {
      // damped spring around 0 (air enemies bob)
      this.shockVel -= this.shockPos * r.shockSpring * dt;
      this.shockVel = (1 - Math.max(0, Math.min(1, r.shockDamping * dt))) * this.shockVel;
      this.shockPos += this.shockVel * dt;
      if (Math.abs(this.shockPos) < SHOCK_EPS && Math.abs(this.shockVel) < SHOCK_EPS) {
        this.shockPos = 0; this.shockVel = 0; this.shockActive = false;
      }
      return;
    }
    // ground enemies: ballistic hop under gravity 20
    this.shockVel -= dt * GRAVITY;
    this.shockPos += this.shockVel * dt;
    if (this.shockPos < 0) {
      this.shockPos = 0; this.shockVel = 0; this.shockActive = false;
      if (r.m_bossType !== 0 && this.state !== 'attack') {
        if (!this.wasDamaged && r.m_bossType !== BOSS_TALL) this.fx('FootLeft');
        this.wasDamaged = false;
      }
    }
  }

  private stateMove(dt: number, f: EnemyFrameInput): void {
    const a = this.a;
    const r = this.r;
    const root = this.d.root;
    if (this.gameOver) { a.setFloat('MoveSpeedScale', 0); return; }
    root.position.set(-f.position.x, f.position.y + this.shockPos, f.position.z);
    const dx = f.position.x - f.previousPosition.x;
    const dy = f.position.y - f.previousPosition.y;
    const dz = f.position.z - f.previousPosition.z;
    const turn = Math.max(TURN_SCALE_MIN, Math.min(TURN_SCALE_MAX, f.speedCur / TURN_SPEED_DIV));
    if (dx * dx + dz * dz >= MOVE_MIN_SQR) {
      // RotateTowards(rotation, LookRotation(delta with y=0), turn*75*dt degrees)
      _v.set(root.position.x - dx, root.position.y, root.position.z + dz); // mirrored forward target
      _look.lookAt(_v, root.position, _up);
      _target.setFromRotationMatrix(_look);
      const maxRad = THREE.MathUtils.degToRad(turn * TURN_DEG_PER_SEC * dt);
      const ang = root.quaternion.angleTo(_target);
      if (ang <= maxRad || ang < 1e-6) root.quaternion.copy(_target);
      else root.quaternion.rotateTowards(_target, maxRad);
    }
    let speed = 0;
    if (dt > ANIM_MIN_DT) {
      const vel = Math.sqrt(dx * dx + dy * dy + dz * dz) * (1 / dt);
      speed = r.enableAnimMoveSpeedScaling === 0 ? (vel > 0.001 ? 1 : 0) : vel / r.animMoveSpeed;
    }
    a.setFloat('MoveSpeedScale', speed);
    // Update(): m_vel = Transform.position - m_lastPos (per-frame displacement)
    if (this.haveLast) this.lastDisp.copy(root.position).sub(this.lastPos);
    this.lastPos.copy(root.position);
    this.haveLast = true;
  }

  private randomWalk(dt: number): void {
    this.randomWalkTime -= dt;
    if (this.randomWalkTime <= 0) {
      this.randomWalkTime = this.range(this.r.randomWalkAnimIntervalMin, this.r.randomWalkAnimIntervalMax);
      this.a.setTrigger('WalkVariation');
    }
  }

  private faceToward(dirX: number, dirZ: number, dt: number): void {
    if (dirX * dirX + dirZ * dirZ < ATTACK_TURN_MIN_SQR) return;
    const root = this.d.root;
    _v.set(root.position.x + dirX, root.position.y, root.position.z + dirZ);
    _look.lookAt(_v, root.position, _up);
    _target.setFromRotationMatrix(_look);
    const maxRad = THREE.MathUtils.degToRad(ATTACK_TURN_DEG_PER_SEC * dt);
    if (root.quaternion.angleTo(_target) <= maxRad) root.quaternion.copy(_target);
    else root.quaternion.rotateTowards(_target, maxRad);
  }

  /** StateBossAttack @007fc490 / StateJumpAttack @007fc670 / StateGroundAttack @007fca40. */
  private stateAttack(dt: number, f: EnemyFrameInput | null): void {
    const root = this.d.root;
    this.atkTimer += dt;
    if (this.atkKind === 'boss') {
      if (f !== null) root.position.set(-f.position.x, f.position.y + this.shockPos, f.position.z);
      if (this.atkHasChibi && this.atkTimer >= this.atkJumpDur) { this.atkHasChibi = false; this.onChibiBeat?.(); }
      if (f === null && this.atkDestroyDur <= this.atkTimer) this.expired = true;
      return;
    }
    if (this.atkKind === 'jump') {
      const frac = Math.max(0, Math.min(1, this.atkTimer / this.atkJumpDur));
      root.position.lerpVectors(this.atkStart, this.atkDst, frac);
      root.position.y += Math.sin(frac * Math.PI) * this.atkHeight; // Sin(frac * 180 * deg2rad) * height
      if (this.atkHasChibi && (this.atkJumpDur <= this.atkTimer || this.atkDestroyDur <= this.atkTimer)) {
        this.atkHasChibi = false;
        this.fx('Attack'); // chibi hit: Attack effect + PuffOfSmoke
        this.onChibiBeat?.();
      }
      if (this.atkDestroyDur <= this.atkTimer) this.expired = true;
      this.faceToward(this.atkDst.x - this.atkStart.x, this.atkDst.z - this.atkStart.z, dt);
      return;
    }
    // ground attack: the enemy plays Attack where it stands (AttackRange is huge), kills the chibi at 1.2 s
    if (this.atkHasChibi && (this.atkJumpDur <= this.atkTimer || this.atkDestroyDur <= this.atkTimer)) {
      this.atkHasChibi = false;
      this.fx('Attack');
      this.onChibiBeat?.();
    }
    if (!this.atkTriggered) { this.atkTriggered = true; this.a.setTrigger('Attack'); }
    if (this.atkDestroyDur <= this.atkTimer) this.expired = true;
  }

  private groundAt(): number | null {
    const root = this.d.root;
    return this.d.groundY?.(root.position.x, root.position.y, root.position.z) ?? this.deathGroundY;
  }

  /** StateDead @007fce90. */
  private stateDead(dt: number): void {
    const root = this.d.root;
    this.deathTimer += dt;
    if (this.deathTimer >= this.r.DestroyDelay) { this.expired = true; return; }
    if (this.crumbleT >= 0) this.crumbleT += dt;
    const bt = this.bossType;
    if (bt === 0) {
      this.vel.y -= dt * GRAVITY;
      root.position.addScaledVector(this.vel, dt);
      if (this.vel.y < 0) {
        const g = this.groundAt();
        // Raycast from pos + up*1.0 straight down (max 1.25) on LargeTerrainMask: hit within 0.99 <=> ground >= pos.y + 0.01.
        if (g !== null && g >= root.position.y + (DEAD_RAY_UP - GROUND_HIT_MAX_DIST) && g <= root.position.y + DEAD_RAY_MAX) {
          this.vel.y = -this.vel.y * this.r.StrongDeathBounce;
          const fr = 1 - this.r.StrongDeathFriction;
          this.vel.x *= fr; this.vel.z *= fr;
          if (!this.landed) { this.landed = true; this.a.setTrigger('DeathImpact'); }
        }
      }
    } else {
      if (bt === BOSS_FAT) {
        // the flying Fat boss falls until the terrain ray (1 u from pos+1) hits, then it sinks like the others
        const g = this.groundAt();
        if (g !== null && g >= root.position.y && g <= root.position.y + DEAD_RAY_UP) {
          this.bossSinking = true;
          this.deadPos.copy(root.position);
        } else {
          this.vel.y -= dt * GRAVITY;
          root.position.addScaledVector(this.vel, dt);
          this.deadPos.copy(root.position);
        }
      }
      if (this.bossType !== BOSS_FAT) {
        if (this.sinkFx === null) {
          this.sinkFx = this.fx('Sink');
          this.sinkFx?.detach(); // Q4.ParticleGroup.DetachTransform: the dust stays where the boss went down
        }
        this.deadPos.y -= this.r.m_bossSinkSpeed * dt;
        // + Random.insideUnitSphere * m_bossSinkShake
        const rr = Math.cbrt(this.rand());
        const th = this.rand() * Math.PI * 2;
        const ph = Math.acos(2 * this.rand() - 1);
        root.position.set(
          this.deadPos.x + rr * Math.sin(ph) * Math.cos(th) * this.r.m_bossSinkShake,
          this.deadPos.y + rr * Math.cos(ph) * this.r.m_bossSinkShake,
          this.deadPos.z + rr * Math.sin(ph) * Math.sin(th) * this.r.m_bossSinkShake,
        );
      }
    }
    const ang = root.quaternion.angleTo(this.corpseTarget);
    const maxRad = THREE.MathUtils.degToRad(CORPSE_ROT_DEG_PER_SEC * dt);
    if (ang <= maxRad) root.quaternion.copy(this.corpseTarget);
    else root.quaternion.rotateTowards(this.corpseTarget, maxRad);
  }

  /** StateDrown @007fd770. */
  private stateDrown(dt: number): void {
    const root = this.d.root;
    const r = this.r;
    if (!this.inWater) {
      this.vel.y += PHYSICS_GRAVITY_Y * dt; // m_vel += Physics.gravity * dt (vel.xz = last per-frame displacement)
      root.position.addScaledVector(this.vel, dt);
      const surface = this.d.waterY?.(root.position.x, root.position.y + DROWN_RAY_UP, root.position.z) ?? root.position.y;
      // Raycast(pos + up*3, down, 5, WaterMask): entered when hit.distance < 3 - DrownDepth
      const dist = root.position.y + DROWN_RAY_UP - surface;
      if (dist >= 0 && dist <= DROWN_RAY_MAX && dist < DROWN_RAY_UP - r.DrownDepth) {
        this.vel.set(0, 0, 0);
        this.floatY = surface - r.DrownDepth;
        this.inWater = true;
        this.fx('WaterSplash');
        this.drownFx = this.fx('Drowning');
      }
    } else {
      const gy = PHYSICS_GRAVITY_Y * DROWN_GRAV_SCALE;
      this.vel.y += gy * dt;
      const t = Math.max(0, Math.min(1, (this.floatY - root.position.y) / DROWN_FLOAT_RANGE));
      this.vel.y += gy * (DROWN_BUOYANCY / DROWN_GRAV_SCALE) * t * dt; // gravity.y * -1.35 * t * dt
      root.position.addScaledVector(this.vel, dt);
    }
    if (this.a.currentTag === 'DrownDead') { this.drownFx?.stop(); this.expired = true; }
  }

  /** BossUpdate @007fdde0 (+ BossInit parameters). */
  private bossUpdate(dt: number, f: EnemyFrameInput | null): void {
    const r = this.r;
    if (r.m_bossType === 0) return;
    const a = this.a;
    if (this.bossDamaging) {
      let p = this.bossDamageProg;
      let w: number;
      if (p <= 1) {
        p += (1 / r.m_bossStrongDamageAnimDownDur) * dt; // ramp up
        w = p;
      } else {
        p += (1 / r.m_bossStrongDamageAnimUpDur) * dt; // ramp down
        const v = Math.max(0, Math.min(1, p - 1));
        w = 1 - v;
        if (1 - v <= 0) this.bossDamaging = false;
      }
      this.bossDamageProg = p;
      a.setFloat('BossDamageWeight', w);
    }
    if (f === null) return;
    if (f.slowMode === true && !this.bossSlow) {
      this.bossSlow = true;
      a.setTrigger('FastSlowTransition');
      a.setFloat('BossWalkSpeed', 0);
    }
    const go = f.groundOffsetY ?? 0;
    if (a.hasParameter('BossGrounded')) {
      a.setFloat('BossGrounded', go > BOSS_GROUNDED_EPS ? 0 : 1);
      void BOSS_GROUNDED_HALF; // landing footstep sound (not ported)
    }
    if (this.bossInjured) return;
    if (f.damagedMode === true && !this.bossSlow) {
      this.bossInjured = true;
      a.setFloat('BossInjured', 1);
    }
  }

  /** Current balloon world anchor requirement (LateUpdate): the host positions the balloon rig. */
  get wantsBalloon(): boolean { return this.balloonsLeft > 0; }
}
