// Q4/CatmullCurve.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// TypeDefIndex 3770 (CatmullCurve), 3771 (nested SegmentData).
//
// The enemy path spline: a uniform Catmull-Rom curve through originalPathPoints,
// pre-sampled into SUBSEG_NUM=5 chord segments per node span, with a cumulative
// arc-length table (SegmentData.dist/length). DistanceToTime converts travelled
// distance into "node time" (integer part = node index, fraction = arc-length
// fraction WITHIN the whole node span — not within a subsegment); SampleDirect
// converts node time back to a position by lerping the chord table.
// CorePathMove (sim) wraps this class; see pjm2-web/src/core/CorePathMove.ts.
//
// Field offsets from skeleton/Q4.cs; method RVAs below. All .rodata constants
// CONFIRMED by direct float read of Il2CppUserAssemblies.elf
// (file offset = vaddr + 0x4000), and all register-lost arguments in the Ghidra
// output were resolved against objdump disassembly of the same ELF
// (scratch: pjm2-web/.work/catmull/*.asm).
//
// .rodata constant block (all CONFIRMED from ELF):
//   DAT_00b7fd64 = 5.0   // subsegment t divisor (BuildCurveData @0x73f7fd)
//   DAT_00b7fd68 = 0.5   // velocity: half-scalar
//   DAT_00b7fd6c = 2.0   // velocity: 2*cp1 term AND final *2 on the t term
//   DAT_00b7fd70 = 5.0   // velocity: -5*p1 term
//   DAT_00b7fd74 = 4.0   // velocity: +4*p2 term
//   DAT_00b7fd78 = 3.0   // velocity: 3*p1/3*p2 terms AND final *3 on the t² term
//   DAT_00b7fd7c = 3.0   // position: 3*p1/3*p2 (cubic coeff)
//   DAT_00b7fd80 = 2.0   // position: 2*cp1 (quad coeff) and +2*p1 constant term
//   DAT_00b7fd84 = 5.0   // position: -5*p1 (quad coeff)
//   DAT_00b7fd88 = 4.0   // position: +4*p2 (quad coeff)
//   DAT_00b7fd8c = 0.5   // position: final half-scalar
//   DAT_00b7fd90 = 5.0   // SampleDirect: time → sample-space scale
//   DAT_00b7fd94 = 5.0   // SampleVelDirect: time → sample-space scale
//   DAT_00b7fd98 = -1.0  // SampleLinearDistance: DistanceToTime lastTime default
//   DAT_00b7fda0 = 5.0   // NodeTimeToDistance: time → sample-space scale
//   (Vector3.Normalize kEpsilon @0x00ba4664 = 1e-5f, CONFIRMED)

using System;
using System.Collections.Generic;
using System.Runtime.Serialization;
using UnityEngine;

namespace Q4
{
    public class CatmullCurve
    {
        private const int SUBSEG_NUM = 5;

        private List<SegmentData> splineSegments = new List<SegmentData>(); // 0x10 (field initializer: ctor writes it before base ctor)
        private List<Vector3> originalPathPoints;                           // 0x18
        private int activateIndex;                                          // 0x20
        private int m_ID = -1;                                              // 0x24 (field initializer: ctor writes 0xffffffff before base ctor)
        public float curveLength { get; private set; }                      // 0x28 <curveLength>k__BackingField
        public float curveLengthB4Activation { get; private set; }          // 0x2C <curveLengthB4Activation>k__BackingField
        private SegmentData sortSegment = new SegmentData();                // 0x30 (field initializer; reused BinarySearch key)

        public int ID { get { return m_ID; } }                              // get_ID @0x73FA10

        // .ctor @0x73F460
        public CatmullCurve(int a_id, List<Vector3> pathPoints, int activateIdx)
        {
            // (splineSegments / m_ID=-1 / sortSegment initializers above run first)
            m_ID = a_id;                                    // +0x24
            activateIndex = activateIdx;                    // +0x20
            originalPathPoints = new List<Vector3>(pathPoints); // +0x18, copy ctor
            BuildCurveData(pathPoints);                     // NOTE: builds from the PARAMETER, not the copy
        }

