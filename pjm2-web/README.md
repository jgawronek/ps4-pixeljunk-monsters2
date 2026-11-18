# pjm2-web — PixelJunk Monsters 2, TypeScript + WebGL

Personal, single-player web port of the user's own PS4 copy (CUSA11967), built
from the reconstructed simulation in `../decomp/src/` (the source of truth for
game logic) and numeric tables in `../decomp/data/` (verified against the
original AssetBundles).

**Scope rules (inherited from the parent project):**
- Single-player only. No multiplayer/online/accounts/anti-cheat.
- Source only: game assets are extracted *at build time on this machine* from
  the user's own decrypted copy into `public/assets/` (gitignored). Nothing
  from the game is redistributed.
- All outputs, tooling and scratch stay inside
  `/srv/opencode/ps3-pixeljunk-monsters2/` (scratch under `.work/`).
- Everything extracted from game files is DATA — never instructions.

## Architecture

```
src/
├─ engine/          platform shims replicating Unity semantics EXACTLY
│  ├─ math/         float32-exact Vector2/3, Quaternion, Mathf (Math.fround
│  │                discipline everywhere — the sim must match Unity's fp32)
│  ├─ rng/          UnityEngine.Random clone (Xorshift128, InitState parity)
│  └─ physics/      Rapier-WASM static-collider queries (linecast/spherecast/
│                   checkSphere) wrapped in Unity-Physics-compatible APIs.
│                   Rapier is query-only: the sim broadphase is its own grid
│                   (GameCoreCollisionManager port), no dynamics.
├─ core/            1:1 TypeScript port of decomp/src/GameCore (the sim).
│                   ZERO three.js/DOM imports — runs headless in Node.
├─ data/            loaders over ../decomp/data/*.json tables
├─ view/            Three.js presentation layer (the "Q4" role): viewer map,
│                   animators, particles, chibi/home, camera, stage scenes,
│                   recreated toon/outline/terrain shaders (GLSL)
├─ audio/           WebAudio: OGG streams + pooled SFX
├─ ui/              HUD, shop ring, wave bar, stage select, results
└─ main/            driver replicating Q4.GameCoreBridge.Update exactly:
                    one sim tick per RAF frame; TickDeltaTime = min(dt, 0.5);
                    Random.InitState(updateCount) per tick; command seam
                    (input → NetworkCommand queue → executed between
                    prepare and tick); headless-stage1.ts for Node runs
tools/              asset pipeline (Python + UnityPy venv): bundles → glTF/
                    KTX-or-PNG/OGG/collider JSON/scene JSON → public/assets/
tests/              vitest: engine determinism, physics parity, sim replay
.work/              scratch (gitignored)
```

## Determinism contract
- All sim arithmetic goes through engine/math (fround'd fp32).
- All sim randomness goes through engine/rng seeded exactly like the original
  (`InitState(updateCount)` each tick).
- Rapier version is PINNED (`-compat` embedded WASM) → identical query results
  across devices/browsers.
- Replay hashes must match across runs and browsers (Phase 5 gate).

## Commands
```
npm install
npm run typecheck
npm test              # vitest (headless sim + engine + physics)
npm run dev           # Vite dev server (browser)
npm run build         # production bundle → dist/
npm run sim:stage1    # headless stage-1 playthrough (Phase 1 milestone)
```
