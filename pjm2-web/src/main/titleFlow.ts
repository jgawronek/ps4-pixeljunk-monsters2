// src/main/titleFlow.ts
// Orchestrates title -> (options | credits) -> stageSelect on top of src/main/flow.ts:
// owns the three view features, their pure models, menu input (keyboard/gamepad/pointer), the
// audio hooks and the option persistence/apply. game.ts only constructs it and calls start().
//
// Hand-off to the rest of the game: Play ends with flow.go('stageSelect', { from: 'title' }).

import type { AudioManager } from '../view/audio/AudioManager';
import type { SaveData } from '../view/save/SaveData';
import { CREDIT_PAGES, CreditsModel } from '../view/ui/CreditsModel';
import { CreditsFeature, parseCreditPages } from '../view/ui/CreditsFeature';
import { MenuInput, type MenuAction } from '../view/ui/MenuInput';
import { OptionsMenuFeature } from '../view/ui/OptionsMenuFeature';
import { OptionsModel, type OptionValues } from '../view/ui/OptionsModel';
import { TitleFeature } from '../view/ui/TitleFeature';
import { TITLE_ENTRIES, TitleModel } from '../view/ui/TitleModel';
import { CREDITS_BGM, SFX_FOR, TITLE_BGM, drawDialog } from '../view/ui/TitleUiKit';
import type { UiAssets } from '../view/ui/UiAssets';
import { css, UiRoot } from '../view/ui/UiDom';
import type { StringLookup } from '../view/ui/WaveCalls';
import type { Flow } from './flow';
import { applyAudioPrefs, applyPreferences } from './preferences';

export interface TitleHostDeps {
  assets: UiAssets;
  t: StringLookup;
  /** title-ui.json (tools/assets/extract_title_ui.py). */
  titleUi: { credits: Parameters<typeof parseCreditPages>[0] };
  save: SaveData | null;
  flow: Flow;
  /** Create (once) + unlock the shared AudioManager. MUST be called from a user-gesture handler. */
  ensureAudio: () => AudioManager | null;
  audio: () => AudioManager | null;
  audioRunning: () => boolean;
  /** Solid sky backdrop (UI lab / no 3D scene behind). */
  solidBackdrop?: boolean;
  /** Tests/UI lab: no rAF loop; drive with step(dt). */
  manual?: boolean;
}

export class TitleHost {
  private readonly titleModel: TitleModel;
  private readonly title: TitleFeature;
  private options: OptionsMenuFeature | null = null;
  private credits: CreditsFeature | null = null;
  private creditsModel: CreditsModel | null = null;
  private readonly input: MenuInput;
  private readonly overlay: HTMLDivElement;
  private readonly overlayRoot: UiRoot;
  private guideDialog: 'ask' | 'info' | null = null;
  private raf = 0;
  private last = 0;
  private running = false;
  private backdrop: HTMLDivElement | null = null;
  private pendingGuideYes = true;

