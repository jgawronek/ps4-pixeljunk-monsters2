// src/data/treeTowerDirection.ts
// Serialized Q4.NatureTree.towerDirection (+0x74) per tree species — the
// direction a tower built on that tree faces (TowerHelper.FromTreeToTower seeds
// tower.bodyDirection / fortDirection from it; TowerBase.Start then sets
// transform.rotation = LookRotation(bodyDirection)).
//
// Source: public/assets/trees/manifest.json species.<s>.natureTree.towerDirection
// (extract_trees.py, nature bundle NatureTree MonoBehaviours). tree_002's
// serialized value really is (0,0,0) — see the manifest's towerDirectionNote.

export type TreeSpeciesName = 'tree_001' | 'tree_002';

export const TREE_TOWER_DIRECTION: Record<TreeSpeciesName, { x: number; y: number; z: number }> = {
  tree_001: { x: -0.41066065430641174, y: 0.0, z: -0.911788284778595 },
  tree_002: { x: 0.0, y: 0.0, z: 0.0 },
};
