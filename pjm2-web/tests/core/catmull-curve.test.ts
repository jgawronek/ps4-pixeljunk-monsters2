// tests/core/catmull-curve.test.ts
// Tests for src/core/CatmullCurve.ts (port of Q4.CatmullCurve, @0x73f460..0x7407d0)
// and its integration with the REAL curve through CorePathMove.
// White-box probes (private table / private statics) use typed casts; the
// independent Catmull-Rom reference below is the Hermite form in fp64 — a
// DIFFERENT formula than the ported polynomial, so agreement is meaningful.

import { describe, expect, it } from 'vitest';

import { CatmullCurve, SegmentData } from '../../src/core/CatmullCurve';
import { CorePathMove } from '../../src/core/CorePathMove';
import { Vector3 } from '../../src/engine/math/Vector3';
import type { CatmullCurveContract } from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- helpers ----------------------------------------------------------------

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Private table probe (C# splineSegments is private; runtime access only). */
function table(c: CatmullCurve): SegmentData[] {
  return (c as unknown as { splineSegments: SegmentData[] }).splineSegments;
}
type EvalFn = (cp1: Vector3, p1: Vector3, p2: Vector3, cp2: Vector3, t: number) => Vector3;
const evalSeg: EvalFn = (
  CatmullCurve as unknown as { evaluateSplineSegment: EvalFn }
).evaluateSplineSegment;
const evalVel: EvalFn = (
  CatmullCurve as unknown as { evaluateSplineSegmentVelocity: EvalFn }
).evaluateSplineSegmentVelocity;

/** Independent uniform Catmull-Rom via Hermite basis (fp64, not the port's
 *  polynomial): tangents m1=(p2-cp1)/2, m2=(cp2-p1)/2. */
function crPoint(cp1: Vector3, p1: Vector3, p2: Vector3, cp2: Vector3, t: number): Vector3 {
  const out = new Vector3();
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  for (const k of ['x', 'y', 'z'] as const) {
    const m1 = (p2[k] - cp1[k]) / 2;
    const m2 = (cp2[k] - p1[k]) / 2;
    out[k] = h00 * p1[k] + h10 * m1 + h01 * p2[k] + h11 * m2;
  }
  return out;
}
function crVel(cp1: Vector3, p1: Vector3, p2: Vector3, cp2: Vector3, t: number): Vector3 {
  const out = new Vector3();
  const t2 = t * t;
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  for (const k of ['x', 'y', 'z'] as const) {
    const m1 = (p2[k] - cp1[k]) / 2;
    const m2 = (cp2[k] - p1[k]) / 2;
    out[k] = d00 * p1[k] + d10 * m1 + d01 * p2[k] + d11 * m2;
  }
  return out;
}
function expectV3Close(a: Vector3, b: Vector3, tol: number): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(tol);
}
function expectV3Exact(a: Vector3, b: Vector3): void {
  expect(Object.is(a.x, b.x)).toBe(true);
  expect(Object.is(a.y, b.y)).toBe(true);
  expect(Object.is(a.z, b.z)).toBe(true);
}

// ---- fixtures ---------------------------------------------------------------

/** Straight unit-spaced path along +X (4 nodes → 15 samples, length ≈ 3). */
const straightPts = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0)];
/** Curved path with distinct nodes (strictly increasing dist table). */
const curvedPts = [v(0, 0, 0), v(2, 0, 1), v(4, 1, 0), v(6, 1, 2), v(8, 0, 1)];
/** Low-curvature path for metric (arc-length) assertions: the chord-arc
 *  parameterization mismatch of the original scales with curvature. */
const gentlePts = [v(0, 0, 0), v(3, 0, 0.5), v(6, 0.5, 1), v(9, 0.5, 1.5), v(12, 0, 2)];
/** Degenerate: triple first node → node 0 has ALL control points identical,
 *  giving five zero-length chords (dist=0). With only two duplicates, node 0's
 *  cp2 = points[2] would leak the next point and the chords would be nonzero. */
const dupPts = [v(0, 0, 0), v(0, 0, 0), v(0, 0, 0), v(3, 0, 0)];

const straight = () => new CatmullCurve(7, straightPts, 0);
const curved = () => new CatmullCurve(9, curvedPts, 1);

