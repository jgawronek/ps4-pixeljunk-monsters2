// src/view/ui/CreditsFeature.ts
// Staff credits view (prefab credits_01 = Q4.StaffCreditsController): 7 static pages
// (Screen_01_President ... Screen_07_etc) whose text positions come straight from the prefab
// (tools/assets/extract_title_ui.py -> title-ui.json `credits`), shown one at a time under the
// timeline of CreditsModel. LocText: Font_01; titles (0.145,0.733,1.0), names (0.878). Alignment
// 4 = centre (all credit rows are centred on their prefab x).

import type { UiAssets } from './UiAssets';
import { css, TEXT, UiRoot } from './UiDom';
import { bgWash, f1 } from './TitleUiKit';
import type { CreditsModel } from './CreditsModel';
import type { StringLookup } from './WaveCalls';

export interface CreditItem {
  label: string;
  x: number;
  y: number;
  /** TextAnchor: 3 left, 4 centre, 5 right */
  align: number;
  color: [number, number, number];
}

export interface CreditPage {
  name: string;
  items: CreditItem[];
}

interface PrefabNode {
  name: string;
  ap?: [number, number];
  comps?: Array<{ script: string; label?: string; align?: number; color?: [number, number, number] }>;
  children: PrefabNode[];
}

/** credits_01 prefab tree -> pages (pure; used by tests). Screen_NN children hold Mess_<label> nodes. */
export function parseCreditPages(prefab: PrefabNode): CreditPage[] {
  const screen = prefab.children.find((c) => c.name === 'Screen_Loc');
  if (screen === undefined) return [];
  return screen.children
    .filter((c) => /^Screen_\d+/.test(c.name))
    .map((pg) => ({
      name: pg.name,
      items: pg.children.flatMap((n) => {
        const lt = n.comps?.find((c) => c.script === 'LocText');
        if (lt === undefined || n.ap === undefined || lt.label === undefined) return [];
        return [{ label: lt.label, x: n.ap[0], y: -n.ap[1], align: lt.align ?? 4, color: lt.color ?? [0.88, 0.88, 0.88] }];
      }),
    }));
}

const hex = (c: [number, number, number]): string =>
  `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

export class CreditsFeature {
  readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  private readonly pageEls: HTMLDivElement[] = [];

  constructor(
    private readonly assets: UiAssets,
    private readonly t: StringLookup,
    private readonly pages: CreditPage[],
    private readonly model: CreditsModel,
    root?: UiRoot,
  ) {
    this.root = root ?? new UiRoot(23);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'auto', overflow: 'hidden' });
    this.layer.appendChild(bgWash());
    for (const pg of pages) {
      const d = document.createElement('div');
      css(d, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', opacity: '0', pointerEvents: 'none' });
      for (const it of pg.items) {
        const text = this.t(it.label, '');
        if (text === '') continue;
        const isTitle = it.label.startsWith('tl_credit_title');
        d.appendChild(f1(this.assets, text, it.x, it.y, {
          align: it.align === 3 ? 'left' : it.align === 5 ? 'right' : 'center',
          tint: isTitle ? hex(it.color) : TEXT.body.tint,
          scale: isTitle ? 0.8 : 1,
        }));
      }
      this.pageEls.push(d);
      this.layer.appendChild(d);
    }
    this.root.el.appendChild(this.layer);
    this.root.el.style.display = 'none';
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  setVisible(v: boolean): void {
    this.root.el.style.display = v ? 'block' : 'none';
  }

  onPointer(fn: () => void): void {
    this.layer.addEventListener('pointerdown', fn);
  }

  render(): void {
    this.pageEls.forEach((d, i) => {
      d.style.opacity = i === this.model.page ? String(this.model.alpha) : '0';
    });
  }
}
