// src/view/projectiles/projectileContracts.ts
// Q4.Projectile* PREFAB contracts built from the serialized `props` bundle data
// (projectileData.generated.ts). One contract object per projectile prefab; the
// sim reads tuning from it (maxLifeDuration, gravity, bulletSpeed, ...) and picks
// its projectile CLASS from getGameCoreType() — which is exactly what the original
// `Q4.Projectile<T>.GetGameCoreType` does (T = the sim class).
//
//   Q4.ProjectileTrajectory  -> GameCoreProjectileTrajectory   tower_001/002/010
//   Q4.ProjectileInstant     -> GameCoreProjectileInstant       tower_007/011
//   Q4.ProjectileElectric    -> GameCoreProjectileElectric      tower_003
//   Q4.ProjectileBeam        -> GameCoreProjectileBeam          tower_012
//   Q4.ProjectileLightning   -> GameCoreProjectileLightning     tower_009
//   Q4.ProjectileGem         -> GameCoreProjectileGem           tower_005
//   Q4.ProjectileGaseous     -> GameCoreProjectileGaseous       tower_004/006   (ported; Burn/Freeze via buffSettings.ts)
//   Q4.ProjectileInsect      -> GameCoreProjectileInsect        tower_008       (ported from Ghidra pseudo-C)
// The last two keep the Trajectory STAND-IN (their own ballistic aim, see below) so
// those towers still deal damage; the divergence is documented in
// docs/PROJECTILE_ANALYSIS.md.

import type {
  BuffSettingContract,
  ProjectileViewContract,
} from '../q4-contracts';
import type { GameCoreProjectile } from '../../core/GameCoreProjectile';
import { GameCoreProjectileBeam } from '../../core/GameCoreProjectileBeam';
import { GameCoreProjectileElectric } from '../../core/GameCoreProjectileElectric';
import { GameCoreProjectileGaseous } from '../../core/GameCoreProjectileGaseous';
import { GameCoreProjectileGem } from '../../core/GameCoreProjectileGem';
import { GameCoreProjectileInsect } from '../../core/GameCoreProjectileInsect';
import { GameCoreProjectileInstant } from '../../core/GameCoreProjectileInstant';
import { GameCoreProjectileLightning } from '../../core/GameCoreProjectileLightning';
import { GameCoreProjectileTrajectory } from '../../core/GameCoreProjectileTrajectory';
import { createBuffSetting } from './buffSettings';
import { PROJECTILE_DATA } from './projectileData.generated';
import { ballisticFireDirection, type BallisticParams, type V3 } from './projectileMath';
import type { ProjectileData, ProjectilePrefabData } from './projectileTypes';

type SimCtor = ProjectileViewContract['getGameCoreType'] extends () => infer R ? R : never;

const SIM_CLASS: Record<string, SimCtor> = {
  ProjectileTrajectory: GameCoreProjectileTrajectory as unknown as SimCtor,
  ProjectileInstant: GameCoreProjectileInstant as unknown as SimCtor,
  ProjectileElectric: GameCoreProjectileElectric as unknown as SimCtor,
  ProjectileBeam: GameCoreProjectileBeam as unknown as SimCtor,
  ProjectileLightning: GameCoreProjectileLightning as unknown as SimCtor,
  ProjectileGem: GameCoreProjectileGem as unknown as SimCtor,
  // Ported from the Ghidra pseudo-C (no C# reconstruction upstream): flame / ice flow + ground cloud.
  ProjectileGaseous: GameCoreProjectileGaseous as unknown as SimCtor,
  // Hive bee: ported from the Ghidra pseudo-C (hover swirl, detect, standby, dive).
  ProjectileInsect: GameCoreProjectileInsect as unknown as SimCtor,
};

/** Fields serialized as numbers/bools on the prefab (Unity bool → 0/1). */
function num(d: ProjectilePrefabData, key: string, fallback: number): number {
  const v = d.fields[key];
  return typeof v === 'number' ? v : fallback;
}

/** C# field initializers (.ctor) used when the serialized value is absent:
 *  ProjectileTrajectory.ctor @0074d250: impactTime(+0x4C)=2.0, speedHorizontal(+0x50)=10.0, gravity(+0x54)=-10.0. */
export const TRAJECTORY_DEFAULTS = { impactTime: 2.0, speedHorizontal: 10.0, gravity: -10.0 } as const;

