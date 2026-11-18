/**
 * UnityRandom — exact clone of `UnityEngine.Random` (Unity 5.6, Xorshift128).
 *
 * Verified against REAL Unity outputs (see README.md for the full evidence
 * chain and confidence levels):
 *
 *  - Core: Xorshift128 (Marsaglia). Next(): t = x^(x<<11); x=y; y=z; z=w;
 *    w = (w^(w>>>19)) ^ (t^(t>>>8)); return w. Confirmed by Ghidra
 *    decompilation of UnityPlayer.dll (tasvideos.org/HomePages/Randomno) and
 *    by bit-exact replay of 40 published UnityEngine.Random.Range(int,int)
 *    outputs (macklinb gist a00be6b616cbf20fa95e4227575fe50b, seed 1234).
 *
 *  - InitState(seed): x = (uint)seed; y = 1812433253*x + 1; z = 1812433253*y+1;
 *    w = 1812433253*z + 1  (MT19937-style seeding; NOT y=z=w=0!). Verified
 *    against published Random.InitState(1234) state and the decompiled
 *    InitScriptingRand default state (InitState(0)).
 *
 *  - value = (float)(w & 0x7FFFFF) * 1.192093e-07f, where the float constant is
 *    fround(1/8388607) = 0x34000001. (Low 23 bits / (2^23 - 1); can reach
 *    exactly 1.0 — matching the docs' "[0,1] both inclusive".)
 *
 *  - Range(float min, float max) = (1-t)*max + t*min with t = value
 *    (decompiled order; always consumes state; both ends inclusive).
 *
 *  - Range(int min, int max): min<max -> min + w % (max-min);
 *    max<min -> min - w % (min-max); min==max -> min WITHOUT consuming state.
 *    (All int32 wraparound like the engine.)
 *
 *  - state get/set = raw (x,y,z,w) snapshot — the SpawnFruitCommand pattern
 *    (save state, run view code, restore state) maps 1:1.
 */

import { Mathf } from '../math/Mathf';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { Quaternion } from '../math/Quaternion';

const f = Math.fround;

/** MT19937 init multiplier used by Unity's InitState. */
const MT19937 = 1812433253;

/**
 * fround(1/8388607) = float 0x34000001 — the constant Unity multiplies
 * (w & 0x7FFFFF) by to produce `value` (Ghidra decompilation shows
 * `* 1.192093e-07`). Exhaustively verified equal to fp32 division by
 * 8388607 for all 2^23 possible numerators.
 */
const VALUE_SCALE = f(1 / 8388607);

/** Unity's `Mathf.PI * 2` used by the sphere/circle helpers. */
const TWO_PI = f(Mathf.PI * 2);

/** Random.State — four uint32 words (x, y, z, w). */
export interface RandomState {
  x: number;
  y: number;
  z: number;
  w: number;
}

export class UnityRandom {
  private _x = 0;
  private _y = 0;
  private _z = 0;
  private _w = 0;

  /**
   * Unity's global generator is seeded from OS entropy at process start.
   * A simulation must ALWAYS call InitState(seed) for determinism; the
   * constructor defaults to InitState(0) so behavior is never accidentally
   * entropy-dependent.
   */
  constructor(seed?: number) {
    this.InitState(seed ?? 0);
  }

  // ------------------------------------------------------------------
  // Core
  // ------------------------------------------------------------------

  /** UnityEngine.Random.InitState(int seed). */
  InitState(seed: number): void {
    this._x = (seed | 0) >>> 0;
    this._y = (Math.imul(this._x, MT19937) + 1) >>> 0;
    this._z = (Math.imul(this._y, MT19937) + 1) >>> 0;
    this._w = (Math.imul(this._z, MT19937) + 1) >>> 0;
  }

