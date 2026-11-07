import { RECORDING_RANGES } from '../../../api/vocabulary'
import { Fft } from '../../../fft'
import { DEFAULT_ISOLATE, type IsolateSetting } from './isolateSetting'

const FFT_SIZE = 2048
// FFT_SIZE is a power of two, so `& RING_MASK` wraps a ring index as `% FFT_SIZE` would.
const RING_MASK = FFT_SIZE - 1
const HOP = 512
const BINS = FFT_SIZE / 2 + 1
// Hann windows at a quarter-size hop sum to 2.
const OVERLAP_SCALE = 0.5
const PAN_EDGE = 10
const FREQ_EDGE_OCTAVES = 1 / 6
const PAN_MIN = RECORDING_RANGES.isolate_pan_start.min
const PAN_MAX = RECORDING_RANGES.isolate_pan_end.max
const HZ_MIN = RECORDING_RANGES.isolate_low_hz.min
const HZ_MAX = RECORDING_RANGES.isolate_high_hz.max
const LOG2_HZ_MIN = Math.log2(HZ_MIN)
const LOG2_HZ_MAX = Math.log2(HZ_MAX)
const SMOOTH_PREVIOUS = 0.6
const SMOOTH_NEW = 0.4
const SILENT_MAGNITUDE = 1e-9
const OUTLINE_PAN_BINS = 32
const OUTLINE_FREQ_BINS = 48

function raisedCosine(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 0.5 - 0.5 * Math.cos(Math.PI * t)
}

function rangeWeight(x: number, lo: number, hi: number, min: number, max: number, edge: number) {
  const low = lo <= min ? 1 : raisedCosine((x - lo) / edge + 0.5)
  const high = hi >= max ? 1 : raisedCosine((hi - x) / edge + 0.5)
  return low * high
}

/** A setting with its frequency bounds in log2 Hz, where the frequency edge is measured. */
type LogBounds = {
  solo: boolean
  panStart: number
  panEnd: number
  lowLog2: number
  highLog2: number
}

function logBounds(s: IsolateSetting): LogBounds {
  return {
    solo: s.effect === 'solo',
    panStart: s.panStart,
    panEnd: s.panEnd,
    lowLog2: Math.log2(s.lowHz),
    highLog2: Math.log2(s.highHz),
  }
}

function panWeight(pan: number, b: LogBounds, isMono: boolean): number {
  return isMono ? 1 : rangeWeight(pan, b.panStart, b.panEnd, PAN_MIN, PAN_MAX, PAN_EDGE)
}

function freqWeight(log2Hz: number, b: LogBounds): number {
  return rangeWeight(log2Hz, b.lowLog2, b.highLog2, LOG2_HZ_MIN, LOG2_HZ_MAX, FREQ_EDGE_OCTAVES)
}

/** The gain for a bin whose pan and frequency weights multiply to `inRange`. */
function effectGain(inRange: number, b: LogBounds): number {
  return b.solo ? inRange : 1 - inRange
}

function gainAt(pan: number, log2Hz: number, b: LogBounds, isMono: boolean): number {
  return effectGain(panWeight(pan, b, isMono) * freqWeight(log2Hz, b), b)
}

/**
 * The outline bin for `pan`. Rounding can put a one-sided bin's pan just past ±100, so the
 * index is clamped at both ends.
 */
export function outlinePanBin(pan: number): number {
  const bin = Math.floor(((pan - PAN_MIN) / (PAN_MAX - PAN_MIN)) * OUTLINE_PAN_BINS)
  return Math.min(OUTLINE_PAN_BINS - 1, Math.max(0, bin))
}

/** The mask's gain for a bin at `pan` (-100..100) and `hz`. */
export function binGain(pan: number, hz: number, s: IsolateSetting, isMono: boolean): number {
  return gainAt(pan, Math.log2(hz), logBounds(s), isMono)
}

/**
 * Short-time Fourier mask that solos or mutes a stereo range and a frequency range of a stereo
 * signal. Sqrt-Hann analysis and synthesis windows at a quarter-size hop overlap-add to a
 * constant (COLA), so a gain of 1 everywhere returns the input delayed by `latencyFrames`.
 */
export class IsolateMask {
  readonly latencyFrames = FFT_SIZE

  private readonly fft = new Fft(FFT_SIZE)
  private readonly window = new Float32Array(FFT_SIZE)
  private readonly binLog2Hz = new Float64Array(BINS)
  private readonly binOutlineFreq = new Int16Array(BINS)
  /** Each bin's frequency weight under the current setting, which only `setSetting` changes. */
  private readonly binFreqWeight = new Float64Array(BINS)
  private readonly inLeft = new Float32Array(FFT_SIZE)
  private readonly inRight = new Float32Array(FFT_SIZE)
  private readonly outLeft = new Float32Array(FFT_SIZE)
  private readonly outRight = new Float32Array(FFT_SIZE)
  private readonly re = new Float32Array(FFT_SIZE)
  private readonly im = new Float32Array(FFT_SIZE)
  private readonly gains = new Float32Array(BINS)
  private readonly panSums = new Float32Array(OUTLINE_PAN_BINS)
  private readonly freqSums = new Float32Array(OUTLINE_FREQ_BINS)
  private readonly shape = {
    pan: new Float32Array(OUTLINE_PAN_BINS),
    freq: new Float32Array(OUTLINE_FREQ_BINS),
  }

  private bounds!: LogBounds
  private isMono = false
  /** Ring position shared by the input and overlap-add buffers: the oldest input frame. */
  private position = 0
  private sinceFrame = 0
  /** True until a frame runs after construction or a reset, so its gains start unsmoothed. */
  private fresh = true

