/**
 * UnityRandom tests.
 *
 * Two classes of golden data:
 *
 *  1. UNITY-VERIFIED vectors: outputs recorded from a real Unity player
 *     (Random.InitState(1234), sequential calls) published in
 *     https://gist.github.com/macklinb/a00be6b616cbf20fa95e4227575fe50b
 *     (tested by its author against Unity 4.7.0f1 .. 2020.1.17f1, which
 *     brackets our target 5.6.5p1). We replay the ENTIRE published sequence
 *     (25 int Range calls, 5 value calls, 35 float Range calls) and compare
 *     integer results bit-exactly and float results through Mono's G7
 *     ToString formatting (7 significant digits — the precision Unity printed
 *     them at).
 *
 *  2. REGRESSION-BASELINE snapshots: first-N outputs of OUR implementation for
 *     seeds 1 and 12345, recorded bit-exact (float32 bit patterns). These are
 *     NOT independently Unity-verified — they pin current behavior so any
 *     future change is deliberate. Authoritative validation against the game's
 *     eboot.elf disassembly is VERIFICATION-PENDING (see src/engine/rng/README.md).
 */

import { describe, it, expect } from 'vitest';
import { UnityRandom } from '../../src/engine/rng/UnityRandom';
import type { RandomState } from '../../src/engine/rng/UnityRandom';

const f = Math.fround;
const IMAX = 2147483647;
const IMIN = -2147483648;
const FMAX = f(3.4028234663852886e38); // float.MaxValue
const FMIN = f(-3.4028234663852886e38); // float.MinValue

function bits(v: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v);
  return dv.getUint32(0);
}

/** Mono/.NET Framework Single.ToString(): 7 significant digits, trailing zeros
 *  stripped, C#-style exponent (E+38). This is how the Unity-verified table
 *  below was printed inside the Unity editor. */
