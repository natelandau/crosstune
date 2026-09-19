import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFrame } from './frame'
import { getMode } from './mode'
import { useReducedMotion } from './motion'
import { usePointer } from './pointer'

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
  document.documentElement.classList.remove('ios', 'md')
})

describe('usePointer', () => {
  it('is mouse when the pointer is fine and can hover, and follows a change', () => {
    const flip = installMatchMedia({ '(hover: hover) and (pointer: fine)': true })
    const { result } = renderHook(() => usePointer())
    expect(result.current).toBe('mouse')
    act(() => flip('(hover: hover) and (pointer: fine)', false))
    expect(result.current).toBe('touch')
  })

  it('is touch when the browser cannot answer', () => {
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => usePointer())
    expect(result.current).toBe('touch')
  })
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

describe('useFrame', () => {
  it('is wide from 768px and phone below it', () => {
    const flip = installMatchMedia({ '(min-width: 768px)': false })
    const { result } = renderHook(() => useFrame())
    expect(result.current).toBe('phone')
    act(() => flip('(min-width: 768px)', true))
    expect(result.current).toBe('wide')
  })
})

describe('getMode', () => {
  it('reads the class Ionic stamps on the root and defaults to md', () => {
    expect(getMode()).toBe('md')
    document.documentElement.classList.add('ios')
    expect(getMode()).toBe('ios')
  })
})
