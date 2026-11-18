// GameCore/TowerStateUpgradeAround.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The gem tower's "upgrade aura" state: for m_upgradeDuration seconds it grants
// EXP to every OTHER tower inside its affect cylinder every m_upgradeInterval
// seconds, reports its sink progress to the view (gemTowerSinkEvent), pops its
// gem after m_gemCreationDelayTime, and when the duration runs out announces
// destruction and hands over to TowerStateBroken.
// Logic from Ghidra decompilation (RVA 0x4C7A50, 0x4E3910..0x4E41D0).
// Float constants CONFIRMED from ELF .rodata: DAT_00b7c4d4 = 1.0,
// DAT_00b7c4d8 = -1.0 (already-dropped gem-delay sentinel), DAT_00b7c4dc = 10000.0.

using UnityEngine;

namespace GameCore
{
    public class TowerStateUpgradeAround : TowerState // TypeDefIndex: 3080
    {
        private float m_expBoostPerSecond;      // 0x20
        private int m_destroyDropGem;           // 0x24
        private float m_upgradeDurationMax;     // 0x28
        private float m_upgradeDuration;        // 0x2C
        private float m_upgradeInterval;        // 0x30
        private float m_upgradeTick;            // 0x34
        private float m_sinkTimePerFrag;        // 0x38
        private float m_gemCreationDelayTime;   // 0x3C
        private IEnemyDetector m_enemyDetector; // 0x40
        private bool m_isGemDropped;            // 0x48

        private const float BrokenStateDuration = 10000.0f;   // DAT_00b7c4dc
        private const float GemAlreadyDropped = -1.0f;        // DAT_00b7c4d8

        // .ctor @0x4C7A50
        // Register mapping verified: floats aDuration/expBoost/upgradeInterval/
        // sinkTimePerFrag/upgradeDuration/gemDropDelay in XMM0..XMM5, int
        // destroyDropGem in the general register; m_upgradeDurationMax is
        // initialized to the same value as m_upgradeDuration.
        public TowerStateUpgradeAround(float aDuration, float expBoostPerSecond,
                                       int destroyDropGem, float upgradeInterval,
                                       float sinkTimePerFrag, float upgradeDuration,
                                       float gemDropDelay)
            : base(aDuration)
        {
            m_expBoostPerSecond = expBoostPerSecond;
            m_destroyDropGem = destroyDropGem;
            m_upgradeDuration = upgradeDuration;
            m_upgradeDurationMax = upgradeDuration;
            m_upgradeInterval = upgradeInterval;
            m_sinkTimePerFrag = sinkTimePerFrag;
            m_gemCreationDelayTime = gemDropDelay;
        }

        // Enter @0x4E3910 (virtual slot 4)
        public override void Enter(TowerStateMachine owner)
        {
            base.Enter(owner);   // TowerState.Enter → towerChangeStateEvent
            GameCoreTower tower = GetTower(owner);
            m_enemyDetector = tower.enemyDetector;   // tower field @0x108
        }

        // Tick @0x4E3980 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            GameCoreTower tower = GetTower(owner);
            TickUpgradeDuration(dt, tower);
            return true;
        }

        // TickUpgradeDuration @0x4E3A00
        private void TickUpgradeDuration(float dt, GameCoreTower tower)
        {
            m_upgradeDuration -= dt;
            m_gemCreationDelayTime -= dt;
            m_upgradeTick -= dt;

            // Pop the gem once, after the authored delay.
            if (m_gemCreationDelayTime <= 0f && !m_isGemDropped)
            {
                Events.onGemTowerPopGem.Invoke(tower, m_destroyDropGem);   // Events statics +0x178
                m_isGemDropped = true;
            }

            // Every m_upgradeInterval seconds: boost nearby towers and report
            // sink progress (both edge ratios of the interval window).
            if (m_upgradeTick <= 0f && m_upgradeDuration >= 0f)
            {
                // CORRECTED vs raw @0x4E3CC1 (goto loop): CATCH-UP while loop,
                // and the sink event's 4th payload is m_sinkTimePerFrag
                // (Ghidra scrambled the Invoke arg order; field 0x38 consumed here).
                while (m_upgradeTick <= 0f && m_upgradeDuration >= 0f)
                {
                    TickTowersInRangeForEXP(m_upgradeInterval * m_expBoostPerSecond, tower);
                    Events.gemTowerSinkEvent.Invoke(                                        // Events statics +0x1B0
                        tower.handle,
                        1.0f - m_upgradeDuration / m_upgradeDurationMax,
                        1.0f - (m_upgradeDuration - m_upgradeInterval) / m_upgradeDurationMax,
                        m_sinkTimePerFrag);
                    m_upgradeTick += m_upgradeInterval;
                }
            }

            // Aura exhausted: announce destruction and go to the Broken state.
            if (m_upgradeDuration <= 0f)
            {
                float gemDelay = m_isGemDropped ? GemAlreadyDropped : m_gemCreationDelayTime;
                Events.onGemTowerDestroy.Invoke(tower);   // Events statics +0x180
                // Vtable entry 26 = slot 9 = GameCoreTower.SetTowerState.
                tower.SetTowerState(
                    new TowerStateBroken(BrokenStateDuration, gemDelay, m_destroyDropGem));
            }
        }

        // TickTowersInRangeForEXP @0x4E3D20
        // Grants `expAmount` (= interval × boost-per-second) to every other
        // tower whose position falls inside this tower's detector attack volume.
        private void TickTowersInRangeForEXP(float expAmount, GameCoreTower coreTower)
        {
            IEnemyDetector detector = m_enemyDetector;
            Cylinder affectVolume = detector.GetAffectCylinder();          // interface slot 7
            Vector3 detectorPos = coreTower.position + detector.GetOffset(); // slot 0

            foreach (GameCoreTower other in
                     GameCore.Instance.AllObjects<GameCoreTower>(coreTower.position, affectVolume))
            {
                if (detector.InAttack(detectorPos, other))                 // slot 4
                {
                    other.GrantEXP(expAmount, null);
                }
            }
        }

        // Exit @0x4E3CD0 (virtual slot 6) — plain State<T>.Exit (no-op).
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);
        }
    }
}
