// tests/view/stageCamera.test.ts
// StageCamera + CameraFollow against the SERIALIZED stage camera evidence:
// scene-webp.json node 889 "GameCameraTopDown(Real)" (pathId 176), Camera
// component pathId 4810 (fov 22.5 / near 0.3 / far 1000), GameCameraTopDown
// MonoBehaviour pathId 8192 (min/maxDistance 30, followSmoothTime 0.2,
// parallelMoveRange 7.8/5, chase 1000/10, return 3.5/5, wait 0.17).
// Behavior: decomp/decompiled/Q4.GameCameraTopDown.c (@004469b0 desired,
// @00447c00 SmoothDamp follow, @00447eb0 parallel machine, @00448df0/ea0 zoom).
// Node-only: three math, no DOM (attach()/edge-pan are never exercised).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { StageCamera, screenInputToUnity } from '../../src/view/stage/StageCamera';
import { CameraFollow } from '../../src/view/stage/CameraFollow';

const DT = 1 / 60;
const ORIGIN = { x: 0, y: 0, z: 0 };

/** Independent fp64 Unity SmoothDamp first-step reference (straight line). */
function smoothDampFirstStep(from: number, to: number, smoothTime: number, dt: number): number {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = from - to;
  const temp = (0 + omega * change) * dt;
  return to + (change + temp) * exp;
}

describe('StageCamera defaults (serialized evidence)', () => {
  it('fov/near/far/pitch/yaw/distance match node 889 + Camera pathId 4810', () => {
    const rig = new StageCamera();
    expect(rig.camera.fov).toBe(22.5);
    expect(rig.camera.near).toBe(0.3);
    expect(rig.camera.far).toBe(1000);
    // Boom: pitch 45°, yaw 0 (Unity yaw 180° under the x-mirror), dist 30.
    const h = 30 * Math.SQRT1_2;
    expect(rig.camera.position.x).toBeCloseTo(0, 4);
    expect(rig.camera.position.y).toBeCloseTo(h, 4);
    expect(rig.camera.position.z).toBeCloseTo(h, 4);
    rig.camera.updateMatrixWorld();
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(0, 4);
    expect(dir.y).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(dir.z).toBeCloseTo(-Math.SQRT1_2, 4);
  });

  it('boom distance is FIXED at 30 (minDistance == maxDistance, Mono 8192)', () => {
    const rig = new StageCamera();
    expect(rig.follower.getCurrentDistance()).toBe(30);
    // Zoom input moves the rate but cannot change the distance.
    for (let i = 0; i < 120; i++) { rig.zoomOut(1, DT); rig.update(DT); }
    expect(rig.follower.getCurrentDistance()).toBe(30);
    for (let i = 0; i < 120; i++) { rig.zoomIn(1, DT); rig.update(DT); }
    expect(rig.follower.getCurrentDistance()).toBe(30);
    expect(rig.camera.position.distanceTo(rig.target)).toBeCloseTo(30, 4);
  });

  it('resize updates aspect and the projection matrix', () => {
    const rig = new StageCamera();
    const before = rig.camera.projectionMatrix.elements[0];
    rig.resize(2.5);
    expect(rig.camera.aspect).toBe(2.5);
    expect(rig.camera.projectionMatrix.elements[0]).not.toBe(before);
    expect(rig.camera.projectionMatrix.elements[0]).toBeCloseTo(before / 2.5, 6);
  });
});

