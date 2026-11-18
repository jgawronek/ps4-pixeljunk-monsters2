// src/core/CatmullCurve.ts
// TypeScript port of decomp/src/Q4/CatmullCurve.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3770/3771,
// @0x73f460..0x7407d0). The enemy path spline: uniform Catmull-Rom through the
// path points, pre-sampled into 5 chord subsegments per node span with a
// cumulative arc-length table. CorePathMove wraps it via CatmullCurveContract.
//
// All .rodata constants CONFIRMED from Il2CppUserAssemblies.elf (file offset =
// vaddr + 0x4000); register-lost Ghidra arguments resolved against objdump
// disassembly (scratch: pjm2-web/.work/catmull/*.asm). See the C# reconstruction
// for the full per-instruction provenance.
//
// TS ADAPTATIONS:
//  - List<SegmentData> → SegmentData[]; List.get_Item bounds checks → getItem()
//    throwing (binary: exception path, ud2). List.Capacity hint is a no-op.
//  - C# SampleDirect overloads → TS overload signatures (1-arg / 2-arg).
//  - (int)float casts use floatToInt32 (cvttss2si semantics, same as the
//    module-private helper in engine/math/Mathf.ts).
//  - The [OnDeserialized] hook is exposed publicly (serializer seam + tests);
//    C# keeps it private. CatmullCurveDeserializable below is the extension
//    interface for merging into q4-contracts.ts (main session owns that file).

import { Vector3 } from '../engine/math/Vector3';
import { Mathf } from '../engine/math/Mathf';
import type { CatmullCurveContract, Vector3Like } from '../view/q4-contracts';

const f = Math.fround;

/** C#: private const int SUBSEG_NUM = 5. */
const SUBSEG_NUM = 5;

// ---- .rodata constants (CONFIRMED from ELF) ----
// DAT_00b7fd64 = 5.0  — BuildCurveData subsegment t divisor
// DAT_00b7fd68 = 0.5  — velocity half-scalar
// DAT_00b7fd6c = 2.0  — velocity 2*cp1 term + trailing *2
// DAT_00b7fd70 = 5.0  — velocity -5*p1 term
// DAT_00b7fd74 = 4.0  — velocity +4*p2 term
// DAT_00b7fd78 = 3.0  — velocity 3*p1/3*p2 terms + trailing *3
// DAT_00b7fd7c = 3.0  — position cubic coeff 3*p1/3*p2
// DAT_00b7fd80 = 2.0  — position quad coeff 2*cp1 + constant 2*p1
// DAT_00b7fd84 = 5.0  — position quad coeff -5*p1
// DAT_00b7fd88 = 4.0  — position quad coeff +4*p2
// DAT_00b7fd8c = 0.5  — position final half-scalar
// DAT_00b7fd90 = 5.0  — SampleDirect time scale
// DAT_00b7fd94 = 5.0  — SampleVelDirect time scale
// DAT_00b7fd98 = -1.0 — SampleLinearDistance lastTime default
// DAT_00b7fda0 = 5.0  — NodeTimeToDistance time scale
const HALF = f(0.5);
const TWO = f(2);
const THREE = f(3);
const FOUR = f(4);
const FIVE = f(5);
const TIME_SCALE = FIVE; // fd90 / fd94 / fda0 (same literal value, distinct slots)
const FRESH_LAST_TIME = f(-1); // fd98

/** C# float→int32 as emitted by IL2CPP (cvttss2si): truncate toward zero;
 *  NaN / out-of-range → int.MinValue. Mirrors Mathf's private floatToInt32. */
function floatToInt32(x: number): number {
  if (Number.isNaN(x)) return -2147483648;
  if (x >= 2147483648 || x < -2147483648) return -2147483648;
  return x | 0;
}

/** Mathf.Clamp(int) @0x8459b0: value < min ? min : value > max ? max : value. */
function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** C#: Q4.CatmullCurve.SegmentData (nested, TypeDefIndex 3771).
 *  One chord-table sample: position + spline velocity at t = sub/5 of node
 *  sourcePointIndex, cumulative arc length `dist`, chord `length` to the NEXT
 *  sample (0 on the last sample — never written). */
