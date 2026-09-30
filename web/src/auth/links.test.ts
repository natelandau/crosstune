import { describe, expect, it } from 'vitest'
import { resolveSiteUrl, WAITLIST_URL } from './links'

describe('links', () => {
  it('points the waitlist at the site', () => {
    expect(WAITLIST_URL).toBe('https://crosstune.app/waitlist')
  })

  it('falls back to production when unset or empty, and strips a trailing slash', () => {
    expect(resolveSiteUrl(undefined)).toBe('https://crosstune.app')
    expect(resolveSiteUrl('')).toBe('https://crosstune.app')
    expect(resolveSiteUrl('http://localhost:4321/')).toBe('http://localhost:4321')
  })
})
