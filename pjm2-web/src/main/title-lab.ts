// UI-lab scenes for the title / options / credits screens (no WebGL, no sim).
// URL: /ui-lab.html?scene=title-gate|title-intro|title-press|title-menu|options|options-dialog|options-controls|credits-1..7|guide
import { createFlow } from './flow';
import { TitleHost } from './titleFlow';
import { SaveData } from '../view/save/SaveData';
import type { UiAssets } from '../view/ui/UiAssets';
import type { StringLookup } from '../view/ui/WaveCalls';

export async function mountTitleScene(scene: string, assets: UiAssets, T: StringLookup): Promise<boolean> {
  if (!/^(title|options|credits|guide)/.test(scene)) return false;
  const titleUi = (await (await fetch('/assets/ui/title-ui.json')).json()) as { credits: never };
  const flow = createFlow();
  const store = new Map<string, string>();
  const save = new SaveData({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } });
  const host = new TitleHost({
    assets, t: T, titleUi, save, flow, manual: true, solidBackdrop: new URLSearchParams(location.search).get('bg') === null,
    ensureAudio: () => null, audio: () => null, audioRunning: () => scene !== 'title-gate',
  });
  host.start();
  const m = host.models.title;
  const adv = (s: number): void => { for (let i = 0; i < Math.ceil(s / 0.05); i++) host.step(0.05); };
  if (scene === 'title-gate') adv(0.2);
  else if (scene === 'title-intro') adv(1.5);
  else if (scene === 'title-press') adv(3.2);
  else {
    adv(0.1); host.pressAny(); adv(2.6 + 1.3); // intro, press, startOut
    if (scene === 'title-menu') { /* menu */ }
    if (scene.startsWith('options')) {
      host.press('down'); host.press('confirm'); adv(0.8); // -> Options
      if (scene === 'options' || scene === 'options-dialog') { host.press('down'); host.press('left'); host.press('left'); host.press('down'); host.press('left'); }
      if (scene === 'options-dialog') host.press('cancel');
      if (scene === 'options-controls') host.press('confirm');
    }
    if (scene.startsWith('credits')) {
      host.press('up'); host.press('confirm'); adv(0.8);
      const n = Number(scene.split('-')[1] ?? 1);
      for (let i = 1; i < n; i++) host.press('confirm');
      adv(2);
    }
    if (scene === 'guide') { host.press('confirm'); adv(0.8); }
  }
  void m;
  return true;
}
