# Tower construction (presentation) — original behaviour and the port

Scope: what the original PixelJunk Monsters 2 does, on the VIEW side, from the moment a tower is
built on a tree until it is a finished, aiming, firing tower (plus upgrade / sell visuals), and how
`TowerStageView` now reproduces it. Everything below is from the decompiled IL2CPP code
(`decomp/decompiled/Q4.TowerBase*.c`, `Q4.TowerAnimator.c`, `Q4.StructureVibration.c`,
`Q4.MonstersAudio.c`, `GameCore.TowerHelper.c`), checked against **raw x86-64 disassembly** of
`Media/Modules/Il2CppUserAssemblies.elf` (vaddr == file offset − 0x4000; helper `objdump -b binary
-m i386:x86-64 -M intel -D --adjust-vma=<start>`) where Ghidra's pseudo-C was ambiguous, and from the
serialized prefab/controller data in the `structures` AssetBundle (UnityPy).

Addresses are `Il2CppUserAssemblies` vaddrs. "raw" = confirmed in the disassembly, not only Ghidra.

## 1. The sequence, end to end

| # | Step | Where | Evidence |
|---|------|-------|----------|
| 1 | `BuildTowerCommand` → `TowerHelper.FromTreeToTower` claims the cost trees, `GameCoreTower` ctor, then **`Object.Instantiate(prefab, tower.position + down*tower.height, Quaternion.Euler(tower.bodyDirection))`** | `GameCore.TowerHelper$$FromTreeToTower @004d6170` | raw: `Quaternion.Euler(plVar12[0x22], plVar12[0x23], …)` = Euler(**Vector3 bodyDirection**), height read at `+0xF0` *before* `Initialize` (so the constructor default 2.0) |
| 2 | `tower.Initialize()` (sim copies settings, computes `height` from the fire point), **`SetTowerState(new TowerStateBuild(DifficultySettings.TowerBuildTimeByDifficulty(buildTime)))`** | same function | `TowerStateBuild.Enter` lowers the sim tower by the *new* height and `Tick` does `MoveTowards(final, dt*height/duration)` — the **rise is purely sim-driven** |
| 3 | `PrefabLoader.Awake @007470f0` (on the tower prefab root) instantiates the visual prefab `tower_NNN_pa` as a child and resets its local TRS (`ResetTransform @00747590`). `TowerBase.Awake @00548ee0` parents the tower under the static `TowerRoot` | `Q4.PrefabLoader`, `Q4.TowerBase$$Awake` | `prefabList == ['tower_NNN_pa']` for all 21 prefabs; **there is no separate construction model, no base/turret prefab and no build-state animator state** (see §3) |
| 4 | **`TowerBase.Start @00548f90`** (first frame): cache transform; `InitFort`; `GameObjectHelper.DestroyChilds(FindDeep(flagPlaceholderName))` + cache the flag `Animator`; **`transform.rotation = Quaternion.LookRotation(tower.bodyDirection)`**; subscribe 6 events | raw `Start` + Ghidra | `bodyDirection` is at GameCoreTower `+0x110`; the Euler passed at Instantiate is overwritten here |
| 5 | **`TowerBase.Update @00549e70`, every frame** | see §2 | raw (full function disassembled) |
| 6 | **`TowerBase.LateUpdate @0054a380` → `UpdateFortView @0054a520` → `UpdateFortViewRotation @0054aeb0`**: fort joints aimed at `fortDirection` | see §4 | raw (`ClampDirection @0054ad00`, rodata tables) |
| 7 | `TowerAnimator.Update/OnFire/UpdateFiring` drive the prefab `Animator` | see §5 | raw `AnimatorStateInfo.loop` offset |
| 8 | `projectileLaunchEvent` (Events `+0x88`) → `TowerBase.Recoil @0054b390` and `TowerAnimator.OnFire` | see §4/§5 | raw `Recoil` |
| 9 | `towerUpgradeEvent` → `TowerBase.OnUpgrade @0054b520` ; `towerSellEvent` → `OnSell @0054b800` + `ShrinkAndDestroy @0054da80` | §6, §7 | Ghidra + raw `ShrinkAndDestroy` |

## 2. `TowerBase.Update @00549e70` (the construction behaviour)

