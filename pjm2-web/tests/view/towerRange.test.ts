import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../src/engine/math/Vector3';
import { EnemyDetectorCone } from '../../src/core/EnemyDetectorCone';
import { EnemyDetectorSphere } from '../../src/core/EnemyDetectorSphere';
import { detectorGroundRadius, prefabRangeRadius } from '../../src/view/tower/towerRange';

describe('tower range ring = the detector the sim fires with', () => {
  it('cone: ground radius interpolates upper->lower by offset.y / height (tower_001: 3.33 / 4.44, h 15, offset 5)', () => {
    const det = new EnemyDetectorCone(new Vector3(0, 5, 0), 3.33, 4.44, 15, 1.0);
    const r = detectorGroundRadius(det, 'attack')!;
    expect(r).toBeCloseTo(3.33 + (4.44 - 3.33) * (5 / 15), 3); // 3.70, NOT inner + spread (5.3)
    // and it agrees with the sim's own point test: just inside fires, just outside does not
    const pos = new Vector3(0, 5, 0);
    expect(det.inAttack(pos, new Vector3(r - 0.02, 0, 0))).toBe(true);
    expect(det.inAttack(pos, new Vector3(r + 0.02, 0, 0))).toBe(false);
  });
  it('detect (the drawn yellow ring) uses radius * radiusScale; attack uses affectRate', () => {
    const det = new EnemyDetectorCone(new Vector3(0, 5, 0), 3.6, 3.6, 15, 1.35);
    expect(detectorGroundRadius(det)).toBeCloseTo(3.6, 3);
    expect(detectorGroundRadius(det, 'attack')).toBeCloseTo(3.6 * 1.35, 3);
    det.upgrade(1.5, 1.35); // level upgrade scales the detection radius
    expect(detectorGroundRadius(det)).toBeCloseTo(3.6 * 1.5, 3);
  });
  it('sphere: horizontal radius at ground from the 3D radius and offset', () => {
    const det = new EnemyDetectorSphere(new Vector3(0, 3, 0), 5, 1.0);
    expect(detectorGroundRadius(det)).toBeCloseTo(4, 3);
  });
  it('falls back to inner + spread only without a detector', () => {
    expect(prefabRangeRadius({ attackRangeInner: 2, attackSpread: 3.3 })).toBeCloseTo(5.3, 3);
  });
});
