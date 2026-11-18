# Data extraction report — AISettings + coin/gem pickup prefabs

Agent: data-extraction subagent (pickup-sim support lane). Date: 2026-11-17.
Source: user's own decrypted PS4 copy, CUSA11967, Unity **5.6.5p1**
(`game/extracted/CUSA11967/Media/`). All game content treated as data only.

Reproducible script: `pjm2-web/tools/data/extract_pickup_data.py`
(run with `/srv/opencode/venv-unity/bin/python`; UnityPy 1.25.4).
Scratch probes: `pjm2-web/.work/data-extract/probe_*.py` + `*_raw.json`.

Outputs (new files only):
- `decomp/data/globalsettings_AISettings.json`
- `decomp/data/pickup_prefabs.json`

---

## TASK 1 — Q4.AISettings (FOUND)

**Asset:** `Assets/GlobalSettings/AISettings.asset` in the **globalsettings** bundle
(`Media/StreamingAssets/AssetBundles/globalsettings`), listed in `globalsettings.manifest`.
Loaded via `GlobalSettingsContainer<AISettings>.Instance` (container `rootPath = "GlobalSettings/"`,
skeleton TypeDefIndex 3789). Exactly one AISettings MonoBehaviour in the bundle.

| provenance | value |
|---|---|
| `__class` | `AISettings` (ScriptableObject, `m_Name = "AISettings"`) |
| `__path_id` | `-2994841570289042843` |
| `__bundle` | `globalsettings` |

**Serialized fields (exactly as in the type-tree):**

| field | offset | serialized value |
|---|---|---|
| `m_OvertakeSlowerEnemies` (bool) | 0x18 | `1` (true) |
| `m_EnableEnemyBlocking` (bool) | 0x19 | `1` (true) |
| **`m_PickupWaterKillTime` (float)** | 0x1C | **`5.0`** |

**Property → field mapping** (from `decomp/decompiled/Q4.AISettings.c` getters +
`decomp/skeleton/Q4.cs` TypeDefIndex 3089):
- `get_OvertakeSlowerEnemies` @0x007290A0 → `Instance + 0x18`
- `get_EnableEnemyBlocking` @0x00729180 → `Instance + 0x19`
- `get_PickupWaterKillTime` @0x00729260 → `Instance + 0x1C` → **5.0 seconds**
  (used by `GameCorePickup.CheckForWater` / fruit water logic:
  `remainingLifespan = Min(remainingLifespan, AISettings.PickupWaterKillTime)`).

Notes:
- The decompiled getters display `GlobalSettingsContainer<VibrationSettings>` calls —
  that is shared-generic codegen artifact; the offsets (0x18/0x19/0x1C) match the
  AISettings field layout in the skeleton exactly, and the null-instance fallback
  returns the ctor default. Serialized values above are authoritative.