Raw-verified control flow (`state` = `GetGameCoreObject<GameCoreTower>().GetTowerState()`):

1. **Position**: if `state is TowerStateBuild` **or** `state is TowerStateIdle` → `transform.position = tower.position`
   (`0x549f68`: `GameCoreObject.get_position`, `Transform.set_position`). In every other state the view
   transform is *not* touched. → The rising tower is the sim's `MoveTowards`, copied to the transform each frame.
2. **State is Build**:
   * if `m_vibration (0x1A8) == null` → `AddComponent<Q4.StructureVibration>()` (`0x54a1c5`), and — only then —
     if `towerBuildEffect (0x158)` is set and `towerBuildEffectInstance (0x160)` is null →
     **`Instantiate(towerBuildEffect, TowerStateBuild.towerFinalPosition, Quaternion.identity)`** (`0x54a2b1`).
     The effect is spawned at the **final ground position**, not parented to the tower and not at the tree.
   * if `m_audioSourceBuild (0x1D0)` is dead → **`MonstersAudio.PlaySFXMonitored(GlobalSounds.TowerBuild, transform.position, …)`**
     (`@00647780` sets `AudioSource.loop = true`) → a **looping 3D** sound for the whole build.
   * returns.
3. **State is not Build** (first such frame):
   * if the build sound source is alive → `MonstersAudio.StopSFX(source)`, null it, then
     **`PlaySFX(GlobalSounds.TowerComplete, position, true)`** (so the completion sting only plays if the build loop existed).
   * if `m_vibration` is alive and `m_ongoingSink (0x1F8) == null` → `Object.Destroy(m_vibration)`, null it, and
     **`ParticleGroup.StopLoopingThenDestroy`** the build effect instance (`0x54a151`), null it.

`GlobalSounds.TowerBuild` = `sfx_tower_buildtower`, `TowerComplete` = `sfx_tower_buildcomplete`
(`tools/assets/audio-out/globalsounds_map.json`, PPtr-verified, high confidence).
`TowerBase.OnDestroy @00549770` also stops both sounds and the effect.

### 2.1 `Q4.StructureVibration` (the shake during Build)
`.ctor @00537040`: `factor (0x18) = 0.015` (`0x3C75C28F`), `shakeSpeed (0x1C) = 1.0`, reverse = false, shake = 0.
`Update @005370a0` (raw): `shake += dir * shakeSpeed * dt * SIGN[reverse]` (`SIGN = {-1.0, +1.0}` @rodata `0xB7D0B8`);
if `|shake| >= factor` → `shake = shake.normalized * factor; reverse ^= 1`; `transform.position += shake`.
`GetVibrationDirection @005371b0`: `Vector3.right`, or the active camera's `right` with `y` zeroed and normalized.
Because `TowerBase.Update` rewrites the position from the sim each Build frame, the offset never accumulates:
at 60 Hz it is a 4-frame ±0.015-unit jitter (−f, −f+1/60, +f, f−1/60).

### 2.2 The build effect prefab (`ef_tower_common_build_pv`)
All 12 production towers serialize the same `towerBuildEffect` (path id `3889496616617353631` →
GameObject `ef_tower_common_build_pv`, a `ParticleGroup` root, identity transform) and
`towerDestroyEffect` ∈ {`ef_tower_common_scrap_pv`, `ef_tower_common_scrap_organic_pv`}. Children (UnityPy dump):

* `ps_tower_common_build_smoke` — local y +0.1, rot −90° X, **looping**, rate 16..32/s, circleEdge r 0.3, startSpeed 10..20 clamped by
  `LimitVelocity` (magnitude curve 1.0 → 0.2856@0.166 → 0, dampen 0.9), gravityModifier −1..0, life 1..2, size 2..4.
* `ps_tower_common_build_rock` — y 0, rot −90° X, **looping**, rate 8..16/s, coneVolumeShell r 0.5 angle 25, life 2, gravity 1.5.

`ParticleGroup.StopLoopingThenDestroy @003dcbb0` stops emission and lets the live particles finish
(`finishCurrentLoopWhenDestroyed = 1` in the prefab).

## 3. Prefab hierarchy and animator facts (structures bundle)

