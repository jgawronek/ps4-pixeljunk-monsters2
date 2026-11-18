// src/core/Events.ts
// TypeScript port of decomp/src/GameCore/Events.cs — the static event hub.
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; .cctor @0x945DC0 news up all
// 58 events in field order; payload shapes confirmed from metadata
// TypeDefIndex 2914..2971.)
//
// Every gameplay notification the simulation raises to the presentation layer
// is one of these static CoreEvent instances. Raising = invoke(...); listeners
// register with addListener(cb, EventTime[, handleId]).
//
// TS ADAPTATION — progressive payload typing: payload types referencing sim
// classes that are not yet ported are aliased to `unknown` below (the original
// C# payload types are documented per alias and per event). Tighten each alias
// to the real class as its module lands; call sites need no changes.

import { Vector3 } from '../engine/math/Vector3';
import {
  CoreEvent,
  CoreEvent1,
  CoreEvent2,
  CoreEvent3,
  CoreEvent4,
  CoreEventBase,
} from './event/CoreEvent';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { CurrencyValueInfo } from './CurrencyValueInfo';
// Type-only imports (erased at runtime — no import cycles added).
import type { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreFruit } from './GameCoreFruit';
import type { GameCorePickup } from './GameCorePickup';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import type { GameCoreTree } from './GameCoreTree';
import type { GameCoreInventory } from './GameCoreInventory';
import type { EInventoryType } from './GameCoreInventory';
import type { EnemyHitInfo } from './EnemyHitInfo';
import type { GameCoreHome } from './GameCoreHome';
import type { ChibiData } from './GameCoreHome';
import type { GameCoreTower } from './GameCoreTower';
import type { TowerState } from './TowerState';
import type { TowerUpgradeContract } from '../view/q4-contracts';

// ---- payload type aliases (tighten as modules land) ----
type GameCoreEnemyT = unknown; // → GameCoreEnemy
type GameCoreTowerT = GameCoreTower | null; // TIGHTENED (iter 21; C# ref nullable — death paths pass null)
type GameCorePlayerT = GameCorePlayer; // TIGHTENED (iter 12)
type GameCoreFruitT = GameCoreFruit; // TIGHTENED (iter 12 — skeleton until the Fruit port)
type GameCorePickupT = GameCorePickup; // TIGHTENED (iter 12 — skeleton until the Pickup-family port)
type GameCoreProjectileT = unknown; // → GameCoreProjectile
type GameCoreProjectileInsectT = unknown; // → GameCoreProjectileInsect
type GameCoreWaveManagerT = GameCoreWaveManager; // TIGHTENED (iter 12 — skeleton until the WaveManager port)
type GameCoreTreeT = GameCoreTree; // TIGHTENED (iter 12)
type GameCoreHomeT = GameCoreHome; // TIGHTENED (iter 14)
type ChibiDataT = ChibiData; // TIGHTENED (iter 14)
type EnemyHitInfoT = EnemyHitInfo; // TIGHTENED (iter 12)
type TowerStateT = TowerState; // TIGHTENED (iter 21)
type Q4TowerUpgradeT = TowerUpgradeContract | null; // TIGHTENED (iter 21; next may be null)
type Q4BuffSettingT = unknown; // → Q4.BuffSetting (view contract)
type EInventoryTypeT = EInventoryType; // TIGHTENED (iter 12)

/** The static hub — C# static fields become static readonly members.
 *  Offsets are the original Events static-field block offsets. */
