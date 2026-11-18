// src/main/stageUrls.ts
// Pure URL helpers shared by game.ts (result exits) and the stage-select feature (no DOM / UI imports).

/** game.html URL booting stage N (`notitle` keeps title/intro-less semantics compatible with the title agent's flag). */
export function gameUrl(stage: number, difficulty = 1, base = '/game.html'): string {
  return `${base}?stage=${stage}&notitle&diff=${difficulty}`;
}

export function stageSelectUrl(base = '/stage-select.html'): string {
  return base;
}

/** `?diff=` -> difficulty tier (0..2), default Medium(1) (the pinned demo difficulty). */
export function difficultyFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get('diff');
  const n = raw === null ? 1 : Number.parseInt(raw, 10);
  return n >= 0 && n <= 2 ? n : 1;
}
