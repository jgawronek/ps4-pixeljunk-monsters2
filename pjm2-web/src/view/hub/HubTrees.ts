// src/view/hub/HubTrees.ts
// The hub's nature trees (flower trees, bushes ...): every `tree_00N` node of 3d_stage_000 carries a PrefabLoader whose random list
// (tree_00N_{1..4}_pa) is instantiated at Awake at the node's transform (Q4.PrefabLoader.Awake; docs/HUB_AND_TITLE_ANALYSIS.md 2.8). The
// scene export skips them (no renderer on the node) so the hub was bare. Variant = deterministic hash of the node index (the port forbids
// Math.random). Static (the SolidTree wind sway is not applied here).

import * as THREE from 'three';
import { HUB_TREES } from '../../data/hubTrees.generated';
import { stableVariant, type TreeViewAssets } from '../stage/TreeView';

export function buildHubTrees(assets: TreeViewAssets): THREE.Group {
  const root = new THREE.Group();
  root.name = 'hub-trees';
  const q = new THREE.Quaternion();
  for (const t of HUB_TREES) {
    const list = t.species === 'tree_001' ? assets.variants : t.species === 'tree_002' ? (assets.variants002 ?? []) : (assets.hub?.[t.species] ?? []);
    if (list.length === 0) continue;
    const tpl = list[stableVariant(t.i, list.length)];
    const o = tpl.clone(true);
    // Unity LH -> three RH (x mirrored): position (-x, y, z); rotation (x,y,z,w) -> (x,-y,-z,w) for a mirror across YZ.
    q.set(t.rot[0], -t.rot[1], -t.rot[2], t.rot[3]);
    o.position.set(-t.pos[0], t.pos[1], t.pos[2]);
    o.quaternion.copy(q);
    o.scale.setScalar(t.scale);
    root.add(o);
  }
  return root;
}
