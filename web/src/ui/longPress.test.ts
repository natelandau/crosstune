import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLongPress, type LongPressHandlers } from './longPress'

type PointerDownEvent = Parameters<NonNullable<LongPressHandlers['onPointerDown']>>[0]
type PointerMoveEvent = Parameters<NonNullable<LongPressHandlers['onPointerMove']>>[0]
type ContextMenuEvent = Parameters<NonNullable<LongPressHandlers['onContextMenu']>>[0]

function down(overrides: Partial<PointerDownEvent> = {}): PointerDownEvent {
  return {
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerType: 'touch',
    ...overrides,
  } as unknown as PointerDownEvent
}

function move(overrides: Partial<PointerMoveEvent> = {}): PointerMoveEvent {
  return { clientX: 0, clientY: 0, ...overrides } as unknown as PointerMoveEvent
}

function contextMenu(preventDefault: () => void): ContextMenuEvent {
  return { preventDefault } as unknown as ContextMenuEvent
}

// Real timers would make a 500ms hold an actual 500ms wait; stepping keeps the suite fast
// while still exercising the timer in several increments rather than one jump.
function stepTimers(totalMs: number, stepMs = 20) {
  let remaining = totalMs
  while (remaining > 0) {
    const chunk = Math.min(stepMs, remaining)
    act(() => {
      vi.advanceTimersByTime(chunk)
    })
    remaining -= chunk
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  // Flush any guard timeout a test left pending so its window click listener doesn't leak.
  stepTimers(200)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useLongPress', () => {
  it('fires after the hold', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    stepTimers(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('does not fire before the hold', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    stepTimers(499)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('cancels when the pointer moves past the slop', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    act(() => result.current.onPointerMove?.(move({ clientX: 11 })))
    stepTimers(500)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('keeps holding through a move inside the slop', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    act(() => result.current.onPointerMove?.(move({ clientX: 9 })))
    stepTimers(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['pointerup', 'onPointerUp'],
    ['pointercancel', 'onPointerCancel'],
    ['pointerleave', 'onPointerLeave'],
  ] as const)('cancels on %s', (_label, handlerName) => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    stepTimers(300)
    act(() => result.current[handlerName]?.())
    stepTimers(500)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it.each([
    ['a secondary pointer', { isPrimary: false }],
    ['a non-primary button', { button: 1 }],
  ] as const)('ignores %s', (_label, overrides) => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down(overrides)))
    stepTimers(500)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('vibrates where the browser can', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    act(() => result.current.onPointerDown?.(down()))
    stepTimers(500)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('swallows the trailing click for 50ms and then stops', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    const target = document.createElement('div')
    document.body.append(target)
    const onClick = vi.fn()
    target.addEventListener('click', onClick)

    act(() => result.current.onPointerDown?.(down()))
    stepTimers(500)
    act(() => result.current.onPointerUp?.())

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onClick).not.toHaveBeenCalled()

    stepTimers(50)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onClick).toHaveBeenCalledTimes(1)

    target.remove()
  })

  it.each([
    ['touch', true],
    ['mouse', false],
  ] as const)(
    'prevents the context menu for a %s pointer only when touch',
    (pointerType, shouldPrevent) => {
      const { result } = renderHook(() => useLongPress(vi.fn()))
      act(() => result.current.onPointerDown?.(down({ pointerType })))
      const preventDefault = vi.fn()
      act(() => result.current.onContextMenu?.(contextMenu(preventDefault)))
      if (shouldPrevent) {
        expect(preventDefault).toHaveBeenCalled()
      } else {
        expect(preventDefault).not.toHaveBeenCalled()
      }
    },
  )

  it('releases a guard armed before the callback was removed', () => {
    const target = document.createElement('div')
    document.body.append(target)
    const onClick = vi.fn()
    target.addEventListener('click', onClick)

    const { result, rerender } = renderHook(
      ({ onLongPress }: { onLongPress: (() => void) | undefined }) => useLongPress(onLongPress),
      { initialProps: { onLongPress: vi.fn() as (() => void) | undefined } },
    )
    act(() => result.current.onPointerDown?.(down()))
    stepTimers(500)

    rerender({ onLongPress: undefined })
    act(() => result.current.onPointerUp?.())

    stepTimers(50)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onClick).toHaveBeenCalledTimes(1)

    target.remove()
  })
})
