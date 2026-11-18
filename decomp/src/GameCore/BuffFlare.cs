// GameCore/BuffFlare.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffFlare methods @0x93E350..0x93E420.
//
// Flare is a pure timed marker in the simulation: ExecuteBuff is empty and the
// constructor ignores its setting. The actual flare behaviour (aggro/attention
// redirect + presentation) lives in Q4.BuffSettingFlare.OnFlareTriggered and the
// flareEvent hub; the sim only tracks the duration.

namespace GameCore
{
    public class BuffFlare : Buff
    {
        // .ctor @0x93E350 — 'setting' is not read by the binary.
        public BuffFlare(Q4.BuffSettingFlare setting, float duration)
            : base(duration)
        {
        }

        // ExecuteBuff @0x93E400 (virtual slot 10) — no-op (confirmed empty body).
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
        }

        // OnExitBuff @0x93E410 (virtual slot 11) — base behaviour only.
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);
        }
    }
}
