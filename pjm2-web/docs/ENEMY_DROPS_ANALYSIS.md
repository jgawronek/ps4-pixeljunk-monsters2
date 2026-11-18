# Enemy drops (coins / gems) — original behaviour and the port

Scope: what PixelJunk Monsters 2 does when a monster dies (and for the other currency sources that share the
same machinery): who spawns what, how many, with which launch/bounce/collect parameters, how collection and the
HUD gem flight work. Sources: decompiled IL2CPP (`decomp/decompiled/Q4.PickupManager.c`, `Q4.PickupCurrency.c`,
`Q4.Pickup.c`, `Q4.UI.CurrencyFlyer*.c`, `GameCore.GameCorePickup*.c`), checked against **raw x86-64 disassembly**
of `Media/Modules/Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000, `objdump -b binary -m i386:x86-64 -M intel
-D --adjust-vma=<vaddr>`) wherever Ghidra's pseudo-C was ambiguous, and the serialized prefabs/scenes in the
AssetBundles (UnityPy, `tools/data/extract_drop_data.py`). Addresses are `Il2CppUserAssemblies` vaddrs.

## 0. What was wrong (root cause)

The reconstructed sim (`GameCorePickup*`, `GameCoreInventory`, `GameCorePlayer.CheckForPickups`) was complete, but the
whole **Q4 view layer that creates the pickups** (`Q4.PickupManager`) was never ported: its job was stood in for by a
"harness seam" in `headless-stage1.ts` and `game.ts`:

```
enemyDestroyedEvent -> new GameCorePickupCurrency(fakePrefab, enemy.position, type, enemy.getCoinValue())
fakePrefab = { detectRange 0.5, detectDelay 0.5, value 1, lifespan 20, movement null, 0.3^3 bounds }
```

Measured on the headless stage-1 run before the fix (86 kills): 50 kills carried coins (sum 972, max 250) and 8 carried
one gem; the harness made **one lump pickup per kill** (a 250-coin boss = one coin), at the enemy's feet (no `+0.2` lift),
with **no scatter** (`movement == null` → zero launch velocity), the wrong radius (0.5 vs 1.8 coin / 2.4 gem), the wrong
lifetime (20 s vs 42.9 / 57.2) and **gems were never credited**: the sim deliberately leaves the gem credit to the Q4
`CurrencyFlyer` (see §3), so `gems held` stayed 0 although 8 gems dropped (`GameCorePickupCurrency.SuckToPlayer`:
`if (type != Gem) AddInventory`). In the browser the same fake prefab was used, so coins dropped as tiny, unscattered,
short-lived specks that sink into the ground; tower sells credited the refund instantly instead of dropping coins.

Also: with a null physics seam (headless) every ballistic pickup falls forever — below y = -20 the lifespan field is
reset to 0.1 every tick but counted from a fresh local 0.1 (`GameCorePickup.TickLifeSpan` @0x4BFBE0 quirk, already
documented), so nothing ever expires and the bot chases coins that are falling to infinity.

## 1. How the original works

### 1.1 Who creates drops — `Q4.PickupManager.Start` @0x3E3940

A scene MonoBehaviour (one per stage scene; holds `globalCoinPerValueOverride` (+0x28), `maximumFruitsOnGround` (+0x2C),
`hiddenFruitData`, `hiddenPickupData`, tree groups). `Start` subscribes four sim events:

| Sim event (Events slot) | Handler | Effect |
|---|---|---|
| `enemyDestroyedEvent` (+0x40) | `OnEnemyDestroyed` @0x3E3E20 | enemy kill drops (coins, then gems) |
| `towerSellEvent` (+0xC8) | `OnTowerSold` @0x3E40E0 | sell refund as **pickups** + `RemoveInventory(SpentCoins/SpentGems)` |
| `playerBumpedEvent` (+0x130) | `OnPlayerBumped` @0x3E4280 | loose coins/gems dropped when the player is bumped/damaged |
| `onGemTowerPopGem` (+0x178) | `OnGemTowerBreak` @0x3E41F0 | gem towers popping their gems |

(+ a UnityEvent for stage load → `AddRandom/FixedHiddenPickups` @0x3E43C0/@0x3E4840/@0x3E4A10, the hidden tree pickups.)
Enemies drop **only coins and gems** — there are no fruit/buff/other item drops from monsters. Fruit comes from trees
(`GameCorePickupManager.UpdateFruitDrops`, the scheduled `hiddenFruitData`, all empty in the shipped stages) and from
hidden tree pickups (`HiddenPickupData`: type/amount + `fruit`/`amountFruit`).

### 1.2 `OnEnemyDestroyed` @0x3E3E20 (raw disasm verified)

```
pos      = enemy.position + Vector3.up * 0.2f                 // float @0xB7A6C8 = 0.2
movement = enemyGO.GetComponent<PickupMovement>()            // GetComponent<PickupMovement> via template @0x10D50F0
CreateCurrency(pos, type 0 /*coin*/, enemy.GetCoinValue(), movement, valuePerPickup = -1)
CreateCurrency(pos, type 1 /*gem */, enemy.GetGemValue(),  movement, -1)
```
(`rdi=this, xmm0/1=pos, esi=type, edx=amount, rcx=movement, r8d=0xFFFFFFFF`.) The enemy's `m_coinValue/m_gemValue` are
set at spawn from the wave's money/gem arrays (`GameCoreWaveManager.CreateWaveProgress`/`distributeCurrency`, already
ported: `totalMoney/totalGem` per wave and difficulty, a flat per-enemy `money/gem` floor, the remainder sprinkled over
random enemies — so most enemies drop nothing and a few drop a lot: stage 1 wave 10's lone boss carries 250).

### 1.3 `CreateCurrency` @0x3E3F50 — splitting into pickups (raw verified)

```
prefab = type==1 ? GlobalResources.DebugGemPrefab : type==0 ? GlobalResources.DebugCoinPrefab : null ; if null return
per    = valuePerPickup < 1 ? prefab.value : valuePerPickup          // prefab PickupCurrency.value (+0x3C)
perPk  = this.globalCoinPerValueOverride >= 1 ? override : per        // (+0x28)
if (type != 0) perPk = per                                            // gems ignore the coin override
n  = amount / perPk   -> n  pickups of value perPk ;  r = amount % perPk -> one more pickup of value r (if r > 0)
```
Prefabs: **coin `prop_001`: value 20**, gem `prop_002`: value 1 → a 250-coin drop is 12 × 20 + 1 × 10 (13 coins),
3 gems are 3 × 1. Stage-1 override is 20 (same as the prefab), every other stage has 0 (unset → prefab value 20), so
coin pickups are always worth 20 (the last one less). `CreatePickup(type, value, movement)` @0x3E5520 =
`new GameCorePickupCurrency(prefab, pos, type, value, movement)` (the sim then applies
`DifficultySettings.ValueCoinByDifficulty` = `Max(1, ...)`, rates 1.0 in single player).

### 1.4 Launch / bounce / magnet (sim, already ported; parameters are serialized `Q4.PickupMovement`)

`GameCorePickup..ctor` @0x4BEFB0: `v = up * Random.Range(appearForceMin, appearForceMax)`, rotated by
`AngleAxis(appearRangeAngle, normalize(Random(-1,1), 0, Random(-1,1)))` (draw order force, x, z), `acceleration`,
`bouncingRate`, `bounceTime` copied. The **movement used is the one passed by the caller** (the enemy's own
`PickupMovement`), falling back to the pickup prefab's. Per tick (`GameCorePickupCurrency.UpdatePosition` @0x4C0180):
gravity, `SphereCast(radius = 0.475*cylinder height, TerrainMask)`, reflect with `factor*bouncingRate`, at rest when
speed < 0.5. Lifespan: `Q4.PickupLifeCycle.lifespan` (coin 42.9 s, gem 57.2 s; flash-before-despawn toggles an
`UIHelpBar` child the currency prefabs do not have → no visible blink). Water: `CheckSphere(WaterMask)` →
`remainingLifespan = min(.., AISettings.PickupWaterKillTime = 5.0)` + `GlobalSounds.ItemLostInWater`
(`sfx_item_splash`), `ItemDieInWater` (`sfx_item_disintegrate`) on destroy while in water.

Collection: `GameCorePlayer.CheckForPickups` @0x4C1C40 queries a 4×4 cylinder around the player and calls
`pickup.Pickup(player)` when `|delta| < detectRange²` (distance vs range *squared*: coin 1.8 → 3.24 u, gem 2.4 →
5.76 u — faithful quirk) and the `detectDelay` (coin 1.5 s, gem 0.5 s) elapsed; the pickup becomes immortal and
`SuckToPlayer` accelerates it (`acceleration` of the movement: 12 for most enemies, 100 for bump drops) to
`player + attractOffset (0,0.5,0)`; on arrival `pickupAcquiredEvent` fires and **coins** are credited by the sim,
**gems are not** (§3).

### 1.5 View side of a pickup (`Q4.Pickup`, `Q4.PickupCurrency`)

* `Q4.Pickup.Update` @0x3E2850: transform = sim position every frame. `Q4.PickupCurrency.Update` @0x3E2A30: yaw spin
  `Rotate(up * rotateSpeed (-180°/s) * dt)`, `Awake` random initial yaw 0..180°.
* **Acquire** (`OnPickupAcquired` @0x3E2DB0, listens `pickupAcquiredEvent` at EventTime 2): sound
  `collectSound` (coin `sfx_item_coin`, gem `sfx_item_gem`) + `acquireEffect` (coin: **none**; gem:
  `ef_item_jem_pickup_pv` = `ps_item_jem_pickup_spark`), destroy the GO.
* **Lost** (`OnPickupLost` @0x3E2FF0, lifespan expiry / water): `disappearEffect` (coin `ef_item_coin_vanish_pv` =
  `ps_item_coin_vanish` + `ps_item_coin_vanish_spark`; gem `ef_item_jem_vanish_pv` = `ps_item_jem_vanish`(+`_small`) +
  `ps_item_jem_vanish_spark`), destroy the GO. (The port previously played the vanish spark on *acquire* — wrong.)
* No spawn sound for enemy drops. (`GlobalSounds.HiddenPickupFound` = `sfx_item_drops` is only for hidden tree pickups.)

## 2. Serialized per-source drop data

`Q4.PickupMovement` is the only serialized "per-enemy drop" datum; **all 57 enemy logic prefabs carry one** (they are
identical except the cone/force/accel), plus `tower_005` (structures bundle) and `tikiman_01` (globalsettings). Extracted by
`tools/data/extract_drop_data.py` → `src/data/dropData.generated.ts` (`ENEMY_PICKUP_MOVEMENT`, `TOWER_PICKUP_MOVEMENT`,
`PLAYER_PICKUP_MOVEMENT`, `STAGE_PICKUP_MANAGERS`). `rotateSpeed` −180 and `rotateSpeedVariation` 0 everywhere,
`bouncingRate` 0.3, `bounceTime` −1 (unlimited), `attractOffset` (0, 0.5, 0) everywhere unless noted.

| Enemy prefabs (57) | appearForce | appearRangeAngle | acceleration |
|---|---|---|---|
| `kuri_00..07_001` (8), `giant_00..07_001` (8), all 21 bosses `boss_{bero,fat,kao,ude}_NN` | 5.0 – 7.5 | 9.5° | 12 |
| `cisors_00..06_001` (7), `spider_00..07_001` (8) | 5.0 – 7.5 | 12.0° | 12 |
| `bat_00_001`, `bat_00_001_lessJoints` | 5.0 – 7.5 | 17.0° | 12 |
| `kurukuru_00_001`, `kurukuru_07_001` | **3.0 – 5.5** | 17.0° | 12 |
| `bee_00_001` | 5.0 – 7.5 | **30.0°** | **10** |
| *others for reference* `tikiman_01` (player bump) | 5.0 – 7.5 | 30.5° | **100** |
| `tower_005` (gem tower pop; other towers have none → prefab default) | 4.8 – 7.2 | 0° | 2, bouncingRate **0** |
| pickup prefab defaults: coin `prop_001` | 4.0 – 5.5 | 17.8° | 12 |
| gem `prop_002` | 5.0 – 7.5 | 30° | 10 |

Amounts are NOT per enemy type: they come from `WaveResource` (`totalMoney/totalGem[diff]` per wave, flat
`money/gem[diff]` floor) → `GameCoreWaveManager.distributeCurrency`. Stage-1 (Medium) observed over the full headless
playthrough (deterministic, `npm run sim:stage1`): `kuri_00_001` ×70 kills (380 coins, 6 gems, max 20),
`spider_00_001` ×13 (127 coins, 1 gem), `giant_00_001` ×12 (300 coins, 2 gems, max 75), `boss_bero_00` ×1 (250 coins).

Stage `PickupManager` records (all 17 scenes, `STAGE_PICKUP_MANAGERS`): `globalCoinPerValueOverride` = 20 only in
`3d_stage_001` (and the `fps_check` copy), 0 elsewhere; `maximumFruitsOnGround` 3; `hiddenFruitData` empty in all;
`hiddenPickupData`: stage 6 = one fruit entry (type 1, amount 0, `amountFruit` 1), `fps_check_3d_stage_001` = 3×50 coins
+ 1 gem, all others empty (hidden tree pickups are mostly `HiddenTreePickup` components on the trees themselves).

## 3. Gems and the HUD flyer — `Q4.UI.CurrencyFlyerPool` / `CurrencyFlyer`

* `CurrencyFlyerPool.OnAcquireCurrency` @0x479570 (listens `pickupAcquiredEvent`): only for the **local player**, a
  `GameCorePickupCurrency` whose `InventoryType == 1` (**gem**) — coins never get a flyer (they tick the HUD counter via the
  sim credit). It takes a pooled `Gem_Icon_GRP` (`initialPoolSize` 5; sprite `icon_result_jem`) and calls
  `FlyToDestinationWithValue(dest = HUD gem counter, value, type, player handle)`.
* `CurrencyFlyer.UpdateLifeSpan` @0x479120: once `Vector2.Distance(pos, dest) <= m_destinationThreshold` (**serialized
  5000**, i.e. true on the very first update) it queues `new AddInventoryCommand(playerHandle, value, type)` through
  `GameCoreBridge.m_networkBridge.AddPlayerCommand` (once) — the **gem credit**. The flight is therefore cosmetic:
  `total = Random.Range(0.8, 1.2)`, `p = 1 − remaining/total`, path `start + (flag ? (dx(1−cos(pπ/2)), dy p³) : (dx p³,
  dy(1−cos(pπ/2))))` (`UpdatePosition` @0x478F70; the callee @0x178 is `cos` — only reading that ends on `dest`), then
  trigger `OnHit` and deactivate 1 s later (`OnHitFinish`).
* Before this change **gems were never credited** in our game.

## 4. Other currency sources (same machinery)

* **Tower sold** (`OnTowerSold` @0x3E40E0): `CreateCurrency(tower.position, coin, refundCoin, null, -1)` and the gem
  twin, then `RemoveInventory(player, SpentCoins(3), refundCoin, false)` / `SpentGems(4)` — the refund is **not**
  credited; it drops as pickups the player collects. (Ours credited it instantly through an `AddInventoryCommand`.)
* **Player bumped** (`OnPlayerBumped` @0x3E4280, from `GameCorePlayer.ProcessDropPickup`'s `playerBumpedEvent`):
  at `player.position`, movement = the player GO's `PickupMovement` (`tikiman_01`), amount/`valuePerPickup` from the
  `CurrencyValueInfo` structs (stage-1 override 20 beats a per-value; other stages use the per-value).
* **Gem tower pop** (`OnGemTowerBreak` @0x3E41F0, `TowerStateBroken`/`TowerStateUpgradeAround`): gems at the tower with
  the tower GO's `PickupMovement` (`tower_005` only; others fall back to the gem prefab's).
* **Hidden tree pickups** (`GameCorePlayer.CheckForHiddenTreePickups` → `stage.pickupManager.CreatePickup(HiddenPickupData…)`
  @0x3E51C0): `CreateCurrency(data.type, data.amount, movement, type==0 ? override : -1)`, then `amountFruit` fruits.

## 5. What the port does now

| Piece | File |
|---|---|
| `Q4.PickupManager` + `CurrencyFlyerPool` logic (headless-safe, no THREE/DOM) | `src/view/pickups/PickupDrops.ts` (`PickupDropManager`) |
| Serialized per-enemy/tower/player `PickupMovement` + stage records (re-runnable extractor) | `tools/data/extract_drop_data.py` → `src/data/dropData.generated.ts` |
| Real coin/gem prefabs (value/detect/lifespan/movement/bounds), already extracted | `src/data/pickupPrefabs.ts` |
| Gem HUD flyer (cosmetic) | `src/view/ui/CurrencyFlyers.ts` (`CurrencyFlyerLayer`) |
| Browser wiring (replaces the fake-prefab seam; acquire/lost effects fixed; flyer) | `src/main/game.ts` (`wireOutcome`, `wireParticles`, frame loop) |
| Headless wiring (real prefabs; `sphereCast(terrainMask)` against the real Rapier stage world) | `src/main/headless-stage1.ts` |
| Tower-sell refund no longer credited instantly | `src/view/tower/TowerLevelFeature.ts` |
| Tests | `tests/view/pickupDrops.test.ts` (15) |

Coin/gem GLBs (`public/assets/pickups/{coin_001,gem_001}.glb`, `tools/assets/extract_pickups.py`) and `PickupView` already
existed and render the sim pickups (spin −180°/s, random initial yaw) — nothing else needed extracting: enemies drop only
these two item types.

### Results (headless `npm run sim:stage1`, deterministic)

|  | before | after |
|---|---|---|
| pickups spawned | 58 (1 per carrying kill) | 76 coin + 9 gem |
| collected by the bot | 114 coins held at end, gems 0 | 474 coins + 5 gems collected, gems held 5, 33 expired (42.9 s lifespan) |
| ground | none (fell forever) | real terrain bounce |
| replay hash | `0x27227819f56d94ad` | **`0x61889fae2ea828f1`** (intentional: drops/gem credit are part of the sim now) |

## 6. Not ported / unverified

* Hidden tree pickups (`HiddenTreePickup` components, `AddRandomHiddenPickups`) and the fruit half of
  `CreatePickup(HiddenPickupData)`: the Q4 tree/fruit view contracts are not wired in the browser (`StageHub` provider is
  deliberately left unregistered — registering it without tree views would NRE in `CheckForHiddenTreePickups`).
  `PickupDropManager.createPickup` implements the currency half.
* Water: headless keeps `checkSphere` = false (no river in the null seam); the browser uses the real queries.
* `Q4.PickupLifeCycle.Flash` (blink before despawn) is a visual no-op for coins/gems (no `UIHelpBar` child); not reproduced.
* The post-arrival `OnHit` animator of the flyer (`Gem_Icon_GRP` Animator) is approximated by a 1 s fade at the HUD plank.
* The `thunk @0x178 = cos` reading is inferred from geometry (endpoint on `dest`), not from the thunk's body.
