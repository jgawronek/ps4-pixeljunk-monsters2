// src/view/intro/IntroRig.ts
// Serialized STAGE INTRO RIG (per stage scene) + pure evaluation of its camera clips.
// Source: tools/stages/extract_stage_intro.py -> public/assets/data/intro/<scene>.json
// (GameCameraIntro cuts incl. their Animator clip, ChibiIntro run paths, camera switch
// fade timings).  All numbers are Unity LEFT-HANDED world coordinates, unconverted.
// See docs/STAGE_INTRO_ANALYSIS.md for the evidence of every field.
//
// No three.js / DOM here: everything is headless-testable.

export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

export interface RigTRS { pos: [number, number, number]; rot: [number, number, number, number]; scale: [number, number, number] }

/** GameCameraSwitchBlackInOut serialized fade timings (@00445xxx). */
export interface RigSwitch {
  switchInTime: number;
  switchOutTime: number;
  fadeInTime: number;
  fadeOutTime: number;
  fovChange?: number;
  fovZoomSpeed?: number;
}

/** One StreamedClip key frame of one curve: value(t) = ((a*dt+b)*dt+c)*dt+d, dt = t - key.t. */
export interface RigClipKey { t: number; a: number; b: number; c: number; d: number }

export interface RigClip {
  name: string;
  sampleRate: number;
  start: number;
  stop: number;
  loop: boolean;
  curveCounts: { streamed: number; dense: number; constant: number };
  streamed: Record<string, RigClipKey[]>;
  constant: number[];
}

export interface RigCamera {
  name: string;
  siblingIndex: number;
  local: RigTRS;
  fov: number;
  near: number;
  far: number;
  startDelay: number;
  switch: RigSwitch;
  clip: RigClip;
}

export interface RigChibiIntro {
  name: string;
  world: RigTRS;
  runDelay: number;
  jumpDelay: number;
  faceAngleRange: number;
  panicJumpMinVel: number;
  panicJumpMaxVel: number;
  moveSpeed: number;
  endFacingAngle: number;
  paths: number[][][];
}

export interface StageIntroRig {
  scene: string;
  introRoot: { name: string; world: RigTRS; childOrder: string[] };
  cameras: RigCamera[];
  chibiIntro: RigChibiIntro | null;
  handoffCamera?: { name: string; switch: RigSwitch };
}

// ---- tiny Unity-space quaternion/vector helpers (LH, unconverted) ------------------

export function quatMul(a: Q4, b: Q4): Q4 {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatRotate(q: Q4, v: V3): V3 {
  // v' = q * v * q^-1 (unit q)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function quatAngleAxisY(deg: number): Q4 {
  const h = (deg * Math.PI) / 360;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

const asQ = (r: [number, number, number, number]): Q4 => ({ x: r[0], y: r[1], z: r[2], w: r[3] });
const asV = (p: [number, number, number]): V3 => ({ x: p[0], y: p[1], z: p[2] });

// ---- clip evaluation ---------------------------------------------------------------

/** Animator state length (clip stop - start); the state is non-looping (m_Loop 0). */
export function clipLength(clip: RigClip): number {
  return clip.stop - clip.start;
}

/** Evaluate curve `idx` (0=x,1=y,2=z of the root `position` binding) at clip time t. */
export function evalClipCurve(clip: RigClip, idx: number, t: number): number {
  const keys = clip.streamed[String(idx)];
  if (keys !== undefined && keys.length > 0) {
    // last key frame at or before t (frames are stored in ascending time; the first is the
    // -FLT_MAX sentinel stored as t=-1 holding the initial constant)
    let k = keys[0];
    for (const key of keys) {
      if (key.t <= t) k = key;
      else break;
    }
    const dt = t - k.t;
    return ((k.a * dt + k.b) * dt + k.c) * dt + k.d;
  }
  const ci = idx - clip.curveCounts.streamed - clip.curveCounts.dense;
  return clip.constant[ci] ?? 0;
}

/** Local (IntroRoot-space) camera position at animator time t (seconds, clamped to the clip). */
export function sampleCameraLocalPos(cam: RigCamera, t: number): V3 {
  const tt = Math.max(0, Math.min(t, clipLength(cam.clip))) + cam.clip.start;
  return { x: evalClipCurve(cam.clip, 0, tt), y: evalClipCurve(cam.clip, 1, tt), z: evalClipCurve(cam.clip, 2, tt) };
}

/** World pose (Unity space) of an intro camera at animator time t. Rotation is NOT animated
 *  (the clip only binds `position`). */
export function cameraWorldPose(rig: StageIntroRig, cam: RigCamera, t: number): { pos: V3; rot: Q4; fov: number } {
  const rootQ = asQ(rig.introRoot.world.rot);
  const rootP = asV(rig.introRoot.world.pos);
  const rootS = rig.introRoot.world.scale;
  const lp = sampleCameraLocalPos(cam, t);
  const rp = quatRotate(rootQ, { x: lp.x * rootS[0], y: lp.y * rootS[1], z: lp.z * rootS[2] });
  return {
    pos: { x: rootP.x + rp.x, y: rootP.y + rp.y, z: rootP.z + rp.z },
    rot: quatMul(rootQ, asQ(cam.local.rot)),
    fov: cam.fov,
  };
}

/** Chibi intro runner start position = ChibiIntro transform world position (Awake: m_startPos). */
export function chibiIntroStart(rig: StageIntroRig): V3 | null {
  return rig.chibiIntro === null ? null : asV(rig.chibiIntro.world.pos);
}

export function chibiIntroRotation(rig: StageIntroRig): Q4 | null {
  return rig.chibiIntro === null ? null : asQ(rig.chibiIntro.world.rot);
}

/** Per-stage rig URL: stage scene id ('3d_stage_001' or '3d_stage_001_env') -> data file. */
export function introRigUrl(stageId: string, base = '/assets/data/intro/'): string {
  const id = stageId.endsWith('_env') ? stageId : `${stageId}_env`;
  return `${base}${id}.json`;
}

export async function loadIntroRig(stageId: string, fetchImpl: typeof fetch = fetch): Promise<StageIntroRig | null> {
  try {
    const r = await fetchImpl(introRigUrl(stageId));
    if (!r.ok) return null;
    return (await r.json()) as StageIntroRig;
  } catch {
    return null;
  }
}
