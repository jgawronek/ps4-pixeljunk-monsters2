#!/usr/bin/env tsx
// Re-runnable build step: concatenate the many small boot assets into a few
// PJPK packs (src/view/pack/packFormat.ts) under public/assets/packs/, plus a
// manifest.json (path -> pack). The ORIGINAL loose files stay where they are
// (runtime fallback). Idempotent: output file names carry a content hash, so
// unchanged inputs produce byte-identical packs and stale packs are deleted.
//
//   npm run build:packs            (rewrites public/assets/packs/*)
//   npm run build:packs -- --check (exit 1 when packs are stale; no writes)
//
// Add a file/dir to a group below to pack it; a loader that fetch()es the
// same /assets/... URL is served from the pack automatically (see PackLoader).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildPack, mimeFor, type PackEntryInput } from '../../src/view/pack/packFormat';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'assets', 'packs');
const check = process.argv.includes('--check');

/** Characters needed to START stage 1 (src/main/game.ts CHARACTER_DEFS core). */
const CHARS_CORE = ['kuri_00_001', 'spider_00_001', 'giant_00_001', 'kurukuru_00_001', 'boss_bero_00',
  'tikiman_01', 'mask_00', 'carapace_00', 'chibi_00', 'tower_001'];
/** Other buildable towers: needed only once the player builds one -> background pack. */
const CHARS_LATE = ['tower_002', 'tower_003', 'tower_004', 'tower_006', 'tower_007', 'tower_008', 'tower_009',
  'tower_011', 'tower_012'];
const STAGE = 'assets/stages/3d_stage_001';
/** Multi-stage: stages 2..N ship small per-stage "boot" packs (data bundle + manifest/pack index + colliders) so a
 *  `?stage=N` page boots with the same few requests as stage 1. LOW priority: a stage-1 session never needs them
 *  (initPacks downloads them in the background, ~1-2MB each). The big per-stage assets (mesh pack, WebP textures, sky)
 *  stay loose + gzip siblings and are fetched on demand by StageSceneView (docs/LOAD_OPTIMIZATION_PLAN.md). */
const EXTRA_STAGES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const stageDir = (n: number): string => `assets/stages/3d_stage_${String(n).padStart(3, '0')}`;

const toUrl = (abs: string): string => '/' + path.relative(PUB, abs).split(path.sep).join('/');
const walk = (dir: string, re: RegExp): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, re));
    else if (re.test(p)) out.push(p);
  }
  return out.sort();
};
const list = (dir: string, re: RegExp): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : [];

/** External image URIs of a GLB, mapped to the webp repack when present
 *  (mirrors the URL rewrite in CharacterLibrary/TreeView/PickupView). */
