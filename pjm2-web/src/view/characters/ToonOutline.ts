// src/view/characters/ToonOutline.ts
// Inverted-hull character outlines (the original's thin dark toon rim).
//
// DECOMP PROVENANCE (treated as data; what the outline files ACTUALLY specify):
//   - Q4.SkinnedMeshOutlineSetting$$.ctor @0x760690: fields (skeleton/Q4.cs
//     TypeDefIndex 2708) are `color` @0x18 — initialized to Color.yellow —
//     `outlineMaterial` @0x28, `lodRendererOverride` @0x30 = -1 (0xffffffff).
//     This is the SELECTION-outline setting component: Structure.SetSelected
//     @0x535A20 reads its `color` (decomp/src/Q4/Structure.cs) and hands it to
//     the selection outline renderer. It is NOT the permanent character rim.
//   - Q4.ObjectOutlineRenderer @0x3d90d0..0x3d9ef0: selection outlines drawn
//     via a CommandBuffer ("Outline_Command_Buffer", camera event 0x13),
//     bucketed per shader; clones the target's material, sets shader property
//     `_OutlineColorOnSelect` (player color), and OutlineMeshInfo.Update
//     @0x3da2d0 writes `_OutlineOnSelectWidth` = OutlineFade.Width() each
//     frame; passes HOLLOW / OUTLINE / BLOCKED_OUTLINE via DrawRenderer.
//   - Q4.OutlineFade @0x3d9880/0x3dc460: m_currentWidth @0x10 starts 0,
//     m_activating @0x14 starts true; Update(dt) ramps width linearly —
//     activating: min(width + dt*rateIn, k_destWidth); deactivating:
//     max(width + dt*rateOut, 0) — with k_destWidth = 0.05 (const, skeleton
//     Q4.cs:1850). Finished ⇔ !activating && width == 0. The rate constants
//     (rodata DAT_00b7a674 in / DAT_00b7a67c out) are NOT recoverable from
//     the artifacts in this tree (the decompiled RVAs belong to the dumped
//     Il2CppUserAssemblies.elf layout, not the extracted eboot).
//   - Q4.StartOutlineController is the title-screen "press start" UI overlay
//     (its 1.0/30.0/1.0 ctor fields are UI timers) — unrelated to characters.
//
// So the decompiled code specifies the SELECTION outline (yellow/player
// color, width fading 0 → 0.05 in shader units), while the permanent dark
// rim lives in the characters' Unity outline shader assets (not decompiled
// here). FIDELITY: NEAR — defaults below approximate the shipped look
// (thin dark brown-black rim); screenshot-compared, not shader-decompiled.
// The 0.05 selection width is available as OUTLINE_SELECTION_WIDTH for a
// future selection-highlight pass.
//
// TECHNIQUE: inverted hull. Per source mesh, a hull mesh SHARES the
// geometry (never cloned/disposed here) and renders THREE.BackSide with a
// MeshBasicMaterial whose vertex shader pushes positions along the OBJECT-
// space normal by uOutlineWidth BEFORE skinning (`begin_vertex` hook, ahead
// of `skinning_vertex` in three 0.169 meshbasic). The push is carried through
// skinning with the vertex — the standard inverted hull for skinned chars.
//
// SKINNED PARENTING: the hull is added as a CHILD of the source SkinnedMesh
// with IDENTITY local transform (the standard trick). Its matrixWorld then
// equals the source's, and the skinning shader works in bind space via
// bindMatrix/bindMatrixInverse + shared skeleton bone matrices — no double
// transform. This mirrors three's own SkinnedMesh.copy() semantics: skeleton
// SHARED, bindMatrix/bindMatrixInverse/bindMode copied. AttachedBindMode
// recomputes bindMatrixInverse from matrixWorld each frame (equal for both);
// DetachedBindMode keeps the copied inverse — correct either way.
//
// RENDER ORDER: hull.renderOrder copies the source's. BackSide + depth test
// already occludes the hull behind the front faces, so no order bias is
// needed (a -1 bias would only matter for depth-write-disabled tricks).
//
// SHARED-MATERIAL SAFETY: CharacterLibrary clones share materials with the
// templates, so this module NEVER touches source materials — every hull gets
// its OWN MeshBasicMaterial. dispose() frees only those hull materials.

import * as THREE from 'three';

export interface OutlineOptions {
  /** Rim color. Default OUTLINE_DEFAULT_COLOR (NEAR, see header). */
  color?: THREE.ColorRepresentation;
  /** Hull push in WORLD units (object-space pre-skin). Default ~0.02. */
  width?: number;
}

export interface OutlineHandle {
  /** Remove hulls from the graph; dispose ONLY the hull materials.
   *  Shared geometries and source materials are untouched. Idempotent. */
  dispose(): void;
  /** Live width update (patches compiled uniforms; no recompile). */
  setWidth(w: number): void;
  setVisible(v: boolean): void;
  /** Hull meshes in creation order; emptied by dispose(). */
  readonly meshes: THREE.Mesh[];
}

/** Uniform names kept exported for tests/probes (SplatTerrain pattern). */
export const OUTLINE_UNIFORMS = {
  width: 'uOutlineWidth',
  color: 'uOutlineColor',
} as const;

// NEAR defaults: the permanent rim's shader constants are not in the decomp
// (see header). Dark brown-black reads as the shipped toon rim.
export const OUTLINE_DEFAULT_COLOR = 0x1a120b;
export const OUTLINE_DEFAULT_WIDTH = 0.02;
// CONFIRMED: Q4.OutlineFade.k_destWidth = 0.05 (skeleton/Q4.cs:1850) — the
// SELECTION outline's fade target (shader width units, not world units).
export const OUTLINE_SELECTION_WIDTH = 0.05;

