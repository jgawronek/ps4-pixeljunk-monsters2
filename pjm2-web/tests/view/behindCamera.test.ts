import { describe, expect, it } from 'vitest';
import {
  BEHIND_PARAMS, BehindCamera, angleBetween, clampAngle, deltaAngle, moveTowardsAngle, signedAngleDeg, smoothDamp, updateDofFocus,
  type BehindTarget, type DofFocusState,
} from '../../src/view/stage/BehindCamera';

const still = (x = 0, z = 0): BehindTarget => ({ pos: { x, y: 0, z }, forward: { x: 0, z: 1 }, inputMoving: false, inputDir: { x: 0, z: 0 }, grounded: true });

describe('unity math helpers', () => {
  it('deltaAngle / moveTowardsAngle take the short way round', () => {
    expect(deltaAngle(350, 10)).toBeCloseTo(20, 6);
    expect(moveTowardsAngle(350, 10, 5)).toBeCloseTo(355, 6);
    expect(moveTowardsAngle(350, 10, 30)).toBe(10);
  });
  it('clampAngle wraps then clamps (Q4.CameraHelper.ClampAngle)', () => {
    expect(clampAngle(370, -15, 15)).toBe(10);
    expect(clampAngle(-200, -90, 90)).toBe(90);
  });
  it('smoothDamp converges without overshoot', () => {
    const v = { v: 0 };
    let x = 0;
    for (let i = 0; i < 120; i++) x = smoothDamp(x, 1, v, 0.15, 1 / 60);
    expect(x).toBeGreaterThan(0.999);
    expect(x).toBeLessThanOrEqual(1);
  });
  it('signedAngleDeg: camera looking +z, player facing +x -> yaw must DEcrease by 90 (forward = (sin -yaw, cos -yaw))', () => {
    expect(signedAngleDeg({ x: 0, z: 1 }, { x: 1, z: 0 })).toBeCloseTo(-90, 6);
    expect(signedAngleDeg({ x: 0, z: 1 }, { x: -1, z: 0 })).toBeCloseTo(90, 6);
    expect(angleBetween({ x: 0, z: 1 }, { x: 0, z: -1 })).toBeCloseTo(180, 6);
  });
});

describe('UpdateDepthOfField focus animation (GameCameraBehind @0043f0d0)', () => {
  const fresh = (factor = 0): DofFocusState => ({ focusForward: 0, fovOffset: 0, factor });

  it('shipped boom (1.75 m < autoDOFDistanceMin 2): focus = autoDOFFocusMin = 2, FOV = base 50', () => {
    const r = updateDofFocus(BEHIND_PARAMS, fresh(), 1.75, 0.016)!;
    expect(r.focusDistance).toBeCloseTo(2, 6);
    expect(r.fov).toBe(50);
  });
  it('focus follows the boom distance between autoDOFDistanceMin/Max', () => {
    expect(updateDofFocus(BEHIND_PARAMS, fresh(), 3.5, 0)!.focusDistance).toBeCloseTo(3.5, 6); // k = 0.5 -> 2 + 0.5*3
    expect(updateDofFocus(BEHIND_PARAMS, fresh(), 9, 0)!.focusDistance).toBeCloseTo(5, 6);
    expect(updateDofFocus({ ...BEHIND_PARAMS, autoDepthOfField: false }, fresh(), 1.75, 0)!.focusDistance).toBe(5);
  });
  it('FocusForward: +80 m/s * factor, clamped 0..20, and back down for a negative factor', () => {
    const st = fresh(1);
    expect(updateDofFocus(BEHIND_PARAMS, st, 1.75, 0.1)!.focusDistance).toBeCloseTo(2 + 8, 6);
    for (let i = 0; i < 10; i++) updateDofFocus(BEHIND_PARAMS, st, 1.75, 0.1);
    expect(st.focusForward).toBe(20);
    st.factor = -1;
    for (let i = 0; i < 10; i++) updateDofFocus(BEHIND_PARAMS, st, 1.75, 0.1);
    expect(st.focusForward).toBe(0);
  });
  it('FocusForward FOV: eases to -5 deg (never past), returns to 0', () => {
    const st = fresh(1);
    for (let i = 0; i < 400; i++) { const r = updateDofFocus(BEHIND_PARAMS, st, 1.75, 1 / 60)!; expect(r.fov).toBeLessThanOrEqual(50); expect(r.fov).toBeGreaterThanOrEqual(45); }
    expect(st.fovOffset).toBeGreaterThanOrEqual(-5);
    expect(st.fovOffset).toBeLessThan(-4.9);
    st.factor = -1;
    for (let i = 0; i < 600; i++) updateDofFocus(BEHIND_PARAMS, st, 1.75, 1 / 60);
    expect(st.fovOffset).toBeGreaterThan(-0.01);
  });
  it('autoDOFFocusMax == -1 leaves the profile untouched (null)', () => {
    expect(updateDofFocus({ ...BEHIND_PARAMS, autoDOFFocusMax: -1 }, fresh(), 1.75, 0.016)).toBeNull();
  });
});

