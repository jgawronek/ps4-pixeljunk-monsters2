// GameCore/GameCoreProjectileGem.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The gem-tower "deploy" projectile. It carries no damage payload of its own:
// on its (single) Tick it converts the source tower into the
// TowerStateUpgradeAround EXP-aura state — using the numbers copied from the
// Q4.ProjectileGem view prefab at construction — and destroys itself. The gem
// view instance is spawned and bridge-mapped in the ctor.
// Logic from Ghidra decompilation (RVA 0x4C7720..0x4C7A50).
// Float constant CONFIRMED from ELF .rodata: DAT_00b7c424 = 10000.0 (aura state
// duration — transitions are driven by the aura's own upgrade timer).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileGem : GameCoreProjectile // TypeDefIndex: 3058
    {
        private float m_expBoostPerSecond;    // 0xB0 (= Q4.ProjectileGem.expBoostPerSecond @0x50)
        private int m_destroyDropGem;         // 0xB4 (= Q4.ProjectileGem.destroyDropGem @0x54)
        private float m_maxLifeDuration;      // 0xB8 (= Q4.Projectile.maxLifeDuration @0x18)
        private float m_sinkTimePerFragment;  // 0xBC (= Q4.ProjectileGem.towerSinkTimePerFragment @0x48)
        private float m_upgradeInterval;      // 0xC0 (= Q4.ProjectileGem.upgradeInterval @0x4C)
        private float m_gemDropDelay;         // 0xC4 (= Q4.ProjectileGem.gemDropDelay @0x58)

        // Aura state duration literal DAT_00b7c424 = 10000.0f.
        private const float UpgradeAroundStateDuration = 10000.0f;

        // .ctor @0x4C7720
        public GameCoreProjectileGem(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage = true)
            : base(tower, enemies, dealsDamage)
        {
            // Source tower's view prefab (TowerBase.projectile @0xC0). The
            // decompiler's Instantiate<SystemIndicatorCanvas> label is a
            // shared-generic artifact — the IsInst check confirms
            // Q4.ProjectileGem.
            Q4.TowerBase towerBase = sourceTower.GetUnityObject<Q4.TowerBase>();
            if (towerBase == null || towerBase.projectile == null)
                return;   // binary: falls through silently when the view is gone

            Q4.ProjectileGem gemView = Object.Instantiate<Q4.ProjectileGem>(
                (Q4.ProjectileGem)towerBase.projectile);
            if (gemView == null)
                return;

            Q4.GameCoreBridge.Instance.SetUnityObject(handle, gemView);

            // Snapshot the aura tuning from the spawned view prefab.
            m_expBoostPerSecond = gemView.expBoostPerSecond;
            m_destroyDropGem = gemView.destroyDropGem;
            m_maxLifeDuration = gemView.maxLifeDuration;
            m_sinkTimePerFragment = gemView.towerSinkTimePerFragment;
            m_upgradeInterval = gemView.upgradeInterval;
            m_gemDropDelay = gemView.gemDropDelay;
        }

        // Tick @0x4C7910 (virtual slot 7)
        // Hand the aura state to the source tower, then destroy this projectile
        // (vtable entry 23 = slot 6 = DestroySelf).
        public override void Tick()
        {
            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();

            TowerStateUpgradeAround auraState = new TowerStateUpgradeAround(
                UpgradeAroundStateDuration,
                m_expBoostPerSecond,
                m_destroyDropGem,
                m_upgradeInterval,
                m_sinkTimePerFragment,
                m_maxLifeDuration,     // → m_upgradeDuration (+Max) in the state
                m_gemDropDelay);

            tower.SetTowerState(auraState);   // vtable entry 26 = slot 9; binary NREs if tower gone
            DestroySelf();
        }
    }
}
