// src/view/characters/PlayerAvatarDecorator.ts
// Port of Q4.PlayerAvatarDecorator (RVAs: SetInternal 0x3EC230,
// FindUsedTransforms 0x3EC4F0, AddBoneHierarchyToMap 0x3EC960,
// UpdateTransforms 0x3EC0C0, LateUpdate 0x3EC0B0).
//
// The tikiman_01 body mesh carries NO face mask and NO shell on its back: the
// original builds them at runtime from cosmetic prefabs (ClothingUnlockData →
// mask_00_pa / carapace_00_pa for the default loadout; "carapace" = the shell).
// Each part is a self-contained skinned prefab with its OWN copy of the tikiman
// skeleton. SetInternal instantiates it under the player's visual root; every
// LateUpdate the decorator copies localPosition/localRotation of each USED
// player bone onto the same-named bone of the part, so the part follows the
// player's animation exactly (no physics / jiggle — the secondary motion comes
// only from the player's own animation clips, e.g. the Carapace_Bn channel).
// See docs/PLAYER_SHELL_ANALYSIS.md.

import * as THREE from 'three';
import type { CharacterRig } from './CharacterLibrary';

/** def names of the default loadout (ClothingUnlockDefinitions.m_defaultItem). */
export const DEFAULT_MASK_DEF = 'mask_00';
export const DEFAULT_CARAPACE_DEF = 'carapace_00';

interface TransformMapping {
  /** player bone (source of the pose) */
  source: THREE.Object3D;
  /** part bone (receives the pose) */
  destination: THREE.Object3D;
}

/** Bones that actually influence vertices of the part's skinned meshes, plus
 *  their ancestors up to (excluding) the skeleton root's parent
 *  (FindUsedTransforms + AddBoneHierarchyToMap). */
export function findUsedBones(partRoot: THREE.Object3D): Set<THREE.Object3D> {
  const used = new Set<THREE.Object3D>();
  partRoot.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton) return;
    const idx = sm.geometry.getAttribute('skinIndex');
    const wgt = sm.geometry.getAttribute('skinWeight');
    if (!idx || !wgt) return;
    const bones = sm.skeleton.bones;
    const hit = new Set<number>();
    for (let v = 0; v < idx.count; v++) {
      if (wgt.getX(v) > 0) hit.add(idx.getX(v));
      if (wgt.getY(v) > 0) hit.add(idx.getY(v));
      if (wgt.getZ(v) > 0) hit.add(idx.getZ(v));
      if (wgt.getW(v) > 0) hit.add(idx.getW(v));
    }
    // Stop at the skeleton root's parent (rootBone.parent in Unity); in the
    // GLB the skin's common ancestor is the first joint's top parent chain.
    const stop = bones.length > 0 ? commonAncestor(bones)?.parent ?? null : null;
    for (const i of hit) {
      let cur: THREE.Object3D | null = bones[i] ?? null;
      while (cur !== null && cur !== stop && !used.has(cur)) {
        used.add(cur);
        cur = cur.parent;
      }
    }
  });
  return used;
}

function commonAncestor(nodes: THREE.Object3D[]): THREE.Object3D | null {
  const chain = (n: THREE.Object3D): THREE.Object3D[] => {
    const c: THREE.Object3D[] = [];
    for (let p: THREE.Object3D | null = n; p !== null; p = p.parent) c.unshift(p);
    return c;
  };
  let common = chain(nodes[0]);
  for (let i = 1; i < nodes.length; i++) {
    const c = chain(nodes[i]);
    let k = 0;
    while (k < common.length && k < c.length && common[k] === c[k]) k++;
    common = common.slice(0, k);
  }
  return common.length > 0 ? common[common.length - 1] : null;
}

export class PlayerAvatarDecorator {
  private readonly playerTransform: THREE.Object3D;
  private readonly bodyByName = new Map<string, THREE.Object3D>();
  private mappings: TransformMapping[] = [];
  private readonly instances: Record<'mask' | 'carapace', THREE.Object3D | null> = {
    mask: null,
    carapace: null,
  };

  /** @param visualRoot the object that owns the "Root" bone (tikiman_01_comp);
   *  falls back to `fallbackRoot`. Parts are parented here (identity). */
  constructor(visualRoot: THREE.Object3D) {
    const comp = visualRoot.getObjectByName('tikiman_01_comp') ?? visualRoot;
    this.playerTransform = comp;
    const root = comp.getObjectByName('Root');
    (root ?? comp).traverse((o) => {
      if (!this.bodyByName.has(o.name)) this.bodyByName.set(o.name, o);
    });
  }

  /** SetMask / SetCarapace → SetInternal. Replaces any previous instance. */
  set(kind: 'mask' | 'carapace', partRig: CharacterRig): THREE.Object3D {
    const prev = this.instances[kind];
    if (prev !== null) prev.removeFromParent();
    const inner = partRig.root;
    inner.name = `${kind}:${partRig.defName}`;
    // LOD stubs are hidden by the library; parent at identity under the player.
    this.playerTransform.add(inner);
    this.instances[kind] = inner;
    this.rebuildMappings();
    this.updateTransforms();
    return inner;
  }

  /** Attached part instance (mask/carapace) or null. */
  get(kind: 'mask' | 'carapace'): THREE.Object3D | null {
    return this.instances[kind];
  }

  /** Count of used-bone mappings (diagnostics/tests). */
  get mappingCount(): number {
    return this.mappings.length;
  }

  private rebuildMappings(): void {
    const maps: TransformMapping[] = [];
    for (const inst of Object.values(this.instances)) {
      if (inst === null) continue;
      for (const bone of findUsedBones(inst)) {
        const src = this.bodyByName.get(bone.name);
        if (src && src !== bone) maps.push({ source: src, destination: bone });
      }
    }
    this.mappings = maps;
  }

  /** UpdateTransforms (LateUpdate): copy local position + rotation. */
  updateTransforms(): void {
    for (const m of this.mappings) {
      m.destination.position.copy(m.source.position);
      m.destination.quaternion.copy(m.source.quaternion);
    }
  }

  dispose(): void {
    for (const k of ['mask', 'carapace'] as const) {
      this.instances[k]?.removeFromParent();
      this.instances[k] = null;
    }
    this.mappings = [];
  }
}
