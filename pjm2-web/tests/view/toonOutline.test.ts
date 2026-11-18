// tests/view/toonOutline.test.ts
// Inverted-hull outlines: hull construction (shared geometry, skinned bind
// state, identity-child parenting), shader chunk injection + live uniforms,
// handle control (setWidth/setVisible), dispose semantics (ONLY hull
// materials), per-root idempotency. Node-only — a fake shader object stands
// in for the WebGLProgramParametersWithUniforms three hands to
// onBeforeCompile (same pattern as splatTerrain.test.ts).

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  addOutline,
  OUTLINE_UNIFORMS,
  OUTLINE_DEFAULT_COLOR,
  OUTLINE_DEFAULT_WIDTH,
  OUTLINE_SELECTION_WIDTH,
} from '../../src/view/characters/ToonOutline';

const VERT = 'void main() {\n#include <begin_vertex>\n#include <skinning_vertex>\n}\n';
const FRAG = 'void main() {\nvec4 diffuseColor = vec4( diffuse, opacity );\n}\n';

function fakeShader() {
  return {
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {} as Record<string, { value: unknown }>,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

function geom(withNormal = true): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  if (withNormal) {
    g.setAttribute('normal', new THREE.BufferAttribute(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  }
  return g;
}

interface Rig {
  root: THREE.Group;
  plain: THREE.Mesh;
  skin: THREE.SkinnedMesh;
  bone: THREE.Bone;
  plainMat: THREE.MeshStandardMaterial;
  skinMat: THREE.MeshStandardMaterial;
}

/** Fake character root: one plain Mesh + one SkinnedMesh (1-bone skeleton),
 *  both MeshStandardMaterial like the CharacterLibrary GLB rigs. */
function rig(): Rig {
  const root = new THREE.Group();
  root.name = 'char:test';
  const plainMat = new THREE.MeshStandardMaterial({ color: 0x88aa44 });
  const plain = new THREE.Mesh(geom(), plainMat);
  plain.name = 'body';
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
  const skin = new THREE.SkinnedMesh(geom(), skinMat);
  skin.name = 'limb';
  const bone = new THREE.Bone();
  bone.name = 'bone0';
  skin.add(bone);
  skin.bind(new THREE.Skeleton([bone]));
  root.add(plain);
  root.add(skin);
  return { root, plain, skin, bone, plainMat, skinMat };
}

function hullOf(src: THREE.Mesh): THREE.Mesh {
  const h = src.children.find((c) => c.userData.isOutline);
  expect(h).toBeDefined();
  return h as THREE.Mesh;
}

function outlineMat(hull: THREE.Mesh): THREE.MeshBasicMaterial {
  return hull.material as THREE.MeshBasicMaterial;
}

describe('addOutline — hull construction', () => {
  it('creates one hull per mesh, named <orig>_outline and flagged', () => {
    const { root, plain, skin } = rig();
    const handle = addOutline(root);
    expect(handle.meshes).toHaveLength(2);
    const hp = hullOf(plain);
    const hs = hullOf(skin);
    expect(hp.name).toBe('body_outline');
    expect(hs.name).toBe('limb_outline');
    expect(hp.userData.isOutline).toBe(true);
    expect(hs.userData.isOutline).toBe(true);
    expect(handle.meshes[0]).toBe(hp);
    expect(handle.meshes[1]).toBe(hs);
    // Identity local transform UNDER the source (the bind-math trick).
    for (const h of [hp, hs]) {
      expect(h.position.length()).toBe(0);
      expect(h.quaternion.equals(new THREE.Quaternion())).toBe(true);
      expect(h.scale.equals(new THREE.Vector3(1, 1, 1))).toBe(true);
    }
  });

  it('shares geometry with the source — never cloned', () => {
    const { root, plain, skin } = rig();
    addOutline(root);
    expect(hullOf(plain).geometry).toBe(plain.geometry);
    expect(hullOf(skin).geometry).toBe(skin.geometry);
  });

  it('skinned hull shares the skeleton and copies bind state', () => {
    const { root, skin } = rig();
    addOutline(root);
    const h = hullOf(skin) as THREE.SkinnedMesh;
    expect(h.isSkinnedMesh).toBe(true);
    expect(h.skeleton).toBe(skin.skeleton);
    expect(h.bindMatrix.equals(skin.bindMatrix)).toBe(true);
    expect(h.bindMatrixInverse.equals(skin.bindMatrixInverse)).toBe(true);
    expect(h.bindMode).toBe(skin.bindMode);
  });

  it('plain-mesh hull stays a plain Mesh', () => {
    const { root, plain } = rig();
    addOutline(root);
    expect((hullOf(plain) as THREE.SkinnedMesh).isSkinnedMesh).toBeFalsy();
  });

  it('hull material is back-side basic (default color), shadows off, own instance', () => {
    const { root, plain, skin, plainMat, skinMat } = rig();
    plain.renderOrder = 3;
    addOutline(root);
    const hp = hullOf(plain);
    const hs = hullOf(skin);
    for (const h of [hp, hs]) {
      const m = outlineMat(h);
      expect(m).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(m.side).toBe(THREE.BackSide);
      expect(m.color.getHex()).toBe(OUTLINE_DEFAULT_COLOR);
      expect(h.castShadow).toBe(false);
      expect(h.receiveShadow).toBe(false);
    }
    expect(hp.renderOrder).toBe(3); // copied from source (documented choice)
    expect(outlineMat(hp)).not.toBe(outlineMat(hs));
    expect(outlineMat(hp)).not.toBe(plainMat);
    expect(outlineMat(hs)).not.toBe(skinMat);
  });

  it('never mutates source materials or visibility (shared-template safety)', () => {
    const { root, plain, skin, plainMat, skinMat } = rig();
    addOutline(root);
    expect(plain.material).toBe(plainMat);
    expect(skin.material).toBe(skinMat);
    expect(plain.visible).toBe(true);
    expect(skin.visible).toBe(true);
    expect(plain.userData.isOutline).toBeUndefined();
    expect(plainMat.side).toBe(THREE.FrontSide);
  });

  it('skips meshes without normals and non-mesh nodes', () => {
    const { root } = rig();
    const noNormal = new THREE.Mesh(geom(false), new THREE.MeshStandardMaterial());
    noNormal.name = 'degenerate';
    root.add(noNormal);
    const handle = addOutline(root);
    expect(handle.meshes).toHaveLength(2); // body + limb only
    expect(noNormal.children).toHaveLength(0);
  });

  it('hull matrixWorld tracks the source exactly (identity-child bind trick)', () => {
    const { root, skin, bone } = rig();
    addOutline(root);
    const h = hullOf(skin) as THREE.SkinnedMesh;
    root.position.set(1, 2, 3);
    root.rotation.y = 0.5;
    bone.position.x = 0.3; // pose the rig
    root.updateMatrixWorld(true);
    expect(h.matrixWorld.equals(skin.matrixWorld)).toBe(true);
    // AttachedBindMode recomputes bindMatrixInverse from matrixWorld each
    // update — identical for source and hull, so skinning stays exact.
    expect(h.bindMatrixInverse.equals(skin.bindMatrixInverse)).toBe(true);
  });

  it('hulls do not intercept raycasts', () => {
    const { root, plain } = rig();
    addOutline(root);
    const h = hullOf(plain);
    const intersects: THREE.Intersection[] = [];
    h.raycast(new THREE.Raycaster(), intersects);
    expect(intersects).toHaveLength(0);
  });
});

describe('addOutline — shader patch', () => {
  it('injects the pre-skin normal push + uniforms on compile', () => {
    const { root, plain } = rig();
    addOutline(root);
    const m = outlineMat(hullOf(plain));
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.vertexShader).toContain('uniform float uOutlineWidth;');
    expect(sh.vertexShader).toContain('transformed += normal * uOutlineWidth;');
    // Push must land BEFORE skinning consumes `transformed`.
    expect(sh.vertexShader.indexOf('transformed += normal'))
      .toBeLessThan(sh.vertexShader.indexOf('#include <skinning_vertex>'));
    expect(sh.fragmentShader).toContain('uniform vec3 uOutlineColor;');
    expect(sh.fragmentShader).toContain('vec4 diffuseColor = vec4( uOutlineColor, opacity );');
    expect(sh.uniforms[OUTLINE_UNIFORMS.width].value).toBe(OUTLINE_DEFAULT_WIDTH);
    const c = sh.uniforms[OUTLINE_UNIFORMS.color].value as THREE.Color;
    expect(c).toBeInstanceOf(THREE.Color);
    expect(c.getHex()).toBe(OUTLINE_DEFAULT_COLOR);
    expect(m.customProgramCacheKey()).toBe('pjm2-toon-outline');
  });

  it('honors custom color/width (0.05 = confirmed selection k_destWidth)', () => {
    const { root, plain } = rig();
    addOutline(root, { color: 0xff0000, width: OUTLINE_SELECTION_WIDTH });
    const m = outlineMat(hullOf(plain));
    expect(m.color.getHex()).toBe(0xff0000);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[OUTLINE_UNIFORMS.width].value).toBe(0.05);
    expect((sh.uniforms[OUTLINE_UNIFORMS.color].value as THREE.Color).getHex()).toBe(0xff0000);
  });
});

describe('OutlineHandle — live control', () => {
  it('setWidth patches compiled uniforms live on every hull', () => {
    const { root, plain, skin } = rig();
    const handle = addOutline(root);
    const shaders = [hullOf(plain), hullOf(skin)].map((h) => {
      const sh = fakeShader();
      outlineMat(h).onBeforeCompile(sh, null as never);
      return sh;
    });
    handle.setWidth(0.07);
    for (const sh of shaders) {
      expect(sh.uniforms[OUTLINE_UNIFORMS.width].value).toBe(0.07);
    }
  });

  it('setWidth before compile is picked up at compile time', () => {
    const { root, plain } = rig();
    const handle = addOutline(root);
    handle.setWidth(0.03);
    const sh = fakeShader();
    outlineMat(hullOf(plain)).onBeforeCompile(sh, null as never);
    expect(sh.uniforms[OUTLINE_UNIFORMS.width].value).toBe(0.03);
  });

  it('setWidth clamps negatives to 0 (OutlineFade Max(...,0) branch)', () => {
    const { root, plain } = rig();
    const handle = addOutline(root);
    const sh = fakeShader();
    outlineMat(hullOf(plain)).onBeforeCompile(sh, null as never);
    handle.setWidth(-1);
    expect(sh.uniforms[OUTLINE_UNIFORMS.width].value).toBe(0);
  });

  it('setVisible toggles hulls only', () => {
    const { root, plain, skin } = rig();
    const handle = addOutline(root);
    handle.setVisible(false);
    expect(hullOf(plain).visible).toBe(false);
    expect(hullOf(skin).visible).toBe(false);
    expect(plain.visible).toBe(true);
    expect(skin.visible).toBe(true);
    handle.setVisible(true);
    expect(hullOf(plain).visible).toBe(true);
    expect(hullOf(skin).visible).toBe(true);
  });
});

describe('OutlineHandle — dispose', () => {
  it('removes hulls and disposes ONLY hull materials', () => {
    const { root, plain, skin, plainMat, skinMat } = rig();
    const handle = addOutline(root);
    const hp = hullOf(plain);
    const hs = hullOf(skin);
    const hullDispose = vi.fn();
    const geomDispose = vi.fn();
    const srcDispose = vi.fn();
    outlineMat(hp).addEventListener('dispose', hullDispose);
    outlineMat(hs).addEventListener('dispose', hullDispose);
    plain.geometry.addEventListener('dispose', geomDispose);
    skin.geometry.addEventListener('dispose', geomDispose);
    plainMat.addEventListener('dispose', srcDispose);
    skinMat.addEventListener('dispose', srcDispose);

    handle.dispose();

    expect(hullDispose).toHaveBeenCalledTimes(2);
    expect(geomDispose).not.toHaveBeenCalled();
    expect(srcDispose).not.toHaveBeenCalled();
    expect(plain.children).not.toContain(hp);
    expect(skin.children).not.toContain(hs);
    expect(handle.meshes).toHaveLength(0);
    expect(root.userData.toonOutline).toBeUndefined();
    // Shared geometry still intact for the source mesh.
    expect(plain.geometry.getAttribute('position').count).toBe(3);
  });

  it('dispose is idempotent (no double material dispose)', () => {
    const { root, plain } = rig();
    const handle = addOutline(root);
    const hullDispose = vi.fn();
    outlineMat(hullOf(plain)).addEventListener('dispose', hullDispose);
    handle.dispose();
    handle.dispose();
    expect(hullDispose).toHaveBeenCalledTimes(1);
  });

  it('re-add after dispose builds fresh hulls', () => {
    const { root } = rig();
    const first = addOutline(root);
    first.dispose();
    const second = addOutline(root);
    expect(second).not.toBe(first);
    expect(second.meshes).toHaveLength(2);
  });
});

describe('addOutline — idempotency', () => {
  it('second call returns the same handle and does not double-add', () => {
    const { root } = rig();
    const first = addOutline(root);
    const second = addOutline(root, { width: 0.5 }); // options ignored on re-call
    expect(second).toBe(first);
    let hullCount = 0;
    root.traverse((o) => { if (o.userData.isOutline) hullCount++; });
    expect(hullCount).toBe(2);
    expect(first.meshes).toHaveLength(2);
  });

  it('subtree call does not double-hull an already hulled mesh', () => {
    const { root, skin } = rig();
    addOutline(root);
    const sub = addOutline(skin); // skin already carries its hull
    expect(sub.meshes).toHaveLength(0);
    expect(skin.children.filter((c) => c.userData.isOutline)).toHaveLength(1);
  });

  it('never outlines an outline (traversal skips isOutline nodes)', () => {
    const { root } = rig();
    addOutline(root);
    let meshCount = 0;
    let hullCount = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshCount++;
      if (o.userData.isOutline) hullCount++;
    });
    expect(meshCount).toBe(4); // 2 sources + 2 hulls, no hull-of-hull
    expect(hullCount).toBe(2);
  });
});
