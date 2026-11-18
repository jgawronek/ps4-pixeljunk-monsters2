// src/main/textureAudit.ts
// DEBUG ONLY (enabled with ?texaudit): tracks which THREE.Texture objects are currently UPLOADED to the GPU
// (three registers a 'dispose' listener on first upload and removes it on dispose) so the stage-disposal audit can
// name the owners of textures that survive `session.dispose()`. `__pjm2.textureAudit()` -> grouped summary.

import * as THREE from 'three';

interface Info { sig: string; stack: string }
const live = new Map<THREE.Texture, Info>();

function describe(t: THREE.Texture): string {
  const img = t.image as { width?: number; height?: number; constructor?: { name?: string } } | null | undefined;
  const kind = t.constructor.name;
  const dim = img !== null && img !== undefined ? `${img.width ?? '?'}x${img.height ?? '?'} ${img.constructor?.name ?? ''}` : 'noimage';
  return `${kind} "${t.name}" ${dim} fmt=${t.format} type=${t.type}${(t as { isCompressedTexture?: boolean }).isCompressedTexture === true ? ' compressed' : ''}${t.isRenderTargetTexture ? ' rt' : ''}`;
}

export function installTextureAudit(): void {
  const proto = THREE.Texture.prototype as unknown as {
    addEventListener(type: string, fn: unknown): void;
    removeEventListener(type: string, fn: unknown): void;
  };
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: THREE.Texture, type: string, fn: unknown): void {
    if (type === 'dispose' && !live.has(this)) live.set(this, { sig: describe(this), stack: new Error().stack?.split('\n').slice(2, 7).join(' | ') ?? '' });
    add.call(this, type, fn);
  };
  proto.removeEventListener = function (this: THREE.Texture, type: string, fn: unknown): void {
    if (type === 'dispose') live.delete(this);
    remove.call(this, type, fn);
  };
}

export function textureAuditSummary(): { total: number; groups: { sig: string; count: number; stack: string }[] } {
  const g = new Map<string, { count: number; stack: string }>();
  for (const { sig, stack } of live.values()) {
    const e = g.get(sig) ?? { count: 0, stack };
    e.count++;
    g.set(sig, e);
  }
  return { total: live.size, groups: [...g].map(([sig, v]) => ({ sig, ...v })).sort((a, b) => b.count - a.count).slice(0, 25) };
}
