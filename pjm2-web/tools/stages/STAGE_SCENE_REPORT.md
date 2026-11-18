# STAGE SCENE EXTRACTION — `3d_stage_001` (the true first level)

**Status: COMPLETE — validated.** Static scene graph for `3d_stage_001`
(= `tl_area_001` / `tl_stage_001`, attribution per `decomp/data/stage_scene_attribution.json`)
extracted from the shipped `stages` AssetBundle into a Three.js-loadable scene graph:
full GameObject hierarchy + local transforms + mesh binary buffers + material/texture
references (textures decoded to PNG).

Source: user's own legally-owned decrypted PS4 copy (CUSA11967, Unity **5.6.5p1**).
Game files treated strictly as **read-only data**. Scope is **stage 001 only** (the full
`stages` bundle is 1.17 GB / 137 k objects — not touched beyond this scene + the shared
assets it references).

---

## 1. Headline numbers

| Quantity | Value |
|---|---|
| Scene file | `BuildPlayer-3d_stage_001_env` (8 786 objects) |
| Nodes (GameObjects) | **2 399** — full hierarchy, 8 roots, valid forest |
| MeshFilter + MeshRenderer pairs | 863 (all recorded) |
| **Renderable** renderers (LOD0 + active + enabled) | **198** (~385 k triangles) |
| LODGroups | 183 (LOD1–4 recorded, not rendered) |
| Unique meshes | **16** (10 static-batch combined, 2 collision-area, 2 collider-only, 2 builtin) |
| Unique materials | **19** |
| Unique textures | **77** (40 BC1, 36 BC3, 1 BC6H; 47×2048², 30×1024²) |
| Lights | 4 (1 main directional + 2 "Lim" directionals + 1 point) |
| `terrain_001` parity | **PASS — 10 960 verts / 21 785 tris** (matches collider spike) |
| Independent reload validation | **PASS — 0 errors / 0 warnings** |

### Output sizes
| Artifact | Size |
|---|---|
| `scene.json` | 1.14 MB |
| `meshes/*.bin` (80 files) | 38.8 MB |
| `textures/*.png` (77 files) | 198.8 MB |
| **Total** | **238.8 MB** (229 MiB on disk) |

> ⚠️ Texture weight is the dominant cost (native-resolution PNG). This is the raw
> extraction deliverable; **repack to KTX2/BCn or downscale before shipping to the web**
> (see SPIKE_REPORT §7). Not done here — task asked for decoded PNG.

---

## 2. Outputs & provenance

```
pjm2-web/public/assets/stages/3d_stage_001/
  scene.json            nodes + mesh/material/texture refs + lights + validation
  manifest.json         counts + full per-asset source provenance + sha256 + re-run cmd
  meshes/<id>.{pos,nrm,uv0,tan}.f32.bin + <id>.idx.u32.bin
  textures/<id>.png
decomp/data/stage_scene_manifest.json   (canonical manifest copy)
pjm2-web/tools/stages/extract_stage_scene.py     (extractor)
pjm2-web/tools/stages/validate_stage_scene.py    (independent reload validator)
```

Binary format matches the collider extractor: little-endian raw `f32` vertex channels
(pos vec3, nrm vec3, uv0 vec2, tan vec4) and `u32` index buffer, **no headers**. Counts /
submesh ranges live in `scene.json`. Mesh vertices are **not pre-scaled** — local transforms
are stored and the loader composes (per the scene-graph task).

Cross-bundle PPtrs resolved by loading aux files: `structures` (home_001 material/textures),
`props` (stone_001), `nature` (terrain/river **shader names**), `Resources/unity default
resources` (builtin Cube/Sphere). Full per-asset `sourceFile` + `pathId` is in both
`scene.json` and the manifest.

**Re-run:**
```bash
/srv/opencode/venv-unity/bin/python pjm2-web/tools/stages/extract_stage_scene.py 3d_stage_001
/srv/opencode/venv-unity/bin/python pjm2-web/tools/stages/validate_stage_scene.py
```
(~71 s extract, ~5 s validate.)

