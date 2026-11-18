// src/core/typechain.ts
// TS ADAPTATION helper: C# walks `for (Type t = obj.GetType(); t != typeof(X);
// t = t.BaseType)`; JS walks the constructor prototype chain. Also provides the
// typeof(T) lookups that TS generics cannot express (callers pass ctors).

import { GameCoreObject } from './GameCoreObject';

export type Ctor<T = GameCoreObject> = new (...args: never[]) => T;

/** The object's class and every ancestor up to (NOT including) GameCoreObject —
 *  mirrors the C# type-map indexing loop. */
export function hierarchyTypes(obj: object): Function[] {
  const out: Function[] = [];
  let t: Function | null = obj.constructor;
  while (t !== null && t !== GameCoreObject && t !== Object && t !== Function.prototype) {
    out.push(t);
    t = Object.getPrototypeOf(t) as Function | null;
  }
  return out;
}

/** Walks from `ctor` up through its ancestors (inclusive), stopping before
 *  GameCoreObject — used for instanceof-style typed query matching. */
export function includesType(ctor: Function, target: Function): boolean {
  let t: Function | null = ctor;
  while (t !== null && t !== Object && t !== Function.prototype) {
    if (t === target) return true;
    t = Object.getPrototypeOf(t) as Function | null;
  }
  return false;
}
