# Reflection probe, indirect specular and the "lilac lift" (stage 1)

Follow-up to `LIGHTING_SATURATION_ANALYSIS.md`. Tools: `tools/stages/bc6h_hdr.py` (HDR BC6H decoder, half-float; the stock
`texture2ddecoder.decode_bc6` clamps to 8 bit), `tools/stages/extract_reflection_probe.py`, `.work/lgt/*` (scratch: shader dumps,
forward model `fwd2.ts`, SH check `shcheck.py`, edge-continuity search `edges2.py`).

## 1. What the shipped data does and does not contain
* `LightmapSettings` (pid 7408): `m_LightmapsMode 1` (directional), `m_Lightmaps []`, `m_GISettings` bounce 1.0 / indirect output 1.0 /
  albedo boost 1.0, `EnlightenSceneMapping`: 863 renderers listed 197 dynamic, 23 systems, ONE 1024 atlas, 1 probe set, 0 terrain
  chunks. Every field is a 16-byte HASH (`inputSystemHash`, `radiositySystemHash`, `atlasHash`, `instanceHash`): the precomputed
  radiosity / form-factor blobs those hashes key (Library/ GI cache) are **not in any bundle or in the PS4 package** (searched all
  bundles; `LightProbes` pid 3 holds only the tetrahedralisation, `m_BakedCoefficients` empty). Enlighten output therefore cannot be
  reproduced from data; only its inputs (lights, albedo, skybox) exist.
* All 13 terrain chunks (`Mesh (0010)` ... `Mesh (1010)`, `Combined_Mesh_root_scene_6/7` submeshes) have `m_LightmapIndexDynamic 0`
  with a dynamic-lightmap scale/offset, so Unity renders them with the `DYNAMICLIGHTMAP_ON` + `DIRLIGHTMAP_COMBINED` deferred variant
  of `Splatt_Normal_Gloss` (fragment blob 508: 2 extra full-rate samples = realtime lightmap + directionality; blob 504 is the
  no-GI variant the earlier analysis disassembled).
* Bound on what GI could do: vertex weights of the terrain are exactly (0,255,0)/(255,0,0)/(0,0,255)/0 (8383 / 2900 / 61 / ... vertices),
  so grass albedo is pure moss (lin 0.022, 0.20, 0.006). A lift of +0.10 in R and +0.06 in B on grass would need irradiance 5-10x
  the sun: **no bounce/indirect-diffuse term can produce it** (it multiplies the albedo). Only specular/reflection (albedo independent)
  can. => The lilac lift is not Enlighten.
* The baked `ReflectionProbe` (pid 7592): `m_Type 0` box 133.6 x 31.1 x 136.9 centred on the stage, `m_HDR True`, `m_Resolution 128`,
  importance 1, `m_BoxProjection False`, `m_IntensityMultiplier 1`; `m_BakedTexture` = `Cubemap ReflectionProbe-0` (BC6H 128px, 8 mips,
  21872 B/face incl. mips) in `BuildPlayer-3d_stage_001_env.sharedAssets`. `RenderSettings`: `m_DefaultReflectionMode 1` (custom
  skybox cube), `m_ReflectionIntensity 1`, `m_ReflectionBounces 1`. The whole playfield is inside the box, so every object reflects
  the BAKED PROBE (not the skybox face our PMREM used).

## 2. The terrain shader consumes it (ISA, blob 504 and 508)
Both deferred variants contain `s_mov_b32 lit(1.7)`, `lit(0.7)`, `v_mul_f32 lit(6.0)` (= `Unity_GlossyEnvironment`:
`mip = pr*(1.7-0.7*pr)*UNITY_SPECCUBE_LOD_STEPS(6)`), two `image_sample_l` with cube coordinates (`v_cubeid/cubesc/cubetc/cubema`
= SpecCube0/SpecCube1 blend) and `lit(0.96)` (`oneMinusDielectricSpec`). That is the standard Unity 5.6 G-buffer pass:
emission = `albedo*0.96*GI + surfaceReduction*probe(R,mip)*FresnelLerp(F0, grazing, nv)`.

## 3. HDR decode and cube layout (new, verified)
* BC6H (unsigned) decoder: 99.9 % of texels equal `texture2ddecoder` after clamping; the 2 differing blocks (of 6144) are in a mode
  where the reference returns R >= 1 on a green ground texel (reference bug). Peak radiance (sun texel) = 3.0e4 (13792, 9576, 6652).
* Face layout: for each face all 8 (axis, sign) orientations were searched, scoring continuity across the 12 cube edges
  (`edges2.py`): the best of 8^6 combinations is exactly the standard GL/D3D layout (+X u->-z v->-y, -X u->+z v->-y, +Y u->+x v->+z,
  -Y u->+x v->-z, +Z u->+x v->-y, -Z u->-x v->-y; rows top first).  Sun in Unity world: (-0.64, 0.71, +0.29).
* **SH sign bug found on the way**: projecting this probe onto real SH in Unity world axes gives
  `[2.59 2.29 0.90 -1.88 -3.02 1.42 -1.49 -1.24 -0.12]` vs the baked `m_AmbientProbe` R `[0.856 0.739 0.277 -0.592 -0.942 0.446
  -0.130 -0.405 -0.018]`: ratio 3.0-3.3 on every coefficient (3.0 = 4*pi*Y00 * mean-ratio), ALL signs equal, z NOT flipped
  (UnityCG packs `unity_SHAr = (sh[3], sh[1], sh[2], ...)` = x, y, z). `StageAmbient.SIGN_FOR_THREE` also negated z, yz (and kept xz +)
  because an earlier check "lobe points at the directional light" was made against the wrong target (the skybox sun is not the
  Directional Light: Unity z +0.29 vs light z -0.44). Fixed: only x-odd terms (x, xy, xz) flip for the port's x mirror.

