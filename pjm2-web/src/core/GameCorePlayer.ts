// src/core/GameCorePlayer.ts
// TypeScript port of decomp/src/GameCore/GameCorePlayer.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; methods @0x4B91F0, @0x4BDE50,
// RVA 0x4C1280..0x4C30B0).
//
// Sim-side avatar state. Movement itself is presentation-driven (Q4.Player /
// PlayerMotor write position/facingDegrees into this object); the sim tick here
// derives forward direction, collects pickups, reveals hidden tree pickups,
// processes delayed loose-currency drops (when bumped by enemies) and ticks
// buffs. Fruit carrying is tracked via m_heldFruitHandle.
//
// TS ADAPTATIONS (documented):
//  - C# IdleTime/XPTime auto-props { get; protected set; } → protected backing
//    fields + public getters (TS requires equal get/set visibility).
//  - Instance-method event listeners → bound arrow fields (C# delegate target
//    equality = method + instance; TS = stable function reference), registered
//    with this handle's id for the ListenerSorter.
//  - Object.FindObjectsOfType<Q4.Player>() → getPlayerViews() provider hook;
//    Q4 view types → structural contracts (src/view/q4-contracts.ts).
//  - Runtime import cycle Player ⇄ Inventory mirrors the C# assembly cycle;
//    safe because both classes are referenced only inside method bodies.

import { Mathf, Vector3 } from '../engine/math';
import {
  getNetworkMatchInstance,
  getPlayerViews,
  getStageHubCurrentStage,
  NetworkMatch,
  type HiddenPickupData,
  type NatureTreeViewContract,
  type PlayerViewContract,
} from '../view/q4-contracts';
import { BuffContainer } from './BuffContainer';
import { CurrencyValueInfo } from './CurrencyValueInfo';
import { Cylinder } from './Cylinder';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreFruit } from './GameCoreFruit';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreInventory, EInventoryType } from './GameCoreInventory';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePickup } from './GameCorePickup';
import { GameCoreTree } from './GameCoreTree';
import { GameCoreWaveManager } from './GameCoreWaveManager';
import type { IBuffs, ISpeedScale } from './interfaces';

const f = Math.fround;

export class GameCorePlayer extends GameCoreObject implements IBuffs, ISpeedScale {
  playerId = 0; // 0x60
  facingDegrees = f(0); // 0x64
  animationStateHash = 0; // 0x68
  animationStateTime = f(0); // 0x6C
  towerDanceHandle = -1; // 0x70 (pre-base initializer)
  sampleTime = f(0); // 0x74
  /** C#: public float IdleTime { get; protected set; } — TS ADAPTATION:
   *  protected backing field + public getter. */
  protected m_idleTime = f(0); // 0x78
  /** C#: public float XPTime { get; protected set; } */
  protected m_xpTime = f(0); // 0x7C
  private m_isPendingLooseCoins = false; // 0x80
  private m_looseCoinsDelay = 0; // 0x84
  private m_lossCoins = 0; // 0x88
  private m_dropCoins = 0; // 0x8C
  private m_lossGems = 0; // 0x90
  private m_dropGems = 0; // 0x94
  private m_valuePerCoin = 0; // 0x98
  private m_valuePerGem = 0; // 0x9C
  private m_buffs: BuffContainer | null = null; // 0xA0
  /** @internal semantics — OnFruitPickedUp/OnFruitDropped write it cross-instance
   *  (same-class private access in C#; TS private allows the same). */
  private m_heldFruitHandle: GameCoreHandle = GameCoreHandle.nullHandle; // 0xA8
  private m_speedScale = f(1.0); // 0xC8 (pre-base initializer)
  private m_lastPosition: Vector3 = Vector3.zero; // 0xCC
  private m_forward: Vector3 = Vector3.zero; // 0xD8

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_fruitPickedUpListener = (
    a_player: GameCorePlayer,
    a_fruit: GameCoreFruit,
  ): void => this.onFruitPickedUp(a_player, a_fruit);
  private readonly m_fruitDroppedListener = (
    a_player: GameCorePlayer,
    a_fruit: GameCoreFruit,
    a_force: Vector3,
  ): void => this.onFruitDropped(a_player, a_fruit, a_force);