function glbImages(glb: string): string[] {
  const buf = fs.readFileSync(glb);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { images?: { uri?: string }[] };
  const out: string[] = [];
  for (const im of json.images ?? []) {
    if (!im.uri || im.uri.startsWith('data:')) continue;
    let p = path.resolve(path.dirname(glb), decodeURIComponent(im.uri));
    const webp = p.replace(/([\\/])_?textures([\\/])/, (_m, a, b) => `${a}${_m.includes('_textures') ? '_textures_webp' : 'textures_webp'}${b}`)
      .replace(/\.png$/i, '.webp');
    if (fs.existsSync(webp)) p = webp;
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

const charFiles = (names: string[]): string[] => {
  const files = new Set<string>();
  for (const n of names) {
    const glb = path.join(PUB, 'assets/characters', n, `${n}.glb`);
    if (!fs.existsSync(glb)) { console.warn(`skip missing character ${n}`); continue; }
    files.add(glb);
    for (const im of glbImages(glb)) files.add(im);
  }
  files.add(path.join(PUB, 'assets/characters/_textures_webp/_ok'));
  return [...files];
};

/** Sprites of the title screen (title_*), option menu (option_arrow_*, action_bt_04_win) and Yes/No dialog (dialogue_*). */
const TITLE_SPRITES = /(?:^|[\\/])(?:title_[^\\/]*|option_arrow_(?:left|right)|action_bt_04_win|dialogue_(?:bg|sel))\.png$/;

interface Group { name: string; priority: 'high' | 'low'; files: string[] }
const groups: Group[] = [
  { name: 'boot-data', priority: 'high', files: [
    // stage1-bundle + towers/tower-upgrades/stages-index only: per-stage bundles N>=2 live in their stage-N pack
    ...list(path.join(PUB, 'assets/data'), /\.json$/).filter((f) => !/stage(?!1-)\d+-bundle\.json$/.test(f)),
    path.join(PUB, 'assets/particles/particles.json'),
    ...list(path.join(PUB, 'assets/ui'), /\.json$/),
    ...list(path.join(PUB, 'assets/ui/fonts'), /\.json$/),
    path.join(PUB, 'assets/trees/manifest.json'),
    path.join(PUB, 'assets/pickups/manifest.json'),
    path.join(PUB, 'assets/characters/manifest.json'),
    path.join(PUB, STAGE, 'manifest.json'),
    path.join(PUB, STAGE, 'meshes-pack.json'),
    ...walk(path.join(PUB, STAGE, 'physics'), /\.(json|bin)$/),
  ] },
  // UI PNGs are stored as LOSSLESS WebP (pixel-verified, ~37% smaller) under their .png URL.
  { name: 'ui-fonts', priority: 'high', files: list(path.join(PUB, 'assets/ui/fonts'), /\.png$/) },
  // Title / option menu / dialog art: needed the moment the title appears (high priority, own pack).
  { name: 'ui-title', priority: 'high', files: list(path.join(PUB, 'assets/ui/sprites'), TITLE_SPRITES) },
  { name: 'ui-sprites', priority: 'low', files: list(path.join(PUB, 'assets/ui/sprites'), /\.png$/).filter((f) => !TITLE_SPRITES.test(f)) },
  { name: 'chars-core', priority: 'high', files: charFiles(CHARS_CORE) },
  { name: 'world-misc', priority: 'high', files: [
    ...list(path.join(PUB, 'assets/trees'), /\.glb$/),
    ...walk(path.join(PUB, 'assets/trees/textures_webp'), /./),
    ...list(path.join(PUB, 'assets/pickups'), /\.glb$/),
    ...walk(path.join(PUB, 'assets/pickups/textures_webp'), /./),
    // projectile models (+ only the textures their GLBs reference; the dir also holds tower textures)
    ...list(path.join(PUB, 'assets/projectiles'), /\.glb$/).flatMap((g) => [g, ...glbImages(g)]),
    path.join(PUB, 'assets/projectiles/textures_webp/_ok'),
    path.join(PUB, 'assets/projectiles/manifest.json'),
    ...list(path.join(PUB, STAGE, 'sky'), /\.webp$/),
    path.join(PUB, STAGE, 'textures_webp/sky_test_003.webp'), // SkyAtmosphere 2D source (img element)
  ] },
  { name: 'chars-towers', priority: 'low', files: charFiles(CHARS_LATE).filter((f) => !f.endsWith('/_ok')) },
  // stage-select thumbnails (ui/stages/<scene>.webp, AreaStageInfo.stageSprite) -- only the select screen needs them
  { name: 'ui-stage-thumbs', priority: 'low', files: list(path.join(PUB, 'assets/ui/stages'), /\.webp$/) },
  // The HUB / world-map scene (3d_stage_000: title backdrop + walkable stage select): small boot files only (scene textures/meshes stream
  // loosely like every stage's); low priority so it never competes with the stage-1 critical path.
  { name: 'hub-boot', priority: 'low', files: [
    path.join(PUB, 'assets/stages/3d_stage_000/manifest.json'),
    path.join(PUB, 'assets/stages/3d_stage_000/meshes-pack.json'),
    ...walk(path.join(PUB, 'assets/stages/3d_stage_000/physics'), /\.(json|bin)$/),
    ...list(path.join(PUB, 'assets/stages/3d_stage_000/sky'), /\.webp$/),
  ] },
  ...EXTRA_STAGES.map((n): Group => ({ name: `stage${n}-boot`, priority: 'low', files: [
    path.join(PUB, 'assets/data', `stage${n}-bundle.json`),
    path.join(PUB, stageDir(n), 'manifest.json'),
    path.join(PUB, stageDir(n), 'meshes-pack.json'),
    ...walk(path.join(PUB, stageDir(n), 'physics'), /\.(json|bin)$/),
    ...list(path.join(PUB, stageDir(n), 'sky'), /\.webp$/),
  ] })),
];

/** PNG -> lossless WebP when strictly smaller AND every RGBA byte is identical; else the PNG. */
async function ui(f: string): Promise<{ data: Uint8Array; mime: string }> {
  const src = fs.readFileSync(f);
  if (!/\/assets\/ui\/.*\.png$/.test(f.split(path.sep).join('/'))) return { data: new Uint8Array(src), mime: mimeFor(f) };
  const w = await sharp(src).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
  if (w.length < src.length) {
    const a = await sharp(src).ensureAlpha().raw().toBuffer();
    const b = await sharp(w).ensureAlpha().raw().toBuffer();
    if (Buffer.compare(a, b) === 0) return { data: new Uint8Array(w), mime: 'image/webp' };
  }
  return { data: new Uint8Array(src), mime: 'image/png' };
}

const manifest: { v: 1; packs: Record<string, { file: string; hash: string; bytes: number; priority: string }>; files: Record<string, string> } =
  { v: 1, packs: {}, files: {} };
const claimed = new Map<string, string>(); // url -> pack (first group wins: shared textures live in chars-core)
const outputs: { file: string; data: Buffer; gz: Buffer | null }[] = [];

for (const g of groups) {
  const isUi = g.name.startsWith('ui-');
  const inputs: PackEntryInput[] = [];
  for (const f of [...new Set(g.files)]) {
    if (!fs.existsSync(f)) continue;
    const url = toUrl(f);
    if (claimed.has(url)) continue;
    claimed.set(url, g.name);
    const c = isUi ? await ui(f) : { data: new Uint8Array(fs.readFileSync(f)), mime: mimeFor(url) };
    inputs.push({ path: url, data: c.data, mime: c.mime });
  }
  if (inputs.length === 0) { console.warn(`group ${g.name}: no files`); continue; }
  const pack = Buffer.from(buildPack(inputs));
  const hash = crypto.createHash('sha1').update(pack).digest('hex').slice(0, 10);
  const file = `${g.name}.${hash}.pack`;
  manifest.packs[g.name] = { file, hash, bytes: pack.length, priority: g.priority };
  for (const i of inputs) manifest.files[i.path] = g.name;
  outputs.push({ file, data: pack, gz: zlib.gzipSync(pack, { level: 9 }) });
  console.log(`${g.name.padEnd(13)} ${String(inputs.length).padStart(4)} files  ${(pack.length / 1e6).toFixed(2)} MB  gz ${(outputs[outputs.length - 1].gz!.length / 1e6).toFixed(2)} MB  -> ${file}`);
}
const manifestJson = JSON.stringify(manifest);

if (check) {
  const cur = fs.existsSync(path.join(OUT, 'manifest.json')) ? fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8') : '';
  if (cur !== manifestJson) { console.error('packs are STALE — run: npm run build:packs'); process.exit(1); }
  console.log('packs up to date'); process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
const keep = new Set(['manifest.json']);
for (const o of outputs) {
  keep.add(o.file); keep.add(`${o.file}.gz`);
  fs.writeFileSync(path.join(OUT, o.file), o.data);
  fs.writeFileSync(path.join(OUT, `${o.file}.gz`), o.gz!);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), manifestJson);
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.unlinkSync(path.join(OUT, f));
console.log(`wrote ${outputs.length} packs, ${Object.keys(manifest.files).length} entries -> ${path.relative(ROOT, OUT)}`);
