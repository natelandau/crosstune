import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReducedMotion } from './motion'

type Listener = (event: { matches: boolean }) => void

/** A matchMedia stand-in that answers each query from a table and can flip an answer live. */
function installMatchMedia(answers: Record<string, boolean>) {
  const listeners = new Map<string, Set<Listener>>()
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return answers[query] ?? false
      },
      media: query,
      addEventListener: (_: 'change', listener: Listener) => {
        listeners.set(query, (listeners.get(query) ?? new Set()).add(listener))
      },
      removeEventListener: (_: 'change', listener: Listener) => {
        listeners.get(query)?.delete(listener)
      },
    }) as unknown as MediaQueryList
  return (query: string, matches: boolean) => {
    answers[query] = matches
    for (const listener of listeners.get(query) ?? []) listener({ matches })
  }
}

const original = window.matchMedia

afterEach(() => {
  window.matchMedia = original
})

describe('useReducedMotion', () => {
  it('follows the media query', () => {
    const flip = installMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
    act(() => flip('(prefers-reduced-motion: reduce)', false))
    expect(result.current).toBe(false)
  })

  it('is false when the browser cannot answer', () => {
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})
