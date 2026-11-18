// src/view/stage/TreeSurfaceMaps.ts
// Binds the tree materials' NORMAL + METAL/SMOOTHNESS maps that the GLB export
// dropped. tree_001_m / tree_002_m are shader "Nature/Plant/SolidTree" with
// keywords _NORMALMAP _METALLICGLOSSMAP (Unity Standard channel layout):
//   _BumpMap  = tree_00N_Normal  (BC3/DXT5nm: x in A, y in G, z rebuilt)
//   _MetallicGlossMap = tree_00N_Metal (R metallic = 0, A smoothness ~0.2 avg)
// The extractor wrote "grayscale height/bump-style map ... not bound" — wrong:
// it is a DXT5nm tangent-space map (mean RGBA 127/127/127/126) and it is the
// source of the felt/fur micro-relief on foliage. The GLB carries a TANGENT
// attribute (verified right-handed vs the UVs: 4440/4440 vertices), so three's
// tangent-space path applies. Textures are the same WebP repacks the colour
// map uses; flipY=false matches the glTF UV convention.
//
// Called once by the integrator between TreeView.load() and `new TreeView()`;
// TreeView chains whatever onBeforeCompile the template material has, so the
// wind patch composes with the DXT5nm/Metal patch from UnityStandardMaps.

import * as THREE from 'three';
import { installUnityStandardMaps } from './UnityStandardMaps';
import { packImageUrlAsync } from '../pack/bootPacks';
import type { TreeViewAssets } from './TreeView';

interface ManifestTexture { textureName: string; file: string; webpFile?: string; slots?: string[] }
interface ManifestVariant { species?: string; textures?: ManifestTexture[] }

/** Pure: pick the bump / metal texture records of a species from the manifest. */
export function pickSurfaceTextures(
  variants: ManifestVariant[], species: string,
): { normal: ManifestTexture | null; metal: ManifestTexture | null } {
  const v = variants.find((x) => (x.species ?? 'tree_001') === species && x.textures);
  const has = (slot: string) => v?.textures?.find((t) => t.slots?.includes(slot)) ?? null;
  return { normal: has('_BumpMap'), metal: has('_MetallicGlossMap') };
}

async function loadTex(rawUrl: string): Promise<THREE.Texture | null> {
  const url = await packImageUrlAsync(rawUrl); // packed bytes (blob:) or the loose file
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.flipY = false; // glTF UV convention (matches GLTFLoader's colour map)
        t.colorSpace = THREE.NoColorSpace; // data map
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Bind normal + metal/smoothness maps on every tree template material.
 *  Never throws; absent textures leave the material untouched. */
export async function applyTreeSurfaceMaps(
  assets: TreeViewAssets, baseUrl = '/assets/trees/',
): Promise<number> {
  if (typeof document === 'undefined') return 0; // headless: no image decode
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let variants: ManifestVariant[] = [];
  let useWebp = false;
  try {
    variants = ((await (await fetch(`${base}manifest.json`)).json()) as { variants?: ManifestVariant[] }).variants ?? [];
    useWebp = await fetch(`${base}textures_webp/_ok`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  } catch { return 0; }

  const mats = new Map<string, Set<THREE.MeshStandardMaterial>>();
  for (const scene of [...assets.variants, ...(assets.variants002 ?? [])]) {
    scene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.isMesh ? (mesh.material as THREE.MeshStandardMaterial) : null;
      if (m && m.isMeshStandardMaterial && /^tree_00\d_m$/.test(m.name)) {
        const key = m.name.replace(/_m$/, '');
        if (!mats.has(key)) mats.set(key, new Set());
        mats.get(key)!.add(m);
      }
    });
  }
  let bound = 0;
  for (const [species, set] of mats) {
    const { normal, metal } = pickSurfaceTextures(variants, species);
    const url = (t: ManifestTexture | null) => (t ? base + (useWebp && t.webpFile ? t.webpFile : t.file) : null);
    const [nTex, mTex] = await Promise.all([
      url(normal) ? loadTex(url(normal)!) : Promise.resolve(null),
      url(metal) ? loadTex(url(metal)!) : Promise.resolve(null),
    ]);
    for (const m of set) {
      if (nTex) { m.normalMap = nTex; m.normalScale.set(1, 1); } // _BumpScale 1
      if (mTex) {
        m.metalnessMap = mTex; m.roughnessMap = mTex;
        m.metalness = 1; m.roughness = 1; // maps scale: metal = R (0), roughness = 1 - A * _GlossMapScale(1)
      }
      if (nTex || mTex) {
        installUnityStandardMaps(m, { hasNormalMap: !!nTex, hasMetalGlossMap: !!mTex, glossMapScale: 1 });
        m.needsUpdate = true;
        bound++;
      }
    }
  }
  return bound;
}
