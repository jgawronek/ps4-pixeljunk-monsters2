// src/view/stage/GrassView.ts
// Q4.GrassInstanceRenderer (stages 1-6), see docs/RENDER_EXTRAS_ANALYSIS.md.
//
// ORIGINAL: the level has ~74 (stage 1-3) / 48 (stage 4-6) Transform-only "grass_00N" nodes under
// Small_Props_Grass (renderers stripped). GrassInstanceRenderer clusters them (ClusterSize 4), picks a LOD per
// cluster from the prefab's LODGroup (screenRelativeHeight 0.147 / 0.096 / 0.023, meshes GrassProc_LOD0..2 =
// 180 / 100 / 60 verts) and draws them with Graphics instancing (below LOD2: a render-to-texture billboard
// impostor + BillboardPostProcess). Material Nature/Grass/ProceduralGrass (deferred): vertex program =
// wind sway weighted by vertex colour .r (= blade height) + per-vertex albedo
// lerp(_GrassColor1, _GrassColor2, fract(sin(12.9898*worldX + 78.233*worldZ)*43758.5453)) [ISA 0x21c-0x530,
// verified]; fragment = albedo (x _Tex, white), spec 0 / smoothness 0 (matte), fake AO = 1 - (_FakeAOHeight*(1-h))^
// _FakeAOSharpness (= none: _FakeAOHeight is 0 in both stage materials).
// PORT: one InstancedMesh per LOD (MeshStandardMaterial, roughness 1), the exact colour hash in the vertex shader,
// LOD chosen per instance from the camera distance with Unity's screen-relative-height rule. Billboards are NOT
// ported (instances below the LOD2 threshold keep LOD2). WIND is an APPROXIMATION (SolidTree-style main/noise sway,
// strength scaled down): the grass vertex program's sway (several sin products, ISA 0x1f4-0x4b4) was not decoded.

import * as THREE from 'three';

export interface GrassLodRecord {
  screenRelativeHeight: number;
  mesh: { vertexCount: number; positions: number[]; normals: number[]; uv0: number[]; colors: number[]; colorStride: number; indices: number[] };
  floats: Record<string, number>;
  colors: Record<string, number[]>;
}
export interface GrassPrefabRecord { lodSize: number; lods: GrassLodRecord[] }
export interface GrassInstanceRecord { prefab: string; pos: number[]; rot: number[]; scale: number[]; active: boolean }
export interface GrassFile { prefabs: Record<string, GrassPrefabRecord>; stages: Record<string, GrassInstanceRecord[]> }

/** Unity LODGroup: index of the LOD to draw for a given screen-relative height (0 = best), or -1 = culled/billboard. */
export function lodIndexForHeight(rel: number, thresholds: readonly number[]): number {
  for (let i = 0; i < thresholds.length; i++) if (rel >= thresholds[i]) return i;
  return -1;
}