---

## 3. THE key discovery: Unity static batching

Most stage props are **combined at build time** into 10 `"Combined Mesh (root: scene)"`
assets. This is the make-or-break detail for stages (the enemy pipeline does not hit it):

- Each batched `MeshRenderer` carries **`m_StaticBatchInfo {firstSubMesh, subMeshCount}`**
  — the exact submesh slice of the combined mesh it draws. (1:1 with submesh count.)
- Combined-mesh vertices are **baked in WORLD space** (`m_StaticBatchRoot == 0` for every
  batched renderer). The authored GameObject transforms are kept in the file but are **not
  applied at draw time**.
- **Verified geometrically:** a prop's submesh bbox contains its GameObject world position
  (pivot-inside-bbox; x/z align to ~0.02, vertical offset = pivot-at-base for tall props).

**Loader rule:** for `render.worldSpace == true`, draw the mesh at **IDENTITY** and slice
`subMesh = {first, count}`; do **not** apply the node transform. For non-batched renderers
(`subMesh == null`), compose the node world transform and draw the whole mesh. Each combined
mesh is exported **once** (all submeshes, all LODs); the `subMesh` slice + `lodLevel` filter
select the right piece.

---

## 4. Conventions (established — KEEP)

- **Coordinates:** Unity **left-handed Y-up kept AS-IS**. The renderer converts to RH later
  (same mirror as the character spike: x→−x, quat (x,−y,−z,w), winding flip, uv v→1−v). Never
  convert sim/physics data. **Triangle winding preserved** (verified vs baked normals in the
  collider spike).
- **Color space (corrects SPIKE_REPORT §4.3):** `Texture2D.m_ColorSpace` **1 = sRGB/gamma**
  (albedo), **0 = linear** (normal maps). Confirmed empirically (normals cs=0 mean≈127.5).
  PNGs hold **raw** decoded values. three.js: `texture.colorSpace = SRGBColorSpace` iff
  `colorSpace==1` else `NoColorSpace` — reproduces Unity's GPU sampling exactly, **no manual
  re-encode**. (The spike labelled cs=1 "linear"; that was a misread.)
- **Texture orientation:** UnityPy decodes with a vertical flip (upright PNG). With three.js
  default `flipY=true` + Unity UVs (v=0 bottom), orientation is correct. **Do not flip again.**

---

## 5. LOD policy

`render.lodLevel` ∈ {0..n, null}. **Render only `lodLevel==0` or `null`** (non-LOD). Higher
LODs are recorded for completeness but skipped. 183 LOD0 renderers + 15 non-LOD enabled =
198 renderable. Combined meshes contain all LODs' geometry; the slice+filter picks LOD0.

---

## 6. Terrain

