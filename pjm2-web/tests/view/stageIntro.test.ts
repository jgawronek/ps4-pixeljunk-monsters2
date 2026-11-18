// Stage intro (Q4.GameCameraIntro / ChibiIntro / StartOutline/Countdown sequence) headless tests.
// Fixture = the REAL extracted rig of 3d_stage_001 (tools/stages/extract_stage_intro.py).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cameraWorldPose, clipLength, evalClipCurve, introRigUrl, quatRotate, type StageIntroRig,
} from '../../src/view/intro/IntroRig';
import {
  INTRO_CONST, StageIntroTimeline, countdownDigitForIndex, countdownIndex, inAlpha, outAlpha,
} from '../../src/view/intro/IntroTimeline';
import { ChibiIntroRunner, CHIBI_INTRO_CONST, mulberry32 } from '../../src/view/intro/ChibiIntroRunner';

const rig: StageIntroRig = JSON.parse(
  readFileSync(new URL('../../public/assets/data/intro/3d_stage_001_env.json', import.meta.url), 'utf8'),
);

/** Step the timeline in fixed 1/60 s frames until pred or maxT; returns elapsed. */
function run(tl: StageIntroTimeline, sim: () => boolean, maxT: number, pred: () => boolean): number {
  const dt = 1 / 60;
  let t = 0;
  while (t < maxT && !pred()) { tl.update(dt, sim()); t += dt; }
  return t;
}

describe('rig data (extracted)', () => {
  it('has the two authored cuts in sibling order + 3 chibi paths', () => {
    expect(rig.cameras.map((c) => c.name)).toEqual(['GameCameraIntro01', 'GameCameraIntro02']);
    expect(rig.chibiIntro?.paths.length).toBe(3);
    expect(rig.introRoot.world.pos).toEqual([0, 0, 0]);
    expect(introRigUrl('3d_stage_001')).toBe('/assets/data/intro/3d_stage_001_env.json');
  });

  it('cut 1 is a static 7 s shot, FOV 60 (constant clip)', () => {
    const c = rig.cameras[0];
    expect(clipLength(c.clip)).toBeCloseTo(7.0, 6);
    expect(c.fov).toBe(60);
    const a = cameraWorldPose(rig, c, 0).pos, b = cameraWorldPose(rig, c, 6.9).pos;
    expect(b).toEqual(a);
    expect(a.x).toBeCloseTo(21.501, 3);
    // forward = rot * +Z  ~ (0.959, -0.115, -0.258): looks along +x, slightly down
    const f = quatRotate(cameraWorldPose(rig, c, 0).rot, { x: 0, y: 0, z: 1 });
    expect(f.x).toBeCloseTo(0.959, 2);
    expect(f.y).toBeCloseTo(-0.115, 2);
    expect(f.z).toBeCloseTo(-0.258, 2);
  });

  it('cut 2 is a 30.5 s streamed fly-over, FOV 20, 45 deg pitch, ending above the hut', () => {
    const c = rig.cameras[1];
    expect(clipLength(c.clip)).toBeCloseTo(30.5, 6);
    expect(c.fov).toBe(20);
    const p0 = cameraWorldPose(rig, c, 0).pos;
    expect([p0.x, p0.y, p0.z].map((v) => +v.toFixed(2))).toEqual([24.77, 12.75, 3.75]);
    const pe = cameraWorldPose(rig, c, 30.5).pos;
    expect([pe.x, pe.y, pe.z].map((v) => +v.toFixed(2))).toEqual([0, 10.71, 12.07]);
    const f = quatRotate(cameraWorldPose(rig, c, 0).rot, { x: 0, y: 0, z: 1 });
    expect(f.y).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it('streamed curves are continuous at every key frame', () => {
    const clip = rig.cameras[1].clip;
    const times = new Set<number>();
    for (const keys of Object.values(clip.streamed)) for (const k of keys) if (k.t >= 0) times.add(k.t);
    expect(times.size).toBeGreaterThan(10);
    for (const t of times) {
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(evalClipCurve(clip, i, t - 1e-4) - evalClipCurve(clip, i, t))).toBeLessThan(0.02);
      }
    }
  });
});

describe('fade formulas (GameCameraSwitchBlackInOut.OnRenderImage)', () => {
  const sw = rig.cameras[0].switch; // in .4 out .3 fadeIn 0 fadeOut 0
  it('out-phase fades linearly to black over switchOutTime', () => {
    expect(outAlpha(sw, 0)).toBe(1);
    expect(outAlpha(sw, 0.15)).toBeCloseTo(0.5, 5);
    expect(outAlpha(sw, 0.3)).toBeCloseTo(0, 5);
  });
  it('in-phase mixes normalised factor with seconds (verbatim): 0.4 s cam is fully visible after 0.16 s', () => {
    expect(inAlpha(sw, 0)).toBe(0);
    expect(inAlpha(sw, 0.16)).toBeCloseTo(1, 5);
    expect(inAlpha(rig.cameras[1].switch, 0.5)).toBeCloseTo(0.5, 5); // switchIn 1.0 -> linear 1 s
  });
});

