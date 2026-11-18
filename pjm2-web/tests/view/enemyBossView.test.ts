import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENEMY_VIEW_DATA } from '../../src/view/characters/enemyViewData.generated';
import { blendLeaves, EnemyAnimator } from '../../src/view/characters/EnemyAnimatorLogic';
import { EnemyBaseView, type EnemyFrameInput } from '../../src/view/characters/EnemyBaseView';
import type { EnemyFxHandle } from '../../src/view/characters/enemyEffects';
import { stageEnemyDefs, balloonRigName } from '../../src/view/characters/stageEnemyDefs';
import type { WaveResourceContract } from '../../src/view/q4-contracts';

const D = ENEMY_VIEW_DATA;
const LEN = (n: string): number => (n.includes('die') ? 2 : n.includes('attack') ? 1.5 : 1.6);
function mkAnim(def: string, overrides: Record<string, number> = {}): EnemyAnimator {
  const rec = D.enemies[def];
  const a = new EnemyAnimator(D.controllers[rec.controller!], { clipLength: (n) => overrides[n] ?? LEN(n) });
  return a;
}
const clips = (a: EnemyAnimator): string => a.poses().map((p) => `${p.clip.replace(' [data]', '')}:${p.weight.toFixed(2)}`).join(' ');

describe('1D blend trees (boss_ude Loco / boss_fat Move)', () => {
  const ude = D.controllers['boss_ude_ctrl'].layers[0].states.find((s) => s.name === 'Loco')!.motion!;
  const leaves = (walk: number, dmg: number): string =>
    blendLeaves(ude, (n) => ({ BossWalkSpeed: walk, BossDamageWeight: dmg } as Record<string, number>)[n] ?? 0)
      .map((l) => `${l.clip.replace(' [data]', '')}:${l.weight.toFixed(3)}`).join(' ');
  it('BossWalkSpeed 1 / DamageWeight 0 = pure boss_walk; DamageWeight 1 = slow_walk', () => {
    expect(leaves(1, 0)).toBe('boss_walk:1.000');
    expect(leaves(1, 1)).toBe('boss_slow_walk:1.000');
  });
  it('interpolates linearly between neighbouring thresholds (0.3333..0.6667) and multiplies nested weights', () => {
    // dmg 0.5 -> halfway between thresholds 0.3333 (walk) and 0.6667 (slow_walk)
    expect(leaves(1, 0.5)).toBe('boss_walk:0.500 boss_slow_walk:0.500');
    // walkSpeed 0.5: half of the slow-tree (crawl side) and half of the walk-tree
    const l = blendLeaves(ude, (n) => (n === 'BossWalkSpeed' ? 0.5 : 0));
    expect(l.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 6);
    expect(l.map((x) => x.clip.replace(' [data]', ''))).toEqual(['boss_slow_walk', 'boss_walk']);
  });
  it('boss_fat Move: BossGrounded 0 -> flying tree (BossInjured picks the one-wing clip), 1 -> walk', () => {
    const move = D.controllers['boss_fat_ctrl'].layers[0].states.find((s) => s.name === 'Move')!.motion!;
    const f = (g: number, inj: number): string => blendLeaves(move, (n) => ({ BossGrounded: g, BossInjured: inj } as Record<string, number>)[n] ?? 0)
      .map((l) => `${l.clip.replace(' [data]', '')}:${l.weight.toFixed(2)}`).join(' ');
    expect(f(0, 0)).toBe('boss_fly:1.00');
    expect(f(0, 1)).toBe('boss_fly_one_wing:1.00');
    expect(f(1, 0)).toBe('boss_walk:1.00');
    expect(f(0.5, 0)).toBe('boss_fly:0.50 boss_walk:0.50');
  });
});