// Deterministic LCG for jump tests (no Math.random — determinism convention).
function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

// ---- BuildCurveData / arc-length table --------------------------------------

describe('BuildCurveData (@0x73f550)', () => {
  it('builds 5*(N-1) samples with node indices, dist[0]=0, last length=0', () => {
    const c = curved();
    const t = table(c);
    expect(t.length).toBe(5 * (curvedPts.length - 1));
    expect(t[0].dist).toBe(0);
    expect(t[t.length - 1].length).toBe(0); // never written — no next sample
    for (let k = 0; k < t.length; k++) {
      expect(t[k].sourcePointIndex).toBe((k / 5) | 0);
      if (k > 0) expect(t[k].dist).toBeGreaterThanOrEqual(t[k - 1].dist);
    }
    // dist[k+1] = f(dist[k] + length[k]) — the exact accumulation order
    for (let k = 0; k < t.length - 1; k++) {
      expect(Object.is(t[k + 1].dist, f(t[k].dist + t[k].length))).toBe(true);
    }
    expect(c.curveLength).toBe(t[t.length - 1].dist);
  });

  it('node-boundary samples (t=0) equal the path points EXACTLY', () => {
    const c = curved();
    const t = table(c);
    for (let i = 0; i <= curvedPts.length - 2; i++) {
      expectV3Exact(t[5 * i].startPoint, curvedPts[i]);
    }
  });

  it('subsegment t uses fp32 division sub/5 (confirmed opcode; values equal sub*0.2f here)', () => {
    const c = straight();
    const t = table(c);
    // node 0, sub 3: x = t = 3/5 in fp32 = 0.6000000238418579
    expect(t[3].startPoint.x).toBe(f(3 / 5));
    expect(t[3].startPoint.x).toBe(f(3 * f(0.2))); // coincides for sub ∈ 0..4
    expect(t[1].startPoint.x).toBe(f(1 / 5));
    expect(t[4].startPoint.x).toBe(f(4 / 5));
  });

  it('curveLengthB4Activation = arc length BEFORE the activateIndex node samples', () => {
    const c = new CatmullCurve(1, curvedPts, 2);
    // captured before node 2's first sample is added → dist[5*2-1] (t = 1.8),
    // NOT dist[10] (t = 2.0): faithful capture point @0x73f7bc.
    expect(c.curveLengthB4Activation).toBe(table(c)[9].dist);
    expect(c.curveLengthB4Activation).toBe(c.nodeTimeToDistance(1.8));
    expect(new CatmullCurve(1, curvedPts, 0).curveLengthB4Activation).toBe(0);
    // FAITHFUL QUIRK: activateIndex = N-1 never matches (loop stops at N-2) → 0
    expect(new CatmullCurve(1, curvedPts, curvedPts.length - 1).curveLengthB4Activation).toBe(0);
    expect(new CatmullCurve(1, curvedPts, -3).curveLengthB4Activation).toBe(0);
  });

  it('ctor copies the point list; later caller mutation does not affect the curve', () => {
    const pts = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)];
    const c = new CatmullCurve(1, pts, 0);
    const len = c.curveLength;
    pts.push(v(9, 9, 9));
    pts[0] = v(-5, -5, -5);
    expect(c.curveLength).toBe(len);
    expectV3Exact(table(c)[0].startPoint, v(0, 0, 0));
  });

  it('OnDeserializedMethod (@0x73fa20) rebuilds the table from originalPathPoints', () => {
    const c = curved();
    const len = c.curveLength;
    const first = table(c)[3].startPoint.clone();
    table(c).length = 0; // corrupt (white-box)
    c.onDeserializedMethod();
    expect(c.curveLength).toBe(len);
    expectV3Exact(table(c)[3].startPoint, first);
  });

  it('single-point curve: empty table, curveLength 0', () => {
    const c = new CatmullCurve(1, [v(1, 2, 3)], 0);
    expect(table(c).length).toBe(0);
    expect(c.curveLength).toBe(0);
  });
});

// ---- EvaluateSplineSegment / Velocity vs independent math --------------------