        // OnDeserializedMethod @0x73FA20 ([OnDeserialized])
        private void OnDeserializedMethod(StreamingContext context)
        {
            splineSegments = new List<SegmentData>();
            BuildCurveData(originalPathPoints);
        }

        // BuildCurveData @0x73F550
        // Samples each node span [i, i+1] at t = sub/5 (sub = 0..4; fp32 DIVISION,
        // confirmed vcvtsi2ss + vdivss DAT_00b7fd64 @0x73f7f8; for sub ∈ 0..4
        // the value coincides with sub*0.2f, but division is the emitted op).
        // NOTE: the table's last sample is at t = (N-1) - 0.2 — the final
        // endpoint t = N-1 is NEVER sampled (curveLength stops one subsegment
        // short of the full path; SampleDirect extrapolates there).
        // Endpoint control points are reflected:
        //   cp1(first) = p0 - (p1 - p0);  cp2(last) = pLast + (pLast - p[count-2]).
        // dist[k] = cumulative chord length up to sample k; length[k] = chord to
        // sample k+1 (written when k+1 is added; last sample's length stays 0).
        private void BuildCurveData(List<Vector3> pathPoints)
        {
            curveLength = 0f;                               // +0x28 = 0 @0x73f589
            splineSegments.Clear();                         // NRE if splineSegments null (binary: exception path)
            // binary: pathPoints == null → NullReferenceException (ud2 @0x73fa01); no guard
            splineSegments.Capacity = pathPoints.Count * SUBSEG_NUM;
            int count = pathPoints.Count;
            if (count < 2) return;                          // cmp $2 / jl @0x73f5fa

            int lastNode = count - 2;                       // r12d @0x73f60a
            int i = 0;
            do
            {
                Vector3 controlPoint1, segmentEnd1, segmentEnd2, controlPoint2;
                if (i == 0)
                {
                    Vector3 p0 = pathPoints[0];
                    Vector3 p1 = pathPoints[1];
                    controlPoint1 = p0 - (p1 - p0);         // @0x73f650..0x73f6c5
                }
                else
                {
                    controlPoint1 = pathPoints[i - 1];
                }
                segmentEnd1 = pathPoints[i];
                segmentEnd2 = pathPoints[i + 1];
                if (i < lastNode)
                {
                    controlPoint2 = pathPoints[i + 2];
                }
                else
                {
                    Vector3 last = pathPoints[count - 1];   // @0x73f730..0x73f7aa
                    controlPoint2 = last + (last - pathPoints[lastNode]);
                }

                if (activateIndex == i)                     // @0x73f7bc
                    curveLengthB4Activation = curveLength;  // +0x2C = +0x28

                int sub = -1;                               // r13d = -1 @0x73f7ca
                do
                {
                    SegmentData seg = new SegmentData();
                    sub++;                                  // 0..4
                    seg.sourcePointIndex = i;               // +0x30
                    float t = (float)sub / 5f;              // DAT_00b7fd64 = 5.0 (CONFIRMED fp32 division)
                    // velocity evaluated BEFORE position (call order @0x73f842 / @0x73f888)
                    seg.velocity = EvaluateSplineSegmentVelocity(controlPoint1, segmentEnd1, segmentEnd2, controlPoint2, t);
                    seg.startPoint = EvaluateSplineSegment(controlPoint1, segmentEnd1, segmentEnd2, controlPoint2, t);

                    float d;
                    if (splineSegments.Count >= 1)
                    {
                        SegmentData prev = splineSegments[splineSegments.Count - 1];
                        d = Vector3.Distance(seg.startPoint, prev.startPoint); // @0x73f931
                        prev.length = d;                    // prev +0x2C
                        curveLength = d + curveLength;      // vaddss d,curveLength @0x73f988 (commutative; order as emitted)
                        d = curveLength;                    // fVar12 reassigned to the CUMULATIVE value @0x73f988
                    }
                    else
                    {
                        d = curveLength;                    // first sample: 0
                    }
                    seg.dist = d;                           // +0x28 = cumulative arc length
                    splineSegments.Add(seg);
                } while (sub < 4);                          // cmp $4 / jl @0x73f9c4

                bool more = i < lastNode;                   // @0x73f9dc
                i++;
                if (!more) break;
            } while (true);
        }

