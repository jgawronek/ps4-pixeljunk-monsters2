# Stage-1 colour grading, lighting units and surface detail: what the original does

Sources: `stages` bundle (`BuildPlayer-fps_check_3d_stage_001_env.sharedAssets`), `resources.assets`
(Unity PostProcessing stack shaders), `nature` bundle (tree materials), shaders disassembled with
`tools/shaders/{gcn,sym}.py` (GCN/Sea Islands ISA, PS4), IL2CPP native code of
`Il2CppUserAssemblies.elf` (x86-64, objdump) for the CPU-side constants. UnityPy via `/srv/opencode/venv-unity/bin/python -I`.

## 1. Post-processing profile (verified)

Gameplay camera `GameCameraTopDown(Real)` -> `PostProcessingBehaviour` -> profile
`3d_stage_001_topdown_pp` (`stages` bundle, MonoBehaviour pid 172; `..._behind_pp` pid 171 and `..._shop_pp`
pid 13 are the other two cameras). Serialized, all models:

| model | enabled | values |
|---|---|---|
| colorGrading | **1** | tonemapper **1 = ACES**; postExposure **0.6** EV; temperature **10**; tint **13**; hueShift **-1**; saturation 1.0; contrast **1.07**; channelMixer identity; colorWheels.mode **1 = Log**: slope (1, .9714, .8603), power (.8285, 1, .9730), offset (.6562, .7180, 1.0), lift/gamma/gain 0; curves master/R/G/B = two-key Hermite curves (see below); hue/sat curves empty (zero 0.5) |
| vignette | **1** | mode 0 (classic), black, intensity **0.47**, smoothness **0.25**, roundness 1, rounded 0, centre (.5,.5) |
| ambientOcclusion | **1** | intensity 1.3, radius 0.3, sampleCount 3, downsampling 1, **ambientOnly 1**, highPrecision 0 |
| antialiasing | 1 | FXAA preset 2 |
| fog | 1 | excludeSkybox 1, but `RenderSettings.m_Fog = false` gates it (stage scene) -> inactive |
| bloom | **0** | intensity .5 / threshold 1.2 authored, disabled |
| screenSpaceReflection, depthOfField, motionBlur, eyeAdaptation, userLut, chromaticAberration, grain, dithering | 0 | disabled |

Curves (key time 0 -> 1, value 0 -> 1, tangents in/out equal): master 1.5331 / 0.03352, red 1.1159 / 0.29372,
green 1.0255 / 0.18304, blue 0.8420 / 0. Master at 0.5 = **0.687** (strong mid-tone lift = the "lifted soft shadows").
The earlier note ("ACES + 0.6 EV, vignette/SSAO follow-up, three's ACES is the same fit") was only partly right:
ACES + 0.6 EV is real, but three's `ACESFilmicToneMapping` is NOT what ships and the master/R/G/B curves,
log wheels, white balance, contrast and vignette were all missing.

### 1.1 What the shaders really compute