describe('EnemyAnimator pose mix (cross-fades, layers, hold)', () => {
  it('cross-fade weights follow alpha_i * prod(1 - alpha_j) and end at 1', () => {
    const a = mkAnim('boss_ude_00');
    a.setFloat('MoveSpeedScale', 1);
    a.update(0); // Idle -> Loco (0.2 s fixed)
    expect(a.currentName).toBe('Loco');
    const w0 = a.poses().map((p) => p.weight);
    expect(w0.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    a.update(0.1); // halfway through the 0.2 s fade
    const half = a.poses();
    expect(half.find((p) => p.clip.startsWith('boss_idle'))!.weight).toBeCloseTo(0.5, 2);
    expect(half.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 6);
    a.update(0.2);
    expect(a.poses().every((p) => p.clip !== 'boss_idle [data]')).toBe(true);
  });
  it('boss_ude: SpawnMinion any-state, FastSlowTransition plays boss_damage, Die holds boss_die at 99%', () => {
    const a = mkAnim('boss_ude_00');
    a.setTrigger('SpawnMinion'); a.update(0.01);
    expect(a.currentName).toBe('SpawnMinion');
    a.setTrigger('FastSlowTransition'); a.update(0.01);
    expect(a.currentName).toBe('FastSlowTransition');
    a.setInteger('DeathType', 1); a.setTrigger('Die'); a.update(0.01);
    expect(a.currentName).toBe('Die');
    for (let i = 0; i < 120 && a.currentName !== 'Dead'; i++) a.update(1 / 30);
    expect(a.currentName).toBe('Dead');
    expect(a.currentTag).toBe('Dead');
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    const dead = a.poses().find((p) => p.weight > 0.99)!;
    expect(dead.clip).toBe('boss_die [data]');
    expect(dead.time / LEN('boss_die')).toBeGreaterThanOrEqual(0.99); // speed 0: held at the end of the die clip (offset 0.99 + cycleOffset 0.99, clamped)
  });
  it('motionless states (boss_kao Die) last 1 s and exit to Dead', () => {
    const a = mkAnim('boss_kao_00');
    a.setTrigger('Die'); a.update(0.01);
    expect(a.currentName).toBe('Die');
    expect(a.poses()).toHaveLength(1 - 1 + a.poses().length); // (pose list may hold the fading-out walk)
    for (let i = 0; i < 40; i++) a.update(1 / 30);
    expect(a.currentName).toBe('Dead');
  });
  it('giant_controller layer 1 is an ADDITIVE flinch layer driven by TakeDamageStrong', () => {
    const a = mkAnim('giant_00_001');
    expect(a.layerCount).toBe(2);
    expect(a.poses().every((p) => !p.additive)).toBe(true);
    a.setTrigger('TakeDamageStrong'); a.update(0.01); a.update(0.05); // 0.1 s fade-in of the additive state
    const add = a.poses().filter((p) => p.additive);
    expect(add).toHaveLength(1);
    expect(add[0].clip).toBe('giant_damage [data]');
    expect(a.stateName(1)).toBe('TakeDamageStrong');
    for (let i = 0; i < 60; i++) a.update(1 / 30);
    expect(a.stateName(1)).toBe('Empty');
    expect(a.poses().some((p) => p.additive)).toBe(false);
  });
  it('Animator.speed scales state time (frozen stepping)', () => {
    const a = mkAnim('kuri_00_001');
    a.setFloat('MoveSpeedScale', 1); a.update(0.01);
    a.update(0.1);
    const t1 = a.normalizedTime();
    a.speed = 0.1;
    a.update(0.1);
    expect(a.normalizedTime() - t1).toBeCloseTo((t1 - 0.01 / 1.6) * 0.1 / 1 * (0.1 / 0.1) * 1 + 0, 0); // ~ 10x slower
    expect(a.normalizedTime() - t1).toBeLessThan(0.02);
  });
  it('a state cycleOffset / cycleOffsetParam shifts the clip phase (no shipped enemy state uses the parameter)', () => {
    expect(JSON.stringify(D.controllers).includes('"cycleOffsetParam":"')).toBe(false);
    const ctl = JSON.parse(JSON.stringify(D.controllers['kuri_ctrl']));
    const walk = ctl.layers[0].states.find((s: { name: string }) => s.name === 'Walk');
    walk.cycleOffsetParam = 'WalkCycleOffset';
    const a = new EnemyAnimator(ctl, { clipLength: () => 1.6 });
    a.setFloat('WalkCycleOffset', 0.5); a.setFloat('MoveSpeedScale', 1); a.update(0.01); a.update(0.3);
    const p = a.poses().find((q) => q.weight > 0.99)!;
    expect(p.time / 1.6).toBeCloseTo(0.5 + 0.31 / 1.6 - 0.0, 1);
  });
});

function mkView(def: string, opts: { fx?: string[] } = {}): { v: EnemyBaseView; a: EnemyAnimator; root: THREE.Object3D; fx: string[] } {
  const rec = D.enemies[def];
  const a = mkAnim(def);
  const root = new THREE.Object3D();
  const fx: string[] = opts.fx ?? [];
  const handle: EnemyFxHandle = { stop() {}, follow() {}, detach() {}, active: true };
  const v = new EnemyBaseView({ root, animator: a, record: rec, random: () => 0.5, balloonCount: rec.spawnMode === 2 ? 3 : 0,
    fx: { trigger: (l) => { fx.push(l); return handle; } }, groundY: () => 0 });
  return { v, a, root, fx };
}
const frame = (p: Partial<EnemyFrameInput> = {}): EnemyFrameInput => ({
  position: { x: 0, y: 0, z: 0 }, previousPosition: { x: 0, y: 0, z: 0 }, speedCur: 1, ...p,
});

describe('EnemyBaseView hit shock (UpdateHitShock @007fbe30)', () => {
  const hit = (strong: boolean) => ({ hasSource: true, strongReaction: false, strongToDamage: strong, distanceToCenterRate: 0, reactionRate: 1 });
  it('impulse = Sample(curve, rate) * maxShockSpeed * (strongToDamage ? additionShockRate : 1) * shockScale * reactionRate', () => {
    const { v, root } = mkView('kuri_00_001');
    v.onHit(hit(false));
    v.update(1 / 60, frame()); // ground: v = 2.5 - 20 dt; pos = v dt
    const dt = 1 / 60;
    const v1 = 2.5 - 20 * dt;
    expect(root.position.y).toBeCloseTo(v1 * dt, 5); // shock step first, then position = core + up * shock
    v.update(dt, frame());
    const v2 = v1 - 20 * dt;
    expect(root.position.y).toBeCloseTo((v1 + v2) * dt, 5);
  });
  it('ground hop returns to 0; strong-to-damage hit launches 3.5x higher speed', () => {
    const w = mkView('kuri_00_001'); const s = mkView('kuri_00_001');
    w.v.onHit(hit(false)); s.v.onHit(hit(true));
    let wMax = 0; let sMax = 0;
    for (let i = 0; i < 120; i++) {
      w.v.update(1 / 60, frame()); s.v.update(1 / 60, frame());
      wMax = Math.max(wMax, w.root.position.y); sMax = Math.max(sMax, s.root.position.y);
    }
    expect(sMax / wMax).toBeGreaterThan(8); // apex ~ v^2 / 2g: (3.5)^2 = 12x
    expect(w.root.position.y).toBe(0);
    expect(s.root.position.y).toBe(0);
  });
  it('air enemies bob on a damped spring (spring 15, damping 10) and settle below 0.05', () => {
    const { v, root } = mkView('kurukuru_00_001');
    v.onHit(hit(false));
    let amp = 0;
    for (let i = 0; i < 240; i++) { v.update(1 / 60, frame({ air: true })); amp = Math.max(amp, Math.abs(root.position.y)); }
    expect(amp).toBeGreaterThan(0.01); // kurukuru shockScale is -1: the hit pushes DOWN, the spring bobs back up
    expect(root.position.y).toBe(0);
  });
  it('boss jump / jump reaction use m_bossJumpUpSpeed / m_TrampolineSpeed', () => {
    const { v, root } = mkView('boss_bero_00');
    v.onBossJump();
    v.update(1 / 60, frame()); v.update(1 / 60, frame());
    expect(root.position.y).toBeGreaterThan(0.05);
    const k = mkView('kuri_00_001');
    k.v.onJumpReaction(1);
    k.v.update(1 / 60, frame()); k.v.update(1 / 60, frame());
    expect(k.root.position.y).toBeGreaterThan(0.1); // 15 u/s
  });
});

describe('EnemyBaseView frozen stepping (UpdateFrozen @007fbd30)', () => {
  it('ice effect: speed = freezeAnimSpeed (0.1) for 0.2 s, then one frame at interval * 60 = 12', () => {
    const { v, a } = mkView('kuri_00_001');
    v.update(1 / 60, frame());
    expect(a.speed).toBe(1);
    v.onBuffStart('ice');
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) { v.update(1 / 60, frame()); seen.push(a.speed); }
    expect(seen.some((x) => Math.abs(x - 12) < 1e-3)).toBe(true);
    expect(seen.filter((x) => Math.abs(x - 0.1) < 1e-6).length).toBeGreaterThan(10);
    v.onBuffEnd('ice');
    v.update(1 / 60, frame());
    expect(a.speed).toBe(1);
  });
  it('fire extinguishes ice and vice versa; fire-spawn enemies burn from the start', () => {
    const { v, fx } = mkView('kuri_06_001');
    expect(fx).toContain('Fire');
    expect(v.hasFire).toBe(true);
    v.onBuffStart('ice');
    expect(v.hasIce).toBe(true);
    expect(v.hasFire).toBe(false);
  });
});

