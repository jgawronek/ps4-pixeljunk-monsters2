// GameCore/Events.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The static event hub. Every gameplay notification the simulation raises to the
// Q4 presentation layer is one of these static CoreEvent instances. The .cctor
// (RVA 0x945DC0) news up all 58 events in field order; each nested event type is
// an empty subclass of a CoreEvent<...> payload shape (names/shapes confirmed from
// metadata TypeDefIndex 2914..2971). Raising an event = calling .Invoke(...) on the
// corresponding static field; listeners register with .AddListener(cb, EventTime).
//
// Static-field offsets (0x0..0x1C8) are relative to the Events static_fields block.
// Several payload types (GameCoreEnemy, GameCoreTower, TowerState,
// GameCoreHome.ChibiData, GameCoreInventory.EInventoryType, ...) are
// reconstructed elsewhere in GameCore; they are referenced here by name only.
// Two payload types live in the Q4 (presentation) namespace and are qualified
// explicitly: Q4.TowerUpgrade, Q4.BuffSetting.

namespace GameCore
{
    public class Events
    {
        public static IntroSequenceFinishedEvent introSequenceFinishedEvent = new IntroSequenceFinishedEvent(); // 0x0
        public static WaveStartedEvent waveStartedEvent = new WaveStartedEvent();                               // 0x8
        public static WaveActivateEvent waveActivateEvent = new WaveActivateEvent();                            // 0x10
        public static WaveEndedEvent waveEndedEvent = new WaveEndedEvent();                                     // 0x18
        public static SpawnGroupStartedEvent spawnGroupStartedEvent = new SpawnGroupStartedEvent();             // 0x20
        public static SpawnGroupEndedEvent spawnGroupEndedEvent = new SpawnGroupEndedEvent();                   // 0x28
        public static StageClearedEvent stageClearedEvent = new StageClearedEvent();                            // 0x30
        public static GameOverEvent gameOverEvent = new GameOverEvent();                                        // 0x38
        public static EnemyDestroyedEvent enemyDestroyedEvent = new EnemyDestroyedEvent();                      // 0x40
        public static EnemyAttackedHomeEvent enemyAttackedHomeEvent = new EnemyAttackedHomeEvent();             // 0x48
        public static EnemyHitEvent enemyHitEvent = new EnemyHitEvent();                                        // 0x50
        public static EnemyDrownEvent enemyDrownEvent = new EnemyDrownEvent();                                  // 0x58
        public static EnemyAttackEvent enemyAttackEvent = new EnemyAttackEvent();                               // 0x60
        public static JumpReactionEvent jumpReactionEvent = new JumpReactionEvent();                            // 0x68
        public static BossJumpEvent bossJumpEvent = new BossJumpEvent();                                        // 0x70
        public static EnemySpawnEvent enemySpawnEvent = new EnemySpawnEvent();                                  // 0x78
        public static PopBalloonsEvent popBalloonsEvent = new PopBalloonsEvent();                               // 0x80
        public static ProjectileLaunchEvent projectileLaunchEvent = new ProjectileLaunchEvent();                // 0x88
        public static TowerTargetChangeEvent towerTargetChangeEvent = new TowerTargetChangeEvent();             // 0x90
        public static ProjectileHitEvent projectileHitEvent = new ProjectileHitEvent();                         // 0x98
        public static ProjectileHitTerrainEvent projectileHitTerrain = new ProjectileHitTerrainEvent();         // 0xA0
        public static OnEXPGrantEvent expGrantEvent = new OnEXPGrantEvent();                                    // 0xA8
        public static OnTowerBuildEvent towerBuildEvent = new OnTowerBuildEvent();                              // 0xB0
        public static OnStructureBreakEvent structureBreakEvent = new OnStructureBreakEvent();                  // 0xB8
        public static OnTowerUpgradeEvent towerUpgradeEvent = new OnTowerUpgradeEvent();                        // 0xC0
        public static OnTowerSellEvent towerSellEvent = new OnTowerSellEvent();                                 // 0xC8
        public static OnTowerChangeStateEvent towerChangeStateEvent = new OnTowerChangeStateEvent();            // 0xD0
        public static OnTreeReviveEvent treeReviveEvent = new OnTreeReviveEvent();                              // 0xD8
        public static PickupAcquiredEvent pickupAcquiredEvent = new PickupAcquiredEvent();                      // 0xE0
        public static PickupLostEvent pickupLostEvent = new PickupLostEvent();                                  // 0xE8
        public static FruitSpawnEvent fruitSpawnEvent = new FruitSpawnEvent();                                  // 0xF0
        public static FruitVanishEvent fruitVanishEvent = new FruitVanishEvent();                               // 0xF8
        public static FruitPickedUpEvent fruitPickedUpEvent = new FruitPickedUpEvent();                         // 0x100
        public static FruitCaboomEvent fruitCaboomEvent = new FruitCaboomEvent();                               // 0x108
        public static ExplosionDamageEvent explosionDamageEvent = new ExplosionDamageEvent();                   // 0x110
        public static FruitDroppedEvent fruitDroppedEvent = new FruitDroppedEvent();                            // 0x118
        public static TriggerInterationEvent triggerInterationEvent = new TriggerInterationEvent();             // 0x120
        public static HiddenPickupFoundEvent hiddenPickupFoundEvent = new HiddenPickupFoundEvent();             // 0x128
        public static PlayerBumpedEvent playerBumpedEvent = new PlayerBumpedEvent();                            // 0x130
        public static PlayerRemovedEvent playerRemovedEvent = new PlayerRemovedEvent();                         // 0x138
        public static LocalPlayerAddedEvent localPlayerAddedEvent = new LocalPlayerAddedEvent();                // 0x140
        public static LocalPlayerRemovedEvent localPlayerRemovedEvent = new LocalPlayerRemovedEvent();          // 0x148
        public static AddBuffEvent addBuffEvent = new AddBuffEvent();                                           // 0x150
        public static RemoveBuffEvent removeBuffEvent = new RemoveBuffEvent();                                  // 0x158
        public static FlareEvent flareEvent = new FlareEvent();                                                 // 0x160
        public static SignEvent signEvent = new SignEvent();                                                    // 0x168
        public static OnFireExtinguished onFireExtinguished = new OnFireExtinguished();                         // 0x170
        public static OnGemTowerPopGem onGemTowerPopGem = new OnGemTowerPopGem();                               // 0x178
        public static OnGemTowerDestroy onGemTowerDestroy = new OnGemTowerDestroy();                            // 0x180
        public static OnAddInventory onAddInventory = new OnAddInventory();                                     // 0x188
        public static OnRemoveInventory onRemoveInventory = new OnRemoveInventory();                            // 0x190
        public static PostResyncEvent postResyncEvent = new PostResyncEvent();                                  // 0x198
        public static BeeSpotATarget beeSpotATargetEvent = new BeeSpotATarget();                                // 0x1A0
        public static BusyEvent busyEvent = new BusyEvent();                                                    // 0x1A8
        public static GemTowerSinkEvent gemTowerSinkEvent = new GemTowerSinkEvent();                            // 0x1B0
        public static MissileTowerChangeMag missileTowerChangeMag = new MissileTowerChangeMag();                // 0x1B8
        public static NotEnoughMoneyForTower notEnoughMoneyForTower = new NotEnoughMoneyForTower();             // 0x1C0
        public static BossAttackEffectEvent bossAttackEffectEvent = new BossAttackEffectEvent();                // 0x1C8