export class Events {
  static readonly introSequenceFinishedEvent = new CoreEvent1<GameCorePlayerT>(); // 0x0
  static readonly waveStartedEvent = new CoreEvent2<GameCoreWaveManagerT, number>(); // 0x8
  static readonly waveActivateEvent = new CoreEvent2<GameCoreWaveManagerT, number>(); // 0x10
  static readonly waveEndedEvent = new CoreEvent2<GameCoreWaveManagerT, number>(); // 0x18
  static readonly spawnGroupStartedEvent = new CoreEvent4<number, GameCoreEnemyT, Vector3, boolean>(); // 0x20
  static readonly spawnGroupEndedEvent = new CoreEvent1<number>(); // 0x28
  static readonly stageClearedEvent = new CoreEvent1<GameCoreWaveManagerT>(); // 0x30
  static readonly gameOverEvent = new CoreEvent(); // 0x38
  static readonly enemyDestroyedEvent = new CoreEvent3<GameCoreTowerT, GameCoreEnemyT, EnemyHitInfoT>(); // 0x40
  static readonly enemyAttackedHomeEvent = new CoreEvent3<GameCoreEnemyT, GameCoreHomeT, ChibiDataT>(); // 0x48
  static readonly enemyHitEvent = new CoreEvent1<EnemyHitInfoT>(); // 0x50
  static readonly enemyDrownEvent = new CoreEvent1<GameCoreEnemyT>(); // 0x58
  static readonly enemyAttackEvent = new CoreEvent3<GameCoreEnemyT, GameCoreHomeT, ChibiDataT>(); // 0x60
  static readonly jumpReactionEvent = new CoreEvent2<GameCoreEnemyT, number>(); // 0x68
  static readonly bossJumpEvent = new CoreEvent2<GameCoreEnemyT, number>(); // 0x70
  static readonly enemySpawnEvent = new CoreEvent1<GameCoreEnemyT>(); // 0x78
  static readonly popBalloonsEvent = new CoreEvent2<GameCoreEnemyT, number>(); // 0x80
  static readonly projectileLaunchEvent = new CoreEvent1<GameCoreTowerT>(); // 0x88
  static readonly towerTargetChangeEvent = new CoreEvent1<GameCoreTowerT>(); // 0x90
  static readonly projectileHitEvent = new CoreEvent2<GameCoreProjectileT, unknown /* IDamageable */>(); // 0x98
  static readonly projectileHitTerrain = new CoreEvent3<GameCoreProjectileT, Vector3, Vector3>(); // 0xA0
  static readonly expGrantEvent = new CoreEvent2<GameCoreTowerT, number>(); // 0xA8
  static readonly towerBuildEvent = new CoreEvent3<GameCoreTowerT, GameCoreTreeT, GameCorePlayerT>(); // 0xB0
  static readonly structureBreakEvent = new CoreEvent1<GameCoreObject>(); // 0xB8
  static readonly towerUpgradeEvent = new CoreEvent2<GameCoreTowerT, Q4TowerUpgradeT>(); // 0xC0
  static readonly towerSellEvent = new CoreEvent4<GameCoreTowerT, GameCorePlayerT, number, number>(); // 0xC8
  static readonly towerChangeStateEvent = new CoreEvent2<GameCoreTowerT, TowerStateT>(); // 0xD0
  static readonly treeReviveEvent = new CoreEvent3<GameCoreTreeT, GameCorePlayerT, number>(); // 0xD8
  static readonly pickupAcquiredEvent = new CoreEvent2<GameCorePlayerT, GameCorePickupT>(); // 0xE0
  static readonly pickupLostEvent = new CoreEvent1<GameCorePickupT>(); // 0xE8
  static readonly fruitSpawnEvent = new CoreEvent1<GameCoreFruitT>(); // 0xF0
  static readonly fruitVanishEvent = new CoreEvent1<GameCoreFruitT>(); // 0xF8
  static readonly fruitPickedUpEvent = new CoreEvent2<GameCorePlayerT, GameCoreFruitT>(); // 0x100
  static readonly fruitCaboomEvent = new CoreEvent1<GameCoreFruitT>(); // 0x108
  static readonly explosionDamageEvent = new CoreEvent3<GameCoreObject, Vector3, number>(); // 0x110
  static readonly fruitDroppedEvent = new CoreEvent3<GameCorePlayerT, GameCoreFruitT, Vector3>(); // 0x118
  static readonly triggerInterationEvent = new CoreEvent2<GameCorePlayer | null, GameCoreHandle>(); // 0x120 [sic — original spelling; null player from fruit interaction path]
  static readonly hiddenPickupFoundEvent = new CoreEvent3<GameCorePlayerT, EInventoryTypeT, number>(); // 0x128
  static readonly playerBumpedEvent = new CoreEvent3<GameCorePlayerT, CurrencyValueInfo, CurrencyValueInfo>(); // 0x130
  static readonly playerRemovedEvent = new CoreEvent1<GameCorePlayerT>(); // 0x138
  static readonly localPlayerAddedEvent = new CoreEvent1<GameCorePlayerT>(); // 0x140
  static readonly localPlayerRemovedEvent = new CoreEvent1<GameCorePlayerT>(); // 0x148
  static readonly addBuffEvent = new CoreEvent2<GameCoreObject, Q4BuffSettingT>(); // 0x150
  static readonly removeBuffEvent = new CoreEvent2<GameCoreObject, unknown /* System.Type */>(); // 0x158
  static readonly flareEvent = new CoreEvent3<GameCoreObject, GameCoreObject, GameCoreHandle>(); // 0x160
  static readonly signEvent = new CoreEvent3<GameCoreHandle, number, number>(); // 0x168
  static readonly onFireExtinguished = new CoreEvent1<GameCoreObject>(); // 0x170
  static readonly onGemTowerPopGem = new CoreEvent2<GameCoreTowerT, number>(); // 0x178
  static readonly onGemTowerDestroy = new CoreEvent1<GameCoreTowerT>(); // 0x180
  static readonly onAddInventory = new CoreEvent4<GameCorePlayerT, GameCoreInventory, EInventoryTypeT, number>(); // 0x188
  static readonly onRemoveInventory = new CoreEvent4<GameCorePlayerT, GameCoreInventory, EInventoryTypeT, number>(); // 0x190
  static readonly postResyncEvent = new CoreEvent(); // 0x198
  static readonly beeSpotATargetEvent = new CoreEvent2<GameCoreProjectileInsectT, GameCoreHandle>(); // 0x1A0
  static readonly busyEvent = new CoreEvent2<GameCoreHandle, boolean>(); // 0x1A8
  static readonly gemTowerSinkEvent = new CoreEvent4<GameCoreHandle, number, number, number>(); // 0x1B0
  static readonly missileTowerChangeMag = new CoreEvent3<GameCoreHandle, number, number>(); // 0x1B8
  static readonly notEnoughMoneyForTower = new CoreEvent1<number>(); // 0x1C0
  static readonly bossAttackEffectEvent = new CoreEvent(); // 0x1C8
}

/** TEST-ONLY: reset every static event (listeners, replay buffers, pending
 *  sets). Fixtures call this between tests because handle ids are reused after
 *  GameCoreHandle.resetStaticsForTests() — stale sim-object listeners would
 *  otherwise match fresh objects via the ListenerSorter's handle keys. */
export function resetAllEventsForTests(): void {
  CoreEventBase.resetStaticsForTests();
  for (const key of Object.getOwnPropertyNames(Events)) {
    if (key === 'prototype') continue;
    const value = (Events as unknown as Record<string, unknown>)[key];
    if (value instanceof CoreEventBase) value.resetForTests();
  }
}
