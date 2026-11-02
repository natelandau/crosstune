import { describe, expect, it } from 'vitest'
import { IsolateRenderer } from './isolateRenderer'
import { DEFAULT_ISOLATE } from './isolateSetting'
import type { IsolateOutline } from './isolateStage'

const SAMPLE_RATE = 48_000
const BLOCK = 128
const MUTE_ALL = { ...DEFAULT_ISOLATE, effect: 'mute' as const }

function sine(frame: number): number {
  return frame < 0 ? 0 : Math.sin((2 * Math.PI * 440 * frame) / SAMPLE_RATE)
}

function sineBlock(start: number): Float32Array {
  const block = new Float32Array(BLOCK)
  for (let i = 0; i < BLOCK; i++) block[i] = sine(start + i)
  return block
}

/** The largest gap between `block` and the sine delayed by the mask's latency. */
function delayedError(block: Float32Array, start: number): number {
  let max = 0
  for (let i = 0; i < BLOCK; i++) max = Math.max(max, Math.abs(block[i]! - sine(start + i - 2048)))
  return max
}

function silentBlocks(renderer: IsolateRenderer, blocks: number, inputChannels = 2) {
  const results: Float32Array[][] = []
  for (let b = 0; b < blocks; b++) {
    const inputs = Array.from({ length: inputChannels }, () => new Float32Array(BLOCK))
    const outputs = [new Float32Array(BLOCK).fill(1), new Float32Array(BLOCK).fill(1)]
    renderer.render(inputs, outputs)
    results.push(outputs)
  }
  return results
}

/** Renders `blocks` blocks of a sine on every input channel and returns each block's output. */
function run(renderer: IsolateRenderer, blocks: number, inputChannels = 2, from = 0) {
  const results: { input: Float32Array; outputs: Float32Array[] }[] = []
  for (let b = 0; b < blocks; b++) {
    const input = sineBlock(from + b * BLOCK)
    const inputs = Array.from({ length: inputChannels }, () => input.slice())
    const outputs = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    renderer.render(inputs, outputs)
    results.push({ input, outputs })
  }
  return results
}

function peak(block: Float32Array): number {
  return block.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
}

// A tone the mask's 2048-frame latency delays by a quarter period plus whole periods, so the
// wet copy is 90 degrees behind the dry: an equal-power mix of the two keeps a level of 1,
// and a linear one dips.
const TONE_HZ = (9.25 * SAMPLE_RATE) / 2048
const TONE_PERIOD = SAMPLE_RATE / TONE_HZ
const MINUS_1_DB = 10 ** (-1 / 20)

function tone(frame: number): number {
  return frame < 0 ? 0 : Math.sin((2 * Math.PI * TONE_HZ * frame) / SAMPLE_RATE)
}

/** Renders `blocks` blocks of the tone on both channels from `from` and returns output 0. */
function toneRun(renderer: IsolateRenderer, from: number, blocks: number): Float32Array[] {
  const results: Float32Array[] = []
  for (let b = 0; b < blocks; b++) {
    const input = new Float32Array(BLOCK)
    for (let i = 0; i < BLOCK; i++) input[i] = tone(from + b * BLOCK + i)
    const outputs = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    renderer.render([input, input.slice()], outputs)
    results.push(outputs[0]!)
  }
  return results
}

/** The lowest peak over any two periods of the tone, so a phase step cannot hide a peak. */
function lowestLevel(blocks: Float32Array[]): number {
  const samples = blocks.flatMap((block) => Array.from(block))
  const window = Math.ceil(2 * TONE_PERIOD)
  let lowest = Infinity
  for (let start = 0; start + window <= samples.length; start++) {
    let max = 0
    for (let i = start; i < start + window; i++) max = Math.max(max, Math.abs(samples[i]!))
    lowest = Math.min(lowest, max)
  }
  return lowest
}

// Past the mask's 2048-frame latency and the 50 ms (2400-frame) crossfade.
const SETTLED_BLOCKS = Math.ceil((2048 + 2400) / BLOCK) + 4

