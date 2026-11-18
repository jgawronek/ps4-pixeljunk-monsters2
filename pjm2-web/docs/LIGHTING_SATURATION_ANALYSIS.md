# Lighting inputs vs foliage/terrain saturation

Data: `stages` bundle, `BuildPlayer-3d_stage_001_env` (RenderSettings pid 6919, Light pids 6920-6923, LightmapSettings 7408,
ReflectionProbe, LightProbes in `.sharedAssets`), UnityPy. Probes: `.work/probe-sat.cjs`, `.work/patches.py`, `.work/fwd.ts`.

## Findings
1. **Ambient was invented.** game.ts lit the stage with `HemisphereLight(0xbdd3e8, 0x5a6b4a, 0.55 -> 0.25)` plus the PMREM of ONE
   clamped LDR cubemap face x0.7. Neither exists in the original. Real input: `m_AmbientMode 0 (Skybox)`, `m_AmbientIntensity 0.5`,
   baked `m_AmbientProbe` (SH L2, warm and sun-aligned: DC (0.856,0.690,0.525) = `m_IndirectSpecularColor`; up-irradiance/pi
   = (1.39,1.10,0.85) before the 0.5). (The `fps_check_3d_stage_001_env` scene and `GARI` copy have all-zero probes; the real
   stage scene is pid 6919.) Sky cubemap faces are not the source (their LDR means are ~7x darker/bluer than the probe).
2. Probe frame: coefficients are radiance SH pre-multiplied by the basis constants; Unity is left-handed (z flipped vs the
   right-handed SH definition) and the port mirrors x. Verified: L1 lobe (x +0.59, y +0.74, z -0.28 in three space) points at the
   sun (toward-sun (0.36,0.82,-0.44) in three space). Implemented in `StageAmbient.ts` (THREE.LightProbe, intensity 0.5);
   the PMREM diffuse term is zeroed by patching `ShaderChunk.envmap_physical_pars_fragment.getIBLIrradiance`
   (global; PMREM stays as specular source, `environmentIntensity` 1.0 = `m_ReflectionIntensity`). Hemisphere light removed.
3. Lights re-checked: sun 1.5 (.976,.922,.718), two "Lim" fills 0.5 (.973,.816,.165) and Pointlight_Lim all realtime
   (`m_Lightmapping 4`), culling mask everything, shadows only on the sun (0.8/0.05/0.4) - port already matches.
   The saturated yellow Lim fills do exist in the original, so they are not the cause.
4. Not reproducible: stage 001 uses Enlighten **realtime GI** (EnlightenSceneMapping renderers/systems, LightProbes with no baked
   coefficients, baked box ReflectionProbe, 128px). Static ground gets runtime indirect from sun bounce (bounceIntensity 1.5) and
   sky; the SH probe is only the stand-in for it. SSAO (ambientOnly) also missing.

## Before / after (640x360, same default camera; ref = `Screenshot ... 19.10.07.png` same hut view)
| patch | before (hemi+PMREM) | after (SH 0.5) | ref | S before -> after (ref) |
|---|---|---|---|---|
| hut lit | (197,139,53) | (221,168,73) | (199,157,89) | .73 -> .67 (.55) |
| orange crown | (239,189,49) | (249,216,73) | (245,201,95) | .79 -> .71 (.61) |
| path | (152,70,26) | (181,85,32) | (194,126,65) | .83 -> .82 (.66) |
| grass | (29,124,6) | (41,155,9) | (89,151,55) | .95 -> .94 (.64) |
| pale crown | (233,207,72) | (244,223,95) | (138,141,57) | .69 -> .61 (.60) |

## Remaining gap (unverified causes)
Ref grass/path/crown shadows carry a lilac-ish lift (grass needs ~+(0.12,0.05,0.06) pre-grade linear, not explainable by
albedo x any light colour; the moss albedo (41,124,17) is far more saturated than the reference). Candidates not tested:
Enlighten indirect, HDR sky/reflection-probe specular (our cube is LDR-clamped), gloss-texture sRGB treatment (smoothness .036 vs
.21 if sampled raw), SSAO. No ad-hoc desaturation added.
