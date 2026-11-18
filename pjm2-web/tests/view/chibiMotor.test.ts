// Q4.Chibi movement/animation port (ChibiMotor): constants + control flow from decomp/src/Q4/Chibi.cs.
import { describe, expect, it } from 'vitest';
import { ChibiMotor, CHIBI_CONST, rotateYawTowards, lookYaw, type V3 } from '../../src/view/characters/ChibiMotor';
import { CHIBI_VIEW_DATA } from '../../src/view/characters/chibiViewData.generated';

const clips = CHIBI_VIEW_DATA.clips as Record<string, { length: number | null }>;
const flat = (a: V3, b: V3): number | null => (b.y <= 0 && a.y >= 0 ? 0 : null);
function seq(...v: number[]): () => number { let i = 0; return () => v[i++ % v.length]; }
function make(opts: { linecast?: typeof flat | null; rand?: () => number } = {}): ChibiMotor {
  return new ChibiMotor(
    { clipLength: (n) => clips[n]?.length ?? 0, linecast: opts.linecast === undefined ? flat : opts.linecast, rand: opts.rand ?? seq(0.5) },
    { x: 0, y: 0, z: 0 }, 0,
  );
}
function run(m: ChibiMotor, seconds: number, dt = 1 / 60): void { for (let t = 0; t < seconds; t += dt) m.update(dt); }

