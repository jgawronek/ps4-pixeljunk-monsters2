// src/main/stageSelectFeature.ts
// Glue between the shared flow state machine (src/main/flow.ts), the stage-select screen and the save layer.
// Owns the `stageSelect` state (flow.claim) and the picks that lead to `stageLoading`.
//
//   flow.onEnter('stageSelect')  -> screen.show()
//   pick                         -> flow.go('stageLoading', { stageId: scene, stage: N, difficulty })
//                                   then `launchStage` (default: full navigation to game.html?stage=N&notitle&diff=D --
//                                   game.ts boots ONE stage per page load; see docs/STAGE_SELECT_AND_MULTISTAGE.md)
//   back                         -> flow.go('title') when the title feature exists (from === 'title'), else onExit()
//
// URL helpers are pure (tested): gameUrl / stageSelectUrl.

import type { PickResult } from '../view/ui/StageSelectModel';
import { StageSelectScreen } from '../view/ui/StageSelectScreen';
import type { SaveData } from '../view/save/SaveData';
import type { UiAssets } from '../view/ui/UiAssets';
import type { StringLookup } from '../view/ui/WaveCalls';
import { flow as sharedFlow, type Flow } from './flow';

import { gameUrl } from './stageUrls';
export { difficultyFromSearch, gameUrl, stageSelectUrl } from './stageUrls';

export interface StageSelectFeatureDeps {
  assets: UiAssets;
  t: StringLookup;
  save: SaveData;
  flow?: Flow;
  launchStage?: (stage: number, difficulty: number) => void;
  onExit?: () => void;
  onSfx?: (name: 'select' | 'confirm' | 'denied' | 'cancel') => void;
}

export class StageSelectFeature {
  readonly screen: StageSelectScreen;
  private readonly flow: Flow;
  private readonly release: () => void;
  private readonly offEnter: () => void;
  private readonly offLeave: () => void;

  constructor(private readonly d: StageSelectFeatureDeps) {
    this.flow = d.flow ?? sharedFlow;
    this.screen = new StageSelectScreen(d.assets, d.t, d.save, {
      onPick: (r) => this.pick(r),
      onBack: () => this.back(),
      onSfx: d.onSfx,
    });
    this.release = this.flow.claim('stageSelect');
    this.offEnter = this.flow.onEnter('stageSelect', () => this.screen.show());
    this.offLeave = this.flow.onLeave('stageSelect', () => this.screen.hide());
  }

  attach(container: HTMLElement = document.body): void {
    this.screen.attach(container);
  }

  private pick(r: PickResult): void {
    if (!r.ok) return;
    this.d.save.setLastPlayStageName(r.stage.scene);
    const launch = this.d.launchStage ?? ((s, diff) => { window.location.assign(gameUrl(s, diff)); });
    // flow.go leaves stageSelect (screen hides); the launcher then loads the stage.
    this.flow.go('stageLoading', { stageId: r.stage.scene, stage: r.stage.stage, difficulty: r.difficulty });
    launch(r.stage.stage, r.difficulty);
  }

  private back(): void {
    if (this.flow.ctx.from === 'title' && this.flow.go('title', { from: 'stageSelect' })) return;
    this.d.onExit?.();
  }

  dispose(): void {
    this.release();
    this.offEnter();
    this.offLeave();
    this.screen.dispose();
  }
}
