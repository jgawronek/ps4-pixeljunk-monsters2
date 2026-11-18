# Tower level and upgrade: how the original works, and what the port does

Evidence: decompiled Q4 / GameCore code (`decomp/decompiled/*.c`, addresses are
Ghidra vaddrs, file offset = vaddr + 0x4000 in `Media/Modules/Il2CppUserAssemblies.elf`),
serialized data from the AssetBundles, and x86-64 disassembly for the critical
function (`TowerUpgrade.ApplyUpgrade`).

## 1. Level storage and data

* Sim: `GameCoreTower.m_currentLevel` (0x128, starts 1), `m_currentEXP` (0x12C). The level is
  NOT derived from EXP in the sim: `GrantEXP @0x4D0900` adds EXP and, when
  `EXP >= GetNextUpgrade().reachExp`, calls `UpgradeTower @0x4D0E70`, which asks the view
  component `Q4.TowerUpgradeSetting` to write the stats and returns the new level
  (`ref int`). `GetNextUpgrade == null` (no row for level+1) is max level; GrantEXP then returns.
* View data: `Q4.TowerUpgradeSetting<T>` (`structures_TowerUpgradeSettingGeneric.json`, one list
  per tower prefab, rows Lv2..Lv5; Ice/Hive/Motor variants add extra columns).
  `GetUpgrade(level)` @0x7757B0 = linear search by `level`; `GetCurrentUpgrade` = level,
  `GetNextUpgrade` = level+1 (@0x7759B0 / @0x775A10); `UpgradeTower` @0x775A60 = row = next;
  `row.ApplyUpgrade(tower)`; `*level = row.level`.
* `Q4.TowerUpgrade` row (TypeDefIndex 3420): level 0x10, flagPrefab 0x18, reachExp 0x20,
  costCoin 0x24, costGem 0x28, refundCoin 0x2C, refundGem 0x30, attackPower 0x34,
  attackSpeed 0x38, attackRangeInner 0x3C, attackRangeScale 0x40, affectRangeRate 0x44,
  attackSpread 0x48, burstCount 0x4C, burstInterval 0x50.
* `ApplyUpgrade @0x473B00` (disassembly verified, file 0x477B00): only if
  `tower.currentLevel < row.level`; copies cost (tower 0x80/0x84 = row 0x24/0x28), refund
  (0x94/0x98 = 0x2C/0x30), attackPower 0x70 = 0x34, attackSpeed 0x74 = 0x38, attackRangeInner
  0x78 = 0x3C, `detector.Upgrade(row 0x40, row 0x44)`, attackSpread 0x7C = 0x48, burstCount
  0x8C = 0x4C, burstInterval 0x90 = 0x50. It does not touch the level.
* tower_001 (Arrow) table: Lv2 reachExp 100 / gem 1 / power 250; Lv3 287 / 1 / 300;
  Lv4 568 / 2 / 420; Lv5 1037 / 3 / 660 (speed 6.25, range scale 1.0, spread 3.3, coin cost 0
  everywhere, refundCoin 90, refundGem 0/0/1/2). Base: build 120 coins, refund 90. All 8 towers
  with tables are in `public/assets/data/tower-upgrades.json`
  (`tools/data/export_tower_upgrades.py`).

## 2. How EXP is earned (this is what raises the level)

1. Kills: `GameCoreTower.OnEnemyDestroy @0x4D07F0` banks `EnemyBase.expValue` (10 for stage-1
   enemies) on the killing tower (already ported).
2. The tikiman "dance": `Q4.Player.CheckForTowers @0x3E9670`. Constants read from the ELF
   rodata: search radius 5.0 / height 1.0, still epsilon 0.001, dance start at IdleTime 0.75.
   Player prefab values (globalsettings MonoBehaviour 2514285418080110840): idle 1.5 s,
   cooldown 0, interval 0.1 s, amount 0.612. The player must stand still next to the tower
   (the tower is the player's nearest selection, state not Build/Degenerate, next upgrade
   exists). After 1.125 s DanceState becomes 2 and every 0.1 s
   `TowerXPCommand(tower, DanceEXPByDifficulty(0.612))` is queued (Medium rate 1.0, so about
   6.1 EXP/s; Lv2 after about 16 s of dancing).