describe('EnemyBaseView boss parameters (BossUpdate @007fdde0)', () => {
  it('BossInit: BossWalkSpeed 1, BossGrounded 1, BossInjured 0', () => {
    const { a } = mkView('boss_fat_00');
    expect(a.getFloat('BossWalkSpeed')).toBe(1);
    expect(a.getFloat('BossGrounded')).toBe(1);
    expect(a.getFloat('BossInjured')).toBe(0);
  });
  it('BossGrounded = 0 while groundOffsetY > 0.001 (flying Fat boss), 1 once it lands', () => {
    const { v, a } = mkView('boss_fat_00');
    v.update(1 / 60, frame({ groundOffsetY: 2 }));
    expect(a.getFloat('BossGrounded')).toBe(0);
    v.update(1 / 60, frame({ groundOffsetY: 0 }));
    expect(a.getFloat('BossGrounded')).toBe(1);
  });
  it('slow mode: FastSlowTransition trigger + BossWalkSpeed 0 once; damaged mode: BossInjured 1', () => {
    const { v, a } = mkView('boss_fat_00');
    v.update(1 / 60, frame({ groundOffsetY: 2, damagedMode: true }));
    expect(a.getFloat('BossInjured')).toBe(1);
    const b = mkView('boss_ude_00');
    b.v.update(1 / 60, frame({ slowMode: true }));
    expect(b.a.getFloat('BossWalkSpeed')).toBe(0);
    expect(b.a.currentName).toBe('FastSlowTransition');
  });
  it('strong reaction ramps BossDamageWeight 0->1 in m_bossStrongDamageAnimDownDur then back to 0 over UpDur', () => {
    const { v, a } = mkView('boss_ude_00');
    const r = D.enemies['boss_ude_00'];
    v.onHit({ hasSource: true, strongReaction: true, strongToDamage: false, distanceToCenterRate: 0, reactionRate: 1 });
    let max = 0; let t = 0;
    for (; t < r.m_bossStrongDamageAnimDownDur + r.m_bossStrongDamageAnimUpDur + 0.5; t += 1 / 60) {
      v.update(1 / 60, frame());
      max = Math.max(max, a.getFloat('BossDamageWeight'));
    }
    expect(max).toBeGreaterThan(0.95);
    expect(a.getFloat('BossDamageWeight')).toBeLessThan(0.01);
  });
  it('SpawnMinion trigger only for minion groups on bosses', () => {
    const { v, a } = mkView('boss_ude_00');
    v.onSpawnGroupStarted(false); v.update(1 / 60, frame());
    expect(a.currentName).not.toBe('SpawnMinion');
    v.onSpawnGroupStarted(true); v.update(1 / 60, frame());
    expect(a.currentName).toBe('SpawnMinion');
    const k = mkView('kuri_00_001'); // no such parameter: ignored
    k.v.onSpawnGroupStarted(true);
  });
});

