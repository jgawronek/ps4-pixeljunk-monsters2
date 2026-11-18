// src/core/interfaces.ts
// TypeScript ports of decomp/src/GameCore/{IBuffs,IGrabbable,ISpeedScale,
// IDamageable}.cs (metadata v23; interface slots documented per method).
//
// TS ADAPTATION — progressive typing: parameters/returns whose C# types are
// not yet ported (GameCoreTower, GameCoreEnemy, GameCorePlayer) use the
// GameCoreObject base for now; TIGHTEN each site when the class lands
// (marked // TIGHTEN). C# `out` params become small result objects.

import { Vector3 } from '../engine/math/Vector3';
import { BuffContainer } from './BuffContainer';
import { Cylinder } from './Cylinder';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { EEnemyClassTypeDef, EEnemyMoveTypeDef, EEnemyStrengthTypeDef } from './enums';
import type { GameCorePlayer } from './GameCorePlayer';

/** TypeDefIndex 3023 — objects that can carry timed buffs (enemy/player). */
export interface IBuffs {
  /** get_Buffs — interface slot 0. */
  readonly buffs: BuffContainer;
}

/** TypeDefIndex 3047 — pick-up/carry/throw sim objects (fruit). */
export interface IGrabbable {
  onGrab(player: GameCorePlayer): void; // slot 0 (TIGHTENED iter 12)
  onDrop(player: GameCorePlayer, a_force: Vector3): void; // slot 1 (TIGHTENED iter 12)
  throwWithForce(player: GameCorePlayer, force: Vector3): void; // slot 2 (TIGHTENED iter 12)
}

/** Objects whose movement speed can be scaled (Slow/Freeze/FastPlayer). */
export interface ISpeedScale {
  getSpeedScale(): number; // slot 0
  setSpeedScale(speed: number): void; // slot 1
}

/** TS ADAPTATION of C# `x as ISpeedScale` — interfaces have no runtime
 *  representation in JS, so the buff ports duck-type the two slot methods. */
export function asSpeedScale(obj: GameCoreObject | null): ISpeedScale | null {
  if (obj === null) return null;
  const c = obj as Partial<ISpeedScale>;
  return typeof c.getSpeedScale === 'function' && typeof c.setSpeedScale === 'function'
    ? (obj as unknown as ISpeedScale)
    : null;
}

/** TS ADAPTATION of C# `x as IBuffs` — presence check on the `buffs` member
 *  (getter on the prototype counts). NOTE: C# `as` succeeds for a player even
 *  when its Buffs container is null (ctor early-out); callers must keep the
 *  original `container != null` guards. */
export function asBuffs(obj: GameCoreObject | null): IBuffs | null {
  return obj !== null && 'buffs' in obj ? (obj as unknown as IBuffs) : null;
}

/** TS ADAPTATION of C# `(IDamageable)obj` / `as IDamageable` — duck-type the
 *  damage slots (enemies + attack points implement them). */
export function asDamageable(obj: GameCoreObject | null): IDamageable | null {
  if (obj === null) return null;
  const c = obj as Partial<IDamageable>;
  return typeof c.dealDamageTyped === 'function' && typeof c.validateTarget === 'function'
    ? (obj as unknown as IDamageable)
    : null;
}

/** Anything a tower/projectile can aim at and damage: the enemy body itself
 *  (GameCoreEnemy) and its attack points (GameCoreEnemyAttackPoint).
 *  TS ADAPTATION: C# explicit-interface methods Collision()/Position()/
 *  Handle() (slots 4/5/7) map to the inherited GameCoreObject properties —
 *  a TS class cannot share a name between a property and a method. */
export interface IDamageable {
  isAimableTarget(tower: GameCoreObject): boolean; // TIGHTEN → GameCoreTower; slot 0
  validateTarget(): boolean; // slot 1
  dealDamage(
    damageSource: GameCoreObject | null,
    damageToDeal: number,
    distanceToCenterRate: number,
    attackPoint: GameCoreObject | null,
    immediateDestroy?: boolean,
  ): void; // slot 2
  dealDamageTyped(
    strengthType: EEnemyStrengthTypeDef,
    classType: EEnemyClassTypeDef,
    damageToDeal: number,
    distanceToCenterRate: number,
    damageSource: GameCoreObject | null,
    attackPoint: GameCoreObject | null,
    immediateDestroy?: boolean,
  ): void; // slot 3
  readonly collision: Cylinder; // slot 4 (C# Collision())
  readonly position: Vector3; // slot 5 (C# Position())
  /** C# out-params → result object (TS adaptation). Slot 6. */
  predictPositionAndDirection(aTime: number): { pos: Vector3; direction: Vector3 };
  readonly handle: GameCoreHandle; // slot 7 (C# Handle())
  unityObject(): unknown | null; // slot 8 (C#: GameObject)
  moveType(): EEnemyMoveTypeDef; // slot 9
  host(): GameCoreObject | null; // TIGHTEN → GameCoreEnemy; slot 10
  valid(): boolean; // slot 11
}

/** Tower detection/attack volumes (EnemyDetectorSphere/Cone). C# overloads
 *  (object vs position) collapse into union params with instanceof dispatch. */
export interface IEnemyDetector {
  getOffset(): Vector3; // slot 0
  getAnchorV(): number; // slot 1
  inDetection(pos: Vector3, other: GameCoreObject | Vector3): boolean; // slots 2/3
  inAttack(pos: Vector3, other: GameCoreObject | Vector3): boolean; // slots 4/5
  getCollisionCylinder(): Cylinder; // slot 6
  getAffectCylinder(): Cylinder; // slot 7
  upgrade(scale: number, affectScale: number): void; // slot 8
  getRadiusScale(): number; // slot 9
}
