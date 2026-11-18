// src/view/pack/packFormat.ts
// "WAD"-style asset pack: many small files in ONE blob + a JSON index, so the
// browser makes one request instead of hundreds (HTTP/1.1 = 6 connections per
// host; every extra request is queueing + headers + an RTT). Pure functions,
// no DOM/Node APIs: shared by the build tool (tools/assets/pack_assets.ts), the
// runtime loader (PackLoader.ts) and the tests.
//
// Layout (little endian, every entry payload 4-byte aligned like meshes.pack):
//   0   char[4] magic 'PJPK'
//   4   u32     version (1)
//   8   u32     indexLength   (bytes of the UTF-8 JSON index, unpadded)
//   12  u32     indexCrc32    (crc32 of those bytes)
//   16  index JSON, zero padded to a multiple of 4 -> dataStart
//   ..  entry payloads, each starting on a 4-byte boundary (zero padded)
// Index JSON: { v:1, size:<total pack bytes>, entries:[{p:path,o:offsetFromDataStart,l:length,m?:mime}] }
// `size` lets the loader detect a truncated download; the crc catches a
// corrupted index. A pack that fails validation is rejected as a whole and the
// loaders fall back to the original loose files.

export const PACK_MAGIC = 'PJPK';
export const PACK_VERSION = 1;
const HEADER_BYTES = 16;

export interface PackEntryInput {
  /** Absolute URL path the loose file is served at, e.g. /assets/ui/sprites/a.png */
  path: string;
  data: Uint8Array;
  mime?: string;
}

export interface PackEntry {
  path: string;
  /** Absolute byte offset inside the pack buffer. */
  offset: number;
  length: number;
  mime?: string;
}

export class PackError extends Error {
  constructor(msg: string) {
    super(`pack: ${msg}`);
    this.name = 'PackError';
  }
}

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const pad4 = (n: number): number => (n + 3) & ~3;

export function buildPack(inputs: PackEntryInput[]): Uint8Array {
  const seen = new Set<string>();
  const rel: { p: string; o: number; l: number; m?: string }[] = [];
  let cursor = 0;
  for (const e of inputs) {
    if (seen.has(e.path)) throw new PackError(`duplicate path ${e.path}`);
    seen.add(e.path);
    const rec: { p: string; o: number; l: number; m?: string } = { p: e.path, o: cursor, l: e.data.length };
    if (e.mime) rec.m = e.mime;
    rel.push(rec);
    cursor += pad4(e.data.length);
  }
  // The index embeds the total size, which depends on the index length (fixed
  // width digits keep the length stable across the two passes).
  const mk = (size: number): Uint8Array =>
    new TextEncoder().encode(JSON.stringify({ v: PACK_VERSION, size: String(size).padStart(12, '0'), entries: rel }));
  let index = mk(0);
  const dataStart = HEADER_BYTES + pad4(index.length);
  const total = dataStart + cursor;
  index = mk(total);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = PACK_MAGIC.charCodeAt(i);
  dv.setUint32(4, PACK_VERSION, true);
  dv.setUint32(8, index.length, true);
  dv.setUint32(12, crc32(index), true);
  out.set(index, HEADER_BYTES);
  inputs.forEach((e, i) => out.set(e.data, dataStart + rel[i].o));
  return out;
}

export interface ParsedPack {
  entries: Map<string, PackEntry>;
  /** Zero-copy view of an entry's bytes (shares the pack buffer). */
  view(path: string): Uint8Array | null;
  readonly byteLength: number;
}

/** Validate + index a pack. Throws PackError on ANY inconsistency. */
export function parsePack(buf: ArrayBuffer | Uint8Array): ParsedPack {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < HEADER_BYTES) throw new PackError('truncated header');
  for (let i = 0; i < 4; i++) if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) throw new PackError('bad magic');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(4, true) !== PACK_VERSION) throw new PackError('unsupported version');
  const indexLen = dv.getUint32(8, true);
  if (HEADER_BYTES + indexLen > bytes.length) throw new PackError('truncated index');
  const indexBytes = bytes.subarray(HEADER_BYTES, HEADER_BYTES + indexLen);
  if (crc32(indexBytes) !== dv.getUint32(12, true)) throw new PackError('index crc mismatch');
  let doc: { v?: number; size?: string; entries?: { p: string; o: number; l: number; m?: string }[] };
  try {
    doc = JSON.parse(new TextDecoder().decode(indexBytes));
  } catch {
    throw new PackError('index is not JSON');
  }
  if (doc.v !== PACK_VERSION || !Array.isArray(doc.entries)) throw new PackError('bad index');
  if (Number(doc.size) !== bytes.length) throw new PackError(`size mismatch (${bytes.length} != ${doc.size})`);
  const dataStart = HEADER_BYTES + pad4(indexLen);
  const entries = new Map<string, PackEntry>();
  for (const e of doc.entries) {
    const offset = dataStart + e.o;
    if (typeof e.p !== 'string' || !Number.isInteger(e.o) || !Number.isInteger(e.l) || e.o < 0 || e.l < 0
      || offset % 4 !== 0 || offset + e.l > bytes.length) {
      throw new PackError(`entry out of bounds: ${String(e.p)}`);
    }
    entries.set(e.p, { path: e.p, offset, length: e.l, mime: e.m });
  }
  return {
    entries,
    byteLength: bytes.length,
    view(path: string): Uint8Array | null {
      const e = entries.get(path);
      return e ? bytes.subarray(e.offset, e.offset + e.length) : null;
    },
  };
}

/** Best-effort MIME by extension (Response/Blob construction). */
export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', glb: 'model/gltf-binary',
    bin: 'application/octet-stream', wav: 'audio/wav', ogg: 'audio/ogg',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}
