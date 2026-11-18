// src/view/save/SaveData.ts
// Phase-4 persistence. Shape grounded in Q4.SaveData (decomp/skeleton/Q4.cs
// TypeDefIndex 3329): SAVE_VERSION=3, per-(stage,difficulty) records with
// score/perfect/cleared, UpdateStageRecord/GetStageRecord/HasClearedStage/
// GetStagePerfect/RemoveStageRecord, plus GamePreferences. The original
// serializes a DataBlob (ES2/PlayerPrefs-backed) with clothing unlocks,
// unlockedStages, medals, companions — out of scope for the single-stage
// demo; this is the stage-record + preferences subset (documented NEAR).
//
// SCORE METRIC: the decompiled GetStageRecord returns an int "score" but the
// exact metric isn't recovered here; the demo stores KILLS as the record
// score (documented assumption — the results screen's headline stat).
//
// Storage is structural (StorageLike) so Node tests inject a fake; the
// browser passes window.localStorage. Never throws on storage failure
// (private-mode/quota) — persistence is best-effort, gameplay unaffected.

export const SAVE_VERSION = 3;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StageRecord {
  score: number;
  perfect: boolean;
  cleared: boolean;
}

/** Q4.GamePreferences subset reachable from the option menu (decomp/decompiled/Q4.GamePreferences.c
 *  ctor @0044e7c0 defaults: bg/se volume 1.0, invertY false, show2PJoinLabel true, showActionIcon true).
 *  Volumes are stored as 0..1 floats exactly like the original (UI steps = round(v*10), @003daeb0).
 *  `muted` is a web-port extra (the pause-menu sound toggle). */
export interface GamePreferences {
  muted: boolean;
  bgVolume: number;
  seVolume: number;
  invertY: boolean;
  show2PJoinLabel: boolean;
  showActionIcon: boolean;
  /** Q4.SaveData.hasSeenFirstPlayGuidePrompt (first Play -> "take a look at the manual?" dialog). */
  hasSeenFirstPlayGuidePrompt: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<GamePreferences> = {
  muted: false,
  bgVolume: 1,
  seVolume: 1,
  invertY: false,
  show2PJoinLabel: true,
  showActionIcon: true,
  hasSeenFirstPlayGuidePrompt: false,
};

interface SaveBlob {
  version: number;
  /** key = `${stageName}|${difficulty}` (stageName = SCENE name, e.g. 3d_stage_002 -- see stageCatalog.ts) */
  stages: Record<string, StageRecord>;
  preferences: GamePreferences;
  // ---- multi-stage progression (Q4.SaveData unlockedStages/HasUnlockedHard/medalsInTheBank/lastPlayStageName) ----
  /** SaveData.unlockedStages: scene names unlocked by clears / area locks. */
  unlockedStages: string[];
  /** SaveData.HasUnlockedHard (+0x75): grants the top difficulty on every stage. */
  hasUnlockedHard: boolean;
  /** SaveData.medalsInTheBank. */
  medalsInTheBank: number;
  /** SaveData.SetLastPlayStageName / GetLastPlayStageName (stage-select cursor start). */
  lastPlayStageName: string;
}

/** Pre-multistage builds keyed stage 1 by its per-area label; copied to the scene name on load. */
const LEGACY_STAGE_KEYS: Record<string, string> = { tl_stage_001: '3d_stage_001' };

const DEFAULT_KEY = 'pjm2-web.save';

function stageKey(stageName: string, difficulty: number): string {
  return `${stageName}|${difficulty}`;
}

export class SaveData {
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private blob: SaveBlob;

  constructor(storage: StorageLike | null, key: string = DEFAULT_KEY) {
    this.storage = storage;
    this.key = key;
    this.blob = {
      version: SAVE_VERSION, stages: {}, preferences: { ...DEFAULT_PREFERENCES },
      unlockedStages: [], hasUnlockedHard: false, medalsInTheBank: 0, lastPlayStageName: '',
    };
    this.read();
  }