describe('EvaluateSplineSegment (@0x73fdd0) vs independent Catmull-Rom', () => {
  const cases: Array<[Vector3, Vector3, Vector3, Vector3]> = [
    [v(-1, 0, 0), v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)], // interior straight
    [v(0, 0, 0), v(0, 0, 0), v(2, 0, 1), v(4, 1, 0)], // reflected start
    [v(2, 0, 1), v(4, 1, 0), v(6, 1, 2), v(8, 0, 1)], // interior curved
    [v(4, 1, 0), v(6, 1, 2), v(8, 0, 1), v(10, -1, 0)], // reflected end
    [v(-2, 3, -1), v(1, -1, 2), v(3, 2, -2), v(5, 0, 4)], // arbitrary
  ];
  it('matches Hermite-form Catmull-Rom at sample t values (fp32 vs fp64 tol)', () => {
    for (const [cp1, p1, p2, cp2] of cases) {
      for (const t of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
        expectV3Close(evalSeg(cp1, p1, p2, cp2, t), crPoint(cp1, p1, p2, cp2, t), 1e-4);
      }
    }
  });
  it('endpoints are EXACT for integer control points: P(0)=p1, P(1)=p2', () => {
    for (const [cp1, p1, p2, cp2] of cases) {
      expectV3Exact(evalSeg(cp1, p1, p2, cp2, 0), p1);
      expectV3Exact(evalSeg(cp1, p1, p2, cp2, 1), p2);
    }
  });
  it('velocity matches the independent derivative', () => {
    for (const [cp1, p1, p2, cp2] of cases) {
      for (const t of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
        expectV3Close(evalVel(cp1, p1, p2, cp2, t), crVel(cp1, p1, p2, cp2, t), 1e-4);
      }
    }
  });
  it('velocity at t=0 is exactly 0.5*(p2-cp1) (integer points)', () => {
    for (const [cp1, p1, p2, cp2] of cases) {
      expectV3Exact(evalVel(cp1, p1, p2, cp2, 0), p2.sub(cp1).mulScalar(0.5));
    }
  });
  it('velocity is the numerical derivative of position (central difference)', () => {
    const [cp1, p1, p2, cp2] = cases[4];
    const h = 1e-3;
    for (const t of [0.25, 0.5, 0.75]) {
      const num = evalSeg(cp1, p1, p2, cp2, t + h).sub(evalSeg(cp1, p1, p2, cp2, t - h)).divScalar(2 * h);
      expectV3Close(evalVel(cp1, p1, p2, cp2, t), num, 1e-2);
    }
  });
});

// ---- SampleDirect / SampleVelDirect boundaries -------------------------------

