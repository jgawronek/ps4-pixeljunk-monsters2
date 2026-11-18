// GameCore/BuffTrampoline.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffTrampoline methods @0x93F140..0x93F210.
//
// Like BuffFlare, the trampoline buff is a timed marker in the simulation:
// ExecuteBuff is empty and the constructor ignores its setting. The launch
// effect is driven by the Q4 layer (CommandTrampoline / BuffSettingTrampoline);
// the sim only tracks the duration.

namespace GameCore
{
    public class BuffTrampoline : Buff
    {
        // .ctor @0x93F140 — 'setting' is not read by the binary.
        public BuffTrampoline(float duration, Q4.BuffSettingTrampoline setting)
            : base(duration)
        {
        }

        // ExecuteBuff @0x93F1F0 (virtual slot 10) — no-op (confirmed empty body).
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
        }

        // OnExitBuff @0x93F200 (virtual slot 11) — base behaviour only.
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);
        }
    }
}
