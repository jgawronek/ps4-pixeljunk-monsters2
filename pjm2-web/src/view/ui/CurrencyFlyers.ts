// src/view/ui/CurrencyFlyers.ts
// Port of Q4.UI.CurrencyFlyer (@0x478D40..0x479370): the gem icon that flies from the
// collected pickup to the HUD gem counter. The credit itself is NOT tied to the animation
// (m_destinationThreshold serialized 5000 -> AddInventoryCommand fires on the first update,
// see PickupDrops.ts); this layer is the cosmetic flight only.
//
// Motion (raw-verified in @0x478F70 UpdatePosition; the thunk @0x178 is cos, not sin — it is
// the only reading under which the path ends ON the destination for both branches):
//   total = Random.Range(m_moveTimeMin 0.8, m_moveTimeMax 1.2)   (FlyToDestinationWithValue)
//   p     = 1 - remaining/total ;  c = cos(p * pi/2) ;  q = p^3 ;  (dx,dy) = dest - start
//   flag  = Random.Range(0,2) % 2 == 1
//   pos   = start + (flag ? (dx*(1-c), dy*q) : (dx*q, dy*(1-c)))
// then Animator trigger OnHit and the element deactivates 1.0 s later (OnHitFinish).
// Sprite: prefab Gem_Icon_GRP / Image = icon_result_jem. Pool: HUDPool, initialPoolSize 5.
//
// TS ADAPTATION: UnityEngine.Random -> deterministic hash of a counter (view-only, cosmetic).

import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, type UiRoot } from './UiDom';

const MOVE_TIME_MIN = 0.8; // CurrencyFlyer.m_moveTimeMin (serialized)
const MOVE_TIME_MAX = 1.2; // CurrencyFlyer.m_moveTimeMax
const HIT_FINISH_DELAY = 1.0; // Invoke("OnHitFinish", 1.0)
const FLYER_SPRITE = 'icon_result_jem';

export interface FlyerState {
  /** remaining move time (counts to 0). */
  remaining: number;
  total: number;
  flag: boolean;
  start: { x: number; y: number };
  delta: { x: number; y: number };
  /** time since arrival (<0 while in flight). */
  hitAge: number;
}

/** Pure flight position (reference px) for a flyer state — unit-tested. */
export function flyerPosition(s: Pick<FlyerState, 'remaining' | 'total' | 'flag' | 'start' | 'delta'>): { x: number; y: number } {
  const p = 1 - s.remaining / s.total;
  const c = Math.cos(p * 1.5707963705062866);
  const q = p * p * p;
  const x = s.flag ? s.delta.x * (1 - c) : s.delta.x * q;
  const y = s.flag ? s.delta.y * q : s.delta.y * (1 - c);
  return { x: s.start.x + x, y: s.start.y + y };
}

function hash01(n: number): number {
  let h = (n | 0) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

interface Active { el: HTMLElement; st: FlyerState }

export class CurrencyFlyerLayer {
  private readonly active: Active[] = [];
  private readonly pool: HTMLElement[] = [];
  private serial = 0;
  private readonly layer: HTMLElement;

  constructor(private readonly assets: UiAssets, root: UiRoot, private readonly dest: { x: number; y: number }) {
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '6', pointerEvents: 'none' });
    root.el.appendChild(this.layer);
  }

  /** FlyToDestinationWithValue: start = the pickup's projected position (reference px). */
  spawn(start: { x: number; y: number }): void {
    const n = this.serial++;
    const el = this.pool.pop() ?? spriteEl(this.assets, FLYER_SPRITE);
    el.style.opacity = '1';
    this.layer.appendChild(el);
    const total = MOVE_TIME_MIN + (MOVE_TIME_MAX - MOVE_TIME_MIN) * hash01(n * 2 + 1);
    const st: FlyerState = {
      remaining: total, total, flag: hash01(n * 2 + 2) >= 0.5,
      start: { ...start }, delta: { x: this.dest.x - start.x, y: this.dest.y - start.y }, hitAge: -1,
    };
    place(el, start.x, start.y);
    this.active.push({ el, st });
  }

  get count(): number {
    return this.active.length;
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      const s = a.st;
      if (s.hitAge < 0) {
        s.remaining = Math.max(0, s.remaining - dt);
        const p = flyerPosition(s);
        place(a.el, p.x, p.y);
        if (s.remaining === 0) s.hitAge = 0;
      } else {
        s.hitAge += dt;
        a.el.style.opacity = String(Math.max(0, 1 - s.hitAge / HIT_FINISH_DELAY));
        if (s.hitAge >= HIT_FINISH_DELAY) {
          a.el.remove();
          this.pool.push(a.el);
          this.active.splice(i, 1);
        }
      }
    }
  }
}
