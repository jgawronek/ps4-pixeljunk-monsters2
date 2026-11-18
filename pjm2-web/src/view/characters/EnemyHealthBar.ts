// src/view/characters/EnemyHealthBar.ts
// Port of Q4.NewHealthBar (Unity UI Graphic, prefab in the globalsettings bundle):
// the original's ONLY enemy health display. A small sprite gauge floating above an
// enemy, shown only after the enemy has been hit (hit / destroyed events), never
// before. See docs/ENEMY_ANIMATION_AND_HEALTH_ANALYSIS.md for addresses.
//
//   Awake @003d7190           listens enemyHitEvent(Immediate) + enemyDestroyedEvent
//   OnEnemyHit @003d8830      ShowHealthBar only when hitInfo.damage > 0
//   OnEnemyDestroyed @003d8b70 ShowHealthBar (damage = hitInfo.damage)
//   ShowHealthBar @003d8870   per-enemy HealthBarData create / refresh
//   GetBarSizeForEnemy @003d8bc0  cover (bar size) selection
//   LateUpdate @003d7c30      show/hide fade + flicker timers
//   OnPopulateMesh @003d8020  draw: background, damage trail, HP, cover
//
// This module is pure (no DOM/three) so it is unit-testable; EnemyHealthBarOverlay.ts
// draws the produced quads.

import type { HealthBarConfig, HealthBarCoverSetting } from './enemyViewTypes';

/** Structural view of GameCoreEnemy used by the bar. */
export interface HealthBarEnemy {
  isDestroyed(): boolean;
  getLife(): number;
  getMaxLife(): number;
}

/** Hermite evaluation of a Unity AnimationCurve given [time,value,inSlope,outSlope] keys
 *  (the two serialized curves are 2-key ease curves with zero tangents). */
export function evalCurve(keys: number[][], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const dt = b[0] - a[0];
      const s = (t - a[0]) / dt;
      const s2 = s * s;
      const s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * dt * a[3]
        + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * dt * b[2];
    }
  }
  return last[1];
}

/** GetBarSizeForEnemy @003d8bc0, ported from the raw disassembly (all three threshold reads
 *  in the loop call get_MinThreshold @0048da20 — the original's quirk is preserved): returns
 *  the cover of the first setting whose min threshold is above every earlier min and below
 *  the enemy's max life; bosses always use cover 3; otherwise 0. */
export function barSizeForEnemy(isBoss: boolean, settings: HealthBarCoverSetting[] | null, maxLife: number): number {
  if (isBoss) return 3;
  if (!settings) return 0;
  let prevMax = 0;
  for (const s of settings) {
    const min = s.m_minThreshold;
    const runMax = prevMax <= min ? min : prevMax;
    if (prevMax < min && min < maxLife) return s.m_cover;
    prevMax = runMax;
  }
  return 0;
}

export interface HealthBarData<V> {
  enemy: HealthBarEnemy;
  viewer: V;
  barSize: number;
  damageHealth: number; // +0x2c
  degenStartTime: number; // +0x30
  showAlpha: number; // +0x34
  remainingCriticalDelay: number; // +0x38
  remainingDegenFlicker: number; // +0x3c
  isHiding: boolean; // +0x40
}

export interface ShowInfo {
  damage: number;
  /** hitInfo.strongToDamage (critical). */
  strong: boolean;
}

export interface HealthBarDrawItem<V> {
  data: HealthBarData<V>;
  /** show/hide curve value * spriteScale (the uniform bar scale). */
  scale: number;
  life: number;
  maxLife: number;
  /** damage-trail width factor ((lerp(damageHealth,0,t)+life)/maxLife), or null when not shown. */
  trail: number | null;
  /** flicker colour lerp factor 0..1 (white -> degenFlickerColor). */
  flicker: number;
}

export class EnemyHealthBars<V> {
  readonly items: HealthBarData<V>[] = [];

  constructor(
    private readonly cfg: HealthBarConfig,
    private readonly viewerGone: (v: V) => boolean,
  ) {}

  /** ShowHealthBar @003d8870. */
  show(enemy: HealthBarEnemy, viewer: V, info: ShowInfo, barSize: number, ignoreCritical: boolean, now: number): void {
    let d = this.items.find((x) => x.enemy === enemy) ?? null;
    if (d === null) {
      d = {
        enemy, viewer, barSize, damageHealth: 0, degenStartTime: 0, showAlpha: 0,
        remainingCriticalDelay: 0, remainingDegenFlicker: 0, isHiding: false,
      };
      if (info.strong && !ignoreCritical) d.remainingCriticalDelay = this.cfg.criticalHitShowDelay;
      this.items.push(d);
    }
    if (d.degenStartTime <= now) d.damageHealth = info.damage;
    else d.damageHealth += info.damage;
    d.degenStartTime = now + this.cfg.degenDisplayDelay + (1 - d.showAlpha) * this.cfg.showDuration;
    d.remainingDegenFlicker = this.cfg.degenFlickerCount;
  }

  /** LateUpdate @003d7c30. */
  update(dt: number, now: number): void {
    const showDur = Math.max(0.01, this.cfg.showDuration);
    const hideDur = Math.max(0.01, this.cfg.hideDuration);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      if (d.showAlpha >= 1 && !d.isHiding) {
        d.isHiding = this.viewerGone(d.viewer);
        if (!d.isHiding && d.enemy.isDestroyed()) {
          d.isHiding = d.degenStartTime + this.cfg.barDegenDurationInSeconds + this.cfg.deadEnemyHideDelayAfterDegen < now;
        }
      }
      if (!d.isHiding) {
        d.remainingCriticalDelay = Math.max(0, d.remainingCriticalDelay - dt);
        if (d.remainingCriticalDelay <= 0) d.showAlpha = Math.min(1, d.showAlpha + dt / showDur);
      } else {
        d.showAlpha = Math.max(0, d.showAlpha - dt / hideDur);
        if (d.showAlpha <= 0) this.items.splice(i, 1);
      }
      d.remainingDegenFlicker = Math.max(0, d.remainingDegenFlicker - dt * this.cfg.degenFlickerCountPerSecond);
    }
  }

  /** OnPopulateMesh @003d8020 (geometry decisions only). */
  draw(now: number): HealthBarDrawItem<V>[] {
    const out: HealthBarDrawItem<V>[] = [];
    for (const d of this.items) {
      const life = d.enemy.isDestroyed() ? 0 : d.enemy.getLife();
      const maxLife = d.enemy.getMaxLife();
      const curve = !d.isHiding
        ? evalCurve(this.cfg.showCurve, d.showAlpha)
        : evalCurve(this.cfg.hideCurve, 1 - d.showAlpha);
      const scale = curve * this.cfg.spriteScale;
      const t = (now - d.degenStartTime) / this.cfg.barDegenDurationInSeconds;
      let trail: number | null = null;
      if (t < 1) {
        const tc = Math.max(0, Math.min(1, t));
        trail = (d.damageHealth + (0 - d.damageHealth) * tc + life) / maxLife;
      }
      const flicker = Math.sin(Math.PI * d.remainingDegenFlicker * 2) * 0.5 + 0.5;
      out.push({ data: d, scale, life, maxLife, trail, flicker });
    }
    return out;
  }
}
