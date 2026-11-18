// src/view/ui/WaveBarModel.ts
// Pure model of the HUD wave bar: Q4.WaveBarMonsterIcon (Init @0x9006B0, OnWaveCleared @0x900970, Update @0x9009D0) +
// Q4.GameInfoController.UpdateMonsterBarIcons @0x44C880 (3 pooled bar-fill animators) + the Animator controllers
// `hud_02_meter_monster_grp_ctrl` and `hud_02_meter_bar_ctrl` (clip curves decoded from the globalsettings bundle).
//
// Icon logic (per wave i, one WaveBarMonsterIcon each, ticked in index order):
//   Init(enemyBarTime = 60, i, prev): t = GetTimeUntilWaveActivates(i). t == 0 -> hasStarted = hasArrived = true, GameObject inactive.
//        t < 60 -> appearDelay = -1 (take the real remaining time on the first update); else appearDelay = 60.
//   OnWaveCleared(cleared): if i == cleared + 1: t = GetTimeUntilWaveActivates(i); if t < appearDelay && progress > 0 -> appearDelay = t / progress
//        (rescale so the icon does not jump when the wave is called early).
//   Update: not inited -> return. prev != null && !prev.hasStarted -> return. Animator OnInIdle = true (pop-in).
//        prev != null && prev.progress > 0.95 -> return (keep spacing). i == 0 && waveProgress[0].remainingSpawnStartDelay > 0 -> return.
//        appearDelay < 0 -> appearDelay = t.  progress = clamp01(t / appearDelay).  hasStarted |= progress < 1.  hasArrived |= progress == 0.
//        StartMonster = hasStarted && !hasArrived && progress != 0.  if (!hasArrived) PosMonster = progress.
// Icon animator (clips): OutIdle (scale 0, x 533) -[OnInIdle]-> In 0.333 s (scale/alpha 0->1) -> InIdle (x 533) -[StartMonster]->
//   Start 0.533 s (x 533 -> 437, hop y 0 -> 30 @0.267 -> 0) -> (0.2 s blend) PosBlendTree (PosMonster 0..1 blends MonsterPos_00 x=0 /
//   MonsterPos_100 x=437; y bob 0 -> 3 -> 0 over a 2 s loop) -[!StartMonster]-> Goal 3 s (x 0 -> -30 in 0.333, hop y 0 -> 10 @0.167 -> 0,
//   scale 1 until 2.5 s then -> 0 at 3.0 s).
// Bar fills (GameInfoController): 3 pooled animators (bar_01..03). A started, not arrived icon takes the first free slot
//   (OnInIdle = true: fade in 0.333 s); its PosBar = progress (0 when progress == 1) drives sizeDelta.x = 444 * PosBar; on arrival the slot is freed
//   and fades out (0.667 s). Bar sprites are 9-sliced horizontally (border 20 / 15).

export const WAVE_BAR = {
  enemyBarTime: 60,
  /** anchoredPosition.x of the icon (relative to Monster_Offset): staged queue position, bar start, home */
  stageX: 533, startX: 437, homeX: 0,
  spacingGate: 0.95,
  barWidth: 444,
  slots: 3,
  inTime: 0.3333, startTime: 0.5333, startBlend: 0.2, goalTime: 3.0,
  slotInTime: 0.3333, slotOutTime: 0.6667,
} as const;

export interface WaveBarWorld {
  /** GameCoreWaveManager.GetTimeUntilWaveActivates(i) */
  timeUntil(i: number): number;
  /** waveProgressList[i].remainingSpawnStartDelay (+0x18) */
  spawnStartDelay(i: number): number;
}

export type IconAnim = 'OutIdle' | 'In' | 'InIdle' | 'Start' | 'Pos' | 'Goal';

export interface IconView {
  /** false = GameObject inactive / fully hidden */
  visible: boolean;
  /** offset from the Monster_Offset origin (canvas px, y up) */
  x: number; y: number;
  scale: number; alpha: number;
  progress: number;
  hasStarted: boolean; hasArrived: boolean;
  anim: IconAnim;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

class Icon {
  appearDelay = 0;
  progress = 0;
  hasStarted = false;
  hasArrived = false;
  inited = false;
  active = true;
  onInIdle = false;
  startMonster = false;
  posMonster = 0;
  anim: IconAnim = 'OutIdle';
  t = 0;
  /** blend-in of PosBlendTree after Start */
  blend = 1;
  clock = 0;