/** Default no-model renderer bounds (0.3 cube) — only used by stand-ins that
 *  have no mesh; the sim derives its Cylinder collision from it. */
const STANDIN_SIZE = 0.3;

export class ProjectilePrefabContract implements ProjectileViewContract {
  readonly prefabName: string;
  readonly data: ProjectilePrefabData;
  readonly className: string;

  constructor(
    data: ProjectilePrefabData,
    private readonly all: ProjectileData = PROJECTILE_DATA,
  ) {
    this.data = data;
    this.prefabName = data.name;
    this.className = data.class;
  }

  // ---- Q4.Projectile base (+0x18 maxLifeDuration) ----
  get maxLifeDuration(): number {
    return num(this.data, 'maxLifeDuration', 3.0);
  }

  // ---- ProjectileTrajectory / Gaseous tuning ----
  get fixedImpactTime(): boolean {
    return num(this.data, 'fixedImpactTime', 0) !== 0;
  }
  get impactTime(): number {
    return num(this.data, 'impactTime', TRAJECTORY_DEFAULTS.impactTime);
  }
  get speedHorizontal(): number {
    return num(this.data, 'speedHorizontal', TRAJECTORY_DEFAULTS.speedHorizontal);
  }
  get gravity(): number {
    return num(this.data, 'gravity', TRAJECTORY_DEFAULTS.gravity);
  }
  get traceTarget(): boolean {
    return num(this.data, 'traceTarget', 1) !== 0;
  }
  get invisibleStart(): number {
    return num(this.data, 'invisibleStart', 0);
  }
  get invisibleEnd(): number {
    return num(this.data, 'invisibleEnd', 0);
  }

  // ---- Instant / Electric (+0x48 / +0x50 bulletSpeed) ----
  get bulletSpeed(): number {
    return num(this.data, 'bulletSpeed', 10);
  }
  // ---- Beam ----
  get beamFlyLength(): number {
    return num(this.data, 'beamFlyLength', 0);
  }
  get speed(): number {
    return num(this.data, 'speed', 0);
  }
  get radius(): number {
    return num(this.data, 'radius', 0);
  }
  // ---- Lightning ----
  get initialAttackDelay(): number {
    return num(this.data, 'initialAttackDelay', 1);
  }
  get randomAttackTimeMin(): number {
    return num(this.data, 'randomAttackTimeMin', 0);
  }
  get randomAttackTimeMax(): number {
    return num(this.data, 'randomAttackTimeMax', 0.5);
  }
  // ---- Gem ----
  get expBoostPerSecond(): number {
    return num(this.data, 'expBoostPerSecond', 0);
  }
  get destroyDropGem(): number {
    return num(this.data, 'destroyDropGem', 0);
  }
  get towerSinkTimePerFragment(): number {
    return num(this.data, 'towerSinkTimePerFragment', 0);
  }
  get upgradeInterval(): number {
    return num(this.data, 'upgradeInterval', 0);
  }
  get gemDropDelay(): number {
    return num(this.data, 'gemDropDelay', 0);
  }
  get isGemProjectile(): boolean | undefined {
    return this.className === 'ProjectileGem' ? true : undefined;
  }
  // ---- ProjectileInsect (+0x48..+0x64) ----
  /** Present only on the hive prefab: switches the tower to the insect-swarm budget gate (TowerStateIdle). */
  get insectAmountMax(): number | undefined {
    return this.className === 'ProjectileInsect' ? num(this.data, 'insectAmountMax', 0) | 0 : undefined;
  }
  get flyInitAngleMin(): number {
    return num(this.data, 'flyInitAngleMin', 0);
  }
  get flyInitAngleMax(): number {
    return num(this.data, 'flyInitAngleMax', 0);
  }
  get flySpeed(): number {
    return num(this.data, 'flySpeed', 0);
  }
  get attackWaitDuration(): number {
    return num(this.data, 'attackWaitDuration', 0);
  }
  get onGroundHeight(): number {
    return num(this.data, 'onGroundHeight', 0);
  }
  get enemyDetectRange(): number {
    return num(this.data, 'enemyDetectRange', 0);
  }

  get ballistic(): BallisticParams {
    return {
      fixedImpactTime: this.className === 'ProjectileTrajectory' && this.fixedImpactTime,
      impactTime: this.impactTime,
      speedHorizontal: this.speedHorizontal,
      gravity: this.gravity,
    };
  }

