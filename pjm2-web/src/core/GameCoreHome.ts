// src/core/GameCoreHome.ts
// TypeScript port of decomp/src/GameCore/GameCoreHome.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3040,
// RVA 0x4BA2A0..0x4BBC60).
// The home base the monsters attack. Its HP is the pool of chibis ("kid"
// villagers): each successful enemy attack kills one chibi; when the last
// chibi dies the sim raises Events.gameOverEvent (unless the debug menu
// disables it). Also tracks the chibi count at the end of every wave (used by
// the stage-clear ranking).
//
// Float constants CONFIRMED from ELF .rodata (file offset = vaddr + 0x4000):
//   DAT_00b7c374 = 1.75   DAT_00b7c378 = 0.925  DAT_00b7c37c = 0.2
//   DAT_00b7c380 = 4.0    DAT_00b7c384 = 0.5    DAT_00b7c388 = 0.25
//   DAT_00b7c38c = -1.0   DAT_00b7c390 = 0.16   DAT_00b7c394 = 0.4
//   DAT_00b7c398 = 0.5
//
// TS ADAPTATIONS (documented):
//  - C# nested ChibiData → exported class in this module (same file).
//  - Q4.Home viewer → HomeViewContract; FindObjectsOfType<Q4.Home> →
//    getHomeViews() hook; Object.Destroy(viewerGo) → destroyUnityObject() hook.
//  - Physics.Linecast ground snap → getSimPhysics().linecast (Rapier seam).
//  - List.Sort (unstable C# introsort, comparator never returns 0) → JS stable
//    sort with the same comparator: equal distances keep spawn order —
//    deterministic (the C# tie order is implementation-defined).
//  - IsEnemyClose { get; protected set; } → protected backing + public getter.

import { Quaternion, Vector3 } from '../engine/math';
import {
  destroyUnityObject,
  getDebugCanvas,
  getHomeViews,
  type ChibiHomeZoneContract,
  type HomeViewContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreObject } from './GameCoreObject';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import { getSimPhysics, Q4Layers } from './physics-seam';

const f = Math.fround;

/** C#: GameCoreHome.ChibiData (nested, TypeDefIndex 3041). One chibi
 *  (villager) standing guard at the home. Pure data; the Q4.Chibi views are
 *  event-driven off this. .ctor @0x4BB3D0 (inlined into SpawnChibi). */
export class ChibiData {
  isDead = false; // 0x10
  id: number; // 0x14
  pos: Vector3; // 0x18
  rot: Quaternion; // 0x24

  constructor(a_id: number, a_pos: Vector3, a_rot: Quaternion) {
    this.id = a_id | 0;
    this.pos = a_pos;
    this.rot = a_rot;
  }
}

/**
 * PORT ADAPTATION (off by default = faithful, height 0): vertical tolerance of the home's enemy query. With height 0 the grid's
 * strict `(h_obj+h_q)/2 <= |dy + h_obj/2|` filter drops every enemy whose base is at or ABOVE the home's y. The stage platforms
 * around the home are flat planes at y == 0 (home y == 0) with only ~1e-6 terrain-probe noise, so an enemy that latched
 * `m_canAttack` on a tick with y = -1e-6 is dropped on the next tick (y = 0) and parks next to the home forever (hold branch;
 * measured: stage 11 / 14 headless). The original binary's equivalent value could not be re-verified (Ghidra drops the
 * height float arg); the headless smart bot and the live game enable a small tolerance, the legacy stage-1 pin does not.
 */
let homeQueryHeight = 0;
export function setHomeQueryHeight(h: number): void {
  homeQueryHeight = h;
}

export class GameCoreHome extends GameCoreObject {
  protected m_isEnemyClose = false; // 0x60 (public get / protected set)
  protected m_chibiPrefab: unknown = null; // 0x68 (= Q4.Home.kidPrefab @0x50)
  protected m_playerDetectionRange = f(0); // 0x70 (Structure.playerDetectionRange @0x20)
  protected m_enemyDetectionRange = f(0); // 0x74 (Structure.enemyDetectionRange @0x1C)
  protected m_totalStartChibiNum = 0; // 0x78
  // [CoreObjectPool.DeepCopyAttribute]
  protected m_chibisActive: ChibiData[] = []; // 0x80
  protected m_numChibiAtEndOfWave: number[] = []; // 0x88
  protected m_OrientationForward: Vector3 = Vector3.zero; // 0x90

