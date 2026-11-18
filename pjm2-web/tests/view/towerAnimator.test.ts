// tests/view/towerAnimator.test.ts
// AnimatorRuntime (serialized Unity controller evaluation) + TowerAnimatorLogic
// (Q4.TowerAnimator OnFire/UpdateFiring @00547270) driven by the REAL tower_001
// AnimatorController extracted from the structures bundle (towerViewData.generated.ts).
// Clip lengths from .work/asset-scale/tower_001/clips.json (stopTime): the five
// BaseLayer clips are 1.0 s, close_idle 0.2667 (DoorLayer, looping).

import { describe, expect, it } from 'vitest';
import { AnimatorRuntime, type AnimatorHost } from '../../src/view/characters/AnimatorRuntime';
import { TowerAnimatorLogic } from '../../src/view/characters/TowerAnimatorLogic';
import { TOWER_VIEW_DATA } from '../../src/view/characters/towerViewData.generated';

const LEN: Record<string, number> = {
  ready_to_fire: 1, fire: 1, cool_down: 1, reload: 1, cool_down_idle: 1,
  close_idle: 0.2666667, close_pc_out: 0.5, open_idle_pc_out: 0.0667, close_pc_in: 0.5,
  open_idle_pc_in: 0.0667, open_pc_in: 0.5,
};

function make(): { rt: AnimatorRuntime; logic: TowerAnimatorLogic; log: string[] } {
  const ctl = TOWER_VIEW_DATA['tower_001'].controller!;
  const log: string[] = [];
  const host: AnimatorHost = {
    clipLength: (c) => LEN[c] ?? 0,
    onEnter: (layer, state) => log.push(`${layer}:${ctl.layers[layer].states[state].name}`),
  };
  const rt = new AnimatorRuntime(ctl, host);
  const logic = new TowerAnimatorLogic(rt, { fireAnimationDuration: 1, reloadClipLength: LEN.reload });
  return { rt, logic, log };
}

const STEP = 1 / 60;
function run(rt: AnimatorRuntime, logic: TowerAnimatorLogic, seconds: number,
  idle: { stateTime: number; shootOnSight: boolean } | null = null, attackSpeed = 3): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    logic.update(STEP, idle, attackSpeed);
    rt.update(STEP);
  }
}

describe('extracted tower_001 controller (structures bundle)', () => {
  it('has the BaseLayer + DoorLayer state machines and OnReady/OnDoorOpenOut/OnDoorOpenIn bools', () => {
    const c = TOWER_VIEW_DATA['tower_001'].controller!;
    expect(c.params.map((p) => p.name)).toEqual(['OnReady', 'OnDoorOpenOut', 'OnDoorOpenIn']);
    expect(c.layers.map((l) => l.name)).toEqual(['BaseLayer', 'DoorLayer']);
    expect(c.layers[0].states.map((s) => s.name)).toEqual(['ready_to_fire', 'fire', 'cool_down', 'reload', 'cool_down_idle']);
    expect(c.layers[0].defaultState).toBe(0);
  });

  it('there is NO build/construct animator state on any production tower', () => {
    for (const rec of Object.values(TOWER_VIEW_DATA)) {
      for (const ctl of [rec.controller, rec.flagController]) {
        if (ctl === null) continue;
        for (const l of ctl.layers) for (const s of l.states) expect(s.name).not.toMatch(/build|construct/i);
      }
    }
  });
});

describe('AnimatorRuntime + TowerAnimatorLogic (tower_001)', () => {
  it('starts in the default states: ready_to_fire (BaseLayer) and close_idle (DoorLayer)', () => {
    const { rt, log } = make();
    expect(log).toEqual(['0:ready_to_fire', '1:close_idle']);
    expect(rt.currentPath(0)).toBe('BaseLayer.ready_to_fire');
    expect(rt.currentPath(1)).toBe('DoorLayer.close_idle');
  });

  it('OnFire arms OnReady → fire → cool_down → cool_down_idle (holds) → reload when OnReady clears', () => {
    const { rt, logic } = make();
    run(rt, logic, 0.5);
    expect(rt.currentPath(0)).toBe('BaseLayer.ready_to_fire'); // idle loop, nothing armed
    logic.onFire();
    expect(rt.getBool('OnReady')).toBe(true);
    run(rt, logic, STEP * 2);
    expect(rt.currentPath(0)).toBe('BaseLayer.fire');
    run(rt, logic, 1.05); // fire clip (1 s) elapses → exit time 1.0 → cool_down
    expect(rt.currentPath(0)).toBe('BaseLayer.cool_down');
    run(rt, logic, 1.05);
    expect(rt.currentPath(0)).toBe('BaseLayer.cool_down_idle');
    run(rt, logic, 2); // holds while OnReady is still true / tower not idle-timed-out
    expect(rt.currentPath(0)).toBe('BaseLayer.cool_down_idle');
    // Idle state with stateTime ≥ attackSpeed − reloadLen and !shootOnSight → SetBool(OnReady,false)
    run(rt, logic, STEP * 2, { stateTime: 2.5, shootOnSight: false }, 3);
    expect(rt.currentPath(0)).toBe('BaseLayer.reload');
    run(rt, logic, 1.05);
    expect(rt.currentPath(0)).toBe('BaseLayer.ready_to_fire');
  });

  it('does NOT start the reload early (stateTime < attackSpeed − reload clip length, not shoot-on-sight)', () => {
    const { rt, logic } = make();
    logic.onFire();
    run(rt, logic, 3.2); // → cool_down_idle, OnReady still true
    expect(rt.currentPath(0)).toBe('BaseLayer.cool_down_idle');
    run(rt, logic, 1, { stateTime: 0.5, shootOnSight: false }, 3); // 0.5 < 3 − 1
    expect(rt.currentPath(0)).toBe('BaseLayer.cool_down_idle');
    expect(rt.getBool('OnReady')).toBe(true);
    run(rt, logic, STEP * 2, { stateTime: 0.1, shootOnSight: true }, 3); // shoot-on-sight bypasses
    expect(rt.currentPath(0)).toBe('BaseLayer.reload');
  });

  it('OnFire for a controller without OnReady (tower_005) is a no-op', () => {
    const ctl = TOWER_VIEW_DATA['tower_005'].controller!;
    const rt = new AnimatorRuntime(ctl, { clipLength: () => 1, onEnter: () => {} });
    const logic = new TowerAnimatorLogic(rt, { fireAnimationDuration: 1, reloadClipLength: 0 });
    logic.onFire();
    expect(rt.hasParameter('OnReady')).toBe(false);
    expect(rt.currentPath(0)).toBe('Base Layer.Idle');
  });

  it('triggers are consumed by the transition (tower_004 OnFireFinish)', () => {
    const rec = TOWER_VIEW_DATA['tower_004'];
    expect(rec.fireAnimationDuration).toBe(10); // serialized TowerAnimator.fireAnimationDuration
    const rt = new AnimatorRuntime(rec.controller!, { clipLength: () => 1, onEnter: () => {} });
    expect(rt.hasParameter('OnFireFinish')).toBe(true);
  });
});
