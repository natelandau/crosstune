# Mono decision cases

Each case gives the summed channel energies of a recording and says whether it is mono.

- `input.left` and `input.right` are the summed squares of each channel's samples, scaled to -1..1.
- `input.cross` is the summed product of the two channels' samples, on the same scale.
- `input.frames` is the number of sample frames summed.
- `expected.is_mono` says whether the recording is mono.

The cases pin these rules:

- No frames is mono.
- Both channels' mean energy per sample under `1e-10` is mono. `5e-11` is silent and `2e-10` is not.
- A channel more than 40 dB under the other is mono. The comparison is strict: a channel exactly 40 dB under (an energy ratio of `0.0001`) is not quiet enough.
- Otherwise the recording is mono when the correlation `cross / sqrt(left * right)` is at least `0.999`. The comparison includes the threshold: `0.999` is mono, `0.9989` is stereo.
- Inverted channels correlate at -1 and are stereo.

The boundary cases use sums of `1.0` so the correlation divides by exactly `1.0`.
