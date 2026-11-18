// src/view/projectiles/projectileMath.ts
// Headless-testable math of the Q4 projectile VIEW classes. Everything here is
// UNITY LEFT-HANDED space with float32 arithmetic (Math.fround) so it matches the
// IL2CPP code bit-for-bit where the sim depends on it.
//
// Evidence (decomp/decompiled/Q4.ProjectileTrajectory.c, raw x86-64 disassembly of
// Il2CppUserAssemblies.elf; rodata read at file offset = vaddr + 0x4000):
//   GetFireDirection @0074dfd0 (raw 0x74dfd0..0x74e0c0):
//       d  = (target + extra) - from
//       h  = (d.x, 0, d.z)                      <- vmovlps + `mov [rbp-0x24],0`
//       hd = |h|                                <- call 0x98c8c0 (Vector3.Magnitude)
//       speed = fixedImpactTime(+0x48) ? hd / impactTime(+0x4C) : speedHorizontal(+0x50)
//       t  = hd / speed
//       v  = h / t                              <- call 0x98c950 (op_Division)
//       v.y = (d.y + t * (t * (gravity(+0x54) * DAT_00b80480))) / t   DAT_00b80480 = -0.5
//     i.e. the exact ballistic solution of  d.y = v.y t + 0.5 g t^2  for horizontal
//     flight time t (the sim then integrates v += (0, g dt, 0); p += v dt).
//   Gaseous GetFireDirection @0074a4e0: same, never fixed-time, constant DAT_00b80448 = -0.5.
//   UpdateViewPosition @0074d8d0 (raw, see PROJECTILE_ANALYSIS.md): position blend
//     w = clamp01(elapsed); pos = w >= 1.0 (DAT_00b80474) ? sim : view + (sim - view) * w;
//     rotation = LookRotation(Vector3.forward, delta/|delta|) when |delta| > 0.001 (DAT_00b80478).

const f = Math.fround;

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Q4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** DAT_00b80480 / DAT_00b80448 (rodata, float32 -0.5). */
export const HALF_NEG = f(-0.5);
/** DAT_00b80478: |sim - view| below this skips the re-aim. */
export const VIEW_EPSILON = f(0.001);

export interface BallisticParams {
  /** ProjectileTrajectory +0x48 */
  fixedImpactTime: boolean;
  /** +0x4C (default 2.0) */
  impactTime: number;
  /** +0x50 (default 10.0) */
  speedHorizontal: number;
  /** +0x54 (default -10.0); scalar applied to velocity.y only */
  gravity: number;
}

/** Q4.ProjectileTrajectory.GetFireDirection — initial velocity (units/s). */
export function ballisticFireDirection(
  from: V3,
  target: V3,
  extra: V3,
  p: BallisticParams,
): V3 {
  const dx = f(f(target.x + extra.x) - from.x);
  const dy = f(f(target.y + extra.y) - from.y);
  const dz = f(f(target.z + extra.z) - from.z);
  const hd = f(Math.sqrt(f(f(dx * dx) + f(dz * dz))));
  const speed = p.fixedImpactTime ? f(hd / f(p.impactTime)) : f(p.speedHorizontal);
  const t = f(hd / speed);
  if (!(t > 0) || !Number.isFinite(t)) {
    // TS ADAPTATION: the original yields NaN for a target straight above/below
    // the muzzle (hd == 0). Fall back to a vertical 1-second lob so the sim
    // never ingests NaN.
    return { x: 0, y: dy, z: 0 };
  }
  const vy = f(f(dy + f(t * f(t * f(f(p.gravity) * HALF_NEG)))) / t);
  return { x: f(dx / t), y: vy, z: f(dz / t) };
}

/** Q4.ProjectileTrajectory.SetupEstimateTime — seconds until the view expects
 *  to land (drives visibility windows only; never the sim). */
export function estimateImpactTime(
  firePoint: V3,
  predictedTarget: V3,
  p: BallisticParams,
): number {
  if (p.fixedImpactTime) return f(p.impactTime);
  const dx = f(predictedTarget.x - firePoint.x);
  const dz = f(predictedTarget.z - firePoint.z);
  const hd = f(Math.sqrt(f(f(dx * dx) + f(dz * dz))));
  return f(hd / f(p.speedHorizontal));
}

