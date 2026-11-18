# engine/math — Unity 5.6.5p1-exact math (fp32)

TypeScript port of the `UnityEngine` math types used by the PixelJunk Monsters 2
simulation: `Mathf`, `Vector2`, `Vector3`, `Quaternion`. Target semantics:
**Unity 5.6.5p1 on PS4**, which computes everything in IEEE-754 **float32**.
`Matrix4x4` was intentionally skipped — nothing in Quaternion/LookRotation
needs a matrix type (the Shepperd branch form works on 9 locals).

## The fround discipline (non-negotiable)

JS numbers are float64; C# `float` is float32. Floating-point addition and
multiplication are **not associative**, so a single un-rounded intermediate
makes every downstream value diverge from the console simulation. Rules
enforced in every file here:

1. `const f = Math.fround` and **every** arithmetic operation is wrapped:
   `f(a + b)`, `f(a * b)`, `f(a / b)`, `f(-a)` — operands are already fp32,
   the wrapper re-rounds the result. This mirrors one C# fp32 op = one
   rounding.
2. **Every stored component is fp32.** Vector2/Vector3/Quaternion are mutable
   struct-like classes whose `x/y/z/w` are accessor pairs; the setter applies
   `f(v)`. There is no way to get a non-fp32 value into a field.
3. Operation **grouping is replicated literally** from the reference source
   (left-associative, same order): e.g. `Dot` is `((ax·bx + ay·by) + az·bz)`,
   `sqrMagnitude` is `((x·x + y·y) + z·z)`, `q*v` follows the exact managed
   operator body. Grouping is part of the result in fp32.
4. Values are *held* in float64 containers but always *equal* their fp32
   rounding (`Object.is(v, Math.fround(v))` holds everywhere — asserted in
   tests). No double-precision accumulation ever survives an operation.
5. Constants: `PI = f(3.14159274)`, `Deg2Rad = f(0.0174532924)`,
   `Rad2Deg = f(57.29578)` — the exact literals from Unity's managed source.
   Vector/Quaternion "constants" (`zero`, `up`, `identity`, …) are **getters
   returning fresh instances**, matching C# struct-copy semantics (mutating
   one cannot corrupt shared state).
