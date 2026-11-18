// src/view/characters/enemyViewSystem.ts
// Glue between the sim's enemy events and the enemy views (new file so game.ts stays
// a thin caller):
//   * routes Events.enemyHitEvent / enemyDestroyedEvent / enemyDrownEvent /
//     enemyAttackEvent to EnemyBaseView (Animator triggers, corpse launch) — the same
//     listeners Q4.EnemyBase.Awake subscribes (OnEnemyHit @007fe710,
//     OnEnemyDestroyed @007ff0e0, OnEnemyDrown @007ff010, OnEnemyAttack @007ffdc0);
//   * owns the Q4.NewHealthBar port (enemy health gauges).

import * as THREE from 'three';
import { BuffBurn } from '../../core/BuffBurn';
import { BuffFreeze } from '../../core/BuffFreeze';
import { BuffSlow } from '../../core/BuffSlow';
import { Events } from '../../core/Events';
import { getSimPhysics, Q4Layers } from '../../core/physics-seam';
import type { GameCoreHome, ChibiData } from '../../core/GameCoreHome';
import { BuffSettingBurn, BuffSettingFreeze } from '../projectiles/buffSettings';
import { EnemyEffects } from './enemyEffects';
import { EnemyParticles, type EnemyEmitter } from './enemyParticles';
import { EventTime } from '../../core/event/CoreEvent';
import type { GameCoreEnemy } from '../../core/GameCoreEnemy';
import type { EnemyHitInfo } from '../../core/EnemyHitInfo';
import type { GameCoreTower } from '../../core/GameCoreTower';
import { getRegisteredUnityObject } from '../q4-contracts';
import { EnemyStageView, setEnemyEffects, setEnemyWaterProbe } from './EnemyStageView';
import { ENEMY_VIEW_DATA } from './enemyViewData.generated';
import { barSizeForEnemy, EnemyHealthBars } from './EnemyHealthBar';
import { EnemyHealthBarOverlay } from './EnemyHealthBarOverlay';

function viewOf(enemy: GameCoreEnemy | null): EnemyStageView | null {
  if (enemy === null) return null;
  const v = getRegisteredUnityObject(enemy.handle.m_handle);
  return v instanceof EnemyStageView ? v : null;
}

export interface EnemyViewSystemOptions {
  camera: THREE.Camera;
  container: HTMLElement;
  spriteUrl: (name: string) => string;
  /** Unity position -> three position (mirror). */
  toThree: (p: { x: number; y: number; z: number }, out: THREE.Vector3) => THREE.Vector3;
  /** Scene that receives the enemy particle pool (Q4.ParticleGroupEvent effects). Omitted = no particles. */
  scene?: THREE.Scene;
  /** URL of the enemy emitters (tools/assets/extract_particles.py --bundles enemies). */
  emitterUrl?: string;
  /** GameCameraBehind active? Selects EnemyBase.BehindLifeGaugeOffset (default: the top-down gameplay camera). */
  isBehindCamera?: () => boolean;
}

const _p = new THREE.Vector3();

