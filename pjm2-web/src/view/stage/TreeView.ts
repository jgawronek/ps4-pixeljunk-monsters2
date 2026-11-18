// src/view/stage/TreeView.ts
// Three.js-backed NatureTree viewer: pools one clone per sim tree handle at
// the stage's tree_XXX anchors (Unity LH → three RH: x→−x), reproduces the
// code-driven TreeFall/TreeRise motions of Q4.NatureTree, and reproduces the
// original's shader wind sway as a vertex-shader patch (onBeforeCompile).
//
// SPECIES: the stage has TWO tree species — 3d_stage_001 scene.json carries
// 425 active `tree_001` + 32 active `tree_002` anchors. addTree takes an
// optional `species` ('tree_001' default) and picks from that species'
// template list. INTEGRATOR CONTRACT (game.ts): map each tree node's species
// from its scene node NAME PREFIX (n.name.startsWith('tree_002') →
// 'tree_002', else 'tree_001') and pass it as the 4th addTree argument;
// update(dt) drives the wind clock (uTime) for every tree material.
//
// Assets: public/assets/trees/tree_001_<N>.glb + tree_002_<N>.glb — extracted
// from the user's own `nature` bundle by tools/assets/extract_trees.py (logic
// prefabs tree_001/tree_002 → PrefabLoader.prefabRandomList → tree_XXX_N_pa
// visuals, LOD0 static meshes; mirror already baked into the GLBs, so they
// load in three NATIVE space — see manifest.json coordinateConvention).
// tree_001: 4 variants share one geometry (849 verts) and differ only in UV0
// (quadrants of the shared tree_001_Color atlas). tree_002: variants 1-3
// share one geometry (1843 verts, UV0 quadrants of tree_002_Color); variant 4
// is a distinct 5075-vert mesh. The extractor's UV0 audit (source + exported
// GLB accessor hashes) verifies per-variant UV diversity — see
// manifest.json species.<s>.variantChoice.uv0Audit.
//
// DECOMP EVIDENCE (decomp/decompiled/, DATA):
//   - Variant choice: Q4.PrefabLoader.Awake @0x7470F0 + InstantiateAll
//     @0x747220 — BOTH logic prefabs have prefabList=[] and a 4-entry
//     prefabRandomList, prefabRandomIndex=-1 → ONE prefab instantiated at
//     Random.Range(0, count). TS ADAPTATION: deterministic handle hash
//     (stableVariant) replaces the random pick; the port forbids Math.random.
//   - Tower build: Q4.NatureTree.OnTowerBuild @0x64A680. EVERY NatureTree
//     listens (Awake @0x649900). The handler falls a tree iff its own sim
//     handle is in tower.retainedTrees (+0xA8, `call 0x51280` List.Contains)
//     — i.e. ALL cost trees the tower claimed (TowerHelper.GetCostTrees /
//     FromTreeToTower), not only the clicked one. Direction (raw x86 verified
//     @0x64A8FC: vmovlps stores x,y; `mov [rbp-0x3c],0` ZEROES y): d =
//     (treePos − towerPos).xz flattened. |d| != 0 → delay = Random.Range(0,
//     0.25 [DAT_00b7e72c]) and dir = d; |d| == 0 (the clicked tree sits AT the
//     tower position) → delay 0 and dir = (cosθ,0,sinθ), θ=Random.Range(0, π
//     [DAT_00b7e730, ELF rodata]). dir is Normalized, axis = Cross(dir, up).
//     NatureTree.towerDirection (0x74) is NOT read here (it only seeds the
//     TOWER's facing in TowerHelper.FromTreeToTower) — an earlier port wrongly
//     used it as the fall direction. TS ADAPTATION: Random.Range → fixed
//     per-handle hash (the port forbids Math.random).
//   - TreeFall (<TreeFall>c__Iterator0.MoveNext @0x64B270): after the
//     delay, snapshot origin position/rotation/localScale; each frame sink
//     position by up*(fallHeight/fallDuration)*dt, rotate
//     AngleAxis(−angle, axis) with angle = Min(angle +
//     fallAngle/fallRotateDuration*dt, fallAngle), shrink uniform scale at
//     (originScale − fallScale)/fallDuration down to fallScale; when
//     Distance(origin, current) >= fallHeight → SetActive(false) and
//     RESTORE the origin TRS. Serialized constants (BOTH species' NatureTree
//     MBs, matching ctor defaults DAT_00b7e7d0/_UNK_00b7e7d8/0x3E800000):
//     fallHeight=0.5, fallDuration=0.5, fallRotateDuration=0.5,
//     fallAngle=75°, fallScale=0.25. TS ADAPTATION: closed-form time-based
//     progress instead of per-frame Distance accumulation — identical
//     trajectory, deterministic under variable dt.
//   - TreeRise (OnTreeRevive @0x64A490 + <TreeRise>c__Iterator1.MoveNext
//     @0x64B770): fired by treeReviveEvent(tree, player, index) when the
//     tree's breakdown refcount returns to 0 (tower SOLD; SellTowerCommand
//     revives retainedTrees with index 0,1,2…). SetActive(true), localScale=0,
//     WaitForSeconds(index*0.05 [DAT_00b7e738]), then linear regrow
//     localScale = Vector3.one*(scaleTime − remaining)/scaleTime over
//     scaleTime=0.1s (0x3DCCCCCD), exact restore of the saved scale + a
//     random shader bump (not reproduced, see sway below).
//   - Idle sway + contact shake: NOT an animation clip (the nature bundle
//     contains ZERO tree* AnimationClips; the visual Animator has a null
//     controller). Both are the VERTEX PROGRAM of Shader `Nature/Plant/
//     SolidTree` (PS4 GCN ISA recovered from m_SubProgramBlob; full
//     disassembly + formulas in docs/TREE_SWAY_ANALYSIS.md): a world-space
//     displacement applied AFTER ObjectToWorld, weighted per vertex by
//     vertexColor.r * saturate(objectY/3), phased by the vertex's WORLD
//     position, driven by _Time.y/.z (time since level load) and the
//     tree_001_m / tree_002_m material floats; plus a decaying sine contact
//     shake from the per-renderer MaterialPropertyBlock vector
//     _ShakeDirection / float _ShakeStartTime that Q4.NatureTree
//     .SetBumpShaderParameters @0x649B20 writes (Awake: dir=(1,0,1), start
//     -100 = idle; OnPlayerEnter: player-tree direction; TreeRise end: random
//     direction; all throttled to one bump per second per tree).
//     PORT: treeWindDisplacement() is the pure reference of the ISA math
//     (unit-tested against ISA-interpreter golden values); the GLSL chunk
//     injected by applyTreeWind() is the same math on the GPU. Each tree gets
//     its OWN material clone (+ depth material for the shadow pass, the
//     original's SHADOWCASTER pass runs the same wind) so the per-tree
//     _ShakeDirection/_ShakeStartTime uniform works like the MPB. The wind
//     weight is the GLB custom attribute _WINDWEIGHT (= Unity vertex color.r,
//     tools/assets/extract_trees.py). NO Math.random. update() also advances
//     an AnimationMixer IF a template ever carries clips (userData.animations)
//     — none ship today (manifest clips:[]).
//
// Mirror rules (docs/PORTING_CONVENTIONS.md, BINDING): unity (x,y,z) ↔
// three (−x,y,z); unity quat (x,y,z,w) → three (x,−y,−z,w). The fall
// quaternion is therefore computed in UNITY space (AngleAxis(−angle,
// Cross(towerDirection, up))) and mirrored component-wise. A unity yaw θ
// about +Y renders as three rotation.y = −θ (PickupView header rule).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const f = Math.fround;
const DEG2RAD = Math.PI / 180;

