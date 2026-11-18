// src/core/DamageHelper.ts
// TypeScript port of decomp/src/GameCore/DamageHelper.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; static damage/reaction math,
// RVA 0x93D4C0..0x9443E0).
//
// Enemies carry per-strength and per-class damage tables (Q4.EnemyAttributes-
// Settings on the view). Each entry has a damageTime and reactionTime
// multiplier; "strong" means the multiplier > 1. All default multipliers
// resolve to 1.0 in the binary.
//
// TS ADAPTATIONS (documented):
//  - C# overload sets (table / target / settings) collapse into single methods
//    with runtime dispatch: Array.isArray → table overload, instanceof
//    GameCoreObject → target overload, otherwise settings (or null).
//    TypeScript overload signatures keep every C# calling shape.
//  - `Q4.GameCoreBridge.Instance.GetUnityObject(handle).GetComponent<
//    EnemyAttributesSettings>()` → handle.getUnityObject() through the viewer
//    resolver, narrowed to EnemyViewContract.
//  - GetEnemyOnHitSound @0x9443E0 is NOT ported yet: it is pure presentation
//    (AudioClip selection via EnemyBase/TowerBase/GlobalSounds) and lands with
//    the audio contracts + EnemyHitInfo consumers (Phase 4 audio iteration).
//  - C# keeps both spellings ReactionStrongToEnemybyClass (table overload,
//    lowercase 'b') and ReactionStrongToEnemyByClass (target overload) —
//    faithfully preserved.

import { Mathf } from '../engine/math';
import type {
  ClassDamageInfo,
  EnemyAttributesSettingsContract,
  EnemyViewContract,
  StrengthDamageInfo,
} from '../view/q4-contracts';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import { GameCoreObject } from './GameCoreObject';

const f = Math.fround;

export class DamageHelper {
  /** C# static class — not instantiable. */
  private constructor() {}

  /** Shared helper for the target overloads: C# bridge GetUnityObject(handle)
   *  + GetComponent<EnemyAttributesSettings>(). */
  private static attributesOf(
    target: GameCoreObject,
  ): EnemyAttributesSettingsContract | null {
    const view = target.getUnityObject() as EnemyViewContract | null;
    if (view === null) return null;
    return view.getComponentEnemyAttributesSettings();
  }

  // StrongDamageStrengthTypes @0x9423A0 — strength types this enemy takes >1x
  // damage from. TS ADAPTATION: C# takes the enemy GameObject; here the viewer
  // contract (resolved via the handle's viewer resolver by the caller).
  static strongDamageStrengthTypes(
    enemyView: EnemyViewContract,
  ): EEnemyStrengthTypeDef[] {
    const result: EEnemyStrengthTypeDef[] = [];
    // FAITHFUL: C# dereferences GetComponent result without a null check.
    const attrs = enemyView.getComponentEnemyAttributesSettings()!;
    for (const info of attrs.strengthDamageInfos) {
      if (info.damageTime > 1.0) result.push(info.strength);
    }
    return result;
  }

  // StrongDamageClassTypes @0x9425E0
  static strongDamageClassTypes(enemyView: EnemyViewContract): EEnemyClassTypeDef[] {
    const result: EEnemyClassTypeDef[] = [];
    const attrs = enemyView.getComponentEnemyAttributesSettings()!;
    for (const info of attrs.classDamageInfos) {
      if (info.damageTime > 1.0) result.push(info.classType);
    }
    return result;
  }

  // WeakDamageStrengthTypes @0x942820 — strength types this enemy takes <1x
  // damage from.
  static weakDamageStrengthTypes(
    enemyView: EnemyViewContract,
  ): EEnemyStrengthTypeDef[] {
    const result: EEnemyStrengthTypeDef[] = [];
    const attrs = enemyView.getComponentEnemyAttributesSettings()!;
    for (const info of attrs.strengthDamageInfos) {
      if (info.damageTime < 1.0) result.push(info.strength);
    }
    return result;
  }

  // WeakDamageClassTypes @0x942A60
  static weakDamageClassTypes(enemyView: EnemyViewContract): EEnemyClassTypeDef[] {
    const result: EEnemyClassTypeDef[] = [];
    const attrs = enemyView.getComponentEnemyAttributesSettings()!;
    for (const info of attrs.classDamageInfos) {
      if (info.damageTime < 1.0) result.push(info.classType);
    }
    return result;
  }

