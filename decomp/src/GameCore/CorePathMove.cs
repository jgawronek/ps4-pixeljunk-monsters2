// GameCore/CorePathMove.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Wraps a Q4.CatmullCurve path and converts travelled distance into curve samples.
// Caches the last curve parameter (m_lastCurveTime) so DistanceToTime can search
// incrementally from the previous position. Field offsets from global-metadata.dat.

using UnityEngine;
using Q4; // CatmullCurve, WaveData

namespace GameCore
{
    public class CorePathMove
    {
        private CatmullCurve m_curve;        // 0x10
        private float m_lastCurveTime;       // 0x18
        private WaveData m_minionWaveData;   // 0x20

        // .ctor @0x942020
        public CorePathMove(CatmullCurve pathCurve)
        {
            m_lastCurveTime = -1.0f;
            m_curve = pathCurve;
        }

        // get_pathLength @0x942050
        public float pathLength
        {
            get { return m_curve.curveLength; }
        }

        // get_curveLengthBeforeActivation @0x942070
        public float curveLengthBeforeActivation
        {
            get { return m_curve.curveLengthB4Activation; }
        }

        // IsSameCurve @0x93C530
        // True when both paths reference the same curve id. (Null dereferences in the
        // original surface as NullReferenceException; omitted here for clarity.)
        public bool IsSameCurve(CorePathMove other)
        {
            return m_curve.ID == other.m_curve.ID;
        }

        // Sample @0x942090 — position only, by linear distance along the curve.
        // Returns false (and zero) once distance reaches/exceeds the curve length.
        public bool Sample(float distance, out Vector3 position)
        {
            if (m_curve.curveLength <= distance)
            {
                position = Vector3.zero;
                return false;
            }
            position = m_curve.SampleLinearDistance(distance);
            return true;
        }

        // Sample @0x942110 — position + velocity, with a lateral side offset.
        public bool Sample(float distance, float sideOffset, out Vector3 position, out Vector3 vel)
        {
            if (m_curve.curveLength <= distance)
            {
                position = Vector3.zero;
                vel = Vector3.zero;
                return false;
            }
            m_lastCurveTime = m_curve.DistanceToTime(distance, m_lastCurveTime);
            position = m_curve.SampleDirect(m_lastCurveTime, sideOffset);
            vel = m_curve.SampleVelDirect(m_lastCurveTime);
            return true;
        }

        // GetMinionWaveData @0x9421F0
        public WaveData GetMinionWaveData()
        {
            return m_minionWaveData;
        }

        // DistanceToTime @0x942200 — fresh search (lastTime = -1).
        public float DistanceToTime(float distance)
        {
            return m_curve.DistanceToTime(distance, -1.0f);
        }

        // NodeTimeToDistance @0x942230
        public float NodeTimeToDistance(float time)
        {
            return m_curve.NodeTimeToDistance(time);
        }
    }
}