// ---- Q4.NatureTree serialized constants (tree_001/tree_002 NatureTree MBs,
// ---- nature bundle; ctor defaults DAT_00b7e7d0 = 0.5/0.5, _UNK_00b7e7d8 =
// ---- 0.5/75, fallScale immediate 0x3E800000 = 0.25 — CONFIRMED from ELF
// ---- rodata) ----
const FALL_HEIGHT = f(0.5);          // 0x50 fallHeight
const FALL_DURATION = f(0.5);        // 0x54 fallDuration
const FALL_ROTATE_DURATION = f(0.5); // 0x58 fallRotateDuration
const FALL_ANGLE = f(75);            // 0x5C fallAngle (degrees)
const FALL_SCALE = f(0.25);          // 0x60 fallScale
const FALL_DELAY_MAX = f(0.25);      // DAT_00b7e72c = 0.25 (Random.Range max)
const RISE_SCALE_TIME = f(0.1);      // 0x3DCCCCCD immediate / DAT_00b7e734
const FALL_DIR_RANGE = f(Math.PI); // DAT_00b7e730 = π (CONFIRMED from ELF)
// TreeRise per-index revive stagger: WaitForSeconds(index * DAT_00b7e738).
const RISE_INDEX_STEP = f(0.05);

/** Stage tree species (scene.json node-name prefixes). */
export type TreeSpecies = 'tree_001' | 'tree_002';

// ---- Nature/Plant/SolidTree vertex program (see docs/TREE_SWAY_ANALYSIS.md) ----
/** Material floats read by the SolidTree vertex program (constant buffer
 *  `__GLOBAL_CB__` dwords 4..13), serialized in tree_001_m / tree_002_m.
 *  _NoiseWindAngle / _CenterHeight / _ShakeFrequency are serialized too but
 *  the compiled program never reads them (not in its constant buffer). */
export interface TreeWindParams {
  mainFrequency: number;  // _MainWindFrequency (divisor of the main phase)
  mainSpeed: number;      // _MainWindSpeed
  mainStrength: number;   // _MainWindStrength
  noiseFrequency: number; // _NoiseWindFrequency
  noiseSpeed: number;     // _NoiseWindSpeed
  noiseStrength: number;  // _NoiseWindStrength
  shakeStrength: number;  // _ShakeStrength
  shakeDuration: number;  // _ShakeDuration (s)
  numShakes: number;      // _NumShakes
}
export const TREE_WIND_PARAMS: Record<TreeSpecies, TreeWindParams> = {
  tree_001: {
    mainFrequency: f(1.6), mainSpeed: f(1.2), mainStrength: f(0.3),
    noiseFrequency: f(10), noiseSpeed: f(1), noiseStrength: f(0.2),
    shakeStrength: f(0.3), shakeDuration: f(3), numShakes: f(10),
  },
  tree_002: {
    mainFrequency: f(1.8), mainSpeed: f(1.2), mainStrength: f(0.45),
    noiseFrequency: f(9.5), noiseSpeed: f(1), noiseStrength: f(0.4),
    shakeStrength: f(0.3), shakeDuration: f(3), numShakes: f(10),
  },
};

// Hard-coded constants of the vertex program (ISA literals, see the doc).
const SQRT_HALF = 0.70710677;        // 0x3f3504f3: 45° rotation of the world XZ plane
const HEIGHT_DIV = 1 / 3;            // 0x3eaaaaab: weight = r * saturate(objectY * 1/3)
const MAIN_GAIN = 1.15;              // 0x3f933332
const MAIN_SCALE = 0.7;              // 0x3f333333
const MAIN_BIAS = 0.42;              // 0x3ed70a3e  (main = 0.7*sin + 0.42: biased downwind)
const NOISE_GAIN = 1.05;             // 0x3f866665
const NOISE_PHASE = 0.9424778;       // 0x3f71462d = 0.3*pi added to _Time.z before * speed
/** Q4.NatureTree: SetBumpShaderParameters(Vector3.one, DAT_00b7e720). */
export const TREE_IDLE_SHAKE_START = -100;
/** Bump / OnPlayerEnter throttle: `Time.time - lastBumpTime > 1.0`
 *  (DAT_00b7e724 / DAT_00b7e728 = 1.0f, ELF rodata). */