/** Q4.ProjectileTrajectory.UpdateVisibility: the renderer is ENABLED while the
 *  flight ratio is before invisibleStart or after invisibleEnd. */
export function isVisibleAt(elapsed: number, estimate: number, invisibleStart: number, invisibleEnd: number): boolean {
  const ratio = f(elapsed / estimate);
  let visible = true;
  if (invisibleStart <= ratio) visible = invisibleEnd < ratio;
  return visible;
}

export interface ViewStepState {
  /** Current VIEW transform position (unity space). */
  pos: V3;
  /** Seconds since the view started, capped at the estimate (UpdateVisibility @+0x74). */
  elapsed: number;
}

export interface ViewStepResult {
  pos: V3;
  /** null → keep the previous rotation (|delta| <= 0.001). Unity space. */
  rot: Q4 | null;
}

const len3 = (v: V3): number => f(Math.sqrt(f(f(f(v.x * v.x) + f(v.y * v.y)) + f(v.z * v.z))));

/** Q4.ProjectileTrajectory.UpdateViewPosition for one frame. */
export function viewStep(state: ViewStepState, simPos: V3): ViewStepResult {
  const w = f(Math.min(1, Math.max(0, state.elapsed)));
  const delta: V3 = {
    x: f(simPos.x - state.pos.x),
    y: f(simPos.y - state.pos.y),
    z: f(simPos.z - state.pos.z),
  };
  const pos: V3 =
    w >= 1
      ? { x: simPos.x, y: simPos.y, z: simPos.z }
      : { x: f(state.pos.x + f(delta.x * w)), y: f(state.pos.y + f(delta.y * w)), z: f(state.pos.z + f(delta.z * w)) };
  const d = len3(delta);
  if (d <= VIEW_EPSILON) return { pos, rot: null };
  const up: V3 = { x: f(delta.x / d), y: f(delta.y / d), z: f(delta.z / d) };
  return { pos, rot: lookRotationForwardZ(up) };
}

/** Quaternion.LookRotation(Vector3.forward, up) in Unity space: Z fixed to world
 *  +Z, Y = `up` projected onto the XY plane. Returns null-equivalent identity
 *  when `up` is (anti)parallel to Z (Unity picks an arbitrary basis; the view
 *  then keeps whatever it had — we return null via the caller's epsilon path). */
export function lookRotationForwardZ(up: V3): Q4 | null {
  // x = normalize(cross(up, forward)), y = cross(forward, x)
  // cross(up, (0,0,1)) = (up.y, -up.x, 0)
  const xl = Math.hypot(up.y, up.x);
  if (xl < 1e-6) return null;
  const xx = up.y / xl;
  const xy = -up.x / xl;
  // y = cross((0,0,1), x) = (-x.y, x.x, 0)
  const yx = -xy;
  const yy = xx;
  // rotation matrix columns (x, y, z=(0,0,1)); rotation about Z by angle a:
  //   x = (cos a, sin a), y = (-sin a, cos a)
  const cosA = xx;
  const sinA = xy;
  void yx;
  void yy;
  const half = Math.atan2(sinA, cosA) / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

/** Unity quaternion → three-space (mirror x): (x, -y, -z, w). */
export function mirrorQuat4(q: Q4): Q4 {
  return { x: q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Sim integration step of GameCoreProjectileTrajectory.tick (for tests/previews):
 *  v += (0, g dt, 0); p += v dt. */
export function integrateStep(pos: V3, vel: V3, gravity: number, dt: number): { pos: V3; vel: V3 } {
  const vy = f(vel.y + f(f(gravity) * f(dt)));
  const nv = { x: vel.x, y: vy, z: vel.z };
  return {
    vel: nv,
    pos: { x: f(pos.x + f(nv.x * dt)), y: f(pos.y + f(nv.y * dt)), z: f(pos.z + f(nv.z * dt)) },
  };
}
