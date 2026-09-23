import { describe, expect, it } from 'vitest'
import { displayTitle, outboundUrl, providerLabel } from './display'

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

  it('opens only web addresses, reading a bare host as https', () => {
    expect(outboundUrl({ url: 'https://tidal.com/track/1' })).toBe('https://tidal.com/track/1')
    expect(outboundUrl({ url: 'http://example.com/x' })).toBe('http://example.com/x')
    expect(outboundUrl({ url: 'www.youtube.com/watch?v=1' })).toBe(
      'https://www.youtube.com/watch?v=1',
    )
    expect(outboundUrl({ url: 'javascript:alert(1)' })).toBeNull()
    expect(outboundUrl({ url: ' JavaScript:alert(1)' })).toBeNull()
    expect(outboundUrl({ url: 'java\tscript:alert(1)' })).toBeNull()
    expect(outboundUrl({ url: 'data:text/html,<script>alert(1)</script>' })).toBeNull()
    expect(outboundUrl({ url: 'not a url' })).toBeNull()
  })
})
