// src/core/GameCoreObject.ts
// TypeScript port of decomp/src/GameCore/GameCoreObject.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2990,
// RVA 0x4AB7F0..0x4BEF30; virtual slots: RecreateViewer=5, DestroySelf=6,
// Tick=7, Clone=8).
// Base class of every simulated entity. Owns a stable GameCoreHandle, a
// position (+ previous-tick position for render interpolation), a Cylinder
// collision volume and a destroyed flag.

import { Vector3 } from '../engine/math/Vector3';
import { unityRandom } from '../engine/rng/UnityRandom';
import { CoreObjectPool } from './CoreObjectPool';
import { Cylinder } from './Cylinder';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';

const f = Math.fround;

/** Hook for the view layer: resolves a prefab name to an instantiated viewer.
 *  Replaces C# CreateViewerFromPrefabName<T> (Resources.FindObjectsOfTypeAll +
 *  Object.Instantiate — Unity-only). Headless: stays null → returns null,
 *  matching the original's "prefab not found" path. */
export type PrefabResolver = (name: string) => unknown | null;
let prefabResolver: PrefabResolver | null = null;
export function setPrefabResolver(r: PrefabResolver | null): void {
  prefabResolver = r;
}

export class GameCoreObject {
  private m_typeName: string | null = null; // 0x10
  protected destroyed = false; // 0x18 (C# field; subclasses write it directly, e.g. WaveManager.OnGameOver)
  private m_position: Vector3 = Vector3.zero; // 0x1C
  private m_previousTickPosition: Vector3 = Vector3.zero; // 0x28
  private m_collision: Cylinder = new Cylinder(0, 0); // 0x34
  handle: GameCoreHandle = GameCoreHandle.nullHandle; // 0x40 (32-byte struct)

  // .ctor @0x4AB7F0
  // Registers with the live frame + collision grid. With no GameCore instance
  // (e.g. deserialization) the object stays unregistered and handle-less.
  constructor() {
    const core = GameCore.instance;
    if (core === null) return;

    this.handle = GameCoreHandle.createHandle();
    this.collision = new Cylinder(0.5, 0.5); // default volume (literal 0x00B7C250 = 0.5)
    this.position = Vector3.zero;
    core.currentFrame.addObject(this);
  }

  // get_typeName @0x4BA200 (C#: GetType().Name, lazily cached)
  get typeName(): string {
    if (this.m_typeName === null) {
      this.m_typeName = (this.constructor as { name: string }).name;
    }
    return this.m_typeName;
  }

  // get_collision @0x4AC4B0 / set_collision @0x4AE350
  get collision(): Cylinder {
    return this.m_collision;
  }
  set collision(value: Cylinder) {
    this.m_collision = value;
    if (!this.destroyed) {
      const core = GameCore.instance;
      if (core === null) throw new Error('GameCoreObject.collision set with no GameCore instance');
      core.collisionManager.updateCoreObject(this);
    }
  }

  // get_position @0x4ABA80 / set_position @0x4ABA30
  // Moving an object re-buckets it in the collision grid.
  get position(): Vector3 {
    return this.m_position;
  }
  set position(value: Vector3) {
    this.m_position = value;
    if (!this.destroyed) {
      const core = GameCore.instance;
      if (core === null) throw new Error('GameCoreObject.position set with no GameCore instance');
      core.collisionManager.updateCoreObject(this);
    }
  }

  // get_previousTickPosition @0x4B91E0
  get previousTickPosition(): Vector3 {
    return this.m_previousTickPosition;
  }

  // get_gameCore @0x4BEBE0
  get gameCore(): GameCore | null {
    return GameCore.instance;
  }

  // IsDestroyed @0x4AC4A0
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Internal: the frame purge reads the flag without side effects. */
  get destroyedFlag(): boolean {
    return this.destroyed;
  }

  // DestroySelf @0x4AF6C0 (virtual slot 6)
  // Marks destroyed and de-grids; the object stays in the frame's lists until
  // the next createFrameCopyForUpdate sweep.
  destroySelf(): void {
    this.destroyed = true;
    GameCore.instance!.collisionManager.removeCoreObject(this);
  }

  // Tick @0x4ABAA0 (virtual slot 7) — base is a no-op.
  tick(): void {}

  // PretickUpdatePreviousTickPosition @0x4B5760
  pretickUpdatePreviousTickPosition(): void {
    this.m_previousTickPosition = this.m_position;
  }

  // RecreateViewer @0x4BEBF0 (virtual slot 5) — base returns null.
  recreateViewer(): unknown | null {
    return null;
  }

  // CreateViewerFromPrefabName<T> — TS ADAPTATION: the Unity search/instantiate
  // path is replaced by the registered prefab resolver (view layer); headless
  // returns null.
  protected static createViewerFromPrefabName(name: string): unknown | null {
    return prefabResolver ? prefabResolver(name) : null;
  }

  // GetUnityObject @0x4AF040
  getUnityObject(): unknown | null {
    return this.handle.getUnityObject();
  }

  // GetUnityObject<T> — TS: structural cast by the caller.
  getUnityObjectAs<T>(): T | null {
    return this.handle.getUnityObject() as T | null;
  }

  // RandomRange @0x4B2A10 (float) — SP is plain UnityEngine.Random.Range; the
  // handle only keys an (out-of-scope) online NetworkLog entry.
  static randomRangeF(min: number, max: number, _handle?: GameCoreHandle): number {
    return unityRandom.Range(min, max);
  }

  // RandomRange @0x4BEC00 (int)
  static randomRangeI(min: number, max: number, _handle?: GameCoreHandle): number {
    return unityRandom.RangeInt(min, max);
  }

  // Clone @0x4BECD0 (virtual slot 8)
  clone(): GameCoreObject | null {
    return CoreObjectPool.allocateDeepCopy(this) as GameCoreObject | null;
  }

  // ToString @0x4BED70 (slot 3) — literals " (" and ")" confirmed.
  toString(): string {
    return `${this.typeName} (${this.handle.m_handle})`;
  }

  // Equals @0x4BEF30 (slot 4) — compares handle ids (NREs on null, faithful).
  equals(other: GameCoreObject): boolean {
    return this.handle.m_handle === other.handle.m_handle;
  }
}

/** fp32 helper re-export for sim modules (fround discipline). */
export { f as fround };
