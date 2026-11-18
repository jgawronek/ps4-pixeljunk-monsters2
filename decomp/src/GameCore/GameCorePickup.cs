// GameCore/GameCorePickup.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.GameCorePickup methods @0x4BEFB0..0x4BFD60 (Ghidra pseudocode
// cross-checked against raw disassembly for the ctor's physics setup).
//
// Base class for dropped pickups (coins/gems/hidden items). Simulates bounce
// physics, lifespan, water loss, and attraction to a collecting player.
// The Unity view (Q4.Pickup prefab) is instantiated at construction and linked
// through GameCoreBridge; simulation stats are copied from the prefab.

using UnityEngine;

namespace GameCore
{
    public abstract class GameCorePickup : GameCoreObject
    {
        protected string m_prefabName;                       // 0x60
        public float remainingLifespan;                      // 0x68
        protected float m_detectionRange = 0.5f;             // 0x6C (pre-base initializer)
        protected float m_detectionDelay = 0.5f;             // 0x70 (pre-base initializer)
        protected bool m_active = true;                      // 0x74 (pre-base initializer)
        protected float m_acceleration;                      // 0x78
        protected float m_bouncingRate;                      // 0x7C
        protected float m_bounceTime;                        // 0x80
        protected bool m_isInWater;                          // 0x84
        protected Vector3 m_currentVelocity;                 // 0x88
        protected GameCoreInventory.EInventoryType m_inventoryType; // 0x94
        protected GameCorePlayer m_pickupPlayer;             // 0x98

        public float detectionRange { get { return m_detectionRange; } }        // get_detectionRange @0x4BF7A0
        public GameCorePlayer pickupPlayer { get { return m_pickupPlayer; } }   // get_pickupPlayer @0x4BF7B0
        public bool isInWater { get { return m_isInWater; } }                   // get_isInWater @0x4BF7C0
        public GameCoreInventory.EInventoryType InventoryType                   // get_InventoryType @0x4BF7D0
        {
            get { return m_inventoryType; }
        }

        // .ctor @0x4BEFB0
        // 'value' is part of the signature but unused here (GameCorePickupCurrency
        // reads its own value from the prefab).
        public GameCorePickup(Q4.Pickup prefab, Vector3 position,
                              GameCoreInventory.EInventoryType type, int value = -1,
                              Q4.PickupMovement movement = null)
            : base()
        {
            if (prefab != null)
            {
                m_prefabName = prefab.name;
                Q4.Pickup viewer = Object.Instantiate(prefab);   // Instantiate<Pickup>
                Q4.GameCoreBridge.Instance.SetUnityObject(handle, viewer);
                this.position = position;

                if (movement == null)
                    movement = viewer.GetComponent<Q4.PickupMovement>();

                Q4.PickupLifeCycle lifeCycle = viewer.GetComponent<Q4.PickupLifeCycle>();
                remainingLifespan = lifeCycle != null ? lifeCycle.lifespan : -1.0f;

                if (movement != null)
                {
                    // Launch upward with a random force, tilted by a random angle
                    // around a random horizontal axis (scatter cone).
                    m_currentVelocity = Vector3.up *
                        RandomRange(movement.appearForceMin, movement.appearForceMax, handle);
                    Vector3 axis = new Vector3(
                        RandomRange(-1.0f, 1.0f, handle), 0.0f,
                        RandomRange(-1.0f, 1.0f, handle)).normalized;
                    m_currentVelocity = Quaternion.AngleAxis(movement.appearRangeAngle, axis)
                                      * m_currentVelocity;

                    m_acceleration = movement.acceleration;
                    m_bouncingRate = movement.bouncingRate;
                    m_bounceTime = movement.bounceTime;   // int → float
                }

                // NOTE: faithful to the binary — everything below (including the
                // inventory type and event subscriptions) only runs when the view
                // has a MeshFilter with a mesh.
                MeshFilter meshFilter = viewer.gameObject.GetComponentInChildren<MeshFilter>();
                if (meshFilter != null && meshFilter.sharedMesh != null)
                {
                    collision = new Cylinder(meshFilter.sharedMesh.bounds);

                    // Ground probe from above the spawn point.
                    Ray ray = new Ray(position + Vector3.up, Vector3.down);
                    RaycastHit hit;
                    if (Physics.Raycast(ray, out hit, 100.0f, Q4.Layers.Instance.TerrainMask))
                    {
                        // INFERRED: the binary computes hit.point + up*(height*0.475)
                        // but discards the result (no position store follows —
                        // confirmed in disassembly @0x4BF66A). Likely an unused
                        // local in the original source; kept as a dead computation
                        // note rather than silently "fixing" it.
                        // position = hit.point + Vector3.up * (collision.height * 0.475f);
                    }

                    m_inventoryType = type;
                    m_detectionDelay = prefab.detectDelay;    // prefab +0x1C
                    m_detectionRange = prefab.detectRange;    // prefab +0x18

                    Events.stageClearedEvent.AddListener(OnStageCleared, Event.EventTime.Immediate);
                    Events.gameOverEvent.AddListener(OnGameOver, Event.EventTime.Immediate);
                }
            }
        }

