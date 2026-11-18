// GameCore/GameCorePickupCurrency.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.GameCorePickupCurrency methods @0x4BFE20..0x4C0BA0.
//
// A coin/gem pickup: bounces on the terrain until it comes to rest, then is
// magnetically sucked to the player that collected it (Pickup()). On arrival it
// fires pickupAcquiredEvent and credits the inventory (coins only — gems are
// handled by the Q4 view, see Pickup()).

using UnityEngine;

namespace GameCore
{
    public class GameCorePickupCurrency : GameCorePickup
    {
        private int m_value = 1;             // 0xA0 (pre-base initializer)
        private Vector3 m_attractOffset;     // 0xA4
        private float m_currentSpeed;        // 0xB0
        private bool m_atRest;               // 0xB4

        public int Value { get { return m_value; } }   // get_Value @0x4C00C0

        // .ctor @0x4BFE20
        public GameCorePickupCurrency(Q4.Pickup prefab, Vector3 position,
                                      GameCoreInventory.EInventoryType type, int value = -1,
                                      Q4.PickupMovement movement = null)
            : base(prefab, position, type, value, movement)
        {
            Q4.PickupCurrency prefabCurrency = prefab as Q4.PickupCurrency;
            if (prefabCurrency == null)
                return;

            if (value < 1)
                value = prefabCurrency.value;   // prefab +0x3C
            m_value = value;
            // Difficulty scaling: Max(1, amount * multiplayerRate * coinValueRate).
            // NOTE: applied to gems as well — faithful to the binary.
            m_value = Q4.GlobalSettingsContainer<Q4.DifficultySettings>.Instance
                        .ValueCoinByDifficulty(m_value);

            Q4.PickupCurrency viewer = handle.GetUnityObject<Q4.PickupCurrency>();
            if (movement == null && viewer != null)
                movement = viewer.GetComponent<Q4.PickupMovement>();
            if (movement != null)
                m_attractOffset = movement.attractOffset;   // movement +0x38
        }

        // DestroySelf @0x4C00D0 (virtual slot 6) — base behaviour only.
        public override void DestroySelf()
        {
            base.DestroySelf();
        }

        // Tick @0x4C00E0 (virtual slot 7)
        public override void Tick()
        {
            if (!m_active)
                return;
            CheckForWater();
            m_detectionDelay = Mathf.Max(0.0f, m_detectionDelay - GameCore.TickDeltaTime);
            TickLifeSpan();
            if (m_active && !IsDestroyed())
            {
                UpdatePosition();
            }
        }

        // UpdatePosition @0x4C0180
        // Ballistic bounce until at rest; once a player is attached, suck to them.
        private void UpdatePosition()
        {
            if (m_pickupPlayer == null)
            {
                if (!m_atRest)
                {
                    float dt = GameCore.TickDeltaTime;
                    m_currentVelocity += Physics.gravity * dt;

                    Vector3 dir = m_currentVelocity.normalized;
                    float speed = m_currentVelocity.magnitude;
                    Ray ray = new Ray(position, dir);
                    RaycastHit hit;
                    if (Physics.SphereCast(ray, collision.height * 0.475f, out hit,
                                           speed * dt, Q4.Layers.Instance.TerrainMask,
                                           QueryTriggerInteraction.Ignore))
                    {
                        // Stop at the surface, then reflect with bounce damping.
                        position -= dir * hit.distance;

                        float bounceRate = (m_bounceTime == -1.0f || m_bounceTime > 0.0f)
                            ? m_bouncingRate : 0.0f;
                        float factor = 1.0f - Vector3.Dot(hit.normal, dir);
                        m_currentVelocity = Vector3.Reflect(m_currentVelocity, hit.normal)
                                          * (factor * bounceRate);
                        if (m_bounceTime != -1.0f || m_bounceTime > 0.0f)
                            m_bounceTime += -1.0f;   // -1 = unlimited bounces

                        if (m_currentVelocity.magnitude < 0.5f)
                            m_atRest = true;
                    }

                    position += m_currentVelocity * dt;
                }
            }
            else
            {
                SuckToPlayer();
            }
        }

        // RecreateViewer @0x4C06F0 (virtual slot 5)
        public override GameObject RecreateViewer()
        {
            Q4.Pickup view = GetUnityObject<Q4.Pickup>();
            if (view == null)
                view = CreateViewerFromPrefabName<Q4.Pickup>(m_prefabName);
            return view.gameObject;
        }

        // SuckToPlayer @0x4C07A0
        // Accelerates toward player.position + m_attractOffset; on arrival,
        // fires the acquired event, credits inventory and destroys itself.
        // NOTE: the binary dereferences m_pickupPlayer without null guards
        // (NullReferenceException if unset or no longer resolvable).
        public void SuckToPlayer()
        {
            // Refresh to the current frame's version of the player.
            m_pickupPlayer = m_pickupPlayer.handle.GetMostRecentObjectVersion<GameCorePlayer>();

            float dt = GameCore.TickDeltaTime;
            Vector3 toTarget = (m_pickupPlayer.position + m_attractOffset) - position;
            m_currentVelocity = toTarget.normalized;
            m_currentSpeed += m_acceleration * dt;
            m_currentVelocity *= m_currentSpeed;

            Vector3 step = m_currentVelocity * dt;
            if (step.magnitude <= toTarget.magnitude)
            {
                position += step;
            }
            else
            {
                // Arrived: collect.
                Events.pickupAcquiredEvent.Invoke(m_pickupPlayer, this);
                if (m_inventoryType != GameCoreInventory.EInventoryType.Gem)
                {
                    // Gems are NOT credited here (the Q4.PickupCurrency view handles
                    // them in OnPickupAcquired) — faithful to the binary.
                    GameCoreInventory.GetInventoryObject()
                        .AddInventory(m_pickupPlayer.handle, m_inventoryType, m_value);
                }
                DestroySelf();
            }
        }

        // Pickup @0x4C0AC0 (virtual slot 9)
        // Called by GameCorePlayer.CheckForPickups when in detection range.
        public override void Pickup(GameCorePlayer player)
        {
            if (m_pickupPlayer == null && m_detectionDelay <= 0.0f)
            {
                m_pickupPlayer = player;
                m_currentVelocity = (player.position - position).normalized;
                remainingLifespan = -1.0f;   // immortal while being collected
            }
        }

        // OnStageCleared @0x4C0B80 (virtual slot 10) — confirmed no-op.
        public override void OnStageCleared(GameCoreWaveManager manager)
        {
        }

        // OnGameOver @0x4C0B90 (virtual slot 11)
        public override void OnGameOver()
        {
            m_active = false;
        }
    }
}
