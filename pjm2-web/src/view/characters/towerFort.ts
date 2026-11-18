// src/view/characters/towerFort.ts
// Pure (three-free, Unity-space) port of the Q4.TowerBase fort-aim math.
//
//   Q4.TowerBase.ClampDirection        @0054ad00  (verified against raw x86-64)
//   Q4.TowerBase.UpdateFortViewRotation @0054aeb0 (the two joint assignments)
//
// All vectors/quaternions here are RAW UNITY (left-handed) — the three.js
// mirror is applied ONCE by the caller (TowerStageView).
//
// Raw-disassembly facts (Il2CppUserAssemblies.elf, vaddr == file offset - 0x4000):
//   ClampDirection(dir, min, max):
//     n    = dir.normalized                         (call 0x98d750)
//     flat = Normalize((n.x, 0, n.z))               (call 0x98d5a0 on a copy, y := 0)
//     axis = (n.y > 0) ? Cross(n, flat) : Cross(flat, n)      (call 0x98d1c0)
//     ang  = Vector3.Angle(n, flat)                 (call 0x98da00)
//     ang *= TABLE[(Dot(n, up) > 0) ? 1 : 0]        TABLE = {+1.0, -1.0} @rodata 0xb7d0d0
//     ang  = Mathf.Clamp(ang, min, max)             (call 0x8459a0, min = this+0xBC
//                                                    fortAngleMin, max = this+0xB8 fortAngleMax)
//     return AngleAxis(ang, axis) * flat            (calls 0x9cdee0, 0x9cef50)
//   i.e. the signed pitch is NEGATIVE when aiming UP, so tower_001's
//   fortAngleMin = -45 / fortAngleMax = 0 means "up to 45 degrees up, never below
//   the horizon".
//   UpdateFortViewRotation:
//     horizontal joint (this+0x180): d = fortDirection with y := 0, normalized;
//        if |d| > 0.001 (rodata 0xb7cffc)  joint.rotation = LookRotation(d) * bindWorld(0x1b0)
//     vertical joint   (this+0x188): c = ClampDirection(fortDirection, fortAngleMin, fortAngleMax);
//        if c != 0 joint.rotation = LookRotation(c) * bindWorld(0x1c0);
//        then (unconditionally, inside the same `joint alive` block)
//        joint.localPosition = MoveTowards(localPosition, originLocalPos(0x198), dt)  — recoil recovery
//   Both are WORLD-space assignments (Transform.set_rotation).

import { Quaternion, Vector3 } from '../../engine/math';

/** rodata @0xb7cffc — magnitude floor for the flat (yaw) direction. */
export const FORT_FLAT_EPSILON = 0.001;

/** Q4.TowerBase.ClampDirection. Returns a Unity-space direction (zero when
 *  the input has zero length). min/max are fortAngleMin / fortAngleMax. */
export function clampFortDirection(rawDirection: Vector3, minAngle: number, maxAngle: number): Vector3 {
  const n = rawDirection.normalized;
  const flat = new Vector3(n.x, 0, n.z).normalized;
  const axis = n.y > 0 ? Vector3.Cross(n, flat) : Vector3.Cross(flat, n);
  const dot = Vector3.Dot(n, Vector3.up);
  let angle = Vector3.Angle(n, flat) * (dot > 0 ? -1.0 : 1.0);
  angle = Math.min(maxAngle, Math.max(minAngle, angle));
  return Quaternion.MultiplyVector(Quaternion.AngleAxis(angle, axis), flat);
}

export interface FortAim {
  /** Rotation assigned to the HORIZONTAL joint (null = leave untouched). */
  horizontal: Quaternion | null;
  /** Rotation assigned to the VERTICAL joint (null = leave untouched). */
  vertical: Quaternion | null;
}

/** The two world rotations UpdateFortViewRotation assigns BEFORE the bind-pose
 *  multiply (`LookRotation(dir)`), in Unity space. */
export function fortAim(fortDirection: Vector3, fortAngleMin: number, fortAngleMax: number): FortAim {
  const flat = new Vector3(fortDirection.x, 0, fortDirection.z).normalized;
  const horizontal = flat.magnitude > FORT_FLAT_EPSILON ? Quaternion.LookRotation(flat) : null;
  const clamped = clampFortDirection(fortDirection, fortAngleMin, fortAngleMax);
  const vertical = clamped.sqrMagnitude !== 0 ? Quaternion.LookRotation(clamped) : null;
  return { horizontal, vertical };
}

/** Q4.TowerBase.Start: `transform.rotation = Quaternion.LookRotation(tower.bodyDirection)`.
 *  TS ADAPTATION: a zero body direction (tree_002 serializes towerDirection = 0)
 *  yields Unity 5.6's degenerate (0.5,0,0,0) in the engine port; the original
 *  would then flip the tower 180 degrees about X. We keep identity instead —
 *  see docs/TOWER_CONSTRUCTION_ANALYSIS.md ("unverified"). */
export function bodyRotation(bodyDirection: Vector3): Quaternion {
  if (bodyDirection.sqrMagnitude < 1e-12) return Quaternion.identity;
  return Quaternion.LookRotation(bodyDirection);
}