describe('follow() — Unity SmoothDamp, no look-ahead, no clamp', () => {
  it('converges monotonically without overshoot (smoothTime 0.2)', () => {
    const rig = new StageCamera();
    const goal = { x: 10, y: 0, z: 5 };
    let prev = rig.target.distanceTo(new THREE.Vector3(goal.x, goal.y, goal.z));
    for (let i = 0; i < 240; i++) {
      rig.follow(goal, null, DT);
      rig.update(DT);
      const d = rig.target.distanceTo(new THREE.Vector3(goal.x, goal.y, goal.z));
      expect(d).toBeLessThanOrEqual(prev);
      // Strict while far enough that fp32 rounding can't plateau a frame.
      if (prev > 1e-4) expect(d).toBeLessThan(prev);
      // No overshoot on any axis (SmoothDamp overshoot guard).
      expect(rig.target.x).toBeLessThanOrEqual(goal.x);
      expect(rig.target.z).toBeLessThanOrEqual(goal.z);
      prev = d;
    }
    expect(rig.target.x).toBeCloseTo(goal.x, 3);
    expect(rig.target.z).toBeCloseTo(goal.z, 3);
  });

  it('first step + velocity match the Unity SmoothDamp closed form', () => {
    const rig = new StageCamera();
    rig.follow({ x: 10, y: 0, z: 0 }, null, DT);
    const expected = smoothDampFirstStep(0, 10, 0.2, DT);
    expect(rig.target.x).toBeCloseTo(expected, 3);
    // vel = (0 − omega*temp)*exp with omega=10, temp=(10*(0−10))*dt.
    const omega = 2 / 0.2;
    const x = omega * DT;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const temp = (omega * (0 - 10)) * DT;
    expect(rig.follower.m_lookAtPosSmoothVel.x).toBeCloseTo((0 - omega * temp) * exp, 2);
    expect(rig.target.y).toBe(0);
    expect(rig.target.z).toBe(0);
  });

  it('NO velocity look-ahead: vel never shifts the desired point', () => {
    // GetDesiredLookatTarget @004469b0 has no velocity term — vel only gates
    // the parallel re-center, so identical trajectories are required.
    const a = new StageCamera();
    const b = new StageCamera();
    for (let i = 0; i < 60; i++) {
      const pos = { x: i * 0.1, y: 0, z: -i * 0.05 };
      a.follow(pos, { x: 4, z: -3 }, DT);
      b.follow(pos, null, DT);
      a.update(DT);
      b.update(DT);
      expect(Object.is(a.target.x, b.target.x)).toBe(true);
      expect(Object.is(a.target.y, b.target.y)).toBe(true);
      expect(Object.is(a.target.z, b.target.z)).toBe(true);
    }
  });

  it('follow() is NOT clamped to panBounds (original has no world clamp)', () => {
    const rig = new StageCamera({ panBounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });
    for (let i = 0; i < 240; i++) { rig.follow({ x: 100, y: 0, z: 100 }, null, DT); rig.update(DT); }
    expect(rig.target.x).toBeGreaterThan(90);
    expect(rig.target.z).toBeGreaterThan(90);
  });

  it('zoomRate floor 0.1 scales follow smoothTime (DAT_00b7b6d0)', () => {
    // smoothTime = max(zoomRate, 0.1) * 0.2. Below the floor the follow is
    // slower than the raw rate would give. NB: desired = pos * zoomRate
    // (FAITHFUL QUIRK), so at rate 0.05 the goal is 10*0.05 = 0.5.
    const target = new THREE.Vector3();
    const low = new CameraFollow(target, {});
    low.m_currentZoomRate = 0.05;
    low.m_destZoomRate = 0.05;
    low.follow({ x: 10, y: 0, z: 0 }, null, DT);
    expect(target.x).toBeCloseTo(smoothDampFirstStep(0, 0.5, 0.02, DT), 3);
    // Without the floor (smoothTime 0.05*0.2=0.01) the step would be larger.
    expect(target.x).toBeLessThan(smoothDampFirstStep(0, 0.5, 0.01, DT));
    // At rate 1: full goal, smoothTime 0.2.
    const high = new CameraFollow(new THREE.Vector3(), {});
    high.follow({ x: 10, y: 0, z: 0 }, null, DT);
    expect(high.getCurrentDistance()).toBe(30);
  });

  it('snap() jumps the target and zeroes the smoothing velocity', () => {
    const rig = new StageCamera();
    for (let i = 0; i < 10; i++) rig.follow({ x: 10, y: 0, z: 0 }, null, DT);
    expect(rig.follower.m_lookAtPosSmoothVel.length()).toBeGreaterThan(0);
    rig.snap({ x: 5, y: 0, z: 5 });
    expect(rig.target.toArray()).toEqual([5, 0, 5]);
    expect(rig.follower.m_lookAtPosSmoothVel.length()).toBe(0);
    // Next step equals a fresh rig starting from the same point.
    const fresh = new StageCamera();
    fresh.target.set(5, 0, 5);
    rig.follow({ x: 15, y: 0, z: 15 }, null, DT);
    fresh.follow({ x: 15, y: 0, z: 15 }, null, DT);
    expect(rig.target.toArray()).toEqual(fresh.target.toArray());
  });

  it('legacy external-lerp path still drives the rig (update never re-smooths)', () => {
    const rig = new StageCamera();
    rig.target.lerp(new THREE.Vector3(10, 0, 0), 0.5); // game.ts-style wiring
    rig.update(DT);
    expect(rig.target.toArray()).toEqual([5, 0, 0]);
    const h = 30 * Math.SQRT1_2;
    expect(rig.camera.position.x).toBeCloseTo(5, 4);
    expect(rig.camera.position.y).toBeCloseTo(h, 4);
    expect(rig.camera.position.z).toBeCloseTo(h, 4);
  });
});

