# Tuner fixtures

`clips.json` holds recipes for synthetic instrument clips, each with the
note and cents it must read as, or `expect: null` for a clip that must
read nothing. The web pitch detector (`web/src/features/tuner/pitch/`)
and its Swift twin synthesize every clip the same way and test against
it. No gate is keyed on this folder, so run `just gate clear` after
changing it.

## Fields

- `seed`: the noise seed. Clip `i` (zero-based, in file order) seeds
  its noise with `seed + i`.
- `sampleRate`, `seconds`: the clip holds `round(seconds × sampleRate)`
  samples.
- `a4`: the reference pitch the clip reads against.
- `f0`: the fundamental in Hz, `0` for a clip with no tone.
- `partials`: `[harmonic, weight]` pairs. A harmonic may be fractional.
  The banjo clips stretch harmonic `h` to `h × sqrt(1 + B × h²)` with
  `B = 0.00002`, rounded to 4 decimals, as a stiff string does.
- `amplitude`: multiplies the sum of the partials, which is not
  normalized.
- `decaySeconds`: exponential time constant, or `null` for a sustained
  tone.
- `noiseDbfs`: peak level of uniform white noise, or `null`.
- `hum`: `{ hz, dbfs, partials? }` or `null`. `dbfs` is the peak level of
  a weight-1 partial. `partials` are `[harmonic, weight]` of `hz`, a lone
  `[[1, 1]]` when absent.
- `vibrato`: optional `{ cents, hz }`, a sine swing of ± `cents` at `hz`.
- `expect`: `{ name, octave, cents }`, where `cents` is the offset of
  `f0` from the named note at the clip's `a4`, or `null`.
- `lockWithinMs`: the latest the first reading may come, 150 when
  absent.
- `toleranceCents`: how far the median cents over the last half may sit
  from `expect.cents`, 0.5 when absent, at most 1.5. Only an inharmonic
  clip sets it: a detector of the period reads a stretched series a
  little sharp of its fundamental, and the fundamental stays the truth.
  A vibrato clip allows 2.

## Synthesis

Every value is a double until it is stored as a 32-bit float. With
`level(d) = 10^(d / 20)`, `phase = 0`, and the noise generator seeded,
for each sample `i`:

1. `t = i / sampleRate`.
2. `tone = Σ weight × sin(2π × harmonic × phase)` over `partials`, in
   order.
3. `envelope = exp(-t / decaySeconds)`, or 1 when `decaySeconds` is
   `null`.
4. `sample = amplitude × envelope × tone`.
5. With hum, for each hum partial in order:
   `sample += level(hum.dbfs) × weight × sin(2π × harmonic × hum.hz × t)`.
6. With noise: `sample += level(noiseDbfs) × (2u − 1)`, where `u` is the
   next mulberry32 draw in [0, 1). Exactly one draw per sample, and none
   in a clip without noise.
7. Store `sample`.
8. `bend = 2^(vibrato.cents × sin(2π × vibrato.hz × t) / 1200)`, or 1
   without vibrato, then `phase += f0 × bend / sampleRate`.

The phase is in cycles of `f0` and accumulates, so vibrato bends the
frequency itself. A `sin(2π × h × f(t) × t)` form would swing the
frequency further the later the sample.

Mulberry32, all in unsigned 32-bit arithmetic with wrapping:

```
a = (a + 0x6D2B79F5)
t = imul(a ^ (a >>> 15), 1 | a)
t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t
u = (t ^ (t >>> 14)) / 4294967296
```

`imul` is the low 32 bits of the product, and `a` starts at the seed.
