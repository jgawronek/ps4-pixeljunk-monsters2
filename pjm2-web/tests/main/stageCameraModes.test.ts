import { describe, expect, it } from 'vitest';
import { StageCamera } from '../../src/view/stage/StageCamera';
import { behindInputToUnity, CAMERA_KEYS, StageCameraModes, stickFromKeys } from '../../src/main/stageCameraModes';

describe('stage camera controls', () => {
  it('stick keys: J/L = x, I/K = y', () => {
    expect(stickFromKeys(new Set([CAMERA_KEYS.rotateRight]))).toEqual({ x: 1, y: 0 });
    expect(stickFromKeys(new Set([CAMERA_KEYS.rotateLeft, CAMERA_KEYS.rotateUp]))).toEqual({ x: -1, y: 1 });
    expect(stickFromKeys(new Set([CAMERA_KEYS.rotateLeft, CAMERA_KEYS.rotateRight]))).toEqual({ x: 0, y: 0 });
  });

  it('behind-camera input mapping is relative to the boom yaw (Unity: forward (sin a, cos a), right (cos a, -sin a))', () => {
    const f = behindInputToUnity(0, 1, 0);
    expect(f.x).toBeCloseTo(0, 6); expect(f.z).toBeCloseTo(1, 6);
    const r = behindInputToUnity(1, 0, 0);
    expect(r.x).toBeCloseTo(1, 6); expect(r.z).toBeCloseTo(0, 6);
    const f90 = behindInputToUnity(0, 1, Math.PI / 2); // camera looking along +x
    expect(f90.x).toBeCloseTo(1, 6); expect(f90.z).toBeCloseTo(0, 6);
    const r90 = behindInputToUnity(1, 0, Math.PI / 2); // its right is -z
    expect(r90.x).toBeCloseTo(0, 6); expect(r90.z).toBeCloseTo(-1, 6);
  });

  it('Q switches TopDown -> Behind (0.3 s out + fade in), Behind drives the camera and DoF, Q again returns', () => {
    const cam = new StageCamera({ keyboardPan: false, edgeMargin: 0, fov: 22.5, pitchDeg: 45, yawDeg: 0, distance: 30, minDistance: 30, maxDistance: 30 });
    const keys = new Set<string>();
    const modes = new StageCameraModes({ stageCamera: cam, keys, blocked: () => false, player: () => ({ x: 0, y: 0, z: 0 }) });
    expect(modes.mode).toBe('top');
    expect(modes.dofSettings()).toBeNull();
    expect(modes.onKeyDown('KeyQ', false)).toBe(true);
    for (let i = 0; i < 90; i++) { cam.update(1 / 60); modes.update(1 / 60); }
    expect(modes.mode).toBe('behind');
    const dof = modes.dofSettings()!;
    expect(dof.focusDistance).toBeCloseTo(2, 3);
    expect(dof.aperture).toBe(3.5);
    expect(cam.camera.fov).toBeCloseTo(50, 3);
    // facing +z by default: boom 1.75 m behind (z = -1.75), 0.8 m up
    expect(cam.camera.position.z).toBeCloseTo(-1.75, 1);
    expect(cam.camera.position.y).toBeCloseTo(0.8, 1);
    // F pushes the focus out
    keys.add(CAMERA_KEYS.focusForward);
    for (let i = 0; i < 30; i++) { cam.update(1 / 60); modes.update(1 / 60); }
    expect(modes.dofSettings()!.focusDistance).toBeCloseTo(22, 3); // 2 m + dofFocusForwardDelta 20 m
    keys.delete(CAMERA_KEYS.focusForward);
    // back
    expect(modes.onKeyDown('KeyQ', false)).toBe(true);
    for (let i = 0; i < 90; i++) { cam.update(1 / 60); modes.update(1 / 60); }
    expect(modes.mode).toBe('top');
    expect(modes.dofSettings()).toBeNull();
    expect(cam.camera.fov).toBeCloseTo(22.5, 3);
    modes.dispose();
  });

  it('ignores the switch key while blocked (intro / menus)', () => {
    const cam = new StageCamera({ keyboardPan: false, edgeMargin: 0, fov: 22.5, pitchDeg: 45, yawDeg: 0 });
    const modes = new StageCameraModes({ stageCamera: cam, keys: new Set(), blocked: () => true, player: () => ({ x: 0, y: 0, z: 0 }) });
    expect(modes.onKeyDown('KeyQ', false)).toBe(false);
    expect(modes.sw.switching).toBe(false);
  });
});
