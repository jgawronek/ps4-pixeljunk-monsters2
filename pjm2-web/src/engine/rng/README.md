# engine/rng — `UnityEngine.Random` (Unity 5.6) exact clone

`UnityRandom.ts` replicates the engine-global Xorshift128 generator that
PixelJunk Monsters 2's simulation consumes (`GameCoreObject.RandomRange` →
`Random.Range(float)` / `Random.Range(int)`, and the `Random.state`
save/restore around view calls in `SpawnFruitCommand`).

## Algorithm (all uint32)

```
Next():  t = x ^ (x << 11);
         x = y; y = z; z = w;
         w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
         return w;
```

`InitState(seed)` — **MT19937-style seed expansion, NOT `y=z=w=0`**:

```
x = seed >>> 0
y = (1812433253 * x + 1) >>> 0
z = (1812433253 * y + 1) >>> 0
w = (1812433253 * z + 1) >>> 0
```

> ⚠️ This **corrects the port blueprint**, which assumed `y=z=w=0`. Evidence:
> 1. MoatShrimp's empirical recovery, confirmed against real Unity 4.6 →
>    2020.1 (discussions.unity.com/t/825186/5) — brackets 5.6.5p1.
> 2. Published in-editor state for `InitState(1234)` (Bunny83):
>    `[1234, 3159640283, 3392860520, 3460949513]` — reproduced bit-exactly.
> 3. Ghidra decompilation of `Random_CUSTOM_InitState` (UnityPlayer.dll
>    2020.3.48f1, debug symbols; tasvideos.org/HomePages/Randomno/UnityRNG):
>    `s1 = s0 * 0x6c078965 + 1; ...` (0x6c078965 = 1812433253), and the
>    process-start default state `(0, 1, 0x6c078966, 0x714acb3f)` equals
>    `InitState(0)` — both reproduced bit-exactly by this implementation.

## Float conversion — THE decision (confidence: HIGH)

```
value = (float)(w & 0x7FFFFF) * C,   C = fround(1/8388607) = 0x34000001 = 1.1920930376e-7
```

i.e. the **low 23 bits** of `w` divided by **2²³−1** — NOT `w / 2^32` and NOT
`w / (2^32−1)`. Consequences: `value ∈ [0, 1]` with **both ends attainable**
(`w & 0x7FFFFF == 0x7FFFFF` gives exactly `1.0`), matching Unity's documented
"inclusive" range.

Evidence chain:
1. **Ghidra decompilation of the engine binary** (Randomno, UnityPlayer.dll
   2020.3.48f1 with Unity debug symbols):
   `return (float)(uVar3 & 0x7fffff) * 1.192093e-07;`
2. **andanteyk's independent RE** (gist 11967dd313c07136f542ba64b80411bb,
   RngLab project): `value => (Next() & 0x7fffffu) / 8388607.0f`.
3. **ForgeOracleClient RE** (Valheim): `(float)(raw & 0x7FFFFF) * 1.192093E-07f`.
4. **Bit-exact replay of 40 published real-Unity outputs** (macklinb gist
   a00be6b616cbf20fa95e4227575fe50b, recorded inside Unity with
   `InitState(1234)` on Unity ∈ [4.7.0f1, 2020.1.17f1]): all 5 `value` rows
   and all 35 `Range(float)` rows match at the printed 7-significant-digit
   precision (see `tests/engine/rng.test.ts`). macklinb's own `<<9 / 2^32`
   approximation does NOT match Unity exactly — ours does.
5. Multiply-vs-divide is moot: exhaustively verified (all 2²³ numerators) that
   `fround(n * fround(1/8388607))` ≡ `fround(n / 8388607)` — the
   `n/2^23` variant differs on 8388607/8388608 of inputs, ruling it out.

The Ghidra constant `1.192093e-07` is ambiguous at 7 digits between `2^-23`
(0x34000000) and `fround(1/8388607)` (0x34000001); the published Unity outputs
and the documented inclusive-1.0 behavior select **0x34000001** (with
0x34000000, `value` could never reach 1.0 and rows 1/3 of the value table
would miss by 1 ULP).

## `Range(float min, float max)` (confidence: HIGH)

Decompiled native body: `(1 − t) * max + t * min` with `t = value`, each step
fp32 (we fround per op in exactly that grouping). Both ends **inclusive**;
state is **always consumed**, even for `min == max` (published Unity outputs
confirm the state advances while the result stays `min`). Verified against all
35 published float rows, including `float.MinValue/MaxValue` extremes.

