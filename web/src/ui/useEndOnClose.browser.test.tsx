import { expect, it, vi } from 'vitest'
import { renderHookWithProviders } from '../test/render'
import { useEndOnClose } from './useEndOnClose'

it('ends the session once each time closing starts, with the latest end', () => {
  const first = vi.fn()
  const latest = vi.fn()
  const { rerender } = renderHookWithProviders(
    ({ closing, end }: { closing: boolean; end: () => void }) => useEndOnClose(closing, end),
    { initialProps: { closing: false, end: first } },
  )
  expect(first).not.toHaveBeenCalled()

  rerender({ closing: true, end: latest })
  expect(latest).toHaveBeenCalledTimes(1)
  rerender({ closing: true, end: latest })
  expect(latest).toHaveBeenCalledTimes(1)

  rerender({ closing: false, end: latest })
  rerender({ closing: true, end: latest })
  expect(latest).toHaveBeenCalledTimes(2)
  expect(first).not.toHaveBeenCalled()
})
