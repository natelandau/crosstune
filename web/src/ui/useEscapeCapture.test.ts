import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEscapeCapture } from './useEscapeCapture'

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event
}

describe('useEscapeCapture', () => {
  it('takes Escape when its overlay is on top, so nothing else hears it', () => {
    const onEscape = vi.fn()
    const below = vi.fn()
    document.body.addEventListener('keydown', below)
    try {
      renderHook(() => useEscapeCapture(onEscape, { when: () => true }))

      const event = press('Escape')

      expect(onEscape).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
      expect(below).not.toHaveBeenCalled()
    } finally {
      document.body.removeEventListener('keydown', below)
    }
  })

  it('lets Escape pass when its overlay is not on top', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeCapture(onEscape, { when: () => false }))

    const event = press('Escape')

    expect(onEscape).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores other keys', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeCapture(onEscape, { when: () => true }))

    press('Enter')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('stands down while disabled and once unmounted', () => {
    const onEscape = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useEscapeCapture(onEscape, { enabled, when: () => true }),
      { initialProps: { enabled: false } },
    )
    press('Escape')
    rerender({ enabled: true })
    unmount()
    press('Escape')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('runs the latest handler', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ onEscape }) => useEscapeCapture(onEscape, { when: () => true }),
      { initialProps: { onEscape: first } },
    )
    rerender({ onEscape: second })

    press('Escape')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
