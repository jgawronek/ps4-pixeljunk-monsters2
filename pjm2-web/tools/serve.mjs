#!/usr/bin/env node
// Production-style static server for the built game (dist/) — or public/ when
// no build exists. Fixes what the Vite dev server cannot (see
// docs/LOAD_HAR_ANALYSIS.md):
//   - ONE bundled JS graph instead of ~110 unbundled module requests
//     (dev: ~3s of 6-connection-limited waterfall before the game even boots)
//   - gzip/brotli for compressible types (json/js/css/html/glb/wav/bin/svg)
//   - ETag + Cache-Control so repeat loads hit the browser HTTP cache
//     (works on plain http:// LAN where Cache API / service workers do not):
//       hashed /assets/*-<hash>.* bundles  -> immutable, 1y
//       other static assets               -> max-age=1d + ETag revalidation
//       *.html                            -> no-cache + ETag
//   - Range requests, keep-alive, pre-built `.gz` siblings passed through raw
//     (the client inflates them via DecompressionStream; Content-Encoding is
//     deliberately NOT set so nothing is decoded twice)
//
// Usage: npm run build && npm run serve   (PORT=5199 HOST=0.0.0.0 DIR=dist)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(root, process.env.DIR ?? (fs.existsSync(path.join(root, 'dist', 'game.html')) ? 'dist' : 'public'));
const port = Number(process.env.PORT ?? 5199);
const host = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream', '.gz': 'application/octet-stream', '.pack': 'application/octet-stream',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.glb', '.wav', '.bin', '.wasm']);
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const cache = new Map(); // key -> Buffer (compressed bodies; LRU by insertion)
let cacheBytes = 0;

function remember(key, buf) {
  cache.set(key, buf); cacheBytes += buf.length;
  for (const [k, v] of cache) { if (cacheBytes <= MAX_CACHE_BYTES) break; cache.delete(k); cacheBytes -= v.length; }
}

function pickEncoding(req, ext, size) {
  if (!COMPRESSIBLE.has(ext) || size < 1024) return null;
  const ae = String(req.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

function cacheControl(rel, ext) {
  if (ext === '.html') return 'no-cache';
  // asset packs: content-hashed file names (immutable); the manifest that points at them must revalidate
  if (rel.endsWith('assets/packs/manifest.json')) return 'no-cache';
  if (/(^|\/)assets\/packs\/[^/]+\.pack(\.gz)?$/.test(rel)) return 'public, max-age=31536000, immutable';
  if (/(^|\/)assets\/[^/]*-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(rel) && !rel.includes('/stages/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=86400';
}

function compress(enc, buf) {
  return enc === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : zlib.gzipSync(buf, { level: 6 });
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; }
    let st;
    try { st = fs.statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const enc = pickEncoding(req, ext, st.size);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${enc ? '-' + enc : ''}"`;
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(rel, ext),
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      Vary: 'Accept-Encoding',
      'Accept-Ranges': enc ? 'none' : 'bytes',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }

    if (enc) {
      const key = `${enc}:${file}:${st.mtimeMs}`;
      let body = cache.get(key);
      if (!body) { body = compress(enc, fs.readFileSync(file)); remember(key, body); }
      headers['Content-Encoding'] = enc;
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    let start = 0, end = st.size - 1, status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      else { start = Math.max(0, st.size - Number(m[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});
server.keepAliveTimeout = 65_000;
server.listen(port, host, () => console.log(`serving ${dir} on http://${host}:${port}`));
