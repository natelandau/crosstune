import { describe, expect, it } from 'vitest'
import { resolveSiteUrl, SIGN_UP_PATH } from './links'

describe('links', () => {
  // The site links to this path, so moving it breaks every "Create free account" link.
  it('keeps sign-up at /sign-up', () => {
    expect(SIGN_UP_PATH).toBe('/sign-up')
  })

  it('falls back to production when unset or empty, and strips a trailing slash', () => {
    expect(resolveSiteUrl(undefined)).toBe('https://crosstune.app')
    expect(resolveSiteUrl('')).toBe('https://crosstune.app')
    expect(resolveSiteUrl('http://localhost:4321/')).toBe('http://localhost:4321')
  })
})
