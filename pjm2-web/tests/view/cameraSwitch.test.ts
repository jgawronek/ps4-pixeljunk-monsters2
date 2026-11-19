import { describe, expect, it } from 'vitest';
import { CameraSwitch, SWITCH_BEHIND, SWITCH_TOPDOWN, topDownSwitchOutFov } from '../../src/view/stage/CameraSwitch';

describe('CameraSwitch (CameraManager.SwitchCamera + GameCameraSwitchBlackInOut)', () => {
  it('top -> behind: out phase lasts switchOutTime (0.3 s), swaps once, then fades in', () => {
    const sw = new CameraSwitch('top');
    expect(sw.request()).toBe(true);
    expect(sw.switching).toBe(true);
    let swappedFrames = 0, swapAt = -1, t = 0, maxFade = 0;
    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      const s = sw.update(1 / 60);
      maxFade = Math.max(maxFade, s.fade);
      if (s.swapped) { swappedFrames++; swapAt = t; }
    }
    expect(swappedFrames).toBe(1);
    expect(swapAt).toBeGreaterThan(0.29);
    expect(swapAt).toBeLessThan(0.33);
    expect(maxFade).toBe(1);
    expect(sw.mode).toBe('behind');
    expect(sw.switching).toBe(false);
  });
  it('ignores the input while a switch runs (CameraManager.SwitchCamera early-out)', () => {
    const sw = new CameraSwitch('top');
    sw.request();
    sw.update(0.1);
    expect(sw.request()).toBe(false);
  });
  it('behind -> top uses the Behind camera config for the out phase', () => {
    const sw = new CameraSwitch('behind');
    sw.request();
    expect(sw.outgoing).toBe(SWITCH_BEHIND);
    for (let i = 0; i < 60; i++) sw.update(1 / 60);
    expect(sw.mode).toBe('top');
    sw.request();
    expect(sw.outgoing).toBe(SWITCH_TOPDOWN);
  });
  it('black fade only rises in the last fadeOutTime (0.15 s) of the out phase', () => {
    const sw = new CameraSwitch('top');
    sw.request();
    expect(sw.update(0.14).fade).toBe(0);
    expect(sw.update(0.08).fade).toBeGreaterThan(0.3);
  });
  it('TopDown switch-out shrinks the FOV at 30 deg/s (fovChange)', () => {
    expect(topDownSwitchOutFov(22.5, SWITCH_TOPDOWN, 0.1)).toBeCloseTo(19.5, 6);
    expect(topDownSwitchOutFov(22.5, SWITCH_BEHIND, 0.1)).toBe(22.5);
    expect(topDownSwitchOutFov(2, SWITCH_TOPDOWN, 1)).toBe(1);
  });
});
