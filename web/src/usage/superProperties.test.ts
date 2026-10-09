import { afterEach, describe, expect, it, vi } from 'vitest'
import { displayMode, formFactor, readSuperPropertyEnv } from './superProperties'

describe('super properties', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the form factor from pointer and short side', () => {
    expect(formFactor({ coarsePointer: true, shortSide: 390 })).toBe('phone')
    expect(formFactor({ coarsePointer: true, shortSide: 820 })).toBe('tablet')
    expect(formFactor({ coarsePointer: false, shortSide: 390 })).toBe('desktop')
  })

  it('reads the display mode', () => {
    expect(displayMode(true)).toBe('standalone')
    expect(displayMode(false)).toBe('browser')
  })

  it('reads the environment from the media queries and the screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('pointer: coarse') }))
    vi.stubGlobal('screen', { width: 844, height: 390 })
    expect(readSuperPropertyEnv()).toEqual({
      coarsePointer: true,
      shortSide: 390,
      standalone: false,
    })
  })
})