describe('countdown index (StartCountdownController.UpdateCountdown)', () => {
  it('Clamp(3 - (int)(t+1), 0, 3)', () => {
    expect([3.5, 2.5, 2.0].map(countdownIndex)).toEqual([0, 0, 0]);
    expect([1.99, 1.0].map(countdownIndex)).toEqual([1, 1]);
    expect([0.99, 0.0].map(countdownIndex)).toEqual([2, 2]);
    expect([-0.05].map(countdownIndex)).toEqual([3]);
    expect([0, 1, 2, 3].map(countdownDigitForIndex)).toEqual([3, 2, 1, 0]);
  });
});

describe('StageIntroTimeline', () => {
  it('starts black on cut 1, fades in, then loops cut1 -> cut2 -> cut1 until the sim says finished', () => {
    const tl = new StageIntroTimeline(rig);
    expect(tl.blackAlpha).toBe(1);
    const cuts: number[] = [];
    const tl2 = new StageIntroTimeline(rig, { onCutSwap: (i) => cuts.push(i) });
    run(tl2, () => false, 7.0 + 0.3 + 30.5 + 0.3 + 1, () => cuts.length >= 2);
    expect(cuts).toEqual([1, 0]);
    expect(tl.camera.name).toBe('GameCameraIntro01');
    expect(tl.cameraPose()).not.toBeNull();
  });

  it('cut 1 switches out at 7.0 s and the swap lands 0.3 s later', () => {
    const swaps: number[] = [];
    const tl = new StageIntroTimeline(rig, { onCutSwap: () => swaps.push(tl.elapsed) });
    run(tl, () => false, 9, () => swaps.length > 0);
    expect(swaps[0]).toBeGreaterThan(7.25);
    expect(swaps[0]).toBeLessThan(7.45);
    expect(tl.camera.name).toBe('GameCameraIntro02');
    expect(tl.animTime).toBeLessThan(0.05); // animator restarted
  });

  it('confirm is refused during the 1.0 s lock-out, accepted once, and never twice', () => {
    const tl = new StageIntroTimeline(rig);
    tl.update(0.5, false);
    expect(tl.confirm()).toBe(false);
    tl.update(0.6, false);
    expect(tl.lockout).toBe(0);
    expect(tl.confirm()).toBe(true);
    expect(tl.confirm()).toBe(false);
  });

  it('full skip sequence: hide 1.0 s -> hand-off swap (+0.3 s fade-out) -> 3.5 s countdown -> start call 4 s -> HUD', () => {
    const ev: string[] = [];
    const steps: number[] = [];
    const t0 = { v: 0 };
    const tl = new StageIntroTimeline(rig, {
      onHandoffSwap: () => ev.push(`swap@${(tl.elapsed - t0.v).toFixed(1)}`),
      onCountdownStep: (i) => steps.push(i),
      onStartCall: () => ev.push(`call@${(tl.elapsed - t0.v).toFixed(1)}`),
      onHudShow: () => ev.push(`hud@${(tl.elapsed - t0.v).toFixed(1)}`),
    });
    let simFinished = false;
    run(tl, () => simFinished, 3, () => tl.lockout === 0);
    expect(tl.confirm()).toBe(true);
    t0.v = tl.elapsed;
    simFinished = true; // sim processed IntroSequenceSkipCommand
    expect(tl.isIntroSequence).toBe(true);
    run(tl, () => simFinished, 12, () => tl.finished);
    expect(tl.finished).toBe(true);
    expect(steps).toEqual([0, 1, 2, 3]);
    // hide 1.0 + out 0.3 = swap at 1.3; countdown 3.6 s from 1.0 => call at 4.6; hud 4.0 s later
    const n = (e: string): number => parseFloat(e.split('@')[1]);
    expect(ev[0].startsWith('swap')).toBe(true);
    expect(Math.abs(n(ev[0]) - 1.3)).toBeLessThan(0.11);
    expect(Math.abs(n(ev[1]) - 4.6)).toBeLessThan(0.11);
    expect(Math.abs(n(ev[2]) - 8.6)).toBeLessThan(0.11);
    expect(tl.hudSlide).toBe(1);
  });

  it('follow camera fades in after the swap and the intro releases the pose', () => {
    const tl = new StageIntroTimeline(rig);
    let sim = false;
    run(tl, () => sim, 3, () => tl.lockout === 0);
    tl.confirm(); sim = true;
    run(tl, () => sim, 5, () => tl.followActive);
    expect(tl.followActive).toBe(true);
    expect(tl.cameraPose()).toBeNull();
    expect(tl.blackAlpha).toBe(1); // swap lands on black
    tl.update(0.16, sim);
    expect(tl.blackAlpha).toBeCloseTo(0, 3);
  });

  it('after the sim finished no further cut switch happens (GameCameraIntro.Update gate); hand-off leaves from the current cut', () => {
    const tl = new StageIntroTimeline(rig);
    let sim = false;
    run(tl, () => sim, 10, () => tl.elapsed > 6.7); // cut 1 would switch at 7.0
    tl.confirm(); sim = true;
    const names = new Set<string>();
    while (!tl.followActive && tl.elapsed < 15) { tl.update(1 / 60, sim); names.add(tl.camera.name); }
    expect(tl.followActive).toBe(true);
    expect([...names]).toEqual(['GameCameraIntro01']);
  });

  it('IsIntroSequence ends when the start call shows (pause allowed again)', () => {
    const tl = new StageIntroTimeline(rig);
    let sim = false;
    run(tl, () => sim, 3, () => tl.lockout === 0);
    tl.confirm(); sim = true;
    run(tl, () => sim, 8, () => tl.stage === 'call');
    expect(tl.isIntroSequence).toBe(false);
    expect(INTRO_CONST.START_CALL_SECONDS).toBe(4.0);
  });
});

