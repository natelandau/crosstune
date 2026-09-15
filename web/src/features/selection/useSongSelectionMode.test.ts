import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSongSelectionMode } from './useSongSelectionMode'

const IDS = ['a', 'b']

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSongSelectionMode', () => {
  it('subscribes to keys once and leaves through the latest setter', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderHook(
      ({ setActive }) => useSongSelectionMode({ visibleIds: IDS, active: true, setActive }),
      { initialProps: { setActive: vi.fn() } },
    )
    const latest = vi.fn()
    rerender({ setActive: vi.fn() })
    rerender({ setActive: latest })
    const keydownSubscriptions = addListener.mock.calls.filter(([type]) => type === 'keydown')
    expect(keydownSubscriptions).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(latest).toHaveBeenCalledWith(false)
  })
})