export const TREE_BUMP_INTERVAL = 1.0;
/** Structure.InitTriggers: sphere trigger of radius playerDetectionRange (2). */
export const TREE_PLAYER_TRIGGER_RADIUS = 2;

/** Per-renderer MaterialPropertyBlock values: (dir.x, dir.z) in UNITY space
 *  (Vector3 flattened + normalized) and _ShakeStartTime. */
export interface TreeShake { dirX: number; dirZ: number; start: number }

const sat = (x: number): number => Math.min(Math.max(x, 0), 1);

/** Pure reference of the SolidTree vertex-wind math (ISA 0x1ac-0x300 of the
 *  vertex program, executed by an ISA interpreter to generate the golden
 *  values in tests/view/treeView.test.ts). Everything is UNITY space.
 *  @param timeY  _Time.y (+ _TimeEditor.y = 0), seconds since level load
 *  @param world  the vertex's Unity world position (ObjectToWorld * pos)
 *  @param objY   the vertex's OBJECT-space y (unity mesh y)
 *  @param weight vertex color.r (0..1)
 *  @returns world-space Unity displacement to add to `world` */
export function treeWindDisplacement(
  p: TreeWindParams, timeY: number, world: { x: number; y: number; z: number },
  objY: number, weight: number, shake: TreeShake,
): { x: number; y: number; z: number } {
  const w = weight * sat(objY * HEIGHT_DIV);
  const timeZ = 2 * timeY; // _Time.z
  const main = MAIN_GAIN * (p.mainStrength * w * 0.5) *
    (MAIN_SCALE * Math.sin(((world.x + world.z) * SQRT_HALF + p.mainSpeed * timeZ) / p.mainFrequency) + MAIN_BIAS);
  const noise = NOISE_GAIN * (p.noiseStrength * w * 0.5) *
    Math.sin(((world.x - world.z) * SQRT_HALF + p.noiseSpeed * (timeZ + NOISE_PHASE)) / p.noiseFrequency);
  const k = sat((timeY - shake.start) / p.shakeDuration);
  const env = (1 - k) * (1 - k);
  const amp = -Math.sin(Math.PI * p.numShakes * k) * w * p.shakeStrength * env;
  return {
    x: 0.5 * SQRT_HALF * (main + noise) + shake.dirX * amp,
    y: 0, // _ShakeDirection.y is always 0 (flattened by SetBumpShaderParameters)
    z: 0.5 * SQRT_HALF * (main - noise) + shake.dirZ * amp,
  };
}

/** Wind state shared by every tree of one species (live uniforms). */
export interface TreeWindState {
  params: TreeWindParams;
  /** _Time.y — shared with the owning TreeView clock. */
  time: { value: number };
  main: { value: THREE.Vector3 };       // (_MainWindFrequency, Speed, Strength)
  noise: { value: THREE.Vector3 };      // (_NoiseWindFrequency, Speed, Strength)
  shakeParams: { value: THREE.Vector3 }; // (_ShakeStrength, _ShakeDuration, _NumShakes)
}
/** Per-tree MaterialPropertyBlock uniform: (dir.x, dir.z, startTime). */
export type TreeShakeUniform = { value: THREE.Vector3 };

export const TREE_WIND_UNIFORMS = {
  time: 'uTreeTime',
  main: 'uTreeMain',
  noise: 'uTreeNoise',
  shakeParams: 'uTreeShakeP',
  shake: 'uTreeShake',
  weightAttribute: '_windweight',
} as const;

export function createTreeWindState(params: TreeWindParams, time: { value: number }): TreeWindState {
  return {
    params, time,
    main: { value: new THREE.Vector3(params.mainFrequency, params.mainSpeed, params.mainStrength) },
    noise: { value: new THREE.Vector3(params.noiseFrequency, params.noiseSpeed, params.noiseStrength) },
    shakeParams: { value: new THREE.Vector3(params.shakeStrength, params.shakeDuration, params.numShakes) },
  };
}

const WIND_VERTEX_HEADER = `attribute float _windweight;
uniform float uTreeTime;
uniform vec3 uTreeMain;
uniform vec3 uTreeNoise;
uniform vec3 uTreeShakeP;
uniform vec3 uTreeShake;
`;

// GLSL port of the same math (three world = unity world with x mirrored:
// unity = (-x, y, z); the displacement is mirrored back the same way). The
// displacement is applied in WORLD space after the model matrix — like the
// original — then rotated/scaled back into object space so the stock
// project_vertex / worldpos_vertex / shadow chunks (and the depth material)
// all see the displaced vertex. inverse(M) = transpose(R)/s for the rotation
// + UNIFORM scale TRS that the fall/rise code produces.
const WIND_VERTEX_HOOK = '#include <begin_vertex>';
const WIND_VERTEX_INJECT = `#include <begin_vertex>
	{
		vec3 twW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
		vec3 twU = vec3( -twW.x, twW.y, twW.z );
		float tw = _windweight * clamp( transformed.y * 0.33333334, 0.0, 1.0 );
		float twMain = 1.15 * ( uTreeMain.z * tw * 0.5 ) * ( 0.7 * sin( ( ( twU.x + twU.z ) * 0.70710677 + uTreeMain.y * 2.0 * uTreeTime ) / uTreeMain.x ) + 0.42 );
		float twNoise = 1.05 * ( uTreeNoise.z * tw * 0.5 ) * sin( ( ( twU.x - twU.z ) * 0.70710677 + uTreeNoise.y * ( 2.0 * uTreeTime + 0.9424778 ) ) / uTreeNoise.x );
		float twK = clamp( ( uTreeTime - uTreeShake.z ) / uTreeShakeP.y, 0.0, 1.0 );
		float twAmp = -sin( 3.14159265 * uTreeShakeP.z * twK ) * tw * uTreeShakeP.x * ( 1.0 - twK ) * ( 1.0 - twK );
		vec3 twDU = vec3( 0.35355338 * ( twMain + twNoise ) + uTreeShake.x * twAmp, 0.0, 0.35355338 * ( twMain - twNoise ) + uTreeShake.y * twAmp );
		vec3 twDW = vec3( -twDU.x, twDU.y, twDU.z );
		transformed += ( transpose( mat3( modelMatrix ) ) * twDW ) / max( dot( modelMatrix[0].xyz, modelMatrix[0].xyz ), 1e-6 );
	}`;