## 4. Why it matters: numeric forward model (`.work/lgt/fwd2.ts`)
Flat ground, camera pitch 45 (view dir (0,.707,.707), mirror direction R = (0,.707,-.707) = 27 deg from the sun), the three real
lights, SH x 0.5 ambient, Unity Standard BRDF (GGX, `V*D*pi`, FresnelLerp, surfaceReduction), then the shipped grade LUT:

| smoothness | probe radiance at R (mip) | sun spec | probe spec | grass (moss) | path (soil) | S grass / path |
|---|---|---|---|---|---|---|
| diffuse only | - | 0 | 0 | (89,217,26) | (205,90,27) | .88 / .87 |
| 0.036 (sRGB gloss, current) | (1.22,1.03,0.83) @5.93 | (.023,.019,.009) | (.026,.022,.018) | (135,226,70) | (219,125,62) | .69 / .72 |
| 0.21 (gloss read raw) | (0.86,0.75,0.64) @5.44 | (.039,.033,.017) | (.025,.022,.019) | (144,228,80) | (222,135,72) | .65 / .68 |
| reference (various patches) | | | | (89,151,55) | (194,126,65)..(229,162,99) | .64 / .66 |

Gloss: all `*_Gloss` are `m_ColorSpace 1` (sRGB) so Unity linearises them: smoothness stays 0.036 (not 0.21). The raw-vs-sRGB choice
moves S by only ~0.04, so it is not the main cause either way (kept 0.036: it is what the importer flag says).

## 5. Port
* `tools/stages/extract_reflection_probe.py` -> `public/assets/stages/<scene>/probe/reflection_probe.{f16.bin,json}` for all 15 stage
  scenes (1.4 MB each; probe `m_IntensityMultiplier` 1.0, stages 7-9 0.5). Hooked in `tools/stages/build_stage.sh`.
* `src/view/stage/StageReflectionProbe.ts`: equirect mip DataTexture (`CubeUVReflectionMapping`, so three keeps it as
  `scene.environment`), global idempotent ShaderChunk patches (inert unless `scene.environmentIntensity < 0`, the marker; |value| =
  probe intensity): Unity LOD mapping at the un-bent reflection vector, Unity `surfaceReduction*radiance*FresnelLerp`, diffuse x
  (1 - reflectivity) = 0.96 (the `lit(0.96)` in the ISA). `stageSession.ts` loads it per `STAGE_CFG.sceneBaseUrl` right after the
  PMREM sky (fallback = stock PMREM when a stage ships no probe; `?noprobe` = A/B). Per-stage by construction (URL convention +
  per-probe intensity in the json); ambient SH keeps flowing from `StageEnvironment.ambient`.
* `StageAmbient.SIGN_FOR_THREE` fixed (z no longer flipped), see section 3.

## 6. Measured (640x360, stage 1 default camera, `.work/probe-lighting.cjs`, patches by `.work/patches.py`)
before = previous state (old SH signs + LDR PMREM face), mid = SH sign fix only (`?noprobe`), after = + HDR probe.
| patch | before | mid | after | reference | S before / mid / after (ref) |
|---|---|---|---|---|---|
| grass (mid) | (41,155,9) | (47,166,10) | (84,177,44) | (89,151,55) | .94 / .94 / .75 (.64) |
| grass 2 | (30,141,10) | (31,143,10) | (56,151,30) | (73,127,45) | .93 / .93 / .80 (.65) |
| path | (181,85,32) | (181,85,32) | (188,98,46) | (194,126,65) | .82 / .82 / .76 (.66) |
| path 2 | (199,99,38) | (199,99,38) | (206,114,59) | (229,162,99) | .81 / .81 / .71 (.57) |
| hut lit | (221,168,73) | (226,171,76) | (230,183,98) | (199,157,89) | .67 / .66 / .57 (.55) |
| orange crown | (249,216,73) | (250,219,77) | (251,227,102) | (245,201,95) | .71 / .69 / .59 (.61) |
| pale crown | (244,223,95) | (249,235,119) | (249,235,123) | (138,141,57)* | .61 / .52 / .51 (.60)* |
(*the pale-crown reference patch is a different, darker tree; not comparable.)
Hut and orange crown are now within 0.02 of the reference saturation. Grass and path are still 0.10-0.11 above (they were 0.30 / 0.16).

## 7. Not closed / unverified
* Remaining grass/path gap (~0.10 S, G too bright ~ +25): Enlighten indirect (data not shipped, cannot be reproduced; as shown it can only
  add albedo-proportional light), ambient-only SSAO (not ported), the realtime-GI replacement of the SH ambient on terrain (we keep
  SH x 0.5 as stand-in), and reference frames being compressed video. Gloss kept at sRGB-decoded 0.036 (importer flag), raw 0.21
  would lower S by ~0.04 in the forward model.
* Cube face layout is validated by edge continuity + SH projection (all 9 signs), not by a ground-truth frame. The two BC6H blocks
  the stock decoder disagrees on are assumed to be the stock decoder's bug.
* Unity's convolved mips are used as shipped (equirect resample of the seamless cube chain, 512x256 at mip 0 vs 128px cube faces).
* The `m_DefaultReflectionMode` custom cube (skybox) is not used for objects outside the probe box (none exist on the playfield).