        // .ctor @0x945DB0 (instance ctor is trivial; the class is used statically)
        public Events() { }

        // ---- nested event types (empty CoreEvent subclasses) -----------------
        public class IntroSequenceFinishedEvent : Event.CoreEvent<GameCorePlayer> { }
        public class WaveStartedEvent : Event.CoreEvent<GameCoreWaveManager, int> { }
        public class WaveActivateEvent : Event.CoreEvent<GameCoreWaveManager, int> { }
        public class WaveEndedEvent : Event.CoreEvent<GameCoreWaveManager, int> { }
        public class SpawnGroupStartedEvent : Event.CoreEvent<int, GameCoreEnemy, UnityEngine.Vector3, bool> { }
        public class SpawnGroupEndedEvent : Event.CoreEvent<int> { }
        public class StageClearedEvent : Event.CoreEvent<GameCoreWaveManager> { }
        public class GameOverEvent : Event.CoreEvent { }
        public class EnemyDestroyedEvent : Event.CoreEvent<GameCoreTower, GameCoreEnemy, EnemyHitInfo> { }
        public class EnemyAttackedHomeEvent : Event.CoreEvent<GameCoreEnemy, GameCoreHome, GameCoreHome.ChibiData> { }
        public class EnemyHitEvent : Event.CoreEvent<EnemyHitInfo> { }
        public class EnemyDrownEvent : Event.CoreEvent<GameCoreEnemy> { }
        public class EnemyAttackEvent : Event.CoreEvent<GameCoreEnemy, GameCoreHome, GameCoreHome.ChibiData> { }
        public class JumpReactionEvent : Event.CoreEvent<GameCoreEnemy, float> { }
        public class BossJumpEvent : Event.CoreEvent<GameCoreEnemy, float> { }
        public class EnemySpawnEvent : Event.CoreEvent<GameCoreEnemy> { }
        public class PopBalloonsEvent : Event.CoreEvent<GameCoreEnemy, int> { }
        public class ProjectileLaunchEvent : Event.CoreEvent<GameCoreTower> { }
        public class TowerTargetChangeEvent : Event.CoreEvent<GameCoreTower> { }
        public class ProjectileHitEvent : Event.CoreEvent<GameCoreProjectile, IDamageable> { }
        public class ProjectileHitTerrainEvent : Event.CoreEvent<GameCoreProjectile, UnityEngine.Vector3, UnityEngine.Vector3> { }
        public class OnEXPGrantEvent : Event.CoreEvent<GameCoreTower, float> { }
        public class OnTowerBuildEvent : Event.CoreEvent<GameCoreTower, GameCoreTree, GameCorePlayer> { }
        public class OnStructureBreakEvent : Event.CoreEvent<GameCoreObject> { }
        public class OnTowerUpgradeEvent : Event.CoreEvent<GameCoreTower, Q4.TowerUpgrade> { }
        public class OnTowerSellEvent : Event.CoreEvent<GameCoreTower, GameCorePlayer, int, int> { }
        public class OnTowerChangeStateEvent : Event.CoreEvent<GameCoreTower, TowerState> { }
        public class OnTreeReviveEvent : Event.CoreEvent<GameCoreTree, GameCorePlayer, int> { }
        public class PickupAcquiredEvent : Event.CoreEvent<GameCorePlayer, GameCorePickup> { }
        public class PickupLostEvent : Event.CoreEvent<GameCorePickup> { }
        public class FruitSpawnEvent : Event.CoreEvent<GameCoreFruit> { }
        public class FruitVanishEvent : Event.CoreEvent<GameCoreFruit> { }
        public class FruitPickedUpEvent : Event.CoreEvent<GameCorePlayer, GameCoreFruit> { }
        public class FruitCaboomEvent : Event.CoreEvent<GameCoreFruit> { }
        public class ExplosionDamageEvent : Event.CoreEvent<GameCoreObject, UnityEngine.Vector3, float> { }
        public class FruitDroppedEvent : Event.CoreEvent<GameCorePlayer, GameCoreFruit, UnityEngine.Vector3> { }
        public class TriggerInterationEvent : Event.CoreEvent<GameCorePlayer, GameCoreHandle> { }
        public class HiddenPickupFoundEvent : Event.CoreEvent<GameCorePlayer, GameCoreInventory.EInventoryType, int> { }
        public class PlayerBumpedEvent : Event.CoreEvent<GameCorePlayer, CurrencyValueInfo, CurrencyValueInfo> { }
        public class PlayerRemovedEvent : Event.CoreEvent<GameCorePlayer> { }
        public class LocalPlayerAddedEvent : Event.CoreEvent<GameCorePlayer> { }
        public class LocalPlayerRemovedEvent : Event.CoreEvent<GameCorePlayer> { }
        public class AddBuffEvent : Event.CoreEvent<GameCoreObject, Q4.BuffSetting> { }
        public class RemoveBuffEvent : Event.CoreEvent<GameCoreObject, System.Type> { }
        public class FlareEvent : Event.CoreEvent<GameCoreObject, GameCoreObject, GameCoreHandle> { }
        public class SignEvent : Event.CoreEvent<GameCoreHandle, int, int> { }
        public class OnFireExtinguished : Event.CoreEvent<GameCoreObject> { }
        public class OnGemTowerPopGem : Event.CoreEvent<GameCoreTower, int> { }
        public class OnGemTowerDestroy : Event.CoreEvent<GameCoreTower> { }
        public class OnAddInventory : Event.CoreEvent<GameCorePlayer, GameCoreInventory, GameCoreInventory.EInventoryType, int> { }
        public class OnRemoveInventory : Event.CoreEvent<GameCorePlayer, GameCoreInventory, GameCoreInventory.EInventoryType, int> { }
        public class PostResyncEvent : Event.CoreEvent { }
        public class BeeSpotATarget : Event.CoreEvent<GameCoreProjectileInsect, GameCoreHandle> { }
        public class BusyEvent : Event.CoreEvent<GameCoreHandle, bool> { }
        public class GemTowerSinkEvent : Event.CoreEvent<GameCoreHandle, float, float, float> { }
        public class MissileTowerChangeMag : Event.CoreEvent<GameCoreHandle, int, int> { }
        public class NotEnoughMoneyForTower : Event.CoreEvent<int> { }
        public class BossAttackEffectEvent : Event.CoreEvent { }
    }
}
