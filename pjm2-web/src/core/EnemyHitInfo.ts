// src/core/EnemyHitInfo.ts
// TypeScript port of decomp/src/GameCore/EnemyHitInfo.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; named .ctor @0x945160 —
// a thin wrapper, real body FUN_00945140).
// Payload describing a single hit on an enemy: who dealt it, how much, and how
// "strong" the damage/reaction is against this enemy's attributes.
// TS ADAPTATION: C# struct → class (porting conventions §structs).

import type { GameCoreEnemy } from './GameCoreEnemy';
import type { GameCoreObject } from './GameCoreObject';

const f = Math.fround;

export class EnemyHitInfo {
  damageSource: GameCoreObject | null; // 0x0
  toEnemy: GameCoreEnemy | null; // 0x8
  damage: number; // 0x10
  strongToDamage: boolean; // 0x14
  distanceToCenterRate: number; // 0x18
  reactionRate: number; // 0x1C
  strongReaction: boolean; // 0x20

  // .ctor @0x945160 (body FUN_00945140)
  constructor(
    by: GameCoreObject | null,
    to: GameCoreEnemy | null,
    aDmg: number,
    aStrong: boolean,
    aDis: number,
    aRct: number,
    aStrongReaction: boolean,
  ) {
    this.damageSource = by;
    this.toEnemy = to;
    this.damage = f(aDmg);
    this.strongToDamage = aStrong;
    this.distanceToCenterRate = f(aDis);
    this.reactionRate = f(aRct);
    this.strongReaction = aStrongReaction;
  }
}