/** Patch `m` (a per-tree clone — see TreeView.addTree) with the SolidTree
 *  wind. Chains whatever onBeforeCompile / customProgramCacheKey the material
 *  already had (other view agents may have patched it). `chainFrom` is the
 *  material whose handlers to chain (the template), default `m` itself. */
export function applyTreeWind(
  m: THREE.Material, state: TreeWindState, shake: TreeShakeUniform, chainFrom: THREE.Material = m,
): void {
  const prevCompile = chainFrom.onBeforeCompile;
  const prevKey = chainFrom.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(m, shader, renderer);
    shader.uniforms[TREE_WIND_UNIFORMS.time] = state.time;
    shader.uniforms[TREE_WIND_UNIFORMS.main] = state.main;
    shader.uniforms[TREE_WIND_UNIFORMS.noise] = state.noise;
    shader.uniforms[TREE_WIND_UNIFORMS.shakeParams] = state.shakeParams;
    shader.uniforms[TREE_WIND_UNIFORMS.shake] = shake;
    if (!shader.vertexShader.includes('uTreeShakeP')) {
      shader.vertexShader = WIND_VERTEX_HEADER +
        shader.vertexShader.replace(WIND_VERTEX_HOOK, WIND_VERTEX_INJECT);
    }
  };
  m.customProgramCacheKey = () => `${prevKey}|pjm2-tree-wind-solidtree`;
}

/** Loaded GLB master scenes. NEVER added to a live scene themselves —
 *  instances are .clone()s sharing geometry/materials. May carry
 *  userData.animations (AnimationClip[]) for the mixer hook; the shipped
 *  tree GLBs have none (verified clips:[]). */
export interface TreeViewAssets {
  /** tree_001 master scenes (the default species). */
  variants: THREE.Object3D[];
  /** tree_002 master scenes (optional — when absent/empty, tree_002
   *  requests fall back to the tree_001 templates). */
  variants002?: THREE.Object3D[];
}

/** Deterministic variant pick from a stable index — replaces
 *  Q4.PrefabLoader's Random.Range(0, prefabRandomList.Count) (TS ADAPTATION,
 *  see header). Integer avalanche hash; NO Math.random anywhere. */
export function stableVariant(id: number, variantCount: number): number {
  if (variantCount <= 0) return 0;
  return (hash01(id, 0) * variantCount) | 0;
}

/** Deterministic [0,1) from an integer handle + salt (avalanche hash, same
 *  family as PickupView.handlePhase). */
function hash01(id: number, salt: number): number {
  let h = (id | 0) ^ Math.imul(salt | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 4096) / 4096;
}

/** Unity AngleAxis(−angleDeg, axis) mirrored to three (x,−y,−z,w). The
 *  negated angle is faithful: the decomp XORs the angle bits with the −0.0
 *  mask at _DAT_00b7e7e0 before calling AngleAxis
 *  (<TreeFall>c__Iterator0.MoveNext @0x64B270). */
function fallQuaternion(angleDeg: number, axis: { x: number; y: number; z: number },
                        out: THREE.Quaternion): THREE.Quaternion {
  const half = f(f(-angleDeg * DEG2RAD) * 0.5);
  const s = f(Math.sin(half));
  const c = f(Math.cos(half));
  // unity q = (ax*s, ay*s, az*s, c) → three (qx, −qy, −qz, qw)
  return out.set(f(axis.x * s), f(-axis.y * s), f(-axis.z * s), c);
}

type TreeState = 'alive' | 'falling' | 'hidden' | 'rising';

interface TreeEntry {
  /** Wrapper group — sim position + fall/rise TRS go HERE; GLB internals
   *  untouched (PrefabLoader parents the visual under the logic anchor and
   *  ResetTransforms it — the wrapper IS that anchor). Wind is vertex-side
   *  and never touches this transform. */
  node: THREE.Group;
  state: TreeState;
  species: TreeSpecies;
  /** Base yaw (three space). */
  yaw: number;
  /** Unity-space anchor position (OnTowerBuild: treePos − towerPos). */
  unityPos: { x: number; y: number; z: number };
  /** Unity-space fall axis, set by onTowerBuilt (Cross(dir, up)). */
  fallAxis: { x: number; y: number; z: number };
  /** Origin TRS snapshot (TreeFall restores these on completion). */
  originPos: THREE.Vector3;
  originQuat: THREE.Quaternion;
  originScale: THREE.Vector3;
  fallDelay: number;
  fallT: number;
  riseT: number;
  /** TreeRise WaitForSeconds(index*0.05) remaining before regrow starts. */
  riseWait: number;
  mixer: THREE.AnimationMixer | null;
  /** MaterialPropertyBlock stand-in: (_ShakeDirection.xz [unity], _ShakeStartTime). */
  shake: TreeShakeUniform;
  /** NatureTree.lastBumpTime (+0x94), in view-clock seconds (init 0). */
  lastBump: number;
  /** Rise-end bump counter (deterministic stand-in for Random.Range). */
  riseCount: number;
  /** A player is currently inside the tree's sphere trigger. */
  playerInside: boolean;
  /** Per-tree material clones (+ shadow-pass depth materials) to dispose. */
  ownedMaterials: THREE.Material[];
}