* Logic prefab `tower_NNN`: `PrefabLoader`, `TowerBase`, `EnemyDetectorView*`, `TowerAnimator*`, `TowerUpgradeSettingGeneric`, … (tower_005: `TowerAnimatorGem`, tower_003/009 add `TowerEffectPlayerTesla`).
* Visual prefab `tower_NNN_pa`: `tower_NNN_comp` (Animator + skinned mesh, fort joints `tower_rot_y` → `tower_rot_x`, `door_rot_y`, fire-point nodes) and `flag_pos` (its own Animator: `OutIdle/In/OnInIdle/Out`, param `OnInIdle`).
  The cannon sits on its turret **inside one skinned mesh** (rigid-bound to `Root`/`tower_rot_y`/`tower_rot_x`); only tower_008/009 have a separate `base` node.
* **No build / construct animation exists in any controller** (asserted by `tests/view/towerAnimator.test.ts`). During Build the Animator simply sits in its
  default state (`BaseLayer.ready_to_fire`, loop; `DoorLayer.close_idle`, loop).
* tower_001 controller (extracted, `towerViewData.generated.ts`): BaseLayer `ready_to_fire →(OnReady) fire →(exit 1.0) cool_down →(exit 1.0) cool_down_idle →(OnReady==false) reload →(exit 1.0) ready_to_fire`;
  DoorLayer `close_idle ↔ open/close pc in/out` on `OnDoorOpenOut/OnDoorOpenIn`. Layer 1 default weight 1.0 (override).
* `TowerBase` serialized view fields per tower (jointHorizontal/Vertical, fortAngleMin/Max, recoil, rotateSound, build/destroy effects): `towerViewData.generated.ts`.
  Note tower_006's joint names are swapped in the data; the original assigns by **slot** (below).

## 4. Fort aim, recoil, rotate sound (`TowerBase`)

`InitFort @005493b0` (called from `Start`): horizontal joint (`+0x180`, name `+0xA0`) and vertical joint (`+0x188`, name `+0xA8`) found by `FindDeep`;
caches **world** bind rotations (`+0x1B0`, `+0x1C0`), the vertical joint's **local position** (`+0x198`), the horizontal joint's `forward` (`+0x1E0`).

`UpdateFortViewRotation @0054aeb0` (raw):
* horizontal joint: `d = Normalize(fortDirection with y := 0)`; if `|d| > 0.001` (`@0xB7CFFC`) → `joint.rotation = LookRotation(d) * bindWorld_H` (**yaw only**).
* vertical joint: `c = ClampDirection(fortDirection, fortAngleMin (+0xBC), fortAngleMax (+0xB8))`; if `c != 0` → `joint.rotation = LookRotation(c) * bindWorld_V` (**full aim, pitch clamped**);
  then `joint.localPosition = MoveTowards(localPosition, origin, dt)` (recoil recovery, 1 unit/s).
* `ClampDirection @0054ad00` (raw): `n = dir.normalized; flat = Normalize((n.x,0,n.z)); axis = n.y>0 ? Cross(n,flat) : Cross(flat,n); ang = Angle(n,flat) * (Dot(n,up)>0 ? −1 : +1)`
  (`@0xB7D0D0 = {1,−1}`); `ang = Clamp(ang, min, max)`; `return AngleAxis(ang, axis) * flat`. → The signed angle is **negative when aiming up**; tower_001 (`−45 … 0`) can aim up to 45° and **never below the horizon**.
* rotate sound: unless the tower is in Build, if `Angle(lastHorizontalForward, horizontal.forward) != 0` start a looping `rotateSound` (`sfx_tower_rotate`, towers 001/004/006/007/011/012) when none is playing, else stop it; then store the forward.