  private read(): void {
    if (this.storage === null) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as Partial<SaveBlob>;
      // Version guard: a mismatched blob is discarded (forward-compat safe).
      if (parsed.version !== SAVE_VERSION) return;
      if (parsed.stages && typeof parsed.stages === 'object') {
        this.blob.stages = parsed.stages;
        for (const k of Object.keys(parsed.stages)) {
          const bar = k.indexOf('|');
          const to = LEGACY_STAGE_KEYS[k.slice(0, bar)];
          if (to !== undefined && this.blob.stages[`${to}${k.slice(bar)}`] === undefined) {
            this.blob.stages[`${to}${k.slice(bar)}`] = this.blob.stages[k]; // copy (legacy key kept for old readers)
          }
        }
      }
      if (Array.isArray(parsed.unlockedStages)) this.blob.unlockedStages = parsed.unlockedStages.filter((x) => typeof x === 'string');
      if (typeof parsed.hasUnlockedHard === 'boolean') this.blob.hasUnlockedHard = parsed.hasUnlockedHard;
      if (typeof parsed.medalsInTheBank === 'number') this.blob.medalsInTheBank = parsed.medalsInTheBank | 0;
      if (typeof parsed.lastPlayStageName === 'string') this.blob.lastPlayStageName = parsed.lastPlayStageName;
      if (parsed.preferences && typeof parsed.preferences === 'object') {
        const p = parsed.preferences as Partial<GamePreferences>;
        const d = DEFAULT_PREFERENCES;
        const vol = (v: unknown, f: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : f);
        const bool = (v: unknown, f: boolean): boolean => (typeof v === 'boolean' ? v : f);
        this.blob.preferences = {
          muted: bool(p.muted, d.muted),
          bgVolume: vol(p.bgVolume, d.bgVolume),
          seVolume: vol(p.seVolume, d.seVolume),
          invertY: bool(p.invertY, d.invertY),
          show2PJoinLabel: bool(p.show2PJoinLabel, d.show2PJoinLabel),
          showActionIcon: bool(p.showActionIcon, d.showActionIcon),
          hasSeenFirstPlayGuidePrompt: bool(p.hasSeenFirstPlayGuidePrompt, d.hasSeenFirstPlayGuidePrompt),
        };
      }
    } catch {
      /* corrupt blob → start fresh */
    }
  }