6. float→int conversions (`FloorToInt`, `CeilToInt`, `RoundToInt`) saturate
   like x86-64 `cvttsd2si` (out-of-range/NaN → `int.MinValue`), which is what
   PS4 Mono/IL2CPP does. `RoundToInt`/`Round` use **banker's rounding**
   (half-to-even, C# `Math.Round` default): 0.5→0, 1.5→2, 2.5→2, −0.5→0.
7. Transcendentals: managed `Mathf` is pure C# — `(float)Math.Sin(f)` etc. —
   so we compute `f(Math.sin(f(x)))` (double-precision libm, rounded once to
   fp32). Residual risk: V8's libm vs PS4 Mono's libm may differ by ≤1 ULP on
   rare inputs, and `sqrtf` vs `f(sqrt(double))` can differ in double-rounding
   edge cases (~2⁻²⁹ probability). Flagged VERIFICATION-PENDING below.

## Semantics replicated (with sources)

### Managed reference source (OFFICIAL — highest confidence)
From `Unity-Technologies/UnityCsReference` (5.x-era commit `54dd67f0` for
Quaternion.cs, master for Vector3/Mathf — these bodies are managed C# in 5.6
too, so they ARE the shipped implementation):

- `Quaternion.Multiply(q,q)`, `Quaternion.MultiplyVector(q,v)` — exact
  operator bodies, operation for operation.
- `Dot`, `Angle` (with the `dot > 1−1e-6 → 0` early-out), `RotateTowards`,
  `Normalize` (`mag < Mathf.Epsilon → identity`, else divide), `==`
  (`Dot > 1−1e-6`; note `q != −q` under `==`, genuine Unity behavior).
- `eulerAngles` = `MakePositive(ToEulerRad(q) × Rad2Deg)` with the official
  "−0.0001 hacked to support old behaviour" flip: angles in
  `[−0.00573°, 0)` stay **negative** and `(359.99427°, 360°]` stay **above
  360** — real Unity quirks we replicate.
- `Vector3/Vector2`: `normalized` (`mag > 1e-5 ? v/mag : zero` — division, not
  reciprocal-multiply), `Distance`, `Lerp` (`a + (b−a)·Clamp01(t)`),
  `MoveTowards` (squared early-out variant), `Reflect`
  (`factor = −2·Dot(n,d); factor·n + d`), `Project`/`ProjectOnPlane`
  (`Mathf.Epsilon` guards), `Angle` (denominator `sqrt(sqrMagA·sqrMagB)` with
  `1e-15` guard, clamped acos), `SignedAngle`, `==` (sqrdist < (1e-5)²).
- `Mathf`: `Clamp/Clamp01`, ternary `Min/Max` (NOT `Math.min` — NaN order
  differs), `Sign` (`f >= 0 ? 1 : −1`), `Lerp/LerpUnclamped/InverseLerp`,
  `MoveTowards`, `MoveTowardsAngle` (short-way via `DeltaAngle`),
  `DeltaAngle/Repeat/PingPong/LerpAngle/SmoothStep`, `Approximately`
  (`|b−a| < max(1e-6·max(|a|,|b|), Epsilon·8)`).

### Native engine internals (replicated from best available evidence)
- **Slerp/SlerpUnclamped** — native C++ posted by Unity developer *MelvMay*
  (discussions.unity.com/t/slerp-demystified/892580/2): `dot < 0` → negate q2;
  `dot < 0.95` → sin-blend `(q1·sin(a(1−t)) + q2·sin(at))/sin(a)` (no
  renormalize); else **fallback to `Lerp`, which clamps t** — so
  `SlerpUnclamped` with near-identical quaternions does NOT extrapolate.
  Real quirk, replicated and tested. Confidence: HIGH.
- **Quaternion.Lerp/LerpUnclamped** — `Normalize(rawLerp)`, raw =
  `(1−t)·a + t·b` componentwise (grouping inferred; see unverified list).
- **Euler construction (ZXY, q = qY·qX·qZ)** — expanded form from the
  Unity-verified community replica (stackoverflow.com/questions/12122899,
  also cited in discussions.unity.com/t/731052); term-for-term identical to
  `Unity.Mathematics quaternion.EulerZXY` ("This is the default rotation
  order in Unity"). Degrees→radians happens as `Vector3 × Deg2Rad` (managed
  binding) then half-angle `× 0.5`, in fp32, in that order. Confidence: HIGH
  for structure; ±1 ULP grouping risk noted below.
- **eulerAngles extraction (ToEulerRad)** — the widely-replicated native form
  (stackoverflow.com/questions/12088610; foones.com; undrfined gist
  8b1aae01; Timboc/Kender in discussions.unity.com/t/731052):
  `test = x·w − y·z`, `unit = x²+y²+z²+w²`; singular when
  `|test| > 0.4995·unit` → `(±90°, ±2·atan2(y,x), 0)`; otherwise the swizzled
  atan2/asin triple. Cross-checked against `Unity.Physics Math.toEuler`
  (ZXY branch, posted by PhilSA in the same thread): the **regular-branch
  formulas are algebraically identical**; the singular branch differs
  (residual angle → yaw (ours, matches UnityEngine reports) vs → roll
  (Unity.Physics internal)). Confidence: MEDIUM-HIGH.
- **AngleAxis** — decompiled replica (answers.unity.com/questions/467614 via
  undrfined gist): zero axis → identity; axis normalized (managed semantics);
  `half = (deg·Deg2Rad)·0.5`; `(axis·sin(half), cos(half))`; **no final
  renormalize** (matches `Unity.Mathematics quaternion.AxisAngle`).
- **LookRotation** — decompiled replica (same source): normalize forward
  (zero vector if mag ≤ 1e-5), `right = normalize(cross(up, z))`,
  `up2 = cross(z, right)`, then the classic Shepperd 4-branch
  matrix→quaternion (branch order and `((1+m00)−m11)−m22` groupings kept
  literal). Non-unit forward behaves like normalized forward (Unity parity).
  **Degenerate inputs are deterministic garbage, deliberately un-guarded**:
  `LookRotation(zero) = (0.5, 0, 0, 0)`, `LookRotation(up, up) =
  (0.5, 0, 0, −0.5)` — pinned by tests. Matches the port spec's requirement
  that degenerate Unity results are garbage-but-deterministic.

### Mathf.Epsilon
Managed: `Epsilon = IsFlushToZeroEnabled ? 1e-15 : <smallest denormal>`.
We use the denormal `1.401298464324817e-45` (x86-64 desktop/PS4 default, FTZ
off). If the PS4 build enables SSE FTZ, Unity's value would be `1e-15`; this
only affects `Quaternion.Normalize`'s zero-guard and `Approximately`'s
absolute floor — both far below any value the sim produces. Documented as
unverified.

## Explicitly UNVERIFIED (±1 ULP / edge-case class)

Pending authoritative validation against the game's `eboot.elf` (do NOT block
on these; they only matter for exact-bit replay parity):