  get idleTime(): number {
    return this.m_idleTime;
  }
  get xpTime(): number {
    return this.m_xpTime;
  }

  // get_Buffs @0x4C1570 (IBuffs, slot 9)
  get buffs(): BuffContainer {
    return this.m_buffs!; // C#: null until the ctor runs with a live GameCore
  }

  // get_IsHoldingFruit @0x4C1580
  get isHoldingFruit(): boolean {
    return this.m_heldFruitHandle.m_handle !== -1;
  }

  // get_forward @0x4C1600
  get forward(): Vector3 {
    return this.m_forward;
  }

  // get_HeldFruit @0x4C1640
  get heldFruit(): GameCoreFruit | null {
    return this.m_heldFruitHandle.getMostRecentObjectVersion<GameCoreFruit>();
  }

  // get_IsHeldFruitError @0x4C1690
  // True when a fruit handle is set but no longer resolves; clears the handle.
  // FAITHFUL QUIRK: side effect inside a getter.
  get isHeldFruitError(): boolean {
    if (this.heldFruit !== null) return false;
    if (this.m_heldFruitHandle.m_handle === -1) return false;
    this.m_heldFruitHandle = GameCoreHandle.nullHandle;
    return true;
  }

  // .ctor @0x4C1280
  constructor() {
    super();
    if (GameCore.instance === null) return; // binary: early-out, no buffs/events wired

    this.m_idleTime = f(0.0);
    this.m_xpTime = f(0.0);
    this.collision = new Cylinder(0.15, 0.75);
    this.m_buffs = new BuffContainer();
    this.m_lastPosition = this.position;

    Events.fruitPickedUpEvent.addListener(
      this.m_fruitPickedUpListener,
      EventTime.Immediate,
      this.handle.m_handle,
    );
    Events.fruitDroppedEvent.addListener(
      this.m_fruitDroppedListener,
      EventTime.Immediate,
      this.handle.m_handle,
    );
  }

  // GetSpeedScale @0x4C1620 (ISpeedScale, slot 10)
  getSpeedScale(): number {
    return this.m_speedScale;
  }

  // SetSpeedScale @0x4C1630 (ISpeedScale, slot 11)
  setSpeedScale(scale: number): void {
    this.m_speedScale = f(scale);
  }

  // IsLocalPlayer @0x4B91F0
  isLocalPlayer(): boolean {
    if (!NetworkMatch.isNetworkMatch) return true;
    const instance = getNetworkMatchInstance();
    if (instance === null) return true;
    return instance.localPlayerId === this.playerId;
  }

  // GetPlayerCount @0x4C1820
  static getPlayerCount(): number {
    // C# NREs without a GameCore instance — faithful via non-null assertion.
    let count = 0;
    for (const _player of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      count++;
    }
    return count;
  }

  // GetLocalPlayer @0x4C1890
  static getLocalPlayer(): GameCorePlayer | null {
    for (const player of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      if (player.isLocalPlayer()) return player;
    }
    return null;
  }

  // GetPlayer @0x4BDE50
  static getPlayer(playerId: number): GameCorePlayer | null {
    for (const player of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      if (player.playerId === playerId) return player;
    }
    return null;
  }

  // Tick @0x4C1B60 (virtual slot 7)
  override tick(): void {
    const delta = this.position.sub(this.m_lastPosition);
    if (delta.magnitude > 0.001) {
      this.m_forward = delta.normalized;
    }
    this.m_lastPosition = this.position;

    this.checkForPickups();
    this.checkForHiddenTreePickups();
    this.processDropPickup();
    this.tickBuffs(); // inlined in the binary; same null-guarded call
  }

  // TickBuffs @0x4C2A90
  private tickBuffs(): void {
    if (this.m_buffs === null) return;
    this.m_buffs.tick(this);
  }

  // CheckForPickups @0x4C1C40
  private checkForPickups(): void {
    const area = new Cylinder(4.0, 4.0);
    for (const pickup of GameCore.instance!.allObjectsIn<GameCorePickup>(
      GameCorePickup,
      this.position,
      area,
    )) {
      const delta = pickup.position.sub(this.position);
      // FAITHFUL QUIRK: binary compares distance (NOT squared) against range².
      if (delta.magnitude < f(pickup.detectionRange * pickup.detectionRange)) {
        pickup.pickup(this); // virtual slot 9
      }
    }
  }