export class SegmentData {
  startPoint: Vector3 = Vector3.zero; // 0x10
  velocity: Vector3 = Vector3.zero; // 0x1C
  dist = 0; // 0x28
  length = 0; // 0x2C
  sourcePointIndex = 0; // 0x30

  // CompareTo @0x7407d0 (Slot 4) — ascending by dist.
  // Equal-but-NaN does NOT compare 0; NaN <= x is false → returns 1.
  compareTo(other: SegmentData): number {
    // binary: other == null → NullReferenceException (ud2); TS throws naturally
    const o = other.dist;
    const m = this.dist;
    if (o === m && !Number.isNaN(o) && !Number.isNaN(m)) return 0;
    return m <= o ? -1 : 1;
  }
}

/** Extension beyond CatmullCurveContract — NOTE FOR MERGING into
 *  src/view/q4-contracts.ts (main session owns it): the [OnDeserialized]
 *  rebuild hook needed when curves are loaded from serialized stage data. */
export interface CatmullCurveDeserializable extends CatmullCurveContract {
  onDeserializedMethod(): void;
}

export class CatmullCurve implements CatmullCurveDeserializable {
  private splineSegments: SegmentData[] = []; // 0x10 (field initializer)
  private originalPathPoints: Vector3[]; // 0x18
  private activateIndex: number; // 0x20
  private m_ID = -1; // 0x24 (field initializer: ctor writes -1 before base ctor)
  private m_curveLength = 0; // 0x28 <curveLength>k__BackingField
  private m_curveLengthB4Activation = 0; // 0x2C <curveLengthB4Activation>k__BackingField
  private sortSegment: SegmentData = new SegmentData(); // 0x30 (reused BinarySearch key)

  // .ctor @0x73f460
  constructor(a_id: number, pathPoints: readonly Vector3Like[], activateIdx: number) {
    this.m_ID = a_id | 0;
    this.activateIndex = activateIdx | 0;
    // C#: originalPathPoints = new List<Vector3>(pathPoints) (copy ctor), then
    // BuildCurveData(pathPoints) on the PARAMETER. TS: one fround'd Vector3 copy
    // serves both (values identical; the copy isolates later caller mutation).
    const pts = pathPoints.map((p) => new Vector3(p.x, p.y, p.z));
    this.originalPathPoints = pts;
    this.buildCurveData(pts);
  }

  // get_ID @0x73fa10
  get id(): number {
    return this.m_ID;
  }

  // get_curveLength @0x73fa90 (set is private in C#; internal writes only)
  get curveLength(): number {
    return this.m_curveLength;
  }

  // get_curveLengthB4Activation @0x73fab0
  get curveLengthB4Activation(): number {
    return this.m_curveLengthB4Activation;
  }

  // OnDeserializedMethod @0x73fa20 ([OnDeserialized]; private in C#)
  onDeserializedMethod(): void {
    this.splineSegments = [];
    this.buildCurveData(this.originalPathPoints);
  }