  /** ProjectileInsect.attackFlySpeed (+0x58). */
  get attackFlySpeed(): number {
    return num(this.data, 'attackFlySpeed', 25);
  }

  /** Q4.Projectile<T>.GetGameCoreType (slot 4). */
  getGameCoreType(): SimCtor {
    const t = SIM_CLASS[this.className];
    if (t === undefined) throw new Error(`projectile ${this.prefabName}: unknown class ${this.className}`);
    return t;
  }

  /** Slot 10 GetFireDirection(from, to, extra) -> initial velocity.
   *  Trajectory/Gaseous: ballistic solution (projectileMath.ts). Instant/Insect:
   *  normalized (to + extra - from) (Q4.ProjectileInstant @0074bc50). */
  getFireDirection(from: V3, to: V3, extra: V3): V3 {
    switch (this.className) {
      case 'ProjectileTrajectory':
      case 'ProjectileGaseous':
        return ballisticFireDirection(from, to, extra, this.ballistic);
      default: {
        const d = { x: to.x + extra.x - from.x, y: to.y + extra.y - from.y, z: to.z + extra.z - from.z };
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        return { x: d.x / l, y: d.y / l, z: d.z / l };
      }
    }
  }

  /** Visible mesh model name (PrefabLoader.prefabList entry that is a mesh), or null. */
  get modelName(): string | null {
    for (const n of this.data.prefabList) if (this.all.models[n] !== undefined) return n;
    return null;
  }

  /** Q4.Projectile.GetComponentInChildren<Renderer>().bounds (LOD0 mesh AABB at the
   *  spawn pose: identity rotation, scale 1). Models have real bounds; mesh-less
   *  prefabs get the 0.3 cube stand-in (only Trajectory-class sims read this). */
  getComponentInChildrenRenderer(): { bounds: { size: V3; extents: V3 } } {
    const m = this.modelName !== null ? this.all.models[this.modelName] : undefined;
    const s = m !== undefined ? m.bounds.size : [STANDIN_SIZE, STANDIN_SIZE, STANDIN_SIZE];
    return {
      bounds: {
        size: { x: s[0], y: s[1], z: s[2] },
        extents: { x: s[0] / 2, y: s[1] / 2, z: s[2] / 2 },
      },
    };
  }

  // ---- ProjectileGaseous (+0x48..+0x80) ----
  get affectPlayer(): boolean {
    return num(this.data, 'affectPlayer', 0) !== 0;
  }
  get affectToPlayerRadius(): number {
    return num(this.data, 'affectToPlayerRadius', 0);
  }
  get flowLengthMax(): number {
    return num(this.data, 'flowLengthMax', 0);
  }
  get affectDuration(): number {
    return num(this.data, 'affectDuration', 0);
  }
  get furthestAffectRangeRate(): number {
    return num(this.data, 'furthestAffectRangeRate', 1);
  }

  private buffSettings: BuffSettingContract[] | null = null;
  /** BuffSetting components on the prefab (flame -> BuffSettingBurn, ice -> BuffSettingFreeze). */
  getComponentsBuffSetting(): BuffSettingContract[] {
    if (this.buffSettings === null) {
      this.buffSettings = [];
      for (const c of this.data.components) {
        const s = createBuffSetting(c);
        if (s !== null) this.buffSettings.push(s);
      }
    }
    return this.buffSettings;
  }

  /** Stand-ins/units with no viewer-only hooks: setupEstimateTime & co are provided by instances. */
  setupEstimateTime?(proj: GameCoreProjectile, predictedPos?: V3): void;
}

const CONTRACTS = new Map<string, ProjectilePrefabContract>();

/** Prefab contract by projectile prefab name (bullet_001, arrow, ...). */
export function projectileContract(name: string): ProjectilePrefabContract | null {
  let c = CONTRACTS.get(name);
  if (c === undefined) {
    const d = PROJECTILE_DATA.projectiles[name];
    if (d === undefined) return null;
    c = new ProjectilePrefabContract(d);
    CONTRACTS.set(name, c);
  }
  return c;
}

/** TowerBase.projectile for a production tower (tower_001..012), or null. */
export function projectileContractForTower(towerName: string): ProjectilePrefabContract | null {
  const t = PROJECTILE_DATA.towers[towerName];
  return t === undefined ? null : projectileContract(t.projectile);
}