  // CheckForHiddenTreePickups @0x4C1FD0
  // Trees can hide currency/fruit pickups; walking near one reveals it.
  private checkForHiddenTreePickups(): void {
    const area = new Cylinder(4.0, 8.0);
    const stage = getStageHubCurrentStage(); // C#: Q4.StageHub.GetCurrentStage()
    if (stage === null) return;

    for (const tree of GameCore.instance!.allObjectsIn<GameCoreTree>(
      GameCoreTree,
      this.position,
      area,
    )) {
      if (tree.hiddenPickupIndex >= 0) {
        const treeView = tree.getUnityObjectAs<NatureTreeViewContract>();
        const delta = tree.position.sub(this.position);
        // FAITHFUL: treeView is dereferenced without a null check (NRE in the
        // original when the viewer is missing).
        const view = treeView!;
        // Structure.playerDetectionRange (+0x20); distance vs range².
        if (delta.magnitude < f(view.playerDetectionRange * view.playerDetectionRange)) {
          const movement = view.getComponentPickupMovement();
          let data: HiddenPickupData | null;
          if (tree.hiddenPickupIndex === GameCoreTree.directlySetPickupDataIndex) {
            // Data lives on a HiddenTreePickup component on the tree view.
            const hidden = view.getHiddenTreePickup();
            data = hidden !== null ? hidden.hiddenPickupData : null;
          } else {
            // TS ADAPTATION: C# List indexer throws out-of-range; JS undefined
            // is treated as the data==null path.
            data = stage.pickupManager.hiddenPickupData[tree.hiddenPickupIndex] ?? null;
          }
          if (data !== null) {
            stage.pickupManager.createPickup(data, tree.position, movement);
            Events.hiddenPickupFoundEvent.invoke(
              this,
              data.type as EInventoryType,
              data.amount,
            );
          }
          tree.hiddenPickupIndex = -1;
        }
      }
    }
  }

  // DropPickup @0x4C2AB0
  // Schedules a loose-currency drop (used when the player is bumped by an
  // enemy): after 'delay' ticks, lose/drop coins and gems scaled by wave.
  dropPickup(
    delay: number,
    lossCoins: number,
    dropCoins: number,
    lossGems: number,
    dropGems: number,
    valuePerCoin = -1,
    valuePerGem = -1,
  ): void {
    this.m_isPendingLooseCoins = true;
    this.m_looseCoinsDelay = delay | 0;
    this.m_lossCoins = lossCoins | 0;
    this.m_dropCoins = dropCoins | 0;
    this.m_lossGems = lossGems | 0;
    this.m_dropGems = dropGems | 0;
    this.m_valuePerCoin = valuePerCoin | 0;
    this.m_valuePerGem = valuePerGem | 0;
  }

