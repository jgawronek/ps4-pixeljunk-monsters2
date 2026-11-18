# ASSET-PIPELINE FEASIBILITY SPIKE — PixelJunk Monsters 2 (PS4, CUSA11967) → TypeScript/WebGL

**Status: COMPLETE — VERDICT: FEASIBLE.** One enemy (kuri_00_001, "Kuritaro") converted end-to-end
(mesh → GLB, textures → PNG, animations → JSON, audio → WAV) in **7 seconds** with pure-Python tooling.
All outputs validated programmatically. Details, honest caveats, and Phase-2 recommendations below.

Source: user's own legally-owned decrypted copy. Game files were treated strictly as read-only data.

---

## 1. Executive summary

| Question | Answer |
|---|---|
| Can we convert an enemy end-to-end? | **Yes.** `tools/assets/extract_character.py` does prefab→GLB+PNG+JSON in 7s/enemy, fully scripted |
| Mesh format reality | Unity **5.6.5** bundles. Skinned meshes parse cleanly via UnityPy (`MeshHandler`): pos/normal/tangent/uv0 float32 + `m_Skin` weights + `m_BindPose`. No compression, no resS streaming for enemy meshes — data inline |
| Texture format reality | **Not GNF-wrapped.** PS4 textures are plain **BCn**: DXT1/BC1 (albedo, AO) and DXT5/BC3 (normal, metallic), 2048², 12 mips, inline. UnityPy + texture2ddecoder decode all 4 to PNG with zero errors |
| Animation reality | Generic (non-humanoid) avatars. Classic curve lists are **empty**; all data lives in compressed `m_MuscleClip` StreamedClip/ConstantClip format. **Fully decoded** (algorithm ported from AssetStudioMod, MIT): 20 clips, 217 channels each, 0 unresolved bindings |
| Audio reality | **Not ATRAC9.** Unity **ADPCM** (SFX) + **Vorbis** (BGM) inside **FSB5** (FMOD) containers in `.resource` files. Decodes to WAV out-of-the-box via the pre-installed `fmod_toolkit` — no vgmstream needed (but it's the fallback) |
| Coordinates | Unity LH → glTF RH by mirroring X (details §5). Validated: bind poses orthonormal (det=1.0), weights sum to 1.0, mesh symmetric |

## 2. What was produced (all under `.work/asset-spike/`, tools under `tools/assets/`)

### Tools (reusable, parameterized)
- `tools/assets/extract_character.py <prefab_name> <bundle_path> <output_dir> [--pid N] [--lod N]` — the 5-stage pipeline (inventory, GLB, textures, clips, manifest)
- `tools/assets/validate_outputs.py <output_dir>` — independent reload validation (trimesh/Pillow/JSON/hash)
- `tools/assets/probe_audio.py <audio_out_dir> [bundles...]` — audio census + decode probe
- `tools/assets/pylibs/` — pip-installed numpy 2.5.5, trimesh 5.2.1, pygltflib 1.16.5 (GLB writer ended up hand-rolled; pygltflib unused but available)

### Outputs for kuri_00_001 (`.work/asset-spike/kuri/`, see manifest.json for sha256)
| File | Size | Content |
|---|---|---|
| `kuri_00_001.glb` | 289,280 B | LOD0 skinned mesh: 3,367 verts / 5,914 tris / 28 joints, POSITION+NORMAL+TANGENT+TEXCOORD_0+JOINTS_0+WEIGHTS_0, 40-node hierarchy, inverse bind matrices |
| `clips.json` | 1.93 MB | 20 AnimationClips, 35,938 keyframes, `{clipName, bindings:[{path, property, times[], values[]}]}` + events + loop flags |
| `components.json` | 34 KB | Logic + visual prefab trees, all components w/ resolved refs, EnemyBase cross-ref (matched by path_id: maxLife=300, speed=0.836, exp=10) |
| `textures/kuri_00_Color.png` | 4.16 MB | _MainTex, 2048², from DXT1 |
| `textures/kuri_00_Normal.png` | 6.0 MB | _BumpMap, 2048², from DXT5 — **grayscale, see §4.2** |
| `textures/kuri_00_Metal.png` | 2.54 MB | _MetallicGlossMap, 2048², from DXT5 |
| `textures/kuri_00_AO.png` | 1.44 MB | _OcclusionMap, 2048², from DXT1 |
| `textures/textures.json` | 2.7 KB | m_TextureFormat values, sizes, raw magic bytes, PNG stats |
| `manifest.json` | — | all files + bytes + sha256 (re-verified: ALL OK) |
| `glb_stats.json` | — | mesh export stats incl. `meshNodeGlobalIsIdentity: true` |

### Audio (`.work/asset-spike/audio/`)
| File | Size | Notes |
|---|---|---|
| `enemies_sfx_bossberomonokuma_bigdamage.wav` | 794 KB | ADPCM→WAV, 4.50 s stereo 44.1 kHz 16-bit — duration matches clip metadata exactly |
| `globalsettings_sfx_tower_dismantletower.wav` | 144 KB | ADPCM→WAV, 0.82 s |
| `globalsettings_bgm_title.wav` | 22.6 MB | **Vorbis**→WAV, 128.0 s stereo — proves BGM path works too |
| `audio_probe_summary.json` | — | per-bundle census |

### Validation (`.work/asset-spike/validation.txt` — re-runnable)
- GLB reloads in trimesh: 1 geometry, 3,367 verts / 5,914 faces; POSITION x∈[−0.324, 0.324] (symmetric — mirror OK), y∈[0, 0.574] (≈57 cm tall chestnut monster ✓), z∈[−0.226, 0.243]
- Skin: 28 joints, IBM rotation dets = 1.0000, orthonormality err ≤ 1.01e−06; WEIGHTS_0 sums ∈ [1.00000, 1.00000]; JOINTS_0 ∈ [0,27]
- PNGs: all 4 open at 2048² RGBA; Color mean RGB=(112,97,69) brown ✓; Normal mean 127.5 ✓; AO mean 225 (mostly white) ✓; Metal ≈ black (non-metal, matches `_Metallic=0.0`) ✓; 8,280–91,533 distinct colors (real images, not noise)
- clips.json: parses; 20/20 clips; every clip's channels fully attributed (0 unresolved); per-clip binding counts 217–227 = Σ curve counts ✓; 4 benign warnings (quaternion `w` up to 1.0008 — float32 noise from source; normalize at load)
- manifest sha256: ALL OK

## 3. How the pipeline works (and the tricks it needed)

1. **Two-prefab structure (trick #1).** `kuri_00_001` is a *logic* prefab (EnemyBase, Rigidbody, SphereCollider, PickupMovement, BuffEffectPlayer, PrefabLoader + `LookTarget` child). The *visual* prefab (`kuri_00_pa`: Animator + LODGroup + 5 LOD SkinnedMeshRenderers + 32-transform skeleton) is referenced via **`PrefabLoader.prefabList[0]`**. The extractor follows that pointer automatically. Expect the same pattern for all 57 enemies (all have EnemyBase; PrefabLoader is the visual link).
2. **Mesh.** UnityPy `MeshHandler` handles the 5.6.5 vertex-stream layout (pos/normal/tangent stream 0, uv0 stream 1) and lifts weights/indices from `m_Skin` (blend-index channel is disabled in this Unity version). GLB is hand-rolled (JSON chunk + BIN chunk, column-major MAT4s) — ~150 lines, validated by trimesh reload.
3. **Textures.** Straight `Texture2D.image` (UnityPy→texture2ddecoder). m_TextureFormat recorded: 10=DXT1, 12=DXT5. No GNF container, no resS indirection, no failures.
4. **Animation (trick #2 — the only real reverse-engineering work).** All curve data is in Unity's compressed `m_MuscleClip.m_Clip.data`:
   - `StreamedClip`: uint32 blob → frames of `(time:f32, nKeys:i32, keys:(channelIndex:i32, coeff:f32[4])×n)`; value = coeff[3]; first/last frames are ±FLT_MAX sentinels (skipped, as AssetStudio does).
   - `DenseClip`: uniform samples (0 curves for kuri — implemented anyway).
   - `ConstantClip`: per-channel constants → emitted as 2 keyframes (start/stop).
   - Channel→binding mapping: `m_ClipBindingConstant.genericBindings` walked cumulatively (Transform: pos=3, rot=4, scale=3 channels; Animator floats=1). Verified exactly: 66 streamed + 0 dense + 151 constant = 217 = Σ bindings.
   - **Trick #3:** binding paths are CRC32 hashes and the Avatar's `m_TOS` hash table is **stripped** in shipping builds. Resolved by recomputing `zlib.crc32` over animator-relative transform paths (+ suffixes): **all 28 distinct hashes resolved, 0 unknown**.
   - Algorithm follows AssetStudioMod `ModelConverter.ReadCurveData`/`FindBinding`/`StreamedClip.ReadData` (MIT).
5. **Audio.** `m_CompressionFormat`: 2=ADPCM (all 81 enemy SFX), globalsettings adds 1=Vorbis (21 BGM/jingles). Data lives in `archive:/CAB-…/CAB-….resource` and is **FSB5** (magic `46 53 42 35`). UnityPy's `extract_audioclip_samples` → `fmod_toolkit.raw_to_wav` (FMOD lib bundled in the pre-existing venv) decodes at ~100× realtime. `pyatrac9` is **not on PyPI** — irrelevant here since there is no ATRAC9.

## 4. Honest caveats — what needed tricks vs. what's imperfect

1. **Animation slopes dropped.** Streamed keys carry cubic coefficients (coeff[0..2] → in/out slopes); clips.json exports times+values only (per deliverable format). Between-key interpolation will be linear unless Phase 2 either (a) exports the coefficients and implements Hermite evaluation, or (b) **bakes to uniform 30 Hz samples** (clips are 0.2–3.2 s → ≤96 frames × ~32 transforms; trivially small). Recommend (b) for gameplay fidelity with (a) as fallback for cutscene-quality curves.
2. **`_BumpMap` is grayscale, not tangent-space RGB.** Decoded kuri_00_Normal has R≈G≈B (σ≈26) on all channels — a height/bump-style map, not an OpenGL-style normal map (B would be ≥128-biased). The game's shader (external ref in `main_assets`; material params match Unity **Standard**: _BumpScale=1, _Glossiness=0.5, _Metallic=0) presumably derives normals from it, or it is simply soft detail. Phase 2: either derive normals offline (Sobel → RGB) or skip normal mapping initially — cosmetic only.
3. **Color-space.** `kuri_00_Color` has m_ColorSpace=1 (linear) — exported PNGs hold linear values. For three.js, mark albedo `SRGBColorSpace` after applying sRGB encoding (or accept slightly darker art until tuned). Normal/Metal/AO stay linear.
4. **Quaternion norms** in streamed data slightly exceed 1 (max 1.0008) — normalize on load.
5. **Only LOD0 exported** (`--lod N` parameterized; LOD1–4 are the same code path). For web, LOD0-only is likely fine at PJM2 camera distance; LOD2 could halve fill cost for crowds.
6. **Shader name unresolved** (PPtr crosses into `main_assets` bundle) — material params strongly indicate Standard shader; a PBR-metallic-roughness web shader with (albedo, metallic-roughness, AO, normal) maps is a faithful approximation.
7. **Particles not covered.** enemies bundle has 165 ParticleSystem/Renderer (death puffs, on-fire FX). Separate Phase-2 workstream (typetree → custom WebGL emitter), out of scope for this spike.
8. **Skinning math assumption verified:** mesh node global transform is identity (`meshNodeGlobalIsIdentity: true`), so IBMs = mirrored Unity bindposes work directly in three.js/Babylon without double-transform. The extractor warns if a future enemy violates this.

## 5. Coordinate convention (implemented + documented in outputs)

Unity (left-handed, Y-up, Z-forward) → glTF (right-handed, Y-up, −Z-forward), mirroring across the YZ plane:
- positions/normals/translations: `(x,y,z) → (−x,y,z)`
- quaternions: `(x,y,z,w) → (x,−y,−z,w)`
- tangents: `(x,y,z,w) → (−x,y,z,−w)` (mirror + handedness flip)
- matrices M (incl. inverse bind poses): `S·M·S`, S=diag(−1,1,1,1) (negate row 0 and column 0, keep e00)
- triangle winding reversed `(a,b,c) → (a,c,b)`; UV `v → 1−v`
- **clips.json intentionally keeps raw Unity values** (lossless source of truth); apply the same rules at load (documented inside the JSON).

## 6. Timing & extrapolation

Measured (kuri_00_001, warm cache): bundle load 2.2 s (once per bundle) + **4.8 s per enemy** (GLB <1 s, textures ≈4.3 s, clips 0.2 s, manifest <0.5 s).

| Workload | Basis | Estimate |
|---|---|---|
| 57 enemies | 7 s each incl. load amortized, ~15 MB PNG each | **~7 min compute**; ~850 MB PNGs → needs compression pass (§7) |
| 21 towers (structures) | 148 MB bundle: 219 SMR, 111 Animator, 104 clips, 136 meshes — same rigged pattern as enemies | **~5 min** with the same extractor (may need PrefabLoader variants — verify first tower) |
| 17 stages | **different beast**: 1.17 GB, 137,621 objects, 12,663 MeshFilters (static), 2,740 LODGroups, 3,357 Animators (moving parts), colliders everywhere | Extractor must be extended for static scenes (MeshFilter path, per-stage prefab enumeration, dedup, scene assembly). **Days of pipeline work, minutes-to-tens-of-minutes compute per stage** |
| Audio (all bundles) | 340 clips found; ~0.1 s/clip decode | **~1 min** for WAV; Vorbis BGM ideally remuxed to .ogg not WAV (§7) |

## 7. Phase-2 pipeline risks & recommendations

1. **[SOLVED-path] Enemies+towers:** run `extract_character.py` over the 57-enemy roster (names in `decomp/data/enemy_roster.json`; EnemyBase path_ids match by `__path_id` — the old `__gameObject` field in `enemies_EnemyBase.json` is null due to a UnityPy API change, don't rely on it). Dedup shared meshes/textures by path_id across variants (kuri_00…kuri_07 likely share textures).
2. **[HIGH] Texture weight:** 4×2048² PNG ≈ 14 MB/enemy is unacceptable for web. Source data is *already BCn* → repack to **KTX2** (BC7/BC5 for desktop-WebGL2 via `WEBGL_compressed_texture_s3tc`, or ETC1S/UASTC-Basis for universal) with `toktx`/`basisu`; or downscale to 1024² + atlas per enemy family. Biggest single win: ~90% byte reduction.
3. **[HIGH] Stages:** the 1.17 GB stages bundle needs its own extractor phase: per-stage root discovery, static-mesh merge/instancing, collider export (already have tools/colliders workstream), moving-platform animators. Budget real engineering time here; the enemy pipeline does not transfer 1:1.
4. **[MED] Animation runtime:** bake clips to 30 Hz per-transform tracks (see §4.1) into the GLB (glTF animations) or a companion binary; implement root-motion for walk cycles (clips carry `m_StartX/m_StopX` root delta + 4 unnamed Animator float channels — CRC-hashed attribute IDs, name unknown; likely root-motion/muscle extras, safe to ignore initially since gameplay code drives movement).
5. **[MED] Audio packaging:** SFX ADPCM→WAV→ re-encode **Opus/OGG** (WAV is 10–20× bigger); BGM Vorbis should be **remuxed FSB5→.ogg** losslessly (vgmstream-cli does this; or decode→Opus via ffmpeg). Keep `fmod_toolkit` as the pure-Python fallback (proven here). No system packages were installed for this spike.
6. **[MED] Particles/VFX:** 165 systems in enemies alone. Write a typetree→JSON emitter exporter (Unity ParticleSystem curves → web GPU/CPU emitter); art direction can simplify.
7. **[LOW] Robustness:** extractor currently asserts one SMR material slot and Triangles topology (both true for kuri); add fallbacks (multi-material primitives, quad/strip topology already handled by MeshHandler.get_triangles) before batch runs. Also handle enemies whose visual prefab may use MeshFilter (static parts) — inventory JSON will show it.
8. **[LOW] Legal/provenance:** keep manifest sha256 chain (source bundle → outputs) as done here; all tooling reads game files read-only.

## 8. Reproduction

```bash
cd /srv/opencode/ps3-pixeljunk-monsters2
# full enemy extraction (~7 s):
PYTHONPATH=pjm2-web/tools/assets/pylibs /srv/opencode/venv-unity/bin/python \
  pjm2-web/tools/assets/extract_character.py kuri_00_001 \
  game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/enemies \
  pjm2-web/.work/asset-spike/kuri --pid -8793958820917259005
# validation:
PYTHONPATH=pjm2-web/tools/assets/pylibs /srv/opencode/venv-unity/bin/python \
  pjm2-web/tools/assets/validate_outputs.py pjm2-web/.work/asset-spike/kuri
# audio probe:
PYTHONPATH=pjm2-web/tools/assets/pylibs /srv/opencode/venv-unity/bin/python \
  pjm2-web/tools/assets/probe_audio.py pjm2-web/.work/asset-spike/audio enemies globalsettings
```

## 9. Bundle census (for scope planning)

| Bundle | Size | Objects | Key contents |
|---|---|---|---|
| enemies | 431 MB | 25,312 | 295 Mesh, 472 SMR, 293 AnimationClip, 195 Texture2D, 175 Avatar, 165 ParticleSystem, 81 AudioClip |
| structures | 148 MB | 3,096 | 219 SMR, 136 Mesh, 111 Animator, 104 AnimationClip, 86 Texture2D (towers = same rigged pattern as enemies) |
| stages | 1,173 MB | 137,621 | 12,663 MeshFilter + 12,639 MeshRenderer (static), 3,357 Animator, 2,740 LODGroup, 5,577 CapsuleCollider, 2,900 BoxCollider, 18,292 MonoBehaviour |
| nature | 141 MB | 2,827 | 405 MeshFilter/MeshRenderer, 210 Mesh, 102 Animator |
| props | 15 MB | 1,870 | 146 MeshRenderer, 112 ParticleSystem, 41 AudioClip |
| globalsettings | 308 MB | — | 259 AudioClip (238 ADPCM + 21 Vorbis, 120 MB sample data), UI/global assets |

---

## Appendix A. Discovery run-log (probes)
- [x] Env verified: UnityPy 1.25.4 (venv-unity), texture2ddecoder 1.0.6, Pillow 13, fmod_toolkit 0.1.3 + pyfmodex present; installed to tools/assets/pylibs: pygltflib 1.16.5, trimesh 5.2.1, numpy 2.5.5. pyatrac9 NOT on PyPI (n/a — no ATRAC9 in game).
- [x] enemies bundle loads: 25,312 objects. Note: UnityPy 1.25.x `env.objects` is a **list** (not dict) — build `{o.path_id: o}` index; old decomp scripts' `env.objects[pid]` pattern silently fails.
- [x] kuri_00_001 = LOGIC prefab; visual via PrefabLoader.prefabList[0] → kuri_00_pa (3480807883727852411).
- [x] Mesh kuri_00_comp_LOD0: 3367 verts, 17742 u16 indices, 1 submesh, m_Skin[3367], m_BindPose[28] ↔ SMR m_Bones[28]; Unity serialization version 5.6.5.
- [x] Material kuri_00_m: Standard-shader param set; 4 textures DXT1/DXT5 2048² inline, 12 mips; normal map grayscale (§4.2).
- [x] Controller kuri_ctrl: 16 unique clips + 4 name-matched extras found in bundle (kuri_damage, kuri_drown_die, kuri_dieBig_1stBounce, kuri_dieBig_2ndBounce) = 20 exported.
- [x] Avatar kuri_00_compAvatar: GENERIC (m_HumanBoneIndex all −1, empty human skeleton); m_TOS stripped → CRC32 path recomputation (all resolved).
- [x] StreamedClip frame layout verified against m_ValueArrayDelta (frame-0 values match m_Start exactly); ±FLT_MAX sentinel frames confirmed.
- [x] Audio: FSB5 magic in .resource data; ADPCM(2)/Vorbis(1) enums; fmod_toolkit decodes both; durations match metadata.

## Appendix B. Tool run logs (appended live by the tools)
- [21:47:27] extract_character.py START prefab=kuri_00_001 bundle=…/enemies out=.work/asset-spike/kuri (first run — crashed on abs(tuple) bug in identity check, fixed)
- [21:47:51] second run — STAGE B crashed mid-way? no: completed A,B then identity-check TypeError; re-run after fix
- [21:51:06] extract_character.py START (final clean run)
- [21:51:08]   STAGE A ok: components.json (2 logic + 40 visual nodes)
- [21:51:08]   STAGE B ok: kuri_00_001.glb 289280 bytes — 3367 verts, 5914 tris, 28 joints, tangents=True, unity=5.6.5, meshNodeIdentity=True
- [21:51:12]   STAGE C ok: 4 PNGs (14,140,197 bytes), 0 errors; DXT1/DXT5
- [21:51:13]   STAGE D ok: clips.json 1882 KB — 20/20 clips, 35,938 keyframes, 0.2 s
- [21:51:13]   STAGE E ok: manifest.json (9 files); DONE in 7.0 s
- [21:51:40] components.json EnemyBase cross-ref fixed (match by __path_id) — re-run, validated present (maxLife=300, speed=0.836, expValue=10)
- [21:52:27] audio-probe: enemies 81 clips ADPCM 44.1k stereo, 6.1 MB, FSB5; decoded sfx_bossberomonokuma_bigdamage → WAV 794 KB (4.50 s ✓ matches m_Length)
- [21:52:29] audio-probe: globalsettings 259 clips (238 ADPCM + 21 Vorbis incl. bgm_title), 120.3 MB, FSB5; decoded sfx_tower_dismantletower → WAV 144 KB
- [21:53] bgm_title decoded → WAV 22.6 MB (128.0 s stereo 44.1 kHz) — Vorbis path proven
- [21:54] validate_outputs.py: GLB/PNG/JSON/manifest ALL OK (see .work/asset-spike/validation.txt); previews written (preview_color_512.png, preview_normal_512.png)