        // DestroySelf @0x4BF7E0 (virtual slot 6)
        // Binary shows the base logic (destroyed flag + grid removal) merged with
        // the extras under one null-guard; expressed here as base call + extras.
        public override void DestroySelf()
        {
            base.DestroySelf();
            if (m_isInWater)
            {
                Q4.MonstersAudio.Instance.PlaySFX(Q4.GlobalSounds.ItemDieInWater, position, true);
            }
            Events.stageClearedEvent.RemoveListener(OnStageCleared);
            Events.gameOverEvent.RemoveListener(OnGameOver);
        }

        // Tick @0x4BF990 (virtual slot 7)
        public override void Tick()
        {
            if (!m_active)
                return;
            CheckForWater();
            m_detectionDelay = Mathf.Max(0.0f, m_detectionDelay - GameCore.TickDeltaTime);
            TickLifeSpan();
        }

        // CheckForWater @0x4BFA20
        // protected: called directly by GameCorePickupCurrency.Tick (confirmed).
        protected void CheckForWater()
        {
            if (m_currentVelocity.y < 0.0f)
            {
                bool inWater = Physics.CheckSphere(position, collision.height * 0.475f,
                                                   Q4.Layers.Instance.WaterMask,
                                                   QueryTriggerInteraction.Ignore);
                if (inWater && !m_isInWater)
                {
                    m_isInWater = true;
                    remainingLifespan = Mathf.Min(remainingLifespan, Q4.AISettings.PickupWaterKillTime);
                    Q4.MonstersAudio.Instance.PlaySFX(Q4.GlobalSounds.ItemLostInWater, position, true);
                }
                m_isInWater = inWater;
            }
        }

        // TickLifeSpan @0x4BFBE0
        // protected: called directly by GameCorePickupCurrency.Tick (confirmed).
        // FAITHFUL QUIRK (verified vs raw disassembly): below the world the
        // FIELD is reset to 0.1 every tick, but the countdown subtracts from
        // the fresh LOCAL 0.1 — at normal dt this never reaches 0; only a
        // frame with TickDeltaTime >= 0.1 expires the pickup.
        protected void TickLifeSpan()
        {
            // Below the world (y < -20) → force a quick 0.1s expiry.
            float lifespan = 0.1f;
            if (position.y >= -20.0f)
            {
                lifespan = remainingLifespan;
                if (lifespan < 0.0f)
                    return;   // negative lifespan = immortal
            }
            else
            {
                remainingLifespan = 0.1f;
            }

            lifespan = Mathf.Max(lifespan - GameCore.TickDeltaTime, 0.0f);
            remainingLifespan = lifespan;
            if (lifespan == 0.0f)
            {
                Events.pickupLostEvent.Invoke(this);
                DestroySelf();
            }
        }

        // ToString @0x4BFD60 (virtual slot 3)
        public override string ToString()
        {
            return base.ToString() + m_inventoryType.ToString();
        }

        // Abstract (slots 9/10/11) — implemented by GameCorePickupCurrency.
        public abstract void Pickup(GameCorePlayer player);
        public abstract void OnStageCleared(GameCoreWaveManager manager);
        public abstract void OnGameOver();
    }
}
