// UI lab: renders the original-art UI (HUD, wave calls, build ring, pause/result
// screens) over a static backdrop with mock data — no WebGL, no sim. Used for
// pixel comparison against the reference screenshots and as a dev playground.
// URL: /ui-lab.html?scene=hud|start|countdown|clear|ring-cat|ring-icon|ring-poor|pause|results|gameover&bg=/ref.png

import { BuildMenuModel, type BuildTowerEntry } from '../view/ui/BuildMenuModel';
import { BuildMenuUi } from '../view/ui/BuildMenuUi';
import { buildRingView } from '../view/ui/BuildMenuFeature';
import { OriginalHud } from '../view/ui/OriginalHud';
import { OriginalScreens } from '../view/ui/OriginalScreens';
import { StageSelectScreen } from '../view/ui/StageSelectScreen';
import { SaveData } from '../view/save/SaveData';
import { applyStageClear } from '../view/save/StageProgress';
import { loadUiAssets } from '../view/ui/UiAssets';
import { UiRoot } from '../view/ui/UiDom';
import { loadStrings, t } from '../view/ui/UiText';
import { START_CALL_SECONDS, WaveCallsUi, waveStartCall } from '../view/ui/WaveCalls';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'hud';
const bg = q.get('bg');
if (bg) document.getElementById('bg')!.style.backgroundImage = `url(${bg})`;

async function main(): Promise<void> {
  const [assets, S, defs] = await Promise.all([
    loadUiAssets('/assets/ui/'),
    loadStrings('/assets/ui/'),
    fetch('/assets/data/towers.json').then((r) => r.json()) as Promise<Record<string, unknown>[]>,
  ]);
  console.log('lab: assets loaded');
  const T = (k: string, f: string): string => t(S, k, f);
  const root = new UiRoot(15);
  root.attach(document.body);
  if (await (await import('./title-lab')).mountTitleScene(scene, assets, T)) {
    (window as unknown as { __labReady: boolean }).__labReady = true;
    return;
  }

  if (scene === 'hud' || scene === 'start' || scene === 'countdown') {
    const hud = new OriginalHud(assets, { waveClear: T('tl_wave_call_22', 'Wave Cleared!'), incoming: T('tl_hud_005', 'Incoming!') }, root);
    hud.attach(document.body);
    const waves = Array.from({ length: 10 }, (_, i) => ({ started: i < 3, arrived: i < 1, progress: i === 1 ? 0.55 : i === 2 ? 0.15 : 0, boss: i === 9 }));
    hud.update({ coins: 450, gems: 3, chibisSaved: 18, chibisTotal: 20, wave: 2, waves, bonus: scene === 'hud' ? 83 : null }, 1);
    if (scene === 'hud') hud.setAlert({ x: 1700, y: 400, angle: 70, showText: true });
  }
  if (scene === 'start' || scene === 'countdown' || scene === 'clear') {
    console.log('lab: calls');
    const calls = new WaveCallsUi(assets, new UiRoot(18));
    calls.attach(document.body);
    if (scene === 'start') { calls.showCall(waveStartCall(T, 1, false), START_CALL_SECONDS); calls.update(1.5); }
    if (scene === 'countdown') calls.setCountdown(1);
    if (scene === 'clear') {
      calls.showStageClear(T('tl_area_001', 'Pockulu Forest'), T('tl_stage_001', 'STAGE 1'), T('tl_in_game_003', 'CLEAR'), T('tl_difficulty_002', 'Tricky'), 5);
      calls.update(1.5);
    }
  }
  if (scene.startsWith('ring')) {
    const entries = new Map<number, BuildTowerEntry>();
    for (const d of defs) {
      const name = String(d.__gameObject);
      const id = +name.slice(-3);
      if ((d.dlcLock as number) !== 0) continue;
      entries.set(id, { id, name, costCoin: d.costCoin as number, costGem: d.costGem as number, locked: false, singleton: d.singletonInScene === 1 });
    }
    const poor = scene === 'ring-poor';
    const m = new BuildMenuModel({ tower: (id) => entries.get(id) ?? null, coins: () => (poor ? 130 : 450), gems: () => (poor ? 1 : 3), singletonBuilt: () => false });
    m.open();
    if (scene !== 'ring-cat') { m.cursor(-1, 0); m.confirm(); m.hoverSlot(poor ? 6 : 7); }
    const ui = new BuildMenuUi(assets, root.el);
    ui.render(buildRingView(m, assets, S, 960, 560, 0));
  }
  if (scene === 'pause' || scene === 'results' || scene === 'gameover') {
    const sc = new OriginalScreens(assets, T, { onResume: () => undefined, onRetry: () => undefined, onToggleMute: () => false }, new UiRoot(24));
    sc.attach(document.body);
    sc.setIdentity({ area: T('tl_area_001', 'Pockulu Forest'), stage: T('tl_stage_001', 'STAGE 1'), difficulty: T('tl_difficulty_002', 'Tricky') });
    if (scene === 'pause') sc.showPause();
    else sc.showResults({
      won: scene === 'results', perfect: true, wavesCleared: 10, totalWaves: 10, kills: 120, coinsEarned: 356, gemsEarned: 20, chibisSaved: 20, chibisTotal: 20, timeSeconds: 600,
      score: scene === 'results' ? { score: 17630, bestScore: 17630, interestCoins: 40, clearBonus: 10000, newRecord: true } : undefined,
    });
  }
  if (scene === 'stageselect') {
    const save = new SaveData(null);
    applyStageClear(save, '3d_stage_001', 0, 17630, true);
    applyStageClear(save, '3d_stage_001', 1, 21000, false);
    applyStageClear(save, '3d_stage_002', 0, 9000, false);
    const ss = new StageSelectScreen(assets, T, save, { onPick: (r) => console.log('pick', r.stage.stage, r.difficulty), onBack: () => undefined }, new UiRoot(22), 2);
    ss.attach(document.body);
    ss.show();
  }
  (window as unknown as { __labReady: boolean }).__labReady = true;
}
main().catch((e) => { console.error("LAB-ERROR", e?.stack ?? e); (window as unknown as { __labReady: boolean }).__labReady = true; });
