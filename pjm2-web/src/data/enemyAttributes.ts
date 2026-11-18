// src/data/enemyAttributes.ts
// Q4.EnemyAttributesSettings view contract built from the serialized per-enemy tables
// (enemyAttributes.generated.ts). DamageHelper reads these through the enemy viewer's
// getComponentEnemyAttributesSettings(); without them every tower hit is x1 (the pre-audit
// state: giants take 0.3x from Soft towers, bats 2x from Physic, bees 3.34x from Hard ...).
import type {
  ClassDamageInfo,
  EnemyAttributesSettingsContract,
  StrengthDamageInfo,
} from '../view/q4-contracts';
import { BALLOON_ATTRIBUTES, ENEMY_ATTRIBUTES } from './enemyAttributes.generated';

function build(raw: { strength: number[][]; cls: number[][] }): EnemyAttributesSettingsContract {
  return {
    strengthDamageInfos: raw.strength.map((r, i) => ({ strength: i, damageTime: r[0], reactionTime: r[1] })),
    classDamageInfos: raw.cls.map((r, i) => ({ classType: i, damageTime: r[0], reactionTime: r[1] })),
    // C#: class entry carries a weakEffect (shield) prefab.
    hasShieldEffect: (classType) => (raw.cls[classType]?.[2] ?? 0) !== 0,
  };
}

/** The Q4.Balloon GameObject's own EnemyAttributesSettings (the balloon is the enemy's attack point while it floats). */
export function balloonAttributes(): EnemyAttributesSettingsContract {
  return build(BALLOON_ATTRIBUTES);
}

const CACHE = new Map<string, EnemyAttributesSettingsContract | null>();

/** Attributes contract for an enemy prefab name (e.g. "giant_00_001"), or null when unknown. */
export function enemyAttributesFor(name: string): EnemyAttributesSettingsContract | null {
  const hit = CACHE.get(name);
  if (hit !== undefined) return hit;
  const raw = ENEMY_ATTRIBUTES[name];
  const c: EnemyAttributesSettingsContract | null = raw !== undefined ? build(raw) : null;
  CACHE.set(name, c);
  return c;
}

// ---- Q4.EnemyBase.AttackPoints() view contracts (boss weak points) -------------------------------------------------
import type { AttackPointSettingContract, EnemyAttackPointViewContract } from '../view/q4-contracts';
import { ENEMY_ATTACK_POINTS } from './enemyAttackPoints.generated';

const AP_CACHE = new Map<string, EnemyAttackPointViewContract[] | null>();

/** The enemy prefab's "AttackPoint" child GameObjects (bosses only: bero 4, kao 4, fat 2, ude 3), or null for plain enemies.
 *  Without these the 21 boss prefabs had NO weak points in the sim (no vulnerable-damage accumulation for Fat/Tall, body-only
 *  damage tables, Kao/Fat air/ground point switching inert). */
export function enemyAttackPointsFor(name: string): EnemyAttackPointViewContract[] | null {
  const hit = AP_CACHE.get(name);
  if (hit !== undefined) return hit;
  const raw = ENEMY_ATTACK_POINTS[name];
  const views: EnemyAttackPointViewContract[] | null =
    raw === undefined
      ? null
      : raw.map((p) => {
          const setting: AttackPointSettingContract = { moveTypeOverride: p.moveTypeOverride as never, afterAirPoints: p.afterAirPoints };
          const attrs = p.attr !== null ? build(p.attr) : null;
          return {
            getComponentSphereColliderRadius: () => p.radius, // no collider on the prefab -> sim default 0.5
            transform: { localPosition: { x: p.pos[0], y: p.pos[1], z: p.pos[2] } },
            getComponentAttackPointSetting: () => setting,
            getComponentEnemyAttributesSettings: () => attrs,
          };
        });
  AP_CACHE.set(name, views);
  return views;
}
