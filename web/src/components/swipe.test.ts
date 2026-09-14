import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { releaseVelocity, resist, settleOpen, useOpenRow } from './swipe'

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

describe('resist', () => {
  it.each([
    ['inside the reveal range moves one to one', -90, -90],
    ['at rest stays put', 0, 0],
    ['fully open stays put', -160, -160],
    ['past closed moves a tenth of the overshoot', 50, 5],
    ['past open moves a tenth of the overshoot', -260, -170],
  ])('%s', (_name, x, expected) => {
    expect(resist(x, 160)).toBeCloseTo(expected)
  })
})

describe('releaseVelocity', () => {
  it('is zero with fewer than two samples', () => {
    expect(releaseVelocity([])).toBe(0)
    expect(releaseVelocity([{ time: 0, x: -40 }])).toBe(0)
  })

  it('measures px/s over the last 80ms, ignoring older movement', () => {
    const samples = [
      { time: 0, x: 0 },
      { time: 100, x: -10 },
      { time: 150, x: -20 },
      { time: 200, x: -60 },
    ]
    expect(releaseVelocity(samples)).toBeCloseTo(-800)
  })

  it('is zero when every sample lands in the same instant', () => {
    expect(
      releaseVelocity([
        { time: 5, x: 0 },
        { time: 5, x: -60 },
      ]),
    ).toBe(0)
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