  // DamageRateByStrength @0x942CA0 (table) / @0x942E30 (target) — damageTime
  // for the matching strength, default 1.0.
  static damageRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    strenthTable: StrengthDamageInfo[] | null, // [sic — original param spelling]
  ): number;
  static damageRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    target: GameCoreObject | null,
  ): number;
  static damageRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    second: StrengthDamageInfo[] | GameCoreObject | null,
  ): number {
    if (second === null) return f(1.0);
    if (Array.isArray(second)) {
      let rate = f(1.0);
      for (const info of second) {
        if (info.strength === towerStrength) {
          rate = f(info.damageTime);
          break;
        }
      }
      return rate;
    }
    const attrs = DamageHelper.attributesOf(second);
    if (attrs === null) return f(1.0);
    return DamageHelper.damageRateByStrength(towerStrength, attrs.strengthDamageInfos);
  }

  // DamageRateByClass @0x942FA0 (table) / @0x943130 (target)
  static damageRateByClass(
    towerClass: EEnemyClassTypeDef,
    classTable: ClassDamageInfo[] | null,
  ): number;
  static damageRateByClass(
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
  ): number;
  static damageRateByClass(
    towerClass: EEnemyClassTypeDef,
    second: ClassDamageInfo[] | GameCoreObject | null,
  ): number {
    if (second === null) return f(1.0);
    if (Array.isArray(second)) {
      let rate = f(1.0);
      for (const info of second) {
        if (info.classType === towerClass) {
          rate = f(info.damageTime);
          break;
        }
      }
      return rate;
    }
    const attrs = DamageHelper.attributesOf(second);
    if (attrs === null) return f(1.0);
    return DamageHelper.damageRateByClass(towerClass, attrs.classDamageInfos);
  }

  // DamageRateByAttributes @0x9432A0 (settings) / @0x943350 (tables) /
  // @0x943390 (target)
  static damageRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    attributes: EnemyAttributesSettingsContract | null,
  ): number;
  static damageRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    strenthTable: StrengthDamageInfo[] | null, // [sic]
    classTable: ClassDamageInfo[] | null,
  ): number;
  static damageRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
  ): number;
  static damageRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    third: EnemyAttributesSettingsContract | StrengthDamageInfo[] | GameCoreObject | null,
    fourth?: ClassDamageInfo[] | null,
  ): number {
    if (third === null) return f(1.0); // settings overload, null attrs
    if (Array.isArray(third)) {
      return f(
        DamageHelper.damageRateByStrength(towerStrength, third) *
          DamageHelper.damageRateByClass(towerClass, fourth ?? null),
      );
    }
    if (third instanceof GameCoreObject) {
      return f(
        DamageHelper.damageRateByStrength(towerStrength, third) *
          DamageHelper.damageRateByClass(towerClass, third),
      );
    }
    return f(
      DamageHelper.damageRateByStrength(towerStrength, third.strengthDamageInfos) *
        DamageHelper.damageRateByClass(towerClass, third.classDamageInfos),
    );
  }

  // DamageByStrength @0x9433D0 (table) / @0x9433F0 (target)
  static damageByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    strengthInfos: StrengthDamageInfo[] | null,
    damage: number,
  ): number;
  static damageByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    target: GameCoreObject | null,
    damage: number,
  ): number;
  static damageByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    second: StrengthDamageInfo[] | GameCoreObject | null,
    damage: number,
  ): number {
    return f(DamageHelper.damageRateByStrength(towerStrength, second as never) * damage);
  }

  // DamageByClass @0x943410 (table) / @0x943430 (target)
  static damageByClass(
    towerClass: EEnemyClassTypeDef,
    classInfos: ClassDamageInfo[] | null,
    damage: number,
  ): number;
  static damageByClass(
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
    damage: number,
  ): number;
  static damageByClass(
    towerClass: EEnemyClassTypeDef,
    second: ClassDamageInfo[] | GameCoreObject | null,
    damage: number,
  ): number {
    return f(DamageHelper.damageRateByClass(towerClass, second as never) * damage);
  }

  // DamageByAttributes @0x943450 (settings) / @0x943500 (tables) /
  // @0x93D4C0 (target)
  static damageByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    settings: EnemyAttributesSettingsContract | null,
    damage: number,
  ): number;
  static damageByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    strengthTable: StrengthDamageInfo[] | null,
    classTable: ClassDamageInfo[] | null,
    damage: number,
  ): number;
  static damageByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
    damage: number,
  ): number;
  static damageByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    third: EnemyAttributesSettingsContract | StrengthDamageInfo[] | GameCoreObject | null,
    fourth: ClassDamageInfo[] | number | null,
    fifth?: number,
  ): number {
    // C# guards: settings==null / target==null return damage unchanged
    // (damage is the 4th argument in both of those overloads).
    if (third === null) return fourth as number;
    if (Array.isArray(third)) {
      // tables overload: damage arg is `fourth` as ClassDamageInfo[]… but the
      // C# tables overload takes (sTable, cTable, damage) — dispatch on arity.
      const classTable = fourth as ClassDamageInfo[] | null;
      const dmg = fifth!;
      return f(
        DamageHelper.damageRateByStrength(towerStrength, third) *
          DamageHelper.damageRateByClass(towerClass, classTable) *
          dmg,
      );
    }
    if (third instanceof GameCoreObject) {
      const dmg = fourth as number;
      return f(
        DamageHelper.damageRateByStrength(towerStrength, third) *
          DamageHelper.damageRateByClass(towerClass, third) *
          dmg,
      );
    }
    // settings overload: rateS(table) * rateC(table) * damage
    const dmg = fourth as number;
    return f(
      DamageHelper.damageRateByStrength(towerStrength, third.strengthDamageInfos) *
        DamageHelper.damageRateByClass(towerClass, third.classDamageInfos) *
        dmg,
    );
  }

  // DamageStrongToEnemyByClass @0x943540 (table) / @0x943560 (target)
  static damageStrongToEnemyByClass(
    towerClass: EEnemyClassTypeDef,
    second: ClassDamageInfo[] | GameCoreObject | null,
  ): boolean {
    return DamageHelper.damageRateByClass(towerClass, second as never) > 1.0;
  }

  // ReactionStrongToEnemybyClass @0x943580 (table overload) — note original
  // lowercase 'b'. [sic — faithful spelling]
  static reactionStrongToEnemybyClass(
    towerClass: EEnemyClassTypeDef,
    classInfos: ClassDamageInfo[] | null,
  ): boolean {
    return DamageHelper.reactionRateByClass(towerClass, classInfos) > 1.0;
  }

  // ReactionStrongToEnemyByClass @0x943730 (target overload)
  static reactionStrongToEnemyByClass(
    towerClass: EEnemyClassTypeDef,
    to: GameCoreObject | null,
  ): boolean {
    return DamageHelper.reactionRateByClass(towerClass, to) > 1.0;
  }

  // DamageStrongToEnemyByStrength @0x9438C0 (table) / @0x9438E0 (target)
  static damageStrongToEnemyByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    second: StrengthDamageInfo[] | GameCoreObject | null,
  ): boolean {
    return DamageHelper.damageRateByStrength(towerStrength, second as never) > 1.0;
  }

  // ReactionStrongToEnemyByStrength @0x943900 (table) / @0x943AB0 (target)
  static reactionStrongToEnemyByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    second: StrengthDamageInfo[] | GameCoreObject | null,
  ): boolean {
    return DamageHelper.reactionRateByStrength(towerStrength, second as never) > 1.0;
  }

  // DamageStrongToEnemy @0x943C40 (tables) / @0x943E30 (target)
  // True when this strength+class combo yields the maximum damage multiplier
  // present in the enemy's tables (i.e. no other combo hits harder).
  static damageStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    strengthInfos: StrengthDamageInfo[],
    classInfos: ClassDamageInfo[],
  ): boolean;
  static damageStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    to: GameCoreObject | null,
  ): boolean;
  static damageStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    third: StrengthDamageInfo[] | GameCoreObject | null,
    fourth?: ClassDamageInfo[],
  ): boolean {
    if (third === null) return false;
    if (!Array.isArray(third)) {
      const attrs = DamageHelper.attributesOf(third);
      if (attrs === null) return false;
      return DamageHelper.damageStrongToEnemy(
        towerStrength,
        towerClass,
        attrs.strengthDamageInfos,
        attrs.classDamageInfos,
      );
    }
    const strengthInfos = third;
    const classInfos = fourth ?? [];
    const rate = f(
      DamageHelper.damageRateByStrength(towerStrength, strengthInfos) *
        DamageHelper.damageRateByClass(towerClass, classInfos),
    );
    let max = f(0.0);
    for (let i = 0; i < strengthInfos.length; i++) {
      for (let j = 0; j < classInfos.length; j++) {
        max = Mathf.Max(f(strengthInfos[i].damageTime * classInfos[j].damageTime), max);
      }
    }
    return max <= rate;
  }

  // ReactionStrongToEnemy @0x943F70 (tables) / @0x9441A0 (target)
  static reactionStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    strengthInfos: StrengthDamageInfo[],
    classInfos: ClassDamageInfo[],
  ): boolean;
  static reactionStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    to: GameCoreObject | null,
  ): boolean;
  static reactionStrongToEnemy(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    third: StrengthDamageInfo[] | GameCoreObject | null,
    fourth?: ClassDamageInfo[],
  ): boolean {
    if (third === null) return false;
    if (!Array.isArray(third)) {
      const attrs = DamageHelper.attributesOf(third);
      if (attrs === null) return false;
      return DamageHelper.reactionStrongToEnemy(
        towerStrength,
        towerClass,
        attrs.strengthDamageInfos,
        attrs.classDamageInfos,
      );
    }
    const strengthInfos = third;
    const classInfos = fourth ?? [];
    const rate = f(
      DamageHelper.reactionRateByStrength(towerStrength, strengthInfos) *
        DamageHelper.reactionRateByClass(towerClass, classInfos),
    );
    let max = f(0.0);
    for (let i = 0; i < strengthInfos.length; i++) {
      for (let j = 0; j < classInfos.length; j++) {
        max = Mathf.Max(f(strengthInfos[i].reactionTime * classInfos[j].reactionTime), max);
      }
    }
    return max <= rate;
  }

  // ReactionRateByStrength @0x943920 (table) / @0x943AD0 (target) —
  // reactionTime for the matching strength, default 1.0.
  static reactionRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    strengthInfos: StrengthDamageInfo[] | null,
  ): number;
  static reactionRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    target: GameCoreObject | null,
  ): number;
  static reactionRateByStrength(
    towerStrength: EEnemyStrengthTypeDef,
    second: StrengthDamageInfo[] | GameCoreObject | null,
  ): number {
    if (second === null) return f(1.0);
    if (Array.isArray(second)) {
      let rate = f(1.0);
      for (const info of second) {
        if (info.strength === towerStrength) {
          rate = f(info.reactionTime);
          break;
        }
      }
      return rate;
    }
    const attrs = DamageHelper.attributesOf(second);
    if (attrs === null) return f(1.0);
    return DamageHelper.reactionRateByStrength(towerStrength, attrs.strengthDamageInfos);
  }

  // ReactionRateByClass @0x9435A0 (table) / @0x943750 (target)
  static reactionRateByClass(
    towerClass: EEnemyClassTypeDef,
    classInfos: ClassDamageInfo[] | null,
  ): number;
  static reactionRateByClass(
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
  ): number;
  static reactionRateByClass(
    towerClass: EEnemyClassTypeDef,
    second: ClassDamageInfo[] | GameCoreObject | null,
  ): number {
    if (second === null) return f(1.0);
    if (Array.isArray(second)) {
      let rate = f(1.0);
      for (const info of second) {
        if (info.classType === towerClass) {
          rate = f(info.reactionTime);
          break;
        }
      }
      return rate;
    }
    const attrs = DamageHelper.attributesOf(second);
    if (attrs === null) return f(1.0);
    return DamageHelper.reactionRateByClass(towerClass, attrs.classDamageInfos);
  }

  // ReactionRateByAttributes @0x944160 (tables) / @0x9442E0 (settings) /
  // @0x944390 (target)
  static reactionRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    strengthTable: StrengthDamageInfo[] | null,
    classTable: ClassDamageInfo[] | null,
  ): number;
  static reactionRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    attributes: EnemyAttributesSettingsContract | null,
  ): number;
  static reactionRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    target: GameCoreObject | null,
  ): number;
  static reactionRateByAttributes(
    towerStrength: EEnemyStrengthTypeDef,
    towerClass: EEnemyClassTypeDef,
    third: EnemyAttributesSettingsContract | StrengthDamageInfo[] | GameCoreObject | null,
    fourth?: ClassDamageInfo[] | null,
  ): number {
    if (third === null) return f(1.0);
    if (Array.isArray(third)) {
      return f(
        DamageHelper.reactionRateByStrength(towerStrength, third) *
          DamageHelper.reactionRateByClass(towerClass, fourth ?? null),
      );
    }
    if (third instanceof GameCoreObject) {
      return f(
        DamageHelper.reactionRateByStrength(towerStrength, third) *
          DamageHelper.reactionRateByClass(towerClass, third),
      );
    }
    return f(
      DamageHelper.reactionRateByStrength(towerStrength, third.strengthDamageInfos) *
        DamageHelper.reactionRateByClass(towerClass, third.classDamageInfos),
    );
  }

  // GetEnemyOnHitSound @0x9443E0 — NOT PORTED YET (pure presentation: picks
  // the hit AudioClip via EnemyBase/TowerBase/GlobalSounds; lands with the
  // Phase-4 audio contracts).
}
