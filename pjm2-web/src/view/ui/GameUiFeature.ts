// src/view/ui/GameUiFeature.ts
// Orchestrates the original-art in-game UI: HUD (OriginalHud), wave calls /
// countdown (WaveCallsUi), enemy-incoming tracker (Q4.UI.WaveTracker), the
// build ring (BuildMenuFeature) and the pause/result/game-over skin
// (OriginalScreens). All sim data arrives through the real events
// (waveActivateEvent / waveEndedEvent / stageClearedEvent / gameOverEvent) and
// read-only sim getters; nothing here mutates the sim.
//
// EVIDENCE: StageMain.OnWaveActivate @00527160 -> StartCallMenuController.Show
// (calls shown at wave ACTIVATE, not at spawn start); StageMain.OnWaveEnded
// @00527570 -> WaveClearBonus sfx + ShowWaveClear (not after the last wave);
// StageMain.OnStageCleared @00526da0 / OnGameOver @00527800 -> DelayedResultMenuShow
// (m_stageClearDelay 5.0) / DelayedGameOverMenuShow (m_gameOverDelay 6.0)
// (globalsettings GameInfoController); WaveTracker: displayTime 4 s on the arrow bubble,
// textDisplayTime 5 s on "Incoming!" (Hud_02 Bubble_Enemy), UpdateTrackedEnemy picks
// the wave's lead enemy; the bubble is clamped to the screen edge
// (CanvasToCameraPositionConvert.isClamped) with the arrow rotated toward the enemy.

import { WaveBarModel } from './WaveBarModel';
import { ENEMY_WAVE_BAR } from '../../data/enemyWaveBar.generated';
import { EventTime } from '../../core/event/CoreEvent';
import { Events } from '../../core/Events';
import type { GameCore } from '../../core/GameCore';
import { GameCoreEnemy } from '../../core/GameCoreEnemy';
import type { GameCoreInventory } from '../../core/GameCoreInventory';
import { EInventoryType } from '../../core/GameCoreInventory';
import type { GameCoreHome } from '../../core/GameCoreHome';
import type { GameCorePlayer } from '../../core/GameCorePlayer';
import type { GameCoreWaveManager } from '../../core/GameCoreWaveManager';
import type { ResultsData } from './GameShell';
import { OriginalHud, type WaveIconState } from './OriginalHud';
import { OriginalScreens, type ScreensCallbacks } from './OriginalScreens';
import type { UiAssets } from './UiAssets';
import { UiRoot } from './UiDom';
import { t, type StringTable } from './UiText';
import {
  CLEAR_CALL_SECONDS, GAME_OVER_DELAY, STAGE_CLEAR_DELAY, START_CALL_SECONDS,
  WaveCallsUi, countdownDigit, waveClearCall, waveStartCall,
} from './WaveCalls';

export const TRACK_ARROW_SECONDS = 4; // Bubble_Enemy WaveTracker.displayTime
export const TRACK_TEXT_SECONDS = 5; // WaveTracker.textDisplayTime
export const BONUS_SHOW_SECONDS = 4; // bonusCoinShowDelay 2.5 + animationDelay 1.5 (+post 1.0)

export interface GameUiWorld {
  core: GameCore;
  waveManager: GameCoreWaveManager;
  home: GameCoreHome;
  player: GameCorePlayer;
  inventory: GameCoreInventory;
  waveCount: number;
}

export interface GameUiDeps {
  assets: UiAssets;
  strings(): StringTable;
  world(): GameUiWorld | null;
  project(pos: { x: number; y: number; z: number }, h: number): { x: number; y: number; visible: boolean };
  playSound(name: string): void;
  identity(): { area: string; stage: string; difficulty: string };
  screens: ScreensCallbacks;
  /** GameShell results hook: called when the delayed result screen should show. */
  showResults(d: ResultsData): void;
  /** Stage intro (src/view/intro): while true the intro sequence owns the first-wave "WAVE START" call and the 3-2-1
   *  (StageMain.MainSequence shows both itself; OnWaveActivate skips the call for wave 0 when m_showWaveStartCall==0). */
  introOwnsCalls?(): boolean;
}

export class GameUiFeature {
  readonly root = new UiRoot(15);
  readonly hud: OriginalHud;
  readonly calls: WaveCallsUi;
  readonly screens: OriginalScreens;
  private readonly initialActivate = new Map<number, number>();
  private waveBar: WaveBarModel | null = null;
  private trackWave = -1;
  private trackT = 0;
  private pendingBonus: { c0: number; t: number } | null = null;
  private bonusShow = 0;
  private bonusValue: number | null = null;
  private pendingResult: { t: number; data: ResultsData } | null = null;
  private lastCountdown = 0;

