import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_GUARD_MS } from './swipe'
import { LONG_PRESS_MS, useLongPress } from './useLongPress'

function Row({ onLongPress, onClick }: { onLongPress?: () => void; onClick?: () => void }) {
  const handlers = useLongPress(onLongPress)
  return (
    <div data-testid="row" {...handlers} onClick={onClick}>
      Row
    </div>
  )
}

const row = () => screen.getByTestId('row')
const press = (options: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(row(), {
    clientX: 100,
    clientY: 100,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    ...options,
  })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  act(() => vi.advanceTimersByTime(CLICK_GUARD_MS + 10))
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('fires after a 500ms hold', () => {
    const onLongPress = vi.fn()
    render(<Row onLongPress={onLongPress} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1))
    expect(onLongPress).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('tolerates a small drift', () => {
    const onLongPress = vi.fn()
    render(<Row onLongPress={onLongPress} />)
    press()
    fireEvent.pointerMove(row(), { clientX: 106, clientY: 106, isPrimary: true, pointerId: 1 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('cancels when the pointer moves more than 10px', () => {
    const onLongPress = vi.fn()
    render(<Row onLongPress={onLongPress} />)
    press()
    fireEvent.pointerMove(row(), { clientX: 100, clientY: 115, isPrimary: true, pointerId: 1 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('cancels on an early release', () => {
    const onLongPress = vi.fn()
    render(<Row onLongPress={onLongPress} />)
    press()
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerUp(row(), { isPrimary: true, pointerId: 1 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ignores a second finger', () => {
    const onLongPress = vi.fn()
    render(<Row onLongPress={onLongPress} />)
    press({ isPrimary: false, pointerId: 2 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('swallows the click that follows a long-press, and only that one', () => {
    const onClick = vi.fn()
    render(<Row onLongPress={vi.fn()} onClick={onClick} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.pointerUp(row(), { isPrimary: true, pointerId: 1 })
    fireEvent.click(row())
    expect(onClick).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(CLICK_GUARD_MS + 10))
    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('blocks the touch context menu', () => {
    render(<Row onLongPress={vi.fn()} />)
    press()
    expect(fireEvent.contextMenu(row())).toBe(false)
  })

  it('releases the click guard when the pointer leaves', () => {
    const onClick = vi.fn()
    render(<Row onLongPress={vi.fn()} onClick={onClick} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.pointerLeave(row())
    act(() => vi.advanceTimersByTime(CLICK_GUARD_MS + 10))
    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('leaves clicks and the context menu alone without a callback', () => {
    const onClick = vi.fn()
    render(<Row onClick={onClick} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(fireEvent.contextMenu(row())).toBe(true)
  })

  it('releases a guard armed before the callback is removed', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Row onLongPress={vi.fn()} onClick={onClick} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    rerender(<Row onClick={onClick} />)
    fireEvent.pointerUp(row(), { isPrimary: true, pointerId: 1 })
    act(() => vi.advanceTimersByTime(CLICK_GUARD_MS + 10))
    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('releases a guard left armed when a new press starts', () => {
    const onClick = vi.fn()
    render(<Row onLongPress={vi.fn()} onClick={onClick} />)
    press()
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    press()
    act(() => vi.advanceTimersByTime(CLICK_GUARD_MS + 10))
    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