  constructor(readonly index: number, readonly prev: Icon | null) {}

  init(world: WaveBarWorld, enemyBarTime: number): void {
    this.appearDelay = enemyBarTime;
    const t = world.timeUntil(this.index);
    if (t !== 0) {
      if (t < enemyBarTime) this.appearDelay = -1;
    } else {
      this.hasStarted = true;
      this.hasArrived = true;
      this.active = false;
    }
    this.inited = true;
  }

  onWaveCleared(world: WaveBarWorld, cleared: number): void {
    if (this.index !== cleared + 1) return;
    const t = world.timeUntil(this.index);
    if (t < this.appearDelay && this.progress > 0) this.appearDelay = t / this.progress;
  }

  /** WaveBarMonsterIcon.Update */
  logic(world: WaveBarWorld): void {
    if (!this.inited) return;
    if (this.prev !== null && !this.prev.hasStarted) return;
    this.onInIdle = true;
    if (this.prev !== null && this.prev.progress > WAVE_BAR.spacingGate) return;
    if (this.index === 0 && world.spawnStartDelay(0) > 0) return;
    const t = world.timeUntil(this.index);
    if (this.appearDelay < 0) this.appearDelay = t;
    const p = this.appearDelay > 0 ? clamp01(t / this.appearDelay) : 0;
    this.progress = p;
    this.hasStarted = p < 1 || this.hasStarted;
    const wasArrived = this.hasArrived;
    this.hasArrived = p === 0 || this.hasArrived;
    this.startMonster = this.hasStarted && !wasArrived && p !== 0;
    if (!this.hasArrived) this.posMonster = p;
  }

  /** Animator evaluation (hud_02_meter_monster_grp_ctrl). */
  animate(dt: number): void {
    this.clock += dt;
    this.t += dt;
    const W = WAVE_BAR;
    for (let hop = 0; hop < 4; hop++) {
      if (this.anim === 'OutIdle' && this.onInIdle) { this.anim = 'In'; this.t = 0; continue; }
      if (this.anim === 'In' && this.t >= W.inTime) { this.anim = 'InIdle'; this.t -= W.inTime; continue; }
      if (this.anim === 'InIdle') {
        if (!this.onInIdle) { this.anim = 'OutIdle'; this.t = 0; continue; }
        if (this.startMonster) { this.anim = 'Start'; this.t = 0; continue; }
      }
      if (this.anim === 'Start' && this.t >= W.startTime) { this.anim = 'Pos'; this.blend = 0; this.t -= W.startTime; continue; }
      if (this.anim === 'Pos' && !this.startMonster) { this.anim = 'Goal'; this.t = 0; continue; }
      if (this.anim === 'Goal' && !this.onInIdle) { this.anim = 'OutIdle'; this.t = 0; continue; }
      break;
    }
    if (this.anim === 'Pos') this.blend = Math.min(1, this.blend + dt / W.startBlend);
  }

