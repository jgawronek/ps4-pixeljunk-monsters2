// src/core/GameCoreInventory.ts
// TypeScript port of decomp/src/GameCore/GameCoreInventory.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; methods @0x4BD1E0..0x4BEAF0,
// nested InventoryBag @0x4BD8C0..0x4BE160; nested types EInventoryType /
// InventoryBag = dump.cs TypeDefIndex 3044/3045).
//
// Per-player currency wallets. playerInventory maps playerId → bag;
// clientInventory is the shared/predicted copy: in single-player (non-network
// match) ALL players share the bag stored under key 0, while playerInventory
// keeps per-player references to it. Wave end grants interest coins
// (waveClearCoinRate).
//
// TS ADAPTATIONS (documented):
//  - C# nested EInventoryType → exported alongside the class (import path
//    './GameCoreInventory' for both).
//  - C# out-params on GetEndOfGameStatistics → result objects; the two C#
//    overloads collapse into one method with an optional playerId.
//  - NetworkLog.Instance.Log is called null-safely (SP ships no instance; the
//    binary's null path is the observable behavior).
//  - Instance-method event listener → bound arrow field (C# delegate target
//    equality = same method + same instance; TS = same function reference,
//    registered with the owner's handleId for the ListenerSorter).

import { Mathf } from '../engine/math';
import { getCurrentStage, NetworkMatch } from '../view/q4-contracts';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import { NetworkLog } from './NetworkLog';

const f = Math.fround;

/** C#: GameCoreInventory.EInventoryType — TypeDefIndex 3044. */
export enum EInventoryType {
  Coin = 0,
  Gem = 1,
  InterestCoins = 2,
  SpentCoins = 3,
  SpentGems = 4,
}

/** C#: Enum.GetValues(typeof(EInventoryType)).Cast<int>().Max() = SpentGems. */
const INVENTORY_TYPE_MAX = 4;

/** C#: GameCoreInventory.InventoryBag (private nested, TypeDefIndex 3045).
 *  Lazy int[] sized to the largest enum value + 1 (null until first SetValue). */
class InventoryBag {
  private values: Int32Array | null = null; // 0x10

  // .ctor @0x4BD8C0 — default ctor, values stays null.
  constructor() {}

  // SetValue @0x4BD8D0
  setValue(type: EInventoryType, value: number): void {
    if (this.values === null) {
      this.values = new Int32Array(INVENTORY_TYPE_MAX + 1);
    }
    this.values[type] = value | 0;
  }

  // GetValue @0x4BE140
  getValue(type: EInventoryType): number {
    if (this.values === null) return 0;
    return this.values[type];
  }
}

export class GameCoreInventory extends GameCoreObject {
  // [CoreObjectPool.DeepCopyAttribute] in C# — deep-copied on frame clones.
  private playerInventory = new Map<number, InventoryBag>(); // 0x60
  // [CoreObjectPool.DeepCopyAttribute]
  private clientInventory = new Map<number, InventoryBag>(); // 0x68
  private m_waveClearCoinRate = f(1.0); // 0x70 (pre-base initializer)

  /** Bound listener — C# delegate (method + target) equality stand-in. */
  private readonly m_onWaveEndedListener = (
    manager: GameCoreWaveManager,
    waveIndex: number,
  ): void => this.onWaveEnded(manager, waveIndex);

  // .ctor @0x4BD300 (private)
  private constructor() {
    super();
    // Wave interest is applied after the sim tick (EventTime 1).
    Events.waveEndedEvent.addListener(
      this.m_onWaveEndedListener,
      EventTime.PostGameCoreTick,
      this.handle.m_handle,
    );
  }

  // GetInventoryObject @0x4BD300
  // Lazily creates the singleton inventory (registered with the current frame
  // by the GameCoreObject ctor) and seeds bags for existing players.
  static getInventoryObject(): GameCoreInventory | null {
    // C# NREs without a GameCore instance — faithful via non-null assertion.
    let inventory = GameCore.instance!.firstObject<GameCoreInventory>(GameCoreInventory);
    if (inventory === null) {
      console.info(
        'Creating GameCoreInventory object. Please verify we are in a game core safe context.',
      );
      inventory = new GameCoreInventory();

      let rate = f(0.0);
      const stage = getCurrentStage(); // C#: Q4.StageMain.CurrentStage
      if (stage !== null) rate = f(stage.initWaveCoinRate);
      inventory.m_waveClearCoinRate = rate;

      for (const player of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
        inventory.getBagForPlayer(player.playerId);
      }
    }
    return inventory.handle.getMostRecentObjectVersion<GameCoreInventory>();
  }

  // GetBagForPlayer @0x4BD6C0
  private getBagForPlayer(playerId: number): InventoryBag {
    let bag = this.playerInventory.get(playerId);
    if (bag === undefined) {
      // Network match: per-player client bag. Single-player: everyone shares
      // the bag under key 0.
      const clientKey = NetworkMatch.isNetworkMatch ? playerId : 0;
      bag = this.clientInventory.get(clientKey);
      if (bag === undefined) {
        bag = new InventoryBag();
        const stage = getCurrentStage(); // C#: Q4.StageMain.CurrentStage
        if (stage !== null) {
          bag.setValue(EInventoryType.Coin, stage.initCoin | 0);
          bag.setValue(EInventoryType.Gem, stage.initGem | 0);
        }
        this.clientInventory.set(clientKey, bag);
      }
      this.playerInventory.set(playerId, bag);
    }
    return bag;
  }

  // DestroySelf @0x4BD9E0 (virtual slot 6)
  override destroySelf(): void {
    super.destroySelf();
    Events.waveEndedEvent.removeListener(
      this.m_onWaveEndedListener,
      this.handle.m_handle,
    );
  }