describe('ChibiMotor', () => {
  it('serialized chibi values come from the bundle (idle interval 4..16, AccMin 10, AccMax 50)', () => {
    const m = make();
    expect(m.randomIdleMin).toBe(4);
    expect(m.randomIdleMax).toBe(16);
    expect(m.accMin).toBe(10);
    expect(m.accMax).toBe(50);
  });

  it('chases DestPos with ease-out, stops on it, faces the travel direction', () => {
    const m = make();
    m.destPos = { x: 3, y: 0, z: 0 };
    run(m, 4);
    expect(Math.abs(m.pos.x - 3)).toBeLessThan(0.05);
    expect(Math.abs(m.vel.x)).toBeLessThan(0.3);
    expect(m.yawDeg).toBeCloseTo(90, 0); // +X = yaw 90 (lookYaw)
    expect(m.onGround).toBe(true);
  });

  it('runs: MoveSpeed > 0.05 enters the run state, back to Idle when it arrives', () => {
    const m = make();
    m.destPos = { x: 3, y: 0, z: 0 };
    run(m, 0.6);
    expect(m.animator.currentName).toBe('run');
    run(m, 5);
    expect(m.animator.currentName).toBe('Idle');
  });

  it('is grounded by the terrain linecast and does not fall through; without ground it falls forever', () => {
    const m = make();
    run(m, 1);
    expect(m.pos.y).toBe(0);
    const f = make({ linecast: null });
    run(f, 1);
    expect(f.pos.y).toBeLessThan(-5);
  });

  it('IsEnemyClose triggers panic jumps (vel.y in [3,5]); the PanicJump state needs planar MoveSpeed > 0.05', () => {
    const m = make({ rand: seq(0.5) });
    run(m, 0.2); // land
    m.isEnemyClose = true; // jump delay Random(0.25, 1.5)
    let jumped = false, sawPanic = false;
    for (let i = 0; i < 60 * 3; i++) {
      m.update(1 / 60);
      if (m.pos.y > 0.2) jumped = true;
      if (m.animator.currentName === 'PanicJump') sawPanic = true;
    }
    expect(jumped).toBe(true);
    expect(sawPanic).toBe(false); // hopping on the spot: MoveSpeed is planar (disassembly-verified) -> no state change
    // peak of a Random(3,5)=4 jump with gravity -20 is v²/2g = 0.4
    let peak = 0;
    const n = make({ rand: seq(0.5) });
    n.isEnemyClose = true;
    for (let i = 0; i < 60 * 3; i++) { n.update(1 / 60); peak = Math.max(peak, n.pos.y); }
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThan(0.5);
  });

  it('IsScared plays fear until Scared clears', () => {
    const m = make();
    run(m, 0.3);
    m.isScared = true;
    run(m, 0.5);
    expect(m.animator.currentName).toBe('fear');
    m.destPos = { x: 5, y: 0, z: 0 };
    run(m, 0.5);
    // fear has no MoveSpeed route: the state is left only when Scared clears (exit time 0.9)
    expect(m.animator.currentName).toBe('fear');
    m.isScared = false;
    run(m, 3.5); // fear loops (2.67 s); the exit-time 0.9 crossing arrives at 2.4 s
    expect(['run', 'Idle']).toContain(m.animator.currentName);
    expect(CHIBI_CONST.SCARED_SPEED_CAP).toBe(0.75);
  });

  it('PlayerClose: rising edge schedules a happy hop and the chibi faces the player', () => {
    const m = make({ rand: seq(0.5) });
    run(m, 0.2);
    m.playerPos = { x: 0, y: 0, z: 5 };
    m.isPlayerClose = true;
    let peak = 0;
    for (let i = 0; i < 60 * 2; i++) { m.update(1 / 60); peak = Math.max(peak, m.pos.y); }
    expect(peak).toBeGreaterThan(0.3);
    expect(m.yawDeg).toBeCloseTo(0, 0);
  });

  it('death: Die trigger, destroyed after DeadTime 1.0 s, no movement while dead', () => {
    const m = make();
    run(m, 0.2);
    m.destPos = { x: 4, y: 0, z: 0 };
    m.onKilled();
    run(m, 0.5);
    expect(m.animator.currentName).toBe('Die');
    expect(m.pos.x).toBe(0);
    expect(m.destroyed).toBe(false);
    run(m, 0.6);
    expect(m.destroyed).toBe(true);
  });

  it('NotifyBeingAttacked: freezes the chibi and sets the flee DestPos 1 unit from the attacker', () => {
    const m = make();
    run(m, 0.2);
    m.notifyBeingAttacked({ x: 0, y: 0, z: -3 });
    run(m, 3);
    // Chibi.Update (@0x741D50): while m_IsBeingAttacked only DestPos = m_AttackedDestPos is written; UpdatePosition is
    // skipped, so the chibi cowers in place (it does not walk to the flee spot).
    expect(m.destPos.z).toBeCloseTo(1, 5);
    expect(m.pos.z).toBe(0);
  });

  it('stage clear: normal at step 0, perfect only at step 1; disables hops; trigger after Random(0.25,1.5)', () => {
    const a = make({ rand: seq(0.5) });
    a.onStageClearedScreen(1, false); // wrong step -> ignored
    run(a, 1);
    expect(a.animator.currentName).toBe('Idle');
    a.onStageClearedScreen(0, false);
    run(a, 1.2); // Random(0.25, 1.5) = 0.875 s + 0.25 s blend
    expect(a.animator.currentName).toBe('StageClearedNormal');
    const b = make({ rand: seq(0.5) });
    b.onStageClearedScreen(0, true); // perfect: step 0 ignored
    run(b, 3);
    expect(b.animator.currentName).toBe('Idle');
    b.onStageClearedScreen(1, true); // 1.0 + 0.875 s delay
    run(b, 1.5);
    expect(b.animator.currentName).toBe('Idle');
    run(b, 0.8);
    expect(b.animator.currentName).toBe('StageClearedPerfect');
  });

  it('rotateYawTowards takes the short way at 180 deg/s; lookYaw is atan2(x, z)', () => {
    expect(rotateYawTowards(350, 10, 5)).toBe(355);
    expect(rotateYawTowards(0, 90, 200)).toBe(90);
    expect(lookYaw(1, 0)).toBeCloseTo(90);
    expect(lookYaw(0, -1)).toBeCloseTo(180);
  });
});