  constructor(sampleRate: number) {
    for (let i = 0; i < FFT_SIZE; i++) this.window[i] = Math.sin((Math.PI * i) / FFT_SIZE)
    for (let k = 0; k < BINS; k++) {
      const log2Hz = Math.log2((k * sampleRate) / FFT_SIZE)
      this.binLog2Hz[k] = log2Hz
      this.binOutlineFreq[k] =
        log2Hz < LOG2_HZ_MIN || log2Hz > LOG2_HZ_MAX
          ? -1
          : Math.min(
              OUTLINE_FREQ_BINS - 1,
              Math.floor(
                ((log2Hz - LOG2_HZ_MIN) / (LOG2_HZ_MAX - LOG2_HZ_MIN)) * OUTLINE_FREQ_BINS,
              ),
            )
    }
    this.setSetting(DEFAULT_ISOLATE, false)
  }

  setSetting(s: IsolateSetting, isMono: boolean): void {
    const bounds = logBounds(s)
    this.bounds = bounds
    this.isMono = isMono
    for (let k = 0; k < BINS; k++) this.binFreqWeight[k] = freqWeight(this.binLog2Hz[k]!, bounds)
  }

  /** Drops all buffered audio, for a seek or a loop wrap. */
  reset(): void {
    this.inLeft.fill(0)
    this.inRight.fill(0)
    this.outLeft.fill(0)
    this.outRight.fill(0)
    this.panSums.fill(0)
    this.freqSums.fill(0)
    this.position = 0
    this.sinceFrame = 0
    this.fresh = true
  }

  /** `measure` also builds the outline from each frame; without it, `outline()` goes stale. */
  process(left: Float32Array, right: Float32Array, measure = true): void {
    const frames = Math.min(left.length, right.length)
    for (let i = 0; i < frames; i++) {
      const p = this.position
      const l = left[i]!
      const r = right[i]!
      left[i] = this.outLeft[p]!
      right[i] = this.outRight[p]!
      this.outLeft[p] = 0
      this.outRight[p] = 0
      this.inLeft[p] = l
      this.inRight[p] = r
      this.position = (p + 1) & RING_MASK
      if (++this.sinceFrame === HOP) {
        this.sinceFrame = 0
        this.runFrame(measure)
      }
    }
  }

  /** Input magnitude of the last frame by pan and by log frequency, each scaled to 0..1. */
  outline(): { pan: Float32Array; freq: Float32Array } {
    normalize(this.panSums, this.shape.pan)
    normalize(this.freqSums, this.shape.freq)
    return this.shape
  }

  private runFrame(measure: boolean): void {
    const { re, im, window } = this
    for (let i = 0; i < FFT_SIZE; i++) {
      const p = (this.position + i) & RING_MASK
      const w = window[i]!
      re[i] = this.inLeft[p]! * w
      im[i] = this.inRight[p]! * w
    }
    // Both channels are real, so one complex FFT of left + i*right carries both spectra.
    this.fft.forward(re, im)

    if (measure) {
      this.panSums.fill(0)
      this.freqSums.fill(0)
    }
    for (let k = 0; k < BINS; k++) {
      const j = (FFT_SIZE - k) & RING_MASK
      const kr = re[k]!
      const ki = im[k]!
      const jr = re[j]!
      const ji = im[j]!
      const leftRe = (kr + jr) / 2
      const leftIm = (ki - ji) / 2
      const rightRe = (ki + ji) / 2
      const rightIm = (jr - kr) / 2
      const leftMagnitude = Math.sqrt(leftRe * leftRe + leftIm * leftIm)
      const rightMagnitude = Math.sqrt(rightRe * rightRe + rightIm * rightIm)
      const total = leftMagnitude + rightMagnitude
      // A non-finite sample makes the pan NaN, which has no outline bin.
      const pan =
        (leftMagnitude < SILENT_MAGNITUDE && rightMagnitude < SILENT_MAGNITUDE) ||
        !Number.isFinite(total)
          ? 0
          : (100 * (rightMagnitude - leftMagnitude)) / total

      const target = effectGain(
        panWeight(pan, this.bounds, this.isMono) * this.binFreqWeight[k]!,
        this.bounds,
      )
      const gain = this.fresh ? target : SMOOTH_PREVIOUS * this.gains[k]! + SMOOTH_NEW * target
      this.gains[k] = gain
      // A real gain applied to both mirrored bins keeps each channel real.
      re[k] = kr * gain
      im[k] = ki * gain
      if (j !== k) {
        re[j] = jr * gain
        im[j] = ji * gain
      }

      if (measure && k > 0) {
        const panBin = outlinePanBin(pan)
        this.panSums[panBin] = this.panSums[panBin]! + total
        const freqBin = this.binOutlineFreq[k]!
        if (freqBin >= 0) this.freqSums[freqBin] = this.freqSums[freqBin]! + total
      }
    }
    this.fresh = false

    this.fft.inverse(re, im)
    for (let i = 0; i < FFT_SIZE; i++) {
      const p = (this.position + i) & RING_MASK
      const w = window[i]! * OVERLAP_SCALE
      this.outLeft[p] = this.outLeft[p]! + re[i]! * w
      this.outRight[p] = this.outRight[p]! + im[i]! * w
    }
  }
}

function normalize(sums: Float32Array, out: Float32Array): void {
  let max = 0
  for (let i = 0; i < sums.length; i++) max = Math.max(max, sums[i]!)
  for (let i = 0; i < sums.length; i++) out[i] = max > 0 ? sums[i]! / max : 0
}
