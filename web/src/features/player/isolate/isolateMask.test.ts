import { describe, expect, it } from 'vitest'
import cases from '../../../../../fixtures/isolate/gain-cases.json'
import { seeded } from '../../../test/random'
import { binGain, IsolateMask, outlinePanBin } from './isolateMask'
import { DEFAULT_ISOLATE, type IsolateSetting } from './isolateSetting'

const SAMPLE_RATES = [44100, 48000]
const BLOCK = 128
const FFT_SIZE = 2048

type GainCase = { setting: IsolateSetting; isMono: boolean; pan: number; hz: number; gain: number }

function tone(hz: number, sampleRate: number, frames: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++)
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return out
}

function noise(seed: number, frames: number): Float32Array {
  const random = seeded(seed)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) out[i] = random() * 2 - 1
  return out
}

/** Runs the mask over whole buffers in worklet-sized blocks and returns the output. */
function run(mask: IsolateMask, left: Float32Array, right: Float32Array) {
  const outLeft = left.slice()
  const outRight = right.slice()
  for (let start = 0; start < outLeft.length; start += BLOCK) {
    const end = Math.min(start + BLOCK, outLeft.length)
    mask.process(outLeft.subarray(start, end), outRight.subarray(start, end))
  }
  return { left: outLeft, right: outRight }
}

/** RMS after the latency and a few frames of gain smoothing have passed. */
function steadyRms(signal: Float32Array): number {
  const from = 4 * FFT_SIZE
  let sum = 0
  for (let i = from; i < signal.length; i++) sum += signal[i]! ** 2
  return Math.sqrt(sum / (signal.length - from))
}

const db = (ratio: number) => 20 * Math.log10(ratio)

function maskWith(sampleRate: number, setting: Partial<IsolateSetting>, isMono = false) {
  const mask = new IsolateMask(sampleRate)
  mask.setSetting({ ...DEFAULT_ISOLATE, ...setting }, isMono)
  return mask
}

describe('outlinePanBin', () => {
  it.each([-100 - 1e-12, -100, 0, 100, 100 + 1e-12])('puts pan %d in an outline bin', (pan) => {
    expect(outlinePanBin(pan)).toBeGreaterThanOrEqual(0)
    expect(outlinePanBin(pan)).toBeLessThan(32)
  })

  // Rounding puts this left-only magnitude's pan just under -100.
  it('puts a left-only bin in the first outline bin', () => {
    const left = 1.0000637019874848e-7
    const right = 0
    expect(outlinePanBin((100 * (right - left)) / (left + right))).toBe(0)
  })
})

describe('binGain', () => {
  it('matches every parity case', () => {
    for (const c of cases as GainCase[]) {
      expect(binGain(c.pan, c.hz, c.setting, c.isMono)).toBeCloseTo(c.gain, 6)
    }
  })
})

