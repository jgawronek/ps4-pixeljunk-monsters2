# Load HAR analysis (10.0.10.156.har, Vite dev server over LAN)

Script: `.work/har_summary.py`. Capture: 261 requests, all HTTP/1.1, onContentLoad 3.0s, onLoad 3.2s,
last request finishes at 11.2s. 117 MB transferred (textures 81 MB / 116 req, GLB 16 MB / 18, mesh pack 10 MB gz
(39 MB inflated), vite deps 3.5 MB / 7, src modules 2.7 MB / 100, JSON 1.3 MB). No 4xx/5xx. No audio requests
(audio starts only after the START gesture, so it never blocks loading).

NOTE: the captured network time is ~11 s, not "over a minute". The mesh pack took 1.5 s (10 MB gz,
Content-Encoding gzip was already served), not 20 s. So this capture is already post-fix for the pack;
any remaining >11 s is client CPU (WebP decode, GLB parse, shader compile) or a slower link than the capture.

## Timeline (seconds)
- 0.0-2.9  Unbundled module waterfall: 100 `/src/*.ts` + 7 `.vite/deps`, ~1 s "blocked" each (6-conn HTTP/1.1 queue).
  Game code cannot even start `boot()` until 3.1 s. Per-request TTFB is only ~0.1 s; it is queueing, not transform time.
- 3.1  stage1-bundle.json, 3.6 scene/particles/strings/tree manifest, 3.66 GLBs, 4.0 mesh pack (done 5.5), 4.5 tikiman_01.glb 8.5 MB (2.9 s).
- 4-10  ~66 MB of textures stream; 41 requests in second 4 alone (25 MB), saturating the link.
- 8.3  Physics colliders JSON + 8 collider .bin files start (after view.load finished) and run in 4 sequential batches
  until 10.5 s. They were sequential after everything else = ~2.2 s of pure tail on the Start critical path.
- Everything is `Cache-Control: no-cache` (weak ETag) except `.vite/deps` (immutable). Repeat loads = 260 conditional
  requests; `caches` (Cache API) does not exist on http://10.0.10.156 so the AssetCache layer is a no-op there.
- Duplicates: tree_00x textures requested 4x each (one per tree GLB variant, 4 in flight at once), sky_test_003 2x.
- Max concurrency 67 requests nominally in flight (browser queues them to 6 per host).
- Dev server does not compress: GLB/WebP/WAV travel raw (webp/glb cannot shrink much anyway); `.gz` siblings were served
  with Content-Encoding gzip and `compressedFetch` already copes (sniffs gzip magic).

## Ranked savings (estimates)
1. Production bundle instead of dev module waterfall (`npm run build && npm run serve`): ~2.5-3 s, plus none of the
   per-module revalidation on repeat (hashed JS immutable). Bundled game JS is 730 KB brotli.
2. Physics fetch started at boot() entry instead of after the view finished: ~2 s off the tail (done, game.ts).
3. Preload hints in game.html (bundle json, scene gz, meshes-pack json + pack, colliders json) start at t=0 and overlap the
   module waterfall: ~2 s dev (done). Also gives the stage bundle fetch a head start (`bundleFetch` in boot()).
4. HTTP caching (serve.mjs: ETag + max-age 1d for assets, immutable for hashed JS): repeat load drops from 117 MB /
   260 requests to ~0 bytes (the previous no-cache + Cache-API-less http path re-validated everything). Largest win for repeats.
5. Not done / needs a decision: normal maps are 45 MB of the 81 MB texture bytes (would need quality changes);
   tikiman_01.glb is 8.5 MB (2.9 s alone; candidates: Draco/meshopt or lazy-load because it is not needed for Start);
   tree texture 4x duplicate requests (HTTP cache dedups on the serve path); HTTP/2 would remove the 6-connection limit
   (needs TLS in browsers, not done).

## Changes made
- `tools/serve.mjs` + `npm run serve`: static server for `dist/` (falls back to `public/`), br/gzip on-the-fly with in-memory cache,
  ETag/304, Cache-Control (immutable for hashed assets, 1 d for others, no-cache for html), Range, keep-alive; pre-gzipped
  `.gz` files passed through raw. Verified: scene.json 1.1 MB -> 91 KB br, game JS 2.3 MB -> 730 KB.
- `src/main/game.ts` boot(): bundle fetch + physics world load kicked off before `sky.apply()`.
- `game.html`: `<link rel=preload as=fetch>` for the five critical data files.
