# Render extras: bloom, ambient occlusion, grass, weather, skybox

Status of the rendering features that were missing after `GRADING_AND_SURFACE_ANALYSIS.md` / `ALL_STAGES_STATUS.md`.
All of them are view-only (sim hash unchanged) and individually switchable by URL flag:
`?nobloom`, `?noao`, `?nograss`, `?noweather`. Stage 1 keeps its grade; it only gains AO + grass.

| Feature | Stages | Source of truth | Port | Fidelity |
|---|---|---|---|---|
| Bloom | 4-15 (profile `m_Enabled`) | serialized `BloomModel.Settings` (intensity/threshold/softKnee/radius/antiFlicker) | `src/view/stage/PostBloom.ts` + `WaterPass.ts` | algorithm recalled from PPSv1 (not disassembled); parameters exact |
| Ambient occlusion | 1-15 (all profiles: ambientOnly, intensity 1.3, radius 0.3, sampleCount 3, downsampling) | serialized `AmbientOcclusionModel.Settings` | `src/view/stage/StageAO.ts` + `WaterPass.ts` | Kino obscurance estimator (PPSv1), forward approximation of the deferred ambient-only blend |
| Grass | 1-6 (`GrassInstanceRenderer`) | prefab + material + 74/48 placement nodes (extracted), `Nature/Grass/ProceduralGrass` ISA | `src/view/stage/GrassView.ts`, `tools/assets/extract_grass.py` | geometry, LOD rule, colour hash EXACT; wind approximated; billboards not ported |
| Weather | 4-6 sand cloud, 11 snow (10, 12: none) | `StageWeatherPlayer` MonoBehaviours + prefab particle systems | `src/view/stage/WeatherView.ts`, `tools/assets/extract_weather.py` | settings exact, renderer approximated |
| Skybox rotation | - | `RenderSettings` | nothing to port | see below |

## 1. Bloom (Unity PPSv1 `Hidden/Post FX/Bloom`)

Profile values (all stages 4-15; stage 1-3 have `m_Enabled = 0`):

| stages | intensity | threshold | softKnee | radius | antiFlicker |
|---|---|---|---|---|---|
| 4, 5, 6, 10, 11, 12 | 0.75 | 1.10 | 0.85 | 2 | 0 |
| 7, 8, 9 | 0.73 | 0.94 | 0.252 | 2 | 0 |
| 13, 14, 15 | 0.5 | 1.10 | 0.85 | 2 | 0 |

`BloomComponent.Prepare` (PPSv1): half-resolution pyramid; `logh = log2(h/2) + radius - 8`, `iterations = clamp(int(logh), 1, 16)`,
`sampleScale = 0.5 + logh - int(logh)`; `thresholdLinear = GammaToLinear(threshold)`, `knee = thr*softKnee + 1e-5`,
`curve = (thr - knee, 2 knee, 0.25/knee)`. Passes: prefilter (4-tap box, or Karis-weighted 13-tap when antiFlicker) with the soft-knee
quadratic `max(rq, br - thr)/br`, 13-tap box downsample per level, then coarse-to-fine combine `base + tent9(coarse) * sampleScale`, and in
the uber pass `colour += tent9(level0, sampleScale) * intensity` BEFORE vignette/grade (so the LUT grades the bloom).
The gameplay camera is LDR (`m_HDR = 0`), therefore the prefilter input is clamped to 1 (`min(c, 1)`), which with threshold 1.1 (= 1.23 linear)
and knee 1.05 makes a white pixel contribute only ~16% x intensity; a mid sand pixel (0.7) ~6% x intensity. That is the "subtle glow" the
original has.

Port: `BloomChain` renders the pyramid with half-float targets from the HDR scene target; the copy shader of `WaterPass` adds
`bloomColor(vUv)` before `postGrade`. Stage 1-3: no chain is created (zero cost, identical output). The cost at 1080p is 3 levels
(540x960, 270x480, 135x240) = 5 small fullscreen passes. The river pixels (drawn after the copy) do not receive bloom (the original blooms
the finished frame including water; the water is dark blue so the loss is negligible).

Measured (stage 4, 960x540 software GL, same camera/state, `?nobloom` vs default): mean luma +3.9/255, i.e. a faint lift on the bright sand and
tree highlights, consistent with the math above. NOT verified against an original stage-4 screenshot (none available; the supplied
references are stage 1). Not disassembled: the shipped `Hidden/Post FX/Bloom` GCN program was not compared instruction by instruction.

## 2. Ambient occlusion (PPSv1 `Hidden/Post FX/Ambient Occlusion`, ambientOnly)

