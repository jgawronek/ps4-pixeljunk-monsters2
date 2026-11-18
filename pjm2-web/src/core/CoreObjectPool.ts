// src/core/CoreObjectPool.ts
// TypeScript port of decomp/src/GameCore/CoreObjectPool.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x93F060..0x942180).
//
// Static per-constructor object pools. Pooling is BEHAVIORALLY significant (not
// just GC hygiene): recycled instances keep object identity, which the original
// relies on for caches and reference comparisons.
//
// Deep copy: the C# original builds cloners with Reflection.Emit — which cannot
// run under IL2CPP on the console AND cannot run on the web. The lifecycle
// reconstruction confirmed the normal single-player tick NEVER deep-copies
// (CreateFrameCopyForUpdate mutates in place); deep copy is a dev/resync-only
// path. This port provides a structural deepCopy driven by per-class
// `deepCopyFields` registries (the TS stand-in for [CoreObjectPool.DeepCopyAttribute]),
// with the same semantics: listed fields are copied recursively (lists/dicts
// element-wise), everything else is shallow-assigned.

type Constructor = new (...args: never[]) => object;

/** Classes that participate in deep copy declare their
 *  [DeepCopyAttribute] fields via this static shape. */
export interface DeepCopyable {
  constructor: Constructor & { deepCopyFields?: readonly string[] };
}

class TypePool {
  readonly pool: unknown[] = [];
}

export class CoreObjectPool {
  private static instance: CoreObjectPool | null = null;
  private objectPools = new Map<Constructor, TypePool>();

  constructor() {
    this.objectPools = new Map();
  }

  private static get inst(): CoreObjectPool {
    // .cctor @0x93F060: instance = new CoreObjectPool()
    if (CoreObjectPool.instance === null) CoreObjectPool.instance = new CoreObjectPool();
    return CoreObjectPool.instance;
  }

  /** Test/dev hook — the original had no teardown; pools are process-static. */
  static resetInstanceForTests(): void {
    CoreObjectPool.instance = new CoreObjectPool();
  }

  // GetPool @0x93F0B0
  private getPool(objectType: Constructor): unknown[] {
    let typePool = this.objectPools.get(objectType);
    if (typePool === undefined) {
      typePool = new TypePool();
      this.objectPools.set(objectType, typePool);
    }
    return typePool.pool;
  }

  // Allocate(Type, bool) @0x93F140
  // doNotCallConstructorIfNew mirrors FormatterServices.GetUninitializedObject:
  // Object.create(proto) yields an instance with NO fields initialized.
  static allocateByType(objectType: Constructor, doNotCallConstructorIfNew = false): object {
    const pool = CoreObjectPool.inst.getPool(objectType);
    if (pool.length > 0) return pool.shift() as object;
    if (!doNotCallConstructorIfNew) return new objectType();
    return Object.create(objectType.prototype) as object;
  }

  // Allocate<T> @0x93F230
  static allocate<T extends object>(ctor: new (...args: never[]) => T): T {
    return CoreObjectPool.allocateByType(ctor as Constructor) as T;
  }

  // ReturnObject @0x93F270-ish (enqueue by runtime type)
  static returnObject(poolObject: object | null | undefined): void {
    if (poolObject == null) return;
    const ctor = (poolObject as object).constructor as Constructor;
    CoreObjectPool.inst.getPool(ctor).push(poolObject);
  }

  // AllocateDeepCopy @0x941EB0
  static allocateDeepCopy<T extends object>(sourceObject: T | null): T | null {
    if (sourceObject == null) return null;
    const ctor = (sourceObject as object).constructor as Constructor;
    const destination = CoreObjectPool.allocateByType(ctor) as T;
    CoreObjectPool.deepCopyInto(sourceObject, destination);
    return destination;
  }

  // DeepCopy @0x93FDE0 (+ DeepCopyList @0x93F270 / DeepCopyDictionary @0x941050
  // folded in). Fields listed in the class's static deepCopyFields are copied
  // recursively; all other fields are shallow-assigned — identical semantics to
  // the [DeepCopyAttribute] walk in the C# original.
  static deepCopyInto<T extends object>(source: T, destination: T): T {
    const deepFields = (source as DeepCopyable).constructor.deepCopyFields ?? [];
    for (const key of Object.keys(source)) {
      const value = (source as unknown as Record<string, unknown>)[key];
      if (deepFields.includes(key)) {
        (destination as unknown as Record<string, unknown>)[key] =
          CoreObjectPool.deepCopyValue(value);
      } else {
        (destination as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return destination;
  }

  private static deepCopyValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      // DeepCopyList: element-wise copy; class elements go through the pool.
      return value.map((el) => CoreObjectPool.deepCopyValue(el));
    }
    if (value instanceof Map) {
      // DeepCopyDictionary: keys are shared, values deep-copied.
      const out = new Map<unknown, unknown>();
      for (const [k, v] of value) out.set(k, CoreObjectPool.deepCopyValue(v));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set<unknown>();
      for (const v of value) out.add(CoreObjectPool.deepCopyValue(v));
      return out;
    }
    if (typeof value === 'object') {
      const ctor = (value as object).constructor as Constructor;
      if (ctor === Object) {
        // plain object literal: structural copy
        return { ...(value as Record<string, unknown>) };
      }
      // Pooled class instance (e.g. StateMachine state slots, ChibiData...).
      return CoreObjectPool.allocateDeepCopy(value as object);
    }
    return value; // primitives by value
  }
}
