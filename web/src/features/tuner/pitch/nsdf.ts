import { fft } from './fft'
import { TRACKER } from './constants'

export interface PitchEstimate {
  frequency: number
  /** The normalized square difference at the chosen period, up to 1 for a perfectly periodic window. */
  clarity: number
}

interface Peak {
  lag: number
  value: number
}

function nextPowerOfTwo(n: number): number {
  let size = 1
  while (size < n) size <<= 1
  return size
}

interface Spectrum {
  re: Float64Array<ArrayBuffer>
  im: Float64Array<ArrayBuffer>
  power: Float64Array<ArrayBuffer>
}

/**
 * The McLeod pitch method (normalized square difference function, NSDF). It keeps scratch
 * buffers for every FFT size it has seen, so a caller that alternates window lengths allocates
 * nothing after the first window of each.
 */
export class PitchEstimator {
  private readonly spectra = new Map<number, Spectrum>()
  private re = new Float64Array(0)
  private im = new Float64Array(0)
  private power = new Float64Array(0)
  private nsdf = new Float64Array(0)
  private overlap = new Float64Array(0)
  private keyMaxima = new Int32Array(0)
  private readonly peak: Peak = { lag: 0, value: 0 }
  private readonly spectral = { r: 0, slope: 0, curve: 0 }

  /** Allocates up front for windows of these lengths. */
  constructor(windowLengths: readonly number[] = []) {
    for (const length of windowLengths) {
      this.prepare(nextPowerOfTwo(2 * length), Math.floor(length / 2) + 3)
    }
  }

  estimate(samples: Float32Array, sampleRate: number): PitchEstimate | null {
    const w = samples.length
    let energy = 0
    for (let i = 0; i < w; i++) energy += samples[i]! * samples[i]!
    if (w === 0 || 10 * Math.log10(energy / w) < TRACKER.minRmsDbfs) return null

    const minLag = Math.floor(sampleRate / TRACKER.maxHz)
    const maxLag = Math.min(Math.ceil(sampleRate / TRACKER.minHz), Math.floor(w / 2))
    if (maxLag <= minLag + 1) return null
    this.prepare(nextPowerOfTwo(2 * w), maxLag + 3)
    const { re, im, power, nsdf, overlap } = this

    // Autocorrelation r(τ) by the Wiener-Khinchin theorem: the inverse FFT of the power
    // spectrum of the zero-padded window.
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < w; i++) re[i] = samples[i]!
    fft(re, im, false)
    for (let k = 0; k < re.length; k++) {
      re[k] = re[k]! * re[k]! + im[k]! * im[k]!
      im[k] = 0
      if (k < power.length) power[k] = re[k]!
    }
    fft(re, im, true)
    const scale = 1 / re.length

    // m(τ) = Σ x[j]² + x[j+τ]² over the overlap, shrinking by one sample at each end per lag.
    // Two lags past maxLag, for the neighbors interpolation reads at the edge.
    let m = 2 * energy
    for (let tau = 0; tau <= maxLag + 2; tau++) {
      nsdf[tau] = m > 0 ? (2 * re[tau]! * scale) / m : 0
      overlap[tau] = m
      if (tau < w) {
        const head = samples[tau]!
        const tail = samples[w - 1 - tau]!
        m -= head * head + tail * tail
      }
    }

    const count = this.findKeyMaxima(minLag, maxLag)
    if (count === 0) return null
    let highest = -Infinity
    for (let i = 0; i < count; i++) highest = Math.max(highest, nsdf[this.keyMaxima[i]!]!)
    let chosen = 0
    while (nsdf[this.keyMaxima[chosen]!]! < TRACKER.keyMaximumRatio * highest) chosen++