function g7(v: number): string {
  if (!isFinite(v)) return v > 0 ? 'Infinity' : v < 0 ? '-Infinity' : 'NaN';
  let s = v.toPrecision(7);
  if (s.includes('e')) {
    const [m, e] = s.split('e');
    let mm = m;
    if (mm.includes('.')) mm = mm.replace(/0+$/, '').replace(/\.$/, '');
    const exp = parseInt(e, 10);
    return mm + 'E' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// ---------------------------------------------------------------------------
// 1. UNITY-VERIFIED vectors (macklinb gist, real Unity, InitState(1234))
// ---------------------------------------------------------------------------

describe('UnityRandom vs published real-Unity outputs (seed 1234)', () => {
  it('InitState(1234) produces the documented MT19937-style state', () => {
    // Published by Bunny83 (read back from UnityEngine.Random.state in-editor):
    const r = new UnityRandom();
    r.InitState(1234);
    expect(r.state).toEqual({ x: 1234, y: 3159640283, z: 3392860520, w: 3460949513 });
  });

  it('InitState(0) matches the decompiled InitScriptingRand default state', () => {
    const r = new UnityRandom();
    r.InitState(0);
    expect(r.state).toEqual({ x: 0, y: 1, z: 0x6c078966, w: 0x714acb3f });
  });

  it('replays the full published call sequence bit-exactly', () => {
    const r = new UnityRandom();
    r.InitState(1234);

    // int Range tables, in harness order. [state.w after call, result]
    const intTables: Array<{ min: number; max: number; rows: Array<[number, number]> }> = [
      {
        min: 0, max: IMAX, rows: [
          [3463400838, 1315917191], [3496203776, 1348720129], [3452947669, 1305464022],
          [1278673611, 1278673611], [4169168310, 2021684663]],
      },
      {
        min: 0, max: IMIN, rows: [
          [916287344, -916287344], [2240259090, -92775442], [1901252403, -1901252403],
          [2323917162, -176433514], [1472147877, -1472147877]],
      },
      {
        min: IMIN, max: IMAX, rows: [
          [4020283508, 1872799860], [141347300, -2006136348], [2735243002, 587759354],
          [227819815, -1919663833], [3885870057, 1738386409]],
      },
      {
        min: IMAX, max: IMIN, rows: [
          [2312142103, -164658456], [1775189369, 372294278], [3338523678, -1191040031],
          [3426086347, -1278602700], [3322349983, -1174866336]],
      },
      {
        // min == max: Unity returns min WITHOUT consuming state
        min: IMIN, max: IMIN, rows: [
          [3322349983, IMIN], [3322349983, IMIN], [3322349983, IMIN],
          [3322349983, IMIN], [3322349983, IMIN]],
      },
    ];
    for (const tb of intTables) {
      for (const [wAfter, expected] of tb.rows) {
        const got = r.RangeInt(tb.min, tb.max);
        expect(got, `RangeInt(${tb.min}, ${tb.max})`).toBe(expected);
        expect(r.state.w, 'state.w after call').toBe(wAfter);
      }
    }

    // value x5 — compare via the exact string Unity printed (G7)
    const valueTable: Array<[number, string]> = [
      [3593715923, '0.4043221'], [4266042159, '0.551855'], [2642301593, '0.9868958'],
      [1674312536, '0.593608'], [733387434, '0.426595'],
    ];
    for (const [wAfter, printed] of valueTable) {
      const got = r.value;
      expect(r.state.w).toBe(wAfter);
      expect(g7(got), 'value').toBe(printed);
    }

    // float Range tables
    const floatTables: Array<{ min: number; max: number; rows: Array<[number, string]> }> = [
      {
        min: 0, max: 100, rows: [
          [3760331560, '73.35463'], [2410116911, '69.16753'], [3012185272, '91.95337'],
          [745993129, '7.068896'], [3699201620, '2.080286']],
      },
      {
        min: 0, max: 100000, rows: [
          [1758944507, '31747.49'], [2312712917, '30313.62'], [313095164, '67614.8'],
          [609241099, '37280.14'], [4138924286, '60177.63']],
      },
      {
        min: 0, max: FMAX, rows: [
          [3065852775, '1.775827E+38'], [4023550175, '1.209507E+38'], [1231330622, '7.280383E+37'],
          [678488548, '4.010639E+37'], [1997128070, '3.143466E+38']],
      },
      {
        min: 0, max: FMIN, rows: [
          [212231104, '-2.382252E+38'], [1632010759, '-1.528401E+38'], [3470161922, '-1.104089E+38'],
          [4159346095, '-5.693158E+37'], [3362607345, '-4.967007E+37']],
      },
      {
        min: FMIN, max: FMAX, rows: [
          [2641274177, '-2.480102E+38'], [3758475398, '3.095331E+38'], [1138851524, '-1.78091E+38'],
          [3785966737, '1.208649E+38'], [151368008, '3.100158E+38']],
      },
      {
        min: FMAX, max: FMIN, rows: [
          [3347712278, '-2.869245E+38'], [2413123709, '1.13493E+38'], [619907290, '2.713464E+38'],
          [5796605, '1.299941E+38'], [2534213977, '-2.709683E+38']],
      },
      {
        // min == max float Range DOES consume state and returns min (per Unity printout)
        min: FMIN, max: FMIN, rows: [
          [2990456181, '-3.402823E+38'], [238536240, '-3.402823E+38'], [3443233425, '-3.402823E+38'],
          [847449518, '-3.402823E+38'], [1964100510, '-3.402823E+38']],
      },
    ];
    for (const tb of floatTables) {
      for (const [wAfter, printed] of tb.rows) {
        const got = r.Range(tb.min, tb.max);
        expect(r.state.w, 'state.w after call').toBe(wAfter);
        expect(g7(got), `Range(${tb.min}, ${tb.max})`).toBe(printed);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. REGRESSION-BASELINE snapshots (our implementation; NOT Unity-verified)
// ---------------------------------------------------------------------------

describe('UnityRandom regression baselines (REGRESSION-BASELINE, not Unity-verified)', () => {
  const baselines: Array<{
    seed: number;
    raw: number[];
    valueBits: number[];
    rangeFBits: number[];
    rangeI: number[];
    stateAfterRangeI: RandomState;
  }> = [
    {
      seed: 1,
      raw: [3690984874, 2346916618, 2899782266, 2285563962, 2890667570, 1071936506, 712313478, 1972475090],
      valueBits: [0x3f7feb56, 0x3f463616, 0x3f2e54f5, 0x3eebc0ea, 0x3f182c65, 0x3f48e7f6, 0x3f6a150e, 0x3e0ca691],
      rangeFBits: [0xc05fe24b, 0xc00cedc0, 0xbfd53440, 0xbecb9544], // Range(-3.5, 2.25)
      rangeI: [17, 17, 9, 13], // RangeInt(7, 19)
      stateAfterRangeI: { x: 3690984874, y: 2346916618, z: 2899782266, w: 2285563962 },
    },
    {
      seed: 12345,
      raw: [692788716, 3673367756, 558115199, 1391799970, 589364589, 1622567041, 1622784569, 2613184690],
      valueBits: [0x3f163bd9, 0x3f66499a, 0x3f0852ff, 0x3f6a5d46, 0x3e83f5b5, 0x3ed9a206, 0x3ee6e8e6, 0x3f041165],
      rangeFBits: [0xbf8fec10, 0xc03b09ce, 0xbf4fdd3a, 0xc040e614], // Range(-3.5, 2.25)
      rangeI: [7, 15, 18, 17], // RangeInt(7, 19)
      stateAfterRangeI: { x: 692788716, y: 3673367756, z: 558115199, w: 1391799970 },
    },
  ];

  for (const b of baselines) {
    it(`seed ${b.seed}: raw uint32 sequence`, () => {
      const r = new UnityRandom();
      r.InitState(b.seed);
      for (const expected of b.raw) {
        expect(r.Next()).toBe(expected);
      }
    });

    it(`seed ${b.seed}: value bit patterns`, () => {
      const r = new UnityRandom();
      r.InitState(b.seed);
      for (const expected of b.valueBits) {
        expect(bits(r.value)).toBe(expected);
      }
    });

    it(`seed ${b.seed}: Range(float) bit patterns`, () => {
      const r = new UnityRandom();
      r.InitState(b.seed);
      for (const expected of b.rangeFBits) {
        expect(bits(r.Range(-3.5, 2.25))).toBe(expected);
      }
    });

    it(`seed ${b.seed}: RangeInt values and resulting state`, () => {
      const r = new UnityRandom();
      r.InitState(b.seed);
      for (const expected of b.rangeI) {
        expect(r.RangeInt(7, 19)).toBe(expected);
      }
      expect(r.state).toEqual(b.stateAfterRangeI);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Determinism / state semantics
// ---------------------------------------------------------------------------

describe('UnityRandom determinism and state', () => {
  it('same InitState -> identical interleaved sequences', () => {
    const a = new UnityRandom();
    const b = new UnityRandom();
    a.InitState(777);
    b.InitState(777);
    for (let i = 0; i < 500; i++) {
      expect(a.Next()).toBe(b.Next());
      expect(bits(a.value)).toBe(bits(b.value));
      expect(bits(a.Range(-10, 10))).toBe(bits(b.Range(-10, 10)));
      expect(a.RangeInt(0, 100)).toBe(b.RangeInt(0, 100));
    }
  });

  it('different seeds diverge', () => {
    const a = new UnityRandom();
    const b = new UnityRandom();
    a.InitState(1);
    b.InitState(2);
    expect(a.Next()).not.toBe(b.Next());
  });

  it('re-InitState resets the stream', () => {
    const r = new UnityRandom();
    r.InitState(42);
    const first = [r.Next(), r.Next(), r.Next()];
    for (let i = 0; i < 50; i++) r.Next();
    r.InitState(42);
    expect([r.Next(), r.Next(), r.Next()]).toEqual(first);
  });

  it('state save/restore round-trips (SpawnFruitCommand pattern)', () => {
    const r = new UnityRandom();
    r.InitState(2024);
    for (let i = 0; i < 10; i++) r.Next();

    const saved: RandomState = r.state; // Random.State rngState = Random.state;
    const expected = [r.Next(), r.Next(), r.Next(), r.Next(), r.Next()];

    // Simulate view-side consumption shifting the stream:
    for (let i = 0; i < 37; i++) r.Next();
    r.value;
    r.Range(0, 1);

    r.state = saved; // Random.state = rngState;
    const replayed = [r.Next(), r.Next(), r.Next(), r.Next(), r.Next()];
    expect(replayed).toEqual(expected);
  });

  it('state getter returns a detached copy', () => {
    const r = new UnityRandom();
    r.InitState(9);
    const s = r.state;
    s.x = 123456; // mutating the snapshot must not touch the generator
    s.w = 654321;
    expect(r.state.x).not.toBe(123456);
    const r2 = new UnityRandom();
    r2.InitState(9);
    expect(r.Next()).toBe(r2.Next());
  });

  it('state setter coerces to uint32', () => {
    const r = new UnityRandom();
    r.state = { x: -1, y: -2, z: 3000000000, w: 0 };
    const s = r.state;
    expect(s.x).toBe(0xffffffff);
    expect(s.y).toBe(0xfffffffe);
    expect(s.z).toBe(3000000000);
  });
});

// ---------------------------------------------------------------------------
// 4. Range semantics over large samples
// ---------------------------------------------------------------------------

describe('UnityRandom Range bounds over 100k samples', () => {
  it('value stays within [0, 1] (both ends attainable per docs)', () => {
    const r = new UnityRandom();
    r.InitState(31337);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 100000; i++) {
      const v = r.value;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeLessThan(0.01); // spreads over the full range
    expect(max).toBeGreaterThan(0.99);
  });

  it('Range(float) is inclusive of both ends and never leaves [min, max]', () => {
    const r = new UnityRandom();
    r.InitState(1234567);
    const min = -3.5;
    const max = 2.25;
    let sawLowHalf = false;
    let sawHighHalf = false;
    for (let i = 0; i < 100000; i++) {
      const v = r.Range(min, max);
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
      expect(Object.is(v, f(v))).toBe(true); // fp32 discipline
      if (v < 0) sawLowHalf = true;
      if (v > 1.5) sawHighHalf = true;
    }
    expect(sawLowHalf).toBe(true);
    expect(sawHighHalf).toBe(true);
    // Range(min, min) with min == max: formula still runs (consumes), result
    // is within a couple of ULP of min (fp32 (1-t)*m + t*m is not exact for
    // extreme m; for ordinary m it returns m):
    const same = r.Range(5, 5);
    expect(Math.abs(same - 5)).toBeLessThan(1e-5);
  });

  it('RangeInt(5, 10): min-inclusive / max-exclusive, full coverage', () => {
    const r = new UnityRandom();
    r.InitState(987654);
    const seen = new Set<number>();
    for (let i = 0; i < 100000; i++) {
      const v = r.RangeInt(5, 10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('RangeInt handles negatives, min==max (no consumption) and max<min', () => {
    const r = new UnityRandom();
    r.InitState(555);
    for (let i = 0; i < 10000; i++) {
      const v = r.RangeInt(-8, -2);
      expect(v).toBeGreaterThanOrEqual(-8);
      expect(v).toBeLessThan(-2);
    }
    // min == max: returns min and does NOT consume state (Unity-verified)
    const before = r.state;
    expect(r.RangeInt(7, 7)).toBe(7);
    expect(r.state).toEqual(before);
    // max < min: mirrored branch, result within (max, min]
    for (let i = 0; i < 10000; i++) {
      const v = r.RangeInt(10, 4);
      expect(v).toBeGreaterThan(4);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Geometric helpers (in-bounds properties; exact formulas are RE-based)
// ---------------------------------------------------------------------------

describe('UnityRandom geometric helpers', () => {
  it('InsideUnitSphere stays within the unit sphere', () => {
    const r = new UnityRandom();
    r.InitState(11);
    let anyLarge = false;
    for (let i = 0; i < 10000; i++) {
      const p = r.InsideUnitSphere;
      expect(p.sqrMagnitude).toBeLessThanOrEqual(f(1) + 1e-6);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      if (p.sqrMagnitude > 0.25) anyLarge = true;
    }
    expect(anyLarge).toBe(true); // not collapsing to the origin
  });

  it('OnUnitSphere has unit length', () => {
    const r = new UnityRandom();
    r.InitState(22);
    for (let i = 0; i < 10000; i++) {
      const p = r.OnUnitSphere;
      expect(Math.abs(p.magnitude - 1)).toBeLessThan(1e-4);
    }
  });

  it('InsideUnitCircle stays within the unit circle', () => {
    const r = new UnityRandom();
    r.InitState(33);
    for (let i = 0; i < 10000; i++) {
      const p = r.InsideUnitCircle;
      expect(p.sqrMagnitude).toBeLessThanOrEqual(f(1) + 1e-6);
    }
  });

  it('Rotation returns unit quaternions with w >= 0 (sign-fixed, per RE)', () => {
    const r = new UnityRandom();
    r.InitState(44);
    for (let i = 0; i < 10000; i++) {
      const q = r.Rotation;
      const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
      expect(Math.abs(lenSq - 1)).toBeLessThan(1e-5);
      expect(q.w).toBeGreaterThanOrEqual(0);
    }
  });

  it('geometric helpers consume the documented number of draws', () => {
    const r = new UnityRandom();
    const r2 = new UnityRandom();
    r.InitState(66);
    r2.InitState(66);
    void r.OnUnitSphere;
    r2.Range(-1, 1); // asin arg
    r2.Range(0, f(MathfPI() * 2)); // angle
    expect(r.state).toEqual(r2.state);

    r.InitState(67);
    r2.InitState(67);
    void r.InsideUnitSphere;
    r2.Range(-1, 1);
    r2.Range(0, f(MathfPI() * 2));
    r2.value;
    expect(r.state).toEqual(r2.state);
  });
});

function MathfPI(): number {
  return f(3.14159274);
}
