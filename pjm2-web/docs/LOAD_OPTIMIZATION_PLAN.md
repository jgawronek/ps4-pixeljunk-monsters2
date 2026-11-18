# Load optimization plan + results

Probes: `.work/probe-waterfall.cjs` (every request start/end/bytes, longtasks, start-visible, frame gaps; `QUERY=&nopacks`
for the loose-file path), `.work/probe-cpuprof.cjs` / `probe-cpuprof2.cjs` (CPU profile before/after START),
`.work/build-probe.sh [outDir]` (prod build without copying 900MB `public/`, symlinks assets) + `DIR=.work/dist-probe PORT=5200 node tools/serve.mjs`.
CAVEAT: headless SwiftShader does GPU work on the CPU (texSubImage2D, program link, WebGLRenderer creation = seconds) and the
machine was heavily loaded by concurrent probes (load avg ~70), so WALL-CLOCK numbers varied 8s..16s run to run for the same build.
Deterministic facts (request counts, bytes, critical-path structure) are what is reported below.

## Measured baseline (prod build, localhost, before changes; `.work/wf-before.json`)
- 253 requests / 143 MB incl. audio; 107 of them at t<3.4s are JS in dev, 8 in prod.
- Boot critical chain AFTER everything else: tower-upgrades.json -> ui fonts json/png -> towers.json -> ui sprites = 4 serial RTT levels.
- 29 GLB + 39 character texture requests, 8 collider bins, 6 sky faces, 22 UI, trees 2+: ~100 small requests.
- Props textures (60 MB) start while terrain/characters are still downloading (10 workers, priority-ordered but unthrottled).
- `HEAD _ok` sentinel requests per character/tree/pickup/projectile set (serial before the first GLB).
- Main thread (SwiftShader): WebGLRenderer creation 2-4 s, texture upload + program link dominate longtasks (10 s task in the textures phase).
- Audio (37 MB) is fetched only after START (bgm 27 MB wav) = first-sound delay of a full download.

## After (this change; `.work/wf-after1/2.json`)
- 40-65 requests before Start (was ~250): 6 packs + manifest + mesh pack + scene json + 22 stage textures + JS. Pack requests are issued by
  `<link rel=preload>` tags injected into game.html at build (vite plugin) so they start at t=0 in parallel with the JS, mesh pack
  and terrain textures.
- Critical path (non-texture) ends when the packs finish; the serial UI/towers/tower-upgrades chain is gone (started at t=0).
- Props/hut textures (priority >= 8, ~60 MB wire) now wait for the blocking textures + high-priority packs, so on a slow link
  all critical bytes get the full pipe. Measured: Start was reached before any deco texture request was issued.
- Audio bytes are prefetched (low priority) right after Start becomes visible; the click no longer waits for a 27 MB download.
- GPU texture uploads are budgeted per frame (24 MB RGBA/frame) instead of all inside the first render after decode.
- Sky PMREM (`sky.apply`) overlaps the downloads instead of gating boot start; `renderer.compileAsync` runs before Start.
- 9 non-starter tower GLBs (+textures, 3.1 MB gz) load in the background pack `chars-towers` (use `?eagertowers` to block Start on them).
- UI PNGs (fonts + 138 sprites) stored as pixel-verified lossless WebP: 6.5 MB -> 4.1 MB.
- Wall clock (unreliable, loaded box): Start visible 17.7 s (before) vs 8.0 / 9.7 / 10.7 / 15.6 s (after, 4 runs); `&nopacks` ablation run under load 70 s.

## Estimated savings (ranked; seconds on the Start path)
| # | change | 8 Mbit/s | LAN (~1 Gbit, ~5 ms RTT) |
|---|--------|----------|------|
| 1 | defer 60 MB props textures until critical bytes done | 10-30 s of bandwidth contention removed | ~0 (loading finishes anyway, runs after Start) |
| 2 | prod build + serve instead of dev modules | 2.5-3 s (JS 0.73 MB br, 8 req) | 2.5-3 s |
| 3 | packs: ~200 -> 6 requests, no `_ok` HEADs, no per-sprite loads | 1-2 s (headers/RTT, 6-conn queue), plus -2.4 MB UI bytes = 2.4 s | 1-1.5 s |
| 4 | UI lossless WebP | 2.4 s | ~0 |
| 5 | late tower pack not blocking Start | ~3.1 MB = 3 s | ~0.2 s |
| 6 | UI/tower data fetched at t=0 not serial tail | 4 RTT + parse (0.3-1 s on WAN) | 0.1 s |
| 7 | audio prefetch after Start | 27 MB bgm no longer starts at click: 25 s earlier music at 8 Mbit | ~1 s |
| 8 | per-frame texture upload budget + compileAsync | frame hitches, not Start | hundreds of ms of hitches on real GPUs |
| 9 | IndexedDB pack store (http origins) | repeat: 20 MB of packs = 0 bytes, 20 s | ~0.3 s |
Not done / needs a decision: normal maps are 45 MB of 81 MB textures (quality change); Draco/meshopt for tikiman (8.5 MB);
share one decoded Texture across the 4 tree GLB variants (bytes are now deduped by the pack, GPU uploads are not);
worker-thread GLB parse / mesh-pack transform (main thread cost ~100 ms real); compile enemy/tower toon materials before Start
(their programs still link on first spawn); HTTP/2 needs TLS.

## Pack system
- Format `src/view/pack/packFormat.ts` (PJPK, 4-byte aligned entries, crc-checked JSON index, size check). Loader
  `src/view/pack/PackLoader.ts` (`PackRegistry`, `installPackFetch`, IDB `PackStore`), wiring `src/view/pack/bootPacks.ts`.
- `installPackFetch` wraps `fetch` so GLTFLoader/ImageBitmap/plain fetch of any packed `/assets/...` URL is served from the pack;
  `<img>` users (UI sprites/fonts, tree normal maps, sky) use `packImageUrl[Async]` (blob URLs). Any miss, 404, truncated or
  corrupt pack -> the loose original file is fetched exactly as before. `?nopacks` disables everything.
- Packs (public/assets/packs/): `boot-data` (all JSON + physics colliders/bins), `ui-fonts`, `ui-sprites` (low), `chars-core`
  (10 GLBs + their webp textures), `world-misc` (trees, pickups, projectiles, sky), `chars-towers` (low). Each has a `.gz`
  sibling and content-hashed name (immutable cache); `manifest.json` revalidates.
- Rebuild (re-runnable, idempotent; run after the player-shell/character export regenerates GLBs):
  `npm run build:packs` (or `npm run build:packs -- --check` to detect stale packs), then `npm run build`
  (`npm run build:all` does both). Group membership lives in `tools/assets/pack_assets.ts`.

## Recommended run path
`npm run build:all && npm run serve` (PORT/HOST/DIR env). serve.mjs: br/gzip, ETag, `.pack(.gz)` immutable, manifest no-cache.
`vite dev` still works (packs served as static files from public/, no preload tags; ~107 module requests remain: use serve for timing).
Tests: `tests/view/pack.test.ts` (round trip, alignment, determinism, corruption, fallback, patched fetch, loose prefetch, upload queue).
