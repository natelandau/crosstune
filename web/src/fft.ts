/** Either precision; the tuner needs float64, the audio thread works in float32. */
export type FloatSamples = Float32Array | Float64Array

/** In-place complex FFT of a fixed power-of-two size: iterative radix-2 Cooley-Tukey. */
export class Fft {
  readonly size: number
  private readonly reversed: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`)
    }
    this.size = size
    const bits = Math.log2(size)
    this.reversed = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >>> b) & 1)
      this.reversed[i] = r
    }
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((2 * Math.PI * i) / size)
    }
  }

  forward(re: FloatSamples, im: FloatSamples): void {
    this.transform(re, im, -1)
  }

  /** Scaled by 1/size, so `inverse(forward(x))` is `x`. */
  inverse(re: FloatSamples, im: FloatSamples): void {
    this.inverseUnscaled(re, im)
    const scale = 1 / this.size
    for (let i = 0; i < this.size; i++) {
      re[i] = re[i]! * scale
      im[i] = im[i]! * scale
    }
  }

  /** Not scaled: `inverseUnscaled(forward(x))` is `size * x`, for a caller that reads only a
   * few entries and scales those. */
  inverseUnscaled(re: FloatSamples, im: FloatSamples): void {
    this.transform(re, im, 1)
  }

  private transform(re: FloatSamples, im: FloatSamples, sign: number): void {
    const n = this.size
    for (let i = 0; i < n; i++) {
      const j = this.reversed[i]!
      if (j > i) {
        const tr = re[i]!
        re[i] = re[j]!
        re[j] = tr
        const ti = im[i]!
        im[i] = im[j]!
        im[j] = ti
      }
    }
    for (let half = 1; half < n; half *= 2) {
      const stride = n / (2 * half)
      for (let k = 0; k < half; k++) {
        const wr = this.cos[k * stride]!
        const wi = sign * this.sin[k * stride]!
        for (let start = 0; start < n; start += 2 * half) {
          const a = start + k
          const b = a + half
          const br = re[b]!
          const bi = im[b]!
          const ar = re[a]!
          const ai = im[a]!
          const xr = br * wr - bi * wi
          const xi = br * wi + bi * wr
          re[b] = ar - xr
          im[b] = ai - xi
          re[a] = ar + xr
          im[a] = ai + xi
        }
      }
    }
  }
}