  // BuildCurveData @0x73f550
  private buildCurveData(pathPoints: Vector3[]): void {
    this.m_curveLength = 0;
    this.splineSegments.length = 0; // List.Clear
    // binary: pathPoints == null → NRE (ud2 @0x73fa01); TS callers pass arrays
    // TS ADAPTATION: List.Capacity = Count*5 hint is a no-op on JS arrays.
    const count = pathPoints.length;
    if (count < 2) return;

    const lastNode = count - 2;
    let i = 0;
    do {
      let cp1: Vector3;
      if (i === 0) {
        const p0 = pathPoints[0];
        const p1 = pathPoints[1];
        cp1 = p0.sub(p1.sub(p0)); // reflected start control point
      } else {
        cp1 = pathPoints[i - 1];
      }
      const p1 = pathPoints[i];
      const p2 = pathPoints[i + 1];
      let cp2: Vector3;
      if (i < lastNode) {
        cp2 = pathPoints[i + 2];
      } else {
        const last = pathPoints[count - 1];
        cp2 = last.add(last.sub(pathPoints[lastNode])); // reflected end control point
      }

      if (this.activateIndex === i) {
        this.m_curveLengthB4Activation = this.m_curveLength;
      }

      let sub = -1;
      do {
        const seg = new SegmentData();
        sub++;
        seg.sourcePointIndex = i | 0;
        // t = (float)sub / 5f — fp32 DIVISION (vcvtsi2ss + vdivss DAT_00b7fd64
        // @0x73f7f8). For sub ∈ 0..4 the value coincides with sub*0.2f, but
        // division is the emitted op. NOTE: the last sample sits at
        // t = (N-1)-0.2 — the endpoint t = N-1 is never sampled.
        const t = f(sub / 5);
        // velocity evaluated BEFORE position (call order @0x73f842/@0x73f888)
        seg.velocity = CatmullCurve.evaluateSplineSegmentVelocity(cp1, p1, p2, cp2, t);
        seg.startPoint = CatmullCurve.evaluateSplineSegment(cp1, p1, p2, cp2, t);

        let d: number;
        if (this.splineSegments.length >= 1) {
          const prev = this.splineSegments[this.splineSegments.length - 1];
          d = Vector3.Distance(seg.startPoint, prev.startPoint);
          prev.length = f(d);
          this.m_curveLength = f(d + this.m_curveLength); // vaddss order @0x73f988
          d = this.m_curveLength; // binary reassigns fVar12 to the CUMULATIVE value
        } else {
          d = this.m_curveLength; // first sample: 0
        }
        seg.dist = f(d);
        this.splineSegments.push(seg);
      } while (sub < 4);

      const more = i < lastNode;
      i++;
      if (!more) break;
    } while (true);
  }

  // EvaluateSplineSegmentVelocity @0x73fad0
  // P'(t) = 0.5*(p2-cp1) + ((0.5*A)*t)*2 + ((0.5*B)*t²)*3,
  // A = 2cp1-5p1+4p2-cp2, B = -cp1+3p1-3p2+cp2. The half-scalars apply to A/B
  // BEFORE the t/t² multiplies; *2/*3 are separate trailing multiplies (the
  // binary does NOT fold them into 1.0/1.5) — order preserved for fp32 parity.
  private static evaluateSplineSegmentVelocity(
    cp1: Vector3,
    p1: Vector3,
    p2: Vector3,
    cp2: Vector3,
    t: number,
  ): Vector3 {
    const t2 = f(t * t); // @0x73fb23
    const lin = p2.sub(cp1); // @0x73fb30
    const term0 = lin.mulScalar(HALF); // DAT_00b7fd68
    const a = cp1.mulScalar(TWO).sub(p1.mulScalar(FIVE)).add(p2.mulScalar(FOUR)).sub(cp2); // fd6c/fd70/fd74
    const halfA = a.mulScalar(HALF); // fd68
    const b = cp1.neg().add(p1.mulScalar(THREE)).sub(p2.mulScalar(THREE)).add(cp2); // fd78
    const halfB = b.mulScalar(HALF); // fd68
    const term1 = halfA.mulScalar(t).mulScalar(TWO); // @0x73fd32, fd6c
    const acc = term0.add(term1); // @0x73fd61
    const term2 = halfB.mulScalar(t2).mulScalar(THREE); // @0x73fd89, fd78
    return acc.add(term2);
  }

  // EvaluateSplineSegment @0x73fdd0
  // P(t) = 0.5*(B*t³ + A*t² + (p2-cp1)*t + 2*p1) — uniform Catmull-Rom.
  // t³ = (t*t)*t left-associative fp32; emitted op order preserved.
  private static evaluateSplineSegment(
    cp1: Vector3,
    p1: Vector3,
    p2: Vector3,
    cp2: Vector3,
    t: number,
  ): Vector3 {
    const t2 = f(t * t); // @0x73fe17
    const b = cp1.neg().add(p1.mulScalar(THREE)).sub(p2.mulScalar(THREE)).add(cp2); // fd7c
    const t3 = f(t2 * t); // @0x73fec4
    const cubicTerm = b.mulScalar(t3);
    const a = cp1.mulScalar(TWO).sub(p1.mulScalar(FIVE)).add(p2.mulScalar(FOUR)).sub(cp2); // fd80/fd84/fd88
    const quadTerm = a.mulScalar(t2);
    let acc = cubicTerm.add(quadTerm); // @0x73ffb0
    const lin = cp1.neg().add(p2); // fresh negation @0x73ffd0
    const linTerm = lin.mulScalar(t);
    acc = acc.add(linTerm); // @0x74000c
    acc = acc.add(p1.mulScalar(TWO)); // fd80 @0x74001b
    return acc.mulScalar(HALF); // fd8c
  }

