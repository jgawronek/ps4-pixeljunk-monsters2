import { describe, expect, it } from 'vitest';
import { ENEMY_VIEW_DATA } from '../../src/view/characters/enemyViewData.generated';
import { EnemyAnimator } from '../../src/view/characters/EnemyAnimatorLogic';
import { barSizeForEnemy, EnemyHealthBars, evalCurve } from '../../src/view/characters/EnemyHealthBar';

const LEN: Record<string, number> = {
  'kuri_idle [data]': 1, 'kuri_walk [data]': 0.9, 'kuri_walk_01 [data]': 1, 'kuri_walk_02 [data]': 1,
  'kuri_dieSmall_air [data]': 1, 'kuri_dieSmall_impact [data]': 1, 'kuri_dieBig_air [data]': 1,
  'kuri_dieBig_impact [data]': 1, 'kuri_damage_small [data]': 0.5,
};
function kuri(): { a: EnemyAnimator; log: string[] } {
  const log: string[] = [];
  const ctl = ENEMY_VIEW_DATA.controllers[ENEMY_VIEW_DATA.enemies['kuri_00_001'].controller!];
  const a = new EnemyAnimator(ctl, {
    clipLength: (n) => LEN[n] ?? 1,
    onEnter: (s) => log.push(ctl.layers[0].states[s].name),
  });
  return { a, log };
}

describe('enemy data (original controllers)', () => {
  it('ground enemies are enemyMoveType 1 and wave-1 kuri starts in Idle, not the fly/Balloon clip', () => {
    expect(ENEMY_VIEW_DATA.enemies['kuri_00_001'].enemyMoveType).toBe(1);
    const { log } = kuri();
    expect(log).toEqual(['Idle']);
  });
});

describe('EnemyAnimator (kuri_ctrl)', () => {
  it('Idle -> Walk when MoveSpeedScale > 0, back to Idle when it stops', () => {
    const { a } = kuri();
    a.setFloat('MoveSpeedScale', 1);
    a.update(1 / 30);
    expect(a.currentName).toBe('Walk');
    a.setFloat('MoveSpeedScale', 0);
    for (let i = 0; i < 60; i++) a.update(1 / 30);
    expect(a.currentName).toBe('Idle');
  });
  it('Die trigger picks DieNormal / DieStrong by DeathType; DeathImpact -> impact state', () => {
    const { a } = kuri();
    a.setInteger('DeathType', 1); a.setTrigger('Die'); a.update(1 / 30);
    expect(a.currentName).toBe('DieNormal');
    a.setTrigger('DeathImpact'); a.update(1 / 30);
    expect(a.currentName).toBe('DieNormalImpact');
    const b = kuri().a;
    b.setInteger('DeathType', 2); b.setTrigger('Die'); b.update(1 / 30);
    expect(b.currentName).toBe('DieStrong');
  });
  it('TakeDamageWeak any-state transition returns to the walk loop via Idle', () => {
    const { a } = kuri();
    a.setFloat('MoveSpeedScale', 1); a.update(1 / 30);
    a.setTrigger('TakeDamageWeak'); a.update(1 / 30);
    expect(a.currentName).toBe('TakeDamageWeak');
    for (let i = 0; i < 40; i++) a.update(1 / 30);
    expect(['Idle', 'Walk']).toContain(a.currentName);
  });
  it('WalkVariation trigger plays walk_01/02 (RandomInt) then returns to Walk', () => {
    const { a } = kuri();
    a.random = () => 0.9; // RandomInt = 1 -> walk_02
    a.setFloat('MoveSpeedScale', 1); a.update(1 / 30);
    a.setTrigger('WalkVariation');
    for (let i = 0; i < 40 && a.currentName === 'Walk'; i++) a.update(1 / 30);
    expect(a.currentName).toBe('kuri_walk_02 [data]');
    for (let i = 0; i < 40 && a.currentName !== 'Walk'; i++) a.update(1 / 30);
    expect(a.currentName).toBe('Walk');
  });
});

describe('NewHealthBar port', () => {
  const cfg = ENEMY_VIEW_DATA.healthBar;
  const enemy = { life: 300, max: 300, dead: false, isDestroyed() { return this.dead; }, getLife() { return this.life; }, getMaxLife() { return this.max; } };
  it('bar size follows GetBarSizeForEnemy (raw-asm quirk: first setting with min in (prevMax, maxLife))', () => {
    const s = ENEMY_VIEW_DATA.enemies['kuri_00_001'].m_healthBarSettings;
    expect(barSizeForEnemy(false, s, 300)).toBe(1);
    expect(barSizeForEnemy(false, s, 100)).toBe(0);
    expect(barSizeForEnemy(false, s, 5000)).toBe(1);
    expect(barSizeForEnemy(true, s, 300)).toBe(3);
  });
  it('curves: ease in/out', () => {
    expect(evalCurve(cfg.showCurve, 0.5)).toBeCloseTo(0.5, 5);
    expect(evalCurve(cfg.hideCurve, 0)).toBeCloseTo(1, 5);
  });
  it('hidden until hit; shows, trails damage, hides after death', () => {
    const bars = new EnemyHealthBars<{ gone: boolean }>(cfg, (v) => v.gone);
    expect(bars.draw(0)).toHaveLength(0);
    const v = { gone: false };
    enemy.life = 200;
    bars.show(enemy, v, { damage: 100, strong: false }, 1, false, 10);
    bars.update(1 / 60, 10);
    const d = bars.draw(10)[0];
    expect(d.scale).toBeGreaterThan(0.7);
    expect(d.life / d.maxLife).toBeCloseTo(2 / 3, 5);
    expect(d.trail).toBeCloseTo(1, 5); // life + pending damage
    const later = bars.draw(10 + cfg.degenDisplayDelay + cfg.barDegenDurationInSeconds + 0.1)[0];
    expect(later.trail).toBeNull();
    enemy.dead = true;
    for (let t = 10; t < 14; t += 0.05) bars.update(0.05, t);
    expect(bars.items).toHaveLength(0);
  });
});
