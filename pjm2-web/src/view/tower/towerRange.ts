// src/view/tower/towerRange.ts
// The range ring a tower shows must be the region its EnemyDetector really targets with, not `attackRangeInner + attackSpread`
// (those are the projectile's MINIMUM range and SPLASH radius). The sim fires when GameCoreEnemyDetector.InAttack holds:
//   cone  (EnemyDetectorCone):   frustum hanging down from (tower + offset) for `height`; horizontal radius at vertical drop d is
//                                upper + (lower - upper) * d / height, with upper/lower = upperRadius/lowerRadius * affectRate
//                                (IntersectWithPos @0x944BC0); a target at ground level is d = offset.y below the anchor.
//   sphere (EnemyDetectorSphere): 3D distance <= radius * affect from (tower + offset).
// The enemy's own collision radius is added on top (IntersectWithObject), so real engagement starts slightly earlier.

import { EnemyDetectorCone } from '../../core/EnemyDetectorCone';
import { EnemyDetectorSphere } from '../../core/EnemyDetectorSphere';
import type { IEnemyDetector } from '../../core/interfaces';

/**
 * Horizontal radius of a detector at ground level (target at the tower's own height).
 * 'detect' (default) = InDetection volume (radius * m_radiusScale, the level-upgrade scale): this is the YELLOW ring the original
 *   draws (EnemyDetectorViewCone.detectColor (1, .92, .02); attackColor has alpha 0, showLimitRange 0).
 * 'attack' = InAttack volume (radius * affectRate): what gates a shot.
 */
export function detectorGroundRadius(det: IEnemyDetector, kind: 'detect' | 'attack' = 'detect'): number | null {
  const dy = det.getOffset().y;
  if (det instanceof EnemyDetectorCone) {
    const h = det.height;
    const t = h > 0 ? Math.min(1, Math.max(0, dy / h)) : 0;
    const up = kind === 'detect' ? det.upper : det.affectUpper;
    const lo = kind === 'detect' ? det.lower : det.affectLower;
    return up + (lo - up) * t;
  }
  if (det instanceof EnemyDetectorSphere) {
    const r = kind === 'detect' ? det.radius : det.affectRadius;
    return Math.sqrt(Math.max(0, r * r - dy * dy));
  }
  return null;
}

interface PrefabWithDetector {
  attackRangeInner: number;
  attackSpread: number;
  getComponentEnemyDetectorView?: () => { createGameCoreDetector(): IEnemyDetector } | null;
}

/** Ring radius for a tower prefab (falls back to the old inner + spread value only when no detector exists). */
export function prefabRangeRadius(prefab: PrefabWithDetector): number {
  const det = prefab.getComponentEnemyDetectorView?.()?.createGameCoreDetector();
  const r = det !== undefined && det !== null ? detectorGroundRadius(det) : null;
  return r ?? prefab.attackRangeInner + prefab.attackSpread;
}