  /** List.get_Item semantics: out-of-range → exception (binary: ud2 path). */
  private getItem(idx: number): SegmentData {
    const s = this.splineSegments[idx];
    if (s === undefined) {
      // binary: ArgumentOutOfRangeException / NullReferenceException path
      throw new RangeError(`CatmullCurve: splineSegments index ${idx} out of range`);
    }
    return s;
  }

  // SampleDirect @0x740080 (position only)
  sampleDirect(time: number): Vector3;
  // SampleDirect @0x7401b0 (with lateral side offset)
  sampleDirect(time: number, sideOffset: number): Vector3;
  sampleDirect(time: number, sideOffset?: number): Vector3 {
    const t5 = f(f(time) * TIME_SCALE); // DAT_00b7fd90
    const count = this.splineSegments.length;
    // FAITHFUL QUIRK: clamp max is Count-4 → times past (Count-4)/5 extrapolate
    // the last chords (fraction up to 4 at time = nodeCount-1); negative time
    // clamps the index to 0 but keeps the negative fraction.
    const idx = clampInt(floatToInt32(t5), 0, count - 4);
    const a = this.getItem(idx);
    const b = this.getItem(idx + 1);
    const pos = Vector3.LerpUnclamped(a.startPoint, b.startPoint, f(t5 - f(idx)));
    if (sideOffset === undefined) return pos; // 1-arg overload @0x740080
    // 2-arg overload @0x7401b0: C# `sideOffset != 0f` is TRUE for NaN
    // (vucomiss jne/jnp falls through on unordered) — NaN propagates, faithful.
    if (sideOffset !== 0) {
      const vel = this.sampleVelDirect(time);
      return pos.add(Vector3.Cross(Vector3.up, vel).mulScalar(sideOffset));
    }
    return pos;
  }

  // SampleVelDirect @0x740260 — lerped sample velocities, then NORMALIZED
  // (static Vector3.Normalize @0x98d750: mag > 1e-5f ? v/mag : zero).
  sampleVelDirect(time: number): Vector3 {
    const t5 = f(f(time) * TIME_SCALE); // DAT_00b7fd94
    const count = this.splineSegments.length;
    const idx = clampInt(floatToInt32(t5), 0, count - 4); // same Count-4 quirk
    const a = this.getItem(idx);
    const b = this.getItem(idx + 1);
    const v = Vector3.LerpUnclamped(a.velocity, b.velocity, f(t5 - f(idx)));
    return Vector3.Normalize(v); // @0x7403ac
  }

  // SampleLinearDistance @0x7403e0
  sampleLinearDistance(distance: number): Vector3 {
    const time = this.distanceToTime(distance, FRESH_LAST_TIME); // DAT_00b7fd98 = -1
    return this.sampleDirect(time);
  }

