// src/core/GameCoreFrame.ts
// TypeScript port of decomp/src/GameCore/GameCoreFrame.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2981,
// RVA 0x4AA720..0x4B59E0 + shared generic GetObject/FirstObject/AllObjects).
//
// KEY FINDING carried over: createFrameCopyForUpdate does NOT copy — it mutates
// this frame in place (frame time, previousTickPosition snapshots, swap-back
// purge of destroyed objects) and returns `this`. The normal SP tick never
// deep-copies; the deep-copy machinery serves Clone()/resync only.
//
// TS ADAPTATION: C# generic queries use typeof(T); TS callers pass the
// constructor explicitly (allObjects(GameCoreEnemy) etc.).

import { CoreObjectPool } from './CoreObjectPool';
import { removeAtSwapBack, removeSwapBack } from './extensions';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { hierarchyTypes } from './typechain';

const f = Math.fround;

export class GameCoreFrame {
  private m_handleMap = new Map<number, GameCoreObject>(); // 0x10 (keyed by handle id)
  private m_gameObjects: GameCoreObject[] = []; // 0x18 (tick order = list order)
  private m_typeMap = new Map<Function, GameCoreObject[]>(); // 0x20
  m_frameTime = 0; // 0x28

  // .ctor @0x4B5590
  constructor() {
    this.m_handleMap = new Map();
    this.m_gameObjects = [];
    this.m_typeMap = new Map();
  }

  // AllocateFrame @0x4AA720 — frames themselves are pooled.
  static allocateFrame(frameTime: number): GameCoreFrame {
    const frame = CoreObjectPool.allocate(GameCoreFrame as unknown as new () => GameCoreFrame);
    frame.m_frameTime = f(frameTime);
    return frame;
  }

  // ReturnObjectsToPool @0x4B5640
  returnObjectsToPool(): void {
    for (const obj of this.m_gameObjects) CoreObjectPool.returnObject(obj);
    this.m_handleMap.clear();
    this.m_gameObjects = [];
    this.m_typeMap.clear();
  }

  // CreateFrameCopyForUpdate @0x4AA930 — in-place pre-tick pass; returns this.
  createFrameCopyForUpdate(newFrameTime: number): GameCoreFrame {
    this.m_frameTime = f(newFrameTime);
    for (let i = 0; i < this.m_gameObjects.length; i++) {
      const obj = this.m_gameObjects[i];
      if (!obj.isDestroyed()) {
        obj.pretickUpdatePreviousTickPosition();
      } else {
        // Q4.Extensions swap-back removal from the object list AND every
        // per-Type index list; re-process the element swapped into slot i.
        removeAtSwapBack(this.m_gameObjects, i);
        for (const t of hierarchyTypes(obj)) {
          const list = this.m_typeMap.get(t);
          if (list !== undefined) removeSwapBack(list, obj);
        }
        i--;
      }
    }
    return this;
  }

  // TickAllObjects @0x4AAC90
  // Count captured up front: objects added during the tick wait until next
  // frame. desyncTesting is unused in the shipped body (faithful).
  tickAllObjects(_desyncTesting: boolean): void {
    const count = this.m_gameObjects.length;
    for (let i = 0; i < count; i++) {
      this.m_gameObjects[i].tick(); // virtual slot 7
    }
  }

  // AddObject @0x4B5770
  addObject(coreObject: GameCoreObject): void {
    this.m_gameObjects.push(coreObject);
    this.addToCacheMaps(coreObject);
  }

  // AddToCacheMaps @0x4B57D0 — index by handle and under every Type in the
  // hierarchy down to (NOT including) GameCoreObject itself.
  private addToCacheMaps(coreObject: GameCoreObject): void {
    this.m_handleMap.set(coreObject.handle.m_handle, coreObject);
    for (const t of hierarchyTypes(coreObject)) {
      let list = this.m_typeMap.get(t);
      if (list === undefined) {
        list = [];
        this.m_typeMap.set(t, list);
      }
      list.push(coreObject);
    }
  }

  // RebuildCacheMaps @0x4B59E0 (OnDeserialized @0x4B59D0 hook)
  rebuildCacheMaps(): void {
    this.m_handleMap = new Map();
    this.m_typeMap = new Map();
    for (const obj of this.m_gameObjects) this.addToCacheMaps(obj);
  }

  /** Handle-resolver support for GameCoreHandle.setFrameResolver. */
  getObjectById(handleId: number): GameCoreObject | null {
    const obj = this.m_handleMap.get(handleId);
    return obj !== undefined ? obj : null;
  }

  // GetObject<T> @0x2C6050 — null when missing or destroyed.
  getObject<T extends GameCoreObject>(handle: GameCoreHandle): T | null {
    const obj = this.m_handleMap.get(handle.m_handle);
    if (obj === undefined) return null;
    if (obj.isDestroyed()) return null;
    return obj as T;
  }

  // FirstObject<T> @0x2C5E00
  firstObject<T extends GameCoreObject>(type: Function): T | null {
    if (type === GameCoreObject) {
      if (this.m_gameObjects.length < 1) return null;
      return this.m_gameObjects[0] as T;
    }
    const list = this.m_typeMap.get(type);
    if (list !== undefined && list.length > 0) return list[0] as T;
    return null;
  }

  // AllObjects<T> @0x770760 — live (non-destroyed) objects of type T; the
  // GameCoreObject "type" special-cases to the full list.
  *allObjects<T extends GameCoreObject>(type: Function): IterableIterator<T> {
    let list: GameCoreObject[] | undefined;
    if (type === GameCoreObject) list = this.m_gameObjects;
    else list = this.m_typeMap.get(type);
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (obj.isDestroyed()) continue;
      yield obj as T;
    }
  }

  /** Test/debug helper — live object count. */
  get objectCount(): number {
    return this.m_gameObjects.length;
  }
}
