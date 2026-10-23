import { TRACKER } from './constants'
import { PitchEstimator, type PitchEstimate } from './nsdf'
import { noteFor, type Note } from './notes'

export interface Reading {
  frequency: number
  note: Note
  /** Sample time of the analysis, in ms since construction or `reset`. */
  atMs: number
}

const centsOf = (frequency: number) => 1200 * Math.log2(frequency)
const frequencyOf = (cents: number) => 2 ** (cents / 1200)

export class PitchTracker {
  private readonly sampleRate: number
  private a4: number
  private readonly estimator: PitchEstimator
  private readonly ring: Float32Array
  private readonly hop: number
  private readonly holdSamples: number
  private readonly longWindow: Float32Array
  private readonly shortWindow: Float32Array
  /** The last `medianCount` estimates, in absolute cents, oldest overwritten first. */
  private readonly history = new Float64Array(TRACKER.medianCount)
  private readonly sorted = new Float64Array(TRACKER.medianCount)

  private writeAt = 0
  private filled = 0
  private total = 0
  private sinceAnalysis = 0
  private historyCount = 0
  private historyAt = 0
  /** Smoothed pitch in absolute cents, or NaN while unlocked. */
  private smoothed = Number.NaN
  private outliers = 0
  private lastEstimateAt = 0
  private useShortWindow = false
  private reading: Reading | null = null

  constructor(options: { sampleRate: number; a4: number }) {
    this.sampleRate = options.sampleRate
    this.a4 = options.a4
    this.ring = new Float32Array(Math.round(options.sampleRate * TRACKER.bufferSeconds))
    this.hop = Math.round(options.sampleRate * TRACKER.hopSeconds)
    this.holdSamples = Math.round(options.sampleRate * TRACKER.holdSeconds)
    this.longWindow = new Float32Array(Math.round(options.sampleRate * TRACKER.longWindowSeconds))
    this.shortWindow = new Float32Array(Math.round(options.sampleRate * TRACKER.shortWindowSeconds))
    this.estimator = new PitchEstimator([this.longWindow.length, this.shortWindow.length])
  }

  /** Appends input; returns the reading after the newest analysis, or null when nothing confident is heard. */
  push(samples: Float32Array): Reading | null {
    const { ring } = this
    for (let i = 0; i < samples.length; i++) {
      ring[this.writeAt] = samples[i]!
      this.writeAt = (this.writeAt + 1) % ring.length
      this.filled = Math.min(this.filled + 1, ring.length)
      this.total++
      if (++this.sinceAnalysis >= this.hop) {
        this.sinceAnalysis = 0
        this.analyze()
      }
    }
    return this.reading
  }

  /** Whether the short window is the one analyzed now. */
  get usesShortWindow(): boolean {
    return this.useShortWindow
  }

  setA4(a4: number): void {
    this.a4 = a4
    if (!this.reading) return
    const note = noteFor(this.reading.frequency, a4)
    this.reading = note && { ...this.reading, note }
  }

  reset(): void {
    this.writeAt = 0
    this.filled = 0
    this.total = 0
    this.sinceAnalysis = 0
    this.unlock()
  }

  private unlock() {
    this.historyCount = 0
    this.historyAt = 0
    this.smoothed = Number.NaN
    this.outliers = 0
    this.reading = null
    this.useShortWindow = false
  }

  private analyze() {
    const locked = !Number.isNaN(this.smoothed)
    if (locked) {
      // Two thresholds, so a note near the boundary does not flip windows every analysis.
      const heard = frequencyOf(this.smoothed)
      if (heard >= TRACKER.shortWindowMinHz) this.useShortWindow = true
      else if (heard < TRACKER.longWindowBelowHz) this.useShortWindow = false
    }
    const window = this.useShortWindow ? this.shortWindow : this.longWindow
    if (this.filled < window.length) return
    let estimate = this.estimateNewest(window)
    if (this.useShortWindow && (!estimate || estimate.frequency < TRACKER.longWindowBelowHz)) {
      // The short window holds too few periods of a low note to read it, so it hears one
      // after a high note an octave up or not at all; the long window reads it now.
      this.useShortWindow = false
      estimate = this.estimateNewest(this.longWindow)
    }
    if (!estimate) {
      if (locked && this.total - this.lastEstimateAt >= this.holdSamples) this.unlock()
      return
    }
    this.lastEstimateAt = this.total
    this.smooth(centsOf(estimate.frequency))
    const frequency = frequencyOf(this.smoothed)
    const note = noteFor(frequency, this.a4)
    this.reading = note && { frequency, note, atMs: (this.total / this.sampleRate) * 1000 }
  }

  /** Copies the newest samples into `window` and estimates its pitch. */
  private estimateNewest(window: Float32Array): PitchEstimate | null {
    const { ring } = this
    let from = (this.writeAt - window.length + ring.length) % ring.length
    for (let i = 0; i < window.length; i++) {
      window[i] = ring[from]!
      from = from + 1 === ring.length ? 0 : from + 1
    }
    return this.estimator.estimate(window, this.sampleRate)
  }

  private smooth(cents: number) {
    this.history[this.historyAt] = cents
    this.historyAt = (this.historyAt + 1) % this.history.length
    this.historyCount = Math.min(this.historyCount + 1, this.history.length)
    const median = this.median()

    if (Number.isNaN(this.smoothed)) {
      this.smoothed = median
      return
    }
    if (Math.abs(cents - this.smoothed) > TRACKER.snapCents) {
      if (++this.outliers >= TRACKER.snapCount) {
        this.outliers = 0
        this.smoothed = cents
        return
      }
    } else {
      this.outliers = 0
    }
    const heard = noteFor(frequencyOf(median), this.a4)
    const shown = noteFor(frequencyOf(this.smoothed), this.a4)
    if (heard?.name !== shown?.name || heard?.octave !== shown?.octave) {
      this.smoothed = median
      return
    }
    this.smoothed += TRACKER.smoothing * (median - this.smoothed)
  }

  /** Median of the stored estimates; with an even count, the mean of the middle two. */
  private median(): number {
    const { sorted, historyCount: n } = this
    for (let i = 0; i < n; i++) {
      // Insertion sort: at most `medianCount` values.
      const value = this.history[i]!
      let j = i
      while (j > 0 && sorted[j - 1]! > value) {
        sorted[j] = sorted[j - 1]!
        j--
      }
      sorted[j] = value
    }
    const mid = n >> 1
    return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  }
}