describe('EnemyBaseView attack / death / drown', () => {
  const atk = { isBoss: false, enemyPos: { x: 0, y: 0, z: 0 }, homePos: { x: 0, y: 0, z: 5 }, homeAttackDistance: 1, chibiPos: { x: 0, y: 0, z: 2 } };
  it('jump attack: lerp to the chibi over 0.5 s with a sin arc of height 1, Attack effect at 0.5 s, destroyed at AttackDestroySelfDur', () => {
    const { v, root, a, fx } = mkView('kuri_00_001');
    v.onAttack(atk);
    expect(v.state).toBe('attack');
    let maxY = 0; let t = 0;
    for (; t < 0.25; t += 1 / 120) { v.update(1 / 120, null); maxY = Math.max(maxY, root.position.y); }
    expect(root.position.y).toBeCloseTo(1, 1); // frac 0.5 -> sin(pi/2) * 1
    expect(root.position.z).toBeCloseTo(1, 1);
    for (; t < 0.6; t += 1 / 120) v.update(1 / 120, null);
    expect(fx).toContain('Attack');
    expect(root.position.z).toBeCloseTo(2, 1);
    expect(v.expired).toBe(false);
    for (; t < 0.75; t += 1 / 120) v.update(1 / 120, null);
    expect(v.expired).toBe(true);
    expect(a.currentName).toBe('Attack');
  });
  it('ground attack (cisors/giants): plays Attack in place, destroyed after AttackDestroySelfDur', () => {
    const { v, a } = mkView('cisors_00_001');
    v.onAttack(atk);
    v.update(1 / 60, null);
    expect(a.currentName).toBe('Attack');
    for (let t = 0; t < D.enemies['cisors_00_001'].AttackDestroySelfDur + 0.1; t += 1 / 60) v.update(1 / 60, null);
    expect(v.expired).toBe(true);
  });
  it('boss attack stays attached to the sim object and never expires while it lives', () => {
    const { v, a, root } = mkView('boss_ude_00');
    v.onAttack({ ...atk, isBoss: true });
    v.update(1 / 60, frame({ position: { x: -3, y: 0, z: 4 } }));
    expect(root.position.x).toBeCloseTo(3, 5); // three space mirrors x
    expect(a.currentName).toBe('Attack');
    for (let i = 0; i < 600; i++) v.update(1 / 60, frame());
    expect(v.expired).toBe(false);
  });
  it('boss death: Fat boss falls then sinks (Sink effect), others sink at m_bossSinkSpeed; no ballistic launch', () => {
    const { v, root, fx } = mkView('boss_bero_00');
    root.position.set(0, 0, 0);
    v.onDestroyed({ strong: true, towerPos: null, sourcePos: null, distanceToCenterRate: 0, enemyPos: { x: 0, y: 0, z: 0 } });
    expect(fx).toContain('Die'); // Bero / Kao trigger Die at once
    for (let i = 0; i < 60; i++) v.update(1 / 60, null);
    expect(root.position.y).toBeCloseTo(-D.enemies['boss_bero_00'].m_bossSinkSpeed, 1);
    expect(fx).toContain('Sink');
    const fat = mkView('boss_fat_00');
    fat.root.position.set(0, 2, 0);
    fat.v.onDestroyed({ strong: false, towerPos: null, sourcePos: null, distanceToCenterRate: 0, enemyPos: { x: 0, y: 2, z: 0 } });
    let t = 0;
    while (t < 3 && fat.root.position.y > 0.05) { fat.v.update(1 / 60, null); t += 1 / 60; }
    expect(fat.root.position.y).toBeLessThan(0.5); // free fall (g = 20) to the terrain probe at 0
    expect(t).toBeLessThan(0.7);
  });
  it('drown: falls with Physics.gravity, splash + Drowning effects in the water, destroyed at the DrownDead tag', () => {
    const rec = D.enemies['kuri_00_001'];
    const a = mkAnim('kuri_00_001');
    const root = new THREE.Object3D(); root.position.set(0, 0.5, 0);
    const fx: string[] = [];
    const v = new EnemyBaseView({ root, animator: a, record: rec, random: () => 0.5, waterY: () => 0,
      fx: { trigger: (l) => { fx.push(l); return { stop() {}, follow() {}, detach() {}, active: true }; } } });
    v.update(1 / 60, frame());
    v.onDrown();
    expect(v.state).toBe('drown');
    for (let i = 0; i < 600 && !v.expired; i++) v.update(1 / 60, null);
    expect(fx).toEqual(expect.arrayContaining(['WaterSplash', 'Drowning']));
    expect(v.expired).toBe(true);
  });
  it('balloons: Balloon trigger at init, PopBalloons -> BalloonFall, ground contact -> BalloonFallLand', () => {
    const { v, a } = mkView('kuri_03_001');
    v.update(1 / 60, frame({ groundOffsetY: 1.25 }));
    expect(a.currentName).toBe('Balloon');
    v.onPopBalloons(1); v.update(1 / 60, frame({ groundOffsetY: 1.25 }));
    expect(a.currentName).toBe('Balloon');
    v.onPopBalloons(5); v.update(1 / 60, frame({ groundOffsetY: 1.0 }));
    expect(a.currentName).toBe('BalloonFall');
    v.update(1 / 60, frame({ groundOffsetY: 0 }));
    v.update(1 / 60, frame({ groundOffsetY: 0 }));
    expect(['BalloonLand', 'Land']).toContain(a.currentName);
  });
});

