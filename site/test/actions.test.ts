import { describe, expect, it } from 'vitest'
import { APP_URL, SIGN_UP_URL, resolveAppUrl } from '../src/components/actions'

describe('resolveAppUrl', () => {
  it('falls back to the production app when unset or empty', () => {
    expect(resolveAppUrl(undefined)).toBe('https://my.crosstune.app')
    expect(resolveAppUrl('')).toBe('https://my.crosstune.app')
  })

  it('uses the given origin without a trailing slash', () => {
    expect(resolveAppUrl('http://localhost:5173/')).toBe('http://localhost:5173')
  })
})

describe('SIGN_UP_URL', () => {
  it("is the web app's sign-up screen", () => {
    expect(SIGN_UP_URL).toBe(`${APP_URL}/sign-up`)
  })
})
