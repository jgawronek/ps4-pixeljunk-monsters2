// GameCore/EnemyDetectorSphere.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Spherical enemy detection/attack volume (used by towers). "Detection" uses the
// radius scaled by m_radiusScale; "attack/affect" uses the radius scaled by affect.
// Field offsets from global-metadata.dat; logic from Ghidra (RVA 0x944DD0..0x9450E0).

using UnityEngine;

namespace GameCore
{
    public class EnemyDetectorSphere : IEnemyDetector
    {
        private const float k_anchor = 0.5f;
        private float radius;          // 0x10
        private float m_radiusScale;   // 0x20
        private float affect;          // 0x24

        // <offset>k__BackingField @0x14 (auto-property)
        public Vector3 offset { get; set; }

        // .ctor @0x944DD0
        public EnemyDetectorSphere(Vector3 aOffset, float aRadius, float aAffect)
        {
            offset = aOffset;
            radius = aRadius;
            affect = aAffect;
            m_radiusScale = 1.0f;
        }

        // get_Radius @0x944E50
        public float Radius
        {
            get { return radius * m_radiusScale; }
        }

        // get_AffectRadius @0x944E60
        public float AffectRadius
        {
            get { return radius * affect; }
        }

        // GetCollisionCylinder @0x944E70
        public Cylinder GetCollisionCylinder()
        {
            float r = radius * m_radiusScale;
            return new Cylinder(r, r + r);
        }

        // GetAffectCylinder @0x944E90
        public Cylinder GetAffectCylinder()
        {
            float r = radius * affect;
            return new Cylinder(r, r + r);
        }

        // InDetection @0x944EB0 (object overload)
        public bool InDetection(Vector3 pos, GameCoreObject other)
        {
            return Vector3.Distance(other.position, pos) <= radius * m_radiusScale;
        }

        // InDetection @0x944F70 (position overload)
        public bool InDetection(Vector3 pos, Vector3 otherPos)
        {
            return Vector3.Distance(otherPos, pos) <= radius * m_radiusScale;
        }

        // InAttack @0x945000 (object overload) — uses the affect radius.
        public bool InAttack(Vector3 pos, GameCoreObject other)
        {
            return Vector3.Distance(other.position, pos) <= radius * affect;
        }

        // InAttack @0x945060 (position overload)
        // NOTE: the original reads m_radiusScale (0x20) here, NOT affect (0x24) —
        // i.e. this overload tests the detection radius. Reproduced faithfully;
        // this looks like an original-code inconsistency vs. the object overload.
        public bool InAttack(Vector3 pos, Vector3 otherPos)
        {
            return Vector3.Distance(otherPos, pos) <= radius * m_radiusScale;
        }

        // IntersectWithObject @0x944F10
        public bool IntersectWithObject(Vector3 pos, GameCoreObject other, float radius)
        {
            return Vector3.Distance(other.position, pos) <= radius;
        }

        // IntersectWithPos @0x944FC0
        public bool IntersectWithPos(Vector3 pos, Vector3 otherPos, float radius)
        {
            return Vector3.Distance(otherPos, pos) <= radius;
        }

        // GetAnchorV @0x9450B0
        public float GetAnchorV()
        {
            return k_anchor;
        }

        // GetOffset @0x9450C0
        public Vector3 GetOffset()
        {
            return offset;
        }

        // Upgrade @0x9450D0
        public void Upgrade(float scale, float affectScale)
        {
            m_radiusScale = scale;
            affect = affectScale;
        }

        // GetRadiusScale @0x9450E0
        public float GetRadiusScale()
        {
            return m_radiusScale;
        }
    }
}