/** LODGroup screen-relative height of an object of world size `size` at `distance` for a vertical fov (deg). */
export function screenRelativeHeight(size: number, distance: number, fovDeg: number): number {
  return size / Math.max(1e-4, 2 * distance * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}

/** ISA-exact per-vertex colour factor (Unity world coordinates). */
export function grassColorT(worldX: number, worldZ: number): number {
  const s = Math.sin(worldX * 12.9898 + worldZ * 78.233) * 43758.5;
  return s - Math.floor(s);
}

export function buildGrassGeometry(m: GrassLodRecord['mesh']): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = m.vertexCount;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Unity -> three: mirror X (indices are flipped below to keep the winding).
    pos[i * 3] = -m.positions[i * 3]; pos[i * 3 + 1] = m.positions[i * 3 + 1]; pos[i * 3 + 2] = m.positions[i * 3 + 2];
    nrm[i * 3] = -m.normals[i * 3]; nrm[i * 3 + 1] = m.normals[i * 3 + 1]; nrm[i * 3 + 2] = m.normals[i * 3 + 2];
    w[i] = m.colors[i * m.colorStride]; // vertex colour .r = wind weight (blade height)
  }
  const idx = new Uint16Array(m.indices.length);
  for (let i = 0; i < idx.length; i += 3) { idx[i] = m.indices[i]; idx[i + 1] = m.indices[i + 2]; idx[i + 2] = m.indices[i + 1]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('windweight', new THREE.BufferAttribute(w, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const VERT_DECL = `attribute float windweight;
uniform float uGrassTime;
uniform vec3 uGrassMain;
uniform vec3 uGrassNoise;
varying float vGrassT;
`;
const VERT_INJECT = `#include <begin_vertex>
	{
		vec3 gW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
		vec3 gU = vec3( - gW.x, gW.y, gW.z );
		vGrassT = fract( sin( gU.x * 12.9898 + gU.z * 78.233 ) * 43758.5 );
		float gw = windweight;
		float gMain = 1.15 * ( uGrassMain.z * gw * 0.05 ) * ( 0.7 * sin( ( ( gU.x + gU.z ) * 0.70710677 + uGrassMain.y * 2.0 * uGrassTime ) / uGrassMain.x ) + 0.42 );
		float gNoise = 1.05 * ( uGrassNoise.z * gw * 0.05 ) * sin( ( ( gU.x - gU.z ) * 0.70710677 + uGrassNoise.y * ( 2.0 * uGrassTime + 0.9424778 ) ) / uGrassNoise.x );
		vec3 dU = vec3( 0.35355338 * ( gMain + gNoise ), 0.0, 0.35355338 * ( gMain - gNoise ) );
		vec3 dW = vec3( - dU.x, dU.y, dU.z );
		mat3 gM = mat3( instanceMatrix );
		transformed += ( transpose( gM ) * dW ) / max( dot( gM[0], gM[0] ), 1e-6 );
	}`;
const FRAG_DECL = `uniform vec3 uGrassColor1;
uniform vec3 uGrassColor2;
varying float vGrassT;
`;

export function createGrassMaterial(
  prefab: GrassLodRecord, time: { value: number },
): THREE.MeshStandardMaterial {
  const c1 = prefab.colors._GrassColor1, c2 = prefab.colors._GrassColor2, f = prefab.floats;
  const u1 = { value: new THREE.Color().setRGB(c1[0], c1[1], c1[2], THREE.SRGBColorSpace) };
  const u2 = { value: new THREE.Color().setRGB(c2[0], c2[1], c2[2], THREE.SRGBColorSpace) };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.name = 'grass_procedural';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = time;
    shader.uniforms.uGrassMain = { value: new THREE.Vector3(f._MainWindFrequency, f._MainWindSpeed, f._MainWindStrength) };
    shader.uniforms.uGrassNoise = { value: new THREE.Vector3(f._NoiseWindFrequency, f._NoiseWindSpeed, f._NoiseWindStrength) };
    shader.uniforms.uGrassColor1 = u1;
    shader.uniforms.uGrassColor2 = u2;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <begin_vertex>', VERT_INJECT);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      'vec4 diffuseColor = vec4( mix( uGrassColor1, uGrassColor2, vGrassT ), opacity );',
    );
  };
  m.customProgramCacheKey = () => 'pjm2-grass-procedural';
  return m;
}

export class GrassView {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly lodMeshes: THREE.InstancedMesh[] = [];
  private readonly instances: { m: THREE.Matrix4; centre: THREE.Vector3 }[] = [];
  private readonly thresholds: number[];
  private readonly size: number;
  private tick = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(prefab: GrassPrefabRecord, instances: GrassInstanceRecord[]) {
    this.thresholds = prefab.lods.map((l) => l.screenRelativeHeight);
    this.size = prefab.lodSize;
    this.group.name = 'grass-instanced';
    const live = instances.filter((i) => i.active);
    for (const i of live) {
      // Unity TRS -> three (mirror X: position.x -> -x, quaternion (x,y,z,w) -> (x,-y,-z,w)).
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(-i.pos[0], i.pos[1], i.pos[2]),
        new THREE.Quaternion(i.rot[0], -i.rot[1], -i.rot[2], i.rot[3]),
        new THREE.Vector3(i.scale[0], i.scale[1], i.scale[2]),
      );
      this.instances.push({ m, centre: new THREE.Vector3(-i.pos[0], i.pos[1] + prefab.lodSize * 0.4, i.pos[2]) });
    }
    for (const lod of prefab.lods) {
      const geo = buildGrassGeometry(lod.mesh);
      const mat = createGrassMaterial(lod, this.time);
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, this.instances.length));
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.name = 'grass-lod';
      this.group.add(im);
      this.lodMeshes.push(im);
      this.disposables.push(geo, mat);
    }
  }

  get count(): number { return this.instances.length; }

  /** Per-LOD instance counts (probes/tests). */
  lodCounts(): number[] { return this.lodMeshes.map((m) => m.count); }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.time.value += dt;
    if (this.tick++ % 8 !== 0) return;
    const counts = this.lodMeshes.map(() => 0);
    for (const inst of this.instances) {
      const d = camera.position.distanceTo(inst.centre);
      let lod = lodIndexForHeight(screenRelativeHeight(this.size, d, camera.fov), this.thresholds);
      if (lod < 0) lod = this.lodMeshes.length - 1; // billboard range: keep the cheapest mesh (billboards not ported)
      this.lodMeshes[lod].setMatrixAt(counts[lod]++, inst.m);
    }
    this.lodMeshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.lodMeshes) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.lodMeshes.length = 0;
  }
}

/** Fetch + build the grass of a stage (null when the stage has none or the asset is missing). */
export async function loadGrassView(
  scene: string, fetchFn: typeof fetch = fetch, url = '/assets/grass/grass.json',
): Promise<GrassView | null> {
  try {
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const file = (await r.json()) as GrassFile;
    const inst = file.stages[scene] ?? [];
    if (inst.length === 0) return null;
    const prefab = file.prefabs[inst[0].prefab];
    return prefab ? new GrassView(prefab, inst) : null;
  } catch {
    return null;
  }
}