`Recoil @0054b390` (raw; only when the event's tower is this tower): `vertical.localPosition -= vertical.localRotation * Vector3.forward * recoil (+0xC8)`
(recoil = 0.25 for 001/002/003/005/007/008/009/010/012, 0 for 004/006/011).

## 5. `Q4.TowerAnimator`

`Start @00546bf0`: hashes `BaseLayer.cool_down/reload/fire`; resolves parameters `OnReady`, `OnFireFinish`, `OnDoorOpenOut`, `OnDoorOpenIn` (0 when absent);
`InitCooldownClipTime`: length of the controller clip named exactly `reload` (default 1.0). `fireAnimationDuration` is serialized (1.0; **10.0 on tower_004**).
* `OnFire` (← `projectileLaunchEvent`, only for its own tower): timer = `fireAnimationDuration`; `SetBool(OnReady, true)`.
* `UpdateFiring @00547270` each frame, layer 0: if the current state is `BaseLayer.fire` — only if `AnimatorStateInfo.loop` (`+0x20`, raw) — count the timer down and `SetTrigger(OnFireFinish)` at < 0.
  Otherwise, if the tower state is `TowerStateIdle` and **not** (`idle.stateTime < tower.attackSpeed − reloadLen` and `!ShootOnSight`) → `SetBool(OnReady, false)` (starts the reload clip so it ends when the next shot is due).

## 6. Upgrade (`OnUpgrade @0054b520`)
Own-tower check; `TowerLevelUpEffect.AddLevelUpEffect(tower, level)` (UI popup); forwards to a `DelegateUpdates` component; plays
`GlobalSounds.TowerUpgrade` (`sfx_tower_levelup`) or, when `GetNextUpgrade() == null`, `TowerFinalUpgrade` (`sfx_tower_levelcomplete`); starts `CoroutineDecorateFlag(upgrade.flagPrefab)`:
`flagAnimator.SetBool(OnInIdle,false)`, wait for `BaseLayer.OutIdle`, destroy the flag's children, instantiate the new flag prefab under the flag animator, `SetBool(OnInIdle,true)`, play `TowerFlagUp`.

## 7. Sell (`OnSell @0054b800`, `ShrinkAndDestroy @0054da80`)
Instantiate `towerDestroyEffect` at the tower pose, then squash: `scale = Vector3(1, max(scale.y − dt*7.5, 0), 1)` (raw: `7.5 = 0x40F00000`, X/Z constant `@0xB7D00C = 1.0`); at 0 → destroy.

## 8. What the old port got wrong ("the hack")

1. **The view never followed the sim.** `syncViews` only called `view.update(dt)`; nothing copied `tower.position` to the view, so the tower stayed at its spawn
   point `pos + down*2.0` (−2 units) for the whole build and afterwards. (Original: `TowerBase.Update` position copy in Build/Idle.)
2. **Wrong spawn orientation argument.** `TowerHelper` passed the *quaternion's* x/y/z as "Euler degrees" (≈ 0), and nothing implemented `Start`'s
   `LookRotation(bodyDirection)`, so towers faced a default direction; the demo's `treeViewer` also hard-coded `towerDirection = (0,0,1)`
   instead of the serialized per-species value (tree_001 `(−0.4107, 0, −0.9118)`).
3. **Build dust was a one-shot burst at the tree** (22 hand-tuned points). Original: looping `ef_tower_common_build_pv` at the *final* position for the whole Build state, stopped on completion.
4. **No build vibration, no looping build sound** (only a completion sting fired from `towerChangeStateEvent`).
5. **Fort aim was an adaptation**: role-by-joint-name instead of by slot, no `fortAngleMin/Max` pitch clamp, no recoil, no rotate sound.
6. **The tower Animator was never driven** in the game (`setAnimState` had no caller) — no fire/cool-down/reload animation at all.
7. Sell removed the view instantly (no scrap effect, no squash).

## 9. What the port does now

| File | Role |
|------|------|
| `src/view/characters/TowerStageView.ts` | `TowerBase` view port: `start()` (InitFort, flag cleanup, `LookRotation(bodyDirection)`), per-frame `update()` (Update → TowerAnimator → Animator → Vibration → LateUpdate), `onFire()` (Recoil + OnFire), `onUpgrade()`, `beginSell()` |
| `src/view/characters/towerFort.ts` | pure `ClampDirection` / `UpdateFortViewRotation` math (raw-verified) |
| `src/view/characters/StructureVibration.ts` | `Q4.StructureVibration` |
| `src/view/characters/AnimatorRuntime.ts`, `TowerAnimatorLogic.ts` | serialized-controller evaluator + `Q4.TowerAnimator` |
| `src/view/characters/towerViewData.generated.ts` (+ `towerViewTypes.ts`, `tools/assets/extract_tower_view_data.py`) | extracted `TowerBase` view fields + AnimatorControllers for towers 001–012 |
| `src/view/characters/towerEffects.ts` | `ef_tower_common_build_pv` / scrap prefabs (child offsets, limit-velocity curve) → looping/burst emitters |
| `src/view/characters/towerSimSource.ts` | `GameCoreTower` → per-frame `TowerSimSnapshot` |
| `src/view/particles/ParticleSystem.ts` | `startLoop` (rate-over-time, circle/cone shapes, LimitVelocity), `StopLoopingThenDestroy` semantics |
| `src/view/audio/AudioManager.ts` | `startLoop` (PlaySFXMonitored / StopSFX) |
| `src/core/TowerHelper.ts` | viewer factory now receives Euler *angles* (`bodyDirection`) — view-only argument, sim state/hash unchanged |
| `src/data/treeTowerDirection.ts`, `src/main/game.ts` | per-species serialized `towerDirection`; sinks (effects, spatial-volume falloff), `projectileLaunchEvent`/`towerUpgradeEvent` → view, sell flow, `__pjm2.buildNearestTree/towerViews` probes |

Tests: `tests/view/towerFort|structureVibration|towerAnimator|towerConstruction|towerEffects|towerRealGlb.test.ts` (+ updated `weapons`/`characters` aim tests). `towerConstruction` drives the **real sim**
(`FromTreeToTower` → Build → Idle) through the real view and asserts position follow, single effect/sfx, completion order, recoil, animator, sell.
A headless-Chromium run of `game.html` (SwiftShader) confirmed: build → `TowerStateBuild`, `viewY == simY`, vibrating/effect/sfx flags true, switching to `TowerStateIdle` clears them, no console errors.

## 10. Unverified / adaptations / not implemented

* **Audio 3D rolloff**: the original plays 3D `AudioSource`s whose rolloff comes from `MonstersAudio.clipSettings` (not recovered). `towerSfxVolume` (linear 70-unit falloff around the camera target) is an adaptation.
* **`StopSFX(source, immediate=false)` on a looping source**: the decomp only resets the pool entry (fade/kill bookkeeping, `AudioSourceState.fadeDec`); we stop the loop immediately.
* **Rotate-sound threshold**: the original tests `Vector3.Angle(...) != 0` exactly; we use > 0.05° to avoid rounding flicker.
* **Zero `towerDirection` (tree_002 serializes `(0,0,0)`)**: `LookRotation(zero)` in Unity 5.6 is degenerate (the engine port returns `(0.5,0,0,0)`, a 180° flip). `bodyRotation` keeps identity and
  `game.ts` keeps the neutral `+Z` seed for tree_002 so the sim's fort direction is never degenerate. Whether the original lets you build on tree_002 is unknown.
* **Particle renderer**: `ParticleSystem` renders `THREE.Points` with one shared point size, so the extracted `startSize` (smoke 2..4 u) is not applied; rates, lifetimes, shapes, gravity, colour fade and the LimitVelocity curve are. Colour-over-lifetime is reduced to a fade, size-over-lifetime unused. (NEAR fidelity, view-only.)
* **ParticleGroup visibility culling** (`minFOVPercentageToRender`) not ported.
* **Not implemented**: `TowerLevelUpEffect` UI popup, flag decoration/animator coroutine and flag prefabs (`flag_pos` clips are baked but unused), door animation events (`OnDoorOpenOut/In/Close` have no caller in the decomp — presumably serialized UnityEvents), `TowerAnimatorArrow/Gem/Hive/Laser/Missile` subclasses, `TowerEffectPlayer*` fire effects,
  gem-tower `OnTowerSink`/`OnTowerBreak`, `SetSelected` outline, blend-tree layers (tower_012 `blend_muzzle`), tower_010's per-arm `Fire_NN/Reload_NN` trigger layers.
* The `Quaternion.Euler(bodyDirection)` Instantiate rotation tilts the bind pose by ≈ 1° (`bodyDirection` components are fed to Euler as degrees); reproduced as-is, so the muzzle is within ~0.5° of the exact fort direction.
* `tower001Contract` in `game.ts` still hard-codes `cautionRotateAngleMin: 10` (serialized data differs for some towers) — sim-side, untouched.
