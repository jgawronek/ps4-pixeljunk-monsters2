
# Home chibi view solver (Q4.Home.ChibiCollisions) — `src/view/characters/HomeChibiSolver.ts`

Addresses (PS4 Il2CppUserAssemblies.elf; vaddr → file offset = vaddr + 0x4000):
`Q4.Home.Update @4606e0`, `SyncToGameCore @4608b0` (spawns one Chibi per sim chibi via `SpawnChibi @462280`; indices >= IntroNumHomeChibi 17
are `SetActive(false)` until `OnCameraSwitch @460560`), `ChibiCollisions @460ab0`, `OnChibiAvoidanceZone @462900`,
`SolidCollider..ctor @4629c0`, `ChibiSolverData.InitSolverData @462a40`. Types: `SolidCollider.EType {Player 0, Cylinder 1, Enemy 2, Inside 0x8000}`.

## Frame flow
`Home.Update`: `SyncToGameCore()` → `ChibiCollisions(Time.deltaTime, this, GameCoreBridge.GetGameCoreObject<GameCoreHome>(home))`.
1. Seed, per chibi i in `m_chibis` order: `Chibi.IsScared = GameCoreHome.IsEnemyClose`; `ChibiSolverData[i].InitSolverData(i, chibi.transform.position,
   homePos = GetChibiDataById(chibi.ChibiId).pos, homeRot = .rot)` (a chibi no longer in the sim uses its own position/rotation);
   `playerPos = Vector3.one * 1e6`; `chibiDetected` = all j < i with xz-dist² < (4 * ChibiColSize)² (= 0.64).
2. `solidColliders`: [Cylinder at hut pos r=`playerDetectionRange` 2.0, type 1] [Inside ring r=`ChibiMaxDistFromHome` 2.45, type 0x8001]
   [live temp zones: `dur -= dt`, kept while > 0] [Player r=`PlayerColSize` 0.4 for each `GameCore.AllObjects<GameCorePlayer>(hut pos, Cylinder(MaxDist*1.5, 2.0))`
   that has a Q4 viewer, at `Q4.Player.GetTransform().position`].
3. Relaxation, max 3 passes (loop while any change and pass < 3). Per chibi i, `cur = solver[i].pos`:
   (a) for each k in detected[i]: d = solver[k].pos − cur; if xz-dist² < (2·ChibiColSize)² = 0.16: push = normalize(d)·(0.4 − |d|)·0.5; cur −= push; solver[k].pos += push.
   (b) pull: if xz-dist²(homePos − cur) > 0.005: cur += normalize(homePos − cur)·0.05 (fixed step).
   (c) per collider (offset v = cur − c.pos with y zeroed; act when `Inside == (radiusSqr < |v|²)`... i.e. normal colliders when within radius, Inside ring when outside):
       Enemy: i < 2 → cur = homePos; else cur += normalize(v)·max(0, 0.25·|homePos − c.pos|); then `Chibi.IsScared = true`.
       others: cur += normalize(v)·(radius − |v|) (Inside ring ⇒ negative ⇒ pulled in). A Player collider also sets `solver[i].playerPos = c.pos`.
   `solver[i].pos = cur`.
4. Write back on each Chibi: `DestPos = solver.pos`, `DestRot = solver.homeRot` (sim rotation), `IsPlayerClose = |playerPos − pos|² (3D) < (PlayerColSize+0.1)²`,
   `PlayerPos = solver.playerPos`.
`OnChibiAvoidanceZone(pos, radius, dur)` appends `SolidCollider(pos, radius, Enemy)` to `chibiTempAvoidanceZones`; **the `dur` argument is ignored — the code stores the constant 0.75 s**
(`movl $0x3f400000,0x28(%rbx)` @466990).

## Constants (rodata, file offset = vaddr + 0x4000)
`b7b78c`=1.5 (player query radius scale on `Home.MaxDist` @0x44), `b7b790`=2.0 (query height), `b7b794`=0.1 (IsPlayerClose margin), `b7b798`=0.005 (home-pull xz²),
`b7b79c`=0.05 (home-pull step), `b7b7a0`=0.25 (enemy-zone push scale), `b7b7a4`=0.5 (chibi pair push), `b7b7b0`=1e6 (no player). Pass count 3, snap count 2: immediates in code.
Home.cs offsets: ChibiColSize @58, PlayerColSize @5c, ChibiMaxDistFromHome @7c, Structure.playerDetectionRange @20, m_transform @30.

## Verified vs approximated
Verified against raw disassembly: every constant above, all field offsets, xz-vs-3D choices (neighbour/pair/home/collider tests use xz; the pair push magnitude/normalize and
IsPlayerClose use full 3D), the Enemy-zone branches (`Mathf.Max(0, len·0.25)` argument order), the pass count, collider order, the fixed 0.75 s zone lifetime.
Not modelled / host responsibilities: Unity `Object == null` checks and destroyed chibis (the host must drop a chibi from the list once its Chibi is destroyed — the original
keeps stale entries), inactive chibis (index >= 17 before the intro camera hand-off are still solved, only their GameObject is inactive), `float32` rounding
(plain JS doubles), the Quaternion → yaw conversion of `DestRot` (the host passes the sim yaw; the original passes the quaternion untouched).
