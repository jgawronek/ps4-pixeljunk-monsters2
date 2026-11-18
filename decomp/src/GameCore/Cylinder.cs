// GameCore/Cylinder.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Collision volume of a GameCoreObject: a vertical cylinder (radius in XZ,
// height along Y). Used by GameCoreCollisionManager for broad/narrow phase.
// Field offsets from global-metadata.dat (TypeDefIndex 2980); logic from Ghidra.
// NOTE: the decompiler addresses struct fields through a 0x10 object-header
// bias; the offsets below are the true in-struct offsets from the skeleton.

namespace GameCore
{
    public struct Cylinder
    {
        public float radius;   // 0x0
        public float height;   // 0x4

        // .ctor @0x942270
        public Cylinder(float a_radius, float a_height)
        {
            radius = a_radius;
            height = a_height;
        }

        // .ctor @0x942370 (shared body FUN_00942280)
        // Builds a cylinder that encloses a Bounds: height = bounds.size.y;
        // radius = Lerp(min(extents.x, extents.z), max(extents.x, extents.z), 0.2).
        // The 0.2 Lerp factor is the literal at 0x00BA4480 (confirmed float read).
        public Cylinder(UnityEngine.Bounds a_bounds)
        {
            UnityEngine.Vector3 size = a_bounds.size;
            UnityEngine.Vector3 extents = a_bounds.extents;
            height = size.y;
            float min = UnityEngine.Mathf.Min(extents.x, extents.z);
            float max = UnityEngine.Mathf.Max(extents.x, extents.z);
            radius = UnityEngine.Mathf.Lerp(min, max, 0.2f);
        }
    }
}
