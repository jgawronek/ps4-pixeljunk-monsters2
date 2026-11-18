# PORTING CONVENTIONS — C# (decomp/src) → TypeScript (pjm2-web/src)

Binding rules for every module port of the PixelJunk Monsters 2 reconstruction.
The C# files under `decomp/src/` are the SOURCE OF TRUTH for behavior; this
document defines how they map to TS so the port stays consistent and
deterministic. Established in loop iterations 1–4; follow exactly.

## 1. Fidelity law
- Port logic 1:1 from the C# reconstruction, which itself is 1:1 from the
  binary (RVA comments preserved as `// @0xXXXXXX` in TS comments).
- Reproduce original QUIRKS faithfully (examples already encoded: viewer-cache
  tag quirk in GameCoreHandle, single-removal-per-tick in TickEXPSources,
  empty DetonateFruitCommand, dead `index` param in
  GetNextTargetFromTowerTargetQueue). Add a `// FAITHFUL QUIRK:` comment.
- Where TS cannot express C# exactly, use the documented adaptation below and
  mark it `// TS ADAPTATION:` with the reason.

## 2. fp32 discipline (NON-NEGOTIABLE)
- Unity computes in IEEE-754 float32. Every sim-visible float operation goes
  through `Math.fround` — inside `engine/math` primitives (Vector3, Quaternion,
  Mathf). Sim code must use engine/math types for anything positional/physical;
  plain JS numbers are allowed ONLY for non-sim-critical values (timers whose
  original was float must still be fround'd at each arithmetic step — wrap with
  `Math.fround(a + b)` etc., or use a `f32` helper when engine/math lands one).
- Struct fields that are floats in C# stay `number` but every WRITE is
  fround'd (see Cylinder.ts pattern).
- Ints: use `| 0` on any value crossing a C# int boundary.

## 3. Type mapping
| C# | TS | Notes |
|---|---|---|
| `struct` (Vector3, GameCoreHandle, Cylinder, CurrencyValueInfo, PlayerAroundInfo) | `class` with value-ish semantics | document copy-vs-reference at usage sites; handles compare by `.equals()`/`.m_handle` |
| `class : GameCoreObject` | `class extends GameCoreObject` | |
| nested type `A.B` | export from A's module (`A_B` naming ONLY if forced; prefer separate file + re-export) | e.g. `GameCoreHome.ChibiData` → `ChibiData` exported from `GameCoreHome.ts` |
| `List<T>` | `T[]` (methods: push/splice) or `Map` where C# used Dictionary | keep List swap-back semantics where C# used RemoveAtSwapBack (Q4.Extensions) |
| `Dictionary<K,V>` | `Map<K,V>` | |
| events `Events.x.AddListener(cb, EventTime)` | same name camelCased: `Events.x.addListener(cb, EventTime, handleId?)` | handleId replaces C# `delegate.Target as GameCoreObject` detection |
| `null` checks + NRE paths | early `return`/throw with `// binary: exception path` comment | never crash headless runs silently |
| `[CoreObjectPool.DeepCopyAttribute]` | `static readonly deepCopyFields = [...]` on the class | dev-only path; normal tick never deep-copies |
| virtual slots | plain methods; keep `// virtual slot N` comments | |

## 4. Naming
- Types/enums/enum members: KEEP C# names exactly (`GameCoreTower`,
  `EEnemyDef.kuri_00_001`, `TowerStateUpgradeAround`, original typos included:
  `TowerAttackComamnd`, `TriggerInterationEvent`, `m_cautionDireciton`,
  `GetProjectileGameCoreHitPoisition`).
- Methods: C# PascalCase → TS camelCase (`Tick()` → `tick()`,
  `GetMostRecentObjectVersion` → `getMostRecentObjectVersion`). EXCEPTION:
  fields keep C# names verbatim including `m_` prefixes (`m_handle`,
  `m_chibisActive`) so offsets/comments stay greppable against decomp/src.
- Files: mirror C# file names (`GameCoreHome.cs` → `GameCoreHome.ts`);
  directories mirror namespaces (`GameCore.Network` → `src/core/commands/`).

## 5. Field-offset & RVA comments
Every ported field keeps its `// 0xNN` offset comment; every ported method
keeps its `// Name @0xRVA` header comment. Rodata constants keep
`// DAT_00bXXXXX = value (CONFIRMED from ELF)` comments. This makes
three-way diffing (binary ↔ C# ↔ TS) mechanical.

## 6. Engine seams (dependency direction)
- `src/core/**` (sim) may import: `src/engine/**`, `src/data/**`. NEVER
  `three`, DOM, or `src/view|ui|audio/**`. Enforced by review; a lint rule
  can be added later.
- View-layer lookups in C# (`GetUnityObject<T>()`, `Q4.*` singletons) go
  through the resolver hooks (`setViewerResolver`) or injected interfaces so
  headless runs return null exactly like the original's `bridge == null` path.
- RNG: all sim randomness via `engine/rng` (UnityEngine.Random clone); never
  `Math.random()`.
- Physics: terrain queries via `engine/physics` (Rapier wrappers with Unity
  query semantics); object-vs-object via the ported GameCoreCollisionManager
  grid (sim-internal, NOT Rapier).

## 7. Tests
- Every ported module gets a `tests/core/<module>.test.ts` covering the
  behaviors its RVA comments describe + the faithful quirks.
- Determinism tests: run twice with same seed/inputs → identical observable
  state (positions, counters) compared with `Object.is` on fround'd values.
- The full-suite gate: `npm run check` (typecheck + vitest) must stay green at
  every loop iteration end.

## 8. Q4 (view) types in sim signatures
Sim code referencing Q4 view types (`Q4.TowerBase`, `Q4.Home`, …) uses
`src/view/q4-contracts.ts` INTERFACES (structural stand-ins listing only the
fields the sim reads, with their `// 0xNN` offsets from dump.cs). The real
Three.js-backed viewers implement these interfaces in Phase 3. Headless tests
provide plain-object fakes.