  // OnWaveEnded @0x4BDAD0
  // Interest: round(coins * waveClearCoinRate) - coins (banker's rounding —
  // engine RoundToInt), granted as both Coin and InterestCoins. Shared bags are
  // processed once (HashSet dedup).
  onWaveEnded(_manager: GameCoreWaveManager, _waveIndex: number): void {
    const processed = new Set<InventoryBag>();
    for (const [playerId, bag] of this.playerInventory) {
      if (!processed.has(bag)) {
        processed.add(bag);
        const player = GameCorePlayer.getPlayer(playerId);
        if (player !== null) {
          const coins = bag.getValue(EInventoryType.Coin);
          const newCoins = Mathf.RoundToInt(f(coins * this.m_waveClearCoinRate));
          const interest = (newCoins - coins) | 0;
          if (interest !== 0 && coins <= newCoins) {
            const inventory = this.handle.getMostRecentObjectVersion<GameCoreInventory>();
            // C# dereferences the resolved version without a null check.
            inventory!.addInventory(player.handle, EInventoryType.Coin, interest);
            inventory!.addInventory(player.handle, EInventoryType.InterestCoins, interest);
          }
        }
      }
    }
  }

  // AddInventory @0x4BE160
  addInventory(player: GameCoreHandle, type: EInventoryType, amount: number): void {
    const playerObject = player.getMostRecentObjectVersion<GameCorePlayer>();
    if (playerObject === null) return;
    const bag = this.getBagForPlayer(playerObject.playerId);
    const current = bag.getValue(type);
    NetworkLog.instance?.log(
      `Adding inventory ${EInventoryType[type]}`,
      (current + amount) | 0,
      true,
    );
    bag.setValue(type, (current + amount) | 0);
    Events.onAddInventory.invoke(playerObject, this, type, amount);
  }

  // RemoveInventory @0x4BE460
  // Clamps at 0; 'spent' additionally accumulates SpentCoins/SpentGems stats.
  removeInventory(
    player: GameCoreHandle,
    type: EInventoryType,
    amount: number,
    spent = true,
  ): void {
    const playerObject = player.getMostRecentObjectVersion<GameCorePlayer>();
    if (playerObject === null) return;
    const bag = this.getBagForPlayer(playerObject.playerId);
    const current = bag.getValue(type);
    const newValue = Mathf.Max(0, (current - amount) | 0);
    NetworkLog.instance?.log(
      `Removing inventory ${EInventoryType[type]}`,
      newValue,
      true,
    );
    bag.setValue(type, newValue);
    Events.onRemoveInventory.invoke(playerObject, this, type, amount);
    if (spent) {
      // FAITHFUL QUIRK: C# computes 4 - (type == Coin ? 1 : 0) — ANY non-Coin
      // type (Gem, but also InterestCoins/Spent*) accumulates into SpentGems.
      const spentType =
        type === EInventoryType.Coin ? EInventoryType.SpentCoins : EInventoryType.SpentGems;
      bag.setValue(spentType, (bag.getValue(spentType) + amount) | 0);
    }
  }

  // HasInventory @0x4BE680
  hasInventory(player: GameCoreHandle, type: EInventoryType, amount: number): boolean {
    const playerObject = player.getMostRecentObjectVersion<GameCorePlayer>();
    if (playerObject === null) return false;
    return amount <= this.getBagForPlayer(playerObject.playerId).getValue(type);
  }

  // GetAvailableInventory @0x4BE740
  getAvailableInventory(player: GameCoreHandle, type: EInventoryType): number {
    const playerObject = player.getMostRecentObjectVersion<GameCorePlayer>();
    if (playerObject === null) return 0;
    return this.getBagForPlayer(playerObject.playerId).getValue(type);
  }

  // GetEndOfGameStatistics @0x4BE7C0 (totals across distinct bags) and
  // @0x4BEA80 (per-player overload) — TS ADAPTATION: one method, optional
  // playerId; C# out-params → result object.
  // Totals: coins = Coin - InterestCoins + SpentCoins (earned coins, incl.
  // spent), gems = Gem + SpentGems.
  getEndOfGameStatistics(playerId?: number): {
    totalCoinsAcquired: number;
    totalGemsAcquired: number;
    totalInterestCoinsAcquired: number;
  } {
    if (playerId !== undefined) {
      // Per-player overload @0x4BEA80.
      const bag = this.getBagForPlayer(playerId);
      const interest = bag.getValue(EInventoryType.InterestCoins);
      return {
        totalCoinsAcquired:
          (bag.getValue(EInventoryType.Coin) +
            bag.getValue(EInventoryType.SpentCoins) -
            interest) |
          0,
        totalGemsAcquired:
          (bag.getValue(EInventoryType.Gem) + bag.getValue(EInventoryType.SpentGems)) | 0,
        totalInterestCoinsAcquired: interest,
      };
    }
    let totalCoinsAcquired = 0;
    let totalGemsAcquired = 0;
    let totalInterestCoinsAcquired = 0;
    const processed = new Set<InventoryBag>();
    for (const [key, bag0] of this.playerInventory) {
      if (!processed.has(bag0)) {
        processed.add(bag0);
        const bag = this.getBagForPlayer(key);
        const interest = bag.getValue(EInventoryType.InterestCoins);
        const coins =
          (bag.getValue(EInventoryType.Coin) - interest + bag.getValue(EInventoryType.SpentCoins)) | 0;
        const gems = (bag.getValue(EInventoryType.Gem) + bag.getValue(EInventoryType.SpentGems)) | 0;
        totalCoinsAcquired += coins;
        totalGemsAcquired += gems;
        totalInterestCoinsAcquired += interest;
      }
    }
    return { totalCoinsAcquired, totalGemsAcquired, totalInterestCoinsAcquired };
  }
}
