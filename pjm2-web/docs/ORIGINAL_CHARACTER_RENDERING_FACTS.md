# Original character rendering: facts from the shipped files

Sources: `structures` / `enemies` / `globalsettings` / `stages` / `nature` / `props` AssetBundles, `resources.assets`,
`globalgamemanagers` (UnityPy, `/srv/opencode/venv-unity/bin/python -I`), original reference screenshots supplied by the
user (chibis next to the hut; tikiman masks). Nothing below is guessed; each item says where it was read.

## 1. Engine settings (`globalgamemanagers`)
| Fact | Value |
|---|---|
| Colour space (`PlayerSettings.m_ActiveColorSpace`) | **1 = Linear** |
| Rendering path, all 3 graphics tiers (`GraphicsSettings.m_TierSettings_Tier1..3.renderingPath`) | **1 = Forward** |
| HDR | `useHDR: true`, `hdrMode: 1` on all tiers |
| Cascaded shadow maps | enabled on all tiers; `enableLPPV: true` |
| Deferred / SSS shader slots | engine built-ins (mode 1 = built-in) |
| Quality levels | Fastest, Fast, Simple, Good, Beautiful, Fantastic, Switch. Beautiful: 3 pixel lights, shadows (all) res 2, 2 cascades, 70 m, 2x MSAA flag, soft particles, lodBias 1.5. Fantastic: 4 pixel lights, 4 cascades, 150 m. Which level PS4 uses is not stored in these files. |

## 2. Shaders in the bundles (names read from `Shader.m_ParsedForm.m_Name`)
- **Characters (chibi, tikiman, enemies, towers' bodies): Unity `Standard`** (27 properties, 9 passes: ForwardBase,
  ForwardAdd, ShadowCaster, Deferred, Meta). Towers/structures use **`CustomizedStandard`** (same 27 properties,
  `StandardShaderGUI`, fallback VertexLit).
- `chibi_00_m` (structures, stages bundles): shader Standard, keywords `_EMISSION _METALLICGLOSSMAP _NORMALMAP`,
  `_Glossiness 0.5`, `_Metallic 0`, `_BumpScale 1`, `_OcclusionStrength 1`, `_Mode 0` (opaque), `_Color` white,
  `_EmissionColor` black. `tikiman_01_m`, `kuri_00_m`: same keyword set and values.
- **There is NO permanent character outline shader.** The only outline shaders are
  `Q4/Effect/SkinnedCharacterOutline` and `Q4/Effect/SkinnedMeshOutline` (bundle `structures`). Both have just two
  properties: `_OutlineOnSelectWidth` (Range, **default 0**) and `_OutlineColorOnSelect` (default yellow), and their
  passes are `LightMode=Outline` (`BLOCKED OUTLINE` / `HOLLOW` / `OUTLINE`). They draw only when a structure is
  selected. Characters have none. The user's original screenshots (chibis, tikiman) confirm: no black rim.
- No toon / cel shader exists in any bundle. Full shader list: Standard, CustomizedStandard, Flag/FlagWave,
  Nature/{Grass,Ocean,Plant,Terrain,Water}, Shader Forge/Splatt_Normal_Gloss, Particles/*, Q4/Camera/*, Q4/Effect/*,
  Skybox/Cubemap, UI/GrayscaleAlpha, Unlit/Color, FMVTexture(PS4), Unity Post FX stack (resources.assets).
- Post FX (profile values and shader ISA are in GRADING_AND_SURFACE_ANALYSIS.md): ACES colour grading, vignette,
  ambient occlusion (ambientOnly), FXAA; bloom authored but disabled in stage 1.

## 3. Chibi textures (`structures` bundle) vs what the web port ships
| Texture | Unity format | `m_ColorSpace` | Raw mean RGBA | Port |
|---|---|---|---|---|
| chibi_00_Color | 10 (DXT1) | 1 (sRGB) | **(147, 104, 41)** warm orange-brown | extracted PNG mean **(199, 170, 104)** |
| chibi_00_AO | 10 | 1 | (195,195,195) | bound |
| chibi_00_Normal | 12 (DXT5, normal map) | 0 | RGB ~127, A ~127 | **not bound** |
| chibi_00_Metal | 12 (DXT5) | 1 | RGB 0, **A mean 87 (max 217)** | **not bound** (only `_Metallic`/`_Glossiness` factors) |

### 3.1 Bug A: albedo is double sRGB-encoded (washed out)
`tools/assets/extract_all_characters.py` (header, line ~12 and `srgb_encode`, ~220-274) assumes
"`_MainTex` `m_ColorSpace=1` is linear" and applies linear->sRGB at export. In Unity `m_ColorSpace=1` means the texture IS
sRGB (the normal map is 0). Re-encoding the raw mean reproduces the port's PNG: sRGB(0.576)=0.78 -> 199, sRGB(0.408)=0.673
-> 171 (port 170). So every character albedo that went through this path is too pale/yellow. Correct handling: write the
bytes unchanged and mark them `SRGBColorSpace`.

### 3.2 Bug B: normal and smoothness maps unused / mis-read
- The "normal" PNG was treated as a grayscale height map (`_BumpMap` note in CHARACTER_PIPELINE_REPORT.md). It is a DXT5
  normal map: per-pixel RGB are all ~equal and alpha differs, i.e. the DXT5nm layout where X is in **A** and Y in **G**
  (Z reconstructed). Not bound -> the carved wood grain/bevels visible in the originals are missing.
- Standard with `_METALLICGLOSSMAP` takes metallic from **R** and smoothness from **A** (x `_GlossMapScale` 1.0; `_Glossiness`
  is ignored while a map is present). Chibi Metal: R=0 (non-metal), A up to 217/255 -> glossy red paint and polished
  wood. Ours uses the constant roughness 0.5 everywhere. This is the missing "wet/lacquered" look.

## 4. Consequences for the chibi (and probably all characters)
1. No outline, no cel bands: plain PBR Standard in a Linear / Forward / HDR / ACES-graded pipeline (done for chibis).
2. Fix albedo encoding (Bug A) and re-export character textures. Expected result: orange-brown chibis.
3. Bind normal (X from A, Y from G) and smoothness (from metal A) in the character material.
4. Tikiman/enemy/tower materials share the same keyword set and the same maps, so 1-3 apply to them as well (the toon and
   outline passes should be removed there too).
