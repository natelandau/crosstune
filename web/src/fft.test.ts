import { describe, expect, it } from 'vitest'
import { seeded } from './test/random'
import { Fft } from './fft'

const SIZE = 64

function randomSignal(seed: number) {
  const random = seeded(seed)
  const re = new Float32Array(SIZE)
  const im = new Float32Array(SIZE)
  for (let i = 0; i < SIZE; i++) {
    re[i] = random() * 2 - 1
    im[i] = random() * 2 - 1
  }
  return { re, im }
}

function directDft(re: Float32Array, im: Float32Array) {
  const outRe = new Float64Array(SIZE)
  const outIm = new Float64Array(SIZE)
  for (let k = 0; k < SIZE; k++) {
    for (let n = 0; n < SIZE; n++) {
      const angle = (-2 * Math.PI * k * n) / SIZE
      const xr = re[n]!
      const xi = im[n]!
      outRe[k] = outRe[k]! + xr * Math.cos(angle) - xi * Math.sin(angle)
      outIm[k] = outIm[k]! + xr * Math.sin(angle) + xi * Math.cos(angle)
    }
  }
  return { outRe, outIm }
}

function maxDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

describe('Fft', () => {
  it('forward matches a direct DFT', () => {
    const { re, im } = randomSignal(1)
    const { outRe, outIm } = directDft(re, im)
    new Fft(SIZE).forward(re, im)
    expect(maxDifference(re, outRe)).toBeLessThan(1e-4)
    expect(maxDifference(im, outIm)).toBeLessThan(1e-4)
  })

  it('inverse undoes forward', () => {
    const { re, im } = randomSignal(2)
    const re0 = re.slice()
    const im0 = im.slice()
    const fft = new Fft(SIZE)
    fft.forward(re, im)
    fft.inverse(re, im)
    expect(maxDifference(re, re0)).toBeLessThan(1e-5)
    expect(maxDifference(im, im0)).toBeLessThan(1e-5)
  })

  it('leaves the unscaled inverse at size times the input', () => {
    const { re, im } = randomSignal(4)
    const re0 = re.map((v) => v * SIZE)
    const im0 = im.map((v) => v * SIZE)
    const fft = new Fft(SIZE)
    fft.forward(re, im)
    fft.inverseUnscaled(re, im)
    expect(maxDifference(re, re0)).toBeLessThan(1e-5 * SIZE)
    expect(maxDifference(im, im0)).toBeLessThan(1e-5 * SIZE)
  })

  it('keeps float64 precision for float64 arrays', () => {
    const { re, im } = randomSignal(3)
    const re64 = Float64Array.from(re)
    const im64 = Float64Array.from(im)
    const { outRe, outIm } = directDft(re, im)
    new Fft(SIZE).forward(re64, im64)
    expect(maxDifference(re64, outRe)).toBeLessThan(1e-12)
    expect(maxDifference(im64, outIm)).toBeLessThan(1e-12)
  })

  it('rejects a size that is not a power of two', () => {
    expect(() => new Fft(48)).toThrow()
  })
})
