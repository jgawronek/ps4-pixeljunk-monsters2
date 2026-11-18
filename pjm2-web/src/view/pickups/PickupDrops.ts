// src/view/pickups/PickupDrops.ts
// Port of the Q4 *view-layer* currency-drop logic that the reconstructed sim
// deliberately leaves out: Q4.PickupManager (TypeDefIndex ~, @0x3E38B0..0x3E5700)
// and the gem half of Q4.UI.CurrencyFlyerPool (@0x479570) / CurrencyFlyer
// (@0x479120). No THREE / DOM imports: shared verbatim by the browser game, the
// headless stage-1 runner and the tests (docs/ENEMY_DROPS_ANALYSIS.md).
//
// Original wiring (Q4.PickupManager.Start @0x3E3940 listens to four sim events):
//   enemyDestroyedEvent  (+0x40)  -> OnEnemyDestroyed @0x3E3E20
//   towerSellEvent       (+0xC8)  -> OnTowerSold      @0x3E40E0
//   playerBumpedEvent    (+0x130) -> OnPlayerBumped   @0x3E4280
//   onGemTowerPopGem     (+0x178) -> OnGemTowerBreak  @0x3E41F0
// and Q4.UI.CurrencyFlyerPool listens to pickupAcquiredEvent (+0xE0).
//
// CreateCurrency @0x3E3F50 (verified in raw disasm, signature: this, pos(xmm0,xmm1),
// type(esi), amount(edx), movement(rcx), valuePerPickup(r8d)):
//   prefab = type==1 ? GlobalResources.DebugGemPrefab : type==0 ? DebugCoinPrefab : null
//   if (prefab == null) return
//   per = valuePerPickup < 1 ? prefab.value : valuePerPickup
//   perCoin = globalCoinPerValueOverride (view +0x28) >= 1 ? that : per ; gems always `per`
//   amount/per pickups of value `per`, then one more worth amount % per (if > 0)
//   (coin prefab value 20, gem prefab value 1 -> N coins/gems; stage 1 override = 20 as well)
// OnEnemyDestroyed: position = enemy.position + up * 0.2 (b7a6c8 = 0.2f), movement =
//   enemy view GetComponent<PickupMovement>() (all 57 enemy prefabs carry one), coins first
//   (enemy.GetCoinValue), then gems (enemy.GetGemValue).
// OnTowerSold: pickups for refundCoin/refundGem at the tower, then
//   RemoveInventory(player, SpentCoins/SpentGems, refund, spent=false) — the refund is NOT
//   credited directly; the player collects it.
//
// CurrencyFlyer.UpdateLifeSpan @0x479120: the flyer's m_destinationThreshold is serialized
// 5000 (screen units), so the very first update after FlyToDestinationWithValue is already
// "within range" and issues AddInventoryCommand(player, value, Gem) — the gem is credited
// at acquire time and the HUD flight is purely cosmetic. Coins are credited by the sim
// (GameCorePickupCurrency.SuckToPlayer) and never get a flyer (type==1 gate @0x479570).

import { Vector3 } from '../../engine/math';
import { Events } from '../../core/Events';
import { EventTime } from '../../core/event/CoreEvent';
import type { CurrencyValueInfo } from '../../core/CurrencyValueInfo';
import type { GameCoreEnemy } from '../../core/GameCoreEnemy';
import { EInventoryType, GameCoreInventory } from '../../core/GameCoreInventory';
import type { GameCorePickup } from '../../core/GameCorePickup';
import { GameCorePickupCurrency } from '../../core/GameCorePickupCurrency';
import type { GameCorePlayer } from '../../core/GameCorePlayer';
import type { GameCoreTower } from '../../core/GameCoreTower';
import { AddInventoryCommand } from '../../core/network/AddInventoryCommand';
import type { NetworkCommand } from '../../core/network/NetworkCommand';
import { COIN_PREFAB, GEM_PREFAB } from '../../data/pickupPrefabs';
import {
  ENEMY_PICKUP_MOVEMENT,
  PLAYER_PICKUP_MOVEMENT,
  TOWER_PICKUP_MOVEMENT,
} from '../../data/dropData.generated';
import type {
  HiddenPickupData,
  PickupManagerContract,
  PickupMovementContract,
  PickupPrefabContract,
} from '../q4-contracts';

const f = Math.fround;

/** OnEnemyDestroyed spawn lift: Vector3.up * 0.2 (float @0xB7A6C8, raw-verified). */
export const ENEMY_DROP_LIFT = f(0.2);
/** Player prefab whose PickupMovement OnPlayerBumped reads (globalsettings bundle). */
export const PLAYER_PREFAB_NAME = 'tikiman_01';