describe('SampleDirect (@0x740080/@0x7401b0) boundaries + side offset', () => {
  it('time 0 and node times hit the path points exactly (up to N-2)', () => {
    const c = curved();
    expectV3Exact(c.sampleDirect(0, 0), curvedPts[0]);
    for (let i = 1; i <= curvedPts.length - 2; i++) {
      expectV3Exact(c.sampleDirect(i, 0), curvedPts[i]);
    }
  });

  it('FAITHFUL QUIRK: time=N-1 extrapolates the last chords (Count-4 clamp)', () => {
    const c = curved();
    const t = table(c);
    const n = curvedPts.length;
    const idx = t.length - 4;
    const frac = f(5 * (n - 1) - idx); // = 4
    expect(frac).toBe(4);
    const expected = Vector3.LerpUnclamped(t[idx].startPoint, t[idx + 1].startPoint, frac);
    expectV3Exact(c.sampleDirect(n - 1, 0), expected);
    // NOT the last path point on a curved path
    expect(Vector3.Distance(c.sampleDirect(n - 1, 0), curvedPts[n - 1])).toBeGreaterThan(1e-4);
    // straight path: extrapolation lands (almost) exactly on the end point
    expectV3Close(straight().sampleDirect(3, 0), v(3, 0, 0), 1e-5);
  });

  it('negative time: index clamps to 0, fraction stays negative (backward extrapolation)', () => {
    const c = curved();
    const t = table(c);
    const expected = Vector3.LerpUnclamped(t[0].startPoint, t[1].startPoint, f(-0.5));
    expectV3Exact(c.sampleDirect(-0.1, 0), expected);
  });

  it('time past the end keeps extrapolating (fraction > 4)', () => {
    const c = curved();
    const t = table(c);
    const idx = t.length - 4;
    const expected = Vector3.LerpUnclamped(t[idx].startPoint, t[idx + 1].startPoint, f(5 * curvedPts.length - idx));
    expectV3Exact(c.sampleDirect(curvedPts.length, 0), expected);
  });

  it('sideOffset shifts along Cross(up, tangent); 0 matches the 1-arg overload', () => {
    const c = straight();
    const pos = c.sampleDirect(0.5);
    const vel = c.sampleVelDirect(0.5);
    expectV3Exact(vel, v(1, 0, 0)); // straight +X path: exact unit tangent
    const off = c.sampleDirect(0.5, 1);
    // up × +X = -Z
    expectV3Exact(off, pos.add(Vector3.Cross(Vector3.up, vel).mulScalar(1)));
    expect(off.z).toBeLessThan(0);
    expectV3Exact(c.sampleDirect(0.5, 0), pos);
    // negative offset flips the side
    expectV3Exact(c.sampleDirect(0.5, -1), pos.add(Vector3.Cross(Vector3.up, vel).mulScalar(-1)));
  });

  it('FAITHFUL QUIRK: NaN sideOffset propagates NaN (C# NaN != 0 is true)', () => {
    const p = straight().sampleDirect(0.5, Number.NaN);
    expect(Number.isNaN(p.x)).toBe(true);
    expect(Number.isNaN(p.z)).toBe(true);
  });

  it('SampleVelDirect (@0x740260) returns NORMALIZED lerped velocities', () => {
    const c = curved();
    // stay below (Count-4)/5 = N-1.8 where the Count-4 clamp extrapolates
    for (const t of [0, 0.37, 1.2, 2.5, 3.1]) {
      const vel = c.sampleVelDirect(t);
      expect(Math.abs(vel.magnitude - 1)).toBeLessThanOrEqual(1e-6);
      // direction ≈ independent tangent direction at that node time
      const i = Math.min(Math.floor(t), curvedPts.length - 2);
      const cp1 = i === 0 ? curvedPts[0].sub(curvedPts[1].sub(curvedPts[0])) : curvedPts[i - 1];
      const cp2 =
        i < curvedPts.length - 2
          ? curvedPts[i + 2]
          : curvedPts[curvedPts.length - 1].add(
              curvedPts[curvedPts.length - 1].sub(curvedPts[curvedPts.length - 2]),
            );
      const ref = crVel(cp1, curvedPts[i], curvedPts[i + 1], cp2, t - i).normalized;
      expectV3Close(vel, ref, 0.05); // chord-lerp vs true tangent: coarse tol
    }
  });

  it('FAITHFUL QUIRK: SampleVelDirect past (Count-4)/5 extrapolates velocity chords', () => {
    const c = curved();
    const t = table(c);
    const idx = t.length - 4;
    const frac = f(5 * (curvedPts.length - 1) - idx); // = 4 at time N-1
    const expected = Vector3.Normalize(
      Vector3.LerpUnclamped(t[idx].velocity, t[idx + 1].velocity, frac),
    );
    expectV3Exact(c.sampleVelDirect(curvedPts.length - 1), expected);
  });

  it('degenerate all-identical points: velocity normalizes to zero', () => {
    const c = new CatmullCurve(1, [v(2, 2, 2), v(2, 2, 2), v(2, 2, 2)], 0);
    expectV3Exact(c.sampleVelDirect(0.5), Vector3.zero);
    expect(c.curveLength).toBe(0);
  });

  it('empty curve: sampling throws (binary: exception path)', () => {
    const c = new CatmullCurve(1, [v(0, 0, 0)], 0);
    expect(() => c.sampleDirect(0)).toThrow(RangeError);
    expect(() => c.sampleVelDirect(0)).toThrow(RangeError);
    expect(() => c.sampleLinearDistance(0)).toThrow(RangeError);
  });
});

// ---- DistanceToTime ----------------------------------------------------------

