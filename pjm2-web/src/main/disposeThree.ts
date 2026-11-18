// src/main/disposeThree.ts
// Generic three.js teardown used by StageSession.dispose(): frees GPU/CPU resources of an object tree
// (geometries, materials, every texture a material references, skinned-mesh skeleton textures, custom
// ShaderMaterial uniform textures). Idempotent. Never touches `shared` resources (passed in a Set) so
// shell-owned textures (UI atlases etc.) survive.

import * as THREE from 'three';

function disposeTexture(t: THREE.Texture, shared: ReadonlySet<unknown>): void {
  if (!shared.has(t)) t.dispose();
}

function disposeMaterial(m: THREE.Material, shared: ReadonlySet<unknown>): void {
  if (shared.has(m)) return;
  const rec = m as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (v instanceof THREE.Texture) disposeTexture(v, shared);
  }
  const uniforms = (m as THREE.ShaderMaterial).uniforms;
  if (uniforms !== undefined) {
    for (const u of Object.values(uniforms)) {
      const v = (u as { value?: unknown }).value;
      if (v instanceof THREE.Texture) disposeTexture(v, shared);
      else if (Array.isArray(v)) for (const e of v) if (e instanceof THREE.Texture) disposeTexture(e, shared);
    }
  }
  // splat/terrain materials keep their layer textures in userData
  const splat = (m.userData as { splat?: { layers?: Record<string, unknown> } }).splat;
  if (splat?.layers !== undefined) {
    for (const v of Object.values(splat.layers)) if (v instanceof THREE.Texture) disposeTexture(v, shared);
  }
  m.dispose();
}

/** Dispose every geometry/material/texture reachable from `root` (does not remove `root` from its parent). */
export function disposeObject3D(root: THREE.Object3D, shared: ReadonlySet<unknown> = new Set()): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry !== undefined && !shared.has(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat !== undefined) for (const m of Array.isArray(mat) ? mat : [mat]) disposeMaterial(m, shared);
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk !== undefined && sk !== null) sk.dispose();
    const pts = o as THREE.Points;
    if (pts.isPoints === true && pts.geometry !== undefined) pts.geometry.dispose();
  });
}

/** Collect every Object3D reachable from a plain asset record (Maps/arrays/objects, shallow depth) —
 *  used to dispose loader "template" bundles (trees, pickups, projectile models) without knowing their shape. */
export function collectObject3Ds(x: unknown, depth = 4, out: Set<THREE.Object3D> = new Set(), seen: Set<unknown> = new Set()): THREE.Object3D[] {
  if (x === null || typeof x !== 'object' || depth < 0 || seen.has(x)) return [...out];
  seen.add(x);
  if (x instanceof THREE.Object3D) { out.add(x); return [...out]; }
  if (x instanceof Map) { for (const v of x.values()) collectObject3Ds(v, depth - 1, out, seen); return [...out]; }
  if (Array.isArray(x) || x instanceof Set) { for (const v of x) collectObject3Ds(v, depth - 1, out, seen); return [...out]; }
  if (x instanceof THREE.Texture || x instanceof THREE.Material || x instanceof THREE.BufferGeometry) return [...out];
  for (const v of Object.values(x as Record<string, unknown>)) collectObject3Ds(v, depth - 1, out, seen);
  return [...out];
}