- Ctor @0x00729030 defaults: `m_OvertakeSlowerEnemies=true`, `m_PickupWaterKillTime=2.0`
  (0x40000000), `m_EnableEnemyBlocking=false`. The asset overrides to true/true/**5.0**.

---

## TASK 2 — coin/gem pickup prefabs (FOUND: prop_001 / prop_002, props bundle)

### Attribution chain (verified in code + data)
1. `Q4.PickupManager.CreateCurrency` @0x003E3F50, `GetPickupPrefab` @0x003E5500,
   `CreatePickup` @0x003E5520 (`decomp/decompiled/Q4.PickupManager.c`):
   type 0 → `GlobalResources.DebugCoinPrefab`, type 1 → `GlobalResources.DebugGemPrefab`.
2. `GlobalResources` asset (globalsettings bundle, path_id `-558884283432022954`):
   fields are typed `PickupCurrency` (component PPtrs, skeleton Q4.cs @11305/11307):
   - `debugCoinPrefab` → path_id `1569343402696278429` = **prop_001**'s PickupCurrency (props bundle)
   - `debugGemPrefab` → path_id `-7195634620545009480` = **prop_002**'s PickupCurrency (props bundle)
3. Stage-1 scene `BuildPlayer-3d_stage_001_env` (stages bundle; attribution per
   `decomp/data/stage_scene_attribution.json`: tl_area_001/tl_stage_001, initCoin=450)
   contains a **PickupManager** (path_id `8745`): `globalCoinPerValueOverride=20`
   (matches coin value 20; CreateCurrency divides enemy coin drops by it),
   `maximumFruitsOnGround=3`, `hiddenPickupData=[]`.
   → prop_001/prop_002 are the currency pickups for stage 1 (and all stages;
   every stage scene has a PickupManager, none overrides the prefab refs).

### prop_001 — COIN
Source: `Assets/Prefabs/Master_Prefabs/Gimmick_Obj/Prop/Money/prop_001.prefab`, **props** bundle.
GameObject path_id `-8994034644167341400`; PickupCurrency path_id `1569343402696278429`.

| component | field | value (exact serialized float) |
|---|---|---|
| Pickup (base of PickupCurrency) | `detectRange` | `1.7999999523162842` (1.8f) |
| | `detectDelay` | `1.5` |
| | `collectSound` | AudioClip `sfx_item_coin` (pid -3273708077332051784) |
| | `disappearEffect` | ParticleGroup `ef_item_coin_vanish_pv` (pid 861004759477801476) |
| PickupCurrency | `type` | `0` = EInventoryType.Coin |
| | **`value`** | **`20`** |
| | `acquireEffect` | null (pid 0) |
| PickupMovement (pid 813181760433460228) | `acceleration` | `12.0` |
| | `rotateSpeed` | `-180.0` |
| | `rotateSpeedVariation` | `0.0` |
| | `appearForceMin` | `4.0` |
| | `appearForceMax` | `5.5` |
| | `appearRangeAngle` | `17.799999237060547` (17.8f) |
| | `bouncingRate` | `0.30000001192092896` (0.3f) |
| | `bounceTime` (int) | `-1` |
| | `attractOffset` | `(0, 0.5, 0)` |
| PickupLifeCycle (pid 5161604735945962810) | **`lifespan`** | **`42.900001525878906`** (42.9f) |
| | `lifespanFlashTime` | `5.0` |
| | `flashInterval` | `0.10000000149011612` (0.1f) |

Visual: `PrefabLoader.prefabList[0]` → **coin_001_pa** (pid -8066947214461514520),
hierarchy `coin_001_pa/coin_001_comp/coin_001_comp_LOD0..4` (all local transforms identity).

**Mesh bounds — COMPUTED FROM VERTEX MIN/MAX** (UnityPy MeshHandler; not copied from
the serialized AABB, which is also included in the JSON and agrees to float32 rounding).
Sim ctor uses `GetComponentInChildren<MeshFilter>()` → first in DFS = **LOD0**
(mesh `coin_001_comp_LOD0`, pid `-4334903669073594961`, 166 verts):
- vertexMin `(-0.17080701887607574, -0.17078250646591187, -0.039129793643951416)`
- vertexMax `(0.17080026865005493, 0.1708025485277176, 0.0391349121928215)`
- size `(0.3416072875261307, 0.34158505499362946, 0.07826470583677292)`
- extents `(0.17080364376306534, 0.17079252749681473, 0.03913235291838646)`
- **Cylinder.fromBounds** (height=size.y, radius=Lerp(min(extents.x,extents.z), max(...), 0.2)):
  **height `0.34158505499362946`, radius `0.06546661108732224`**
- LOD1/LOD2 bounds identical to LOD0; LOD3/LOD4 slightly smaller (all in JSON `allLODs`).

Other serialized components (bonus): SphereCollider radius `0.15000000596046448`,
center (0,0,0), isTrigger=true; Rigidbody mass 1, drag 0, angularDrag 0.05,
useGravity=false, **isKinematic=true**, constraints=126 (FreezeAll) — motion is
code-driven (PickupMovement), not Unity physics.

### prop_002 — GEM
Source: `Assets/Prefabs/Master_Prefabs/Gimmick_Obj/Prop/Money/prop_002.prefab`, **props** bundle.
GameObject path_id `7173683470124004964`; PickupCurrency path_id `-7195634620545009480`.

| component | field | value |
|---|---|---|
| Pickup | `detectRange` | `2.4000000953674316` (2.4f) |
| | `detectDelay` | `0.5` |
| | `collectSound` | AudioClip `sfx_item_gem` (pid -4672181361206298239) |
| | `disappearEffect` | ParticleGroup `ef_item_jem_vanish_pv` (pid -3173474898929507909) |
| PickupCurrency | `type` | `1` = EInventoryType.Gem |
| | **`value`** | **`1`** |
| | `acquireEffect` | ParticleGroup `ef_item_jem_pickup_pv` (pid 7062263785258502448) |
| PickupMovement (pid 8619803847494128706) | `acceleration` | `10.0` |
| | `rotateSpeed` | `-180.0` |
| | `rotateSpeedVariation` | `0.0` |
| | `appearForceMin` | `5.0` |
| | `appearForceMax` | `7.5` |
| | `appearRangeAngle` | `30.0` |
| | `bouncingRate` | `0.30000001192092896` (0.3f) |
| | `bounceTime` (int) | `-1` |
| | `attractOffset` | `(0, 0.5, 0)` |
| PickupLifeCycle (pid 3596689247596273883) | **`lifespan`** | **`57.20000076293945`** (57.2f) |
| | `lifespanFlashTime` | `5.0` |
| | `flashInterval` | `0.10000000149011612` (0.1f) |

Visual: `PrefabLoader.prefabList[0]` → **gem_001_pa** (pid 1473659884784271206),
hierarchy `gem_001_pa/gem_001_comp/gem_001_comp_LOD0..2` (identity transforms).

**Mesh bounds — COMPUTED FROM VERTEX MIN/MAX**, first MeshFilter (DFS) = **LOD0**
(mesh `gem_001_comp_LOD0`, pid `-4804760430084367961`, 73 verts):
- vertexMin `(-0.12700827419757843, -0.20821097493171692, -0.12898656725883484)`
- vertexMax `(0.13719867169857025, 0.1891269087791443, 0.13787142932415009)`
- size `(0.2642069458961487, 0.3973378837108612, 0.2668579965829849)`
- extents `(0.13210347294807434, 0.1986689418554306, 0.13342899829149246)`
- **Cylinder.fromBounds: height `0.3973378837108612`, radius `0.13236857801675797`**
- LOD1/LOD2 bounds slightly differ (in JSON `allLODs`); LOD0 is what the sim sees.

Other components: SphereCollider radius `0.15000000596046448`, isTrigger=true;
Rigidbody identical settings to coin (kinematic, FreezeAll).

### GlobalSounds water refs (OPTIONAL — done, cheap)
`GlobalSounds.asset` (globalsettings bundle, path_id `7621347385149222649`),
external PPtrs resolved by path_id in the **props** bundle:
- `itemDieInWater` → AudioClip **`sfx_item_disintegrate`** (pid -8860114733273067994)
- `itemLostInWater` → AudioClip **`sfx_item_splash`** (pid 5026452230255627714)
- bonus: `fruitWaterDie` → `sfx_fruit_disappear`, `fruitWaterSplash` → `sfx_fruit_splash`,
  `hiddenPickupFound` → `sfx_item_drops` (all in `pickup_prefabs.json`).
Audio decoding/export belongs to the audio agent; only names/PPtrs recorded here.

---

## Where I looked / unresolved
- Bundles scanned: `globalsettings` (25566 objects), `props` (1870), `stages`
  (all scene subfiles; MonoScript map built bundle-wide — scene files alone don't
  contain the MonoScripts). Manifests of all 9 bundles grepped for coin/gem/pickup/item.
- `prop_test_001` / `prop_test_002` (props, Prop_Test folder) also carry PickupCurrency
  but are NOT referenced by GlobalResources or any stage PickupManager → test-only, excluded.
- `medal_001_pa` has no PickupCurrency component (reward medal, not a stage drop) → excluded.
- Fruit prefabs `fruit_001..010` (props) carry PickupMovement/PickupLifeCycle/PrefabLoader
  and are available if the fruit lane needs them later (not extracted here; out of scope).
- No stage-specific coin/gem variants exist: all 17 stage PickupManagers use the same
  GlobalResources refs; stage-1 hiddenPickupData is empty (hidden pickups appear in
  other scenes, e.g. fps_check variant and stage_006 fruit data).
- Nothing unresolved for the requested fields. Mesh bounds are vertex-computed as
  requested; Unity's runtime `Mesh.bounds` returns the serialized AABB, which matches
  the vertex-computed values to float32 precision (both are in the JSON).
- Write scope respected: only `decomp/data/` (2 new files), `pjm2-web/tools/data/`
  (this report + script), `pjm2-web/.work/data-extract/` (scratch). No edits to
  `pjm2-web/src/`, `tests/`, `tools/colliders/`, or `PROGRESS.md`.