export class TreeView {
  private readonly entries = new Map<number, TreeEntry>();
  private readonly templates: THREE.Object3D[];
  private readonly templates002: THREE.Object3D[];
  /** View clock = Unity Time.timeSinceLevelLoad = shader _Time.y. The SAME
   *  `{value}` object is the live uniform of every wind state. */
  private readonly clock = { value: 0 };
  /** Per-species shared wind uniforms (material floats of tree_00X_m). */
  private readonly windStates: Record<TreeSpecies, TreeWindState> = {
    tree_001: createTreeWindState(TREE_WIND_PARAMS.tree_001, this.clock),
    tree_002: createTreeWindState(TREE_WIND_PARAMS.tree_002, this.clock),
  };
  private disposed = false;
  private warnedNoWeight = false;

  // Fallback primitive tree (assets null/empty → stage stays populated
  // offline). Sized to the real LOD0 bounds (0.73 × 1.886 × 0.72): brown
  // trunk cylinder + green foliage cone. Shared by every fallback clone;
  // view-owned, freed in dispose(). The foliage carries the same wind patch
  // (tree_001 params); the trunk stays rigid.
  private readonly fallbackTemplate: THREE.Group;
  private readonly fallbackTrunkGeometry: THREE.CylinderGeometry;
  private readonly fallbackFoliageGeometry: THREE.ConeGeometry;
  private readonly fallbackTrunkMaterial: THREE.MeshStandardMaterial;
  private readonly fallbackFoliageMaterial: THREE.MeshStandardMaterial;

