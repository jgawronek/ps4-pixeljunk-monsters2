// GameCore/GameCoreTree.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Sim-side proxy for a Q4.NatureTree (fruit tree). Trees are where fruit pickups
// hang from: each plucked fruit "breaks down" the tree (referenceCount++) and a
// regrown/revived fruit decrements it; at 0 the tree is valid again and the view
// is re-activated. Also carries the hidden-pickup index used by
// GameCorePickupManager's hidden-fruit system (DirectlySetPickupDataIndex = 2000
// marks pickup data set directly rather than by index).
//
// Logic from Ghidra decompilation (RVA 0x4C2E60..0x4D1A50). Field offsets from
// global-metadata.dat (skeleton/GameCore.cs, TypeDefIndex 3082).
// Float constants CONFIRMED from ELF .rodata (file offset = vaddr + 0x4000):
//   DAT_00b7c46c = 0.15 (collision radius)   DAT_00b7c470 = 2.0 (collision height)
//   DAT_00b7c474 = 1.0  (viewer position-match threshold)

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreTree : GameCoreObject // TypeDefIndex: 3082
    {
        // Sentinel for hiddenPickupIndex meaning "pickup data was set directly".
        public const int DirectlySetPickupDataIndex = 2000;

        protected int m_hiddenPickupIndex;   // 0x60
        protected int referenceCount;        // 0x64 — outstanding breakdowns (0 = healthy)

        // ---- constants (CONFIRMED from ELF .rodata) --------------------------

        private const float CollisionRadius = 0.15f;              // DAT_00b7c46c
        private const float CollisionHeight = 2.0f;               // DAT_00b7c470
        private const float ViewerMatchThreshold = 1.0f;          // DAT_00b7c474

        // ---- properties ------------------------------------------------------

        // get/set_hiddenPickupIndex @0x4C2E60 / @0x4C2E70
        public int hiddenPickupIndex
        {
            get { return m_hiddenPickupIndex; }
            set { m_hiddenPickupIndex = value; }
        }

        // ---- lifecycle -------------------------------------------------------

        // .ctor @0x4D1640
        public GameCoreTree(Vector3 a_pos)
        {
            m_hiddenPickupIndex = -1;      // 0xffffffff before base ctor (field init)
            // (base GameCoreObject() registers the object + assigns the handle)
            position = a_pos;              // landed position setter re-buckets the grid
            collision = new Cylinder(CollisionRadius, CollisionHeight);
        }

        // Tick @0x4D1720 (virtual slot 7) — empty in the binary.
        public override void Tick()
        {
        }

        // RecreateViewer @0x4D1730 (virtual slot 5)
        // Re-links the matching scene tree after a load/resync: prefers the
        // mapped viewer, otherwise scans Q4.NatureTree.allTreesInScene for the
        // first tree within ViewerMatchThreshold of the sim position. Then
        // syncs the GameObject's active flag to the breakdown state
        // (referenceCount == 0 → active) and returns the viewer GameObject.
        public override GameObject RecreateViewer()
        {
            Q4.Structure viewer = GetUnityObject<Q4.Structure>();

            int i = 0;
            while (viewer == null)
            {
                List<Q4.NatureTree> trees = Q4.NatureTree.allTreesInScene;
                if (trees == null || trees.Count <= i)
                    break;
                Q4.NatureTree candidate = trees[i];
                Vector3 delta = candidate.transform.position - position;
                if (delta.magnitude > ViewerMatchThreshold)
                    candidate = null;                  // too far — reject
                else
                {
                    viewer = candidate;
                    break;
                }
                i++;
            }

            if (viewer != null)
            {
                bool shouldBeActive = (referenceCount == 0);   // IsTreeValid
                if (viewer.gameObject.activeSelf != shouldBeActive)
                    viewer.gameObject.SetActive(shouldBeActive);
                return viewer.gameObject;
            }
            return null;   // binary: falls into the exception path; kept non-throwing
        }

        // ---- breakdown / revive ----------------------------------------------

        // IsTreeValid @0x4D1960 — healthy while no breakdown is outstanding.
        public bool IsTreeValid()
        {
            return referenceCount == 0;
        }

        // Breakdown @0x4D1970
        // A fruit was taken: notify the view (structureBreakEvent) and deepen
        // the breakdown count. Payload type per Events.cs is CoreEvent<GameCoreObject>.
        public void Breakdown()
        {
            Events.structureBreakEvent.Invoke(this);   // Events statics +0xB8
            referenceCount++;
        }

        // Revive @0x4D1A00
        // A fruit regrew / was returned: shallow the breakdown count; when the
        // tree becomes healthy again notify the view (treeReviveEvent).
        public void Revive(GameCorePlayer player, int reviveIndex)
        {
            referenceCount--;
            if (referenceCount != 0)
                return;
            Events.treeReviveEvent.Invoke(this, player, reviveIndex);   // Events statics +0xD8
        }
    }
}
