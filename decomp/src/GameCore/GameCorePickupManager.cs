// GameCore/GameCorePickupManager.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.GameCorePickupManager methods @0x4C0BA0..0x4C1280 (ctor verified
// against GameCore.GameCoreObject.c — the base ctor does all the work).
//
// Sim-side manager for timed hidden-fruit drops from fruit trees. The scene's
// Q4.PickupManager view holds the drop schedule (hiddenFruitData) and the tree
// handle list; this core object walks the schedule and asks the view to spawn
// the actual fruit. Currency drops from enemy deaths etc. are coordinated by
// the Q4 view (out of sim scope).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCorePickupManager : GameCoreObject
    {
        private float fruitElapsedTime;                  // 0x60
        private List<GameCoreHandle> fruitTreeHandleList; // 0x68
        private int fruitCurIndex;                       // 0x70

        // .ctor @0x4C0BA0
        // The viewer parameter is not stored: the base GameCoreObject ctor creates
        // the handle/collision and registers with the current frame; the view is
        // linked via GameCoreBridge by the scene bootstrap and looked up dynamically.
        public GameCorePickupManager(Q4.PickupManager a_pickupManager)
            : base()
        {
        }

        // RecreateViewer @0x4C0BB0 (virtual slot 5)
        public override GameObject RecreateViewer()
        {
            Q4.PickupManager view = GetUnityObject<Q4.PickupManager>();
            if (view == null)
                view = Object.FindObjectOfType<Q4.PickupManager>();
            if (view == null)
                return null;
            return view.gameObject;
        }

        // Tick @0x4C0CA0 (virtual slot 7)
        public override void Tick()
        {
            UpdateFruitDrops();
        }

        // UpdateFruitDrops @0x4C0CB0
        // While fewer than maximumFruitsOnGround fruits exist, advance the drop
        // timer; when the next scheduled drop time is reached, pick a random
        // remaining fruit tree and spawn its hidden fruit there.
        private void UpdateFruitDrops()
        {
            Q4.PickupManager view = GetUnityObject<Q4.PickupManager>();
            if (view == null)
                return;

            if (fruitTreeHandleList == null)
                fruitTreeHandleList = new List<GameCoreHandle>(view.fruitTreeHandleList);

            Q4.PickupManager.HiddenFruitData[] dropData = view.hiddenFruitData;   // view +0x30

            int fruitCount = 0;
            foreach (GameCoreFruit fruit in GameCore.Instance.AllObjects<GameCoreFruit>())
                fruitCount++;

            if (fruitCount < view.maximumFruitsOnGround)   // view +0x2C
            {
                fruitElapsedTime += GameCore.TickDeltaTime;

                // Binary throws NullReferenceException if dropData is null here
                // (unconditional array access in the original source).
                if (fruitCurIndex >= dropData.Length)
                    return;
                Q4.PickupManager.HiddenFruitData data = dropData[fruitCurIndex];
                if (fruitElapsedTime < data.time)   // data +0x1C (int seconds)
                    return;

                fruitElapsedTime -= data.time;
                fruitCurIndex++;

                // Pick a random tree still in the list; skip stale handles.
                GameCoreTree tree;
                GameCoreHandle treeHandle;
                do
                {
                    if (fruitTreeHandleList.Count < 1)
                        return;
                    int index = RandomRange(0, fruitTreeHandleList.Count, handle);
                    treeHandle = fruitTreeHandleList[index];
                    fruitTreeHandleList.RemoveAt(index);
                    tree = treeHandle.GetMostRecentObjectVersion<GameCoreTree>();
                } while (tree == null);

                Q4.NatureTree treeView = Q4.GameCoreBridge.Instance.GetUnityObject<Q4.NatureTree>(treeHandle);
                Q4.PickupMovement movement = treeView.GetComponent<Q4.PickupMovement>();
                // Binary dereferences stage/pickupManager unconditionally (NRE if null).
                Q4.StageHub.GetCurrentStage().pickupManager.CreateFruit(data, tree.position, movement);
            }
            else
            {
                fruitElapsedTime = 0.0f;
            }
        }
    }
}
