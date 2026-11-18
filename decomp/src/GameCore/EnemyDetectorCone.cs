// GameCore/EnemyDetectorCone.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Conical (frustum) enemy detection/attack volume hanging DOWNWARD from an anchor
// point: radius `upperRadius` at the top (pos) tapering to `lowerRadius` at
// pos - up*height. Detection scales radii by m_radiusScale; attack by affectRate.
// Field offsets from global-metadata.dat; logic from Ghidra (RVA 0x9446D0..0x944DC0).

using UnityEngine;

namespace GameCore
{
    public class EnemyDetectorCone : IEnemyDetector
    {
        private const float k_anchor = 1.0f;
        private float upperRadius;     // 0x1C
        private float lowerRadius;     // 0x20
        private float affectRate;      // 0x28
        private float m_radiusScale;   // 0x2C

        // <offset>k__BackingField @0x10, <height>k__BackingField @0x24 (auto-properties)
        public Vector3 offset { get; set; }
        public float height { get; set; }

        // .ctor @0x9446D0
        public EnemyDetectorCone(Vector3 aOffset, float aUpper, float aLower, float aHeight, float affect)
        {
            offset = aOffset;
            upperRadius = aUpper;
            lowerRadius = aLower;
            height = aHeight;
            affectRate = affect;
            m_radiusScale = 1.0f;
        }

        // get_UpperRadius @0x944790
        public float UpperRadius
        {
            get { return upperRadius * m_radiusScale; }
        }

        // get_LowerRadius @0x9447A0
        public float LowerRadius
        {
            get { return lowerRadius * m_radiusScale; }
        }

        // get_AffectUpperRadius @0x9447B0
        public float AffectUpperRadius
        {
            get { return upperRadius * affectRate; }
        }

        // get_AffectLowerRadius @0x9447C0
        public float AffectLowerRadius
        {
            get { return lowerRadius * affectRate; }
        }

        // GetCollisionCylinder @0x9447D0 — bounding cylinder (max radius, full height).
        public Cylinder GetCollisionCylinder()
        {
            return new Cylinder(
                Mathf.Max(upperRadius * m_radiusScale, lowerRadius * m_radiusScale), height);
        }

        // GetAffectCylinder @0x944860
        public Cylinder GetAffectCylinder()
        {
            return new Cylinder(
                Mathf.Max(upperRadius * affectRate, lowerRadius * affectRate), height);
        }

        // InDetection @0x9448F0 (object overload)
        public bool InDetection(Vector3 pos, GameCoreObject other)
        {
            return IntersectWithObject(pos, other,
                upperRadius * m_radiusScale, lowerRadius * m_radiusScale, height);
        }

        // InDetection @0x944BA0 (position overload)
        // INFERRED: Ghidra dropped the forwarded args; radii mirror the object overload.
        public bool InDetection(Vector3 pos, Vector3 otherPos)
        {
            return IntersectWithPos(pos, otherPos,
                upperRadius * m_radiusScale, lowerRadius * m_radiusScale, height);
        }

        // InAttack @0x944D50 (object overload)
        public bool InAttack(Vector3 pos, GameCoreObject other)
        {
            return IntersectWithObject(pos, other,
                upperRadius * affectRate, lowerRadius * affectRate, height);
        }

        // InAttack @0x944D70 (position overload)
        // INFERRED: Ghidra dropped the forwarded args; radii mirror the object overload.
        public bool InAttack(Vector3 pos, Vector3 otherPos)
        {
            return IntersectWithPos(pos, otherPos,
                upperRadius * affectRate, lowerRadius * affectRate, height);
        }

        // IntersectWithObject @0x944910
        // Tests the other object's collision cylinder against the downward frustum.
        public bool IntersectWithObject(Vector3 pos, GameCoreObject other,
            float upper, float lower, float aHeight)
        {
            Vector3 bottom = pos + Vector3.down * aHeight;
            Vector3 otherPos = other.position;
            Cylinder col = other.collision;
            Vector3 otherTop = otherPos + Vector3.up * col.height;

            // Vertical overlap between [otherPos.y, otherTop.y] and [bottom.y, pos.y].
            if (otherPos.y > pos.y)
                return false;
            if (otherTop.y < bottom.y)
                return false;

            // Horizontal distance from the cone axis, minus the other's radius.
            Vector3 diff = new Vector3(otherPos.x - pos.x, 0.0f, otherPos.z - pos.z);
            float dist = diff.magnitude;
            if (dist - col.radius > Mathf.Max(upper, lower))
                return false;

            // Cone radius at the other's top and bottom heights; take the wider.
            float coneRadius = Mathf.Max(
                upper - (lower - upper) * ((otherTop.y - pos.y) / aHeight),
                upper - (lower - upper) * ((otherPos.y - pos.y) / aHeight));
            return dist - col.radius <= coneRadius;
        }

        // IntersectWithPos @0x944BC0 — point version (no other radius).
        public bool IntersectWithPos(Vector3 pos, Vector3 otherPos,
            float upper, float lower, float aHeight)
        {
            Vector3 bottom = pos + Vector3.down * aHeight;
            if (otherPos.y > pos.y)
                return false;
            if (otherPos.y < bottom.y)
                return false;

            Vector3 diff = new Vector3(otherPos.x - pos.x, 0.0f, otherPos.z - pos.z);
            float dist = diff.magnitude;
            if (dist > Mathf.Max(upper, lower))
                return false;

            return dist <= upper - (lower - upper) * ((otherPos.y - pos.y) / aHeight);
        }

        // GetAnchorV @0x944D90
        public float GetAnchorV()
        {
            return k_anchor;
        }

        // GetOffset @0x944DA0
        public Vector3 GetOffset()
        {
            return offset;
        }

        // Upgrade @0x944DB0
        public void Upgrade(float scale, float affectScale)
        {
            m_radiusScale = scale;
            affectRate = affectScale;
        }

        // GetRadiusScale @0x944DC0
        public float GetRadiusScale()
        {
            return m_radiusScale;
        }
    }
}