        // EvaluateSplineSegmentVelocity @0x73FAD0
        // P'(t) = 0.5*(p2-cp1) + (0.5*A)*t*2 + (0.5*B)*t²*3  where
        //   A = 2cp1 - 5p1 + 4p2 - cp2,  B = -cp1 + 3p1 - 3p2 + cp2.
        // Operation order below is the exact emitted order (fp32 parity):
        // the half-scalars are applied to A/B BEFORE the t/t² multiplies, and
        // the *2 / *3 are separate trailing multiplies (NOT folded into 1.0/1.5).
        private static Vector3 EvaluateSplineSegmentVelocity(Vector3 controlPoint1, Vector3 segmentEnd1, Vector3 segmentEnd2, Vector3 controlPoint2, float t)
        {
            float t2 = t * t;                               // @0x73fb23
            Vector3 lin = segmentEnd2 - controlPoint1;      // @0x73fb30 (p2 - cp1, CONFIRMED from asm)
            Vector3 term0 = 0.5f * lin;                     // DAT_00b7fd68 @0x73fb39
            Vector3 a = ((2f * controlPoint1 - 5f * segmentEnd1) + 4f * segmentEnd2) - controlPoint2; // fd6c/fd70/fd74
            Vector3 halfA = 0.5f * a;                       // fd68 @0x73fc1b
            Vector3 b = ((-controlPoint1 + 3f * segmentEnd1) - 3f * segmentEnd2) + controlPoint2;    // fd78
            Vector3 halfB = 0.5f * b;                       // fd68 @0x73fcf2
            Vector3 term1 = (halfA * t) * 2f;               // @0x73fd32 then fd6c @0x73fd37
            Vector3 acc = term0 + term1;                    // @0x73fd61
            Vector3 term2 = (halfB * t2) * 3f;              // @0x73fd89 then fd78 @0x73fd8e
            return acc + term2;                             // tail op_Addition @0x73fdbd
        }

        // EvaluateSplineSegment @0x73FDD0
        // P(t) = 0.5 * (B*t³ + A*t² + (p2-cp1)*t + 2*p1) — standard uniform
        // Catmull-Rom (tension 0.5). t³ = (t*t)*t, left-associative fp32.
        private static Vector3 EvaluateSplineSegment(Vector3 controlPoint1, Vector3 segmentEnd1, Vector3 segmentEnd2, Vector3 controlPoint2, float t)
        {
            float t2 = t * t;                               // @0x73fe17
            Vector3 b = ((-controlPoint1 + 3f * segmentEnd1) - 3f * segmentEnd2) + controlPoint2; // fd7c
            float t3 = t2 * t;                              // @0x73fec4
            Vector3 cubicTerm = b * t3;                     // @0x73fec9
            Vector3 a = ((2f * controlPoint1 - 5f * segmentEnd1) + 4f * segmentEnd2) - controlPoint2; // fd80/fd84/fd88
            Vector3 quadTerm = a * t2;                      // @0x73ff95
            Vector3 acc = cubicTerm + quadTerm;             // @0x73ffb0
            Vector3 lin = -controlPoint1 + segmentEnd2;     // @0x73ffd0 (fresh negation)
            Vector3 linTerm = lin * t;                      // @0x73fff1
            acc = acc + linTerm;                            // @0x74000c
            acc = acc + 2f * segmentEnd1;                   // fd80 @0x74001b, add @0x74004c
            return 0.5f * acc;                              // fd8c, tail op_Multiply @0x740078
        }

        // SampleDirect @0x740080 (position only)
        // FAITHFUL QUIRK: index clamp max is Count-4 (not Count-5/Count-1), so
        // for time > (Count-4)/5 the last chords are LerpUnclamped-EXTRAPOLATED;
        // at time = nodeCount-1 the fraction reaches 4. Negative time clamps the
        // index to 0 but keeps the negative fraction (backward extrapolation).
        public Vector3 SampleDirect(float time)
        {
            float t5 = time * 5f;                           // DAT_00b7fd90 (CONFIRMED)
            int idx = Mathf.Clamp((int)t5, 0, splineSegments.Count - 4); // int Clamp @0x8459b0; (int) = cvttss2si truncation
            SegmentData a = splineSegments[idx];            // binary: NRE/ArgumentOutOfRange → exception path
            SegmentData b = splineSegments[idx + 1];
            return Vector3.LerpUnclamped(a.startPoint, b.startPoint, t5 - (float)idx); // @0x740180
        }