  /** @param root parent for tree wrappers (e.g. the stage characterRoot).
   *  @param assets master scenes from TreeView.load — null or empty falls
   *  back to the procedural tree. Templates are caller-owned: dispose()
   *  frees instances + fallbacks only (PickupView pattern). */
  constructor(
    private readonly root: THREE.Object3D,
    assets: TreeViewAssets | null,
  ) {
    this.templates = (assets?.variants ?? []).map((s) => this.prepareTemplate(s));
    this.templates002 = (assets?.variants002 ?? []).map((s) => this.prepareTemplate(s));
    this.fallbackTrunkGeometry = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 8);
    this.fallbackFoliageGeometry = new THREE.ConeGeometry(0.37, 1.45, 10);
    this.fallbackTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    this.fallbackFoliageMaterial = new THREE.MeshStandardMaterial({ color: 0x3e7a33, roughness: 0.9 });
    this.fallbackFoliageGeometry.computeBoundingBox();
    const fb = this.fallbackFoliageGeometry.boundingBox!;
    // Fallback foliage has no vertex colors: weight = height fraction, so the
    // cone sways like the real foliage (adaptation; trunk stays rigid).
    const fpos = this.fallbackFoliageGeometry.getAttribute('position');
    const fw = new Float32Array(fpos.count);
    for (let i = 0; i < fpos.count; i++) fw[i] = (fpos.getY(i) - fb.min.y) / (fb.max.y - fb.min.y);
    this.fallbackFoliageGeometry.setAttribute(TREE_WIND_UNIFORMS.weightAttribute, new THREE.BufferAttribute(fw, 1));
    this.fallbackTemplate = new THREE.Group();
    this.fallbackTemplate.name = 'tree_fallback';
    const trunk = new THREE.Mesh(this.fallbackTrunkGeometry, this.fallbackTrunkMaterial);
    trunk.name = 'tree_fallback_trunk';
    trunk.position.y = 0.25;
    const foliage = new THREE.Mesh(this.fallbackFoliageGeometry, this.fallbackFoliageMaterial);
    foliage.name = 'tree_fallback_foliage';
    foliage.position.y = 0.44 + 1.45 / 2; // cone base sits just above the trunk
    this.fallbackTemplate.add(trunk, foliage);
  }

  /** Load the extracted variant GLBs listed in manifest.json, grouped by
   *  species (manifest variants[].species; legacy manifests without the
   *  field load as tree_001). Per-file failure → that variant is dropped
   *  (never throws); if ALL fail (or the manifest is missing) the
   *  constructor falls back to procedural trees. WebP repack is used when
   *  textures_webp/_ok is present (same URL-rewrite pattern as
   *  PickupView/CharacterLibrary). */
  static async load(baseUrl = '/assets/trees/'): Promise<TreeViewAssets> {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    let recs: { file: string; species?: string }[] = [];
    try {
      const manifest = (await (await fetch(`${base}manifest.json`)).json()) as {
        variants?: { file: string; species?: string }[];
      };
      recs = manifest.variants ?? [];
    } catch (err) {
      console.warn('TreeView: manifest unavailable — using fallback trees', err);
      return { variants: [], variants002: [] };
    }
    let useWebp = false;
    if (typeof fetch === 'function') {
      useWebp = await fetch(`${base}textures_webp/_ok`, { method: 'HEAD' })
        .then((r) => r.ok)
        .catch(() => false);
    }
    const manager = new THREE.LoadingManager();
    if (useWebp) {
      manager.setURLModifier((url) => {
        if (url.includes('/textures/') && url.toLowerCase().endsWith('.png')) {
          return url.replace('/textures/', '/textures_webp/').replace(/\.png$/i, '.webp');
        }
        return url;
      });
    }
    const loader = new GLTFLoader(manager);
    const loadOne = async (file: string): Promise<THREE.Object3D | null> => {
      try {
        const gltf = await loader.loadAsync(base + file);
        // Mixer hook: keep clips on the MASTER scene (Object3D.clone()
        // JSON-roundtrips userData, which would strip AnimationClip methods).
        gltf.scene.userData.animations = gltf.animations;
        return gltf.scene;
      } catch (err) {
        console.warn(`TreeView: ${file} failed to load — variant dropped`, err);
        return null;
      }
    };
    const scenes = await Promise.all(recs.map((r) => loadOne(r.file)));
    const variants: THREE.Object3D[] = [];
    const variants002: THREE.Object3D[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (s === null) continue;
      (recs[i].species === 'tree_002' ? variants002 : variants).push(s);
    }
    return { variants, variants002 };
  }

  /** Add a tree at a UNITY-space position (mirrored x→−x). Deterministic
   *  variant: variantIndex % variants.length when given (integrator passes
   *  a stable index), else stableVariant(id, count) — within the SPECIES'
   *  template list. `species` selects tree_001 (default) vs tree_002;
   *  game.ts derives it from the scene node name prefix (see header
   *  INTEGRATOR CONTRACT). When the requested species has no templates
   *  (load failure), tree_001 templates stand in; both empty → procedural.
   *  Idempotent per id — the id IS the sim tree handle
   *  (GameCoreTree.handle.m_handle). */
  addTree(id: number, unityPos: { x: number; y: number; z: number },
          variantIndex?: number, species: TreeSpecies = 'tree_001'): void {
    if (this.disposed || this.entries.has(id)) return;
    let list = species === 'tree_002' ? this.templates002 : this.templates;
    if (list.length === 0) list = this.templates;
    const n = list.length;
    const vi = n === 0 ? 0
      : variantIndex !== undefined
        ? ((variantIndex % n) + n) % n
        : stableVariant(id, n);
    const template = n > 0 ? list[vi] : null;
    const inner = (template ?? this.fallbackTemplate).clone(); // shares geometry
    // Q4.NatureTree.Awake → SetBumpShaderParameters(Vector3.one, −100): idle.
    const shake: TreeShakeUniform = {
      value: new THREE.Vector3(SQRT_HALF, SQRT_HALF, TREE_IDLE_SHAKE_START),
    };
    // Templates carry their species' wind params (tree_002 falls back to the
    // tree_001 templates + params when it has none).
    const windSpecies: TreeSpecies = species === 'tree_002' && this.templates002.length > 0
      ? 'tree_002' : 'tree_001';
    const ownedMaterials = this.attachWind(inner, this.windStates[windSpecies], shake);
    const node = new THREE.Group();
    node.name = `tree:${id}`;
    // Mirror rule: unity (x,y,z) → three (−x,y,z).
    node.position.set(f(-unityPos.x), f(unityPos.y), f(unityPos.z));
    // TS ADAPTATION: scene-node yaw is not part of the sim tree contract
    // (game.ts treePositions carries position only) — deterministic hash
    // yaw stands in for the original scene placement variety. Unity yaw θ
    // about +Y → three rotation.y = −θ.
    const yaw = f(-(hash01(id, 1) * 2 * Math.PI));
    node.rotation.y = yaw;
    node.add(inner);
    this.root.add(node);
    // Mixer hook (no clips ship today — manifest clips:[]; see header).
    let mixer: THREE.AnimationMixer | null = null;
    const clips = template?.userData.animations as THREE.AnimationClip[] | undefined;
    if (clips && clips.length > 0) {
      mixer = new THREE.AnimationMixer(inner);
      for (const clip of clips) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    }
    this.entries.set(id, {
      node, state: 'alive', species, yaw,
      unityPos: { x: unityPos.x, y: unityPos.y, z: unityPos.z },
      fallAxis: { x: 0, y: 0, z: 1 },
      originPos: node.position.clone(),
      originQuat: node.quaternion.clone(),
      originScale: node.scale.clone(),
      fallDelay: f(hash01(id, 3) * FALL_DELAY_MAX), fallT: 0, riseT: 0, riseWait: 0,
      mixer, shake, lastBump: 0, riseCount: 0, playerInside: false, ownedMaterials,
    });
  }

  /** Remove a tree from the pool (stage teardown / sim tree removal). */
  removeTree(id: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.stopMixer(entry);
    this.root.remove(entry.node);
    this.entries.delete(id);
    // Clones SHARE geometry/textures with their template; only the per-tree
    // material clones (wind uniforms) are instance-exclusive.
    for (const m of entry.ownedMaterials) m.dispose();
  }

  /** Q4.NatureTree.OnTowerBuild @0x64A680 for ONE tree whose handle is in
   *  tower.retainedTrees (the caller loops the tower's claimed cost trees).
   *  @param towerUnityPos tower sim position (unity space). Direction =
   *  flat(treePos − towerPos); zero (the clicked tree) → delay 0 + random
   *  half-circle direction (see header). Omitted → treated as zero offset.
   *  No-op unless the tree is alive. */
  onTowerBuilt(id: number, towerUnityPos?: { x: number; y: number; z: number }): void {
    if (this.disposed) return;
    const entry = this.entries.get(id);
    if (entry === undefined || entry.state !== 'alive') return;
    const dx = f(entry.unityPos.x - (towerUnityPos?.x ?? entry.unityPos.x));
    const dz = f(entry.unityPos.z - (towerUnityPos?.z ?? entry.unityPos.z));
    const mag = f(Math.sqrt(f(f(dx * dx) + f(dz * dz))));
    let dirX: number;
    let dirZ: number;
    if (mag !== 0) {
      entry.fallDelay = f(hash01(id, 3) * FALL_DELAY_MAX); // Random.Range(0, 0.25)
      // Vector3.Normalize: zero below 1e-5.
      if (mag > 1e-5) { dirX = f(dx / mag); dirZ = f(dz / mag); } else { dirX = 0; dirZ = 0; }
    } else {
      entry.fallDelay = 0;
      const theta = f(hash01(id, 4) * FALL_DIR_RANGE); // Random.Range(0, π)
      dirX = f(Math.cos(theta));
      dirZ = f(Math.sin(theta)); // normalize of (cos,0,sin) is ~identity
    }
    // axis = Cross(dir, Vector3.up) in unity LH = (−dz, 0, dx)
    entry.fallAxis = { x: f(-dirZ), y: f(0), z: dirX };
    // Snap to the origin TRS before snapshotting (the original shader sway
    // never touches the transform).
    entry.node.position.copy(entry.originPos);
    entry.node.quaternion.copy(entry.originQuat);
    entry.node.scale.copy(entry.originScale);
    entry.state = 'falling';
    entry.fallT = 0;
  }

  /** Q4.NatureTree.OnTreeRevive @0x64A490 (treeReviveEvent: the tree's
   *  breakdown refcount returned to 0, i.e. tower SOLD → retainedTrees get
   *  Revive(player, index) in order). SetActive(true), localScale = 0,
   *  WaitForSeconds(index * 0.05), then linear regrow over 0.1s. No-op
   *  unless the tree is hidden. */
  onTreeRevive(id: number, index = 0): void {
    if (this.disposed) return;
    const entry = this.entries.get(id);
    if (entry === undefined || entry.state !== 'hidden') return;
    entry.state = 'rising';
    entry.riseT = 0;
    entry.riseWait = f(index * RISE_INDEX_STEP);
    entry.node.visible = true;
    entry.node.scale.set(0, 0, 0);
  }

  /** Back-compat alias: revive with index 0. */
  onTowerRemoved(id: number): void {
    this.onTreeRevive(id, 0);
  }

  /** Number of tree instances currently tracked (probe-visible). */
  get count(): number {
    return this.entries.size;
  }

  /** View clock in seconds (= shader _Time.y = Time.timeSinceLevelLoad). */
  get windTime(): number {
    return this.clock.value;
  }

  /** The tree's current MaterialPropertyBlock shake values (probe/tests). */
  getShake(id: number): { dirX: number; dirZ: number; start: number } | null {
    const e = this.entries.get(id);
    if (e === undefined) return null;
    return { dirX: e.shake.value.x, dirZ: e.shake.value.y, start: e.shake.value.z };
  }

  /** Q4.NatureTree.SetBumpShaderParameters @0x649B20 (raw x86 verified:
   *  `new Vector3(dir.x, 0, dir.z)` — y zeroed — then Vector3.Normalize
   *  [0x98d750], MPB.SetVector(_ShakeDirection), MPB.SetFloat(
   *  _ShakeStartTime = Time.timeSinceLevelLoad)). Zero-length → (0,0). */
  private setBumpShaderParameters(entry: TreeEntry, dirX: number, dirZ: number): void {
    const mag = Math.sqrt(dirX * dirX + dirZ * dirZ);
    const nx = mag > 1e-5 ? dirX / mag : 0;
    const nz = mag > 1e-5 ? dirZ / mag : 0;
    entry.shake.value.set(nx, nz, this.clock.value);
  }

  /** NatureTree.Bump(direction) @0x649F30 / the throttle shared by
   *  OnPlayerEnter @0x649FA0 and the TreeRise end: only when
   *  `Time.time − lastBumpTime > 1.0`. @param dir unity-space direction
   *  (y ignored). Returns whether the bump fired. */
  bump(id: number, dir: { x: number; z: number }): boolean {
    const entry = this.entries.get(id);
    if (this.disposed || entry === undefined) return false;
    return this.bumpEntry(entry, dir.x, dir.z);
  }

  private bumpEntry(entry: TreeEntry, dirX: number, dirZ: number): boolean {
    if (!(this.clock.value - entry.lastBump > TREE_BUMP_INTERVAL)) return false;
    entry.lastBump = this.clock.value;
    this.setBumpShaderParameters(entry, dirX, dirZ);
    return true;
  }

  /** NatureTree.OnPlayerEnter @0x649FA0: the player entered the tree's
   *  sphere trigger → bump with dir = `playerPos − treePos` (Vector3
   *  .op_Subtraction(other.position, this.position)); the shader displaces
   *  along −dir, i.e. the crown is first pushed AWAY from the player.
   *  @param playerPos unity-space player position. */
  onPlayerEnter(id: number, playerPos: { x: number; y: number; z: number }): boolean {
    const entry = this.entries.get(id);
    if (this.disposed || entry === undefined) return false;
    return this.bumpEntry(entry, playerPos.x - entry.unityPos.x, playerPos.z - entry.unityPos.z);
  }

  /** Emulates the Unity trigger callbacks of Structure.InitTriggers: a
   *  sphere (radius playerDetectionRange = 2) at each ACTIVE tree; the enter
   *  edge calls onPlayerEnter. Horizontal distance (the sim's player y is not
   *  terrain-conformed). Call once per frame with the players' unity
   *  positions. Fallen (hidden) trees have their trigger deactivated. */
  trackPlayers(players: Iterable<{ x: number; y: number; z: number }>): void {
    if (this.disposed) return;
    const r2 = TREE_PLAYER_TRIGGER_RADIUS * TREE_PLAYER_TRIGGER_RADIUS;
    const list = [...players];
    for (const [id, entry] of this.entries) {
      let hit: { x: number; y: number; z: number } | null = null;
      if (entry.state === 'alive') {
        for (const p of list) {
          const dx = p.x - entry.unityPos.x;
          const dz = p.z - entry.unityPos.z;
          if (dx * dx + dz * dz <= r2) { hit = p; break; }
        }
      }
      if (hit !== null && !entry.playerInside) this.onPlayerEnter(id, hit);
      entry.playerInside = hit !== null;
    }
  }

  /** Advance the wind clock (_Time.y, the live uniform of every tree
   *  material), the fall/rise state machines, and any clip mixers (none
   *  ship today). The wind runs in ALL states — the original sway is a
   *  vertex shader on global time; fall/rise move the transform only.
   *  @param dt frame delta (s). */
  update(dt: number): void {
    if (this.disposed) return;
    this.clock.value += dt;
    for (const [id, entry] of this.entries) {
      entry.mixer?.update(dt);
      const node = entry.node;
      switch (entry.state) {
        case 'alive':
          break; // wind is vertex-side; the wrapper keeps its base yaw
        case 'falling': {
          entry.fallT = f(entry.fallT + dt);
          const t = f(entry.fallT - entry.fallDelay);
          if (t < 0) break; // WaitForSeconds(delay) — still upright
          const k = f(Math.min(f(t / FALL_DURATION), 1));
          // Sink: position -= up * (fallHeight/fallDuration) * dt.
          node.position.set(entry.originPos.x,
                            f(entry.originPos.y - f(FALL_HEIGHT * k)),
                            entry.originPos.z);
          // Rotate: AngleAxis(−angle, axis), angle capped at fallAngle.
          const angle = f(Math.min(f(f(FALL_ANGLE * t) / FALL_ROTATE_DURATION), FALL_ANGLE));
          fallQuaternion(angle, entry.fallAxis, node.quaternion);
          // Shrink: uniform scale toward fallScale (Vector3.one * desired).
          const speed = f((entry.originScale.x - FALL_SCALE) / FALL_DURATION);
          const s = f(Math.max(f(entry.originScale.x - f(t * speed)), FALL_SCALE));
          node.scale.set(s, s, s);
          if (k >= 1) {
            // Distance(origin, current) >= fallHeight → SetActive(false)
            // + SetPositionAndRotation(origin) + localScale = origin.
            node.visible = false;
            node.position.copy(entry.originPos);
            node.quaternion.copy(entry.originQuat);
            node.scale.copy(entry.originScale);
            entry.state = 'hidden';
          }
          break;
        }
        case 'rising': {
          let riseDt = dt;
          if (entry.riseWait > 0) {
            entry.riseWait = f(entry.riseWait - dt);
            if (entry.riseWait > 0) break; // WaitForSeconds(index*0.05)
            riseDt = f(-entry.riseWait); // spill the overshoot into the regrow
            entry.riseWait = 0;
            if (riseDt <= 0) break;
          }
          entry.riseT = f(entry.riseT + riseDt);
          const k = f(Math.min(f(entry.riseT / RISE_SCALE_TIME), 1));
          // Vector3.one * (scaleTime − remaining) / scaleTime (NOT destScale*k).
          node.scale.set(k, k, k);
          if (k >= 1) {
            node.scale.copy(entry.originScale); // exact restore (faithful)
            entry.state = 'alive';
            // <TreeRise>MoveNext: random shader bump — Vector3(Random.Range(
            // −1,1), 0, Random.Range(−1,1)) (DAT_00b7e73c/e740), same 1 s throttle.
            const n = entry.riseCount++;
            this.bumpEntry(entry, hash01(id, 100 + n * 2) * 2 - 1, hash01(id, 101 + n * 2) * 2 - 1);
          }
          break;
        }
        case 'hidden':
          break; // SetActive(false) — nothing to advance
      }
    }
  }

  /** Remove every instance and free view-owned resources. Templates are
   *  caller-owned (may be shared) and are NOT disposed here. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, entry] of this.entries) {
      this.stopMixer(entry);
      this.root.remove(entry.node);
      this.entries.delete(id);
      for (const m of entry.ownedMaterials) m.dispose();
    }
    this.fallbackTrunkGeometry.dispose();
    this.fallbackFoliageGeometry.dispose();
    this.fallbackTrunkMaterial.dispose();
    this.fallbackFoliageMaterial.dispose();
  }

  // ---- internals ----------------------------------------------------------

  private prepareTemplate(scene: THREE.Object3D): THREE.Object3D {
    scene.traverse((o) => {
      // LOD0 only (demo LOD policy); LOD1-3 stubs stay in the GLB.
      if (/_LOD[1-9]\d*$/.test(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (o.visible && !this.warnedNoWeight &&
            !mesh.geometry.getAttribute(TREE_WIND_UNIFORMS.weightAttribute)) {
          this.warnedNoWeight = true; // once per view
          console.warn(`TreeView: ${o.name} has no _WINDWEIGHT attribute — rigid. ` +
            'Re-run tools/assets/extract_trees.py --wind-only.');
        }
      }
    });
    return scene;
  }

  /** Give every wind-weighted mesh of a tree clone its OWN material (and a
   *  depth material for the shadow pass) carrying the wind patch + the
   *  tree's MaterialPropertyBlock-style shake uniform. Textures/geometry stay
   *  shared. Returns the materials this tree owns (disposed on removal). */
  private attachWind(inner: THREE.Object3D, state: TreeWindState, shake: TreeShakeUniform): THREE.Material[] {
    const owned: THREE.Material[] = [];
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
      if (!mesh.geometry.getAttribute(TREE_WIND_UNIFORMS.weightAttribute)) return; // rigid (trunk, stubs)
      const src = mesh.material;
      const own = src.clone();
      applyTreeWind(own, state, shake, src);
      mesh.material = own;
      // SHADOWCASTER pass runs the same vertex program: shadows sway too.
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      applyTreeWind(depth, state, shake);
      mesh.customDepthMaterial = depth;
      owned.push(own, depth);
    });
    return owned;
  }

  private stopMixer(entry: TreeEntry): void {
    if (entry.mixer !== null) {
      entry.mixer.stopAllAction();
      entry.mixer.uncacheRoot(entry.node.children[0]);
      entry.mixer = null;
    }
  }
}
