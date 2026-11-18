// src/core/GameCoreHandle.ts
// TypeScript port of decomp/src/GameCore/GameCoreHandle.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x4AA560..0x4BA260 +
// shared generic bodies FUN_002C61C0 / FUN_002C63D0 / FUN_004B9C80 / FUN_004BA0A0).
//
// Lightweight identity for a sim object. The int `m_handle` is the stable key;
// the handle caches the resolved sim object and its viewer, tagged with the
// static s_cacheTag so caches invalidate when a new frame is installed.
//
// TS ADAPTATIONS (documented divergences, behavior-preserving):
//  1. C# struct → TS class. The original copies handles by value (each copy
//     re-resolves through the same logic, so observable behavior matches);
//     reference semantics here additionally share the cache between "copies",
//     which is harmless because cache validity is tag-gated.
//  2. Frame lookup goes through a resolver hook (setFrameResolver) instead of
//     GameCore.Instance.currentFrame — the frame module registers itself once
//     it lands (removes an import cycle while the port is incremental).
//  3. Viewer lookup (GetUnityObject) goes through setViewerResolver — the view
//     layer (GameCoreBridge port) registers it in the browser; headless runs
//     leave it null, matching the original's bridge==null path.

/** Minimal shape Handle needs from sim objects (GameCoreObject satisfies it). */
export interface SimObjectLike {
  isDestroyed(): boolean;
  readonly typeName: string;
}

export type FrameResolver = (handleId: number) => SimObjectLike | null;
export type ViewerResolver = (handleId: number) => unknown | null;

let frameResolver: FrameResolver | null = null;
let viewerResolver: ViewerResolver | null = null;

/** Registered by the GameCore/GameCoreFrame port. */
export function setFrameResolver(resolver: FrameResolver | null): void {
  frameResolver = resolver;
}

/** Registered by the view-layer bridge port (browser only). */
export function setViewerResolver(resolver: ViewerResolver | null): void {
  viewerResolver = resolver;
}

export class GameCoreHandle {
  private static s_nextHandle = 0; // statics +0x0
  private static s_cacheTag = 100; // statics +0x4 (.cctor @0x4BA260)

  /** Stable identity key (C#: m_handle auto-property, private set). */
  readonly m_handle: number; // 0x0

  private m_cachedViewer: unknown = null; // 0x8
  private m_cachedGameObject: SimObjectLike | null = null; // 0x10
  private m_cacheTag = 0; // 0x18

  // .ctor @0x4B9A70 (private in the original; static factories below)
  private constructor(handle: number) {
    this.m_handle = handle;
  }

  /** Test/dev hook — resets allocation + cache-tag statics. */
  static resetStaticsForTests(): void {
    GameCoreHandle.s_nextHandle = 0;
    GameCoreHandle.s_cacheTag = 100;
  }

  // get_isNull @0x4B9B10 — sign-bit test: any negative id is "null".
  get isNull(): boolean {
    return this.m_handle < 0;
  }

  // get_nullHandle @0x4AD070
  static get nullHandle(): GameCoreHandle {
    return new GameCoreHandle(-1);
  }

  // CreateHandle @0x4B9BA0
  static createHandle(handle = -1): GameCoreHandle {
    if (handle < 0) {
      handle = GameCoreHandle.s_nextHandle;
      GameCoreHandle.s_nextHandle = handle + 1;
    }
    return new GameCoreHandle(handle);
  }

  // ResetNextHandleIndex @0x4AA560
  // Single-player: wrap the counter back by 1,000,000 once it exceeds 100,000
  // (constants confirmed from disassembly: cmp 0x186A1, add 0xFFF0BDC0).
  // NOTE: drives s_nextHandle negative; isNull treats negatives as null — the
  // wrap is a long-session guard, not a normal-path concern.
  // (Online branch out of scope.)
  static resetNextHandleIndex(): void {
    if (GameCoreHandle.s_nextHandle > 100000) GameCoreHandle.s_nextHandle -= 1000000;
  }

  // EnsureNextHandleIsGreaterThan @0x4B9B20 — used on load/resync so restored
  // handles never collide with new ones.
  static ensureNextHandleIsGreaterThan(handle: GameCoreHandle): void {
    GameCoreHandle.s_nextHandle = Math.max(GameCoreHandle.s_nextHandle, handle.m_handle + 1);
  }

  // InvalidateAllCachedData @0x4AB0D0
  static invalidateAllCachedData(): void {
    GameCoreHandle.s_cacheTag++;
  }

  // GetMostRecentObjectVersion<T> @0x2C63C0 (shared body FUN_002C61C0)
  // Resolves against the CURRENT frame, caching + tagging. Returns null when
  // unresolved or destroyed. (C# casts to T and throws on mismatch; TS trusts
  // the generic — call sites mirror the original's casts.)
  getMostRecentObjectVersion<T extends SimObjectLike>(): T | null {
    if (this.m_cachedGameObject === null || this.m_cacheTag !== GameCoreHandle.s_cacheTag) {
      this.m_cachedGameObject = frameResolver ? frameResolver(this.m_handle) : null;
      this.m_cacheTag = GameCoreHandle.s_cacheTag;
    }
    if (this.m_cachedGameObject === null || this.m_cachedGameObject.isDestroyed()) return null;
    return this.m_cachedGameObject as T;
  }

  // GetUnityObject @0x4B9DC0 (shared body FUN_004B9C80)
  // Returns the cached viewer if still valid, else asks the bridge (viewer
  // resolver) to map this handle. Does NOT refresh m_cacheTag — faithful to
  // the original: only the object cache above bumps the tag.
  getUnityObject(): unknown | null {
    if (this.m_cachedViewer != null && this.m_cacheTag === GameCoreHandle.s_cacheTag) {
      return this.m_cachedViewer;
    }
    let result: unknown | null = null;
    if (viewerResolver) result = viewerResolver(this.m_handle);
    this.m_cachedViewer = result;
    return result;
  }

  // op_Equality @0x4B9C70 / op_Inequality @0x4AF210 — compare the int id only.
  equals(other: GameCoreHandle | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    return this.m_handle === other.m_handle;
  }
  notEquals(other: GameCoreHandle | null | undefined): boolean {
    return !this.equals(other);
  }

  // GetHashCode @0x4BA060 — int hash is the value itself.
  hashCode(): number {
    return this.m_handle | 0;
  }

  // ToString @0x4BA250 — format "GameCoreHandle({0}), {1}" (+ " Destroyed").
  toString(): string {
    this.getMostRecentObjectVersion<SimObjectLike>(); // refresh the object cache
    const obj = this.m_cachedGameObject;
    let name: string | null = null;
    if (obj !== null) {
      name = obj.typeName;
      if (obj.isDestroyed()) name = name + ' Destroyed';
    }
    return `GameCoreHandle(${this.m_handle}), ${name}`;
  }
}
