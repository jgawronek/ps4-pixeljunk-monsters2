# RECONSTRUCTION GUIDE — turning decompiled IL2CPP into clean C#

Goal: reconstruct readable, faithful C# source for PixelJunk Monsters 2 (PS4,
Unity 5.6.5p1, IL2CPP) from the user's own legally-owned copy. Output is SOURCE
ONLY. Single-player only. Never copy game art/sound/levels into the output. Use
only the recovered files below (no third-party decompilations/source ports).

## Source materials (per class)
- `decomp/decompiled/<Namespace.Class>.c` — Ghidra C pseudocode of each method,
  with `// Function: <Name> @ <addr>` headers. THIS IS THE LOGIC SOURCE.
- `decomp/skeleton/<Namespace>.cs` — recovered C# skeleton: class/field/method
  declarations, FIELD OFFSETS (`// 0xNN`), method signatures, virtual `Slot:`
  numbers, RVA addresses. THIS GIVES NAMES + TYPES + OFFSETS.
- `decomp/il2cpp_user/dump.cs` — full dump (grep for a class if needed).
- `decomp/il2cpp_user/names.tsv` — addr→name for resolving unnamed FUN_xxx.
- `decomp/il2cpp_user/stringliteral.json` — string literal values.
- `MAP.md`, `decomp/GameCore_BLUEPRINT.md` — architecture context.

## Output
- Write clean C# to `decomp/src/<Namespace>/<Class>.cs` (mirror the namespace).
- Follow the format of the worked example `decomp/src/GameCore/Buff.cs`:
  namespace + class, fields with `// 0xNN` offset comments, methods with
  `// <MethodName> @<RVA>` comments, faithful logic, XML-doc where helpful.
- Mark anything you cannot confirm with `// INFERRED:` or `// TODO: confirm`.
  Never invent logic silently. Distinguish confirmed (from pseudocode) vs inferred.

## Method (per method)
1. Find the method's C pseudocode in the class `.c` file (match by name/RVA).
2. Get its C# signature + the class field offsets from the skeleton.
3. Map each `param_N + 0xNN` field access to the field NAME at that offset.
   NOTE pointer arithmetic: if a param is typed `long*`/`undefined8*`, then
   `param + 0xc` means byte offset `0xc*8 = 0x60`. Convert to byte offsets first.
4. Translate the control flow / arithmetic to C#. Use the real field/method names.
5. Resolve calls: named functions are already C#-ish (e.g.
   `GameCore_GameCoreEnemy__TakeDamage` → `GameCoreEnemy.TakeDamage`). For
   `FUN_xxxxx`, look up the address in names.tsv. For virtual calls
   `(*(code**)(*this + 0xNNN))(this, ...)`, map the vtable offset to the method
   with the matching `Slot:` in the skeleton.
6. Keep the logic faithful; simplify only IL2CPP boilerplate (below).

## IL2CPP boilerplate to IGNORE (not real game logic)
- Class-init guard:
  `if (DAT_xxx == '\0') { FUN_00a84290(DAT_yyy); DAT_xxx = '\x01'; }`
  → il2cpp method/class initialization. Drop it.
- Static-ctor check:
  `if ((*(byte*)(Some_TypeInfo + 0x10a) & 1) != 0 && *(int*)(Some_TypeInfo+0xbc)==0) FUN_00a9f700();`
  → runtime class init (cctor). Drop it (C# runs cctors automatically).
- `thunk_FUN_00a8f0b0(Some_TypeInfo)` → object allocation (`new SomeType()`).
- Stack-canary check at end (`if (*plVar1 != local_20) thunk_FUN_0000014e();`)
  → stack cookie. Drop it.
- `DAT_xxxxxxxx` globals → static fields or metadata pointers; resolve via
  names.tsv / metadata.tsv where possible, else mark INFERRED.
- Hidden return-pointer params for structs (e.g. GameCoreHandle returned via
  `param_1` out-pointer) → normal C# struct return.
- `undefined1/4/8`, `ZEXT`, `CONCAT`, bit-twiddling on floats → interpret as the
  real type (float/int/bool/struct). `0x3f800000` = 1.0f.

## Key types
- `GameCoreHandle` — lightweight struct handle to a GameCoreObject (has
  `nullHandle`). Often passed/returned by value via hidden pointer.
- `GameCoreObject` — base sim object; `GameCoreFrame`, `CoreObjectPool` manage
  lifecycle. `GameCore.Events` — static event hub notifying the Q4 layer.
- `Q4.*` — Unity MonoBehaviours (presentation). `GameCore.*` — pure sim.
- `Q4.GameCoreBridge` — connects Q4 views ↔ GameCore sim.

## Scope guards
- SKIP online/multiplayer: Q4.Networking, GameCore.Network online services,
  Steamworks, SonyNP, Analytics, Multiplay/LocalMultiplayer. (GameCore.Network
  *Command classes ARE the single-player command pattern — reconstruct those.)
- Do not reproduce asset bytes; reference asset names/types only.

## Quality bar
- Compiles as C# in spirit (correct names/types/signatures); bodies faithful to
  the pseudocode. Prefer clarity. Keep offset/RVA provenance comments so the
  result is auditable against the original.