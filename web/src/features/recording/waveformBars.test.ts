import { describe, expect, it } from 'vitest'
import {
  BAR_GAP,
  BAR_WIDTH,
  barCount,
  createLevels,
  layoutBars,
  pushLevel,
  rmsLevel,
} from './waveformBars'

const STEP = BAR_WIDTH + BAR_GAP

describe('waveform bars', () => {
  it('reads silence as zero and a full-scale square wave as one', () => {
    expect(rmsLevel(new Uint8Array([128, 128, 128]))).toBe(0)
    expect(rmsLevel(new Uint8Array([0, 0]))).toBe(1)
    expect(rmsLevel(new Uint8Array([]))).toBe(0)
  })

  it('fits one bar per step across the width', () => {
    expect(barCount(10 * STEP)).toBe(10)
    expect(barCount(0)).toBe(0)
  })

  it('scrolls the newest level in at the right edge and drops the oldest', () => {
    const state = createLevels('scrolling')
    for (const level of [0.1, 0.2, 0.3]) pushLevel(state, level, 2)
    expect(state.levels).toEqual([0.2, 0.3])
    const bars = layoutBars(state, 10 * STEP, 100)
    expect(bars.map((b) => b.x)).toEqual([8 * STEP, 9 * STEP])
  })

  it('under fixed mode writes each level in place and cycles the slot without moving bars', () => {
    const state = createLevels('fixed')
    for (const level of [0.1, 0.2, 0.3]) pushLevel(state, level, 2)
    expect(state.levels).toEqual([0.3, 0.2])
    expect(state.cursor).toBe(1)
    const bars = layoutBars(state, 10 * STEP, 100)
    expect(bars.map((b) => b.x)).toEqual([0, STEP])
  })

  it('keeps fixed slots that still fit when the bar count changes', () => {
    const state = createLevels('fixed')
    for (const level of [0.1, 0.2, 0.3]) pushLevel(state, level, 3)
    pushLevel(state, 0.9, 2)
    expect(state.levels).toEqual([0.9, 0.2])
    expect(state.cursor).toBe(1)
  })

  it('clamps bar height between a visible minimum and the canvas, centered vertically', () => {
    const state = createLevels('scrolling')
    pushLevel(state, 0, 3)
    pushLevel(state, 1, 3)
    const [quiet, loud] = layoutBars(state, 100, 40)
    expect(quiet).toMatchObject({ height: 2, y: 19 })
    expect(loud).toMatchObject({ height: 40, y: 0 })
  })
})
