import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { settleOpen, useOpenRow } from './swipe'

describe('settleOpen', () => {
  it.each([
    ['short of half closes', { x: -60, velocityX: 0 }, false],
    ['past half opens', { x: -100, velocityX: 0 }, true],
    ['a fast leftward flick opens from closed', { x: -20, velocityX: -800 }, true],
    ['a fast rightward flick closes from open', { x: -140, velocityX: 800 }, false],
    ['a slow small drag on an open row stays open', { x: -150, velocityX: 50 }, true],
    ['a flick at exactly the leftward threshold opens', { x: -140, velocityX: -500 }, true],
    ['a flick at exactly the rightward threshold closes', { x: -20, velocityX: 500 }, false],
    ['a slow release at exactly half the reveal width opens', { x: -80, velocityX: 0 }, true],
    ['a slow release just short of half closes', { x: -79, velocityX: 499 }, false],
  ])('%s', (_name, input, expected) => {
    expect(settleOpen({ ...input, revealWidth: 160 })).toBe(expected)
  })
})

describe('useOpenRow', () => {
  it('keeps one row open at a time', () => {
    const { result } = renderHook(() => useOpenRow())
    act(() => result.current('a').onOpenChange(true))
    expect(result.current('a').open).toBe(true)
    act(() => result.current('b').onOpenChange(true))
    expect(result.current('a').open).toBe(false)
    expect(result.current('b').open).toBe(true)
  })

  it('closes the open row when another row starts a swipe', () => {
    const { result } = renderHook(() => useOpenRow())
    act(() => result.current('a').onOpenChange(true))
    act(() => result.current('b').onSwipeStart())
    expect(result.current('a').open).toBe(false)
    expect(result.current('b').open).toBe(false)
  })

  it('keeps a row open while that same row starts another swipe', () => {
    const { result } = renderHook(() => useOpenRow())
    act(() => result.current('a').onOpenChange(true))
    act(() => result.current('a').onSwipeStart())
    expect(result.current('a').open).toBe(true)
  })

  it('ignores a close from a row that is not open', () => {
    const { result } = renderHook(() => useOpenRow())
    act(() => result.current('a').onOpenChange(true))
    act(() => result.current('b').onOpenChange(false))
    expect(result.current('a').open).toBe(true)
  })

  it('closes the open row when the page scrolls', () => {
    const { result } = renderHook(() => useOpenRow())
    act(() => result.current('a').onOpenChange(true))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current('a').open).toBe(false)
  })
})
