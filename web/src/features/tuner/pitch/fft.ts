/** cos and sin of 2πk/n for k below n/2, by length n, built once since the tracker reuses a length. */
const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>()

function twiddlesFor(n: number) {
  let table = twiddles.get(n)
  if (!table) {
    const cos = new Float64Array(n >> 1)
    const sin = new Float64Array(n >> 1)
    for (let k = 0; k < n >> 1; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n)
      sin[k] = Math.sin((2 * Math.PI * k) / n)
    }
    table = { cos, sin }
    twiddles.set(n, table)
  }
  return table
}

/**
 * In-place iterative radix-2 complex FFT (Cooley-Tukey, decimation in time). The length must be
 * a power of two. The inverse is unscaled: divide by the length to undo a forward transform.
 */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = re[i]!
      re[i] = re[j]!
      re[j] = r
      const m = im[i]!
      im[i] = im[j]!
      im[j] = m
    }
  }
  const { cos, sin } = twiddlesFor(n)
  const sign = inverse ? 1 : -1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const stride = n / size
    for (let k = 0; k < half; k++) {
      const wr = cos[k * stride]!
      const wi = sign * sin[k * stride]!
      for (let start = k; start < n; start += size) {
        const odd = start + half
        const tr = wr * re[odd]! - wi * im[odd]!
        const ti = wr * im[odd]! + wi * re[odd]!
        re[odd] = re[start]! - tr
        im[odd] = im[start]! - ti
        re[start] = re[start]! + tr
        im[start] = im[start]! + ti
      }
    }
  }
}
