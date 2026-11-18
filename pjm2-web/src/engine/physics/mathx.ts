/**
 * Tiny internal vector/quaternion helpers for the physics layer.
 *
 * NOTE(ownership): src/engine/math is being built by another agent RIGHT NOW.
 * These helpers are deliberately minimal and private to src/engine/physics so
 * we do not create or touch engine/math. Once engine/math lands, replace the
 * usages here with it (search for `mathx` imports).
 *
 * Conventions (must match the extractor output, see
 * tools/colliders/extract_stage_colliders.py):
 *  - Coordinates are Unity LEFT-HANDED Y-up, kept AS-IS. No conversion here —
 *    parity data (enemy m_pathList) lives in the same frame; conversion to a
 *    right-handed frame happens only in the renderer.
 *  - Quaternions are [x, y, z, w] (Unity serialization order).
 *  - Quaternion multiplication order: qmul(a, b) applies b first, then a
 *    (same algebra as Unity's `a * b`).
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // xyzw

export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function v3len(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function v3scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function v3mul(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function v3normalize(a: Vec3): Vec3 | null {
  const l = v3len(a);
  if (l < 1e-12) return null;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Hamilton product, Unity order: qmul(a, b) == Unity's a * b. */
export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate vector v by quaternion q (identical algebra to Unity's q * v). */
export function qrotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Quaternion for a rotation of `angleDeg` about a unit axis (Unity AngleAxis algebra). */
export function qAxisAngle(axis: Vec3, angleDeg: number): Quat {
  const h = (angleDeg * Math.PI) / 360; // half angle in radians
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];