describe('DistanceToTime (@0x740410)', () => {
  it('fresh search: d=0 → 0; node-boundary distances → exact node times', () => {
    const c = curved();
    expect(c.distanceToTime(0, -1)).toBe(0);
    const t = table(c);
    for (let k = 1; k <= curvedPts.length - 2; k++) {
      expect(c.distanceToTime(t[5 * k].dist, -1)).toBe(k);
    }
  });

  it('fresh search is monotone over a distance sweep', () => {
    const c = curved();
    let prev = -1;
    for (let j = 0; j <= 200; j++) {
      const d = f((c.curveLength * j) / 200);
      const tm = c.distanceToTime(d, -1);
      expect(tm).toBeGreaterThanOrEqual(prev);
      prev = tm;
    }
  });

  it('incremental-vs-fresh parity: forward walk, backward walk, seeded jumps', () => {
    const c = curved();
    const L = c.curveLength;
    // forward walk chaining lastTime
    let last = f(-1);
    for (let j = 0; j <= 120; j++) {
      const d = f((L * j) / 120);
      const inc = c.distanceToTime(d, last);
      const fresh = c.distanceToTime(d, -1);
      expect(Object.is(inc, fresh)).toBe(true);
      last = inc;
    }
    // backward walk (distance decreasing; backward scan exercised). Stay below
    // curveLength: d == curveLength returns the Count-1 quirk value, which is
    // not a valid node time to feed back as lastTime.
    last = c.distanceToTime(f((L * 119) / 120), -1);
    for (let j = 119; j >= 0; j--) {
      const d = f((L * j) / 120);
      const inc = c.distanceToTime(d, last);
      expect(Object.is(inc, c.distanceToTime(d, -1))).toBe(true);
      last = inc;
    }
    // seeded random jumps (both directions, far from the previous position);
    // cap below L so fp32 rounding cannot produce d == L (Count-1 quirk).
    const rnd = lcg(0xc0ffee);
    last = f(-1);
    for (let j = 0; j < 150; j++) {
      const d = f(rnd() * L * 0.9999);
      const inc = c.distanceToTime(d, last);
      expect(Object.is(inc, c.distanceToTime(d, -1))).toBe(true);
      last = inc;
    }
  });

  it('stale far-ahead lastTime still lands correctly (backward scan to node 0)', () => {
    const c = curved();
    const fresh = c.distanceToTime(f(c.curveLength * 0.01), -1);
    expect(c.distanceToTime(f(c.curveLength * 0.01), curvedPts.length - 2)).toBe(fresh);
    // lastTime in [0,1): (int)lastTime = 0 → backward scan skipped
    expect(c.distanceToTime(f(c.curveLength * 0.3), 0.9)).toBe(c.distanceToTime(f(c.curveLength * 0.3), -1));
  });

  it('clamping: d<0 → time 0; d>=curveLength → Count-1 (FAITHFUL QUIRK)', () => {
    const c = curved();
    expect(c.distanceToTime(-5, -1)).toBe(0);
    const count = table(c).length;
    expect(c.distanceToTime(c.curveLength, -1)).toBe(count - 1);
    expect(c.distanceToTime(c.curveLength + 10, -1)).toBe(count - 1);
    expect(c.distanceToTime(c.curveLength, 0)).toBe(count - 1); // incremental too
  });

  it('empty curve: fresh search returns -1; incremental with (int)lastTime>0 throws', () => {
    const c = new CatmullCurve(1, [v(0, 0, 0)], 0);
    expect(c.distanceToTime(0, -1)).toBe(-1);
    // lastTime=0: forward scan breaks immediately (Count-1 = -1 <= 0), tail → -1
    expect(c.distanceToTime(0, 0)).toBe(-1);
    // (int)lastTime > 0 → backward scan get_Item on the empty list → exception
    expect(() => c.distanceToTime(0, 1)).toThrow(RangeError);
  });

  it('NaN lastTime takes the incremental branch → exception path (faithful)', () => {
    const c = curved();
    expect(() => c.distanceToTime(1, Number.NaN)).toThrow(RangeError);
  });

  it('FAITHFUL QUIRK: duplicate dist entries — fresh vs incremental diverge', () => {
    // node 0 is A→A with all control points A: five samples with dist=0,
    // length=0 (plus node 1's t=0 sample → six zeros). Fresh BinarySearch
    // (count=15) probes mid 7 (>0) then mid 3 (==0) → node 0, zero span →
    // 0/0 = NaN; the incremental forward scan walks to the LAST zero (index 5,
    // node 1 → time 1).
    const c = new CatmullCurve(1, dupPts, 0);
    expect(Number.isNaN(c.distanceToTime(0, -1))).toBe(true);
    expect(c.distanceToTime(0, 0)).toBe(1);
    // beyond the degenerate node both paths agree again
    const d = f(c.curveLength * 0.5);
    expect(c.distanceToTime(d, 1)).toBe(c.distanceToTime(d, -1));
  });

  it('determinism: identical inputs → bit-identical results (Object.is)', () => {
    const a = curved();
    const b = curved();
    const ta = table(a);
    const tb = table(b);
    for (let k = 0; k < ta.length; k++) {
      expect(Object.is(ta[k].dist, tb[k].dist)).toBe(true);
      expect(Object.is(ta[k].length, tb[k].length)).toBe(true);
      expectV3Exact(ta[k].startPoint, tb[k].startPoint);
      expectV3Exact(ta[k].velocity, tb[k].velocity);
    }
    for (let j = 0; j <= 50; j++) {
      const d = f((a.curveLength * j) / 50);
      expect(Object.is(a.distanceToTime(d, -1), b.distanceToTime(d, -1))).toBe(true);
    }
  });
});