3. Gem projectile aura (`TowerStateUpgradeAround`, already in the sim port).
4. Paid shortcut (below): `UpgradeTowerCommand` tops EXP up to the next `reachExp`.

## 3. How the player upgrades or sells

* Selection: walking into a structure's PlayerTrigger (radius = Structure 0x20 =
  `playerDetectionRange`, 1.5 for towers) adds it to `PlayerStructureSelector`
  (`Structure.OnPlayerEnter @0x535BE0`); `PlayerInteraction.Update @0x3EE7A0` hovers the ring
  (`TowerBuildRingController.EnterHover`, "button prompt" state `RingStateEvolveButtonShow`).
* Input: one press of the `interact` action (`PlayerController.ReceiveActionInput @0x3EE370`:
  fruit, then interaction objects, otherwise the nearest selection's `OnInteraction`).
  `TowerBase.OnInteraction @0x54BCF0` opens `TowerBuildRingController.Show` unless the player is
  stunned or the tower is in `TowerStateBuild`. Press, not hold. There is no proximity-less shop.
* Ring (`OnShow @0x5CBDC0`): registers axis `ring_menu_scroll`, confirm (`menu_confirm_interact`)
  and cancel (`menu_cancel_interact`) and pushes `RingStateEvolveUpgrade`. Scroll axis below a
  threshold switches to `RingStateEvolveSell` (`OnCursorMove @0x5B4C30`) and back. The ring
  entries are labelled `tl_ring_tower_001` "Upgrade" and `tl_ring_tower_002` "Dismantle".
  Upgrade shows the next row's gem cost (`SetupValues @0x5B41B0`: child "Numb" = row+0x28);
  Dismantle shows tower refundCoin/refundGem (+0x94/+0x98: "Value" / "ValueWith").
* Upgrade confirm (`RingStateEvolveUpgrade.OnConfirm @0x5B4910`): disabled when
  `CanConfirm @0x5B3FD0` is false (local player must HAVE row.costCoin coins and row.costGem
  gems; the Animator bool `OnDisable` greys the entry). Disabled: sound `TowerNoEnoughInventory`
  if a next row exists, `TowerConfirmFail` if not (max level). Enabled: queue
  `UpgradeTowerCommand(next.level)` for the player, push `RingStateEvolveConfirmUpgrade`
  (plays "Decide", then `ForceBackFirstState`, ring closes). The command (already in the sim
  port) re-checks the level match, grants EXP up to `reachExp` (which levels the tower) and
  charges coin then gem cost.
* Dismantle confirm (`RingStateEvolveSell.OnConfirm @0x5B35D0`): `SellTowerCommand(handle,
  refundCoin, refundGem)`, sound `TowerSell`, `RingStateEvolveConfirmSell`. The sim destroys
  the tower and fires `towerSellEvent`; trees are revived. The refund is paid by
  `CurrencyFlyer.UpdateLifeSpan @0x479120` -> `AddInventoryCommand`. `TowerBase.OnSell
  @0x54B800` plays the lightning/shrink-and-destroy.
* Cancel (`RingState.OnCancel`) or leaving the trigger (`OnOutHover @0x5CC350`) closes the ring.
* No branches: every tower has the same linear Lv1..Lv5 path (Ice/Hive/Motor only differ in
  extra row columns). Max level: `GetNextUpgrade == null`, gauge hidden, upgrade entry fails.

## 4. How the level is shown

* `TowerEXPGauge` (world-anchored canvas, `Q4.UI.TowerEXPGaugePool`): value fed to Animator float
  `ExpGauge` is `(level-1) + GetCurrentExpRate()`; the Animator uses the fractional part
  (`vroundss` mode 9 = floor) as the fill. Shown 2.0 s after every EXP grant and after entering
  the tower's trigger (`OnEnterTowerRangePendingDisplayEXP`, waits out the remaining build time),
  displayed value eases to target by 0.1 per frame after 0.25 s, object deactivated 3.0 s after
  the timer expires, hidden entirely at max level (`SetActive(GetNextUpgrade != null)`).
* `TowerLevelUpText` (tl_hud_001 "Level Up!"): animated popup via Animator trigger `OnLevelUp`,
  auto-hidden by `Invoke`.
* `TowerLevelText` (strings `tl_hud_level_001..005` "Lv.N", Lv5 carries a '#' glyph):
  `TowerLevelTextPool.OnTowerUpgrade @0x5CE140` shows it at array index `max(0, newLevel-2)`.
  It persists (OnInIdle + ShowLevel) until the tower is sold (`OnTowerSell`) or a boss is
  destroyed (`OnEnemyDestroyed` -> `IsBoss` -> RemoveEvents + Hide; the pool then ignores further
  upgrades).
* World effects (`TowerBase.OnUpgrade @0x54B520`): `TowerLevelUpEffect.AddLevelUpEffect`
  (`newLevel` particle bursts, one every 0.2 s, prefab GlobalResources+0x68), a per-level FLAG
  prefab instantiated on the tower's `flag_pos` placeholder after the tower animator's OutIdle
  state (`CoroutineDecorateFlag`, sound `TowerFlagUp`), `TowerUpgrade` sound, or
  `TowerFinalUpgrade` when no next row exists. Level also changes stats (power, range scale on
  some towers, refund), and the range ring/detector via `detector.Upgrade`.

## 5. Port status

Missing before: no `Q4.TowerUpgradeSetting` (stub returned null, so a tower never levelled), no
dance EXP, no interaction/ring, no sell command wiring or refund, no level UI, no sounds.

Added (all under `src/view/tower/`, `src/view/ui/TowerLevelUi.ts`):
* `TowerUpgradeSetting.ts` (table + ApplyUpgrade), `TowerLevelModel.ts` (gauge/level model),
  `TowerDanceExp.ts` (CheckForTowers), `TowerInteraction.ts` (selection + ring state machine +
  commands), `TowerLevelFeature.ts` (glue: events, sounds, refund), `TowerLevelUi.ts` (DOM
  overlay: gauge with level pips, Lv.N label, Level Up! popup, interact prompt, Upgrade/Dismantle
  ring with gem cost / refund / greyed state / MAX).
* game.ts: 7 small localized edits (import, upgrade-setting getter, boot wiring, key capture,
  movement block while the ring is open, per-frame update, event wiring, extra sfx names);
  `PlayerStageView.keepDancing`.
* Input: E/Enter = interact/confirm, W/S/Up/Down = cursor, Q/Backspace = cancel (Escape stays
  pause), taps on the prompt and ring entries for touch/mouse.
* Data/audio: `public/assets/data/tower-upgrades.json`, 9 extra sfx wavs (dismantle, flagup,
  ringmenu set).
* Tests: `tests/view/towerLevel.test.ts` (16 tests).

## 6. Unverified / approximations

* The Unity UI prefabs (gauge, ring, level text) and their Animator layouts are not extracted:
  layout, colours, pip rendering and positions are approximations; the Lv5 '#' glyph is stripped.
* The sound used for opening/moving/confirming the ring (`sfx_ringmenu_*`) is inferred from names;
  TowerSell/TowerFlagUp/TowerConfirmFail/TowerNoEnoughInventory/TowerUpgrade/TowerFinalUpgrade are
  the verified GlobalSounds mappings.
* The two `IsStateRunning<>` types in `CheckForTowers` (which motor states may dance) were not
  resolvable from Ghidra; the port uses "standing, not walking, ring closed".
* Dance animation reuses the build-dance clips; the original dance-EXP particle/SFX loop
  (CommandSoundEffect 0xC) is not wired.
* Level-up world effects not ported: the per-level flag models (flagPrefab path ids are exported
  in the table but meshes are not extracted; `TowerStageView` is being rewritten by another agent,
  hook: after `towerUpgradeEvent` instantiate the flag under the `flag_pos` node), the
  LevelUpEffect particle bursts (prefab not located; hook `towerUpgradeEvent`, `newLevel` bursts at
  0.2 s). The sound part of OnUpgrade is wired.
* Sell refund is credited immediately (original: coin flyer animation first).
* The old `getComponentEnemyDetectorView` stand-in is a sphere; `detector.Upgrade` is applied but
  tower_001's range scale is 1.0 so nothing changes visually; the build-range ring is not updated.
* Replay hash: the headless sim never loads these modules; `npm run sim:stage1` gives
  0x27227819f56d94ad (the pin recorded in PROGRESS.md after the chibi-arc fix; the older
  0x41bb08621c2989ef value is stale and was not changed by this work).
