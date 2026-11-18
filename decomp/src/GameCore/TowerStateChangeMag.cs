// GameCore/TowerStateChangeMag.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Missile-tower magazine reload state (entered by GameCoreTower.RechargeBullet
// between waves). On Enter the ammo is refilled to m_newMag immediately and the
// Q4.TowerAnimatorMissile view is asked how long the reload animation takes —
// that view-reported duration (NOT the ctor duration) drives the countdown.
// When it expires the tower returns to TowerStateIdle(shootOnSight: false).
// Logic from Ghidra decompilation (RVA 0x4CE250, 0x4E2310..0x4E25E0).
// Float constant CONFIRMED from ELF .rodata: DAT_00b7c4c8 = 10000.0 (the idle
// state's own default duration).

namespace GameCore
{
    public class TowerStateChangeMag : TowerState // TypeDefIndex: 3076
    {
        private float m_changingMagDuration;   // 0x20 — set from the view animator on Enter
        private int m_currentMag;              // 0x24 — ammo before the reload
        private int m_newMag;                  // 0x28 — ammo after the reload

        // .ctor @0x4CE250
        public TowerStateChangeMag(float aDuration, int currentMag, int newMag)
            : base(aDuration)
        {
            m_currentMag = currentMag;
            m_newMag = newMag;
        }

        // Tick @0x4E2310 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            m_changingMagDuration -= dt;
            if (m_changingMagDuration <= 0f)
            {
                // Reload finished: back to idle. Faithful to the binary:
                // shootOnSight = false for the post-reload idle state.
                owner.SetCurrentCommand(new TowerStateIdle(false), null);
            }
            return true;
        }

        // Enter @0x4E2400 (virtual slot 4)
        public override void Enter(TowerStateMachine owner)
        {
            base.Enter(owner);   // TowerState.Enter → towerChangeStateEvent

            GameCoreTower tower = GetTower(owner);
            Q4.TowerAnimatorMissile animator = null;
            if (tower != null)
            {
                tower.magazineCapacity = m_newMag;   // ammo refilled at state start (field @0x9C)
                // Generic label in the decompiler says Structure; the confirmed
                // instantiation for this call site is TowerAnimatorMissile.
                animator = tower.GetUnityObject<Q4.TowerAnimatorMissile>();
            }

            float duration = 0f;
            if (animator != null)
                duration = animator.ChangeMagDuration();   // @0x473A90-ish view query
            m_changingMagDuration = duration;

            // HUD/ammo counter update: (tower handle, old mag, new mag).
            Events.missileTowerChangeMag.Invoke(tower.handle, m_currentMag, m_newMag);   // Events statics +0x1B8
        }

        // Exit @0x4E25A0 (virtual slot 6) — plain State<T>.Exit (no-op).
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);
        }
    }
}