  /** One raw Xorshift128 step; returns the new w as a uint32. */
  Next(): number {
    const t = (this._x ^ ((this._x << 11) >>> 0)) >>> 0;
    this._x = this._y;
    this._y = this._z;
    this._z = this._w;
    this._w = ((this._w ^ (this._w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return this._w;
  }

  // ------------------------------------------------------------------
  // Public UnityEngine.Random surface
  // ------------------------------------------------------------------

  /** UnityEngine.Random.value — float in [0, 1] (BOTH ends inclusive). */
  get value(): number {
    const w = this.Next();
    return f(f(w & 0x7fffff) * VALUE_SCALE);
  }

  /**
   * UnityEngine.Random.Range(float, float) — [min, max] both inclusive.
   * Native form: (1 - t) * max + t * min, t = value. Always consumes state.
   */
  Range(min: number, max: number): number {
    const t = this.value;
    const a = f(1.0 - t);
    return f(f(a * f(max)) + f(t * f(min)));
  }

  /**
   * UnityEngine.Random.Range(int, int) — min-INCLUSIVE, max-EXCLUSIVE.
   * Native (decompiled):
   *   min < max: min + w % (uint)(max - min)     (modulo => mild bias, faithful)
   *   max < min: min - w % (uint)(min - max)
   *   min == max: returns min and does NOT consume state.
   * All arithmetic wraps to int32 like the engine.
   */
  RangeInt(min: number, max: number): number {
    const imin = min | 0;
    const imax = max | 0;
    if (imin < imax) {
      const w = this.Next();
      return (imin + (w % (imax - imin))) | 0;
    }
    if (imax < imin) {
      const w = this.Next();
      return (imin - (w % (imin - imax))) | 0;
    }
    return imin; // min == max: no state consumed (verified against Unity)
  }

  /**
   * UnityEngine.Random.insideUnitSphere.
   * Implementation per andanteyk's Unity reverse-engineering (RngLab):
   *   p = asin(Range(-1,1)); t = Range(0, 2PI); r = cbrt(value)
   *   -> (r cos p cos t, r cos p sin t, r sin p). Consumes 3 draws.
   * CONFIDENCE: medium (not used by the game sim; bounds-tested only).
   */
  get InsideUnitSphere(): Vector3 {
    const p = Mathf.Asin(this.Range(-1, 1));
    const t = this.Range(0, TWO_PI);
    const r = f(Math.cbrt(this.value));
    const cp = Mathf.Cos(p);
    const sp = Mathf.Sin(p);
    const ct = Mathf.Cos(t);
    const st = Mathf.Sin(t);
    return new Vector3(f(f(r * cp) * ct), f(f(r * cp) * st), f(r * sp));
  }

  /**
   * UnityEngine.Random.onUnitSphere. Same construction with r = 1.
   * Consumes 2 draws. CONFIDENCE: medium.
   */
  get OnUnitSphere(): Vector3 {
    const p = Mathf.Asin(this.Range(-1, 1));
    const t = this.Range(0, TWO_PI);
    const cp = Mathf.Cos(p);
    const sp = Mathf.Sin(p);
    return new Vector3(f(cp * Mathf.Cos(t)), f(cp * Mathf.Sin(t)), sp);
  }

  /**
   * UnityEngine.Random.insideUnitCircle.
   *   angle = Range(0, 2PI); radius = (float)Math.Sqrt(Range(0,1)) [double sqrt]
   *   -> (radius cos angle, radius sin angle). Consumes 2 draws.
   * CONFIDENCE: medium.
   */
  get InsideUnitCircle(): Vector2 {
    const angle = this.Range(0, TWO_PI);
    const radius = f(Math.sqrt(this.Range(0, 1)));
    return new Vector2(
      f(radius * f(Math.cos(angle))),
      f(radius * f(Math.sin(angle))),
    );
  }

  /**
   * UnityEngine.Random.rotation — normalized (x,y,z,w) from 4x Range(-1,1),
   * sign-fixed so w >= 0 (andanteyk RE). NOT uniformly distributed over SO(3)
   * — a genuine Unity property. Consumes 4 draws. CONFIDENCE: medium.
   */
  get Rotation(): Quaternion {
    const x = this.Range(-1, 1);
    const y = this.Range(-1, 1);
    const z = this.Range(-1, 1);
    const w = this.Range(-1, 1);
    const sumSq = f(
      f(f(f(x * x) + f(y * y)) + f(z * z)) + f(w * w),
    );
    let reciprocalLength = f(1.0 / Mathf.Sqrt(sumSq));
    reciprocalLength = f(reciprocalLength * (w < 0 ? -1 : 1));
    return new Quaternion(
      f(x * reciprocalLength),
      f(y * reciprocalLength),
      f(z * reciprocalLength),
      f(w * reciprocalLength),
    );
  }

  // ------------------------------------------------------------------
  // Random.state — save/restore (SpawnFruitCommand pattern)
  // ------------------------------------------------------------------

  /** UnityEngine.Random.state getter — returns a detached snapshot (copy). */
  get state(): RandomState {
    return { x: this._x, y: this._y, z: this._z, w: this._w };
  }

  /** UnityEngine.Random.state setter — copies the four words in. */
  set state(s: RandomState) {
    this._x = s.x >>> 0;
    this._y = s.y >>> 0;
    this._z = s.z >>> 0;
    this._w = s.w >>> 0;
  }
}

/**
 * The one global generator, mirroring the static `UnityEngine.Random` class.
 * The sim owns it: InitState at session start; view code that consumes RNG
 * must save/restore `unityRandom.state` around the call (SpawnFruitCommand
 * does exactly this).
 */
export const unityRandom = new UnityRandom();

/** Convenience aliases mirroring the static UnityEngine.Random API. */
export const UnityRandomStatic = {
  InitState: (seed: number): void => unityRandom.InitState(seed),
  Next: (): number => unityRandom.Next(),
  get value(): number {
    return unityRandom.value;
  },
  Range: (min: number, max: number): number => unityRandom.Range(min, max),
  RangeInt: (min: number, max: number): number => unityRandom.RangeInt(min, max),
  get InsideUnitSphere(): Vector3 {
    return unityRandom.InsideUnitSphere;
  },
  get OnUnitSphere(): Vector3 {
    return unityRandom.OnUnitSphere;
  },
  get InsideUnitCircle(): Vector2 {
    return unityRandom.InsideUnitCircle;
  },
  get Rotation(): Quaternion {
    return unityRandom.Rotation;
  },
  get state(): RandomState {
    return unityRandom.state;
  },
  set state(s: RandomState) {
    unityRandom.state = s;
  },
};