describe.each(SAMPLE_RATES)('IsolateMask at %i Hz', (sampleRate) => {
  const frames = sampleRate

  it('default setting reconstructs the input', () => {
    const left = noise(1, frames)
    const right = noise(2, frames)
    const mask = maskWith(sampleRate, {})
    const out = run(mask, left, right)
    const latency = mask.latencyFrames
    let maxError = 0
    for (let i = latency; i < frames; i++) {
      maxError = Math.max(
        maxError,
        Math.abs(out.left[i]! - left[i - latency]!),
        Math.abs(out.right[i]! - right[i - latency]!),
      )
    }
    expect(latency).toBe(FFT_SIZE)
    expect(maxError).toBeLessThan(1e-3)
  })

  it('solo left rejects a hard-right tone', () => {
    const right = tone(1000, sampleRate, frames)
    const out = run(
      maskWith(sampleRate, { panStart: -100, panEnd: -20 }),
      new Float32Array(frames),
      right,
    )
    const outRms = Math.hypot(steadyRms(out.left), steadyRms(out.right))
    expect(db(outRms / steadyRms(right))).toBeLessThan(-40)
  })

  it('solo band passes an in-band tone and rejects an out-of-band tone', () => {
    const band = { lowHz: 200, highHz: 1000 }
    const inBand = tone(300, sampleRate, frames)
    const passed = run(maskWith(sampleRate, band), inBand, inBand)
    expect(Math.abs(db(steadyRms(passed.left) / steadyRms(inBand)))).toBeLessThan(1)
    expect(Math.abs(db(steadyRms(passed.right) / steadyRms(inBand)))).toBeLessThan(1)

    const outOfBand = tone(3000, sampleRate, frames)
    const rejected = run(maskWith(sampleRate, band), outOfBand, outOfBand)
    expect(db(steadyRms(rejected.left) / steadyRms(outOfBand))).toBeLessThan(-30)
    expect(db(steadyRms(rejected.right) / steadyRms(outOfBand))).toBeLessThan(-30)
  })

  it('places bins by the real sample rate', () => {
    // Just above the band's high edge, so a bin frequency read at another rate lands inside it.
    const edgeTone = tone(1040, sampleRate, frames)
    const out = run(maskWith(sampleRate, { lowHz: 200, highHz: 1000 }), edgeTone, edgeTone)
    expect(db(steadyRms(out.left) / steadyRms(edgeTone))).toBeLessThan(-15)
  })

  it('mute with full ranges silences', () => {
    const out = run(maskWith(sampleRate, { effect: 'mute' }), noise(3, frames), noise(4, frames))
    expect(out.left.every((x) => x === 0)).toBe(true)
    expect(out.right.every((x) => x === 0)).toBe(true)
  })

  it('mono ignores pan', () => {
    const right = tone(1000, sampleRate, frames)
    const out = run(
      maskWith(sampleRate, { panStart: -100, panEnd: -50 }, true),
      new Float32Array(frames),
      right,
    )
    expect(Math.abs(db(steadyRms(out.right) / steadyRms(right)))).toBeLessThan(1)
  })

  it('reset clears buffered audio', () => {
    const mask = maskWith(sampleRate, {})
    const loud = tone(440, sampleRate, frames, 0.9)
    run(mask, loud, loud)
    mask.reset()
    const out = run(mask, new Float32Array(frames), new Float32Array(frames))
    expect(out.left.every((x) => x === 0)).toBe(true)
    expect(out.right.every((x) => x === 0)).toBe(true)
  })

  it('reset starts the gains from the current setting', () => {
    const mask = maskWith(sampleRate, {})
    run(mask, noise(5, frames), noise(6, frames))
    mask.setSetting({ ...DEFAULT_ISOLATE, effect: 'mute' }, false)
    mask.reset()
    const out = run(mask, noise(7, frames), noise(8, frames))
    expect(out.left.every((x) => x === 0)).toBe(true)
    expect(out.right.every((x) => x === 0)).toBe(true)
  })

  it('processes only the frames both channels hold', () => {
    const mask = maskWith(sampleRate, {})
    mask.process(new Float32Array(BLOCK), new Float32Array(BLOCK / 2))
    const out = run(mask, noise(9, frames), noise(10, frames))
    expect(out.left.every(Number.isFinite)).toBe(true)
    expect(out.right.every(Number.isFinite)).toBe(true)
  })

  it('outlines where the input sits in pan and frequency', () => {
    const mask = maskWith(sampleRate, {})
    expect(Array.from(mask.outline().pan).every((x) => x === 0)).toBe(true)

    run(mask, new Float32Array(frames), tone(1000, sampleRate, frames))
    const { pan, freq } = mask.outline()
    expect(pan).toHaveLength(32)
    expect(freq).toHaveLength(48)
    expect(Math.max(...pan)).toBe(1)
    expect(pan.indexOf(1)).toBe(31)
    const peak = freq.indexOf(1)
    const binLowHz = 40 * (16000 / 40) ** (peak / 48)
    const binHighHz = 40 * (16000 / 40) ** ((peak + 1) / 48)
    expect(binLowHz).toBeLessThanOrEqual(1000)
    expect(binHighHz).toBeGreaterThan(1000)
    expect(Math.min(...pan, ...freq)).toBeGreaterThanOrEqual(0)

    mask.reset()
    expect(Array.from(mask.outline().freq).every((x) => x === 0)).toBe(true)
  })
})
