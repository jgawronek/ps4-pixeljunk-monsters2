// src/view/characters/StructureVibration.ts
// Port of Q4.StructureVibration (the "tower shakes while it builds" component).
//
//   Q4.TowerBase.Update @00549e70 adds it with AddComponent the first frame the
//   tower's state is TowerStateBuild (stored in TowerBase.m_vibration @0x1A8) and
//   destroys it when the state leaves Build (unless a gem-tower sink coroutine
//   is running, m_ongoingSink @0x1F8).
//
//   .ctor @00537040:  factor (0x18) = 0.015  (0x3C75C28F), shakeSpeed (0x1C) = 1.0
//                     (0x3F800000), m_vibrationReverse (0x20) = false,
//                     m_shakePosition (0x30) = Vector3.zero.
//   Update @005370a0 (verified against raw disassembly 0x5370a0..0x5371b0):
//       dir   = GetVibrationDirection()
//       shake = shake + dir * shakeSpeed * deltaTime * SIGN[reverse]   SIGN = {-1.0, +1.0} @rodata 0xb7d0b8
//       if |shake| >= factor: shake = shake.normalized * factor; reverse ^= 1
//       transform.position = transform.position + shake
//   GetVibrationDirection @005371b0:
//       Vector3.right; if the active camera exists: dir = Normalize((cam.right.x, 0, cam.right.z)).
//
// The shake is therefore a +/-0.015 unit horizontal jitter along the screen's
// right axis. Because TowerBase.Update rewrites the transform position from the
// sim every Build frame, the offset never accumulates.

const f = Math.fround;

export const VIBRATION_FACTOR = f(0.015);
export const VIBRATION_SHAKE_SPEED = f(1.0);
/** rodata 0xb7d0b8, indexed by m_vibrationReverse. */
const SIGN: readonly [number, number] = [-1.0, 1.0];

export class StructureVibration {
  readonly factor = VIBRATION_FACTOR; // 0x18
  readonly shakeSpeed = VIBRATION_SHAKE_SPEED; // 0x1C
  private reverse = false; // 0x20
  /** m_shakePosition (0x30) — world-space offset the caller adds to the position. */
  shakeX = 0;
  shakeY = 0;
  shakeZ = 0;

  /** One Update(). `dir` is the (already normalized) shake axis. Returns the
   *  offset to add to the transform position. */
  step(dt: number, dirX: number, dirY: number, dirZ: number): { x: number; y: number; z: number } {
    const k = f(f(this.shakeSpeed * dt) * SIGN[this.reverse ? 1 : 0]);
    this.shakeX = f(this.shakeX + f(dirX * k));
    this.shakeY = f(this.shakeY + f(dirY * k));
    this.shakeZ = f(this.shakeZ + f(dirZ * k));
    const mag = Math.hypot(this.shakeX, this.shakeY, this.shakeZ);
    if (mag >= this.factor) {
      const s = f(this.factor / mag);
      this.shakeX = f(this.shakeX * s);
      this.shakeY = f(this.shakeY * s);
      this.shakeZ = f(this.shakeZ * s);
      this.reverse = !this.reverse;
    }
    return { x: this.shakeX, y: this.shakeY, z: this.shakeZ };
  }

  /** GetVibrationDirection from a camera right vector (any space): flat + normalized;
   *  no camera → Vector3.right. */
  static direction(cameraRight: { x: number; y: number; z: number } | null): { x: number; y: number; z: number } {
    if (cameraRight === null) return { x: 1, y: 0, z: 0 };
    const len = Math.hypot(cameraRight.x, cameraRight.z);
    if (len < 1e-9) return { x: 0, y: 0, z: 0 }; // Unity Normalize(zero) = zero
    return { x: cameraRight.x / len, y: 0, z: cameraRight.z / len };
  }
}
