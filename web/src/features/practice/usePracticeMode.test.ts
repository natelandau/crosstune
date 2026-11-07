import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePracticeMode } from './usePracticeMode'

describe('usePracticeMode', () => {
  it('opens on Speed', () => {
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('speed')
  })

  it('keeps the chosen mode across rerenders of one page', () => {
    const { result, rerender } = renderHook(() => usePracticeMode())
    act(() => result.current[1]('loops'))
    rerender()
    expect(result.current[0]).toBe('loops')
  })

  it('opens the next page on Speed after Loops was used', () => {
    const first = renderHook(() => usePracticeMode())
    act(() => first.result.current[1]('loops'))
    first.unmount()
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('speed')
  })
})