  view(): IconView {
    const W = WAVE_BAR;
    let x: number = W.stageX, y = 0, scale = 1, alpha = 1;
    switch (this.anim) {
      case 'OutIdle': scale = 0; alpha = 0; break;
      case 'In': { const k = clamp01(this.t / W.inTime); scale = k; alpha = k; break; }
      case 'InIdle': break;
      case 'Start': {
        x = lerp(W.stageX, W.startX, this.t / W.startTime);
        const k = this.t / W.startTime; // hop 0 -> 30 (0.267 / 0.533) -> 0
        y = k < 0.5 ? lerp(0, 30, k / 0.5) : lerp(30, 0, (k - 0.5) / 0.5);
        break;
      }
      case 'Pos': {
        const xs = lerp(W.startX, this.posMonster * W.startX, this.blend);
        x = this.blend < 1 ? xs : this.posMonster * W.startX;
        const ph = (this.clock % 2) / 2; // bob 0 -> 3 -> 0 over 2 s
        y = ph < 0.5 ? lerp(0, 3, ph / 0.5) : lerp(3, 0, (ph - 0.5) / 0.5);
        break;
      }
      case 'Goal': {
        x = this.t < 0.3333 ? lerp(0, -30, this.t / 0.3333) : -30;
        y = this.t < 0.1667 ? lerp(0, 10, this.t / 0.1667) : this.t < 0.3333 ? lerp(10, 0, (this.t - 0.1667) / 0.1667) : 0;
        scale = this.t < 2.5 ? 1 : lerp(1, 0, (this.t - 2.5) / 0.5);
        break;
      }
    }
    return { visible: this.active && this.anim !== 'OutIdle' && scale > 0, x, y, scale, alpha, progress: this.progress, hasStarted: this.hasStarted, hasArrived: this.hasArrived, anim: this.anim };
  }
}

export interface BarSlotView { slot: number; visible: boolean; posBar: number; alpha: number }

class Slot {
  anim: 'OutIdle' | 'In' | 'InIdle' | 'Out' = 'OutIdle';
  t = 0;
  onInIdle = false;
  posBar = 0;
  free = true;
  animate(dt: number): void {
    this.t += dt;
    const W = WAVE_BAR;
    if (this.anim === 'OutIdle' && this.onInIdle) { this.anim = 'In'; this.t = 0; }
    if (this.anim === 'In' && this.t >= W.slotInTime) { this.anim = 'InIdle'; this.t = 0; }
    if (this.anim === 'InIdle' && !this.onInIdle) { this.anim = 'Out'; this.t = 0; }
    if (this.anim === 'Out' && this.t >= W.slotOutTime) { this.anim = 'OutIdle'; this.t = 0; }
  }
  alpha(): number {
    const W = WAVE_BAR;
    switch (this.anim) {
      case 'OutIdle': return 0;
      case 'In': return clamp01(this.t / W.slotInTime);
      case 'InIdle': return 1;
      case 'Out': return 1 - clamp01(this.t / W.slotOutTime);
    }
  }
}

export class WaveBarModel {
  private icons: Icon[] = [];
  private readonly slots = Array.from({ length: WAVE_BAR.slots }, () => new Slot());
  /** icon index -> slot index (-1 none), GameInfoController +0x110 */
  private readonly assign: number[] = [];

  constructor(private readonly world: WaveBarWorld, readonly count: number, private readonly enemyBarTime: number = WAVE_BAR.enemyBarTime) {
    for (let i = 0; i < count; i++) {
      const ic = new Icon(i, i > 0 ? this.icons[i - 1] : null);
      this.icons.push(ic);
    }
    for (const ic of this.icons) ic.init(world, enemyBarTime);
  }

  /** Events.waveEndedEvent(waveManager, clearedIndex) -> every icon's OnWaveCleared. */
  onWaveCleared(cleared: number): void {
    for (const ic of this.icons) ic.onWaveCleared(this.world, cleared);
  }

  update(dt: number): void {
    for (const ic of this.icons) { ic.logic(this.world); ic.animate(dt); }
    // GameInfoController.UpdateMonsterBarIcons
    for (let i = 0; i < this.icons.length; i++) {
      const ic = this.icons[i];
      if (ic.hasStarted && !ic.hasArrived) {
        let slot: number;
        if (i < this.assign.length) slot = this.assign[i];
        else {
          slot = this.slots.findIndex((s) => s.free);
          if (slot >= 0) { this.slots[slot].free = false; this.slots[slot].onInIdle = true; }
          this.assign.push(slot);
        }
        if (slot >= 0) this.slots[slot].posBar = ic.progress < 1 ? ic.progress : 0;
      } else if (ic.hasArrived && i < this.assign.length && this.assign[i] >= 0) {
        const slot = this.assign[i];
        this.slots[slot].free = true;
        this.assign[i] = -1;
        this.slots[slot].onInIdle = false;
      }
    }
    for (const s of this.slots) s.animate(dt);
  }

  iconViews(): IconView[] { return this.icons.map((i) => i.view()); }
  barViews(): BarSlotView[] {
    return this.slots.map((s, slot) => ({ slot, visible: s.anim !== 'OutIdle', posBar: s.posBar, alpha: s.alpha() }));
  }
}