const VERTEX_HEADER = 'uniform float uOutlineWidth;\n';
const VERTEX_HOOK = '#include <begin_vertex>';
// Object-space normal push BEFORE skinning: skinning_vertex then transforms
// the displaced position with the same bone blend as the surface vertex.
const VERTEX_INJECT = '#include <begin_vertex>\n\ttransformed += normal * uOutlineWidth;';

const FRAGMENT_HEADER = 'uniform vec3 uOutlineColor;\n';
const FRAGMENT_HOOK = 'vec4 diffuseColor = vec4( diffuse, opacity );';
const FRAGMENT_INJECT = 'vec4 diffuseColor = vec4( uOutlineColor, opacity );';

interface OutlineState {
  width: number;
  color: THREE.Color;
  shader: THREE.WebGLProgramParametersWithUniforms | null;
}

function installOutlineShader(m: THREE.MeshBasicMaterial, state: OutlineState): void {
  m.userData.outline = state;
  m.onBeforeCompile = (shader) => {
    state.shader = shader;
    shader.uniforms[OUTLINE_UNIFORMS.width] = { value: state.width };
    shader.uniforms[OUTLINE_UNIFORMS.color] = { value: state.color };
    if (!shader.vertexShader.includes('uOutlineWidth')) {
      shader.vertexShader = VERTEX_HEADER +
        shader.vertexShader.replace(VERTEX_HOOK, VERTEX_INJECT);
    }
    if (!shader.fragmentShader.includes('uOutlineColor')) {
      shader.fragmentShader = FRAGMENT_HEADER +
        shader.fragmentShader.replace(FRAGMENT_HOOK, FRAGMENT_INJECT);
    }
  };
  m.customProgramCacheKey = () => 'pjm2-toon-outline';
}

function makeHullMaterial(color: THREE.Color, width: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  installOutlineShader(m, { width, color, shader: null });
  return m;
}

/** Build one hull for a source mesh (plain or skinned). Shares geometry;
 *  skinned hulls share the skeleton and copy the bind state (see header). */
function makeHull(src: THREE.Mesh, color: THREE.Color, width: number): THREE.Mesh {
  const mat = makeHullMaterial(color, width);
  let hull: THREE.Mesh;
  const skinned = src as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    const h = new THREE.SkinnedMesh(src.geometry, mat);
    h.skeleton = skinned.skeleton;
    h.bindMatrix.copy(skinned.bindMatrix);
    h.bindMatrixInverse.copy(skinned.bindMatrixInverse);
    h.bindMode = skinned.bindMode;
    hull = h;
  } else {
    hull = new THREE.Mesh(src.geometry, mat);
  }
  hull.name = `${src.name}_outline`;
  hull.userData.isOutline = true;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.renderOrder = src.renderOrder;
  hull.frustumCulled = src.frustumCulled;
  // Hulls must never intercept picking raycasts (selection targets the
  // surface mesh); traversals can also skip via userData.isOutline.
  hull.raycast = () => {};
  // Identity local transform UNDER the source: matrixWorld matches it, so
  // the bind-space skinning math stays exact (header: SKINNED PARENTING).
  src.add(hull);
  return hull;
}

/** Add inverted-hull outline meshes to every SkinnedMesh/Mesh under root.
 *  Idempotent per root: a second call returns the SAME handle (first call's
 *  options win; use setWidth to adjust). Meshes without position+normal
 *  attributes are skipped (a hull needs normals; degenerate otherwise). */
export function addOutline(root: THREE.Object3D, opts: OutlineOptions = {}): OutlineHandle {
  const existing = root.userData.toonOutline as OutlineHandle | undefined;
  if (existing) return existing;

  const color = new THREE.Color(opts.color ?? OUTLINE_DEFAULT_COLOR);
  const width = opts.width ?? OUTLINE_DEFAULT_WIDTH;

  // Collect first, then mutate — never add children mid-traverse.
  const sources: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o.userData.isOutline) return; // never outline an outline
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.children.some((c) => c.userData.isOutline)) return; // already hulled
    const g = mesh.geometry;
    if (!g.getAttribute('position') || !g.getAttribute('normal')) return;
    sources.push(mesh);
  });

  const meshes: THREE.Mesh[] = sources.map((src) => makeHull(src, color, width));
  let disposed = false;

  const handle: OutlineHandle = {
    meshes,
    setWidth(w: number): void {
      // Clamp at 0 like Q4.OutlineFade.Update's Max(..., 0) deactivation
      // branch (@0x3dc460) — a negative push would invert the hull inward.
      const clamped = Math.max(w, 0);
      for (const hull of meshes) {
        const m = hull.material as THREE.MeshBasicMaterial;
        const state = m.userData.outline as OutlineState;
        state.width = clamped;
        if (state.shader) {
          state.shader.uniforms[OUTLINE_UNIFORMS.width].value = clamped;
        }
      }
    },
    setVisible(v: boolean): void {
      for (const hull of meshes) hull.visible = v;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const hull of meshes) {
        hull.removeFromParent();
        // ONLY the hull material — geometry is shared with the source mesh
        // (and across SkeletonUtils.clone instances); source materials are
        // shared with CharacterLibrary templates and must stay alive.
        (hull.material as THREE.Material).dispose();
      }
      meshes.length = 0;
      delete root.userData.toonOutline;
    },
  };
  root.userData.toonOutline = handle;
  return handle;
}
