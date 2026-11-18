// src/main/headlessTowers.ts
// Headless (no-DOM, no-three) Q4.TowerBase prefab contracts for ALL towers (public/assets/data/towers.json, the
// structures bundle's TowerBase records) with the REAL per-tower projectile prefab (props bundle contract,
// projectileContracts.ts) and the REAL EnemyDetectorViewCone volume (PROJECTILE_DATA.towers[].detector).
// Mirrors game.ts's tower001Contract (kept separate: game.ts is owned by another lane).
// The pre-audit headless runner used ONE tower_001 contract with a straight-line Trajectory stand-in.
import { EnemyDetectorCone } from '../core/EnemyDetectorCone';
import { EnemyDetectorSphere } from '../core/EnemyDetectorSphere';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef, ETowerAttackDef } from '../core/enums';
import { Vector3 } from '../engine/math';
import { projectileContractForTower } from '../view/projectiles/projectileContracts';
import { PROJECTILE_DATA } from '../view/projectiles/projectileData.generated';
import type { TowerBaseContract } from '../view/q4-contracts';

const f = Math.fround;
type Json = Record<string, unknown>;

export function realTowerContract(raw: Json): TowerBaseContract {
  const name = String(raw.__gameObject);
  return {
    name,
    gameObject: {},
    transform: { position: { x: 0, y: 0, z: 0 } },
    singletonInScene: (raw.singletonInScene as number) !== 0 && raw.singletonInScene !== undefined,
    nextTargetToAttackIndex: (raw.nextTargetToAttackIndex as number) | 0,
    attackType: raw.attackType as ETowerAttackDef,
    strengthType: raw.strengthType as EEnemyStrengthTypeDef,
    classType: raw.classType as EEnemyClassTypeDef,
    balloonAimable: (raw.balloonAimable as number) !== 0,
    attackPower: raw.attackPower as number,
    attackSpeed: raw.attackSpeed as number,
    attackRangeInner: raw.attackRangeInner as number,
    attackSpread: raw.attackSpread as number,
    costCoin: (raw.costCoin as number) | 0,
    costGem: (raw.costGem as number) | 0,
    buildTime: raw.buildTime as number,
    buildRange: raw.buildRange as number,
    refundCoin: (raw.refundCoin as number) | 0,
    refundGem: (raw.refundGem as number) | 0,
    magazineCapacity: (raw.magazineCapacity as number) | 0,
    rotateSpeedX: raw.rotateSpeedX as number,
    rotateSpeedXAcel: raw.rotateSpeedXAcel as number,
    rotateSpeedXDecl: raw.rotateSpeedXDecl as number,
    rotateSpeedY: raw.rotateSpeedY as number,
    rotateSpeedYAcel: raw.rotateSpeedYAcel as number,
    rotateSpeedYDecl: raw.rotateSpeedYDecl as number,
    oneShotOneBalloon: (raw.oneShotOneBalloon as number) !== 0,
    fullRangeFire: (raw.fullRangeFire as number) !== 0,
    fireAngleThreshold: raw.fireAngleThreshold as number,
    attackAttenuations: (raw.attackAttenuations as { rate: number; attenuation: number; snap: number }[]).map(
      (a) => ({ rate: f(a.rate), attenuation: f(a.attenuation), snap: a.snap !== 0 }),
    ),
    burstCount: (raw.burstCount as number) | 0,
    burstInterval: raw.burstInterval as number,
    cautionRange: raw.cautionRange as number,
    cautionIdleTime: raw.cautionIdleTime as number,
    cautionRotateSpeed: raw.cautionRotateSpeed as number,
    cautionRotateAngleMin: (raw.cautionRotateAngleMin as number | undefined) ?? 10,
    playerDetectionRange: raw.playerDetectionRange as number,
    firePointNames: raw.firePointNames as string[],
    projectile: projectileContractForTower(name)!,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => ({
      createGameCoreDetector: () => {
        const cone = PROJECTILE_DATA.towers[name]?.detector;
        if (cone) {
          return new EnemyDetectorCone(
            new Vector3(cone.offset[0], cone.offset[1], cone.offset[2]),
            cone.upperRadius, cone.lowerRadius, cone.height, cone.affectRangeRate,
          );
        }
        return new EnemyDetectorSphere(
          new Vector3(0, 1, 0), f(f(raw.attackRangeInner as number) + f(raw.attackSpread as number)), 1,
        );
      },
    }),
    findDeepChildY: () => 1.5,
    getFirePointByRemainingMag: () => ({ x: 0, y: 1.5, z: 0 }),
  };
}