1. **ToEulerRad gimbal threshold**: replica folds when `|sin pitch| > 0.999`
   (≈ within 2.56° of ±90). Native 5.6 may use a tighter cutoff (Unity.Physics
   uses `(1−2e-6)²`). Affects `eulerAngles` only for pitch in ~(87.4°, 90°).
   Game usage (tower aim directions) is near-horizontal, so exposure is small.
2. **Euler construction grouping**: Kender form `(cy·sx)·cz + (sy·cx)·sz` vs
   Unity.Mathematics SIMD form (differs in associativity of the w second term
   `(sy·sx)·sz` vs `(sy·sz)·sx`) — possible ±1 ULP.
3. **LookRotation / AngleAxis internal normalization**: division (managed
   style, used here) vs reciprocal-multiply (native `Vector3f::Normalize`
   style), and threshold 1e-5 vs 1e-15-squared.
4. **AngleAxis zero-axis guard** (we return identity for exactly-zero axis).
5. **Inverse**: reciprocal-multiply form (decompiled) vs per-component divide.
6. **Quaternion Lerp raw grouping** `(1−t)a + t·b` vs `a + (b−a)t`.
7. **Libm ULP**: all transcendentals computed as `f(Math.fn(fp32))` (matches
   managed Mathf on any IEEE-double libm; PS4's fp32 libm may differ ≤1 ULP).
8. **Mathf.Epsilon** FTZ ambiguity (above).

## Files

- `Mathf.ts` — scalar helpers (see discipline above).
- `Vector2.ts`, `Vector3.ts` — mutable fp32 classes; operators as methods
  (`add/sub/mulScalar/divScalar/neg/scale`) plus statics
  (`Dot/Cross/Distance/Lerp/MoveTowards/Reflect/Project/Angle/SignedAngle/
  Min/Max/Scale/Normalize`).
- `Quaternion.ts` — mutable fp32 class; `Multiply`, `MultiplyVector`, `Euler`,
  `FromEulerRad`, `AngleAxis`, `LookRotation`, `eulerAngles`, `Slerp(-
  Unclamped)`, `Lerp(-Unclamped)`, `RotateTowards`, `Dot`, `Angle`, `Inverse`,
  `Normalize/normalized`, equality helpers.
- `index.ts` — barrel export.

Tests: `tests/engine/math.test.ts` (110-test suite incl. fp32 discipline,
banker's rounding, gimbal folds, LookRotation basis + degenerate garbage,
MoveTowardsAngle seam cases, Slerp/Lerp quirks).
