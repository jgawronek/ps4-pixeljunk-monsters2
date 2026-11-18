# CHARACTER ASSET PIPELINE REPORT — PixelJunk Monsters 2 (PS4 CUSA11967) → WebGL

**Status: COMPLETE — 78/78 characters extracted (57 enemies + 21 towers), 0 failed, 0 pending.**
76 clean, 2 skeleton-only warnings (`tower_test_001`, `tower_test_005` — dangling mesh PPtrs in the
shipping test prefabs; no mesh data exists in the bundle).

Source: user's own legally-owned decrypted copy (Unity 5.6.5p1). Game files read-only; contents
treated strictly as data. Builds on the proven spike (`SPIKE_REPORT.md`, `extract_character.py`),
generalized into `extract_all_characters.py` (spike script untouched, imported as a library).

---

## 1. Outputs

| What | Where | Size |
|---|---|---|
| Character GLBs (mesh+skin+joints+materials+**30 Hz baked animations**) | `pjm2-web/public/assets/characters/<def>/<def>.glb` | 62.3 MB total (78 files) |
| Web textures (deduplicated, ≤1024², albedo sRGB-encoded) | `pjm2-web/public/assets/characters/_textures/` | 284.9 MB (226 unique PNGs; 72 shared across chars) |
| Manifest | `decomp/data/character_asset_manifest.json` (+ runtime copy `public/assets/characters/manifest.json`) | per-def entries + totals |
| Lossless raw clips (Unity values + cubic coefficients + events + root-motion metadata) | `pjm2-web/.work/asset-scale/<def>/clips.json` | scratch |
| Full-res linear texture originals (2048²/1024²/512²) | `pjm2-web/.work/asset-scale/textures-full/` | 635 MB scratch |
| Component inventories / GLB stats / per-def results | `pjm2-web/.work/asset-scale/<def>/{components,glb_stats,result}.json` | scratch |
| Run log | `pjm2-web/.work/asset-scale/run.log` | — |

Totals: **340,007 vertices, 932 clips (901 with baked tracks), 6,223 unresolved animation channels
(reported per character, never silently dropped — see §4).**

GLB material references point at `../_textures/<name>__<pathId>.png` (external URIs, shared files —
no texture bytes duplicated inside GLBs). Load with three.js `GLTFLoader`; animations are embedded
glTF animations named after the source clips (tower secondary animators prefixed `flag_pos/…`).

## 2. Stage-1 coverage (priority set) — ALL DONE

| def | role | verts | joints | clips | unresolved | note |
|---|---|---|---|---|---|---|
| kuri_00_001 | enemy (wave 1-10 grunt) | 3,367 | 28 | 20/20 baked | 0 | matches spike exactly |
| boss_bero_00 | enemy (finale boss) | 2,677 | 2 | 3 (root tracks only) | 969 | shipping controller references **giant-rig clips**; see §4.1 |
| tower_001 | tower (basic, 120c) | 4,544 | 4 | 15 (10 baked, 5 empty) | 12 | empty clips are code-driven (TowerAnimator); flag scale targets runtime object |
| tower_006 | tower (ice, 200c) | 8,583 | 5 | 15 (9 baked) | 54 | generic door clips target `Root/door_rot_y` absent on ice tower |
| tower_007 | tower (100c) | 2,019 | 10 | 15/15 baked | 12 | flag scale only |
| tower_011 | tower (150c) | 3,887 | 2 | 9/9 baked | 12 | flag scale only |

Stage-1 tower pick = cheapest non-DLC buildable towers; all 12 real towers + 9 test towers also done.

## 3. Pipeline (what was generalized from the spike)

1. **Logic prefab disambiguation.** Bundles contain duplicate GameObject names (static MeshFilter
   decoys + logic prefabs). The logic prefab is picked by matching its `EnemyBase`/`TowerBase`
   component path_id against `decomp/data/enemies_EnemyBase.json` / `structures_TowerBase.json`.
   Visual prefab via `PrefabLoader.prefabList[0]` (same trick as spike; holds for all 78).
2. **Mesh/skin.** LOD0 SMR per character (multi-submesh supported — boss_kao has 2 materials/8
   textures); static MeshFilter parts supported; per-submesh material assignment; mirrored
   Unity→glTF convention identical to spike (X negate, winding/V flip, quat (x,-y,-z,w), S·M·S).
   `tower_test_006` quirk handled: SMR lists 3 bones vs 2 mesh bindposes, skin indices only use
   0–1 → joint list truncated with warning.