export interface PickupDropOptions {
  /** Q4.PickupManager.globalCoinPerValueOverride (view +0x28); <1 = unset. */
  globalCoinPerValueOverride: number;
  /** GlobalResources.debugCoinPrefab / debugGemPrefab (defaults: verified prop_001 / prop_002). */
  coinPrefab?: PickupPrefabContract;
  gemPrefab?: PickupPrefabContract;
  /** SP loopback command queue (SimDriver.addPlayerCommand) — used for the gem credit. */
  issueCommand(command: NetworkCommand, player: GameCorePlayer): void;
  /** Cosmetic hook: a gem was acquired by the local player (HUD flyer). Fired BEFORE the credit. */
  onGemFlyer?(pickup: GameCorePickupCurrency, player: GameCorePlayer): void;
  /** Resolve a view-side PickupMovement override (default: the verified generated tables). */
  movementForEnemy?(prefabName: string): PickupMovementContract | null;
  movementForTower?(prefabName: string): PickupMovementContract | null;
  movementForPlayer?(): PickupMovementContract | null;
}

/** The sim keeps its prefab name in a private field (m_prefabName / prefabName). */
function privateName(obj: unknown, field: string): string {
  const v = (obj as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : '';
}

export class PickupDropManager implements PickupManagerContract {
  /** Every pickup spawned through this manager (tests / diagnostics). */
  spawned = 0;
  spawnedCoins = 0;
  spawnedGems = 0;

  // PickupManagerContract (Q4.StageHub.GetCurrentStage().pickupManager)
  hiddenPickupData: HiddenPickupData[] = [];

  private installed = false;
  private readonly coinPrefab: PickupPrefabContract;
  private readonly gemPrefab: PickupPrefabContract;

  constructor(private readonly opts: PickupDropOptions) {
    this.coinPrefab = opts.coinPrefab ?? COIN_PREFAB;
    this.gemPrefab = opts.gemPrefab ?? GEM_PREFAB;
  }

  // ---- Q4.PickupManager.Start @0x3E3940 + CurrencyFlyerPool.Start ----------------

  install(): void {
    if (this.installed) return;
    this.installed = true;
    Events.enemyDestroyedEvent.addListener(this.onEnemyDestroyed, EventTime.Immediate);
    Events.towerSellEvent.addListener(this.onTowerSold, EventTime.Immediate);
    Events.playerBumpedEvent.addListener(this.onPlayerBumped, EventTime.Immediate);
    Events.onGemTowerPopGem.addListener(this.onGemTowerBreak, EventTime.Immediate);
    Events.pickupAcquiredEvent.addListener(this.onAcquireCurrency, EventTime.Immediate);
  }

  dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    Events.enemyDestroyedEvent.removeListener(this.onEnemyDestroyed);
    Events.towerSellEvent.removeListener(this.onTowerSold);
    Events.playerBumpedEvent.removeListener(this.onPlayerBumped);
    Events.onGemTowerPopGem.removeListener(this.onGemTowerBreak);
    Events.pickupAcquiredEvent.removeListener(this.onAcquireCurrency);
  }

  // ---- OnEnemyDestroyed @0x3E3E20 -------------------------------------------------

  private readonly onEnemyDestroyed = (_tower: unknown, enemy: GameCoreEnemy | null): void => {
    if (enemy === null) return; // binary: NRE
    const pos = enemy.position.add(Vector3.up.mulScalar(ENEMY_DROP_LIFT));
    const movement = this.enemyMovement(privateName(enemy, 'm_prefabName'));
    this.createCurrency(pos, EInventoryType.Coin, enemy.getCoinValue(), movement, -1);
    this.createCurrency(pos, EInventoryType.Gem, enemy.getGemValue(), movement, -1);
  };

  // ---- OnTowerSold @0x3E40E0 -------------------------------------------------------

  private readonly onTowerSold = (
    tower: GameCoreTower | null,
    player: GameCorePlayer | null,
    refundCoin: number,
    refundGem: number,
  ): void => {
    if (tower === null) return; // binary: early-out (jumps to the stack-guard epilogue)
    const pos = tower.position.clone();
    this.createCurrency(pos, EInventoryType.Coin, refundCoin, null, -1);
    this.createCurrency(pos, EInventoryType.Gem, refundGem, null, -1);
    // RemoveInventory(player.handle, SpentCoins(3) / SpentGems(4), refund, spent: false).
    // TS ADAPTATION: the binary NREs on a null player/inventory; skip instead.
    const inventory = GameCoreInventory.getInventoryObject();
    if (player === null || inventory === null) return;
    inventory.removeInventory(player.handle, EInventoryType.SpentCoins, refundCoin, false);
    inventory.removeInventory(player.handle, EInventoryType.SpentGems, refundGem, false);
  };

  // ---- OnPlayerBumped @0x3E4280 ----------------------------------------------------

  private readonly onPlayerBumped = (
    player: GameCorePlayer | null,
    coins: CurrencyValueInfo,
    gems: CurrencyValueInfo,
  ): void => {
    if (player === null) return;
    const pos = player.position.clone();
    const movement = this.opts.movementForPlayer
      ? this.opts.movementForPlayer()
      : (PLAYER_PICKUP_MOVEMENT[PLAYER_PREFAB_NAME] ?? null);
    this.createCurrency(pos, EInventoryType.Coin, coins.total, movement, coins.perValue);
    this.createCurrency(pos, EInventoryType.Gem, gems.total, movement, gems.perValue);
  };

  // ---- OnGemTowerBreak @0x3E41F0 ---------------------------------------------------

  private readonly onGemTowerBreak = (tower: GameCoreTower | null, gems: number): void => {
    if (tower === null) return;
    const movement = this.opts.movementForTower
      ? this.opts.movementForTower(privateName(tower, 'prefabName'))
      : (TOWER_PICKUP_MOVEMENT[privateName(tower, 'prefabName')] ?? null);
    this.createCurrency(tower.position.clone(), EInventoryType.Gem, gems, movement, -1);
  };

  // ---- CurrencyFlyerPool.OnAcquireCurrency @0x479570 + CurrencyFlyer.UpdateLifeSpan @0x479120 ----

  private readonly onAcquireCurrency = (player: GameCorePlayer, pickup: GameCorePickup): void => {
    if (!player.isLocalPlayer()) return;
    if (!(pickup instanceof GameCorePickupCurrency)) return;
    if (pickup.inventoryType !== EInventoryType.Gem) return;
    this.opts.onGemFlyer?.(pickup, player);
    // threshold 5000 >= any on-screen distance -> credited immediately (see header).
    this.opts.issueCommand(
      new AddInventoryCommand(player.handle, pickup.value, EInventoryType.Gem),
      player,
    );
  };

  // ---- CreateCurrency @0x3E3F50 ----------------------------------------------------

  /**
   * @param valuePerPickup the C# `int value = -1` parameter (CurrencyValueInfo.perValue for bumps).
   * @returns the spawned pickups (the binary returns nothing useful).
   */
  createCurrency(
    position: Vector3,
    type: EInventoryType,
    amount: number,
    movement: PickupMovementContract | null,
    valuePerPickup = -1,
  ): GameCorePickupCurrency[] {
    const made: GameCorePickupCurrency[] = [];
    const prefab =
      type === EInventoryType.Gem ? this.gemPrefab : type === EInventoryType.Coin ? this.coinPrefab : null;
    if (prefab === null) return made;

    let per = valuePerPickup | 0;
    if (per < 1) per = (prefab.value ?? 1) | 0;
    let perPickup = this.opts.globalCoinPerValueOverride | 0;
    if (perPickup < 1) perPickup = per;
    if (type !== EInventoryType.Coin) perPickup = per;
    if (perPickup === 0) throw new Error('DivideByZeroException (PickupManager.CreateCurrency)');

    const amt = amount | 0;
    const count = Math.trunc(amt / perPickup);
    for (let i = 0; i < count; i++) made.push(this.spawnOne(position, type, perPickup, movement, prefab));
    const rest = amt % perPickup; // C# remainder keeps the dividend's sign
    if (rest > 0) made.push(this.spawnOne(position, type, rest, movement, prefab));
    return made;
  }

  // CreatePickup(type, value, movement) @0x3E5520
  private spawnOne(
    position: Vector3,
    type: EInventoryType,
    value: number,
    movement: PickupMovementContract | null,
    prefab: PickupPrefabContract,
  ): GameCorePickupCurrency {
    const pickup = new GameCorePickupCurrency(prefab, position.clone(), type, value, movement);
    this.spawned++;
    if (type === EInventoryType.Gem) this.spawnedGems++;
    else this.spawnedCoins++;
    return pickup;
  }

  // ---- PickupManagerContract.createPickup  (HiddenPickupData) @0x3E51C0 ------------

  createPickup(
    data: HiddenPickupData,
    position: { x: number; y: number; z: number },
    movement: PickupMovementContract | null,
  ): unknown {
    const o = this.opts.globalCoinPerValueOverride | 0;
    // ~-(type==0) | override  ->  type==0 ? override : -1 ; override < 1 -> -1
    const perValue = o < 1 ? -1 : data.type === 0 ? o : -1;
    this.createCurrency(
      new Vector3(position.x, position.y, position.z),
      data.type as EInventoryType,
      data.amount,
      movement,
      perValue,
    );
    // Fruit half (amountFruit > 0 && fruit prefab): needs the Q4 fruit prefab contracts —
    // not wired in the web port (docs/ENEMY_DROPS_ANALYSIS.md, "Not ported").
    return null;
  }

  // ---- resolvers ---------------------------------------------------------------------

  private enemyMovement(name: string): PickupMovementContract | null {
    if (this.opts.movementForEnemy) return this.opts.movementForEnemy(name);
    return ENEMY_PICKUP_MOVEMENT[name] ?? null;
  }
}
