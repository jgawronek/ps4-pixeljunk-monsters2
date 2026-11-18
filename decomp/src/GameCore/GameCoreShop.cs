// GameCore/GameCoreShop.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Sim-side placeholder for the Q4.Shop view (the in-level tower shop stand).
// It carries no state: it exists so the shop occupies a collision-grid slot at
// the origin and can re-find its scene viewer after a load/resync by nearest
// renderer position (same pattern as the other IPlaceableViewObject sim sides).
// Logic from Ghidra decompilation (RVA 0x4CD940..0x4CDB00).
// Float constants CONFIRMED from ELF .rodata: DAT_00b7c250 = 0.5 (collision
// radius AND height), DAT_00b7c448 = 1.0 (squared viewer-match distance).

using UnityEngine;

namespace GameCore
{
    internal class GameCoreShop : GameCoreObject // TypeDefIndex: 3066
    {
        private const float CollisionRadius = 0.5f;   // DAT_00b7c250
        private const float CollisionHeight = 0.5f;   // DAT_00b7c250 (same literal)
        private const float ViewerMatchSqrDistance = 1.0f;   // DAT_00b7c448

        // .ctor @0x4CD940
        // The binary inlines the GameCoreObject base init: fresh handle from
        // s_nextHandle, collision cylinder (0.5, 0.5), position = Vector3.zero,
        // registration with the collision manager and the current frame.
        public GameCoreShop()
        {
            collision = new Cylinder(CollisionRadius, CollisionHeight);
            position = Vector3.zero;
        }

        // RecreateViewer @0x4CD950 (virtual slot 5)
        // Finds the shop's scene GameObject: scans every loaded Renderer
        // (Resources.FindObjectsOfTypeAll) in loaded scenes and returns the
        // first one whose position is within 1.0 squared distance of the sim
        // position (the shop never moves). Returns null when none matches.
        public override GameObject RecreateViewer()
        {
            Renderer[] renderers = Resources.FindObjectsOfTypeAll<Renderer>();
            if (renderers != null)
            {
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    GameObject go = renderer.gameObject;
                    if (!go.scene.isLoaded)
                        continue;
                    Vector3 delta = renderer.transform.position - position;
                    // FUN_0098dcd0 = Vector3.sqrMagnitude (same shared body as
                    // in TowerHelper.GetNearestTargets).
                    if (delta.sqrMagnitude < ViewerMatchSqrDistance)
                        return go;
                }
            }
            return null;
        }
    }
}
