import { describe, expect, it } from 'vitest'
import { routePattern, scrubEvent, scrubUrl } from './scrub'

const ID = '3f0c1b52-8a7e-4d3a-9c11-2b6f5e0a7d44'

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('routePattern', () => {
  it("keeps the app's words and replaces everything else", () => {
    expect(routePattern(`/catalog/${ID}`)).toBe('/catalog/:id')
    expect(routePattern('/lists/a/tunes/b')).toBe('/lists/:id/tunes/:id')
    expect(routePattern('/settings/appearance')).toBe('/settings/appearance')
    expect(routePattern('/settings/stats/tunes/x')).toBe('/settings/stats/tunes/:id')
    expect(routePattern('/some typed words')).toBe('/:id')
    expect(routePattern('/')).toBe('/')
  })
})

describe('scrubEvent', () => {
  it('strips query, hash, and tokens from every URL property', () => {
    const urls = {
      $current_url: `https://app.crosstune.app/catalog/${ID}?__clerk_handshake=abc#x`,
      $pathname: `/catalog/${ID}`,
      $referrer: 'https://accounts.example.com/sign-in?redirect=https%3A%2F%2Fapp.crosstune.app',
      $initial_current_url: `https://app.crosstune.app/lists/${ID}?ticket=zzz#top`,
      $initial_pathname: `/lists/${ID}`,
      $initial_referrer: 'https://accounts.example.com/sign-in?redirect=x#y',
    }
    const event = {
      event: 'x',
      properties: { ...urls, $browser: 'Chrome' },
      $set: { ...urls },
      $set_once: { ...urls },
    }
    const out = scrubEvent(event)!
    expect(out.properties.$current_url).toBe('https://app.crosstune.app/catalog/:id')
    expect(out.properties.$pathname).toBe('/catalog/:id')
    expect(out.properties.$referrer).toBe('accounts.example.com')
    expect(out.properties.$initial_current_url).toBe('https://app.crosstune.app/lists/:id')
    expect(out.properties.$browser).toBe('Chrome')
    expect(out.$set.$current_url).toBe('https://app.crosstune.app/catalog/:id')
    expect(out.$set_once.$initial_referrer).toBe('accounts.example.com')
    for (const s of strings(out)) {
      expect(s).not.toMatch(/[?#]/)
    }
  })

  it('scrubs the session entry URL, path, and referrer', () => {
    const out = scrubEvent({
      properties: {
        $session_entry_url: `https://app.crosstune.app/tunes/${ID}?q=Silver`,
        $session_entry_pathname: `/tunes/${ID}`,
        $session_entry_referrer: 'https://www.google.com/search?q=Silver+Spear',
      },
    })!
    expect(out.properties).toEqual({
      $session_entry_url: 'https://app.crosstune.app/tunes/:id',
      $session_entry_pathname: '/tunes/:id',
      $session_entry_referrer: 'www.google.com',
    })
  })

  it('scrubs $set and $set_once nested in the properties', () => {
    const out = scrubEvent({
      properties: {
        $set: { $current_url: `https://app.crosstune.app/lists/${ID}?x=1` },
        $set_once: { $initial_referrer: 'https://accounts.example.com/sign-in?r=1' },
      },
    })!
    expect(out.properties.$set).toEqual({ $current_url: 'https://app.crosstune.app/lists/:id' })
    expect(out.properties.$set_once).toEqual({ $initial_referrer: 'accounts.example.com' })
  })

  it('deletes a URL or referrer that cannot be parsed, and keeps $direct', () => {
    const out = scrubEvent({
      properties: {
        $current_url: 'Silver Spear?q=1',
        $referrer: 'not a url',
        $initial_referrer: '$direct',
        $session_entry_referrer: '',
      },
    })!
    expect(out.properties).toEqual({ $initial_referrer: '$direct', $session_entry_referrer: '' })
  })

  it('passes null through', () => {
    expect(scrubEvent(null)).toBeNull()
  })
})

describe('scrubUrl', () => {
  it('keeps the origin and route pattern only', () => {
    expect(scrubUrl(`https://app.crosstune.app/catalog/${ID}?__clerk_handshake=abc#x`)).toBe(
      'https://app.crosstune.app/catalog/:id',
    )
    expect(scrubUrl('https://app.crosstune.app')).toBe('https://app.crosstune.app/')
  })

  it('returns a non-empty placeholder for input that is not a URL', () => {
    expect(scrubUrl('not a url?token=1')).toBe('/')
    expect(scrubUrl('')).toBe('/')
  })
})