  constructor(private readonly deps: GameUiDeps) {
    const S = (k: string, f: string): string => t(deps.strings(), k, f);
    this.hud = new OriginalHud(
      deps.assets,
      { waveClear: S('tl_wave_call_22', 'Wave Cleared!'), incoming: S('tl_hud_005', 'Incoming!') },
      this.root,
    );
    this.calls = new WaveCallsUi(deps.assets, new UiRoot(18));
    this.screens = new OriginalScreens(deps.assets, S, deps.screens);
  }

  /** Stage teardown: detach HUD / wave-call / screen roots (incl. build ring + flyers children). */
  dispose(): void {
    this.root.detach();
    this.calls.dispose();
    this.screens.dispose();
  }

  attach(container: HTMLElement = document.body): void {
    this.hud.attach(container);
    this.calls.attach(container);
    this.screens.attach(container);
    this.screens.setIdentity(this.deps.identity());
  }

  private S = (k: string, f: string): string => t(this.deps.strings(), k, f);

  /** Subscribe to the real sim events. Call once at game start. */
  wireEvents(): void {
    Events.waveActivateEvent.addListener((m: GameCoreWaveManager, idx: number) => {
      const w = this.deps.world();
      if (w === null) return;
      // StageMain.OnWaveActivate: Show(waveIndex + 1, lastWave = count == index + 1).
      const last = w.waveCount === idx + 1;
      if (idx === 0 && this.deps.introOwnsCalls?.() === true) { this.trackWave = idx; this.trackT = TRACK_TEXT_SECONDS; return; }
      this.calls.setCountdown(0);
      this.calls.showCall(waveStartCall(this.S, idx + 1, last), START_CALL_SECONDS);
      this.trackWave = idx;
      this.trackT = TRACK_TEXT_SECONDS;
      void m;
    }, EventTime.Immediate);
    Events.waveEndedEvent.addListener((_m: GameCoreWaveManager, idx: number) => {
      this.waveBar?.onWaveCleared(idx); // WaveBarMonsterIcon.OnWaveCleared (rescales the next icon's appearDelay)
      const w = this.deps.world();
      if (w === null) return;
      if (idx + 1 !== w.waveCount) {
        this.calls.showCall(waveClearCall(this.S, idx + 1), CLEAR_CALL_SECONDS);
        this.pendingBonus = {
          c0: w.inventory.getAvailableInventory(w.player.handle, EInventoryType.Coin), t: 0,
        };
      }
    }, EventTime.Immediate);
  }

  /** Stage cleared: CLEAR call now, result screen after m_stageClearDelay. */
  onStageCleared(data: ResultsData): void {
    const id = this.deps.identity();
    this.calls.showStageClear(id.area, id.stage, this.S('tl_in_game_003', 'CLEAR'), id.difficulty, STAGE_CLEAR_DELAY);
    this.pendingResult = { t: STAGE_CLEAR_DELAY, data };
  }

  /** Game over: title now, menu after m_gameOverDelay. */
  onGameOver(data: ResultsData): void {
    this.calls.showCall({ title: this.S('tl_gameover_001', 'GAME OVER'), subtitle: '' }, GAME_OVER_DELAY);
    this.pendingResult = { t: GAME_OVER_DELAY, data };
  }

