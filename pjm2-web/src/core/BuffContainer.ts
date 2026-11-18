// src/core/BuffContainer.ts
// TypeScript port of decomp/src/GameCore/BuffContainer.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x93D8D0..0x93DF60 +
// shared generic bodies RemoveBuffs<T> @0x33F390, Contains<T> @0x354580).
// Stores buffs as GameCoreHandles (buffs are pooled GameCoreObjects).
// Owned by GameCoreEnemy/GameCorePlayer via IBuffs; ticked from their tick().
//
// TS ADAPTATION: C# generic Contains<T>/RemoveBuffs<T> take the type
// implicitly via typeof(T); TS callers pass the constructor explicitly.
// RemoveBuffs matches EXACT type (buff.constructor === ctor), faithful to the
// binary's GetType() == typeof(T) comparison (not instanceof).

import { Buff } from './Buff';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';

export class BuffContainer {
  private m_buffs: GameCoreHandle[]; // 0x10

  // .ctor @0x93D8D0
  constructor() {
    this.m_buffs = [];
  }

  // Initialize @0x93D930 — confirmed empty body.
  initialize(): void {}

  // Terminate @0x93D940 — exit every buff on the target, then clear.
  terminate(target: GameCoreObject): void {
    if (this.m_buffs !== null) {
      for (const handle of this.m_buffs) {
        const buff = handle.getMostRecentObjectVersion<Buff>();
        if (buff !== null) buff.onExitBuff(target);
      }
      this.m_buffs.length = 0;
    }
  }

  // RemoveAllbuffs @0x93D950 [sic — original casing] — identical body to
  // Terminate (confirmed: both iterate + OnExitBuff + Clear).
  removeAllbuffs(target: GameCoreObject): void {
    this.terminate(target);
  }

  // AddBuff @0x93DB20
  addBuff(buff: Buff, target: GameCoreObject): void {
    // Binary null-checks buff and m_buffs (NullReferenceException).
    buff.onEnterBuff(target); // virtual slot 9
    this.m_buffs.push(buff.handle);
  }

  // GetAllBuffs @0x93DBE0
  // Resolves every handle; null entries (buffs already gone) are KEPT in the
  // result — faithful to the binary.
  getAllBuffs(): Array<Buff | null> {
    const result: Array<Buff | null> = [];
    for (const handle of this.m_buffs) {
      result.push(handle.getMostRecentObjectVersion<Buff>());
    }
    return result;
  }

  // Contains<T> @0x354580 (instantiated for BuffFastPlayer)
  contains<T extends Buff>(typeCtor: new (...args: never[]) => T): boolean {
    for (const buff of this.getAllBuffs()) {
      if (buff instanceof typeCtor) return true;
    }
    return false;
  }

  // RemoveBuffs<T> @0x33F390 (instantiated for BuffSlow/BuffFreeze)
  // Removes all buffs of EXACTLY type T, calling onExitBuff on each, except
  // the given exception buff (binary dereferences exception.handle without a
  // null check — callers always pass 'this' buff).
  removeBuffs<T extends Buff>(
    target: GameCoreObject,
    exception: Buff,
    typeCtor: new (...args: never[]) => T,
  ): void {
    let i = 0;
    while (i < this.m_buffs.length) {
      if (this.m_buffs[i].equals(exception.handle)) {
        i++;
        continue;
      }
      const buff = this.m_buffs[i].getMostRecentObjectVersion<Buff>();
      if (buff !== null && buff.constructor === typeCtor) {
        buff.onExitBuff(target); // virtual slot 11
        this.m_buffs.splice(i, 1); // do not advance: list shifted
      } else {
        i++;
      }
    }
  }

  // Tick @0x93DD90
  //  - unresolved handle → drop it
  //  - expired (m_timeRemain < 0) → OnExitBuff + drop
  //  - otherwise → ExecuteBuff, then count down m_timeRemain by dt
  // FAITHFUL QUIRK: the index is incremented BEFORE ExecuteBuff — ExecuteBuff
  // may remove other buffs from this list (RemoveBuffs), and the original
  // relies on this exact traversal.
  tick(target: GameCoreObject): void {
    const dt = GameCore.tickDeltaTime;
    if (this.m_buffs === null || this.m_buffs.length < 1) return;
    let i = 0;
    while (i < this.m_buffs.length) {
      const buff = this.m_buffs[i].getMostRecentObjectVersion<Buff>();
      if (buff === null) {
        this.m_buffs.splice(i, 1);
        continue;
      }
      if (buff.m_timeRemain < 0.0) {
        buff.onExitBuff(target);
        this.m_buffs.splice(i, 1);
        continue;
      }
      i++;
      buff.executeBuff(target);
      buff.m_timeRemain -= dt;
    }
  }
}
