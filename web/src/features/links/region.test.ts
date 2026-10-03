import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceCountry } from './region'

describe('deviceCountry', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['en-IE', 'IE'],
    ['en', 'US'],
    ['fr', 'FR'],
    ['not a tag', 'US'],
    ['es-419', 'US'],
    ['', 'US'],
    [undefined, 'US'],
  ])('maps %s to %s', (language, country) => {
    vi.stubGlobal('navigator', { language })
    expect(deviceCountry()).toBe(country)
  })
})
