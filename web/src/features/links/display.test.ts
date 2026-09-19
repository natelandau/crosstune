import { describe, expect, it } from 'vitest'
import { displayTitle, providerLabel } from './display'

describe('link display', () => {
  it('labels every provider, and an unknown one as a plain link', () => {
    expect(providerLabel({ provider: 'tidal' })).toBe('TIDAL')
    expect(providerLabel({ provider: 'internet_archive' })).toBe('Internet Archive')
    expect(providerLabel({ provider: 'napster' })).toBe('Link')
  })

  it('falls back from the title to the label to the hostname to the raw url', () => {
    expect(
      displayTitle({
        title: 'Ground Hog',
        label: 'slow version',
        url: 'https://tidal.com/track/1',
      }),
    ).toBe('Ground Hog')
    expect(
      displayTitle({ title: null, label: 'slow version', url: 'https://tidal.com/track/1' }),
    ).toBe('slow version')
    expect(displayTitle({ title: null, label: null, url: 'https://tidal.com/track/1' })).toBe(
      'tidal.com',
    )
    expect(displayTitle({ title: null, label: null, url: 'not a url' })).toBe('not a url')
  })
})