describe('zoom clamps and dev distance range', () => {
  it('destZoomRate clamps to [0,1] (ZoomIn/Out @00448df0/@00448ea0)', () => {
    const rig = new StageCamera();
    rig.zoomOut(1000, DT);
    expect(rig.follower.m_destZoomRate).toBe(1);
    rig.zoomIn(1000, DT);
    expect(rig.follower.m_destZoomRate).toBe(0);
    rig.follower.setDestZoomRate(42);
    expect(rig.follower.m_destZoomRate).toBe(1);
    rig.follower.setDestZoomRate(-42);
    expect(rig.follower.m_destZoomRate).toBe(0);
    for (let i = 0; i < 300; i++) {
      rig.update(DT);
      expect(rig.follower.m_currentZoomRate).toBeGreaterThanOrEqual(0);
      expect(rig.follower.m_currentZoomRate).toBeLessThanOrEqual(1);
    }
  });

  it('dev override min/max gives a real distance zoom; initial rate from distance', () => {
    const rig = new StageCamera({ minDistance: 14, maxDistance: 75, distance: 40 });
    expect(rig.follower.getCurrentDistance()).toBeCloseTo(40, 4);
    for (let i = 0; i < 300; i++) { rig.zoomOut(10, DT); rig.update(DT); }
    expect(rig.follower.getCurrentDistance()).toBeCloseTo(75, 3);
    for (let i = 0; i < 300; i++) { rig.zoomIn(10, DT); rig.update(DT); }
    expect(rig.follower.getCurrentDistance()).toBeCloseTo(14, 3);
    expect(rig.camera.position.distanceTo(rig.target)).toBeCloseTo(14, 3);
  });

  it('dev manual pan clamps to panBounds', () => {
    const rig = new StageCamera();
    rig.panWorld(1000, 1000);
    expect(rig.target.x).toBe(62);
    expect(rig.target.z).toBe(64);
    rig.panWorld(-10000, -10000);
    expect(rig.target.x).toBe(-60);
    expect(rig.target.z).toBe(-64);
  });
});