  // DistanceToTime @0x740410
  // distance → node time (integer part = node index; fraction = arc-length
  // fraction across the WHOLE node span). lastTime < 0 → fresh BinarySearch;
  // otherwise incremental backward-then-forward scan from (int)lastTime*5.
  // The found sample index only selects the node via sourcePointIndex.
  distanceToTime(distance: number, lastTime: number = FRESH_LAST_TIME): number {
    const d = Mathf.Clamp(distance, 0, this.m_curveLength); // float Clamp @0x8459a0 (max = +0x28, CONFIRMED)
    let found: number;
    // C# source shape `if (lastTime < 0f) fresh else incremental`: NaN lastTime
    // compares unordered → INCREMENTAL branch (vucomiss/jbe @0x7404a8), then
    // (int)NaN = int.MinValue → out-of-range index → exception path.
    if (lastTime < 0) {
      // ---- fresh search ----
      this.sortSegment.dist = f(d); // reusable key @0x7404c0
      const bs = this.binarySearch(this.sortSegment);
      found = bs >= 0 ? bs : -2 - bs; // ~bs - 1 @0x7404e5
    } else {
      // ---- incremental search ----
      const intLast = floatToInt32(lastTime);
      let i = (intLast * SUBSEG_NUM) | 0; // cast BEFORE *5 (vcvttss2si + lea @0x7404f9)
      found = i;
      if (intLast > 0) {
        // backward scan: check i, i-1, ..., 1 (never 0; dist[0] is 0)
        for (;;) {
          const seg = this.getItem(i);
          found = i;
          if (seg.dist <= d) break;
          found = i - 1;
          const more = i >= 2; // cmp $2 / jge on OLD i @0x740541
          i = found;
          if (!more) break;
        }
      }
      // forward scan: advance while dist[idx+1] <= d; `found` records the
      // candidate BEFORE each advance (asm r15d = ebx pre-increment @0x740580).
      const count = this.splineSegments.length;
      let idx = found;
      for (;;) {
        found = idx;
        if (count - 1 <= idx) break;
        const next = this.getItem(idx + 1);
        idx = idx + 1;
        if (!(next.dist <= d)) break; // NaN dist exits (vucomiss/jbe)
      }
    }

    // ---- common tail: node interpolation ----
    const count2 = this.splineSegments.length;
    if (count2 - 1 <= found) {
      // FAITHFUL QUIRK: returns (float)(Count-1) — a SAMPLE-index value, not a
      // node time. Reachable when distance >= curveLength (fresh search) or on
      // an empty curve (returns -1). CorePathMove guards distance < curveLength.
      return f(count2 - 1); // @0x7406a4
    }
    const n = this.getItem(found).sourcePointIndex;
    const dStart = this.getItem(n * SUBSEG_NUM).dist;
    const lastIdx = n * SUBSEG_NUM + 4;
    let nodeLast = this.getItem(lastIdx);
    const dLast = nodeLast.dist;
    nodeLast = this.getItem(lastIdx); // re-read (same object; kept for parity)
    const denom = f(f(dLast + nodeLast.length) - dStart); // vaddss/vsubss @0x740688
    const frac = f(f(d - dStart) / denom);
    return f(f(n) + frac); // vcvtsi2ss + vaddss @0x740699
  }

  /** List<SegmentData>.BinarySearch(item) → Array.DoBinarySearch with
   *  Comparer<SegmentData>.Default (CompareTo by dist). Algorithm per the .NET
   *  reference source (dump.cs confirms DoBinarySearch in this IL2CPP profile;
   *  the generic body is RGCTX-dispatched shared code, not in the decompiled
   *  set): mid = lo + ((hi-lo)>>1); miss → ~lo. Duplicate dist values return
   *  the FIRST midpoint hit — determinism-critical, do not "improve". */
  private binarySearch(item: SegmentData): number {
    let lo = 0;
    let hi = this.splineSegments.length - 1;
    while (lo <= hi) {
      const mid = (lo + ((hi - lo) >> 1)) | 0;
      const c = this.splineSegments[mid].compareTo(item);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return ~lo;
  }

  // NodeTimeToDistance @0x7406d0
  // t5 = Max(time,0)*5; idx = Min(FloorToInt(t5), Count-2);
  // dist[idx] + (t5-idx)*length[idx].
  // FAITHFUL QUIRK: clamp max Count-2 → times beyond (Count-2)/5 extrapolate
  // along the second-to-last chord; NodeTimeToDistance(nodeCount-1) is
  // generally NOT curveLength.
  nodeTimeToDistance(time: number): number {
    const t5 = f(Mathf.Max(time, 0) * TIME_SCALE); // DAT_00b7fda0; Max @0x845690
    const floor = Mathf.FloorToInt(t5); // vroundss floor + cvttss2si @0x8458a0
    const count = this.splineSegments.length;
    const idx = floor < count - 2 ? floor : count - 2; // Mathf.Min(int) @0x845680
    const seg = this.getItem(idx);
    return f(f(f(t5 - f(idx)) * seg.length) + seg.dist); // @0x7407a7..0x7407b0
  }
}