export class EnemyViewSystem {
  readonly bars: EnemyHealthBars<EnemyStageView>;
  private readonly overlay: EnemyHealthBarOverlay;
  private now = 0;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly o: EnemyViewSystemOptions) {
    const cfg = ENEMY_VIEW_DATA.healthBar;
    this.bars = new EnemyHealthBars<EnemyStageView>(cfg, (v) => v.root.parent === null);
    this.overlay = new EnemyHealthBarOverlay(cfg, o.spriteUrl, o.container);

    const onHit = (info: EnemyHitInfo): void => {
      const enemy = info.toEnemy;
      const view = viewOf(enemy);
      if (enemy === null || view === null) return;
      // OnEnemyHit @007fe710
      view.base?.onHit({
        hasSource: info.damageSource !== null, strongReaction: info.strongReaction, strongToDamage: info.strongToDamage,
        distanceToCenterRate: info.distanceToCenterRate, reactionRate: info.reactionRate,
      });
      // NewHealthBar.OnEnemyHit @003d8830: only damage > 0
      if (info.damage > 0) this.showBar(enemy, view, info);
    };
    const onDestroyed = (tower: GameCoreTower | null, enemy: GameCoreEnemy, info: EnemyHitInfo): void => {
      const view = viewOf(enemy);
      if (view === null) return;
      const ep = enemy.position;
      view.base?.onDestroyed({
        strong: info.strongToDamage,
        towerPos: tower ? { x: tower.position.x, y: tower.position.y, z: tower.position.z } : null,
        sourcePos: info.damageSource ? { x: info.damageSource.position.x, y: info.damageSource.position.y, z: info.damageSource.position.z } : null,
        distanceToCenterRate: info.distanceToCenterRate,
        enemyPos: { x: ep.x, y: ep.y, z: ep.z },
      });
      this.showBar(enemy, view, info); // NewHealthBar.OnEnemyDestroyed @003d8b70
    };
    const onDrown = (enemy: GameCoreEnemy): void => viewOf(enemy)?.base?.onDrown();
    const onAttack = (enemy: GameCoreEnemy, home: GameCoreHome, chibi: ChibiData): void => {
      const ep = enemy.position;
      const hp = home.position;
      viewOf(enemy)?.base?.onAttack({
        isBoss: enemy.isBoss,
        enemyPos: { x: ep.x, y: ep.y, z: ep.z },
        homePos: { x: hp.x, y: hp.y, z: hp.z },
        homeAttackDistance: home.enemyAttackDistance,
        chibiPos: chibi ? { x: chibi.pos.x, y: chibi.pos.y, z: chibi.pos.z } : null,
      });
    };
    const onSpawn = (enemy: GameCoreEnemy): void => { const v = viewOf(enemy); if (v !== null) this.views.add(v); };
    const onJumpReaction = (enemy: GameCoreEnemy, weight: number): void => viewOf(enemy)?.base?.onJumpReaction(weight);
    const onBossJump = (enemy: GameCoreEnemy): void => viewOf(enemy)?.base?.onBossJump();
    const onPop = (enemy: GameCoreEnemy, n: number): void => viewOf(enemy)?.base?.onPopBalloons(n);
    const onBossAttackEffect = (): void => { for (const v of this.views) v.base?.onBossAttackEffect(); };
    const onSpawnGroup = (_id: number, _enemy: unknown, _pos: unknown, isMinion: boolean): void => {
      for (const v of this.views) v.base?.onSpawnGroupStarted(isMinion);
    };
    const onGameOver = (): void => { for (const v of this.views) v.base?.onGameOver(); };
    // OnBuffStart @007fb400: BuffSettingBurn -> EnableFire; BuffSettingFreeze / Slow -> EnableIce
    // (the decompile names the type slots FastPlayer/Slow/Freeze; behaviour = burn -> fire, freeze/slow -> ice).
    const onBuffStart = (target: unknown, setting: unknown): void => {
      const v = viewOf(target as GameCoreEnemy);
      if (v === null) return;
      if (setting instanceof BuffSettingBurn) v.base?.onBuffStart('fire');
      else if (setting instanceof BuffSettingFreeze || (setting as { constructor?: { name?: string } } | null)?.constructor?.name === 'BuffSettingSlow') v.base?.onBuffStart('ice');
    };
    const onBuffEnd = (target: unknown, type: unknown): void => {
      const v = viewOf(target as GameCoreEnemy);
      if (v === null) return;
      if (type === BuffBurn) v.base?.onBuffEnd('fire');
      else if (type === BuffFreeze || type === BuffSlow) v.base?.onBuffEnd('ice');
    };
    const onFireExtinguished = (target: unknown): void => viewOf(target as GameCoreEnemy)?.base?.onFireExtinguished();
    Events.enemyHitEvent.addListener(onHit, EventTime.Immediate);
    Events.enemyDestroyedEvent.addListener(onDestroyed, EventTime.Immediate);
    Events.enemyDrownEvent.addListener(onDrown, EventTime.Immediate);
    Events.enemyAttackEvent.addListener(onAttack, EventTime.Immediate);
    Events.enemySpawnEvent.addListener(onSpawn, EventTime.Immediate);
    Events.jumpReactionEvent.addListener(onJumpReaction, EventTime.Immediate);
    Events.bossJumpEvent.addListener(onBossJump, EventTime.Immediate);
    Events.popBalloonsEvent.addListener(onPop, EventTime.Immediate);
    Events.bossAttackEffectEvent.addListener(onBossAttackEffect, EventTime.Immediate);
    Events.spawnGroupStartedEvent.addListener(onSpawnGroup as never, EventTime.Immediate);
    Events.gameOverEvent.addListener(onGameOver, EventTime.Immediate);
    Events.addBuffEvent.addListener(onBuffStart as never, EventTime.Immediate);
    Events.removeBuffEvent.addListener(onBuffEnd as never, EventTime.Immediate);
    Events.onFireExtinguished.addListener(onFireExtinguished as never, EventTime.Immediate);
    this.listeners.push(
      () => Events.enemyHitEvent.removeListener(onHit),
      () => Events.enemyDestroyedEvent.removeListener(onDestroyed),
      () => Events.enemyDrownEvent.removeListener(onDrown),
      () => Events.enemyAttackEvent.removeListener(onAttack),
      () => Events.enemySpawnEvent.removeListener(onSpawn),
      () => Events.jumpReactionEvent.removeListener(onJumpReaction),
      () => Events.bossJumpEvent.removeListener(onBossJump),
      () => Events.popBalloonsEvent.removeListener(onPop),
      () => Events.bossAttackEffectEvent.removeListener(onBossAttackEffect),
      () => Events.spawnGroupStartedEvent.removeListener(onSpawnGroup as never),
      () => Events.gameOverEvent.removeListener(onGameOver),
      () => Events.addBuffEvent.removeListener(onBuffStart as never),
      () => Events.removeBuffEvent.removeListener(onBuffEnd as never),
      () => Events.onFireExtinguished.removeListener(onFireExtinguished as never),
    );

    // Enemy particle effects (ParticleGroupEvent): own pool + the enemies-bundle emitters.
    if (o.scene !== undefined) {
      const pool = new EnemyParticles();
      pool.addTo(o.scene);
      this.particles = pool;
      const emitters = new Map<string, EnemyEmitter>();
      setEnemyEffects(new EnemyEffects(pool, emitters, ENEMY_VIEW_DATA.effects));
      fetch(o.emitterUrl ?? '/assets/particles-enemy/particles.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`enemy particles ${r.status}`))))
        .then((json: { emitters: EnemyEmitter[] }) => { for (const rec of json.emitters) emitters.set(rec.name, rec); })
        .catch((err) => { console.warn('enemy particle settings unavailable:', err); });
    }
    // StateDrown raycasts WaterMask (three space in/out; the sim physics world is UNITY space).
    setEnemyWaterProbe((x, y, z) => {
      try {
        const hit = getSimPhysics().raycast(-x, y, z, 0, -1, 0, 5, Q4Layers.waterMask, 'Ignore');
        return hit === null ? null : hit.point[1];
      } catch { return null; }
    });
  }

  private readonly views = new Set<EnemyStageView>();
  private particles: EnemyParticles | null = null;

  private showBar(enemy: GameCoreEnemy, view: EnemyStageView, info: EnemyHitInfo): void {
    const rec = ENEMY_VIEW_DATA.enemies[view.defName];
    const size = barSizeForEnemy(enemy.isBoss, rec?.m_healthBarSettings ?? null, enemy.getMaxLife());
    this.bars.show(enemy, view, { damage: info.damage, strong: info.strongToDamage }, size,
      (rec?.m_isIgnoreCriticalIcon ?? 0) !== 0, this.now);
  }

  /** Call once per frame (after the sim step). */
  update(dt: number, nowSec: number): void {
    this.now = nowSec;
    for (const v of this.views) if (v.root.parent === null) this.views.delete(v);
    this.particles?.update(dt);
    this.bars.update(dt, nowSec);
    this.overlay.render(this.bars.draw(nowSec), (v) => this.anchor(v));
  }

  /** Head position -> canvas reference units (y up from the screen centre) + the
   *  behind-camera life-gauge offset (EnemyBase.BehindLifeGaugeOffset, canvas px). */
  private anchor(v: EnemyStageView): { x: number; y: number } | null {
    const head = v.root.getObjectByName('Mask_Bn') ?? v.root.getObjectByName('mask_bn') ?? v.root;
    head.getWorldPosition(_p);
    _p.project(this.o.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    const rec = ENEMY_VIEW_DATA.enemies[v.defName];
    // CanvasToCameraPositionConvert.ConvertWorldSpacePositionToCanvasLocation: canvas-px offset = OffsetTopDown for every camera
    // except GameCameraBehind (OffsetBehind). NewHealthBar.OnPopulateMesh feeds EnemyBase.TopDownLifeGaugeOffset / BehindLifeGaugeOffset.
    // (We used the BEHIND offset always: 80 vs 50 px for a walker, 140 vs 90 for a giant -> the bar floated too high.)
    const behind = this.o.isBehindCamera?.() ?? false;
    const off = (behind ? rec?.m_behindLifeGaugeOffset : rec?.m_topDownLifeGaugeOffset) ?? { x: 0, y: behind ? 80 : 50, z: 0 };
    // canvas units (match width): x = ndc.x * 960; y = ndc.y * (960 / aspect) so the vertical scale follows the REAL window aspect
    const aspect = (this.o.camera as THREE.PerspectiveCamera).aspect || 16 / 9;
    return { x: _p.x * 960 + off.x, y: _p.y * (960 / aspect) + off.y };
  }

  setVisible(v: boolean): void { this.overlay.setVisible(v); }

  dispose(): void {
    for (const l of this.listeners) l();
    setEnemyEffects(null);
    setEnemyWaterProbe(null);
    if (this.particles !== null) { this.particles.dispose(); this.particles = null; }
    this.overlay.canvas.remove();
  }
}