describe('parallel move (right-stick pan, UpdateCameraTransform @00447eb0)', () => {
  it('idle player + stick input pans within ±range (chase 1000/10)', () => {
    const rig = new StageCamera();
    rig.setParallelInput(1, 0);
    let prev = 0;
    for (let i = 0; i < 300; i++) {
      rig.update(DT);
      rig.follow(ORIGIN, null, DT);
      expect(rig.follower.m_currentParallelDelta.x).toBeGreaterThanOrEqual(prev);
      prev = rig.follower.m_currentParallelDelta.x;
      expect(rig.target.x).toBeLessThanOrEqual(7.8 + 1e-6);
    }
    expect(rig.follower.m_currentParallelDelta.x).toBeCloseTo(7.8, 3);
    expect(rig.target.x).toBeCloseTo(7.8, 3);
    expect(rig.follower.m_currentParallelDelta.z).toBe(0);
  });

  it('vertical input is sign-flipped into the delta z slot (±5)', () => {
    // FAITHFUL QUIRK: (input.x*range.x, 0, −input.y*range.y), XOR 0x80000000.
    const rig = new StageCamera();
    rig.setParallelInput(0, 1);
    for (let i = 0; i < 300; i++) { rig.update(DT); rig.follow(ORIGIN, null, DT); }
    expect(rig.follower.m_currentParallelDelta.z).toBeCloseTo(-5, 3);
    expect(rig.follower.m_currentParallelDelta.x).toBe(0);
    expect(rig.target.z).toBeCloseTo(-5, 3);
  });

  it('re-centers when the stick is released mid-run (return 3.5/5), holds when idle', () => {
    const rig = new StageCamera();
    rig.setParallelInput(1, 0);
    for (let i = 0; i < 120; i++) { rig.update(DT); rig.follow(ORIGIN, null, DT); }
    expect(rig.follower.m_currentParallelDelta.x).toBeGreaterThan(7);
    // Stick HELD while running → pan keeps chasing (reset gate is EQ-zero).
    const heldWhileRunning = rig.follower.m_currentParallelDelta.x;
    for (let i = 0; i < 60; i++) { rig.update(DT); rig.follow(ORIGIN, { x: 1, z: 0 }, DT); }
    expect(rig.follower.m_currentParallelDelta.x).toBeCloseTo(heldWhileRunning, 3);
    // Stick released while running → after the 0.17s grace, delta eases to 0.
    rig.setParallelInput(0, 0);
    let prev = rig.follower.m_currentParallelDelta.x;
    for (let i = 0; i < 300; i++) {
      rig.update(DT);
      rig.follow(ORIGIN, { x: 1, z: 0 }, DT);
      expect(rig.follower.m_currentParallelDelta.x).toBeLessThanOrEqual(prev);
      prev = rig.follower.m_currentParallelDelta.x;
    }
    expect(rig.follower.m_currentParallelDelta.x).toBeLessThan(0.1);
    // Player idle, stick released → the pan HOLDS (idle re-center requires
    // the reset button → snap()).
    const held = rig.follower.m_currentParallelDelta.x;
    for (let i = 0; i < 120; i++) { rig.update(DT); rig.follow(ORIGIN, null, DT); }
    expect(Object.is(rig.follower.m_currentParallelDelta.x, held)).toBe(true);
    // Reset button equivalent clears it instantly.
    rig.snap();
    expect(rig.follower.m_currentParallelDelta.x).toBe(0);
  });

  it('CameraFollow can be driven standalone against a shared target', () => {
    const target = new THREE.Vector3();
    const cf = new CameraFollow(target, { minDistance: 30, maxDistance: 30 });
    cf.follow({ x: 6, y: 0, z: 0 }, null, DT);
    expect(target.x).toBeCloseTo(smoothDampFirstStep(0, 6, 0.2, DT), 3);
    expect(cf.getCurrentDistance()).toBe(30);
  });
});

describe('screenInputToUnity (camera-relative movement)', () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  it('zero input → zero direction', () => {
    expect(screenInputToUnity(0, 0, 0)).toEqual({ x: 0, z: 0 });
  });

  it('yaw 0 (faithful top-down, looks toward three −z): W moves into-screen', () => {
    // camera forward = three (0,−1) → unity (0,−1)
    const w = screenInputToUnity(0, 1, 0);
    expect(near(w.x, 0)).toBe(true);
    expect(near(w.z, -1)).toBe(true);
    // S = toward camera = unity +z
    expect(near(screenInputToUnity(0, -1, 0).z, 1)).toBe(true);
  });

  it('yaw 0: D moves screen-right (three +x → unity −x)', () => {
    const d = screenInputToUnity(1, 0, 0);
    expect(near(d.x, -1)).toBe(true);
    expect(near(d.z, 0)).toBe(true);
    expect(near(screenInputToUnity(-1, 0, 0).x, 1)).toBe(true); // A
  });

  it('output is normalized for any nonzero input', () => {
    for (const [ix, iz] of [[1, 1], [3, 4], [-2, 7], [0.3, -0.9]]) {
      const d = screenInputToUnity(ix, iz, 0);
      expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 9);
    }
  });

  it('yaw 90 rotates the basis (W → unity +x, D → unity −z)', () => {
    // right three=(cos90,−sin90)=(0,−1)→unity(0,−1); forward three=(−1,0)→unity(1,0)
    const w = screenInputToUnity(0, 1, 90);
    expect(near(w.x, 1)).toBe(true);
    expect(near(w.z, 0)).toBe(true);
    const d = screenInputToUnity(1, 0, 90);
    expect(near(d.x, 0)).toBe(true);
    expect(near(d.z, -1)).toBe(true);
  });

  it('StageCamera.mapInput uses its own yaw (default 0)', () => {
    const cam = new StageCamera();
    const w = cam.mapInput(0, 1);
    expect(near(w.z, -1)).toBe(true); // matches yaw-0 forward
  });
});
