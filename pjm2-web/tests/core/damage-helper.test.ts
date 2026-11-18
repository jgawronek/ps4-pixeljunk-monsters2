// tests/core/damage-helper.test.ts
// Semantics tests for the DamageHelper static port: table lookups (first match,
// default 1.0), target overloads through the viewer resolver, the three
// damageRateByAttributes/damageByAttributes overload shapes, strong/weak list
// extraction, and the max-combo DamageStrongToEnemy/ReactionStrongToEnemy.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { DamageHelper } from '../../src/core/DamageHelper';
import { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from '../../src/core/enums';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import {
  GameCoreHandle,
  setFrameResolver,
  setViewerResolver,
} from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import type {
  ClassDamageInfo,
  EnemyViewContract,
  StrengthDamageInfo,
} from '../../src/view/q4-contracts';

const S = EEnemyStrengthTypeDef;
const C = EEnemyClassTypeDef;

const sInfo = (
  strength: EEnemyStrengthTypeDef,
  damageTime: number,
  reactionTime = 1,
): StrengthDamageInfo => ({ strength, damageTime, reactionTime });
const cInfo = (
  classType: EEnemyClassTypeDef,
  damageTime: number,
  reactionTime = 1,
): ClassDamageInfo => ({ classType, damageTime, reactionTime });

function makeView(
  strengthDamageInfos: StrengthDamageInfo[],
  classDamageInfos: ClassDamageInfo[],
): EnemyViewContract {
  return {
    getComponentEnemyAttributesSettings: () => ({
      strengthDamageInfos,
      classDamageInfos,
      hasShieldEffect: () => false,
    }),
  };
}

let core: GameCore;
let views: Map<number, unknown>;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  views = new Map();
  setViewerResolver((h) => views.get(h) ?? null);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
});

function makeTarget(view: EnemyViewContract | null = null): GameCoreObject {
  const t = new GameCoreObject();
  if (view !== null) views.set(t.handle.m_handle, view);
  return t;
}

describe('DamageHelper rate lookups (table overloads)', () => {
  const sTable = [sInfo(S.Normal, 2), sInfo(S.Soft, 1.5), sInfo(S.Soft, 99)];
  const cTable = [cInfo(C.Magic, 0.5), cInfo(C.Physic, 3)];

  it('returns the damageTime of the FIRST matching entry', () => {
    expect(DamageHelper.damageRateByStrength(S.Soft, sTable)).toBe(1.5);
    expect(DamageHelper.damageRateByStrength(S.Normal, sTable)).toBe(2);
    expect(DamageHelper.damageRateByClass(C.Magic, cTable)).toBe(0.5);
  });

  it('defaults to 1.0 for missing entries and null tables', () => {
    expect(DamageHelper.damageRateByStrength(S.Hard, sTable)).toBe(1);
    expect(DamageHelper.damageRateByStrength(S.Soft, null)).toBe(1);
    expect(DamageHelper.damageRateByClass(C.Normal, cTable)).toBe(1);
  });

  it('reaction rates read reactionTime instead of damageTime', () => {
    const rsTable = [sInfo(S.Soft, 1, 4)];
    const rcTable = [cInfo(C.Magic, 1, 0.25)];
    expect(DamageHelper.reactionRateByStrength(S.Soft, rsTable)).toBe(4);
    expect(DamageHelper.reactionRateByClass(C.Magic, rcTable)).toBe(0.25);
    expect(DamageHelper.reactionRateByStrength(S.Hard, null)).toBe(1);
  });
});

describe('DamageHelper rate lookups (target overloads)', () => {
  it('resolves target → viewer → EnemyAttributesSettings', () => {
    const view = makeView([sInfo(S.Soft, 1.5)], [cInfo(C.Physic, 3)]);
    const t = makeTarget(view);
    expect(DamageHelper.damageRateByStrength(S.Soft, t)).toBe(1.5);
    expect(DamageHelper.damageRateByClass(C.Physic, t)).toBe(3);
    expect(DamageHelper.damageRateByStrength(S.Hard, t)).toBe(1); // not in table
  });

  it('null target / missing view / missing attrs all fall back to 1.0', () => {
    expect(DamageHelper.damageRateByStrength(S.Soft, null)).toBe(1);
    const noView = makeTarget(null);
    expect(DamageHelper.damageRateByStrength(S.Soft, noView)).toBe(1);
    const noAttrs: EnemyViewContract = {
      getComponentEnemyAttributesSettings: () => null,
    };
    const t2 = makeTarget(noAttrs);
    expect(DamageHelper.damageRateByClass(C.Magic, t2)).toBe(1);
    expect(DamageHelper.reactionRateByStrength(S.Soft, t2)).toBe(1);
  });
});

