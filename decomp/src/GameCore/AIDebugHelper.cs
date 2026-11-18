// GameCore/AIDebugHelper.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Debug gizmo drawing for AI/collision volumes. Both overloads decompile to empty
// bodies (RVA 0x93B530 / 0x93B540) — the gizmo code is compiled out in the shipped
// build (debug-only). Reproduced as no-ops.

using UnityEngine;

namespace GameCore
{
    public static class AIDebugHelper
    {
        // DrawCollisionGizmo @0x93B530 — empty in shipped build.
        public static void DrawCollisionGizmo(GameCoreObject a_coreObject)
        {
            // INFERRED: debug-only; would draw a_coreObject's collision cylinder.
        }

        // DrawCollisionGizmo @0x93B540 — empty in shipped build.
        public static void DrawCollisionGizmo(Vector3 pos, float radius, float height, Color color)
        {
            // INFERRED: debug-only; would draw a cylinder gizmo at pos.
        }
    }
}