        // SampleDirect @0x7401B0 (with lateral side offset)
        // offset = Cross(up, tangent) * sideOffset. C# `sideOffset != 0f` is TRUE
        // for NaN (asm vucomiss jne/jnp @0x7401d4 falls through on unordered),
        // so a NaN sideOffset propagates NaN into the position — faithful.
        public Vector3 SampleDirect(float time, float sideOffset)
        {
            Vector3 pos = SampleDirect(time);
            if (sideOffset != 0f)
            {
                Vector3 vel = SampleVelDirect(time);
                pos = pos + Vector3.Cross(Vector3.up, vel) * sideOffset;
            }
            return pos;
        }

        // SampleVelDirect @0x740260
        // Lerps the stored per-sample velocities, then NORMALIZES (static
        // Vector3.Normalize @0x98d750, CONFIRMED: sqrMag=(x²+y²)+z², vsqrtss,
        // mag > 1e-5f ? v/mag : zero). Same Count-4 clamp quirk as SampleDirect.
        public Vector3 SampleVelDirect(float time)
        {
            float t5 = time * 5f;                           // DAT_00b7fd94 (CONFIRMED)
            int idx = Mathf.Clamp((int)t5, 0, splineSegments.Count - 4);
            Vector3 v = Vector3.LerpUnclamped(splineSegments[idx].velocity, splineSegments[idx + 1].velocity, t5 - (float)idx);
            return Vector3.Normalize(v);                    // @0x7403ac
        }

        // SampleLinearDistance @0x7403E0
        public Vector3 SampleLinearDistance(float distance)
        {
            float time = DistanceToTime(distance, -1f);     // DAT_00b7fd98 = -1.0 (CONFIRMED)
            return SampleDirect(time);
        }

        // DistanceToTime @0x740410
        // distance → node time. lastTime < 0 → fresh BinarySearch on the dist
        // table; otherwise incremental scan (backward from (int)lastTime*5,
        // then forward). The found sample index is used ONLY to pick the node
        // (sourcePointIndex); the returned fraction is arc-length-linear across
        // the WHOLE node span: n + (d - D[n*5]) / (D[n*5+4] + L[n*5+4] - D[n*5]).
        //
        // FAITHFUL QUIRK 1: when the found index >= Count-1 (distance >=
        // curveLength), returns (float)(Count-1) — a SAMPLE-index value, not a
        // node time (5*(nodeCount-1)-1). Callers (CorePathMove.Sample) guard
        // distance < curveLength, so this is effectively unreachable in play.
        // FAITHFUL QUIRK 2: with duplicate dist entries (zero-length chords),
        // fresh BinarySearch returns the first midpoint hit while the
        // incremental forward scan returns the LAST duplicate — the two paths
        // can pick different nodes (even NaN vs finite time on degenerate
        // curves). Both behaviors are reproduced exactly.
        // NaN lastTime: `lastTime < 0f` is false for NaN (vucomiss/jbe
        // @0x7404a8 falls into the incremental branch), (int)NaN = int.MinValue
        // → out-of-range index → exception path, same as the binary.
        public float DistanceToTime(float distance, float lastTime = -1f)
        {
            float d = Mathf.Clamp(distance, 0f, curveLength); // float Clamp @0x8459a0, args CONFIRMED from asm (xmm2 = +0x28)
            int found;
            // Source shape per asm: `lastTime < 0f` → fresh, ELSE incremental.
            // NaN lastTime compares unordered → INCREMENTAL (vucomiss/jbe
            // @0x7404a8), then (int)NaN = int.MinValue → exception path.
            if (lastTime < 0f)
            {
                // ---- fresh search ----
                sortSegment.dist = d;                        // +0x28 of the reusable key @0x7404c0
                int bs = splineSegments.BinarySearch(sortSegment); // CompareTo by dist (ascending)
                found = bs >= 0 ? bs : -2 - bs;              // ~bs - 1 @0x7404e5
            }
            else
            {
                // ---- incremental search ----
                int i = (int)lastTime * SUBSEG_NUM;         // vcvttss2si THEN lea *5 @0x7404f9 (cast before multiply, CONFIRMED)
                found = i;
                if ((int)lastTime > 0)
                {
                    // backward scan: check i, i-1, ..., 1 (never 0; dist[0] is 0)
                    while (true)
                    {
                        SegmentData seg = splineSegments[i]; // binary: exception path if out of range
                        found = i;
                        if (seg.dist <= d) break;
                        found = i - 1;
                        bool more = i >= 2;                  // cmp $2 / jge @0x740541 (old i)
                        i = found;
                        if (!more) break;
                    }
                }
                // forward scan: advance while dist[idx+1] <= d. `found` records
                // the candidate BEFORE each advance, so on exit it is the last
                // index whose dist <= d (asm @0x740580: r15d = ebx pre-increment).
                int count = splineSegments.Count;
                int idx = found;
                SegmentData next = null;
                do
                {
                    found = idx;
                    if (count - 1 <= idx) break;
                    next = splineSegments[idx + 1];
                    idx = idx + 1;
                } while (next.dist <= d);
            }

            // ---- common tail: node interpolation ----
            int count2 = splineSegments.Count;
            if (count2 - 1 <= found)
            {
                return (float)(count2 - 1);                  // FAITHFUL QUIRK 1 @0x7406a4
            }
            int n = splineSegments[found].sourcePointIndex;  // +0x30
            float dStart = splineSegments[n * SUBSEG_NUM].dist;
            int lastIdx = n * SUBSEG_NUM + 4;
            SegmentData nodeLast = splineSegments[lastIdx];
            float dLast = nodeLast.dist;
            nodeLast = splineSegments[lastIdx];              // re-read (same object; kept for parity)
            float denom = (dLast + nodeLast.length) - dStart; // vaddss/vsubss order @0x740688
            float frac = (d - dStart) / denom;
            return (float)n + frac;                          // vcvtsi2ss + vaddss @0x740699
        }

