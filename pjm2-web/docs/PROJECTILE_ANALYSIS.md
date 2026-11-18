# Tower projectiles (presentation + motion) — original behaviour and the port

Scope: what the original PixelJunk Monsters 2 does for every tower's projectile — prefab/model, trajectory,
orientation, effects, sounds — and how `src/view/projectiles/*` reproduces it. Sources: decompiled IL2CPP
(`decomp/decompiled/Q4.Projectile*.c`, `Q4.TowerBase.c`, `Q4.ParticleGroup.c`), checked against **raw x86-64
disassembly** of `Media/Modules/Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000; `objdump -b binary -m i386:x86-64
-M intel -D --adjust-vma=<vaddr>`) wherever Ghidra's pseudo-C was ambiguous, and the serialized prefabs in the `props` /
`structures` AssetBundles (UnityPy). Addresses are `Il2CppUserAssemblies` vaddrs; "raw" = confirmed in the disassembly.

## 0. Why every projectile was "a perfect arrow" (root cause)

`game.ts` built **one** `tower001Contract()` for all 12 towers and gave it a hard-coded stand-in
(`DATA GAP: projectile PPtr unresolved → Trajectory stand-in`): `getFireDirection = to − from`, no gravity, no per-prefab
tuning, `getGameCoreType = GameCoreProjectileTrajectory` for every tower; `ProjectileView` then drew a shaft+cone for every
sim projectile. The sim classes were fine — the **viewer contract was missing**. The PPtrs were "unresolved" because
`TowerBase.projectile` has `m_FileID = 1` (first external of the `structures` file = the **`props` bundle**), so the
MonoBehaviour lives in `props`, not `structures`. Resolving it gives 12 distinct projectile prefabs (table below).
The sim reads *all* tuning from this contract (`GameCoreProjectileTrajectory` ctor: `view.getFireDirection`, `.gravity`,
`.traceTarget`, `.maxLifeDuration`, renderer bounds → collision cylinder), so supplying the real data also fixes the
**simulated** motion (ballistic arc instead of a 1-second straight line), not just the look.

## 1. Per-tower table

`TowerBase.projectile` → `props` MonoBehaviour (path id in `projectileData.generated.ts`). Fields are the serialized values.
"Model" = `PrefabLoader.prefabList` visual child instantiated in `Awake`.

| Tower | Projectile prefab (class) | Model | Motion (serialized) | Fire fx / sound | Hit fx / sound |
|---|---|---|---|---|---|
| tower_001 cannon | `bullet_001` (`ProjectileTrajectory` → `GameCoreProjectileTrajectory`) | `bullet_001_pa` mesh 0.28³ sphere | **ballistic**: `speedHorizontal 2.3`, `gravity −20`, `fixedImpactTime 0`, `traceTarget 0`, life 5 | `ef_tower_cannon_fire_pv` (smoke/spark/flash along barrel), `sfx_towercannon_shoot` | `ef_tower_cannon_explode_pv`, `sfx_towercannon_hit`; splash = tower `attackSpread` 3.3 |
| tower_002 mortar | `bullet_002` (Trajectory) | `bullet_002_pa` (LOD0 mesh 0.62×0.60×0.57) | **fixed-time lob**: `fixedImpactTime 1`, `impactTime 1.133`, `gravity −80`, `traceTarget 0` | `ef_tower_motor_fire_pv`, `sfx_towermorter_shoot` | `ef_tower_motor_explode_pv`, `sfx_towermorter_hit` |
| tower_010 missile | `missile_bullet` (Trajectory) | `bullet_010_pa` (LOD0 mesh 0.78×1.04×0.71, long axis +Y) **+ looping `ef_tower_rocket_burner_pv`** | `fixedImpactTime 1`, `impactTime 3.0`, `gravity −15`, **`traceTarget 1`** (homing), life 10 | `sfx_towermissile_shoot`, **loop `sfx_towermissile_engine`** | `ef_tower_rocket_explode_pv`, `sfx_towermissile_hit`; 3 fire points `bullet3/1/2` by magazine |
| tower_007 crossbow | `arrow` (`ProjectileInstant` → `GameCoreProjectileInstant`) | **none** (the prefab has no mesh / PrefabLoader) | **hitscan**: no motion; sim "bullet" arrives after dist/`bulletSpeed 18`, damage applied then | `sfx_towerarrow_shoot` (no fire effect) | `ef_tower_arrow_hit_pv` on the enemy, `sfx_towerarrow_hit` |
| tower_011 anti-air | `antiair_bullet` (Instant) | none | hitscan `bulletSpeed 25`, **burst 4 @ 0.133 s** | `ef_tower_air_fire_pv` (3 muzzle sets), `sfx_toweranti_shoot` | `ef_tower_air_hit_pv`, `sfx_toweranti_hit` |
| tower_003 tesla | `electric_bullet` (`ProjectileElectric`) | none (procedural `lightning_bolt_effect_tesla`) | instant chain, `bulletSpeed 100`, `duration 0.5` | `sfx_towertesla_shoot` | `ef_tower_tesla_hit_pv`, `sfx_towertesla_hit` |
| tower_012 laser | `beam_bullet` (`ProjectileBeam`) | `LineRenderer` (2 points: head = sim pos, tail = head − dir·min(`beamLength 3`, dist from muzzle)) | straight, `speed 50`, `beamFlyLength 10`, `radius 0.4`, life 1 | `ef_tower_laser_fire_pv`, `sfx_towerlaser_shoot` | `ef_tower_laser_hit_pv` (no hit sound) |
| tower_009 lightning | `lightning_bullet` (`ProjectileLightning`) | none (sky bolts `lightning_bolt_effect_tower/_ground`) | `lightningStrikeCount 8`, random per-target delay 0..0.25, camera shake/sky flash | `sfx_towerlightning_shoot` | `ef_tower_lightning_hit_pv`, `…_ground_pv`, `sfx_towerlightning_hit` |
| tower_004 flame | `flame_bullet` (`ProjectileGaseous`) | none (particle stream `ef_tower_fire_flame_pv`) | ballistic flow: `speedHorizontal 4`, `gravity −1`, `flowLengthMax 14`, ground fire `ef_tower_fire_flame_ground_pv` for 11.3 s, `BuffSettingBurn` | `sfx_towerfire_shoot` | `sfx_towerfire_hitground`, `ef_tower_fire_hit_pv` |
| tower_006 ice | `ice_bullet` (Gaseous) | none (`ef_tower_ice_flow_pv`) | `speedHorizontal 16`, `gravity −1`, `traceTarget 1`, `flowLengthMax 10`, `BuffSettingFreeze` | `sfx_towerice_shoot` | `sfx_towerice_hitground`, `ef_tower_ice_hit_pv` |
| tower_008 hive | `hive_bullet` (`ProjectileInsect`) | bee particle effect `ef_tower_hive_bug_pv` ×`insectAmountMax 5` | bees fly (`flySpeed 2.175`) then dive at `attackFlySpeed 25` | `sfx_towerhive_sendbee` | `ef_tower_hive_hit_pv`, `sfx_towerhive_hit` |
| tower_005 gem (DLC) | `gem_bullet` (`ProjectileGem`) | none | one tick: hands the tower the EXP-aura state | – | – |

Observations: **no projectile in the game is an arrow mesh.** Only the cannon, mortar and missile have flying models (three
different meshes); the crossbow and anti-air are invisible hitscan shots whose only visuals are muzzle/impact particles.
Every projectile is `Instantiate`d / `Destroy`ed per shot — **there is no pooling**. There is no spread/randomisation in the
view: shells are aimed exactly at `TowerHelper.GetProjectileGameCoreHitPoisition(tower, targetPos)`; `burstCount/burstInterval`
(tower_011: 4 × 0.133 s) are tower-state data.

## 2. Original code, function by function

### 2.1 Spawn: where the projectile starts
`TowerStateAttack.OnAttack` → `Activator.CreateInstance(view.GetGameCoreType(), tower, targets, true)` → sim ctor:
`this.position = tower.position + up*tower.height`; **the view is `Instantiate(viewer.projectile, firePoint, identity)`** with
`firePoint = TowerBase.GetFirePointByRemainingMag(tower.magazineCapacity)` (index `(capacity − mag) % firePointCount`, raw
@00548640). So the **view starts at the fire-point transform** (barrel), the **sim starts at tower+height**, and the view
converges to the sim during its first second (§2.3). Fire effect/sound: `Q4.Projectile.Start @00747ed0` (first frame):
`MonstersAudio.PlaySFX(fireSound)`, `Instantiate(fireEffect, loc.pos, loc.rot)` with `TowerBase.GetFireEffectLocation @0054a8b0`
= **first** fire point's position + rotation (so the cone-axis +Z of the effect children = barrel direction; e.g.
`ps_tower_cannon_fire_flash` at child (0,0,+0.7), smoke (0,0,+0.6), sparks (0,0,−0.4)).
`Q4.Projectile.ctor @00747af0`: `maxLifeDuration (+0x18) = 3.0`; fields `fireSound 0x20, hitSound 0x28, fireEffect 0x30, hitEffect 0x38`.

### 2.2 Aim / arc — `ProjectileTrajectory.GetFireDirection @0074dfd0` (**raw verified**)
Field layout: `fixedImpactTime +0x48 (bool)`, `impactTime +0x4C (def 2.0)`, `speedHorizontal +0x50 (def 10.0)`,
`gravity +0x54 (def −10.0)`, `traceTarget +0x58`, `invisibleStart +0x5C`, `invisibleEnd +0x60`, `flyingSound +0x68` (ctor @0074d250).
```
d  = (targetPos + extra) − firePos
h  = (d.x, 0, d.z)              raw: vmovlps; mov [rbp-0x24],0     <- horizontal only
speed = fixedImpactTime ? |h| / impactTime : speedHorizontal
t  = |h| / speed                (flight time)
v  = h / t                      (op_Division, call 0x98c950)
v.y = (d.y + t·(t·(gravity · −0.5))) / t      DAT_00b80480 = −0.5  (rodata read: 0xb80480 → −0.5f)
```
That is the closed-form lob for `y(t) = y0 + v.y·t + ½·g·t²`; the sim then integrates
`v.y += g·dt; p += v·dt` (`GameCoreProjectileTrajectory.Tick`, already ported), so the shell follows a **parabola** and lands on
the (non-homing) aim point. A CONCAT44 trap exists here: Ghidra shows `local_30 & 0xffffffff` — in the raw code that is the
`y` component zeroed (`mov dword [rbp-0x24],0`), i.e. a *horizontal* distance, not a truncated x. The same expression is used by
`SetupEstimateTime` and by `ProjectileGaseous.GetFireDirection @0074a4e0` (constant `DAT_00b80448 = −0.5`, never fixed-time).
Example (cannon, range 5, muzzle 2 above target): `t = 2.17 s`, `v.y = 20.7`, apex ≈ 10.7 u above the muzzle — a high lob
(the camera is top-down). Mortar: any distance lands in exactly 1.133 s. Missile: 3.0 s with `traceTarget`.
`ProjectileInstant/Insect/Beam/Electric/Lightning.GetFireDirection` = `Normalize(to+extra−from)` (unused by their sims).

### 2.3 Per-frame view (Trajectory) — `Update @0074d800`
1. `UpdateVisibility(dt) @0074d6d0`: `elapsed(+0x74) = min(elapsed+dt, estimate(+0x70))`; `ratio = elapsed/estimate`;
   renderer enabled iff `ratio < invisibleStart || ratio > invisibleEnd` (all shipped prefabs: 0/0 → visible after the first frame).
   `estimate` from `SetupEstimateTime @0074d560`: fixed → `impactTime`, else horizontal distance(firePoint, predicted target)/`speedHorizontal`.
2. `UpdateViewPosition @0074d8d0` (**raw**): `w = Clamp01(elapsed)`; `delta = simPos − viewPos` (`GameCoreObject.position` of the bridge object);
   `pos = (w ≥ 1.0 /*0xb80474*/) ? simPos : viewPos + delta·w`; if `|delta| ≤ 0.001 /*0xb80478*/` only the position is set; otherwise
   `delta = Normalize(delta)` and **`SetPositionAndRotation(pos, Quaternion.LookRotation(Vector3.forward, delta))`** —
   `LookRotation(forward = world +Z, upwards = delta)`: **+Z is fixed, local +Y follows the XY-plane component of the motion**
   (roll about Z only). That is why the missile mesh (long axis +Y, burner at −Y) "points along the flight path" as seen from the
   side/top camera, and why spheres don't need more. The earlier port's comment ("LookRotation(forward, upwards) only constrains +Y")
   was right about the maths, but then aimed the arrow *fully* along the path — not what the game does.
3. `flyingSound` (missile engine) was started in `Awake` with `MonstersAudio.PlaySFXMonitored` (looping) and is moved to the transform each frame.

### 2.4 Hit — `OnProjectileHit @0074db30` / `ProjectileInstant.OnProjectileHit @0074bcd0`
Subscribed in `Projectile.Awake` to `Events+0x98 projectileHitEvent`; acts only if `proj.GetUnityObject() == this`.
* **Trajectory** (also fires when the sim detonates on terrain, `enemy == null`): `PlaySFX(hitSound, enemy.position or transform.position)`;
  `Instantiate(hitEffect, **sim projectile position**, identity)` scaled by `GameCoreProjectileTrajectory.hitEffectScale`
  (= `tower.hitEffectScale`, 1.0 — `DAT_00b8047c = 1.0` is the non-trajectory fallback); every child `ParticleGroup` (rocket burner)
  is **detached** (`SetParent(null)`) and `ParticleGroup.StopLoopingThenDestroy`-ed so exhaust smoke outlives the missile;
  `Destroy(gameObject)`. `OnDestroy @0074d3d0` does the same detach + `StopSFX(flyingSound)`.
  (Ghidra labels the `GetComponentsInChildren<…>` type argument `Animator`; it is a shared-generic mislabel — the call feeds
  `ParticleGroup.StopLoopingThenDestroy`, so the elements are `ParticleGroup`s.)
* **Instant**: only if an enemy was hit: `PlaySFX(hitSound, enemy.position)`; `EmitProjectileHitEffect(enemy collider)` =
  `Instantiate(hitEffect, enemyCollider.position or its "Hips_Bn" child, identity)` **parented to the enemy** (`Projectile.EmitProjectileHitEffect @00747b00`); `Destroy`.
  `Instant.Update @0074bb80` destroys the GO as soon as the sim object `IsDestroyed()`.
* Beam/Electric/Lightning: same enemy hit sound + effect, but the GO lives on (Beam: `UpdateLife` destroys at `maxLifeDuration`).
* Sim side (already ported, unchanged): `GameCoreProjectileTrajectory.Tick` linecasts terrain (mask) → `onHit(null)`; enemy overlap
  → direct + radial splash (`attackSpread`, attenuation curve). The ground-hit explosion is therefore the same `hitEffect` at the impact point.

## 3. The port

| File | Role |
|---|---|
| `tools/assets/extract_projectiles.py` | Reads props+structures: 13 projectile prefabs (class, serialized fields, PrefabLoader models, BuffSetting components), 22 effect prefab hierarchies (emitter name + local TRS), tower→projectile map; exports the 3 mesh GLBs (`public/assets/projectiles`, albedo+AO only, WebP repack) and copies 24 sfx (`--copy-sfx`). Output: `src/view/projectiles/projectileData.generated.ts`. |
| `tools/assets/extract_particles.py` | default `--cap` 30→300 so all 152 emitters incl. every `ps_tower_*` fire/hit/explode set are in `particles.json` (the original 30 are byte-identical). |
| `projectileMath.ts` | float32-exact `ballisticFireDirection`, `estimateImpactTime`, `isVisibleAt`, `viewStep` (blend + `LookRotation(forward,delta)`), `integrateStep`. Pure; unit-tested. |
| `projectileContracts.ts` | `ProjectilePrefabContract implements ProjectileViewContract` — per-prefab `getGameCoreType` / `getFireDirection` / tuning / renderer bounds (real mesh AABB → sim collision cylinder). `projectileContractForTower(name)`. |
| `ProjectileViewer.ts` | `ProjectileViewerSystem.factory` (= `setProjectileViewerFactory`): instance per sim projectile; models, Start (fire sound/effect at the tower's first fire point), `update` (visibility, view blend, orientation, burner), `onProjectileHit`, destroy; driven from `syncViews`. |
| `projectileEffects.ts` | Plays effect prefabs through the extracted-emitter pool: child TRS composed under the fire-point/impact pose, emission axis = child +Z (new optional `axis` on `BurstOpts`/`LoopEmitterSpec`), looping burner. |
| `ParticleSystem.ts` | + `axis` (shape axis), + opt-in `perParticleSize` (projectile pool honours Unity `startSize`). Other pools unchanged. |
| `TowerStageView.getFireEffectLocation()` | first fire point world pose (Unity space) — the only change to that file. |
| `game.ts` | towers get `projectileContractForTower(name)`; `ProjectileViewerSystem` created after assets load; generic arrow shoot/hit sounds and the hand-tuned arrow-hit sparks removed (guarded); `__pjm2.buildTowerNearest(name)` / `__pjm2.projectileViews()` debug hooks. |

### Deliberate stand-ins / not ported (honest list)
> **UPDATE (stage gameplay audit, docs/STAGE_GAMEPLAY_AUDIT.md):** `GameCoreProjectileGaseous` (flame/ice), `GameCoreProjectileInsect` (hive) and
> `Q4.BuffSetting*` are now PORTED from the Ghidra pseudo-C (`src/core/GameCoreProjectile{Gaseous,Insect}.ts`, `src/view/projectiles/buffSettings.ts`); the Beam line,
> tesla/lightning bolts, flame/ice flow + ground cloud and bee swarm have views (`BoltEffects.ts`, `ProjectileViewer.ts`). The first bullet below and the
> "no bolt visuals" bullet are historical.

* **Gaseous (flame, ice) and Insect (hive) sims are not reconstructed** (`GameCoreProjectileGaseous` absent, `…Insect` is a skeleton).
  They keep the Trajectory stand-in with their *own* serialized ballistic params (flame `4 u/s, g −1`; ice homing `16 u/s`; hive
  homing dart `attackFlySpeed 25`), so they still deal splash damage; no flow stream, ground fire, burn/freeze buffs or bees.
* No visual for the Beam `LineRenderer`, Tesla/Lightning bolts (`LightningBoltScript` is procedural) — only their muzzle/hit particles + sounds.
* Audio is 2D (AudioManager has no spatialisation); one-shots are throttled 40 ms/clip.
* Particles are the project's point-sprite pool driven by the *extracted* emitter settings (size/gravity/speed/lifetime/colour/cone axis);
  textures, size-over-lifetime curves and sub-emitters are not applied (see ExtractedEmitter header).
* `hitEffectScale` is 1.0 in the sim; the scale is plumbed (sizes/speeds ×scale) but unexercised.
* Degenerate aim (`|h| = 0`) yields NaN in the original; the port falls back to a vertical 1 s lob.
* `headless-stage1.ts` (and therefore `npm run sim:stage1`) keeps its own Trajectory stand-in contract, so **the replay hash is unchanged**
  (0x27227819f56d94ad); the live game's projectile sim now differs from that headless milestone by design (real ballistics).

## 4. Verification
* `tests/view/projectiles.test.ts` (15 tests): aim math (horizontal speed, `d.y = v.y t + ½ g t²`, fixed-time landing, NaN guard, sim-integration arc),
  view blend/visibility/`LookRotation` cases, per-tower prefab data (3 distinct models, crossbow/anti-air model-less), the **real sim firing a
  cannon (arc, 2.3 u/s horizontal, damages the target) and a crossbow (instant, no motion, hit after ~17 ticks)**, and distinct view instances.
* Browser probe `.work/probe-projectiles.cjs` (`__pjm2.buildTowerNearest`, `__pjm2.projectileViews`) — see the task report for the run.
