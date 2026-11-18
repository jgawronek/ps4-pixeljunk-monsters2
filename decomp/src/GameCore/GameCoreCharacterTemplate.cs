// GameCore/GameCoreCharacterTemplate.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// A bare sim-side anchor that instantiates a character-prefab viewer at a given
// QuatPos and maps it into the bridge (used for template/scripted characters —
// it has no sim behavior: Tick is empty in the binary).
// Logic from Ghidra decompilation (RVA 0x4AB650..0x4ABAE0).
// QuatPos (global namespace, TypeDefIndex 3780): { Vector3 Position; Quaternion
// Rotation; } with get_Position @0x90FEE0 / get_Rotation @0x90FF10 (the two
// unnamed FUN_ bodies in the ctor).

using UnityEngine;

namespace GameCore
{
    public class GameCoreCharacterTemplate : GameCoreObject // TypeDefIndex: 3033
    {
        // .ctor @0x4AB650
        // The decompiler labels the Instantiate<T> as LightningBoltScript — a
        // shared-generic artifact; the confirmed instantiation is GameObject.
        public GameCoreCharacterTemplate(QuatPos a_location, GameObject a_prefab)
        {
            // (base GameCoreObject() registers the object + assigns the handle)
            position = a_location.Position;   // setter re-buckets the collision grid

            GameObject instance = Object.Instantiate(
                a_prefab, position, a_location.Rotation);

            Q4.GameCoreBridge.Instance.SetUnityObject(handle, instance);
        }

        // Tick @0x4ABA90 (virtual slot 7) — empty in the binary.
        public override void Tick()
        {
        }
    }
}
