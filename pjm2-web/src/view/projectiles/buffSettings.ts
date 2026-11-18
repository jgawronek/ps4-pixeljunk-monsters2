// src/view/projectiles/buffSettings.ts
// Q4.BuffSetting / BuffSettingBurn / BuffSettingFreeze (TypeDefIndex 2669 / 2672 / 2675), ported from the Ghidra
// pseudo-C (decomp/decompiled/Q4.BuffSetting.c, Q4.BuffSettingBurn.c, Q4.BuffSettingFreeze.c; RVAs 0x7349F0,
// 0x734A90, 0x736350, 0x737910). They are MonoBehaviours on the projectile prefabs (flame_bullet -> Burn,
// ice_bullet -> Freeze): the sim projectile (GameCoreProjectileGaseous.OnHit) calls AddBuff on every one.
//
//   AddBuff(source, target, override)            @0x7349F0  duration = target is GameCorePlayer ? playerDuration(+0x24)
//                                                           : enemyDuration(+0x20) -> InternalAddBuff
//   IsEnemyOfBuffType(damageable, filter)        @0x734A90  EBuffAffectTarget mask test (see isEnemyOfBuffType)
//   BuffSettingBurn.InternalAddBuff              @0x736350  existing BuffBurn from the same source projectile -> ResetTimer;
//                                                           else new BuffBurn(duration, source.attackDamagePerSecond,
//                                                           source.handle, executionFrequency(+0x30)); addBuffEvent;
//                                                           player target -> explosionDamageEvent(target, pos, 0.5)
//   BuffSettingFreeze.InternalAddBuff            @0x737910  same dedupe (BuffFreeze), duration/speedScale overridable by a
//                                                           BuffSettingOverrideFreeze (tower upgrade); Gaseous source ->
//                                                           single-target BuffFreeze(duration, attackDamagePerSecond,
//                                                           speedScaleEnemy(+0x34), speedScalePlayer(+0x38), source.handle)
// Serialized values (props bundle, projectileData.generated.ts):
//   flame_bullet BuffSettingBurn   triggerTarget 5 affectTarget -2 enemyDuration 0.0 playerDuration 2.0 frequency 0.067
//   ice_bullet   BuffSettingFreeze triggerTarget 5 affectTarget -1 enemyDuration 0.5 playerDuration 1.0 scales 0.5/0.5
// NOT ported (no shipped prefab path reaches it from a tower): the non-projectile "spread" branch of
// BuffSettingFreeze (spreadIfNotFromProjectile 1.5, used by the ice FRUIT) and BuffSetting.GetAllInRange.

import type { BuffSettingContract } from '../q4-contracts';
import { Buff } from '../../core/Buff';
import { BuffBurn } from '../../core/BuffBurn';
import { BuffFreeze } from '../../core/BuffFreeze';
import { BuffSettingOverrideFreeze, type IBuffSettingOverride } from '../../core/BuffSettingOverrideFreeze';
import { EEnemyMoveTypeDef } from '../../core/enums';
import { Events } from '../../core/Events';
import { GameCoreEnemy } from '../../core/GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from '../../core/GameCoreEnemyAttackPoint';
import { GameCoreHandle } from '../../core/GameCoreHandle';
import type { GameCoreObject } from '../../core/GameCoreObject';
import { GameCorePlayer } from '../../core/GameCorePlayer';
import { GameCoreProjectileGaseous } from '../../core/GameCoreProjectileGaseous';
import { asDamageable, type IBuffs, type IDamageable } from '../../core/interfaces';

const f = Math.fround;

/** EBuffAffectTarget flags (dump.cs). */
export const EBuffAffectTarget = {
  Player: 1, EnemyGround: 2, EnemyFly: 4, EnemyBalloon: 8, EnemyFire: 16, EnemyAntiMagic: 32, EnemyAntiPhysics: 64,
} as const;

/** Q4.BuffSetting.IsEnemyOfBuffType @0x734A90. */
export function isEnemyOfBuffType(damageable: IDamageable, filter: number): boolean {
  const host = damageable.host() as GameCoreEnemy | null;
  const mt = damageable.moveType();
  // FAITHFUL: the binary tests the air bit twice (bits 4 and 8) against the same IDamageable.MoveType slot.
  if ((filter & EBuffAffectTarget.EnemyGround) === 0 && mt === EEnemyMoveTypeDef.ground) return false;
  if ((filter & EBuffAffectTarget.EnemyFly) === 0 && mt === EEnemyMoveTypeDef.air) return false;
  if ((filter & EBuffAffectTarget.EnemyBalloon) === 0 && mt === EEnemyMoveTypeDef.air) return false;
  if (host === null) return true;
  if ((filter & EBuffAffectTarget.EnemyFire) === 0 && host.isOnFire) return false;
  if ((filter & EBuffAffectTarget.EnemyAntiMagic) === 0 && host.isAntiMagic) return false;
  if ((filter & EBuffAffectTarget.EnemyAntiPhysics) === 0) return !host.isAntiPhysics;
  return true;
}

export interface BuffSettingData {
  triggerTarget: number; // +0x18
  affectTarget: number; // +0x1C
  enemyDuration: number; // +0x20
  playerDuration: number; // +0x24
}

abstract class BuffSettingBase implements BuffSettingContract {
  readonly triggerTarget: number;
  readonly affectTarget: number;
  readonly enemyDuration: number;
  readonly playerDuration: number;
  constructor(d: BuffSettingData) {
    this.triggerTarget = d.triggerTarget | 0;
    this.affectTarget = d.affectTarget | 0;
    this.enemyDuration = f(d.enemyDuration);
    this.playerDuration = f(d.playerDuration);
  }

