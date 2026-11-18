// GameCore/GameCoreFruit.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Simulation-side throwable "fruit" item (bomb/trampoline/flare consumables).
// A fruit bounces to rest under its own mini physics loop, detects nearby
// enemies / players / interaction objects, and applies the Q4.BuffSetting
// components carried by its viewer prefab when triggered. Players can grab it
// (IGrabbable), carry it and drop/throw it.
// Logic from Ghidra decompilation of GameCore.GameCoreFruit methods
// (RVA 0x4B5AD0..0x4B99F0). Field offsets from global-metadata.dat
// (TypeDefIndex 3048).
//
// NOTE on RODATA float constants: ALL literals below were CONFIRMED by direct
// float reads from Il2CppUserAssemblies.elf (file offset = vaddr + 0x4000) in
// iter 19 — sanity-checked against known constants (DAT_00b7c46c = 0.15,
// DAT_00b7c3dc = 0.1). Several previously-INFERRED values were WRONG and are
// corrected here (GroundSnapRayDistance 100 not 1000, KillBelowWorldY -20 not
// -1000, SeparationVelocityDamping -0.75, the "Zero" slots are 0.1/0.0/1.0
// per use-site mapping from the raw decompilation lines 842/866/1077/1259).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreFruit : GameCoreObject, IGrabbable // TypeDefIndex: 3048
    {
        private bool m_active;                                  // 0x60
        private bool m_atRest;                                  // 0x61
        private string m_prefabName;                            // 0x68
        public float remainingLifespan;                         // 0x70
        private float m_enemyDetectionRange;                    // 0x74
        private float m_playerDetectionRange;                   // 0x78
        private float m_playerJumpDetectionRange;               // 0x7C
        private float m_playerDetectionRangeMax;                // 0x80
        private float m_detectionDelay;                         // 0x84
        private float m_acceleration;                           // 0x88
        private float m_bouncingRate;                           // 0x8C
        private float m_bounceTime;                             // 0x90
        private Vector3 m_currentVelocity;                      // 0x94
        private int m_usageRemain;                              // 0xA0
        private float m_cooldownTime;                           // 0xA4
        private float m_currentCooldownTime;                    // 0xA8
        private bool m_destroyWhenUsedUp;                       // 0xAC
        private string m_textKey;                               // 0xB0
        protected bool m_isInWater;                             // 0xB8
        protected bool isNonInteractable;                       // 0xB9
        private GameCoreHandle m_playerOwner;                   // 0xC0 (32-byte struct)
        private GameCoreHandle m_lastPlayerOwner;               // 0xE0 (32-byte struct)
        private List<GameCorePlayer> m_alreadyPlayingRumblePlayer; // 0x100

        // ---- RODATA float constants (ALL CONFIRMED by ELF float read, iter 19) ----

        // Default detection ranges written before the Q4.Fruit prefab copy.
        private const float DefaultEnemyDetectionRange = 1.0f;      // DAT_00b7c540 CONFIRMED
        private const float DefaultPlayerJumpDetectionRange = 0.5f; // DAT_00b7c548 CONFIRMED

        // Confirmed literal 0x3f000000 in ctor @0x4B5AD0.
        private const float DefaultDetectionDelay = 0.5f;

        // Random unit-axis components for the appear velocity; the Min value
        // doubles as the missing-lifespan-component fallback (-1 = immortal).
        private const float RandomAxisComponentMin = -1.0f;         // DAT_00b7c2f0 CONFIRMED
        private const float RandomAxisComponentMax = 1.0f;          // DAT_00b7c2f4 CONFIRMED

        // Ground-snap raycast length and radius factor after mesh-bounds setup.
        private const float GroundSnapRayDistance = 100.0f;         // DAT_00b7c2f8 CONFIRMED
        private const float GroundSnapRadiusFactor = 0.475f;        // DAT_00b7c2fc CONFIRMED

        // Water-check constants (CheckSphere radius factor, downward ray length).
        private const float WaterCheckSphereRadiusFactor = 0.475f;  // DAT_00b7c304 CONFIRMED
        private const float WaterRaycastDistance = 2.0f;            // DAT_00b7c308 CONFIRMED

        // World-Y kill plane: below it remainingLifespan is forced to 0.1f.
        private const float KillBelowWorldY = -20.0f;               // DAT_00b7c30c CONFIRMED
        private const float BelowWorldLifespan = 0.1f;              // DAT_00b7c310 CONFIRMED (raw line 842)

        // Lifespan expiry comparison value (raw line 866).
        private const float ExpiredLifespan = 0.0f;                 // DAT_00b7c314 CONFIRMED

        // Separation vertical-velocity CAP (raw line 1077: Min(vy*damping, 1.0))
        // and bounce alignment base (raw line 1259: 1.0 - Dot(normal, dir)).
        private const float SeparationVelocityCap = 1.0f;           // DAT_00b7c320 CONFIRMED
        private const float BounceAlignmentBase = 1.0f;             // DAT_00b7c320 reused

        // Height offset above the owning player while held.
        private const float HeldHeightOffset = 0.5f;                // DAT_00b7c318 CONFIRMED

        // Falling-velocity damping during fruit/fruit separation (NEGATIVE —
        // flips descent into a capped ascent) and the separation jitter impulse.
        private const float SeparationVelocityDamping = -0.75f;     // DAT_00b7c31c CONFIRMED
        private const float SeparationJitterMin = -0.1f;            // DAT_00b7c324 CONFIRMED
        private const float SeparationJitterMax = 0.1f;             // DAT_00b7c328 CONFIRMED

        // Spherecast radius factor for the movement sweep.
        private const float MovementSphereRadiusFactor = 0.475f;    // DAT_00b7c32c CONFIRMED

        // Bounce counter sentinel: -1 = bounce forever.
        private const float BounceTimeDecrement = -1.0f;            // DAT_00b7c330 CONFIRMED

        // Rest-detection probe constants.
        private const float RestProbeHeight = 2.0f;                 // DAT_00b7c334 CONFIRMED
        private const float RestProbeRadiusFactor = 0.475f;         // DAT_00b7c32c reused
        private const float RestProbeDistancePadding = 2.1f;        // DAT_00b7c338 CONFIRMED
        private const float RestSpeedThreshold = 0.25f;             // DAT_00b7c33c CONFIRMED

        // Enemy broad-phase query cylinder (range + margin, height).
        private const float QueryRadiusMargin = 0.1f;               // DAT_00b7c340 CONFIRMED
        private const float QueryHeight = 4.0f;                     // DAT_00b7c344 CONFIRMED

        // Interaction-object query: probe offset below the fruit + cylinder size.
        private const float InteractionQueryDownOffset = 0.25f;     // DAT_00b7c348 CONFIRMED
        private const float InteractionQueryRadius = 0.5f;          // DAT_00b7c34c CONFIRMED

        // deltaY (fruit.y - player.y) threshold for the PlayerJump trigger case.
        private const float JumpTriggerDeltaY = -0.11f;             // DAT_00b7c350 CONFIRMED

        // Factor on this fruit's collision radius for the plain-player vertical test.
        private const float PlayerTriggerHeightFactor = 0.5f;       // DAT_00b7c354 CONFIRMED

        // OnDrop constants.
        private const float GentleDropForceThreshold = 0.001f;      // DAT_00b7c358 CONFIRMED
        private const float GentleDropRayDistance = 100.0f;         // DAT_00b7c35c CONFIRMED
        private const float GentleDropRadiusFactor = 0.475f;        // DAT_00b7c360 CONFIRMED
        private const float ThrowDropSphereRadiusFactor = 0.5f;     // DAT_00b7c364 CONFIRMED
        private const float ThrowDropProbeHeight = 1.0f;            // DAT_00b7c368 CONFIRMED
        private const float ThrowDropProbeMaxDistance = 1.05f;      // DAT_00b7c36c CONFIRMED
        private const float ThrowDropLandingClearance = -0.05f;     // DAT_00b7c370 CONFIRMED (NEGATIVE)

        // .ctor @0x4B5AD0
        // prefab      : the Q4.Fruit viewer prefab (or the already-placed scene
        //               component when isPrefab == false).
        // isPrefab    : true -> Object.Instantiate a fresh viewer; false -> adopt
        //               the passed component as the viewer.
        // position    : spawn position (snapped onto terrain when the viewer has
        //               a MeshFilter).
        // movement    : optional PickupMovement; fetched from the viewer when null.
        public GameCoreFruit(Q4.Fruit prefab, bool isPrefab, Vector3 position, Q4.PickupMovement movement)
        {
            // Field initializers confirmed in the prologue of the decompiled ctor
            // (they run before the base ctor in the shipped code).
            m_enemyDetectionRange = DefaultEnemyDetectionRange;
            m_playerJumpDetectionRange = DefaultPlayerJumpDetectionRange;
            m_detectionDelay = DefaultDetectionDelay;
            m_currentVelocity = Vector3.zero;
            m_playerOwner = GameCoreHandle.nullHandle;
            m_lastPlayerOwner = GameCoreHandle.nullHandle;
            m_alreadyPlayingRumblePlayer = new List<GameCorePlayer>();

            // base GameCoreObject() registers the object + allocates the handle.

            Q4.Fruit viewer;
            if (isPrefab)
            {
                viewer = Object.Instantiate(prefab);
                m_prefabName = prefab.name;
            }
            else
            {
                viewer = prefab;
                m_prefabName = null;
            }

            isNonInteractable = viewer.IsNonInteractable;
            Q4.GameCoreBridge.Instance.SetUnityObject(handle, viewer);
            this.position = position;   // setter re-buckets in the collision grid

            if (movement == null)
                movement = viewer.GetComponent<Q4.PickupMovement>();

            // INFERRED: a second GetComponent<PickupMovement> result supplies the
            // initial lifespan (its 0x18 field == PickupMovement.acceleration, so
            // the shipped component type may differ from the metadata name —
            // likely a Fruit-specific movement/lifetime component). Falls back to
            // DAT_00b7c2f0 when the component is missing.
            Q4.PickupMovement lifeSource = viewer.GetComponent<Q4.PickupMovement>();
            remainingLifespan = lifeSource != null ? lifeSource.acceleration : RandomAxisComponentMin; // TODO: confirm component type + default

            if (isPrefab)
            {
                // Appear pop: straight up with a random force in
                // [appearForceMin, appearForceMax], rotated by a random
                // AngleAxis within appearRangeAngle around a random unit axis.
                m_currentVelocity = Vector3.up *
                    RandomRange(movement.appearForceMin, movement.appearForceMax, handle);
                float angle = movement.appearRangeAngle;
                float axisX = RandomRange(RandomAxisComponentMin, RandomAxisComponentMax, handle);
                float axisZ = RandomRange(RandomAxisComponentMin, RandomAxisComponentMax, handle);
                Vector3 axis = new Vector3(axisX, 0.0f, axisZ); // INFERRED y component (0 in decompilation)
                m_currentVelocity = Quaternion.AngleAxis(angle, axis.normalized) * m_currentVelocity;
            }

            if (movement != null)
            {
                m_acceleration = movement.acceleration;
                m_bouncingRate = movement.bouncingRate;
                m_bounceTime = (float)movement.bounceTime;
            }

            MeshFilter meshFilter = viewer.gameObject.GetComponentInChildren<MeshFilter>();
            if (meshFilter == null)
            {
                // No render mesh: derive the collision cylinder directly from the
                // prefab's ground scale (radius = scale, height = 2*scale).
                float s = viewer.scaleGround;
                collision = new Cylinder(s, s + s);
            }
            else
            {
                Mesh mesh = meshFilter.sharedMesh;
                collision = new Cylinder(mesh.bounds);
                collision = new Cylinder(collision.radius * viewer.scaleGround,
                                         collision.height * viewer.scaleGround);

                // Snap the spawn position onto the terrain below.
                Ray ray = new Ray(position + Vector3.up, Vector3.down);
                RaycastHit hit;
                if (Physics.Raycast(ray, out hit, GroundSnapRayDistance,
                                    Q4.Layers.Instance.TerrainMask,
                                    QueryTriggerInteraction.Collide)) // INFERRED query mode (literal 2)
                {
                    position = hit.point + Vector3.up * (collision.radius * GroundSnapRadiusFactor);
                }
            }

            if (prefab != null)
            {
                m_detectionDelay = prefab.detectDelay;
                m_cooldownTime = prefab.cooldownTime;
                m_currentCooldownTime = 0.0f;
                m_enemyDetectionRange = prefab.enemyDetectRange;
                m_playerDetectionRange = prefab.playerDetectRange;
                m_playerJumpDetectionRange = prefab.playerJumpDetectRange;
                m_playerDetectionRangeMax = Mathf.Max(m_playerDetectionRange,
                                                      m_playerJumpDetectionRange);

                // TODO: the EventTime argument comes from an unread rodata slot
                // (DAT_010d5118 / DAT_010d4fa8); Immediate assumed.
                Events.stageClearedEvent.AddListener(OnStageCleared, Event.EventTime.Immediate);
                Events.gameOverEvent.AddListener(OnGameOver, Event.EventTime.Immediate);

                m_usageRemain = viewer.usage;
                m_destroyWhenUsedUp = viewer.destroyWhenUsedUp;
                m_textKey = viewer.textKey;
            }

            m_alreadyPlayingRumblePlayer.Clear();
            m_active = true;
        }

        // ---- properties ------------------------------------------------------

        // get_enemyDetectionRange @0x4B6650
        public float enemyDetectionRange { get { return m_enemyDetectionRange; } }

        // get_playerDetectionRange @0x4B6660
        public float playerDetectionRange { get { return m_playerDetectionRange; } }

        // get_playerJumpDetectionRange @0x4B6670
        public float playerJumpDetectionRange { get { return m_playerJumpDetectionRange; } }

        // get_playerDetectionRangeMax @0x4B6680
        public float playerDetectionRangeMax { get { return m_playerDetectionRangeMax; } }

        // get_remainingUses @0x4B6690
        public int remainingUses { get { return m_usageRemain; } }

        // get_textKey @0x4B66A0
        public string textKey { get { return m_textKey; } }

        // get_isHeld @0x4B66B0
        public bool isHeld { get { return playerOwner != null; } }

        // get_IsInteractable @0x4B6830
        public bool IsInteractable
        {
            get
            {
                return !isNonInteractable && playerOwner == null &&
                       m_active && m_usageRemain > 0;
            }
        }

        // get_playerOwner @0x4B66D0
        // Resolves the owning player through the most recent object version;
        // clears the handle when the player no longer exists.
        public GameCorePlayer playerOwner
        {
            get
            {
                if (m_playerOwner.m_handle == -1)
                    return null;
                GameCorePlayer player = m_playerOwner.GetMostRecentObjectVersion<GameCorePlayer>();
                if (player == null)
                    m_playerOwner = GameCoreHandle.nullHandle;
                return player;
            }
        }

        // get_LastPlayerOwner @0x4B6870 (struct copy)
        public GameCoreHandle LastPlayerOwner
        {
            get { return m_lastPlayerOwner; }
        }

        // DestroySelf @0x4B6880 (virtual slot 6)
        // The decompiled body writes the base destroyed flag directly, removes
        // the collision volume, raises fruitVanish, plays the water death splash
        // when submerged and unsubscribes both event listeners.
        public override void DestroySelf()
        {
            base.DestroySelf();   // sets destroyed flag + RemoveCoreObject
            Events.fruitVanishEvent.Invoke(this);
            if (m_isInWater)
                Q4.MonstersAudio.Instance.PlaySFX(Q4.GlobalSounds.FruitWaterDie, position);
            Events.stageClearedEvent.RemoveListener(OnStageCleared);
            Events.gameOverEvent.RemoveListener(OnGameOver);
        }

        // Tick @0x4B6A70 (virtual slot 7)
        public override void Tick()
        {
            if (!m_active || IsDestroyed())
                return;

            if (playerOwner == null)
                CheckWater();
            TickLifeSpan();

            // NOTE: TickCooldown @0x4B7110 is the identical pair of decrements;
            // Tick inlines it (confirmed by matching code).
            float dt = GameCore.TickDeltaTime;
            m_detectionDelay = Mathf.Max(m_detectionDelay - dt, 0.0f);
            m_currentCooldownTime = Mathf.Max(m_currentCooldownTime - dt, 0.0f);

            TickPosition();

            if (m_currentCooldownTime <= Zero && m_detectionDelay <= Zero &&
                m_playerOwner.m_handle < 0 && m_usageRemain > 0)
            {
                TickHitEnemy();
                TickHitPlayer();
                TickHitInteractableObject();
            }
        }

        // CheckWater @0x4B6BC0
        // While falling, probe for the water layer; on entry shorten the
        // remaining lifespan to AISettings.PickupWaterKillTime and splash.
        private void CheckWater()
        {
            if (m_currentVelocity.y >= 0.0f)
                return;

            bool inWater = false;
            if (Physics.CheckSphere(position, collision.radius * WaterCheckSphereRadiusFactor,
                                    Q4.Layers.Instance.WaterMask,
                                    QueryTriggerInteraction.Collide)) // INFERRED query mode (literal 2)
            {
                Ray ray = new Ray(position + Vector3.up, Vector3.down);
                RaycastHit hit;
                inWater = true; // default when the ray misses entirely (matches decompilation)
                if (Physics.Raycast(ray, out hit, WaterRaycastDistance,
                                    Q4.Layers.Instance.WaterMask | Q4.Layers.Instance.TerrainMask,
                                    QueryTriggerInteraction.Collide)) // INFERRED query mode (literal 2)
                {
                    Collider collider = hit.collider;
                    inWater = collider != null &&
                              collider.gameObject.layer == Q4.Layers.Instance.WaterIndex;
                }

                if (inWater && !m_isInWater)
                {
                    m_isInWater = true;
                    float killTime = Q4.AISettings.PickupWaterKillTime;
                    remainingLifespan = remainingLifespan >= 0.0f
                        ? Mathf.Min(remainingLifespan, killTime)
                        : killTime;
                    Q4.MonstersAudio.Instance.PlaySFX(Q4.GlobalSounds.FruitWaterSplash, position);
                }
            }
            m_isInWater = inWater;
        }

        // TickLifeSpan @0x4B6F90
        private void TickLifeSpan()
        {
            if (position.y < KillBelowWorldY)
                remainingLifespan = BelowWorldLifespan;   // DAT_00b7c310 = 0.1 (raw line 842)
            else if (remainingLifespan < 0.0f)
                return;                                   // negative == immortal

            remainingLifespan = Mathf.Max(remainingLifespan - GameCore.TickDeltaTime, 0.0f);
            if (remainingLifespan == ExpiredLifespan)     // DAT_00b7c314 = 0.0 (raw line 866)
            {
                Events.fruitVanishEvent.Invoke(this);
                DestroySelf();                            // virtual call in shipped code
            }
        }

        // TickCooldown @0x4B7110
        // Standalone copy of the two decrements inlined in Tick (kept for
        // completeness; the shipped Tick does not call it).
        private void TickCooldown()
        {
            float dt = GameCore.TickDeltaTime;
            m_detectionDelay = Mathf.Max(m_detectionDelay - dt, 0.0f);
            m_currentCooldownTime = Mathf.Max(m_currentCooldownTime - dt, 0.0f);
        }

        // TickPosition @0x4B71E0
        // Held: pinned above the owner. Free: fruit/fruit separation, gravity,
        // terrain spherecast with bounce, ground snap and rest detection.
        private void TickPosition()
        {
            GameCorePlayer owner = playerOwner;
            if (owner != null)
            {
                position = owner.position + Vector3.up * HeldHeightOffset;
                return;
            }

            if (m_atRest || isNonInteractable)
                return;

            bool sphereHit = false;
            bool rayHit = false;

            // (a) Separate from the first other falling fruit found (only while
            //     this fruit is descending). INFERRED: the decompiled loop exits
            //     after processing the first non-self element, so at most one
            //     separation is applied per tick.
            if (m_currentVelocity.y < 0.0f)
            {
                GameCoreFruit other = null;
                foreach (GameCoreFruit fruit in
                         GameCore.Instance.AllObjects<GameCoreFruit>(position, collision))
                {
                    if (fruit == this)
                        continue;
                    other = fruit;
                    break;
                }

                m_currentVelocity.y = Mathf.Min(m_currentVelocity.y * SeparationVelocityDamping, SeparationVelocityCap); // raw line 1077: cap 1.0

                if (other != null)
                {
                    Vector3 delta = other.position - position;
                    float distance = delta.magnitude - (collision.radius + other.collision.radius);
                    if (distance < 0.0f)
                    {
                        delta.Normalize();
                        Vector3 push = delta * distance;
                        position += push;
                        other.position -= push;
                        m_currentVelocity += new Vector3(
                            RandomRange(SeparationJitterMin, SeparationJitterMax, handle),
                            RandomRange(SeparationJitterMin, SeparationJitterMax, handle),
                            RandomRange(SeparationJitterMin, SeparationJitterMax, handle));
                    }
                }
            }

            // (b) Gravity + terrain sweep with bounce.
            m_currentVelocity += Physics.gravity * GameCore.TickDeltaTime;

            Ray moveRay = new Ray(position, m_currentVelocity.normalized);
            RaycastHit moveHit;
            float sphereRadius = collision.radius * MovementSphereRadiusFactor;
            sphereHit = Physics.SphereCast(moveRay, sphereRadius,
                                           m_currentVelocity.magnitude * GameCore.TickDeltaTime,
                                           out moveHit, Q4.Layers.Instance.TerrainMask);
            if (sphereHit)
            {
                position -= m_currentVelocity.normalized * moveHit.distance;

                float alignment = BounceAlignmentBase - Vector3.Dot(moveHit.normal, m_currentVelocity.normalized); // raw line 1259: 1.0 − Dot
                float rate = (m_bounceTime == BounceTimeDecrement || m_bounceTime > 0.0f)
                    ? m_bouncingRate
                    : 0.0f;
                m_currentVelocity = Vector3.Reflect(m_currentVelocity, moveHit.normal) *
                                    (alignment * rate);
                if (m_bounceTime != BounceTimeDecrement || m_bounceTime > 0.0f)
                    m_bounceTime += BounceTimeDecrement;  // counts down; sentinel = infinite
                Q4.MonstersAudio.Instance.PlaySFX(Q4.GlobalSounds.FruitBounce, position);
            }

            // (c) Integrate.
            position += m_currentVelocity * GameCore.TickDeltaTime;

            // (d) Ground snap probe when the sweep missed.
            if (!sphereHit)
            {
                Ray snapRay = new Ray(position + Vector3.up * RestProbeHeight, Vector3.down);
                RaycastHit snapHit;
                float snapRadius = collision.radius * RestProbeRadiusFactor;
                rayHit = Physics.Raycast(snapRay, out snapHit,
                                         snapRadius + RestProbeDistancePadding,
                                         Q4.Layers.Instance.TerrainMask);
                if (rayHit && snapHit.distance < RestProbeHeight - snapRadius)
                {
                    position = snapHit.point + Vector3.up * snapRadius;
                    m_currentVelocity = Vector3.zero;
                }
            }

            // (e) Rest detection.
            if ((sphereHit || rayHit) && m_currentVelocity.magnitude < RestSpeedThreshold)
                m_atRest = true;
        }

        // Triggerable @0x4B7FD0
        public bool Triggerable()
        {
            return !(m_currentCooldownTime > 0.0f) && !(m_detectionDelay > 0.0f) &&
                   m_playerOwner.m_handle < 0 && m_usageRemain > 0;
        }

        // TickHitEnemy @0x4B8010
        // Broad-phase cylinder query, then trigger on the first enemy whose
        // surface is within m_enemyDetectionRange.
        public void TickHitEnemy()
        {
            Cylinder query = new Cylinder(m_enemyDetectionRange + QueryRadiusMargin, QueryHeight);
            foreach (GameCoreEnemy enemy in GameCore.Instance.AllObjects<GameCoreEnemy>(position, query))
            {
                float distance = Vector3.Distance(enemy.position, position);
                if (distance - enemy.collision.radius <= m_enemyDetectionRange)
                {
                    TriggerInteraction(enemy, distance);
                    break;
                }
            }
        }

        // TickHitPlayer @0x4B8370
        // Triggers on the first player inside m_playerDetectionRangeMax and
        // stops; otherwise forgets players that left the range so their rumble
        // can replay on re-entry (closure <>m__0 compares the captured player).
        public void TickHitPlayer()
        {
            foreach (GameCorePlayer player in GameCore.Instance.AllObjects<GameCorePlayer>())
            {
                if (player == null || player.IsDestroyed())
                    continue;

                float distance = Vector3.Distance(player.position, position);
                if (distance - player.collision.radius < m_playerDetectionRangeMax)
                {
                    TriggerInteraction(player, distance);
                    return;
                }
                if (m_alreadyPlayingRumblePlayer.Exists(p => p == player))
                    m_alreadyPlayingRumblePlayer.Remove(player);
            }
        }

        // TickHitInteractableObject @0x4B8790
        // Queries a small cylinder just below the fruit and triggers on the
        // first interaction object found (distance 0).
        public void TickHitInteractableObject()
        {
            Vector3 queryPos = position + Vector3.down * InteractionQueryDownOffset;
            Cylinder query = new Cylinder(InteractionQueryRadius, InteractionQueryRadius);
            foreach (GameCoreInteractionObject obj in
                     GameCore.Instance.AllObjects<GameCoreInteractionObject>(queryPos, query))
            {
                TriggerInteraction(obj, 0.0f);
                break; // decompiled loop processes only the first element
            }
        }

        // TriggerInteraction @0x4B8AD0
        // Applies the viewer's BuffSetting components to the target according
        // to their triggerTarget flags, then fires fruitCaboom and consumes a
        // use. Enemy: EBuffTriggerTarget.Enemy. Player: PlayerJump when the
        // fruit is below the player and inside the jump range, otherwise Player
        // when at similar height inside the collision radius; local players get
        // a one-shot controller rumble. Interaction objects: raise
        // triggerInterationEvent.
        public void TriggerInteraction(GameCoreObject target, float distance)
        {
            if (m_currentCooldownTime > 0.0f || m_detectionDelay > 0.0f ||
                m_playerOwner.m_handle > -1 || m_usageRemain < 1)
                return;

            Component viewer = GetUnityObject<Component>(); // INFERRED component type
            if (viewer == null || target == null)
                return;

            Q4.BuffSetting[] settings = viewer.GetComponents<Q4.BuffSetting>();
            bool anyApplied = false;

            GameCoreEnemy enemy = target as GameCoreEnemy;
            GameCorePlayer player = target as GameCorePlayer;
            if (enemy != null)
            {
                foreach (Q4.BuffSetting setting in settings)
                {
                    if ((setting.triggerTarget & Q4.EBuffTriggerTarget.Enemy) != 0)
                    {
                        setting.AddBuff(this, target, null);
                        anyApplied = true;
                    }
                }
            }
            else if (player != null)
            {
                float deltaY = position.y - target.position.y;
                bool jumpCase = deltaY < JumpTriggerDeltaY;
                foreach (Q4.BuffSetting setting in settings)
                {
                    bool apply;
                    if ((setting.triggerTarget & Q4.EBuffTriggerTarget.PlayerJump) != 0 && jumpCase)
                    {
                        apply = distance < m_playerJumpDetectionRange;
                    }
                    else
                    {
                        apply = !jumpCase &&
                                (setting.triggerTarget & Q4.EBuffTriggerTarget.Player) != 0 &&
                                distance < player.collision.radius &&
                                Mathf.Abs(position.y - target.position.y) <
                                    collision.radius * PlayerTriggerHeightFactor;
                    }

                    if (!apply)
                        continue;

                    setting.AddBuff(this, target, null);
                    anyApplied = true;

                    if (player.IsLocalPlayer() &&
                        !m_alreadyPlayingRumblePlayer.Exists(p => p == player))
                    {
                        Q4.Player playerViewer = player.GetUnityObject<Q4.Player>(); // INFERRED viewer type
                        if (playerViewer != null)
                        {
                            Q4.GestureManager.Rumble(playerViewer.playerID,
                                                     Q4.VibrationSettings.PlayerTriggerFruit);
                            m_alreadyPlayingRumblePlayer.Add(player);
                        }
                    }
                }
            }
            else if (target is GameCoreInteractionObject)
            {
                // INFERRED payload: the decompiled Invoke passes a null player
                // and one GameCoreHandle (DAT_010d51b8); target.handle assumed.
                Events.triggerInterationEvent.Invoke(null, target.handle);
                return; // the interaction path does not consume a use
            }
            else
            {
                return;
            }

            if (!anyApplied)
                return;

            Events.fruitCaboomEvent.Invoke(this);
            m_currentCooldownTime = m_cooldownTime;
            m_usageRemain--;
            if (m_usageRemain < 1)
            {
                m_active = false;
                if (m_destroyWhenUsedUp)
                    DestroySelf();    // virtual call in shipped code
            }
        }

        // RecreateViewer @0x4B90E0 (virtual slot 5)
        public override GameObject RecreateViewer()
        {
            Component viewer = GetUnityObject<Component>(); // INFERRED component type
            if (viewer == null && m_prefabName != null)
                viewer = CreateViewerFromPrefabName<Q4.Fruit>(m_prefabName);
            return viewer != null ? viewer.gameObject : null;
        }

        // OnGrab @0x4B92D0 (IGrabbable slot 0)
        // Ownership is set on the most recent version of this fruit (the
        // grabbed instance may be a stale frame copy).
        public void OnGrab(GameCorePlayer a_player)
        {
            GameCoreFruit latest = handle.GetMostRecentObjectVersion<GameCoreFruit>();
            if (latest != null)
            {
                latest.m_playerOwner = a_player.handle;
                latest.m_lastPlayerOwner = a_player.handle;
            }
        }

        // OnDrop @0x4B9380 (IGrabbable slot 1)
        // A gentle drop snaps the fruit onto the terrain below and rests it; a
        // thrown drop places it just above the ground probe hit and launches it
        // with the given force.
        public void OnDrop(GameCorePlayer a_player, Vector3 force)
        {
            GameCoreFruit latest = handle.GetMostRecentObjectVersion<GameCoreFruit>();
            if (latest == null)
                return;
            Component viewer = GetUnityObject<Component>(); // INFERRED component type
            if (viewer == null)
                return;

            latest.position = a_player.position;
            latest.m_playerOwner = GameCoreHandle.nullHandle;

            if (force.magnitude <= GentleDropForceThreshold)
            {
                Ray ray = new Ray(latest.position + Vector3.up, Vector3.down);
                RaycastHit hit;
                if (Physics.Raycast(ray, out hit, GentleDropRayDistance,
                                    Q4.Layers.Instance.TerrainMask))
                {
                    latest.position = hit.point +
                        Vector3.up * (latest.collision.radius * GentleDropRadiusFactor);
                }
                latest.m_atRest = true;
                latest.m_currentVelocity = Vector3.zero;
            }
            else
            {
                float sphereRadius = collision.radius * ThrowDropSphereRadiusFactor;
                Ray ray = new Ray(latest.position + Vector3.up * ThrowDropProbeHeight, Vector3.down);
                RaycastHit hit;
                if (Physics.SphereCast(ray, sphereRadius, ThrowDropProbeMaxDistance,
                                       out hit, Q4.Layers.Instance.TerrainMask) &&
                    ThrowDropProbeHeight - sphereRadius <= hit.distance)
                {
                    latest.position = ray.origin +
                        Vector3.down * (hit.distance + ThrowDropLandingClearance);
                }
                latest.m_atRest = false;
                latest.m_currentVelocity = force;
            }
        }

        // ThrowWithForce @0x4B99C0 (IGrabbable slot 2)
        // NOTE: the player parameter is unused in the shipped code.
        public void ThrowWithForce(GameCorePlayer player, Vector3 force)
        {
            m_atRest = false;
            m_currentVelocity = force;
        }

        // OnStageCleared @0x4B99E0 — no-op (confirmed empty body).
        public void OnStageCleared(GameCoreWaveManager manager) { }

        // OnGameOver @0x4B99F0
        public void OnGameOver()
        {
            m_active = false;
        }
    }
}