  /** Persist the current blob. Best-effort — swallows storage errors. */
  flush(): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.blob));
    } catch {
      /* quota/private-mode — ignore */
    }
  }

  /** Record a stage CLEAR (the C# UpdateStageRecord is invoked on clear, so
   *  cleared is implied — no separate flag). Keeps the BEST score; perfect is
   *  sticky once earned at that score-or-better. Returns true when the stored
   *  record improved (new best score OR newly perfect). */
  updateStageRecord(stageName: string, difficulty: number, score: number, perfect: boolean): boolean {
    const k = stageKey(stageName, difficulty);
    const prev = this.blob.stages[k];
    const next: StageRecord = {
      score: Math.max(prev?.score ?? 0, score),
      perfect: (prev?.perfect ?? false) || (perfect && score >= (prev?.score ?? 0)),
      cleared: true,
    };
    const improved = prev === undefined
      || next.score > prev.score
      || (next.perfect && !prev.perfect);
    this.blob.stages[k] = next;
    this.flush();
    return improved;
  }

  /** Q4.SaveData.UpdateStageRecord @0075a?? exact semantics (decomp/decompiled/Q4.SaveData.c ~L2040-2135):
   *  score = Max(old, new); `newBest` = (old < new) -- also true for a first record; perfect is a plain
   *  sticky OR (`newPerfect` = !old.perfect && perfect, which raises the original's NewPerfect event). */
  recordStageClear(stageName: string, difficulty: number, score: number, perfect: boolean): { newBest: boolean; newPerfect: boolean } {
    const k = stageKey(stageName, difficulty);
    const prev = this.blob.stages[k];
    const oldScore = prev?.score ?? 0;
    const newBest = oldScore < score;
    const newPerfect = perfect && !(prev?.perfect ?? false);
    this.blob.stages[k] = {
      score: Math.max(oldScore, score),
      perfect: (prev?.perfect ?? false) || perfect,
      cleared: true,
    };
    this.flush();
    return { newBest, newPerfect };
  }

  getStageRecord(stageName: string, difficulty: number): number {
    return this.blob.stages[stageKey(stageName, difficulty)]?.score ?? 0;
  }

  /** SaveData.GetStagePerfect(name, -1): perfect on ANY difficulty. */
  hasPerfectStage(stageName: string): boolean {
    return Object.entries(this.blob.stages).some(([k, r]) => k.startsWith(`${stageName}|`) && r.perfect);
  }

  /** difficulty omitted (-1) → cleared on ANY difficulty (matches the C#
   *  default argument Difficulty = -1). */
  hasClearedStage(stageName: string, difficulty = -1): boolean {
    if (difficulty >= 0) return this.blob.stages[stageKey(stageName, difficulty)]?.cleared ?? false;
    return Object.entries(this.blob.stages).some(
      ([k, r]) => k.startsWith(`${stageName}|`) && r.cleared,
    );
  }

  getStagePerfect(stageName: string, difficulty: number): boolean {
    return this.blob.stages[stageKey(stageName, difficulty)]?.perfect ?? false;
  }

  removeStageRecord(stageName: string): void {
    for (const k of Object.keys(this.blob.stages)) {
      if (k.startsWith(`${stageName}|`)) delete this.blob.stages[k];
    }
    this.flush();
  }

  // ---- Q4.SaveData unlock / bank accessors ----------------------------------------------

  get unlockedStages(): readonly string[] {
    return this.blob.unlockedStages;
  }

  /** SaveData.AddUnlockedStage (dedup'd by the caller in the original: List.Contains first). */
  addUnlockedStage(stageName: string): void {
    if (!this.blob.unlockedStages.includes(stageName)) {
      this.blob.unlockedStages.push(stageName);
      this.flush();
    }
  }

  get hasUnlockedHard(): boolean {
    return this.blob.hasUnlockedHard;
  }

  setHasUnlockedHard(v: boolean): void {
    this.blob.hasUnlockedHard = v;
    this.flush();
  }

  get medalsInTheBank(): number {
    return this.blob.medalsInTheBank;
  }

  set medalsInTheBank(v: number) {
    this.blob.medalsInTheBank = Math.max(0, v | 0);
    this.flush();
  }

  getLastPlayStageName(): string {
    return this.blob.lastPlayStageName;
  }

  setLastPlayStageName(name: string): void {
    this.blob.lastPlayStageName = name;
    this.flush();
  }

  /** SaveData.GetTotalPerfectCount: number of (stage,difficulty) records holding a perfect clear
   *  (= rainbow fragments; AreaLock.requiredRainbows compares against this). */
  getTotalPerfectCount(): number {
    let n = 0;
    for (const r of Object.values(this.blob.stages)) if (r.perfect) n++;
    return n;
  }

  get preferences(): GamePreferences {
    return { ...this.blob.preferences };
  }

  setMuted(muted: boolean): void {
    this.blob.preferences.muted = muted;
    this.flush();
  }

  /** Merge option-menu values (Q4.OptionMenuController.Apply @003dbeb0 then SavePreferences). */
  setPreferences(patch: Partial<GamePreferences>): void {
    this.blob.preferences = { ...this.blob.preferences, ...patch };
    this.flush();
  }

  /** Q4.GamePreferences.HasNonDefaultPreferences @0044f070: bg/se != 1, invertY, !show2P, !showActionIcon. */
  hasNonDefaultPreferences(): boolean {
    const p = this.blob.preferences;
    const d = DEFAULT_PREFERENCES;
    return p.bgVolume !== d.bgVolume || p.seVolume !== d.seVolume || p.invertY !== d.invertY
      || p.show2PJoinLabel !== d.show2PJoinLabel || p.showActionIcon !== d.showActionIcon;
  }

  /** Q4.GamePreferences.ResetAllPreferences @0044f0b0 (keeps the port-only mute + guide-seen flag). */
  resetPreferences(): void {
    const { muted, hasSeenFirstPlayGuidePrompt } = this.blob.preferences;
    this.blob.preferences = { ...DEFAULT_PREFERENCES, muted, hasSeenFirstPlayGuidePrompt };
    this.flush();
  }
}

/** Browser factory: real localStorage (null when unavailable, e.g. some
 *  privacy modes — SaveData then runs in-memory). */
export function createBrowserSaveData(): SaveData {
  let storage: StorageLike | null = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) storage = window.localStorage;
  } catch {
    storage = null;
  }
  return new SaveData(storage);
}