  // ---- constants (all CONFIRMED from ELF .rodata) ----
  private static readonly collisionRadius = f(1.75); // DAT_00b7c374
  private static readonly collisionHeight = f(0.925); // DAT_00b7c378
  private static readonly enemyAttackDistancePad = f(0.2); // DAT_00b7c37c
  private static readonly enemyQueryPadding = f(4.0); // DAT_00b7c380
  private static readonly chibiAngleHalve = f(0.5); // DAT_00b7c384
  private static readonly chibiLinecastUp = f(0.25); // DAT_00b7c388
  private static readonly chibiLinecastDown = f(-1.0); // DAT_00b7c38c
  private static readonly chibiMinSpacing = f(0.16); // DAT_00b7c390
  private static readonly chibiPushRestDist = f(0.4); // DAT_00b7c394
  private static readonly chibiPushScale = f(0.5); // DAT_00b7c398
  private static readonly chibiListCapacity = 100; // literal in CreateChibis @0x4BA500
  private static readonly maxSpreadPasses = 9; // exits when count > 8 @0x4BBB6E

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onEnemyAttackedListener = (
    a_enemy: GameCoreEnemy,
    a_home: GameCoreHome,
    a_chibi: ChibiData,
  ): void => this.onEnemyAttacked(a_enemy, a_home, a_chibi);
  private readonly m_onEndOfWaveListener = (
    manager: GameCoreWaveManager,
    waveIndex: number,
  ): void => this.onEndOfWave(manager, waveIndex);

  // get_IsEnemyClose (backing 0x60; protected set in C#)
  get isEnemyClose(): boolean {
    return this.m_isEnemyClose;
  }

  // get_NumChibi @0x4BA650 — living chibis. Dead chibis are REMOVED from the
  // list by DealDamage, so Count == alive count.
  get numChibi(): number {
    return this.m_chibisActive.length;
  }

  // get_NumStartingChibi @0x4BA6A0
  get numStartingChibi(): number {
    return this.m_totalStartChibiNum;
  }

  // get_EnemyAttackDistance @0x4BA870
  // FAITHFUL QUIRK: derived from the PLAYER detection range (0x70), not the
  // enemy one — verified in the reconstruction.
  get enemyAttackDistance(): number {
    return f(this.m_playerDetectionRange + GameCoreHome.enemyAttackDistancePad);
  }

  // .ctor @0x4BA2A0
  // Created by the Q4.Home view during scene bootstrap
  // (IPlaceableViewObject.CreateGameCoreObject @0x462650). NOTE: the ctor does
  // NOT set position — the bootstrap lands it afterwards; chibis spawn
  // relative to the position at ctor time (faithful).
  constructor(a_viewer: HomeViewContract | null) {
    super();
    this.m_numChibiAtEndOfWave = [];

    if (a_viewer === null) {
      // Binary: null viewer falls into the shared NullReferenceException path.
      console.error('GameCoreHome created without a Q4.Home viewer.');
    }
    const viewer = a_viewer!; // FAITHFUL: member access below NREs on null

    this.m_playerDetectionRange = f(viewer.playerDetectionRange); // Structure @0x20
    this.m_enemyDetectionRange = f(viewer.enemyDetectionRange); // Structure @0x1C
    this.m_chibiPrefab = viewer.kidPrefab; // Home @0x50

    // The landed collision setter re-buckets this object in the grid
    // (matches the explicit UpdateCoreObject call at 0x4BA344).
    this.collision = new Cylinder(GameCoreHome.collisionRadius, GameCoreHome.collisionHeight);

    const fw = viewer.transform.forward;
    this.m_OrientationForward = new Vector3(fw.x, fw.y, fw.z);
    this.m_isEnemyClose = false;

    this.createChibis(viewer);

    Events.enemyAttackedHomeEvent.addListener(
      this.m_onEnemyAttackedListener,
      EventTime.Immediate,
      this.handle.m_handle,
    ); // Events statics +0x48
    Events.waveEndedEvent.addListener(
      this.m_onEndOfWaveListener,
      EventTime.Immediate,
      this.handle.m_handle,
    ); // Events statics +0x18
  }