  constructor(private readonly d: TitleHostDeps) {
    this.titleModel = new TitleModel({ needsGesture: !d.audioRunning() });
    this.title = new TitleFeature(d.assets, d.t, this.titleModel, {
      onPointerAny: () => this.onAny(),
      onClickEntry: (i) => { this.titleModel.hover(i); this.onTitleAction('confirm'); this.flush(); },
      onHoverEntry: (i) => { this.titleModel.hover(i); this.flush(); },
    });
    this.overlayRoot = new UiRoot(26);
    this.overlay = document.createElement('div');
    css(this.overlay, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', display: 'none', pointerEvents: 'auto', background: 'rgba(0,0,0,0.35)' });
    this.overlayRoot.el.appendChild(this.overlay);
    this.input = new MenuInput({ action: (a) => this.onAction(a), any: () => this.onAny() });
    d.flow.onEnter('title', (_c, prev) => this.enterTitle(prev));
    d.flow.onEnter('options', () => this.enterOptions());
    d.flow.onEnter('credits', () => this.enterCredits());
    d.flow.onLeave('title', (_c, next) => { if (next !== 'options' && next !== 'credits') this.leaveTitleForGame(); });
  }

  /** Call once the critical assets are loaded: boot -> title. */
  start(): void {
    const { flow, save } = this.d;
    // Restore persisted preferences before anything plays.
    if (save !== null) applyPreferences(this.d.audio(), save.preferences);
    if (this.d.solidBackdrop === true) {
      this.backdrop = document.createElement('div');
      css(this.backdrop, { position: 'fixed', inset: '0', background: 'linear-gradient(#69c6f2 0%, #a6e0f7 55%, #7bc24a 56%, #5fa534 100%)', zIndex: '19' });
      document.body.appendChild(this.backdrop);
    }
    if (this.titleModel.phase !== 'gate') this.d.ensureAudio(); // user already interacted: audio can start now
    this.title.attach();
    this.overlayRoot.attach();
    this.input.attach();
    flow.go('title');
    this.running = true;
    if (this.d.manual === true) return;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Manual clock (lab/tests). */
  step(dt: number): void {
    this.tick(dt);
  }

  /** Read-only access for the lab/probes. */
  get models(): { title: TitleModel; options: OptionsModel | null; credits: CreditsModel | null } {
    return { title: this.titleModel, options: this.options?.model ?? null, credits: this.creditsModel };
  }

  /** Synthetic input (lab/probes). */
  press(a: MenuAction): void {
    this.onAction(a);
  }

  pressAny(): void {
    this.onAny();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.title.dispose();
    this.options?.root.el.remove();
    this.credits?.root.el.remove();
    this.overlayRoot.el.remove();
    this.backdrop?.remove();
  }

  // ------------------------------------------------------------------ frame

  private tick(dt: number): void {
    this.input.poll();
    const fl = this.d.flow.state;
    if (fl === 'title') {
      this.titleModel.update(dt);
      if (this.titleModel.phase === 'pressStart' || this.titleModel.phase === 'menu') this.titleBgm();
      this.title.update(dt);
      this.flush();
    } else if (fl === 'credits' && this.creditsModel !== null) {
      this.creditsModel.update(dt);
      this.credits?.render();
      if (this.creditsModel.done) this.exitCredits();
    }
  }

  private bgmStarted = false;

  private titleBgm(): void {
    if (this.bgmStarted) return;
    this.bgmStarted = true;
    void this.d.audio()?.playBgm(TITLE_BGM);
  }

  private sfx(name: string): void {
    const clip = SFX_FOR[name];
    if (clip !== undefined) void this.d.audio()?.play(clip);
  }

  /** Drain model events into audio + flow. */
  private flush(): void {
    for (const e of this.titleModel.drain()) {
      if (e.type === 'sfx') this.sfx(e.name);
      else this.onTitleResult(e.action);
    }
  }

  // ------------------------------------------------------------------ input routing

  private onAny(): void {
    if (this.d.flow.state !== 'title') return;
    if (this.titleModel.phase === 'gate') this.d.ensureAudio(); // gesture: create + unlock WebAudio
    this.titleModel.press();
    this.flush();
  }

  private onTitleAction(a: MenuAction): void {
    const m = this.titleModel;
    if (this.guideDialog !== null) return;
    if (a === 'up') m.move(-1);
    else if (a === 'down') m.move(1);
    else if (a === 'confirm') m.confirm();
  }

  private onAction(a: MenuAction): void {
    const fl = this.d.flow.state;
    if (fl === 'title') {
      if (this.guideDialog !== null) {
        if (a === 'left') { this.pendingGuideYes = true; this.drawGuide(); }
        else if (a === 'right') { this.pendingGuideYes = false; this.drawGuide(); }
        else if (a === 'confirm') this.answerGuide(this.pendingGuideYes);
        else if (a === 'cancel') this.answerGuide(false);
        return;
      }
      this.onTitleAction(a);
      this.flush();
    } else if (fl === 'options' && this.options !== null) {
      const m = this.options.model;
      if (this.options.controlsVisible) { if (a === 'confirm' || a === 'cancel') { this.options.setControlsOpen(false); } return; }
      if (a === 'up') m.moveRow(-1);
      else if (a === 'down') m.moveRow(1);
      else if (a === 'left') m.adjust(-1);
      else if (a === 'right') m.adjust(1);
      else if (a === 'confirm') m.confirm();
      else if (a === 'cancel') m.cancel();
      else if (a === 'reset') m.requestReset();
      this.afterOptionsInput();
    } else if (fl === 'credits' && this.creditsModel !== null) {
      if (a === 'confirm' || a === 'right' || a === 'down') this.creditsModel.skip();
      else if (a === 'cancel') this.creditsModel.cancel();
    }
  }

  // ------------------------------------------------------------------ title

  private enterTitle(prev: string): void {
    this.title.setVisible(true);
    if (prev === 'options' || prev === 'credits') this.titleModel.returnFromSubScreen();
    this.options?.hide();
    this.credits?.setVisible(false);
  }

  private leaveTitleForGame(): void {
    this.title.setVisible(false);
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.backdrop?.remove();
  }

  private onTitleResult(action: (typeof TITLE_ENTRIES)[number]['id']): void {
    const { flow, save } = this.d;
    if (action === 'options') flow.go('options', { from: 'title' });
    else if (action === 'credits') flow.go('credits', { from: 'title' });
    else {
      // Q4.TitleScreenController.OnPlayHideComplete @005438a0: first Play -> manual prompt.
      if (save !== null && !save.preferences.hasSeenFirstPlayGuidePrompt) {
        save.setPreferences({ hasSeenFirstPlayGuidePrompt: true });
        this.guideDialog = 'ask';
        this.pendingGuideYes = true;
        this.drawGuide();
      } else flow.go('stageSelect', { from: 'title' });
    }
  }

  private drawGuide(): void {
    const o = this.overlay;
    o.textContent = '';
    o.style.display = 'block';
    const t = this.d.t;
    if (this.guideDialog === 'ask') {
      drawDialog(this.d.assets, t, o, { text: t('tl_dialog_text_036', 'Do you wish to take a look at the manual?'), kind: 'yesno', yes: this.pendingGuideYes },
        (y) => this.answerGuide(y), (y) => { this.pendingGuideYes = y; this.drawGuide(); });
    } else {
      drawDialog(this.d.assets, t, o, { text: t('tl_dialog_text_038', 'You can view the manual at any time\nfrom the Pause menu!'), kind: 'ok' }, () => this.answerGuide(true));
    }
  }

  /** OnReadSimplePlayGuide: Yes -> the guide (port: pause-menu How To Play panel; no separate manual),
   *  No -> tl_dialog_text_038 info dialog -> continue. */
  private answerGuide(yes: boolean): void {
    this.sfx('confirm');
    if (this.guideDialog === 'ask' && !yes) {
      this.guideDialog = 'info';
      this.drawGuide();
      return;
    }
    this.guideDialog = null;
    this.overlay.style.display = 'none';
    this.d.flow.go('stageSelect', { from: 'title' });
  }

  // ------------------------------------------------------------------ options

  private enterOptions(): void {
    const { assets, t, save } = this.d;
    const p = save?.preferences;
    const vals: OptionValues = {
      bgVolume: p?.bgVolume ?? 1, seVolume: p?.seVolume ?? 1, invertY: p?.invertY ?? false,
      show2PJoinLabel: p?.show2PJoinLabel ?? true, showActionIcon: p?.showActionIcon ?? true,
    };
    const model = new OptionsModel(vals, () => save?.hasNonDefaultPreferences() ?? false);
    this.options?.root.el.remove();
    this.options = new OptionsMenuFeature(assets, t, model);
    this.options.attach();
    this.options.show();
    this.wireOptionHooks();
  }

  private wireOptionHooks(): void {
    const o = this.options!;
    const m = o.model;
    o.draw({
      hover: (i) => { m.setRow(i); this.afterOptionsInput(); },
      click: (i) => {
        if (o.controlsVisible) { o.setControlsOpen(false); return; }
        m.setRow(i); m.confirm(); this.afterOptionsInput();
      },
      arrow: (i, d) => { m.setRow(i); m.adjust(d); this.afterOptionsInput(); },
      answer: (y) => { m.answer(y); this.afterOptionsInput(); },
      focus: (y) => { if (m.dialog !== null) { m.dialog.yes = y; this.afterOptionsInput(); } },
    });
  }

  private afterOptionsInput(): void {
    const o = this.options;
    if (o === null) return;
    const { save } = this.d;
    for (const e of o.model.drain()) {
      switch (e.type) {
        case 'sfx': this.sfx(e.name); break;
        case 'audioLevels': applyAudioPrefs(this.d.audio(), { bgVolume: e.bg, seVolume: e.se }); break;
        case 'apply':
          save?.setPreferences({ ...e.values });
          applyPreferences(this.d.audio(), save?.preferences ?? { ...e.values, muted: false, hasSeenFirstPlayGuidePrompt: true });
          break;
        case 'reset':
          save?.resetPreferences();
          applyPreferences(this.d.audio(), save?.preferences ?? { ...e.values, muted: false, hasSeenFirstPlayGuidePrompt: true });
          break;
        case 'controls': o.setControlsOpen(true); return;
        case 'close': o.hide(); this.d.flow.go('title', { from: 'options' }); return;
      }
    }
    o.draw();
  }

  // ------------------------------------------------------------------ credits

  private enterCredits(): void {
    const { assets, t } = this.d;
    this.creditsModel = new CreditsModel();
    this.credits?.root.el.remove();
    const pages = parseCreditPages(this.d.titleUi.credits);
    this.credits = new CreditsFeature(assets, t, pages.slice(0, CREDIT_PAGES), this.creditsModel);
    this.credits.attach();
    this.credits.onPointer(() => this.creditsModel?.skip());
    this.credits.setVisible(true);
    this.title.setVisible(false);
    void this.d.audio()?.playBgm(CREDITS_BGM, 0.8); // StaffCreditsController.Show: PlayBGMusic(bgmCreditsScreen)
    this.credits.render();
  }

  private exitCredits(): void {
    this.sfx('cancel');
    this.bgmStarted = false; // DismissScreen: PlayBGMusic(m_LastBGM) -> back to the title music
    void this.d.audio()?.playBgm(TITLE_BGM);
    this.bgmStarted = true;
    this.creditsModel = null;
    this.credits?.setVisible(false);
    this.d.flow.go('title', { from: 'credits' });
  }
}
