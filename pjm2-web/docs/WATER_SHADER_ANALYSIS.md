# Nature/Water — original shader analysis

Source: Shader `Nature/Water` in the `nature` AssetBundle (Unity 5.6, PS4 platform 11).
`m_SubProgramBlob` → LZ4 → two OrbShdr GCN (Sea Islands) programs: vertex @0x14, fragment @0x938
(`tools/shaders/dump_shader_state.py`, `decompress_blob.py`). Disassembled with `tools/shaders/gcn.py`
(small GCN disassembler written for this) and turned into expressions with `tools/shaders/sym.py`
(`python3 sym.py <start> <end>` on the decompressed blob; fragment code 0x9ec–0xff4).

## Render state (serialized)
Queue Transparent · Blend One Zero · ZWrite Off · ZTest LEqual · Cull Off · single pass.
Properties: `_BGTexture _NormalMap _FlowMap _SkyMap _Color1 _F0 _ScatteringHeight _SpecStrength
_RefractScale _FlowSpeed` — **`_Color` is not a property of this shader**.
Fragment inputs: `_CameraDepthTexture`, `_InverseView`, `_Time`, `_ProjectionParams`,
unity_CameraProjection, unity_OrthoParams, unity_MatrixVP.

## Vertex
Plain MVP; outputs world position, `uv*_NormalMap_ST`, raw uv. **No waves.**

## Fragment (constants from the ISA)
1. `flow = tex(_FlowMap, uv).rg` raw (no *2-1). `p0 = fract(t*0.285714)`, `p1 = fract(t*0.285714+0.5)`.
2. `_NormalMap` is **DXT5nm**: `xy = (alpha, green)*2-1`, `z = sqrt(1-min(1,|xy|²))`, sampled at
   `uv1 + flow*_FlowSpeed*p{0,1}`, blended with `w = 1-2|p1-0.5|`, normalised.
   (The old port read RGB as a grayscale height field — wrong channels.)
3. Normal used directly as a **Unity-world vector** (no tangent frame).
4. `V = normalize(P - cam)`, `d = N·V`.
5. Refraction: `k = 1/(1+0.333·sat(3.333(1-screenY)))`, `P' = P + dN + k(V-dN) - V`, `uvR = proj(VP·P')`.
6. Depth: `dR = depth(uvR)`; if `dR < fragZ-0.0001` (refracted hit is in front of the water) use `uvD = screenUV`.
   World height reconstructed from depth via unity_CameraProjection and `_InverseView` row 1
   (perspective/ortho blended by `unity_OrthoParams.w`).
7. `bg = lerp(grab(uv), grab(uvR), smoothstep(sat(50(waterY - sceneY_R))))`.
8. `depth = sat(waterY + _ScatteringHeight - sceneY_D)`; `m = smoothstep(sat(6.667·depth))`.
9. `fresnel = F0 + (1-F0)·sat(1+d)^5`; `R = V - 2dN`; sky = `texCUBE(_SkyMap, R)`.
10. `water = _Color1·depth³ + _RefractScale·bg + fresnel·_SpecStrength·sky`; `out = lerp(grab(uv), water, m)`; alpha 1.

## Port
`src/view/stage/RiverWaterMaterial.ts` (ShaderMaterial, same maths) + `WaterPass.ts`
(opaque pass → HDR RT with depth texture → tonemapped copy to canvas → water pass; replaces
Unity's grab pass / camera depth texture). `_SkyMap` is a real **Cubemap** (6×BC6H):
`tools/stages/extract_sky_cube.py` exports the faces.

## Not exact / unverified
- BC6H sky is clamped to 8-bit LDR by the decoder (sky is scaled by _SpecStrength 0.15).
- x-mirroring (LH→RH): vectors used in Unity-world space are converted with diag(-1,1,1); not compared
  against original footage (none available).
- Transparent objects/particles drawn over the river are in the grab and get covered by water pixels.
- The shader has a second compiled variant (0x1a44) not analysed; only one sub-program is referenced.
- Terrain `Splatt_Normal_Gloss` normals are DXT5nm as well and are not sampled by our splat shader.