        // NodeTimeToDistance @0x7406D0
        // Inverse of the sampling grid: t5 = Max(time,0)*5; idx = Min(FloorToInt(t5),
        // Count-2); dist[idx] + (t5-idx)*length[idx].
        // FAITHFUL QUIRK: clamp max is Count-2 (not Count-1), so time beyond
        // (Count-2)/5 extrapolates along the second-to-last chord (fraction up
        // to 2 at time = nodeCount-1); NodeTimeToDistance(nodeCount-1) is
        // generally NOT curveLength.
        public float NodeTimeToDistance(float time)
        {
            float t5 = Mathf.Max(time, 0f) * 5f;             // DAT_00b7fda0 (CONFIRMED); Max @0x845690
            int idx = Mathf.Min(Mathf.FloorToInt(t5), splineSegments.Count - 2); // int Min @0x845680
            SegmentData seg = splineSegments[idx];           // binary: exception path
            return (t5 - (float)idx) * seg.length + seg.dist; // @0x7407a7..0x7407b0
        }

        // ---- nested type (TypeDefIndex 3771) ----
        // Skeleton lists it as "CatmullCurve.SegmentData" (dump flattens nested
        // types into <global>.cs); nesting restored here.
        private class SegmentData : IComparable<SegmentData>
        {
            public Vector3 startPoint;      // 0x10
            public Vector3 velocity;        // 0x1C
            public float dist;              // 0x28 — cumulative arc length at this sample
            public float length;            // 0x2C — chord length to the NEXT sample (0 on the last)
            public int sourcePointIndex;    // 0x30 — node index this sample belongs to

            // .ctor @0x73F540 (default)

            // CompareTo @0x7407D0 (Slot 4) — ascending by dist.
            // Equal-but-NaN does NOT compare 0; NaN <= x is false → returns 1.
            public int CompareTo(SegmentData other)
            {
                // binary: other == null → NullReferenceException (ud2); no guard
                float o = other.dist;
                float m = this.dist;
                if (o == m && !float.IsNaN(o) && !float.IsNaN(m)) return 0;
                return m <= o ? -1 : 1;
            }
        }
    }
}
