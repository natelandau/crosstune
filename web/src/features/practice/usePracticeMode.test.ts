import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODE_KEY, usePracticeMode } from './usePracticeMode'

afterEach(() => {
  localStorage.clear()
})

describe('usePracticeMode', () => {
  it('opens on Loops the first time', () => {
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('loops')
  })

  it('remembers the last mode for the next visit', () => {
    const first = renderHook(() => usePracticeMode())
    act(() => first.result.current[1]('pitch'))
    expect(first.result.current[0]).toBe('pitch')
    first.unmount()
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('pitch')
  })

  it('opens on Loops when the stored mode is one it does not know', () => {
    localStorage.setItem(MODE_KEY, 'tempo')
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('loops')
  })

  it('still switches modes when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => usePracticeMode())
    expect(result.current[0]).toBe('loops')
    act(() => result.current[1]('speed'))
    expect(result.current[0]).toBe('speed')
  })
})