    this.refine(this.keyMaxima[chosen]!)
    let lag = this.peak.lag
    let clarity = this.peak.value
    // A window whose fundamental is weak can still peak almost as high at half the period, so
    // a clearly higher peak at twice the chosen lag wins.
    for (let i = chosen + 1; i < count; i++) {
      this.refine(this.keyMaxima[i]!)
      const doubled = 2 * lag
      if (
        Math.abs(this.peak.lag - doubled) <= TRACKER.octaveLagTolerance * doubled &&
        this.peak.value > clarity + TRACKER.octaveMargin
      ) {
        lag = this.peak.lag
        clarity = this.peak.value
        break
      }
    }
    if (clarity < TRACKER.minClarity) return null
    if (this.refineInSpectrum(lag)) {
      lag = this.peak.lag
      clarity = this.peak.value
    }
    const frequency = sampleRate / lag
    // Mains hum is as periodic as any note, so only its frequency gives it away.
    for (const hum of TRACKER.humRejectHz) {
      if (Math.abs(frequency - hum) <= TRACKER.humRejectWidthHz) return null
    }
    return { frequency, clarity }
  }

  private prepare(fftSize: number, nsdfSize: number) {
    let spectrum = this.spectra.get(fftSize)
    if (!spectrum) {
      spectrum = {
        re: new Float64Array(fftSize),
        im: new Float64Array(fftSize),
        power: new Float64Array(fftSize / 2 + 1),
      }
      this.spectra.set(fftSize, spectrum)
    }
    this.re = spectrum.re
    this.im = spectrum.im
    this.power = spectrum.power
    if (this.nsdf.length < nsdfSize) {
      this.nsdf = new Float64Array(nsdfSize)
      this.overlap = new Float64Array(nsdfSize)
      this.keyMaxima = new Int32Array(nsdfSize)
    }
  }

  /**
   * Stores the highest point of each positive lobe after the first negative-going zero
   * crossing, keeping those at or past `minLag`, and returns how many it stored. A lobe still
   * open at `maxLag` counts once it has peaked.
   */
  private findKeyMaxima(minLag: number, maxLag: number): number {
    const { nsdf, keyMaxima } = this
    let tau = 1
    while (tau <= maxLag && nsdf[tau]! > 0) tau++
    let count = 0
    let best = -1
    for (; tau <= maxLag; tau++) {
      const value = nsdf[tau]!
      if (value > 0) {
        if (best < 0 || value > nsdf[best]!) best = tau
      } else if (best >= 0) {
        if (best >= minLag) keyMaxima[count++] = best
        best = -1
      }
    }
    // A lobe still rising at maxLag has no peak in range, and a parabola through its edge
    // extrapolates far past maxLag.
    if (best >= minLag && nsdf[best]! >= nsdf[best + 1]!) keyMaxima[count++] = best
    return count
  }

  /** Parabolic interpolation through the peak and its two neighbors, into `this.peak`. */
  private refine(tau: number) {
    const { nsdf, peak } = this
    const a = nsdf[tau - 1]!
    const b = nsdf[tau]!
    const c = nsdf[tau + 1]!
    const curve = a - 2 * b + c
    const shift = curve < 0 ? (a - c) / (2 * curve) : 0
    peak.lag = tau + shift
    peak.value = b - ((a - c) * shift) / 4
  }

  /**
   * Polishes a peak's lag with Newton steps on the NSDF between samples, where r(τ) is the
   * band-limited interpolation of the autocorrelation, summed from the power spectrum, and m(τ)
   * is linear between its neighbors. A parabola through three samples misplaces a peak that
   * strong high partials make narrow, by over a cent at 16 kHz. Leaves the result in
   * `this.peak` and returns false when a step leaves the peak, keeping the parabola's answer.
   */
  private refineInSpectrum(start: number): boolean {
    const { overlap } = this
    let lag = start
    for (let step = 0; step < TRACKER.refineSteps; step++) {
      this.autocorrelationAt(lag)
      const below = Math.floor(lag)
      const slope = overlap[below + 1]! - overlap[below]!
      const m = overlap[below]! + slope * (lag - below)
      const { r, slope: r1, curve: r2 } = this.spectral
      if (!(r2 < 0) || m <= 0) return false
      const shift = (r1 - (r * slope) / m) / r2
      if (Math.abs(shift) > 1) return false
      lag -= shift
    }
    if (Math.abs(lag - start) > 1) return false
    this.autocorrelationAt(lag)
    const below = Math.floor(lag)
    const m = overlap[below]! + (overlap[below + 1]! - overlap[below]!) * (lag - below)
    this.peak.lag = lag
    this.peak.value = (2 * this.spectral.r) / m
    return true
  }

  /** r(τ) and its first two derivatives at a fractional lag, into `this.spectral`. */
  private autocorrelationAt(lag: number) {
    const { power } = this
    const n = (power.length - 1) * 2
    const theta = (2 * Math.PI * lag) / n
    const stepCos = Math.cos(theta)
    const stepSin = Math.sin(theta)
    // e^{iθk} by repeated rotation, so the sum needs no trigonometry per bin.
    let c = 1
    let s = 0
    let r = power[0]!
    let r1 = 0
    let r2 = 0
    const last = power.length - 1
    for (let k = 1; k <= last; k++) {
      const nextC = c * stepCos - s * stepSin
      s = c * stepSin + s * stepCos
      c = nextC
      const weight = (k === last ? 1 : 2) * power[k]!
      const omega = (2 * Math.PI * k) / n
      r += weight * c
      r1 -= weight * omega * s
      r2 -= weight * omega * omega * c
    }
    this.spectral.r = r / n
    this.spectral.slope = r1 / n
    this.spectral.curve = r2 / n
  }
}

const shared = new PitchEstimator()

export function estimatePitch(samples: Float32Array, sampleRate: number): PitchEstimate | null {
  return shared.estimate(samples, sampleRate)
}