// ---- NodeTimeToDistance ------------------------------------------------------

describe('NodeTimeToDistance (@0x7406d0)', () => {
  it('sample times k/5 map EXACTLY to dist[k] (k <= Count-2)', () => {
    const c = curved();
    const t = table(c);
    for (let k = 0; k <= t.length - 2; k++) {
      expect(c.nodeTimeToDistance(k / 5)).toBe(t[k].dist);
    }
  });

  it('time 0 → 0; negative time clamps to 0 (Mathf.Max)', () => {
    const c = curved();
    expect(c.nodeTimeToDistance(0)).toBe(0);
    expect(c.nodeTimeToDistance(-2.5)).toBe(0);
  });

  it('FAITHFUL QUIRK: time=N-1 extrapolates the second-to-last chord (Count-2 clamp)', () => {
    const c = curved();
    const t = table(c);
    const n = curvedPts.length;
    const idx = t.length - 2;
    const t5 = f(5 * (n - 1));
    const expected = f(f(f(t5 - idx) * t[idx].length) + t[idx].dist);
    expect(c.nodeTimeToDistance(n - 1)).toBe(expected);
    expect(c.nodeTimeToDistance(n - 1)).not.toBe(c.curveLength); // overshoots
    expect(c.nodeTimeToDistance(n - 1)).toBeGreaterThan(c.curveLength);
  });

  it('monotone over a time sweep', () => {
    const c = curved();
    let prev = -1;
    for (let j = 0; j <= 200; j++) {
      const tm = f((j / 200) * (curvedPts.length - 1));
      const d = c.nodeTimeToDistance(tm);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('round-trips with DistanceToTime at node boundaries (exact) and within nodes (tol)', () => {
    const c = new CatmullCurve(9, gentlePts, 1);
    for (let k = 0; k <= gentlePts.length - 2; k++) {
      const d = c.nodeTimeToDistance(k);
      expect(c.distanceToTime(d, -1)).toBe(k);
    }
    // fully-sampled nodes: chord-linear vs node-arc-linear deviation is tiny
    // on a low-curvature path (measured max ≈ 0.0013 node units)
    for (let j = 0; j <= 100; j++) {
      const tm = f((j / 100) * (gentlePts.length - 2));
      const d = c.nodeTimeToDistance(tm);
      const back = c.distanceToTime(d, -1);
      expect(Math.abs(back - tm)).toBeLessThanOrEqual(0.01);
    }
    // high-curvature path: deviation grows with curvature (measured max ≈ 0.033)
    const cc = curved();
    for (let j = 0; j <= 100; j++) {
      const tm = f((j / 100) * (curvedPts.length - 2));
      const back = cc.distanceToTime(cc.nodeTimeToDistance(tm), -1);
      expect(Math.abs(back - tm)).toBeLessThanOrEqual(0.04);
    }
    // FAITHFUL: the last node's table covers only t∈[N-2, N-1.2] but
    // DistanceToTime spreads it over a full node-time unit → larger deviation
    for (let j = 1; j <= 10; j++) {
      const tm = f(gentlePts.length - 2 + j * 0.05);
      const d = c.nodeTimeToDistance(tm);
      const back = c.distanceToTime(d, -1);
      expect(Math.abs(back - tm)).toBeLessThanOrEqual(0.25);
    }
  });
});

// ---- SampleLinearDistance ----------------------------------------------------

describe('SampleLinearDistance (@0x7403e0)', () => {
  it('straight path: arc length ≈ 2.8 (table ends at t=N-1.2); samples land at d', () => {
    const c = straight();
    // FAITHFUL: 15 samples span t=0..2.8 — the endpoint t=3 is never sampled,
    // so curveLength = 14 chords ≈ 2.8, NOT the full polyline length 3.
    expect(c.curveLength).toBeCloseTo(2.8, 4);
    // identity holds over the fully-sampled nodes (d < start of last node)
    for (const d of [0, 0.1, 0.75, 1.5, 1.99]) {
      expectV3Close(c.sampleLinearDistance(d), v(d, 0, 0), 1e-4);
    }
    expectV3Exact(c.sampleLinearDistance(0), v(0, 0, 0));
  });

  it('FAITHFUL QUIRK: last-node distances overshoot (node fraction spread over 0.8 arc)', () => {
    const c = straight();
    // DistanceToTime maps the last node's sampled arc (t∈[2,2.8]) onto a FULL
    // node-time unit, then SampleDirect extrapolates → position overshoots d.
    const d = f(c.curveLength * 0.99);
    expect(c.sampleLinearDistance(d).x).toBeGreaterThan(d);
  });

  it('curved path: curveLength >= chords of the fully-sampled nodes; arc steps ≈ distance steps', () => {
    const c = new CatmullCurve(9, gentlePts, 1);
    // nodes 0..N-3 are fully covered by the table (last node stops at t=0.8);
    // arc >= chord per node span.
    let chordSum = 0;
    for (let i = 0; i + 2 < gentlePts.length; i++) {
      chordSum = f(chordSum + Vector3.Distance(gentlePts[i], gentlePts[i + 1]));
    }
    expect(c.curveLength).toBeGreaterThanOrEqual(chordSum);
    // small arc steps over the fully-sampled region: |P(d+Δ)-P(d)| ≈ Δ
    // (low-curvature path; measured max deviation ≈ 0.7% of the step)
    const fullEnd = table(c)[5 * (gentlePts.length - 2)].dist;
    const step = f(fullEnd / 60);
    for (let j = 0; j + 1 < 60; j++) {
      const d0 = f(j * step);
      const d1 = f((j + 1) * step);
      const seg = Vector3.Distance(c.sampleLinearDistance(d0), c.sampleLinearDistance(d1));
      expect(Math.abs(seg - step)).toBeLessThanOrEqual(step * 0.02);
    }
  });

  it('consistent with SampleDirect at node times (fresh search path)', () => {
    const c = curved();
    for (let k = 0; k <= curvedPts.length - 2; k++) {
      const d = c.nodeTimeToDistance(k);
      expectV3Exact(c.sampleLinearDistance(d), c.sampleDirect(k, 0));
    }
  });
});

// ---- CorePathMove integration with the REAL curve ----------------------------

describe('CorePathMove + real CatmullCurve', () => {
  it('exposes curve length / activation length / id identity', () => {
    const c = curved();
    const m = new CorePathMove(c);
    expect(m.pathLength).toBe(c.curveLength);
    expect(m.curveLengthBeforeActivation).toBe(c.curveLengthB4Activation);
    expect(m.isSameCurve(new CorePathMove(curved()))).toBe(true); // same id 9
    expect(m.isSameCurve(new CorePathMove(straight()))).toBe(false); // id 7
  });

  it('sample(d): ok below curveLength, exact contract position; not-ok at/after end', () => {
    const c = curved();
    const m = new CorePathMove(c);
    for (const d of [0, f(c.curveLength * 0.25), f(c.curveLength * 0.999)]) {
      const r = m.sample(d);
      expect(r.ok).toBe(true);
      expectV3Exact(r.pos, c.sampleLinearDistance(d) as Vector3);
    }
    const end = m.sample(c.curveLength);
    expect(end.ok).toBe(false);
    expectV3Exact(end.pos, Vector3.zero);
    expect(m.sample(c.curveLength + 1).ok).toBe(false);
  });

  it('sampleWithVel walk: incremental cache matches fresh sampling EXACTLY; vel is unit', () => {
    const c = new CatmullCurve(9, gentlePts, 1);
    const m = new CorePathMove(c);
    const steps = 40;
    const fullEnd = table(c)[5 * (gentlePts.length - 2)].dist;
    let prevPos: Vector3 | null = null;
    for (let j = 0; j < steps; j++) {
      const d = f((c.curveLength * j) / steps);
      const r = m.sampleWithVel(d, 0);
      expect(r.ok).toBe(true);
      // the wrapper's incremental DistanceToTime must equal the fresh path
      expectV3Exact(r.pos, c.sampleLinearDistance(d) as Vector3);
      expect(Math.abs(r.vel.magnitude - 1)).toBeLessThanOrEqual(1e-6);
      if (prevPos) {
        const moved = Vector3.Distance(prevPos, r.pos);
        expect(moved).toBeGreaterThan(0);
        // arc-rate advance holds over the fully-sampled nodes; the last node
        // compresses/extrapolates (faithful end-region quirks).
        if (d <= fullEnd) {
          expect(Math.abs(moved - c.curveLength / steps)).toBeLessThanOrEqual((c.curveLength / steps) * 0.05);
        } else {
          expect(moved).toBeLessThanOrEqual((c.curveLength / steps) * 2);
        }
      }
      prevPos = r.pos;
    }
    // at/after the end: not-ok, zero vectors, cache untouched
    const end = m.sampleWithVel(c.curveLength, 0);
    expect(end.ok).toBe(false);
    expectV3Exact(end.pos, Vector3.zero);
    expectV3Exact(end.vel, Vector3.zero);
  });

  it('sampleWithVel sideOffset matches the curve 2-arg SampleDirect', () => {
    const c = curved();
    const m = new CorePathMove(c);
    const d = f(c.curveLength * 0.4);
    const r = m.sampleWithVel(d, 0.5);
    const tm = c.distanceToTime(d, -1);
    expectV3Exact(r.pos, c.sampleDirect(tm, 0.5));
    expectV3Exact(r.vel, c.sampleVelDirect(tm));
    const r0 = m.sampleWithVel(d, 0);
    expect(Vector3.Distance(r.pos, r0.pos)).toBeGreaterThan(0.4);
  });

  it('wrapper distanceToTime/nodeTimeToDistance delegate faithfully', () => {
    const c = curved();
    const m = new CorePathMove(c);
    for (const d of [0, f(c.curveLength * 0.3), f(c.curveLength * 0.9)]) {
      expect(m.distanceToTime(d)).toBe(c.distanceToTime(d, -1));
    }
    for (const tm of [0, 0.7, 2.2]) {
      expect(m.nodeTimeToDistance(tm)).toBe(c.nodeTimeToDistance(tm));
    }
  });

  it('determinism: two movers on identical curves produce bit-identical walks', () => {
    const m1 = new CorePathMove(curved());
    const m2 = new CorePathMove(curved());
    for (let j = 0; j < 30; j++) {
      const d = f((m1.pathLength * j) / 30);
      const a = m1.sampleWithVel(d, 0.25);
      const b = m2.sampleWithVel(d, 0.25);
      expectV3Exact(a.pos, b.pos);
      expectV3Exact(a.vel, b.vel);
    }
  });

  it('satisfies CatmullCurveContract structurally', () => {
    const contract: CatmullCurveContract = curved();
    expect(contract.id).toBe(9);
    expect(typeof contract.sampleLinearDistance(0).x).toBe('number');
    expect(contract.distanceToTime(0, -1)).toBe(0);
  });
});
