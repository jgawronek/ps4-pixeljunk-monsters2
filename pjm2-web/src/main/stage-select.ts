// Standalone stage-select page (stage-select.html): lightweight (no WebGL, no sim) entry that owns the
// flow `stageSelect` state and launches game.html?stage=N. Also the target of the result screen's
// "Stage Select" entry (StageResultMenuController.OnConfirm -> WorldMap.LoadWorldMap).
import { createBrowserSaveData } from '../view/save/SaveData';
import { loadUiAssets } from '../view/ui/UiAssets';
import { loadStrings, t } from '../view/ui/UiText';
import { flow } from './flow';
import { StageSelectFeature } from './stageSelectFeature';

async function main(): Promise<void> {
  const [assets, strings] = await Promise.all([loadUiAssets('/assets/ui/'), loadStrings('/assets/ui/')]);
  const save = createBrowserSaveData();
  const feature = new StageSelectFeature({
    assets, save, t: (k, f) => t(strings, k, f),
    onExit: () => { window.location.assign('/game.html?stage=1&notitle'); },
  });
  feature.attach(document.body);
  flow.go('stageSelect', { from: new URLSearchParams(location.search).get('from') === 'title' ? 'title' : 'boot' });
  (window as unknown as { __stageSelect: unknown }).__stageSelect = { feature, flow, save };
}

main().catch((err) => { console.error('stage-select failed:', err); });