- **Visual terrain** = 13 chunk renderers named `Mesh (xxxx)` (4-bit mask), material
  `terrain_001_m`, static-batched into combined meshes 6/7/8. ~15 411 verts / **21 959 tris**
  (≈ collider's 21 785 — parity confirms coverage of the play area).
- **`terrain_001`** (10 960 verts / 21 785 tris) is **collider-only** (`MeshCollider` on
  "terrain_001 (Optimized)"); exported flagged `colliderOnly` for physics cross-check, not
  rendered. `terrain_001_player_col` / `_camera_col` are collision-area meshes with
  **disabled** renderers (recorded, not renderable).

---

## 7. Limitations / skipped (explicit)

| Category | Count | Handling |
|---|---|---|
| MonoBehaviour (gameplay scripts) | 1 193 | skipped (not static rendering) |
| Animator | 192 | flagged on nodes; **animation not exported**. 2 visible animated renderers: `terrain_001_river` (UV flow) + `stone_001_base`. Static pose only. |
| Colliders (box/sphere/capsule/mesh) | 633 | presence flagged per node (`node.colliders`); cross-ref physics-spike JSON. Mesh-collider meshes exported `colliderOnly`. |
| Camera / GUILayer / FlareLayer / AudioListener | 15/10/10/3 | skipped |
| LOD1–4 renderers | 612 | recorded, not rendered |
| Inactive GameObjects | 40 | recorded (`activeInHierarchy=false`), skipped by loader |
| Disabled renderers (builtin Cube/Sphere debug + col areas) | 53 | recorded (`enabled=false`), meshes exported but not renderable |
| ParticleSystem | 0 | none in this scene file |

**Rendering fidelity gaps (Phase-3 workstreams):**
1. **Custom shaders** — `terrain_001_m` = **`Shader Forge/Splatt_Normal_Gloss`** (4-way R/G/B/Base
   splat, per-channel color/gloss/normal) and `terrain_001_river_m` = **`Nature/Water`**
   (flow map + sky reflection). `MeshStandardMaterial` can't reproduce these; need custom
   `ShaderMaterial`. Initial fallback: sample `_Base_Color` (terrain) / a flat water color.
   All other 17 materials are Unity **Standard** (PBR metallic-roughness maps present).
2. **Lightmaps / GI not exported** (`LightmapSettings` + `GI/` data exist; static lightmap index
   65535 = none, dynamic lightmap tiling present). Scene will look flatter without baked GI.
3. **BC6H** `sky_test_003` (river `_SkyMap`) is HDR clamped to LDR PNG by the decoder — minor
   (reflection only).
4. **Animations** (river flow, stone motion, 192 animators) — separate Phase-3 workstream.

---

## 8. How the Phase-3 loader should consume it

1. Fetch `scene.json`. Create a `THREE.Group`/`Object3D` per node; set
   `position/quaternion/scale` from `node.pos/rot/scale` (Unity LH as-is; apply the established
   LH→RH mirror at the renderer layer). Link parents via `node.parent` index.
2. For each node with `render`: **skip** if `!activeInHierarchy`, `!render.enabled`, or
   `render.lodLevel ∉ {0, null}`.
3. Load mesh bins → `BufferGeometry` (pos/nrm/uv0/tan + idx), **cache by mesh id** (shared).
   - `render.worldSpace==true`: draw at **identity**; build a per-submesh geometry by slicing
     `submeshes[render.subMesh.first]` indices and remapping vertices; cache by
     `(meshId, subMesh.first)`. **Attach these meshes to a root-level group, NOT under the
     node's transformed Object3D** (the authored node transform must not leak in). Keep the
     node hierarchy intact for logic/semantics; only the batched *draw* is root-relative.
   - else: apply composed node world transform; use the whole mesh.
4. Build `MeshStandardMaterial` from the material record: `map=_MainTex`, `normalMap=_BumpMap`,
   `metalnessMap/roughnessMap=_MetallicGlossMap`, `aoMap=_OcclusionMap`, `emissiveMap=_EmissionMap`;
   `color=_Color`, metalness/roughness from `floats`. Set each texture's `colorSpace` per §4.
   For the 2 custom-shader materials use a fallback albedo until a custom shader lands.
5. Load PNGs with `flipY=true` (default); `colorSpace` per §4; wrap/repeat per material scale/offset.
6. Add the 4 lights from `lights[]` using their node transforms.
7. Physics: ignore `render`; use `node.colliders` flags + the existing
   `.work/physics-spike/3d_stage_001_colliders.json` (and `colliderOnly` meshes) for the Rapier world.

---

## 9. Validation (re-runnable)

`validate_stage_scene.py` independently re-reads the outputs (no UnityPy): hierarchy forest
valid; every mesh/material/texture ref resolves; bin element counts match meta; indices in
range; submesh slices partition the index buffer; **terrain_001 = 10 960 / 21 785 PASS**; all
77 PNGs open at recorded size with real content; manifest counts agree. **Result: PASS, 0 errors.**
The extractor also self-checks refs, submesh ranges, `worldSpace⇒combined`, and the
world-bake pivot-inside-bbox spot check (all pass).
