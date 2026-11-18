// src/view/pack/bootPacks.ts
// App-level singleton wiring for the asset packs: call initPacks() as the very
// first thing in the page (before any loader runs). It patches fetch so every
// existing loader is served from packs, and starts the pack downloads at t=0
// (overlapping the module waterfall / sky PMREM / texture streaming).
// Everything degrades to the loose files when packs/manifest.json is absent
// (e.g. `vite dev` before `npm run build:packs`, or ?nopacks in the URL).

import { PackRegistry, createIdbPackStore, installPackFetch } from './PackLoader';

let registry: PackRegistry | null = null;

export function getPacks(): PackRegistry | null {
  return registry;
}

export function initPacks(): PackRegistry | null {
  if (registry !== null || typeof window === 'undefined') return registry;
  if (new URLSearchParams(window.location.search).has('nopacks')) return null;
  const rawFetch = window.fetch.bind(window) as (i: string, init?: RequestInit) => Promise<Response>;
  registry = new PackRegistry({
    rawFetch,
    store: createIdbPackStore(),
    onFallback: (what, err) => console.warn(`packs: ${what} unavailable — loose files`, err),
  });
  installPackFetch(registry);
  void registry.prefetch();
  return registry;
}

/** Sync URL for <img>/Image sources: the pack's blob: URL when loaded, else the loose URL. */
export function packImageUrl(url: string): string {
  return registry?.blobUrlSync(new URL(url, window.location.href).pathname) ?? url;
}

/** Start background (low priority) download of heavy post-Start assets such as audio. */
export function prefetchLoose(urls: string[]): void {
  registry?.prefetchLoose(urls, 'low');
}

/** Like packImageUrl but waits for the entry's pack (falls back to the loose URL). */
export async function packImageUrlAsync(url: string): Promise<string> {
  if (registry === null) return url;
  try {
    return (await registry.blobUrl(new URL(url, window.location.href).pathname)) ?? url;
  } catch {
    return url;
  }
}

/** Resolves once every high-priority pack is in memory (or immediately when packs are unavailable). */
export function packsHighPriorityLoaded(): Promise<void> {
  if (registry === null) return Promise.resolve();
  return registry.highLoaded();
}