PPSv1's AO is Keijiro's Kino Obscurance: view-space reconstruction from depth, normal from depth gradients, `sampleCount` hemisphere
samples (`faceforward` into the normal hemisphere, radius scaled by `sqrt((i+1)/N)`), per sample
`a = max(dot(v, n) - 0.002*depth, 0) / (dot(v,v) + 1e-4)`, `ao = pow(sum * radius * intensity / N, 0.6)`, depth-aware blur, `1 - ao`.
`ambientOnly = 1` in a deferred camera: the factor is blended into the ambient/indirect G-buffer term (diffuse SH probe + reflection
probe + emission), direct sun light is not darkened. Downsampling 1 = half resolution.

Port (forward renderer): 
1. After the scene render, `AoPass` estimates the factor from the RT depth texture at half resolution (3 samples, interleaved-gradient noise,
   two depth-aware 9-tap blur passes), HalfFloat RG (ao, linear depth).
2. Lit materials multiply `reflectedLight.indirectDiffuse` and `indirectSpecular` by it: the ShaderChunk `lights_fragment_end` is patched
   (`patchAoChunks`, global, idempotent, validated against the real three 0.169 chunk text by `tests/view/renderExtras.test.ts`), and the
   shared uniforms are injected through a `Material.prototype.onBeforeCompile` accessor so materials that assign their own
   `onBeforeCompile` (splat terrain, trees, toon characters, Unity standard maps) also receive them. Only the indirect terms are touched, so the
   sun-lit side is unchanged.
3. The AO buffer is one frame old (the depth does not exist before the render). Each fragment reprojects its own NDC position with
   `prevViewProj * inverse(curViewProj)` (`uAoReproj`), exact for static geometry; moving objects (coins, enemies) can show a one-frame lag.
   Disabled (`uAoOn = 0`) on the first frame and when `?noao`.

Measured (stage 1, 960x540, `?noao` vs default): mean luma -1.15/255, 2.9% of pixels darker by more than 8/255; the difference image shows
contact darkening halos around every tree base, the hut, rocks and path edges / terrain creases, which is the effect visible in the reference
screenshots (shadowed tree bases, hut skirt). The magnitude is small because the stage-1 ambient term is already
dim relative to the sun (intensity 0.5 probe); this is exactly the behaviour of ambient-only AO.
Not measured: pixel-exact agreement with the original (the deferred ambient G-buffer values, `Enlighten` indirect, are not reproducible).

## 3. Grass (`Q4.GrassInstanceRenderer`)

What the original does (IL2CPP dump `decomp/il2cpp_user/dump.cs`, serialized components, shader ISA):
* The component has `GrassModelPrefab`, `ClusterSize = 4`, `BillboardMaterial`. At start it collects the scene's grass objects
  (`GrassInstanced` markers: Transform-only nodes `grass_00N` under `Small_Props_Grass`; 74 in stages 1-3 with prefab `grass_001_pa`, 48 in
  stages 4-6 with `grass_002_pa`), clusters them by position (`ClusterGrassObjects`, clusters of 4) and every frame does frustum culling per
  cluster (`GetViewFrustumPlane`, `GetScreenAABB`) and LOD selection from the prefab `LODGroup`
  (`screenRelativeHeight` 0.147 / 0.096 / 0.023; meshes `GrassProc_LOD0..2` = 180 / 100 / 60 vertices, 540 / 300 / 180 indices; size 0.774).
  LODs are drawn with `Graphics.DrawMeshInstanced` through per-camera `CommandBuffer`s; below the last LOD a render-to-texture billboard
  (`m_bb_rts`, `BillboardPostProcess`, `RenderGrassSlice`) is drawn instead.
* Material `Nature/Grass/ProceduralGrass` (deferred pass, 36 sub-programs; blob 0 vertex = ISA 0xe0-0x6a0). Verified from the ISA:
  per-vertex albedo `lerp(_GrassColor1, _GrassColor2, fract(sin(12.9898*worldX + 78.233*worldZ)*43758.5))` exported to the G-buffer;
  fragment multiplies by `_Tex` (null) and writes specular 0 / smoothness 0 (matte); fake AO `1 - (_FakeAOHeight*(1-h))^_FakeAOSharpness`
  with `_FakeAOHeight = 0` in both materials (no effect); alpha clip 0.5. Vertex colour `.r` is the wind weight (= blade height 0..0.57).
  `_GrassColor1/2` = (0,1,0.338)/(0.156,0.662,0.18) for stage 1-3, (0.679,0.713,0.089)/(0.878,0.581,0) for stage 4-6 (autumn).
  Wind floats: main f/s/strength 2.2/2/2.5, noise 1.25/5/0.5, angle 0.52.