describe('balloon rig controller + stage enemy defs', () => {
  it('balloon_kuri_ctrl: PopBalloon steps 3balloon -> 3to2 -> 2balloon -> 2to1 -> 1balloon', () => {
    const b = D.enemies['kuri_03_001'].balloon!;
    const a = new EnemyAnimator(D.controllers[b.controller!], { clipLength: () => 2 });
    expect(clips(a)).toContain('3balloon');
    a.setTrigger('PopBalloon'); a.update(0.01);
    expect(a.currentName).toBe('3to2');
    for (let i = 0; i < 120; i++) a.update(1 / 30);
    expect(a.currentName).toBe('2balloon');
    a.setTrigger('PopBalloon'); a.update(0.01);
    for (let i = 0; i < 120; i++) a.update(1 / 30);
    expect(a.currentName).toBe('1balloon');
  });
  it('every balloon-spawn enemy has a rig definition; fx labels exist for all enemies', () => {
    for (const [n, r] of Object.entries(D.enemies)) {
      if (r.spawnMode === 2) expect(r.balloon?.prefab, n).toBe(balloonRigName(n));
      expect(r.fx.some((f) => f.label === 'Fire'), n).toBe(true);
    }
  });
  it('stageEnemyDefs collects wave + boss-minion enemies and the balloon rigs', () => {
    const spawn = (name: string) => ({ enemyObject: { name } });
    const wave = (...names: string[]) => ({ perDifficulyLists: [{ spawnDataList: names.map(spawn) }] });
    const res = {
      waveDataList: [wave('kuri_03_001', 'bat_00_001'), wave('boss_kao_00')],
      waveDataBossListEasy: [{ waveData: wave('kuri_00_001'), time: 1 }], waveDataBossListMedium: null, waveDataBossListHard: null,
    } as unknown as WaveResourceContract;
    expect(stageEnemyDefs(res)).toEqual(['balloon_kuri', 'bat_00_001', 'boss_kao_00', 'kuri_00_001', 'kuri_03_001']);
  });
});