  // DestroySelf @0x4BA880 (virtual slot 6)
  // The binary guards the base cleanup + unsubscribes by non-null
  // GameCore.Instance / collisionManager.
  override destroySelf(): void {
    const core = GameCore.instance;
    if (core !== null && core.collisionManager !== null) {
      super.destroySelf();
      Events.enemyAttackedHomeEvent.removeListener(
        this.m_onEnemyAttackedListener,
        this.handle.m_handle,
      );
      Events.waveEndedEvent.removeListener(this.m_onEndOfWaveListener, this.handle.m_handle);
    }
  }

  // ---- chibi creation ----

  // CreateChibis @0x4BA500
  private createChibis(a_viewer: HomeViewContract): void {
    this.m_totalStartChibiNum = 0;
    this.m_chibisActive = []; // C#: new List<ChibiData>(100) — capacity only

    const zones = a_viewer.chibiHomeZones; // Home @0x60 (array)
    let nextId = 0;
    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      this.m_totalStartChibiNum += zone.numChibi;
      for (let j = 0; j < zone.numChibi; j++) {
        this.m_chibisActive.push(this.spawnChibi(nextId + j, zone));
      }
      nextId += zone.numChibi;
    }

    this.spreadOutChibi();
  }

  // SpawnChibi @0x4BB410
  // Random polar spot inside the zone's [MinDist, MaxDist] ring and
  // AngleCenter±AngleSpread/2 arc, then snapped down onto terrain.
  private spawnChibi(a_id: number, zone: ChibiHomeZoneContract): ChibiData {
    // RandomRange(-AngleSpread, +AngleSpread) * 0.5 + AngleCenter — a
    // SYMMETRIC arc around the home forward. Verified from the instructions
    // (@0x4bb4a2): xmm1 = AngleSpread; xmm0 = xmm1 ^ [0xb7c560] (sign mask,
    // 0x80000000 in all 4 lanes); call RandomRange(xmm0, xmm1). An earlier
    // reading took Ghidra's packed CONCAT44 upper lane (just more mask) as
    // max = -0.0, which sampled only one half of the arc — that was wrong.
    const angle = f(
      f(
        GameCoreObject.randomRangeF(-zone.angleSpread, zone.angleSpread, this.handle) *
          GameCoreHome.chibiAngleHalve,
      ) + zone.angleCenter,
    );

    const spin = Quaternion.AngleAxis(angle, Vector3.up);
    const dist = GameCoreObject.randomRangeF(zone.minDist, zone.maxDist, this.handle);
    const offset = spin.multiplyVector(this.m_OrientationForward.mulScalar(dist));
    let pos = this.position.add(offset);
    const rot = Quaternion.LookRotation(offset, Vector3.up);

    // Ground snap: cast a short vertical segment and take the hit's y.
    const lineStart = pos.add(Vector3.up.mulScalar(GameCoreHome.chibiLinecastUp)); // +0.25
    const lineEnd = pos.add(Vector3.up.mulScalar(GameCoreHome.chibiLinecastDown)); // -1.0
    const hit = getSimPhysics().linecast(
      lineStart.x,
      lineStart.y,
      lineStart.z,
      lineEnd.x,
      lineEnd.y,
      lineEnd.z,
      Q4Layers.terrainMask,
    );
    if (hit !== null) {
      pos = new Vector3(pos.x, hit.point[1], pos.z); // vblendps mask 2 — y only
    }

    return new ChibiData(a_id, pos, rot);
  }

  // SpreadOutChibi @0x4BB7C0
  // Sorts chibis by distance to the "attack position" (the point on the home's
  // forward axis at m_enemyDetectionRange), then runs up to MaxSpreadPasses
  // relaxation passes pushing overlapping chibis apart.
  private spreadOutChibi(): void {
    const attackPos = this.position.add(
      this.m_OrientationForward.mulScalar(this.m_enemyDetectionRange),
    );

    // <>m__0 @0x4BBC30: Compare(a,b) = dist(b) < dist(a) ? 1 : -1 → ascending
    // by distance to attackPos. TS ADAPTATION: the C# comparator never returns
    // 0 (inconsistent for ties → .NET introsort tie order is implementation-
    // defined, and JS sort with an inconsistent comparator is arbitrary).
    // Deterministic tie-break by id (spawn order) preserves the binary's
    // ordering for distinct distances and pins the undefined tie case.
    this.m_chibisActive.sort((a, b) => {
      const da = a.pos.sub(attackPos).magnitude;
      const db = b.pos.sub(attackPos).magnitude;
      if (db < da) return 1;
      if (db > da) return -1;
      return a.id - b.id;
    });

    let pass = 0;
    let moved: boolean;
    do {
      moved = false;
      for (let i = 0; i < this.m_chibisActive.length; i++) {
        let cur = this.m_chibisActive[i].pos;
        for (let j = i + 1; j < this.m_chibisActive.length; j++) {
          const other = this.m_chibisActive[j].pos;
          const delta = other.sub(cur);
          const d = delta.magnitude;
          if (d < GameCoreHome.chibiMinSpacing) {
            // 0.16; FAITHFUL: zero delta → zero push (perfect overlaps never
            // separate) but moved=true still forces the full pass budget.
            const push = delta.normalized.mulScalar(
              f(f(GameCoreHome.chibiPushRestDist - d) * GameCoreHome.chibiPushScale),
            ); // (0.4 - d) * 0.5
            cur = cur.sub(push);
            this.m_chibisActive[j].pos = other.add(push);
            moved = true;
          }
        }
        this.m_chibisActive[i].pos = cur;
      }
      if (!moved) return;
      pass++;
    } while (pass <= GameCoreHome.maxSpreadPasses - 1); // binary: exits when 8 < pass
  }

  // ---- queries ----

  // NumChibiAtEndOfWave @0x4BA6B0
  numChibiAtEndOfWave(waveIndex: number): number {
    if (waveIndex < 0) return 0;
    if (this.m_numChibiAtEndOfWave.length <= waveIndex) return 0;
    return this.m_numChibiAtEndOfWave[waveIndex];
  }

  // GetChibiDataByIndex @0x4BA740
  getChibiDataByIndex(a_chibiIndex: number): ChibiData {
    return this.m_chibisActive[a_chibiIndex];
  }

  // GetChibiDataById @0x4BA7A0 — null when no chibi carries that id.
  getChibiDataById(a_chibiId: number): ChibiData | null {
    for (let i = 0; i < this.m_chibisActive.length; i++) {
      const chibi = this.m_chibisActive[i];
      if (chibi !== null && chibi.id === a_chibiId) return this.m_chibisActive[i];
    }
    return null;
  }

  // ---- tick ----

  // Tick @0x4BA9D0 (virtual slot 7)
  override tick(): void {
    this.m_isEnemyClose = false;

    // Broad-phase query around the home. VERIFIED (raw Home.Tick @0x4BA9D0):
    // cylinder height 0. NOTE (raw grid MoveNext @0x770030): the height filter
    // `(h_obj + h_query)*0.5 <= |Δy + h_obj*0.5|` SKIPS same-y-or-higher
    // objects for a height-0 query — only objects strictly BELOW the home's
    // position y are returned (the scene's home sits elevated; attackers
    // approach from below). Faithful — do not "fix" the query height.
    const query = new Cylinder(
      f(this.m_enemyDetectionRange + GameCoreHome.enemyQueryPadding),
      f(homeQueryHeight),
    );
    for (const enemy of GameCore.instance!.allObjectsIn<GameCoreEnemy>(
      GameCoreEnemy,
      this.position,
      query,
    )) {
      const delta = enemy.position.sub(this.position);
      const reach = f(this.m_enemyDetectionRange + enemy.collision.radius);
      // VERIFIED against raw disasm: reach² <= dist² → IsEnemyClose (enemy at
      // or beyond the attack ring); strictly INSIDE the ring → attack branch.
      if (f(reach * reach) <= delta.sqrMagnitude) {
        this.m_isEnemyClose = true;
      } else if (enemy.canAttack) {
        if (this.m_chibisActive.length < 1) {
          // Home already empty (game over pending): non-boss attackers are
          // removed, viewer destroyed (RecreateViewer then DestroySelf).
          if (!enemy.isBoss) {
            const viewerGo = enemy.recreateViewer();
            enemy.destroySelf();
            destroyUnityObject(viewerGo); // C#: Object.Destroy(viewerGo)
          }
        } else {
          // First living chibi is the target.
          let idx = 0;
          while (idx < this.m_chibisActive.length && this.m_chibisActive[idx].isDead) idx++;
          if (idx < this.m_chibisActive.length) {
            const chibi = this.m_chibisActive[idx];
            // Attack @0x4B4A20 raises enemyAttackedHomeEvent → OnEnemyAttacked
            // → DealDamage on success.
            if (enemy.attack(this, chibi)) {
              chibi.isDead = true;
            }
          }
        }
      }
    }
  }

  // RecreateViewer @0x4BAF40 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let viewer = this.getUnityObjectAs<HomeViewContract>();
    if (viewer === null) {
      const found = getHomeViews(); // Object.FindObjectsOfType<Q4.Home>
      if (found.length > 0) viewer = found[0];
    }
    if (viewer !== null) {
      viewer.transform.position = this.position;
      return viewer.gameObject;
    }
    return null; // binary: exception path; kept non-throwing
  }

  // ---- damage / events ----

  // DealDamage @0x4BB040
  // Kills the matching chibi: every chibi behind it in the (attack-pos sorted)
  // list shifts one formation slot forward, the victim is flagged isDead and
  // removed. When the pool empties, raises gameOverEvent unless suppressed.
  dealDamage(a_chibi: ChibiData | null): void {
    if (a_chibi === null) return;

    let index = 0;
    while (index < this.m_chibisActive.length && this.m_chibisActive[index].id !== a_chibi.id) {
      index++;
    }

    // Shift poses forward from the tail down to the victim (descending copy
    // loop at 0x4BB200..0x4BB248). FAITHFUL: an unknown id walks index past
    // the end and the unguarded indexer throws (C# ArgumentOutOfRangeException).
    let last = this.m_chibisActive.length - 1;
    while (last > index) {
      this.m_chibisActive[last].pos = this.m_chibisActive[last - 1].pos;
      this.m_chibisActive[last].rot = this.m_chibisActive[last - 1].rot;
      last--;
    }

    const victim = this.m_chibisActive[index];
    victim.isDead = true; // undefined → TypeError when id not found (faithful)
    this.m_chibisActive.splice(index, 1); // RemoveAt(index)

    if (this.m_chibisActive.length === 0) {
      // Q4.UI.Debug.DebugMenuCanvas.canvasInstance.disableGameOver (@0x1A)
      // suppresses the loss in debug builds.
      const debug = getDebugCanvas();
      if (debug === null || !debug.disableGameOver) {
        Events.gameOverEvent.invoke(); // Events statics +0x38
      }
    }
  }

  // OnEnemyAttacked @0x4BB370 — enemyAttackedHomeEvent listener.
  onEnemyAttacked(_a_enemy: GameCoreEnemy, _a_home: GameCoreHome, a_chibi: ChibiData): void {
    this.dealDamage(a_chibi);
  }

  // OnEndOfWave @0x4BB380 — waveEndedEvent listener. Args unused in the binary.
  onEndOfWave(_manager: GameCoreWaveManager, _waveIndex: number): void {
    this.m_numChibiAtEndOfWave.push(this.m_chibisActive.length);
  }
}