  /** BuffSetting.AddBuff @0x7349F0 */
  addBuff(source: GameCoreObject, target: GameCoreObject, buffOverride: unknown): void {
    const duration = target instanceof GameCorePlayer ? this.playerDuration : this.enemyDuration;
    this.internalAddBuff(source, target, duration, (buffOverride ?? null) as IBuffSettingOverride | null);
  }

  protected abstract internalAddBuff(
    source: GameCoreObject | null,
    target: GameCoreObject,
    duration: number,
    buffOverride: IBuffSettingOverride | null,
  ): void;

  /** The IBuffs owner of a hit target (enemy attack points resolve to their host enemy). */
  protected buffsOwner(target: GameCoreObject): (GameCoreObject & IBuffs) | null {
    const direct = target as unknown as Partial<IBuffs>;
    if (direct.buffs !== undefined) return target as unknown as GameCoreObject & IBuffs;
    if (target instanceof GameCoreEnemyAttackPoint) {
      const host = target.getHostEnemy();
      return host as unknown as (GameCoreObject & IBuffs) | null;
    }
    return null;
  }

  protected passesFilter(target: GameCoreObject): boolean {
    const d = asDamageable(target);
    return d === null || isEnemyOfBuffType(d, this.affectTarget);
  }
}

/** Q4.BuffSettingBurn */
export class BuffSettingBurn extends BuffSettingBase {
  readonly executionFrequency: number; // +0x30 (ctor default 0.25)
  constructor(d: BuffSettingData & { executionFrequency?: number }) {
    super(d);
    this.executionFrequency = f(d.executionFrequency ?? 0.25);
  }

  protected internalAddBuff(source: GameCoreObject | null, target: GameCoreObject, duration: number): void {
    if (!this.passesFilter(target)) return;
    const owner = this.buffsOwner(target);
    if (owner === null) return;
    const container = owner.buffs;
    const sourceHandle = source !== null ? source.handle : GameCoreHandle.nullHandle;
    const buffs = container.getAllBuffs();
    if (source !== null) {
      for (const b of buffs) {
        if (b instanceof BuffBurn && b.sourceProjectile.equals(sourceHandle)) {
          b.resetTimer(duration);
          return;
        }
      }
    }
    const gaseous = source instanceof GameCoreProjectileGaseous ? source : null;
    const burn = new BuffBurn(duration, gaseous !== null ? gaseous.attackDamagePerSecond : 0, sourceHandle, this.executionFrequency);
    container.addBuff(burn, target);
    Events.addBuffEvent.invoke(target, this as never);
    if (target instanceof GameCorePlayer) {
      const at = (gaseous ?? target) as GameCoreObject;
      Events.explosionDamageEvent.invoke(target, at.position, f(0.5));
    }
  }
}

/** Q4.BuffSettingFreeze */
export class BuffSettingFreeze extends BuffSettingBase {
  readonly spreadIfNotFromProjectile: number; // +0x30
  readonly speedScaleEnemy: number; // +0x34
  readonly speedScalePlayer: number; // +0x38
  constructor(d: BuffSettingData & { spreadIfNotFromProjectile?: number; speedScaleEnemy?: number; speedScalePlayer?: number }) {
    super(d);
    this.spreadIfNotFromProjectile = f(d.spreadIfNotFromProjectile ?? 0);
    this.speedScaleEnemy = f(d.speedScaleEnemy ?? 0.5);
    this.speedScalePlayer = f(d.speedScalePlayer ?? 0.5);
  }

  protected internalAddBuff(source: GameCoreObject | null, target: GameCoreObject, duration: number, ov: IBuffSettingOverride | null): void {
    const owner = this.buffsOwner(target);
    if (owner === null) return;
    const container = owner.buffs;
    const freezeOv = ov instanceof BuffSettingOverrideFreeze ? ov : null;
    const sourceHandle = source !== null ? source.handle : GameCoreHandle.nullHandle;
    if (source !== null) {
      for (const b of container.getAllBuffs()) {
        if (b instanceof BuffFreeze && b.sourceProjectile.equals(sourceHandle)) {
          b.resetTimer(freezeOv !== null ? freezeOv.duration : duration);
          return;
        }
      }
    }
    if (source instanceof GameCoreProjectileGaseous) {
      const freeze = new BuffFreeze(
        freezeOv !== null ? freezeOv.duration : duration,
        source.attackDamagePerSecond,
        freezeOv !== null ? freezeOv.speedScale : this.speedScaleEnemy,
        this.speedScalePlayer,
        sourceHandle,
      );
      container.addBuff(freeze as Buff, target);
      Events.addBuffEvent.invoke(target, this as never);
    }
    // else: the ice-fruit spread branch (not reachable from a tower projectile; see header).
  }
}

/** Factory from the extracted component record ({class, fields}) of a projectile prefab. */
export function createBuffSetting(c: { class: string; fields: Record<string, number | string | null | boolean> }): BuffSettingContract | null {
  const n = (k: string, d = 0): number => (typeof c.fields[k] === 'number' ? (c.fields[k] as number) : d);
  const base: BuffSettingData = {
    triggerTarget: n('triggerTarget'), affectTarget: n('affectTarget'),
    enemyDuration: n('enemyDuration'), playerDuration: n('playerDuration'),
  };
  switch (c.class) {
    case 'BuffSettingBurn':
      return new BuffSettingBurn({ ...base, executionFrequency: n('executionFrequency', 0.25) });
    case 'BuffSettingFreeze':
      return new BuffSettingFreeze({
        ...base,
        spreadIfNotFromProjectile: n('spreadIfNotFromProjectile'),
        speedScaleEnemy: n('speedScaleEnemy', 0.5),
        speedScalePlayer: n('speedScalePlayer', 0.5),
      });
    default:
      return null;
  }
}