  // ProcessDropPickup @0x4C2670
  private processDropPickup(): void {
    if (this.m_isPendingLooseCoins) {
      this.m_looseCoinsDelay--;
      if (this.m_looseCoinsDelay === 0) {
        const inventory = GameCoreInventory.getInventoryObject();
        const waveManager =
          GameCore.instance!.firstObject<GameCoreWaveManager>(GameCoreWaveManager);
        if (inventory !== null && waveManager !== null) {
          const multiplier = (waveManager.waveCurrentIndex + 1) | 0;

          // Losses are clamped to what the player actually has, and removed
          // without counting as 'spent'.
          const coins = inventory.getAvailableInventory(this.handle, EInventoryType.Coin);
          const lossCoins = Mathf.Min(coins, (this.m_lossCoins * multiplier) | 0);
          const gems = inventory.getAvailableInventory(this.handle, EInventoryType.Gem);
          const lossGems = Mathf.Min(gems, this.m_lossGems); // FAITHFUL: gems NOT wave-scaled
          if (lossCoins > 0) {
            inventory.removeInventory(this.handle, EInventoryType.Coin, lossCoins, false);
          }
          if (lossGems > 0) {
            inventory.removeInventory(this.handle, EInventoryType.Gem, lossGems, false);
          }

          // Drops are computed from the remaining balance; the Q4 layer spawns
          // the physical pickups from playerBumpedEvent.
          const dropCoins = Mathf.Min(
            inventory.getAvailableInventory(this.handle, EInventoryType.Coin),
            (this.m_dropCoins * multiplier) | 0,
          );
          const dropGems = Mathf.Min(
            inventory.getAvailableInventory(this.handle, EInventoryType.Gem),
            this.m_dropGems,
          );
          Events.playerBumpedEvent.invoke(
            this,
            new CurrencyValueInfo(dropCoins, this.m_valuePerCoin),
            new CurrencyValueInfo(dropGems, this.m_valuePerGem),
          );
        }
        this.m_isPendingLooseCoins = false;
        this.m_lossCoins = 0;
        this.m_dropCoins = 0;
        this.m_lossGems = 0;
        this.m_dropGems = 0;
        this.m_valuePerCoin = 0; // FAITHFUL QUIRK: reset to 0, not the ctor default -1
        this.m_valuePerGem = 0;
        // FAITHFUL QUIRK: m_looseCoinsDelay is NOT reset.
      }
    }
  }

  // OnFruitPickedUp @0x4C2B00 (fruitPickedUpEvent listener)
  private onFruitPickedUp(a_player: GameCorePlayer, a_fruit: GameCoreFruit | null): void {
    if (a_player.handle.equals(this.handle) && a_player.m_heldFruitHandle.m_handle < 0) {
      const player = this.handle.getMostRecentObjectVersion<GameCorePlayer>();
      if (a_fruit !== null && player !== null) {
        player.m_heldFruitHandle = a_fruit.handle;
        const fruit = a_fruit.handle.getMostRecentObjectVersion<GameCoreFruit>();
        if (fruit !== null) {
          // INFERRED accessibility (same note as the C# reconstruction):
          // metadata lists these fields private with getters only, but the
          // binary writes them directly from here (@0x4C2Bxx).
          fruit.m_playerOwner = player.handle; // fruit +0xC0
          fruit.m_lastPlayerOwner = player.handle; // fruit +0xE0
        }
      }
    }
  }

  // OnFruitDropped @0x4C2C70 (fruitDroppedEvent listener)
  private onFruitDropped(
    a_player: GameCorePlayer,
    a_fruit: GameCoreFruit,
    a_force: Vector3,
  ): void {
    const player = this.handle.getMostRecentObjectVersion<GameCorePlayer>();
    if (a_player.handle.equals(this.handle)) {
      // FAITHFUL: C# dereferences the resolved player without a null check.
      const self = player!;
      if (a_fruit.handle.equals(self.m_heldFruitHandle)) {
        const heldFruit = self.m_heldFruitHandle.getMostRecentObjectVersion<GameCoreFruit>();
        if (heldFruit !== null) {
          heldFruit.onDrop(self, a_force);
          self.m_heldFruitHandle = GameCoreHandle.nullHandle;
        }
      }
    }
  }

  // RecreateViewer @0x4C2E80 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let view = this.getUnityObjectAs<PlayerViewContract>();
    if (view === null) {
      for (const candidate of getPlayerViews()) {
        if (candidate.playerID === this.playerId) {
          view = candidate;
          break;
        }
      }
    }
    if (view !== null) {
      view.transform.position = this.position;
    } else {
      console.error(
        `Could not find a player id=${this.playerId} for sync, loading into multiplayer games is not currently supported.`,
      );
    }
    // FAITHFUL: the original NREs here when view == null (return view.gameObject).
    return (view as PlayerViewContract).gameObject;
  }

  // DestroySelf @0x4C30B0 (virtual slot 6)
  override destroySelf(): void {
    super.destroySelf();
    Events.fruitPickedUpEvent.removeListener(
      this.m_fruitPickedUpListener,
      this.handle.m_handle,
    );
    Events.fruitDroppedEvent.removeListener(
      this.m_fruitDroppedListener,
      this.handle.m_handle,
    );
    Events.playerRemovedEvent.invoke(this);
  }
}
