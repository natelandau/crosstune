import { describe, expect, it } from 'vitest'
import { displayTitle, linkSubtitle, providerLabel } from './display'

describe('link display', () => {
  it('labels every provider, and an unknown one as a plain link', () => {
    expect(providerLabel({ provider: 'tidal' })).toBe('TIDAL')
    expect(providerLabel({ provider: 'internet_archive' })).toBe('Internet Archive')
    expect(providerLabel({ provider: 'napster' })).toBe('Link')
  })

  it('falls back from the title to the hostname to the raw url', () => {
    expect(displayTitle({ title: 'Ground Hog', url: 'https://tidal.com/track/1' })).toBe(
      'Ground Hog',
    )
    expect(displayTitle({ title: null, url: 'https://tidal.com/track/1' })).toBe('tidal.com')
    expect(displayTitle({ title: null, url: 'not a url' })).toBe('not a url')
  })

  it('joins the provider and the label', () => {
    expect(linkSubtitle({ provider: 'spotify', label: 'Live' })).toBe('Spotify · Live')
    expect(linkSubtitle({ provider: 'spotify', label: null })).toBe('Spotify')
  })
})