Port: `tools/assets/extract_grass.py` -> `public/assets/grass/grass.json` (meshes, thresholds, material values, per-stage placements);
`GrassView` creates three `InstancedMesh` (one per LOD, `MeshStandardMaterial` roughness 1 / metalness 0, DoubleSide, receives shadows,
no cast), recomputes the LOD of each instance every 8 frames from the camera distance with the LODGroup rule
(`size / (2 d tan(fov/2))`), applies the exact colour hash in the vertex shader. `?nograss` skips it.
Deviations (UNVERIFIED / not ported):
* Wind: the grass vertex program uses several stacked sin products (phases 5x/7x/25x, constants 0.25/0.2/0.02/1.1) that were not decoded;
  the port uses the SolidTree main+noise formula (already ISA-verified for trees) with the grass material parameters and a strength scaled by
  0.05. Amplitude/phase therefore differ from the original.
* Billboards: instances below the LOD2 threshold keep LOD2 (the camera distance of the shipped framing is LOD1-2, so this only matters when zoomed far out).
* Instance culling per cluster is not needed (<= 74 instances x <= 180 vertices).

## 4. Weather (`Q4.StageWeatherPlayer`)

`StageWeatherPlayer { weatherEffectPrefab, playbackIntervalMin/Max }`, update loop: a timer reaches a random threshold in
[min, max], `SetupWeatherEffect(camTarget)` plays the prefab at the camera target, threshold regenerated.
* Stages 4, 5, 6: prefab `ef_env_sand_cloud_pv` (stages bundle shared assets pid 2676 + a `WindZone` child), interval 10-60 s.
  `ps_env_sand_cloud`: 1 s non-looping, world space, coneVolume angle 0 radius 15 (flat disc) at y = 0.1 (rotated -90 deg X), rate 32-64/s + burst 8-16,
  lifetime 5-15 s, size 5-15, speed 0, gravityModifier -0.0005..0 (drifts up), colour (0.62,0.39,0.22) x 0.588, alpha 0 -> 0.125 (t=0.2) -> 0 (t=0.8);
  shader `Particles/Alpha Blended`, `vfx_white_smoke_m`. A low-opacity dust haze over ~30 units that lingers 5-15 s.
* Stage 11: `ef_env_snow_area_pv` (20-60 s): `ps_env_snow_area` 20 s, disc radius 10 at y = 8 (rotated +90 deg X), rate 32-64, lifetime 8-12 s, size 0.05-0.1,
  gravityModifier 0.008-0.015 (slow fall), alpha 0 -> 1 (t=0.1) -> 1 (0.9) -> 0, no texture (solid camera-facing quad).
* Stages 10 and 12: the component exists but `weatherEffectPrefab` is NULL (m_PathID 0): no weather. (The earlier audit's "10-12 weather" is only stage 11.)
  Leaves/rain/embers do not exist in the shipped stage data; only these two effects (plus stage 0 hub entries).

Port: `tools/assets/extract_weather.py` -> `public/assets/particles/weather.json` (same record schema as particles.json + player intervals + stage map);
`WeatherView` is a dedicated Points pool with per-particle size and alpha (the shared effect pool fades by darkening and uses a fov-less size
formula), the same timer, disc spawn, gravity and alpha-over-lifetime; the effect follows the player (camera target) while emitting.
Approximations: soft-dot sprite instead of `vfx_smoke` / solid quads, `twoGradients` uses the extracted gradient, no WindZone, no interaction with
the water-grab limitation (particles over the river are covered by the water pass, same as all other particles).

## 5. Skybox rotation / other environment extras

* `skybox_0N_m._Rotation = 248` (stages 1-3, 13-15) is only meaningful for geometry that samples the skybox; every gameplay camera clears to a flat
  colour (`CameraClearFlags.SolidColor`, see `SkyAtmosphere.ts`), no sky dome exists, and the water uses its own `_SkyMap` cube without rotation.
  The ambient SH probe and the reflection probe are baked from the already rotated skybox, so rotating anything at runtime would be wrong. Nothing to port.
* Fog: `RenderSettings.fog = false` in all 16 environment records; the profile's fog flag is gated by it. Nothing to port.
* The per-stage table already feeds ambient, grade, clear colour, camera and shadows; bloom and AO are now consumed through
  `src/view/stage/renderExtras.ts` (`renderExtrasFor(env, query)`).

## Files

`src/view/stage/PostBloom.ts`, `StageAO.ts`, `renderExtras.ts`, `GrassView.ts`, `WeatherView.ts`; `WaterPass.ts` (extras param);
`src/main/stageSession.ts` (4 small hooks); `tools/assets/extract_grass.py`, `extract_weather.py`; data `public/assets/grass/grass.json`,
`public/assets/particles/weather.json`; tests `tests/view/renderExtras.test.ts`; probes `.work/extras/shot.cjs` (+ `diff.cjs`).
