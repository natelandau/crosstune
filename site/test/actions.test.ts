import { describe, expect, it } from 'vitest'
import { resolveAppUrl } from '../src/components/actions'

describe('resolveAppUrl', () => {
  it('falls back to the production app when unset or empty', () => {
    expect(resolveAppUrl(undefined)).toBe('https://my.crosstune.app')
    expect(resolveAppUrl('')).toBe('https://my.crosstune.app')
  })

  it('uses the given origin without a trailing slash', () => {
    expect(resolveAppUrl('http://localhost:5173/')).toBe('http://localhost:5173')
  })
})
