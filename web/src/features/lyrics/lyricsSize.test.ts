import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LYRICS_STEP,
  LYRICS_SIZE_KEY,
  LYRICS_STEPS,
  readLyricsStep,
  setLyricsStep,
  stepLyricsSize,
} from './lyricsSize'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('lyricsSize', () => {
  it('starts at the default and writes a chosen step', () => {
    expect(readLyricsStep()).toBe(DEFAULT_LYRICS_STEP)
    setLyricsStep(2)
    expect(localStorage.getItem(LYRICS_SIZE_KEY)).toBe('2')
  })

  it('clamps a step to the ends of the scale', () => {
    setLyricsStep(0)
    expect(readLyricsStep()).toBe(1)
    setLyricsStep(99)
    expect(readLyricsStep()).toBe(LYRICS_STEPS)
  })

  it("moves by a delta from the stored step, not from a caller's copy", () => {
    setLyricsStep(2)
    const stale = 2
    expect(stepLyricsSize(1)).toBe(3)
    expect(stepLyricsSize(1)).toBe(4)
    expect(readLyricsStep()).toBeGreaterThan(stale + 1)
  })

  it('clamps a delta at the ends of the scale', () => {
    setLyricsStep(LYRICS_STEPS)
    expect(stepLyricsSize(1)).toBe(LYRICS_STEPS)
    setLyricsStep(1)
    expect(stepLyricsSize(-1)).toBe(1)
  })

  it('falls back to the default for a non-finite step', () => {
    setLyricsStep(Number.NaN)
    expect(readLyricsStep()).toBe(DEFAULT_LYRICS_STEP)
    expect(localStorage.getItem(LYRICS_SIZE_KEY)).toBe(String(DEFAULT_LYRICS_STEP))
  })

  it('falls back to the default for a stored value that is not a step', () => {
    localStorage.setItem(LYRICS_SIZE_KEY, 'roomy')
    expect(readLyricsStep()).toBe(DEFAULT_LYRICS_STEP)
  })

  it('changes in memory and notifies subscribers while storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const fresh = await import('./lyricsSize')
    const { result } = renderHook(() => fresh.useLyricsStep())
    expect(result.current).toBe(fresh.DEFAULT_LYRICS_STEP)
    act(() => fresh.setLyricsStep(6))
    expect(result.current).toBe(6)
  })
})

describe('useLyricsStep', () => {
  it('re-renders with the step a later call chooses', async () => {
    // A fresh module instance, not the statically imported one: its module-scope cache
    // persists across tests in this file, so an earlier test's step would otherwise leak in
    // and make this assertion pass for the wrong reason.
    const fresh = await import('./lyricsSize')
    const { result } = renderHook(() => fresh.useLyricsStep())
    expect(result.current).toBe(fresh.DEFAULT_LYRICS_STEP)
    act(() => fresh.setLyricsStep(2))
    expect(result.current).toBe(2)
  })
})
