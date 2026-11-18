// src/view/stage/GroundPicker.ts
// Pointer → terrain world position. Raycasts the stage's visual terrain chunks
// (StageSceneView.terrainPickMeshes — the 13 `Mesh (xxxx)` slices, parity-checked
// against the physics collider mesh in the extraction report §6, so picked
// positions are consistent with the future Rapier world).
//
// Two coordinate flavors are exposed on purpose:
//   - pick():        three.js RH world space (what the renderer uses)
//   - pickUnity():   the same point mirrored back to Unity LH space (x negated),
//                    matching the coordinate system all sim/data code keeps
//                    (PORTING_CONVENTIONS: never convert sim data — convert here).

import * as THREE from 'three';

export class GroundPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private targets: THREE.Object3D[] = [];

  constructor(targets: THREE.Object3D[] = []) {
    this.setTargets(targets);
  }

  setTargets(targets: THREE.Object3D[]): void {
    this.targets = targets;
  }

  /**
   * @param clientX/clientY pointer event coordinates (px, relative to viewport)
   * @param viewport the canvas' bounding rect
   * @returns first terrain hit in three.js RH world space, or null
   */
  pick(clientX: number, clientY: number, viewport: DOMRect, camera: THREE.Camera): THREE.Vector3 | null {
    this.ndc.set(
      ((clientX - viewport.left) / viewport.width) * 2 - 1,
      -((clientY - viewport.top) / viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, camera);
    const hits = this.raycaster.intersectObjects(this.targets, false);
    return hits.length > 0 ? hits[0].point.clone() : null;
  }

  private readonly downRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 1.25);

  /** Terrain height (three space) under (x, z) by casting straight down from y+1
   *  (max 1.25) — Q4.EnemyBase.StateDead's Physics.Raycast(pos+up, down, 1.25). */
  groundY(x: number, y: number, z: number): number | null {
    this.downRay.ray.origin.set(x, y + 1, z);
    const hits = this.downRay.intersectObjects(this.targets, false);
    return hits.length > 0 ? hits[0].point.y : null;
  }

  /** Same as pick(), mirrored back to Unity LH space (x → −x). */
  pickUnity(clientX: number, clientY: number, viewport: DOMRect, camera: THREE.Camera): THREE.Vector3 | null {
    const p = this.pick(clientX, clientY, viewport, camera);
    if (p) p.x = -p.x;
    return p;
  }
}
