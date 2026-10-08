import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Day } from './types'
import { useHeatmapCursor } from './useHeatmapCursor'

// Three weeks of days; the dates are only keys, so no clock is involved.
const DAYS: Day[] = Array.from({ length: 21 }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  music_ms: 0,
  plays: 0,
  practice_sessions: 0,
  scan_views: 0,
  tunes_added: 0,
  recordings: 0,
  status_changes: 0,
  level: 0,
}))
const LAST = DAYS.length - 1

function setup() {
  return renderHook(() => useHeatmapCursor(DAYS)).result
}

describe('useHeatmapCursor', () => {
  it('lands on the last day on the first arrow key', () => {
    const result = setup()
    expect(result.current.chosen).toBeNull()
    act(() => void result.current.move('ArrowUp'))
    expect(result.current.chosen).toBe(LAST)
  })

  it('moves a week with left and right, a day with up and down', () => {
    const result = setup()
    act(() => result.current.choose(10))
    act(() => void result.current.move('ArrowLeft'))
    expect(result.current.chosen).toBe(3)
    act(() => void result.current.move('ArrowRight'))
    expect(result.current.chosen).toBe(10)
    act(() => void result.current.move('ArrowUp'))
    expect(result.current.chosen).toBe(9)
    act(() => void result.current.move('ArrowDown'))
    expect(result.current.chosen).toBe(10)
  })

  it('clamps at both ends', () => {
    const result = setup()
    act(() => result.current.choose(2))
    act(() => void result.current.move('ArrowLeft'))
    expect(result.current.chosen).toBe(0)
    act(() => void result.current.move('ArrowUp'))
    expect(result.current.chosen).toBe(0)
    act(() => result.current.choose(LAST - 2))
    act(() => void result.current.move('ArrowRight'))
    expect(result.current.chosen).toBe(LAST)
    act(() => void result.current.move('ArrowDown'))
    expect(result.current.chosen).toBe(LAST)
  })

  it('jumps to the ends with Home and End', () => {
    const result = setup()
    act(() => void result.current.move('Home'))
    expect(result.current.chosen).toBe(0)
    act(() => void result.current.move('End'))
    expect(result.current.chosen).toBe(LAST)
  })

  it('says whether it handled a key', () => {
    const result = setup()
    let handled = true
    act(() => {
      handled = result.current.move('a')
    })
    expect(handled).toBe(false)
    expect(result.current.chosen).toBeNull()
  })
})