  update(dt: number): void {
    const w = this.deps.world();
    this.calls.update(dt);
    if (this.pendingResult !== null) {
      this.pendingResult.t -= dt;
      if (this.pendingResult.t <= 0) {
        const d = this.pendingResult.data;
        this.pendingResult = null;
        this.calls.clear();
        this.deps.showResults(d);
      }
    }
    if (w === null) return;
    const wm = w.waveManager;
    const coins = w.inventory.getAvailableInventory(w.player.handle, EInventoryType.Coin);
    const gems = w.inventory.getAvailableInventory(w.player.handle, EInventoryType.Gem);

    // wave-clear bonus plank (delta after the wave-end credit lands)
    if (this.pendingBonus !== null) {
      this.pendingBonus.t += dt;
      if (this.pendingBonus.t > 0.25) {
        const delta = coins - this.pendingBonus.c0;
        if (delta > 0) { this.bonusValue = delta; this.bonusShow = BONUS_SHOW_SECONDS; }
        this.pendingBonus = null;
      }
    }
    if (this.bonusShow > 0) {
      this.bonusShow -= dt;
      if (this.bonusShow <= 0) this.bonusValue = null;
    }

    // wave bar icons (Q4.WaveBarMonsterIcon per waveProgressList entry) driven by the original logic (WaveBarModel)
    const prog = wm.waveProgressList;
    if (this.waveBar === null || this.waveBar.count !== prog.length) {
      this.waveBar = new WaveBarModel({
        timeUntil: (i) => wm.getTimeUntilWaveActivates(i),
        spawnStartDelay: (i) => prog[i]?.remainingSpawnStartDelay ?? 0,
      }, prog.length);
    }
    this.waveBar.update(dt);
    const waves: WaveIconState[] = prog.map((p, i) => {
      if (!p.started && !this.initialActivate.has(i)) this.initialActivate.set(i, Math.max(0.001, p.remainingWaveActivateDelay));
      const init = this.initialActivate.get(i) ?? 1;
      const arrived = p.started && p.activated;
      const boss = p.spawnerProgress.some((sp) => (sp.spawnData?.enemyObject?.name ?? '').startsWith('boss'));
      // WaveBarMonsterIcon.Init: icon = m_waveBarSprite of GetEnemyPrefabForWave(i) (the first spawner's enemy).
      const first = wm.getEnemyPrefabForWave(i);
      const def = first !== null ? ENEMY_WAVE_BAR[(first as { name?: string }).name ?? ''] : undefined;
      return {
        sprite: def?.sprite ?? null,
        balloon: def?.balloon ?? false,
        started: p.started,
        arrived,
        progress: p.started ? 1 - Math.min(1, p.remainingWaveActivateDelay / init) : 0,
        boss,
      };
    });
    this.hud.update({
      coins, gems,
      chibisSaved: w.home.numChibi, chibisTotal: w.home.numStartingChibi,
      wave: Math.min(wm.currentWaveIndex + 1, w.waveCount),
      waves, bonus: this.bonusValue,
      waveBar: { icons: this.waveBar.iconViews(), bars: this.waveBar.barViews() },
    }, dt);

    // 3-2-1 countdown (StartCountdownController) before the first wave activates
    let digit = 0;
    const introCalls = this.deps.introOwnsCalls?.() === true; // intro sequence drives the digits itself
    if (!introCalls && wm.introSequenceFinished && wm.currentWaveIndex === 0 && prog.length > 0 && !(prog[0].started && prog[0].activated)) {
      const sd = (wm as unknown as { stageStartDelay?: number }).stageStartDelay ?? 0;
      const remaining = Math.max(0, sd) + prog[0].remainingSpawnStartDelay + prog[0].remainingWaveActivateDelay;
      digit = countdownDigit(remaining);
    }
    if (!introCalls && digit !== this.lastCountdown) {
      this.calls.setCountdown(digit);
      if (digit > 0) this.deps.playSound(digit === 1 ? 'sfx/sfx_stage_firstwave' : 'sfx/sfx_ringmenu_select');
      this.lastCountdown = digit;
    }

    this.updateTracker(w, dt);
  }

  /** Q4.UI.WaveTracker: bubble + edge-clamped arrow on the wave's lead enemy. */
  private updateTracker(w: GameUiWorld, dt: number): void {
    if (this.trackWave < 0 || this.trackT <= 0) { this.hud.setAlert(null); return; }
    this.trackT -= dt;
    let lead: GameCoreEnemy | null = null;
    let bestD = -Infinity;
    for (const e of w.core.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
      if (e.waveIndex !== this.trackWave || e.life <= 0) continue;
      const dist = (e as unknown as { distance?: number }).distance ?? 0;
      if (dist > bestD) { bestD = dist; lead = e; }
    }
    if (lead === null) { this.hud.setAlert(null); return; }
    const s = this.deps.project(lead.position, 1.2);
    const r = this.root.toRef(s.x, s.y);
    const inside = s.visible && r.x > 80 && r.x < 1840 && r.y > 80 && r.y < 1000;
    const arrowOn = this.trackT > TRACK_TEXT_SECONDS - TRACK_ARROW_SECONDS;
    if (inside) {
      // on screen: bubble hovers above the enemy until the arrow time is over
      if (!arrowOn) { this.hud.setAlert(null); return; }
      this.hud.setAlert({ x: r.x, y: Math.max(110, r.y - 150), angle: 180, showText: true });
      return;
    }
    const cx = 960;
    const cy = 540;
    let dx = r.x - cx;
    let dy = r.y - cy;
    if (!s.visible) { dx = -dx; dy = -dy; }
    const k = Math.min(Math.abs((960 - 130) / (dx || 1e-6)), Math.abs((540 - 130) / (dy || 1e-6)));
    const x = cx + dx * k;
    const y = cy + dy * k;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    this.hud.setAlert({ x, y, angle, showText: true });
  }
}