## `Range(int min, int max)` — modulo, NOT rejection (confidence: HIGH)

Decompiled `Random_CUSTOM_RandomRangeInt`:

```
min < max:  consume w; return min + (int)(w % (uint)(max - min));   // min-incl, max-EXCL
max < min:  consume w; return min - (int)(w % (uint)(min - max));
min == max: return min;                                             // NO state consumed
```

- **Modulo bias is real and faithfully reproduced** (no rejection sampling) —
  `RangeInt(0, 3)` favors low values by ~0.00000007%.
- All arithmetic wraps to int32 like the engine (`| 0` in JS ≡ x86 wrap).
- The `min == max` no-consumption path is confirmed by the published table
  (state `s3` unchanged across 5 calls) — this matters for replay parity.
- Verified bit-exactly against all 20 published consuming int rows (including
  `int.MinValue`/`int.MaxValue` reversed-range cases).

## State save/restore (SpawnFruitCommand-compatible)

`get state()` returns a **detached** `{x, y, z, w}` snapshot (uint32s);
`set state(s)` copies the words back (with `>>> 0` coercion). The ported
command maps 1:1:

```ts
const rngState = unityRandom.state;      // Random.State rngState = Random.state;
... CreateFruit(view-side draws) ...     // consumes RNG
unityRandom.state = rngState;            // Random.state = rngState;
```

`unityRandom` is the process-global generator mirroring the static
`UnityEngine.Random` class (`UnityRandomStatic` exposes the static-style API).
Unity seeds it from OS entropy at startup; our default constructor calls
`InitState(0)` so nothing is ever accidentally entropy-dependent — **the sim
bootstrapper must call `InitState(seed)` explicitly**.

## Geometric helpers (confidence: MEDIUM — not used by the game sim)

`InsideUnitSphere`, `OnUnitSphere`, `InsideUnitCircle`, `Rotation` follow
andanteyk's reverse-engineered formulas (draw counts: 3, 2, 2, 4):
sphere/circle use `p = asin(Range(−1,1))`, `t = Range(0, 2π)` polar sampling;
`InsideUnitSphere` scales by `cbrt(value)`; `Rotation` normalizes 4×
`Range(−1,1)` with a `w ≥ 0` sign fix (hence NOT uniform over SO(3) — a
genuine Unity property). A grep of `decomp/src/GameCore` shows the sim only
uses `Range(float)`, `Range(int)`, and `state`, so these are provided for
view-side parity; they are bounds-tested, not golden-tested.

## Tests

`tests/engine/rng.test.ts`:
- **UNITY-VERIFIED**: full sequential replay of the published InitState(1234)
  session — 25 int rows (bit-exact + per-call state), 5 value rows and 35
  float Range rows (G7-formatted string match against the strings real Unity
  printed), InitState(1234)/InitState(0) state vectors.
- **REGRESSION-BASELINE** (our implementation, NOT independently
  Unity-verified): seed 1 and 12345 first-8 raw uint32s, first-8 `value` bit
  patterns, Range(-3.5, 2.25) bit patterns, RangeInt(7, 19) values, resulting
  state — pinned so any future change is deliberate.
- Determinism, re-seed reset, state save/restore round-trip, snapshot
  detachment, uint32 coercion, 100k-sample bounds for `value`/`Range`/
  `RangeInt` (incl. min==max no-consumption and max<min branch), 10k-sample
  bounds for the geometric helpers.

## VERIFICATION-PENDING

Authoritative validation will later be done by disassembling the Unity 5.6.5p1
PS4 engine inside the game's `eboot.elf` (deliberately NOT attempted here).
Items to confirm there:
1. Xorshift128 shift constants (11/19/8) and update order — assumed identical
   to 2020.3 decompilation + 4.7–2020.1 published outputs (very likely stable).
2. The `value` scale constant's exact bits (`0x34000001`).
3. `Range(float)` operation order `(1−t)*max + t*min` (fp32 regrouping can
   matter at 1 ULP for extreme magnitudes).
4. `RangeInt` branch structure and the no-consumption equal case.
5. Whether the 5.6.5p1 PS4 build's geometric helpers match andanteyk's
   2019+ RE (they may predate a refactor).
