import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettledWrite } from './useSettledWrite'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSettledWrite', () => {
  it('writes once after a burst of changes', () => {
    const write = vi.fn()
    const { rerender } = renderHook(({ value }) => useSettledWrite(value, write), {
      initialProps: { value: 100 },
    })
    for (const value of [95, 90, 85, 80, 75]) {
      rerender({ value })
      vi.advanceTimersByTime(300)
    }
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(75)
  })

  it('never writes the value it started with', () => {
    const write = vi.fn()
    renderHook(() => useSettledWrite(100, write))
    vi.advanceTimersByTime(5000)
    expect(write).not.toHaveBeenCalled()
  })

  it('writes a value still waiting when it unmounts', () => {
    const write = vi.fn()
    const { rerender, unmount } = renderHook(({ value }) => useSettledWrite(value, write), {
      initialProps: { value: 0 },
    })
    rerender({ value: 200 })
    unmount()
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(200)
    vi.advanceTimersByTime(5000)
    expect(write).toHaveBeenCalledOnce()
  })

  it('writes nothing more on unmount once the value has settled', () => {
    const write = vi.fn()
    const { rerender, unmount } = renderHook(({ value }) => useSettledWrite(value, write), {
      initialProps: { value: 0 },
    })
    rerender({ value: 200 })
    vi.advanceTimersByTime(1000)
    unmount()
    expect(write).toHaveBeenCalledOnce()
  })

  it('uses the latest write function', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ value, write }) => useSettledWrite(value, write), {
      initialProps: { value: 0, write: first },
    })
    rerender({ value: 100, write: second })
    vi.advanceTimersByTime(1000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(100)
  })
})