describe('DamageHelper combined rates and damage', () => {
  const view = makeView([sInfo(S.Hard, 2)], [cInfo(C.Physic, 3)]);

  it('damageRateByAttributes: settings / tables / target overloads agree', () => {
    const t = makeTarget(view);
    const attrs = view.getComponentEnemyAttributesSettings()!;
    expect(DamageHelper.damageRateByAttributes(S.Hard, C.Physic, attrs)).toBe(6);
    expect(
      DamageHelper.damageRateByAttributes(S.Hard, C.Physic, attrs.strengthDamageInfos, attrs.classDamageInfos),
    ).toBe(6);
    expect(DamageHelper.damageRateByAttributes(S.Hard, C.Physic, t)).toBe(6);
    expect(DamageHelper.damageRateByAttributes(S.Hard, C.Physic, null)).toBe(1);
  });

  it('damageBy* multiply rate × damage (f32)', () => {
    const t = makeTarget(view);
    expect(DamageHelper.damageByStrength(S.Hard, t, 10)).toBe(20);
    expect(DamageHelper.damageByClass(C.Physic, t, 10)).toBe(30);
    expect(DamageHelper.damageByAttributes(S.Hard, C.Physic, t, 10)).toBe(60);
    expect(DamageHelper.damageByAttributes(S.Hard, C.Physic, null, 10)).toBe(10); // guard
  });

  it('reactionRateByAttributes across the three overload shapes', () => {
    const rView = makeView([sInfo(S.Hard, 1, 2)], [cInfo(C.Physic, 1, 4)]);
    const t = makeTarget(rView);
    const attrs = rView.getComponentEnemyAttributesSettings()!;
    expect(DamageHelper.reactionRateByAttributes(S.Hard, C.Physic, attrs.strengthDamageInfos, attrs.classDamageInfos)).toBe(8);
    expect(DamageHelper.reactionRateByAttributes(S.Hard, C.Physic, attrs)).toBe(8);
    expect(DamageHelper.reactionRateByAttributes(S.Hard, C.Physic, t)).toBe(8);
    expect(DamageHelper.reactionRateByAttributes(S.Hard, C.Physic, null)).toBe(1);
  });
});

describe('DamageHelper strong/weak predicates', () => {
  it('boolean rate > 1 checks (both original spellings kept)', () => {
    const sTable = [sInfo(S.Hard, 2), sInfo(S.Soft, 0.5)];
    const cTable = [cInfo(C.Physic, 3), cInfo(C.Magic, 0.25)];
    expect(DamageHelper.damageStrongToEnemyByStrength(S.Hard, sTable)).toBe(true);
    expect(DamageHelper.damageStrongToEnemyByStrength(S.Soft, sTable)).toBe(false);
    expect(DamageHelper.damageStrongToEnemyByClass(C.Physic, cTable)).toBe(true);
    expect(DamageHelper.reactionStrongToEnemybyClass(C.Physic, [cInfo(C.Physic, 1, 2)])).toBe(true);
    const t = makeTarget(makeView([sInfo(S.Hard, 1, 2)], [cInfo(C.Physic, 1, 0.5)]));
    expect(DamageHelper.reactionStrongToEnemyByStrength(S.Hard, t)).toBe(true);
    expect(DamageHelper.reactionStrongToEnemyByClass(C.Physic, t)).toBe(false);
  });

  it('strong/weak damage type lists from the view tables', () => {
    const view = makeView(
      [sInfo(S.Hard, 2), sInfo(S.Soft, 0.5), sInfo(S.Normal, 1)],
      [cInfo(C.Magic, 0.25), cInfo(C.Physic, 1.5)],
    );
    expect(DamageHelper.strongDamageStrengthTypes(view)).toEqual([S.Hard]);
    expect(DamageHelper.weakDamageStrengthTypes(view)).toEqual([S.Soft]);
    expect(DamageHelper.strongDamageClassTypes(view)).toEqual([C.Physic]);
    expect(DamageHelper.weakDamageClassTypes(view)).toEqual([C.Magic]);
  });
});

describe('DamageHelper max-combo predicates', () => {
  // sTable: Normal 1, Hard 2; cTable: Magic 0.5, Normal 1 → max product = 2.
  const sTable = [sInfo(S.Normal, 1), sInfo(S.Hard, 2)];
  const cTable = [cInfo(C.Magic, 0.5), cInfo(C.Normal, 1)];

  it('DamageStrongToEnemy: true only for the maximal combo (max <= rate)', () => {
    expect(DamageHelper.damageStrongToEnemy(S.Hard, C.Normal, sTable, cTable)).toBe(true); // 2×1 = max
    expect(DamageHelper.damageStrongToEnemy(S.Hard, C.Magic, sTable, cTable)).toBe(false); // 1 < 2
    expect(DamageHelper.damageStrongToEnemy(S.Normal, C.Normal, sTable, cTable)).toBe(false); // 1 < 2
  });

  it('target overload guards: null / no view / no attrs → false', () => {
    expect(DamageHelper.damageStrongToEnemy(S.Hard, C.Normal, null)).toBe(false);
    const noView = makeTarget(null);
    expect(DamageHelper.damageStrongToEnemy(S.Hard, C.Normal, noView)).toBe(false);
    const t = makeTarget(makeView(sTable, cTable));
    expect(DamageHelper.damageStrongToEnemy(S.Hard, C.Normal, t)).toBe(true);
  });

  it('ReactionStrongToEnemy uses reactionTime products', () => {
    const rs = [sInfo(S.Normal, 1, 1), sInfo(S.Hard, 1, 3)];
    const rc = [cInfo(C.Magic, 1, 2), cInfo(C.Normal, 1, 1)];
    expect(DamageHelper.reactionStrongToEnemy(S.Hard, C.Magic, rs, rc)).toBe(true); // 6 = max
    expect(DamageHelper.reactionStrongToEnemy(S.Hard, C.Normal, rs, rc)).toBe(false); // 3 < 6
  });
});