describe('IsolateRenderer', () => {
  it('passes the input through untouched and posts no outline in the default state', () => {
    const outlines: IsolateOutline[] = []
    const renderer = new IsolateRenderer(SAMPLE_RATE, (o) => outlines.push(o))

    const results = run(renderer, 20)

    for (const { input, outputs } of results) {
      expect(outputs[0]).toEqual(input)
      expect(outputs[1]).toEqual(input)
    }
    expect(outlines).toEqual([])
  })

  it('stays bypassed for a mono recording whose only change is pan', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ setting: { ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }, isMono: true })

    const results = run(renderer, 20)

    for (const { input, outputs } of results) expect(outputs[0]).toEqual(input)
  })

  it('engages for a non-default setting without being engaged', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ setting: MUTE_ALL, isMono: false })

    const results = run(renderer, SETTLED_BLOCKS)

    const last = results.at(-1)!
    expect(peak(last.outputs[0]!)).toBeLessThan(1e-3)
    expect(peak(last.outputs[1]!)).toBeLessThan(1e-3)
  })

  it('keeps the output within 1 dB of the dry level across an engage', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    const outputs = toneRun(renderer, 0, 8)

    renderer.receive({ engaged: true })
    outputs.push(...toneRun(renderer, 8 * BLOCK, SETTLED_BLOCKS))

    expect(lowestLevel(outputs)).toBeGreaterThan(MINUS_1_DB)
  })

  it('drops to dry and primes again when a reset lands mid-fade, never dipping', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    // 16 blocks prime the mask, then 10 blocks take the fade about halfway.
    const outputs = toneRun(renderer, 0, 26)

    renderer.receive({ reset: true })
    outputs.push(...toneRun(renderer, 26 * BLOCK, SETTLED_BLOCKS))

    expect(lowestLevel(outputs)).toBeGreaterThan(MINUS_1_DB)
    const last = outputs.at(-1)!
    for (let i = 0; i < BLOCK; i++) {
      const frame = (25 + SETTLED_BLOCKS) * BLOCK + i
      expect(last[i]).toBeCloseTo(tone(frame - 2048), 3)
    }
  })

  it('returns to the dry input 50 ms after it disengages', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ setting: MUTE_ALL, isMono: false })
    run(renderer, SETTLED_BLOCKS)

    renderer.receive({ setting: DEFAULT_ISOLATE, isMono: false })
    const results = run(renderer, Math.ceil(2400 / BLOCK) + 2)

    const last = results.at(-1)!
    expect(last.outputs[0]).toEqual(last.input)
  })

  it('runs the wet path at the default setting while engaged', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })

    const results = run(renderer, SETTLED_BLOCKS)

    // Fully wet, the output is the input delayed by the mask's latency, not the input.
    const start = (SETTLED_BLOCKS - 1) * BLOCK
    const last = results.at(-1)!
    expect(delayedError(last.outputs[0]!, start)).toBeLessThan(1e-3)
    expect(delayedError(last.outputs[1]!, start)).toBeLessThan(1e-3)
    expect(peak(last.outputs[0]!.map((v, i) => v - last.input[i]!))).toBeGreaterThan(0.5)
  })

  it('runs a mono input through the mask and writes it to both output channels', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })

    const results = run(renderer, SETTLED_BLOCKS, 1)

    const start = (SETTLED_BLOCKS - 1) * BLOCK
    const last = results.at(-1)!
    expect(delayedError(last.outputs[0]!, start)).toBeLessThan(1e-3)
    expect(last.outputs[1]).toEqual(last.outputs[0])
  })

  it('reverses a fade from where it stands when the target flips midway', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    // 16 blocks prime the mask, then 5 blocks fade in.
    run(renderer, 21)

    renderer.receive({ engaged: false })
    const { input, outputs } = run(renderer, 1, 2, 21 * BLOCK)[0]!

    // The mix reached 640 frames' worth and now falls one frame's worth per frame, mixing
    // the dry input and the mask's delayed copy at equal power.
    for (let i = 0; i < BLOCK; i++) {
      const angle = (((5 * BLOCK - (i + 1)) / 2400) * Math.PI) / 2
      const wet = sine(21 * BLOCK + i - 2048)
      expect(outputs[0]![i]).toBeCloseTo(input[i]! * Math.cos(angle) + wet * Math.sin(angle), 3)
    }
  })

  it('posts no outline while the input is silent, so the last one stays', () => {
    const outlines: IsolateOutline[] = []
    const renderer = new IsolateRenderer(SAMPLE_RATE, (o) => outlines.push(o))
    renderer.receive({ engaged: true })
    run(renderer, SETTLED_BLOCKS)
    const posted = outlines.length

    silentBlocks(renderer, Math.ceil(SAMPLE_RATE / BLOCK))

    expect(posted).toBeGreaterThan(0)
    expect(outlines).toHaveLength(posted)
  })

  it('plays out the mask tail after the input goes silent, then outputs silence', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    run(renderer, SETTLED_BLOCKS)

    const tail = silentBlocks(renderer, Math.ceil(4096 / BLOCK) + 4)

    // The delayed sine is still playing through the first 2048 silent frames.
    expect(peak(tail[0]![0]!)).toBeGreaterThan(0.5)
    expect(peak(tail.at(-1)![0]!)).toBe(0)
    expect(peak(tail.at(-1)![1]!)).toBe(0)
  })

  it('picks up again from silence once the input returns', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    run(renderer, SETTLED_BLOCKS)
    silentBlocks(renderer, Math.ceil(4096 / BLOCK) + 4)

    const results = run(renderer, SETTLED_BLOCKS)

    const start = (SETTLED_BLOCKS - 1) * BLOCK
    expect(delayedError(results.at(-1)!.outputs[0]!, start)).toBeLessThan(1e-3)
  })

  it('posts the outline at most 15 times a second, each a fresh copy', () => {
    const outlines: IsolateOutline[] = []
    const renderer = new IsolateRenderer(SAMPLE_RATE, (o) => outlines.push(o))
    renderer.receive({ engaged: true })

    run(renderer, Math.ceil(SAMPLE_RATE / BLOCK))

    expect(outlines.length).toBeGreaterThan(0)
    expect(outlines.length).toBeLessThanOrEqual(15)
    expect(outlines[0]!.pan).toHaveLength(32)
    expect(outlines[0]!.freq).toHaveLength(48)
    expect(outlines[1]!.pan).not.toBe(outlines[0]!.pan)
    expect(outlines[1]!.freq).not.toBe(outlines[0]!.freq)
  })

  it('posts no outline for a non-default setting until engaged', () => {
    const outlines: IsolateOutline[] = []
    const renderer = new IsolateRenderer(SAMPLE_RATE, (o) => outlines.push(o))
    renderer.receive({ setting: MUTE_ALL, isMono: false })

    run(renderer, Math.ceil(SAMPLE_RATE / BLOCK))
    expect(outlines).toEqual([])

    renderer.receive({ engaged: true })
    run(renderer, Math.ceil(SAMPLE_RATE / BLOCK))
    expect(outlines.length).toBeGreaterThan(0)
    expect(Math.max(...outlines[0]!.freq)).toBe(1)
  })

  it('drops buffered audio on reset, so nothing stale plays after a jump', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    run(renderer, SETTLED_BLOCKS)

    renderer.receive({ reset: true })
    const silence = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    const outputs = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    renderer.render(silence, outputs)

    expect(peak(outputs[0]!)).toBe(0)
    expect(peak(outputs[1]!)).toBe(0)
  })

  it('outputs silence when the input has no channels', () => {
    const renderer = new IsolateRenderer(SAMPLE_RATE, () => {})
    renderer.receive({ engaged: true })
    const outputs = [new Float32Array(BLOCK).fill(1), new Float32Array(BLOCK).fill(1)]

    renderer.render([], outputs)

    expect(peak(outputs[0]!)).toBe(0)
    expect(peak(outputs[1]!)).toBe(0)
  })
})
