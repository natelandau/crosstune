import { describe, expect, it, vi } from 'vitest'
import { tap } from './haptics'

describe('tap', () => {
  it('vibrates briefly where the browser can', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    tap()
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('does nothing where it cannot', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    expect(() => tap()).not.toThrow()
  })
})