`resources.assets`: `Hidden/Post FX/Lut Generator` (variant `TONEMAPPING_FILMIC`, fragment blob #5) and
`Hidden/Post FX/Uber Shader` (variant `COLOR_GRADING`,`VIGNETTE_CLASSIC`, fragment blob #2618). Both fully
disassembled (`.work`-style recipe: `lz4` the blob, entry table `(offset,len)` at blob start, program starts at the
`s_mov_b32 vcc_hi, lit` prologue, `sym.py` for expressions). Constants below are copied from the ISA.

**Uber** (per pixel): `c = scene * autoExposure(=1) * _ExposureEV(=2^0.6)`; `c *= lerp(vigColor, 1, vf)` with
`d = |uv-centre| * 3*intensity` (x scaled by `lerp(1, w/h, rounded)`), `d = pow(d, roundness')`,
`vf = pow(sat(1-dot(d,d)), 5*smoothness)`; `lc = sat(0.0734998*log2(5.55556*c + 0.047996) + 0.386036)` (LogC);
LUT = 1024x32 strip (slice = blue, x in slice = red, y = green) sampled with a manual two-slice lerp
(`u = slice/32 + (r*31+.5)/1024`, `v = (g*31+.5)/32`, second sample `u+1/32`, lerp by `fract(b*31)`). Output is written
straight to the sRGB back buffer: the LUT output is **linear display colour** (no OETF in the shader).

**Lut Generator** (per LUT texel; input = LogC decode `0.18*2^(13.6055x-5.25221) - 0.00863928`):
sRGB->AP0 -> ACEScc (`(log2(x)+9.72)/17.52`, `x<3.05e-5` branch) -> `pow(slope*cc+offset, power)` per channel ->
RGB->HSV, saturation `8*_Saturation*hueVsSat*satVsSat*lumVsSat` about luma (0.2126,0.7152,0.0722) -> contrast about
**0.4135884** -> ACEScc->ACES -> AP1 -> white balance in LMS (`_Balance`) -> lift/gamma/gain -> hue shift
(`hueShift/360` + hueVsHue) -> channel mixer -> AP1->AP0 -> **ACES RRT** (glow gain 0.05, mid 0.08; red modifier hue
width 135, pivot 0.03, scale 0.82) -> AP1, `max(0)`, global desat 0.96 -> the rational RRT+ODT fit
`x(278.509x+10.7772) / (x(293.604x+88.7122)+80.6889)` per channel (**not** the Hill/Narkowicz fit three uses) ->
ODT: XYZ, dim-surround `Y^0.9811`, desat 0.93, D60->D65 CAT, XYZ->Rec709 -> master curve then per-channel R/G/B
curve (128x2 curve table, bilinear, sampled at `x + 1/256`).

CPU-side constants (read from the IL2CPP native code, `GetSlopeValue/GetPowerValue/GetOffsetValue` @0x869d90-0x86a0f0):
slope/power scale 0.1, offset scale 0.05, alpha*0.5, power inverted with min 0.01 and clamp [0.5,2.5], offset clamp +-0.8.
`CalculateColorBalance` follows PPSv1 (temperature/55, tint/55, CIE xy -> LMS vs D65 white (0.949237,1.03542,1.08728)).

### 1.2 Port

`src/view/stage/PostGrade.ts`: the Lut Generator is baked ONCE on the CPU (`bakeGradeLut()`, 32^3 texels, ~30 ms) into a
half-float 1024x32 DataTexture; the Uber maths is GLSL (`POST_GRADE_GLSL`, `postGrade(linearHdr, uv)`).
`WaterPass.ts` now always renders the scene to its HDR target and its COPY shader applies `postGrade` (far-plane pixels
get the camera clear colour **graded too**, as in Unity); the river shader's tone-mapping hook is patched (uniforms +
`postGrade(gl_FragColor.rgb, gl_FragCoord.xy/uGradeRes)`) so water goes through the identical grade. Renderer tone
mapping is `NoToneMapping` (`SkyAtmosphere { postGraded: true }`, no tint baked into the sky/IBL any more). `?nograde`
reverts to the old ACES path for A/B probes. Not ported: ambient-only SSAO (needs the deferred G-buffer ambient term;
documented gap), FXAA (MSAA instead).

## 2. Lighting units (found while matching the colours)

Unity's Standard BRDF omits Lambert's 1/pi (light colour is implicitly pi-scaled); three's physical lights keep it. The
stage's four lights (Directional 1.5 (.976,.922,.718), 2x Directional(Lim) 0.5, Pointlight_Lim) were created with
`intensity = L.intensity`, so every direct term was 1/pi too dark (path read dark red-brown, shadows crushed). Fixed
in `StageSceneView.buildLights`: directionals use `L.intensity * Math.PI`. Ambient was already unit-correct (three's
IBL irradiance has the pi cancelled). The point light is left unscaled (Unity's range attenuation differs from inverse square).

## 3. Terrain `Shader Forge/Splatt_Normal_Gloss` (`terrain_001_m`)

Shader asset `stages` pid 156, 4 passes (DEFERRED, FORWARD, FORWARD_DELTA, META), keyword variants `NO_SPLAT_1..4` etc.
(material has none -> full 4-layer variant). Deferred fragment variant `UNITY_HDR_ON` = blob #504 (disassembled).
Constant buffer `__GLOBAL_CB__`: `_Base/_R/_G/_B_{Color,Normal,Gloss}_ST`, `_Metal`. Facts from the ISA:

* 4 colour, 4 normal and 4 gloss samples, all with `uv*ST.xy + ST.zw` (R tiles 64, G 48, base/B 56).
* Weights = vertex colour RGB (saturated): `lerp(lerp(lerp(base,R,w.r),G,w.g),B,w.b)` for colour, gloss.r and normal.
* **Normals are DXT5nm**: `xy = (alpha, green)*2-1`, `z = sqrt(1 - min(1,|xy|^2))` per layer, x/y/z blended linearly,
  world normal = `T*x + B*y + N*z` normalised (no `_BumpScale`). Our splat shader only sampled colours (and the base
  normal map slot was unused), so the terrain was shaded from interpolated vertex normals only.
* smoothness = blended gloss.r (textures are sRGB-flagged; mean smoothness 0.04-0.07 -> roughness ~0.95, which
  matches the former constant 0.95, so specular was right by luck), `_Metal = 0` -> spec 0.04, albedo*0.96, occlusion 1.
* Tangent handedness: verified on the exported terrain bins that `B = cross(N,T)*w` points along +v for 99.6 % of vertices
  (unmirrored) and still after StageSceneView's mirror (`x -> -x`, `w -> -w`), so three's tangent path is correct as is.

Port: `SplatTerrainMaterial.ts` (+ `StageSceneView.applyTextures`): base normal on `material.normalMap`, R/G/B normals and
four gloss maps as splat samplers, normal blend replaces `normal_fragment_maps`, roughness = `1 - gloss` replaces
`roughnessmap_fragment`. Texture loading already fetched all of them (they were just unused).

## 4. Trees / foliage

`tree_001_m`/`tree_002_m` = `Nature/Plant/SolidTree` (Standard layout, keywords `_NORMALMAP _METALLICGLOSSMAP`),
`_BumpMap = tree_00N_Normal` (DXT5nm: mean RGBA 127/127/127/126), `_MetallicGlossMap = tree_00N_Metal` (R 0,
A smoothness mean 0.2), `_OcclusionMap`. The GLB export bound only colour + AO ("grayscale height map ... not bound",
the same DXT5nm misread the props had) and a constant roughness 0.5. `TreeSurfaceMaps.ts` binds the DXT5nm normal and
Metal/smoothness via `UnityStandardMaps` (GLB TANGENTs verified right-handed against the UVs: 4440/4440). Hooked from
`game.ts` between `TreeView.load` and `new TreeView` (TreeView.ts untouched; its wind patch chains the material's
existing `onBeforeCompile`).

The "fuzzy felt" the reference shows is therefore data-driven by the DXT5nm normal maps (terrain moss/gravel/soil, trees)
under the correct light, not a separate fur/shell shader: no shell/fin/detail-albedo property exists on any of these
materials. The wool-like silhouette fringe on the terrain edge and the water edge darkening in the reference come from
geometry/AO/water shading, not from these materials.

## 5. Measured colour deltas / probes

Probes: `.work/probe-grade.cjs <out.png> <query> W H` (`lite&nograde` = old path), `.work/probe-visual.cjs` -> **VISUAL-OK**.
`npm run check` green (71 files / 1072 tests, tsc clean). Same-class patches, sRGB means, camera framing differs from the
reference so only classes are comparable:

| sample | BEFORE (old ACES, lights x1) | AFTER (PPSv1 grade + pi lights + normals) | REFERENCE (PS4) | delta before -> after |
|---|---|---|---|---|
| hut, lit side | (125,85,30) | (205,150,61) | (204,165,101) / (206,156,90) | (-80,-71,-71) -> (+1,-15,-40) |
| path (orange) | (117,51,15) | (186,92,35) | (208,134,74)..(233,164,100) | (-100,-83,-59) -> (-22,-42,-39) |
| grass, sunlit | (54,118,8) | (82,189,34) | (104,164,65) / (119,148,77) | (-50,-46,-57) -> (-22,+25,-31) |
| grass, mid/shade | (68,116,28) | (93,127,48) | (74,131,45) / (97,126,68) | (-6,-15,-17) -> (+0,-4,+3) |
| water | not re-sampled (river shader untouched by me, now graded by the same LUT) | | (24,63,125) | n/a |

Remaining gap: sunlit terrain/path are still too saturated (G too high on grass, B too low everywhere); raising ambient
(0.7 -> 1.3) moved values <5 levels, so it is albedo x sun colour / missing SSAO + deferred indirect, not the grade.
Screenshots: `.work/grade-old.png` (before), `.work/grade-new5.png` (after, 640x360), references in repo root.

## 6. Unverified

* The curve table texel layout/precision (`i/127`, half-float RT) is inferred from the sampling ISA; the effect is <1/255.
* Slope/power/offset formulas verified against native constants but not executed against a ground-truth frame.
* SSAO (ambientOnly, 1.3 / 0.3) and the original's deferred specular/reflection-probe path are not reproduced.
* Point-light unit conversion (see 2).
