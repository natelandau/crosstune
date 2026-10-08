import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSheetSession } from './useSheetSession'

const callbacks = { onOpen: () => {}, onClose: () => {} }

describe('useSheetSession', () => {
  it('shows nothing before the first target', () => {
    const { result } = renderHook(() => useSheetSession<string>(null, callbacks))
    expect(result.current.shown).toBeNull()
  })

  it('shows the target a sheet opens for', () => {
    const { result } = renderHook(() => useSheetSession('a', callbacks))
    expect(result.current.shown).toBe('a')
  })

  it('keeps showing the last target after the parent clears it, while the sheet leaves', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: string | null }) => useSheetSession(target, callbacks),
      { initialProps: { target: 'a' as string | null } },
    )

    rerender({ target: null })
    expect(result.current.shown).toBe('a')

    rerender({ target: 'b' })
    expect(result.current.shown).toBe('b')
  })
})