describe('BehindCamera', () => {
  it('sits 1.75 m behind the player, 0.8 m above, looking at him (yaw 0, pitch 0)', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    const pose = cam.update(0.016, still());
    expect(pose.lookAt.y).toBeCloseTo(0.8, 6);
    expect(pose.position.x).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-1.75, 6);
    expect(pose.position.y).toBeCloseTo(0.8, 6);
    expect(pose.fov).toBe(50);
    expect(pose.focusDistance).toBeCloseTo(2, 6);
  });
  it('follows the player with the SmoothDamp lag (0.15 s horizontal)', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    const one = cam.update(1 / 60, still(5, 0));
    expect(one.lookAt.x).toBeGreaterThan(0);
    expect(one.lookAt.x).toBeLessThan(2);
    let p = one;
    for (let i = 0; i < 120; i++) p = cam.update(1 / 60, still(5, 0));
    expect(p.lookAt.x).toBeCloseTo(5, 2);
  });
  it('horizontal rotate input: speed ramps with cameraRotateAcceleration 3.5/s then 120 deg/s', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    cam.setRotateInput(1, 0);
    for (let i = 0; i < 60; i++) cam.update(1 / 60, still());
    // ramp 0 -> 1 takes 1/3.5 s; area under the ramp = 0.143 s*120, then (1 - 0.286) s * 120
    expect(cam.yaw).toBeGreaterThan(95);
    expect(cam.yaw).toBeLessThan(105);
    // yaw is applied as Euler(-pitch, -yaw): a positive yaw swings the camera to the player's LEFT side (position x grows... forward turns to -x)
    const pose = cam.update(1 / 60, still());
    expect(pose.forwardYawRad).toBeLessThan(0);
  });
  it('vertical rotate is limited to viewLimit +- overRotateLimit (15 +- 25) and eases back inside the limits on release', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    cam.setRotateInput(0, 1);
    for (let i = 0; i < 600; i++) cam.update(1 / 60, still());
    expect(cam.pitch).toBeGreaterThan(15);
    expect(cam.pitch).toBeLessThanOrEqual(40.0001);
    cam.setRotateInput(0, 0);
    for (let i = 0; i < 600; i++) cam.update(1 / 60, still());
    expect(cam.pitch).toBeLessThan(15.5);
  });
  it('auto-rotation: walking sideways swings the camera toward the walking direction; walking away does not', () => {
    const side = new BehindCamera();
    side.snap(still());
    const moving: BehindTarget = { pos: { x: 0, y: 0, z: 0 }, forward: { x: 1, z: 0 }, inputMoving: true, inputDir: { x: 1, z: 0 }, grounded: true };
    for (let i = 0; i < 120; i++) side.update(1 / 60, moving);
    expect(side.yaw).toBeLessThan(-5); // forward = (sin(-yaw), cos(-yaw)) turns toward +x
    const away = new BehindCamera();
    away.snap(still());
    const walk: BehindTarget = { ...still(), inputMoving: true, inputDir: { x: 0, z: 1 } };
    for (let i = 0; i < 120; i++) away.update(1 / 60, walk);
    expect(away.yaw).toBe(0);
  });
  it('forceToPlayerBack (InheritCamera): the boom ends up looking along the player facing', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    cam.forceToPlayerBack({ ...still(), forward: { x: 1, z: 0 } });
    const pose = cam.update(0, { ...still(), forward: { x: 1, z: 0 } });
    expect(Math.sin(pose.forwardYawRad)).toBeCloseTo(1, 6);
    expect(pose.position.x).toBeCloseTo(-1.75, 3);
  });
  it('switch-out animation swings the camera up and out, and the restore puts the saved values back', () => {
    const cam = new BehindCamera();
    cam.snap(still());
    cam.update(1 / 60, still());
    cam.beginSwitchOut();
    for (let i = 0; i < 18; i++) { cam.switchOutStep(1 / 60, 2, 5, 0); cam.update(1 / 60, still()); }
    expect(cam.pitch).toBeLessThan(-15); // camera above the player (negative pitch)
    expect(cam.distance).toBeGreaterThan(5);
    cam.endSwitchOut();
    expect(cam.pitch).toBe(0);
    expect(cam.distance).toBeCloseTo(1.75, 6);
    expect(cam.params.viewLimitMin).toBe(-15);
    expect(cam.params.distanceMax).toBe(1.75);
  });
});