describe('ChibiIntroRunner (PathRunner port)', () => {
  const ci = rig.chibiIntro!;
  it('starts each chibi at ChibiIntro position + path[0] with runDelay chain 0.016 + Random(0.075,0.15)', () => {
    const r = new ChibiIntroRunner(ci, 7);
    const s = ci.world.pos;
    ci.paths.forEach((p, i) => {
      expect(r.chibis[i].pos.x).toBeCloseTo(s[0] + p[0][0], 5);
      expect(r.chibis[i].pos.z).toBeCloseTo(s[2] + p[0][2], 5);
    });
    expect(r.runners[0].runDelay).toBeCloseTo(0.016, 5);
    for (let i = 1; i < 3; i++) {
      const d = r.runners[i].runDelay - r.runners[i - 1].runDelay;
      expect(d).toBeGreaterThanOrEqual(0.075 - 1e-6);
      expect(d).toBeLessThanOrEqual(0.15 + 1e-6);
    }
  });

  it('runs the path at MoveSpeed, slows in the last 0.25 segment, never overshoots, then enables panic hops', () => {
    const r = new ChibiIntroRunner(ci, 3);
    const last = ci.paths[0].length - 1;
    let prev = 0;
    for (let i = 0; i < 60 * 15; i++) {
      r.update(1 / 60);
      for (const pr of r.runners) expect(pr.pathTime).toBeLessThanOrEqual(last + 1e-6);
      prev = r.runners[0].pathTime;
    }
    expect(prev).toBeGreaterThan(last - 0.1);
    for (const c of r.chibis) {
      expect(c.panicEnabled).toBe(true);
      expect(c.panicMinVel).toBe(3);
      expect(c.panicMaxVel).toBe(7);
      expect(c.destYawDeg).toBe(296); // EndFacingAngle set during the slow-down
    }
    const e = r.chibis[0].destPos;
    const endP = ci.paths[0][last];
    expect(Math.hypot(e.x - (ci.world.pos[0] + endP[0]), e.z - (ci.world.pos[2] + endP[2]))).toBeLessThan(0.5);
  });

  it('is deterministic for a seed', () => {
    const a = new ChibiIntroRunner(ci, 11), b = new ChibiIntroRunner(ci, 11);
    for (let i = 0; i < 300; i++) { a.update(1 / 30); b.update(1 / 30); }
    expect(a.chibis.map((c) => c.pos)).toEqual(b.chibis.map((c) => c.pos));
    expect(mulberry32(5)()).toBe(mulberry32(5)());
    expect(CHIBI_INTRO_CONST.SLOWDOWN_SCALE).toBe(4);
  });
});

describe('intro chibis turn to EndFacingAngle after stopping', () => {
  it('ends facing 296 deg (-64) once the run is over', () => {
    const r = new ChibiIntroRunner(rig.chibiIntro as never, 1, () => 0);
    for (let i = 0; i < 60 * 14; i++) r.update(1 / 60);
    for (const c of r.chibis) {
      const d = ((((c.motor.yawDeg - 296) % 360) + 540) % 360) - 180;
      expect(Math.abs(d)).toBeLessThan(1);
    }
  });
});

describe('intro chibis face the intro camera (stage 2: authored EndFacingAngle points away)', () => {
  it('ends looking at cut-1 camera', () => {
    const rig2: StageIntroRig = JSON.parse(readFileSync(new URL('../../public/assets/data/intro/3d_stage_002_env.json', import.meta.url), 'utf8'));
    const cam = cameraWorldPose(rig2, rig2.cameras[0], 0).pos;
    const r = new ChibiIntroRunner(rig2.chibiIntro as never, 1, (_x, _z, fy) => fy, null, cam);
    for (let i = 0; i < 60 * 20; i++) r.update(1 / 60);
    for (const c of r.chibis) {
      const want = ChibiIntroRunner.endFacingFor(cam, { x: c.pos.x, z: c.pos.z });
      expect(Math.abs(((((c.motor.yawDeg - want) % 360) + 540) % 360) - 180)).toBeLessThan(8);
    }
  });
});
