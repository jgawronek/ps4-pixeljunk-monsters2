# Prop rendering audit (3d_stage_001 world props)

Scope: all non-terrain/river/tree renderers (deco_*, home_001, stone_001, guide_001).
Source: `public/assets/stages/3d_stage_001/scene.json` (extracted from the stages/structures/props bundles).

## Material data (all 16 prop materials identical in structure)
- Shader `Standard` (Unity 5.6), `_Mode 0` (opaque), `_ZWrite 1`, Src/Dst 1/0, renderQueue -1, Cull Back.
- Keywords `_METALLICGLOSSMAP _NORMALMAP` (+`_EMISSION` on some, `_EmissionColor` = black, no emission map).
- `_Color` white, `_Metallic 0`, `_Glossiness 0.5` (unused with gloss map), `_GlossMapScale 1`, `_BumpScale 1`,
  `_OcclusionStrength 1`, `_UVSec 0`, `_SmoothnessTextureChannel 0` (smoothness = metal-map alpha), tiling 1/offset 0.
- Project color space: Linear (`PlayerSettings.m_ActiveColorSpace = 1`). Lightmap index none (no baked GI).
- Textures: Color BC1/BC3 sRGB; Normal BC3 linear; Metal BC3 (flagged sRGB, R=0, A=smoothness); AO BC1 (gray).

## Discrepancies, ranked by visual impact
1. **Normal maps decoded wrong (FIXED).** All `*_Normal` textures are DXT5nm (BC3): decoded RGB are identical gray
   (R==G==B, corr 0.997+, B mean ~127) and alpha is independent. x lives in **alpha**, y in **green**, z must be
   reconstructed. three's `normalMap` read rgb as xyz, so every prop had x=y=z=v normals (strongly tilted, wrong shading
   on hut/logs/deco). Verified: reading (A,G) gives x^2+y^2<=1 on >=98.7% of texels for every map. Fix: fragment patch
   `UnityStandardMaps.ts` = Unity `UnpackScaleNormalDXT5nm`.
2. **Smoothness ignored `_GlossMapScale` (FIXED, no visual change today: value is 1 everywhere).** Now `1 - A*scale`.
3. **`_BumpScale` and `_OcclusionStrength` not applied (FIXED, both 1.0 here).** Now `normalScale` / `aoMapIntensity`.
4. Previously fixed (verified still correct): AO reads UV0 (`ao.channel = 0`), metallic=R/smoothness=A mapping,
   sRGB flags, tangent w sign under the x-mirror, winding, LOD0 selection, shadow params.
5. Verified correct / no discrepancy: shader mode/blend/cull, tint, emission (black), UV tiling, texture color spaces
   (AO sRGB-flagged is sampled sRGB-decoded in Linear Unity, same as ours), Linear workspace.

## Not fixed / out of scope
- Terrain `Splatt_Normal_Gloss` normals use the same DXT5nm layout and are still not sampled by SplatTerrainMaterial
  (albedo-only NEAR fidelity). Same unpack applies if terrain normals are added.
- Unity Standard's exact BRDF (Disney-like diffuse term, GGX variant) vs three's physical BRDF, reflection probes and
  lighting rig differences are not analysed here (Standard behaviour is well known; no compiled-shader disassembly done).
- Screenshot comparison not obtained (software-GL probe-shot timed out); `probe-visual.cjs` = VISUAL-OK, 0 errors.

## Hut and props vs reference screenshots
Reference (PS4 original): hut = smooth warm sand clay dome (lit side ~ sRGB 206,156,90), round windows with wooden cross
frames, wooden door, soft shading. Ours (before): dark, mottled black speckles with blue sky-reflection patches.

### Root cause (found by runtime ablation, `.work/props/ablate.cjs`)
The previous DXT5nm / smoothness / metallic fixes in `UnityStandardMaps.ts` were **silently never applied**. Inside
`Material.onBeforeCompile` three 0.169 hands over the fragment source with its `#include <chunk>` directives still
unresolved (resolution happens after the hook), so the literal-text `String.replace` calls on chunk bodies matched
nothing. Unit tests passed only because they pre-expanded the chunks themselves. Effective rendering of every prop was
therefore three's default: `roughness = map.G` (Unity metal map G = 0 -> roughness 0, a mirror finish reflecting the sky
env: the blue patches), `metalness = map.B` (0), and normals decoded as raw rgb (x=y=z) = noisy speckles.
Ablation on home_001_m: removing normalMap -> glossy but smooth; removing roughness/metalness maps too -> matte, correct.
Unity data confirms the intent: Metal map R = 0, A = 0..62/255 (smoothness 0..0.24, roughness ~0.76-1).

### Verified NOT the cause (home_001 data dump, all 4 textures 2048^2)
- Material: shader Standard, `_EMISSION _METALLICGLOSSMAP _NORMALMAP`, _Mode 0, _UVSec 0, black emission, tiling 1/0.
- Tangents (Combined_Mesh_root_scene_9, submesh 153): unit length, |t.n| < 1e-3, w = -1 everywhere in Unity space; agree
  with UV derivatives on 99.9% (T) / 99.8% (cross(n,t)*w -> B) of triangles. Under our x-mirror w -> +1 gives three's
  `cross(n,t)*w` the correct bitangent: tangent basis/handedness is right. No uv1 on the mesh; AO read from uv0
  (`_UVSec 0`); AO is a clean gray occlusion map (mean 226).
- Normal map: R==G==B (=y), A (=x) independent = DXT5nm; channels show coherent dome/window relief.
- WebP repack vs PNG: mean abs error ~1 level on Normal/Color, 0 on Metal, alpha identical: no repack artifacts.
- Albedo mean (131,101,61) sRGB: tan clay; colour data is right.

### Fix
`patchUnityStandardFragment` now first expands `#include <normal_fragment_maps|roughnessmap_fragment|metalnessmap_fragment>`
with `THREE.ShaderChunk`, then applies the DXT5nm / smoothness (A*_GlossMapScale) / metallic (R) replacements. A new unit
test patches the real unresolved `ShaderLib.standard.fragmentShader`. Affects all 16 prop materials (hut, rocks, logs,
bridge, signs, deco, flowers). Debug hook added: `window.__pjm2.stageMaterial(id)`.

### Result
Before: black/blue speckled dome. After: smooth tan dome, round windows with cross frames, door, soft matte shading
(`.work/props/before0.png`, `abl_base.png` vs `abl_after.png`, `abl_wide.png`).

### Remaining difference (not fixed here)
Hut lit side is ~(131,85,34) vs reference ~(206,156,90): darker and more orange. The albedo mean is darker than the
reference lit colour, so the original relies on brighter/cooler lighting + ambient (exposure/grading/hemisphere light),
not different material data: lighting/colour-grading agent's domain. Other `onBeforeCompile` patchers
(SplatTerrainMaterial, ToonMaterial, ToonOutline, TreeView) should be checked for the same unresolved-`#include` pitfall.
Rocks/bridge/signs were not individually screenshotted (world-space baked, positions not exposed) but share the fixed path.
