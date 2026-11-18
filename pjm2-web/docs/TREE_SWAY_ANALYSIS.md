# Tree sway / contact shake: what the original does

Sources: Shader `Nature/Plant/SolidTree` in the `nature` bundle (Unity 5.6, PS4 platform 11; LZ4 `m_SubProgramBlob`
→ OrbShdr GCN Sea Islands); `decomp/decompiled/Q4.NatureTree*.c`; raw x86-64 of
`Media/Modules/Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000); serialized `tree_001_m` / `tree_002_m`;
mesh vertex data. Tools: `tools/shaders/solidtree_wind.py` (extract + disassemble + golden generator),
`tools/shaders/gcn.py` (disassembler), `tools/shaders/isa_exec.py` (tiny GCN interpreter for exactly this program).
Fall/rise logic is documented in `TREE_SWAP_ANALYSIS.md` and is unchanged.

## 1. Which shader

`tree_001_m` and `tree_002_m` (and tree_003 … tree_012, tree_test_*) all use `Nature/Plant/SolidTree`
(Shader pathId 1937003141484085417). `Nature/Plant/TreeLeaf`, `Nature/Plant/Grass`, `Nature/Grass/*` are NOT used by
the trees. Material keywords `_EMISSION _METALLICGLOSSMAP _NORMALMAP`, LightmapFlags 1, queue -1 (opaque).

SolidTree has 7 passes: FORWARDBASE, FORWARDADD, SHADOWCASTER, Outline, Outline, DEFERRED, META; 952 sub-programs.
`m_SubProgramBlob` layout: `u32 count (952)` then `count` x `(u32 offset, u32 length)`; sub-program `m_BlobIndex` indexes it.
Vertex sub-programs carrying the wind (all four ISA literals below present, checked by byte search): FORWARDBASE 80/80,
SHADOWCASTER 16/16, Outline 1/1, Outline#2 120/120, DEFERRED 120/120 (FORWARDADD 0/156 and META 0/3 do not move vertices).
So the **shadow pass sways too**. All variants share the same wind code; the analysed one is blob 0
(FORWARDBASE, DIRECTIONAL), vertex code at blob offset `0x0e0..0x3fc` (header + `OrbShdr` metadata follow at 0x454).

Properties (serialized shader props, `m_PropInfo`): `_MainWindFrequency _MainWindSpeed _NoiseWindFrequency
_NoiseWindSpeed _MainWindStrength _NoiseWindStrength _NoiseWindAngle _CenterHeight _ShakeStrength _ShakeDuration
_NumShakes _ShakeDirection _ShakeStartTime` (+ Standard-shader props). Only the following reach the compiled program
(`__GLOBAL_CB__`, size 116 B; **`m_Index` is a BYTE offset**, dword = /4):

| dword | name | | dword | name |
|---|---|---|---|---|
| 0-3 | `_TimeEditor` (always 0) | | 12 | `_NumShakes` |
| 4 | `_MainWindFrequency` | | 13 | `_ShakeStartTime` |
| 5 | `_MainWindSpeed` | | 16-18 | `_ShakeDirection.xyz` |
| 6 | `_NoiseWindFrequency` | | 20-23 | `_MainTex_ST` |
| 7 | `_NoiseWindSpeed` | | 24-27 | `_DetailAlbedoMap_ST` |
| 8 | `_MainWindStrength` | | 28 | `_UVSec` |
| 9 | `_NoiseWindStrength` | | | |
| 10 | `_ShakeStrength` | | | |
| 11 | `_ShakeDuration` | | | |

**`_NoiseWindAngle`, `_CenterHeight` (and the material-only `_ShakeFrequency`) are never read** (not in the constant
buffer; the 45° rotation is a hard-coded 0.7071). The earlier port used `_NoiseWindAngle` as the wind direction: wrong.
UnityPerCamera: `_Time` dwords 0-3 (`.y`=t, `.z`=2t), `_WorldSpaceCameraPos` 16-18. UnityPerDraw: `unity_ObjectToWorld` 0-15
(column-major), `unity_WorldToObject` 16-31. UnityPerFrame: `unity_MatrixVP` 68-83 (byte 272).
`_Time` is Unity's `Time.timeSinceLevelLoad`-based clock.

Vertex inputs (`ShaderBindChannel` source→target): pos(0→0), normal(1→2), **color(2→1)**, uv0(3→4), uv1(4→5)
(lightmapped variants add 7→8). The fetch shader (called via `s_swappc` at 0x0dc, built by the runtime) fills 4 VGPRs per
attribute in source order: position v4-v7 (w = 1), normal v8-v11, **color v12-v15**, uv0 v16-v19, uv1 v20-v23.

## 2. The vertex program (blob 0, `solidtree_wind.py asm`)

SGPR bases: `s[4:5]`=`__GLOBAL_CB__`, `s[8:9]`=UnityPerCamera, `s[48:49]`=UnityPerDraw, `s[16:17]`=UnityPerFrame.
Constants: lit 0.7071 (`0x3f3504f3`), 1/3 (`0x3eaaaaab`), 0.42 (`0x3ed70a3e`), 0.7 (`0x3f333333`), 1.15 (`0x3f933332`),
1.05 (`0x3f866665`), 0.3π (`0x3f71462d`), π, 1/2π. `v_sin_f32` takes revolutions (so `fract(x/2π)` then `sin` = `sin(x)`).
`omod=3` = divide by 2, `omod=1` = multiply by 2.

| ISA addr | instruction(s) | meaning |
|---|---|---|
| 0x124-0x134 | `vcc=1/3; v0=sat(vcc*v5); v3=v12*v0` | `w = color.r * saturate(pos.y / 3)` (`v5` = OBJECT-space y, `v12` = vertex color R) |
| 0x15c, 0x16c | `v24=_Time.z+TE.z; v21=0.3π+v24` | `T2 = 2t`; noise phase offset |
| 0x170-0x180 | `v11=_Time.y+TE.y-_ShakeStartTime; v12=sat(v11*rcp(_ShakeDuration))` | shake progress `k = sat((t-start)/dur)` |
| 0x188-0x1b0 | `v11=sin2π(fract(k*_NumShakes*π/2π))` | `S = sin(π * N * k)` |
| 0x194,0x19c | `v19=_MainWindStrength*w/2; v18=_NoiseWindStrength*w/2` | |
| 0x1b4-0x1bc, 0x278, 0x2b4 | `shake = -dir.x/y/z * S * w` (`-s32,-s33,-s34`) | |
| 0x1c4-0x1e8 | `v22 = M.x·(pos,1) ; v15 = M.z·(pos,1)` | **world** X,Z (`s0,s4,s8,s12` / `s2,s6,s10,s14`) |
| 0x1e0-0x1f4 | `v26 = 0.7071*(wx+wz) + MainSpeed*T2` | main phase, wind travels along the XZ diagonal |
| 0x1f8-0x204 | `v24 = 0.7071*(wx-wz) + NoiseSpeed*(T2+0.3π)` | noise phase, anti-diagonal |
| 0x200-0x230 | `sin2π(fract(phase*rcp(freq)*1/2π))` | `sinA = sin(((wx+wz)/√2 + MainSpeed*2t)/MainFreq)`, `sinB = sin(((wx-wz)/√2 + NoiseSpeed*(2t+0.3π))/NoiseFreq)` |
| 0x228-0x240 | `v14 = fma(sinA,0.7,0.42)*mainStr*w/2*1.15` ; `v18 = noiseStr*w/2*sinB*1.05` | main wind is biased (0.7 sin + 0.42): mostly leans one way |
| 0x248-0x270 | rel = world − `s12`(origin x); `x' = origin + rel + 0.5*0.7071*(main+noise)` | |
| 0x2ac-0x2c4 | `z' = origin + rel + 0.5*0.7071*(main−noise)` | |
| 0x294,0x2d0.. | `env=(1-k)^2`; `x' += env*_ShakeStrength*(−dir.x S w)`, same for y,z | decaying contact shake |
| 0x2d8-0x334 | `clip = VP · (x', y', z', 1)` | **MVP is applied to the DISPLACED world position** |
| 0x338-0x3f0 | exports (clip, eye vector `P'−cam`, normal, uv) | normal is NOT displaced |

Result (all Unity world space, everything after `ObjectToWorld`):

```
w      = color.r * saturate(objY / 3)
A      = sin(((wx + wz)*0.70710678 + MainSpeed * 2t) / MainFreq)
B      = sin(((wx − wz)*0.70710678 + NoiseSpeed * (2t + 0.3π)) / NoiseFreq)
Mw     = 1.15 * (MainStr  * w / 2) * (0.7*A + 0.42)
Nw     = 1.05 * (NoiseStr * w / 2) * B
k      = saturate((t − _ShakeStartTime) / _ShakeDuration)
shake  = −_ShakeDirection * sin(π * _NumShakes * k) * w * _ShakeStrength * (1−k)²
Δ.x    = 0.35355339*(Mw + Nw) + shake.x
Δ.y    = shake.y (= 0, direction.y is always 0)
Δ.z    = 0.35355339*(Mw − Nw) + shake.z
P'     = ObjectToWorld·pos + Δ
```

No per-instance phase constant: the phase comes from each vertex's **world position**, so neighbours decorrelate
automatically. There is no height² weighting, no noise texture, no tilt of the whole object. `t` is `_Time.y`.
Amplitudes (tree_001, w=1): main ≤ 1.15·0.15·1.12 ≈ 0.19, noise ≤ 0.105 (before the 0.35 diagonal factor); tree_002 0.45/0.4.
Because only the crown has `color.r > 0` (trunk base r=0) and `sat(y/3)` is ≤ 0.63 for a 1.9 m tree, the sway is subtle.

Evidence of execution: `isa_exec.py` runs the real instruction stream (48 random cases incl. rotation, scale, active
shakes) → `tests/view/fixtures/treeWindIsaGolden.json`; the formula above matches to 5e-6 (fp32), and the **GLSL actually
injected in the game, rendered on a GPU, matches the same golden values to 1.9e-5** (`.work/probe-treewind-gl.cjs`).

### Vertex weight data
All shipped tree meshes (tree_001_x, tree_002_x LOD0) have vertex colors `(r, 0, 0, 255)`; r is 0 on the trunk base and
rises to 255 in the crown (corr(r, y) = 0.87-0.98). The old GLBs dropped this attribute (no COLOR_0): that is why the
old port had to invent a height weight. `tools/assets/extract_trees.py` now writes `r/255` as the custom glTF attribute
`_WINDWEIGHT` (three: geometry attribute `_windweight`). Not `COLOR_0`: GLTFLoader would turn that into
`material.vertexColors` and tint the albedo red. LH→RH: x of positions/normals is mirrored in the GLB; `color.r` is
mirror-invariant.

## 3. C# side (Q4.NatureTree)

| Function @addr | Behaviour |
|---|---|
| `Awake` @0x649900 | `SetBumpShaderParameters(Vector3.one, DAT_00b7e720 = -100.0f)`; `cachedLodGroup = GetComponentInChildren<LODGroup>` (+0x80). So each tree starts idle (`k = 1` ⇒ no shake). |
| `SetBumpShaderParameters(dir, time)` @0x649B20 | raw x86 0x64db86..: `Vector3 d = new Vector3(dir.x, 0, dir.z)` (xmm1 = 0 zeroes y; the call is the Vector3 ctor @0x98a0f0), `d.Normalize()` (@0x98d750), `MaterialPropertyBlock.SetVector(_ShakeDirection, d)`, `SetFloat(_ShakeStartTime, time)`; the block (+0x88) is applied with `Renderer.SetPropertyBlock` to every renderer of every LOD of the LODGroup. |
| `OnPlayerEnter(other)` @0x649FA0 | `dir = other.position − this.position`; `if (Time.time − lastBumpTime(+0x94) > 1.0 [DAT_00b7e728])`: `lastBumpTime = Time.time; SetBumpShaderParameters(dir, Time.timeSinceLevelLoad)`; then `Structure.OnPlayerEnter`. |
| `Bump(dir)` @0x649F30 | same throttle (DAT_00b7e724 = 1.0). **No caller found in the decomp** (dead code / animation message). |
| `<TreeRise>.MoveNext` @0x64B770 | when the 0.1 s regrow finishes: `dir = (Random.Range(−1,1), 0, Random.Range(−1,1))` (DAT_00b7e73c/e740 = ∓1), same 1.0 s throttle, then a bump. |
| `Structure.InitTriggers` @0x535900 | creates the `PlayerTrigger` child (`DelegateTrigger.CreateDelegateTriggerObject(playerDetectionRange, …)`), radius = serialized `playerDetectionRange` (2). `Structure.OnPlayerEnter` is player-only (`GetComponent<DelegateUpdates>` / `StructureSelector`); `OnEnemyEnter/Stay/Exit` are empty, so enemies and towers do NOT shake trees. |
| `_Time` | `Time.timeSinceLevelLoad` for both the shader clock and the stored start time (the throttle uses `Time.time`). |

Material/MPB values: `tree_001_m` main 1.6 / 1.2 / 0.3, noise 10 / 1 / 0.2; `tree_002_m` main 1.8 / 1.2 / 0.45,
noise 9.5 / 1 / 0.4; both `_ShakeStrength 0.3`, `_ShakeDuration 3`, `_NumShakes 10` (shader defaults differ, materials win).
The contact shake: 10 half-oscillations over 3 s with a quadratic decay, first pushing the crown **away from the player**
(displacement is along −dir with dir = player − tree).

## 4. Why the old port looked broken

1. Wind was a height²-weighted `sin` along an arbitrary direction (`_NoiseWindAngle`, which the shader never reads), with a
   made-up 2-sine noise; the original is a diagonal travelling wave with a +0.42 bias, a separate anti-diagonal noise wave
   and the exact 1.15/1.05/0.7 gains.
2. The weight was invented (smoothstep² of height) because `color.r` was missing from the GLBs; the original weight is the
   authored vertex-color R times `sat(y/3)`.
3. The phase used `x + 0.75z` and angle offsets instead of `(x±z)/√2`, `2t`, `0.3π`, and divided differently
   (`frequency` is a divisor, not a multiplier).
4. Contact shake was missing entirely.
5. Displacement was computed in object space/with ad-hoc rotation instead of in world space after the model matrix.

## 5. Port (src/view/stage/TreeView.ts)

* `treeWindDisplacement()` = pure reference of the math above (tested against the ISA golden fixture).
* `applyTreeWind()` injects the same math in GLSL after `#include <begin_vertex>` (also on the `MeshDepthMaterial` used as
  `customDepthMaterial`, so shadows sway like the SHADOWCASTER pass). World phase uses `unity = (−x, y, z)` (LH→RH mirror),
  the displacement is mirrored back; it is converted to object space with `transpose(mat3(M)) / dot(M[0],M[0])`
  (exact for the rotation + uniform scale TRS produced by yaw / TreeFall / TreeRise), so fall/rise compose with the sway
  exactly like the original's `ObjectToWorld`.
* Each tree owns a material clone (+ depth material) so the per-tree `_ShakeDirection/_ShakeStartTime` uniform works like the
  MaterialPropertyBlock; textures/geometry stay shared; one program (identical cache key). The patch chains the template's
  `onBeforeCompile`/`customProgramCacheKey` (other view agents patch materials too).
* `TreeView.trackPlayers(positions)` emulates the r = 2 sphere trigger (horizontal distance; enter edge) →
  `onPlayerEnter` → throttle 1 s → `_ShakeDirection/_ShakeStartTime`; rise end bumps with a deterministic hash direction.
  `game.ts` calls `treeView.trackPlayers([player.position])` each frame.

## 6. Unverified / adaptations

* `v12` = vertex color **R** (not A): inferred from the fetch-register order (source index order, 4 VGPRs each) and
  from the data (R varies 0..255 with height, A is constantly 255, and `sat(y/3)` is a separate factor); the fetch
  shader itself is generated at runtime and not in the bundle.
* Only blob 0 was executed; the other variants were checked to contain the same four literals but not diffed instruction
  by instruction. The `omod`/VOP3 decode was validated by the ISA↔formula agreement and by plausibility (÷2 halves).
* `_Time.y` origin: the port clock starts when the TreeView is created (≈ level load). Absolute phase is not observable.
* Player trigger: Unity's overlap of the player collider with the r = 2 sphere; the player collider size is unknown, the
  port uses the raw distance ≤ 2 between the player origin and the tree origin (xz).
* `Random.Range` → deterministic per-tree hash (no `Math.random`). `NatureTree.Bump` has no caller.
* LOD1-3 (distance LODs) are not used (existing port policy: LOD0 only).
* Lighting normals are not displaced (also in the original: the normal export at 0x3c0-0x3d0 uses the undisplaced normal).
  The port's shadow-receive lookup follows three's `worldpos_vertex` on the displaced vertex (tiny difference, unverified vs original).