3. **Animation bake (the spike's §4.1 plan, improved).** StreamedClip coefficients are cubic
   segment polynomials — verified empirically: `v(dt) = c0·dt³ + c1·dt² + c2·dt + c3` reproduces
   the next key value exactly. Bake evaluates the **true cubic** (not linear) at uniform 30 Hz,
   mirrors to glTF space, normalizes quaternions + hemisphere-aligns. Constant channels emitted
   as 2-key tracks. Euler (`localEulerAnglesRaw`) channels converted ZXY→quaternion (tower flags).
   CRC32 binding resolution unchanged from spike (AssetStudioMod algorithm); a bundle-wide
   path-CRC index **annotates** unresolved hashes with likely target names (never binds across
   skeletons). Multiple animators per visual supported (tower `flag_pos`).
4. **Textures.** Deduplicated by (bundle, path_id): 226 unique for 78 characters. Full-res linear
   PNGs kept in scratch; web PNGs downscaled to ≤1024² (LANCZOS). **Albedo `_MainTex`
   (m_ColorSpace=1 linear) is sRGB-encoded at export** → set `texture.colorSpace = SRGBColorSpace`
   in three.js. Normal/Metal/AO stay linear (`NoColorSpace`). `_BumpMap` is grayscale height
   (spike §4.2) — intentionally NOT bound as glTF normalTexture. `_MetallicGlossMap` channel
   layout (metallic R / smoothness A) differs from glTF (B/G) — GLB uses material factors
   (`_Metallic`, `1-_Glossiness`); maps shipped for a custom shader if wanted.
5. **Validation.** Every GLB reloaded at extract time (trimesh geometry + JSON-chunk structural
   checks: animation targets, skin joint ranges, accessor bounds). Independent re-verification
   (`validate_bake.py`) on 13 representative characters: re-derived 30 Hz samples from raw
   coefficients and compared with GLB accessor data — **max abs error 8.97e-07 (float32 noise)**;
   IBM orthonormality det=1, weight sums=1, quaternion norms=1, sRGB encoding confirmed
   (linear mean → brighter sRGB mean). All 13 OK.

## 4. Unresolved bindings — honest accounting (6,223 channels across 28 characters)

All are **source-data realities**, not decoder failures; raw curves are preserved in each
`clips.json` and every unresolved channel is listed in the manifest `issues.unresolvedBindings`
with `likelyPath` annotations. Categories:

1. **boss_bero_00…04 (5×969 = 4,845).** The shipping `boss_bero_ctrl` contains ONLY 3 giant clips
   (`giant_fly`, `giant_land_air`, `giant_land_impactToLeft`) targeting the giant skeleton
   (`Root/Hips_Bn/Spine_Be/Clavicle_…`). No `bero`-named clips exist anywhere in the bundle.
   Bero visuals are 2-joint rigs; only the root-level channels (path hash 0) bind → 2 root
   tracks/clip baked. The bero bosses' in-game motion is presumably code/IK-driven. **Meshes,
   skins and textures are fully usable.**
2. **bat/bee/kurukuru (418+202+364 = 984).** Clips reference arm joints
   (`Shoulder/Elbow/Wrist_L/R_Bn`) that were deleted from the shipping visual rigs
   (`bat_00_del_joint_pa` etc.). Both bat defs point at the same del_joint visual. All other
   channels bake normally (81/40/58 tracks per clip).
3. **boss_fat_00…04 (5×14 = 70).** Shared `boss_*` clips target leg-armor joints
   (`Elytra_L_Bn/Leg_Armor_L/R_Bn`) present only on some variants.
4. **Towers (246+78).** (a) generic open/close clips target `Root/door_rot_y` which exists on
   tower_001/003/etc. but not on door-less towers (tower_002/004/006/test_002/test_008: 54 each);
   (b) flag clips' scale channel targets hash 1018043275 — a flag root instantiated at runtime
   (not present in structures/enemies/globalsettings bundles); flag pole euler rotation IS baked.
5. **Empty/null controllers.** 7 tower clips are genuinely empty (0 bindings/curves — firing is
   procedural via TowerAnimator recoil/rotate params). `tower_test_001/005/006` have null
   controller PPtrs → 0 clips. `tower_test_001/005` also have dangling mesh PPtrs → skeleton-only
   GLBs (the only 2 warnings).

Animator float channels (typeID 95, e.g. 21 in bero clips) are recorded in `issues.nonTransformChannels`
and raw clips.json; they have no glTF node target (likely root-motion/muscle extras — spike §7.4).

## 5. Coverage table (all 78 defs)

S1 = stage-1 priority. "warn" = done-with-warnings (skeleton-only, no mesh in source).
Unresolved = animation channels that could not be bound (see §4); 0 means fully bound.

| def | role | verts | joints | clips | unresolved | GLB KB | status |
|---|---|---|---|---|---|---|---|
| bat_00_001 | enemy | 5,111 | 42 | 12 (11 baked, 1 empty) | 209 | 824 | done |
| bat_00_001_lessJoints | enemy | 5,111 | 42 | 12 (11 baked, 1 empty) | 209 | 824 | done |
| bee_00_001 | enemy | 5,672 | 18 | 12 (12 baked) | 202 | 753 | done |
| boss_bero_00 **S1** | enemy | 2,677 | 2 | 3 (3 baked) | 969 | 221 | done |
| boss_bero_01 | enemy | 2,639 | 2 | 3 (3 baked) | 969 | 218 | done |
| boss_bero_02 | enemy | 2,535 | 2 | 3 (3 baked) | 969 | 210 | done |
| boss_bero_03 | enemy | 2,677 | 2 | 3 (3 baked) | 969 | 221 | done |
| boss_bero_04 | enemy | 2,475 | 2 | 3 (3 baked) | 969 | 205 | done |
| boss_fat_00 | enemy | 5,419 | 40 | 11 (11 baked) | 14 | 1085 | done |
| boss_fat_01 | enemy | 5,419 | 40 | 11 (11 baked) | 14 | 1085 | done |
| boss_fat_02 | enemy | 5,487 | 40 | 11 (11 baked) | 14 | 1090 | done |
| boss_fat_03 | enemy | 5,419 | 40 | 11 (11 baked) | 14 | 1085 | done |
| boss_fat_04 | enemy | 5,850 | 40 | 11 (11 baked) | 14 | 1119 | done |
| boss_kao_00 | enemy | 1,954 | 14 | 4 (4 baked) | 0 | 289 | done |
| boss_kao_01 | enemy | 1,954 | 14 | 4 (4 baked) | 0 | 289 | done |
| boss_kao_02 | enemy | 1,954 | 14 | 4 (4 baked) | 0 | 289 | done |
| boss_kao_03 | enemy | 1,954 | 14 | 4 (4 baked) | 0 | 289 | done |
| boss_ude_00 | enemy | 6,908 | 50 | 8 (8 baked) | 0 | 1399 | done |
| boss_ude_01 | enemy | 7,369 | 50 | 8 (8 baked) | 0 | 1435 | done |
| boss_ude_02 | enemy | 7,369 | 50 | 8 (8 baked) | 0 | 1435 | done |
| boss_ude_03 | enemy | 7,040 | 50 | 8 (8 baked) | 0 | 1409 | done |
| boss_ude_04 | enemy | 7,040 | 50 | 8 (8 baked) | 0 | 1410 | done |
| boss_ude_05 | enemy | 6,908 | 50 | 8 (8 baked) | 0 | 1399 | done |
| boss_ude_06 | enemy | 7,523 | 50 | 8 (8 baked) | 0 | 1450 | done |
| cisors_00_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_01_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_02_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_03_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_04_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_05_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| cisors_06_001 | enemy | 5,068 | 24 | 15 (15 baked) | 0 | 1030 | done |
| giant_00_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1260 | done |
| giant_01_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1261 | done |
| giant_02_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1261 | done |
| giant_03_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1260 | done |
| giant_04_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1261 | done |
| giant_05_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1261 | done |
| giant_06_001 | enemy | 4,605 | 26 | 15 (15 baked) | 0 | 1260 | done |
| giant_07_001 | enemy | 4,800 | 26 | 15 (15 baked) | 0 | 1276 | done |
| kuri_00_001 **S1** | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_01_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_02_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_03_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_04_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_05_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_06_001 | enemy | 3,367 | 28 | 20 (20 baked) | 0 | 935 | done |
| kuri_07_001 | enemy | 3,914 | 29 | 20 (20 baked) | 0 | 978 | done |
| kurukuru_00_001 | enemy | 3,152 | 28 | 12 (12 baked) | 182 | 617 | done |
| kurukuru_07_001 | enemy | 3,707 | 28 | 12 (12 baked) | 182 | 661 | done |
| spider_00_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_01_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_02_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_03_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_04_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_05_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_06_001 | enemy | 4,633 | 19 | 17 (17 baked) | 0 | 973 | done |
| spider_07_001 | enemy | 5,083 | 19 | 17 (17 baked) | 0 | 1009 | done |
| tower_001 **S1** | tower | 4,544 | 4 | 15 (10 baked, 5 empty) | 12 | 381 | done |
| tower_002 | tower | 3,171 | 3 | 15 (9 baked) | 54 | 270 | done |
| tower_003 | tower | 5,314 | 3 | 16 (16 baked) | 12 | 457 | done |
| tower_004 | tower | 5,744 | 4 | 15 (9 baked) | 54 | 471 | done |
| tower_005 | tower | 5,096 | 2 | 1 (1 baked) | 0 | 413 | done |
| tower_006 **S1** | tower | 8,583 | 5 | 15 (9 baked) | 54 | 694 | done |
| tower_007 **S1** | tower | 2,019 | 10 | 15 (15 baked) | 12 | 190 | done |
| tower_008 | tower | 1,391 | 3 | 6 (6 baked) | 12 | 122 | done |
| tower_009 | tower | 2,452 | 2 | 9 (9 baked) | 12 | 204 | done |
| tower_010 | tower | 4,188 | 16 | 12 (12 baked) | 0 | 401 | done |
| tower_011 **S1** | tower | 3,887 | 2 | 9 (9 baked) | 12 | 319 | done |
| tower_012 | tower | 5,224 | 7 | 11 (11 baked) | 12 | 462 | done |
| tower_test_001 | tower | 0 | 0 | 0 (0 baked) | 0 | 0 | warn |
| tower_test_002 | tower | 3,171 | 3 | 15 (9 baked) | 54 | 270 | done |
| tower_test_003 | tower | 5,314 | 3 | 12 (12 baked) | 0 | 453 | done |
| tower_test_004 | tower | 4,544 | 4 | 4 (4 baked) | 12 | 373 | done |
| tower_test_005 | tower | 0 | 0 | 0 (0 baked) | 0 | 1 | warn |
| tower_test_006 | tower | 3,887 | 2 | 0 (0 baked) | 0 | 312 | done |
| tower_test_007 | tower | 2,019 | 10 | 11 (11 baked) | 0 | 186 | done |
| tower_test_008 | tower | 5,314 | 3 | 16 (16 baked) | 12 | 457 | done |
| tower_test_012 | tower | 5,314 | 3 | 12 (12 baked) | 0 | 453 | done |

## 6. Re-run commands

```bash
cd /srv/opencode/ps3-pixeljunk-monsters2
# full roster (idempotent; cached results skipped unless --force):
/srv/opencode/venv-unity/bin/python pjm2-web/tools/assets/extract_all_characters.py
# stage-1 only / subset / force:
/srv/opencode/venv-unity/bin/python pjm2-web/tools/assets/extract_all_characters.py --stage1
/srv/opencode/venv-unity/bin/python pjm2-web/tools/assets/extract_all_characters.py --only kuri_00_001,tower_001 --force
# independent bake/skin/texture validation (loads source bundle; sample defs):
/srv/opencode/venv-unity/bin/python pjm2-web/tools/assets/validate_bake.py kuri_00_001 boss_bero_00 tower_001 tower_006 giant_00_001 bat_00_001_lessJoints boss_kao_00 spider_00_001 tower_007 tower_011 boss_fat_01 kurukuru_00_001 bee_00_001
```

Runtime: ~7 min full roster (bundle loads 3 s; 1–7 s/character; textures dominate, dedup amortizes).
Disk: 335 MB shipped (`public/assets/characters/`) + 642 MB scratch (`.work/asset-scale/`); 69 GB free.

## 7. Known limitations / follow-ups

1. **LOD0 only** (spike §4.5) — LOD1–4 meshes exist in-bundle; `--lod` not exposed in the batch
   script yet (spike script supports it). Fine at PJM2 camera distance.
2. **Texture weight:** 285 MB of 1024² PNGs is shippable for a personal port but the spike's §7.2
   recommendation stands: repack to KTX2 (BC7/Basis) for ~90% reduction. Full-res linear originals
   are preserved in scratch for exactly that pass.
3. **Normal maps** are grayscale height maps — not bound; derive Sobel normals offline if desired.
4. **Root motion** (`m_StartX/m_StopX` etc.) preserved in clips.json but not applied — gameplay
   code drives movement (spike §7.4).
5. **Bero bosses** have no usable skeletal clips in shipping data (§4.1) — animate procedurally
   or author new clips; mesh/skin/textures ready.
6. **Particles/VFX, stage scenes, audio** out of scope here (audio lane already complete in
   `tools/assets/audio-out/` — untouched).
7. **Quaternion float noise** (norms up to ~1.0008 in source) normalized at bake.
8. Manifest carries sha256 per GLB + source path_ids (provenance chain, spike §7.8).
