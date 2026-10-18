import { describe, expect, it } from 'vitest'
import { scrubBreadcrumbUrl } from './sentryBreadcrumbs'

describe('scrubBreadcrumbUrl', () => {
  it('strips the query string from a fetch breadcrumb to an r2 host', () => {
    const breadcrumb = {
      category: 'fetch',
      data: { url: 'https://crosstune-audio.r2.cloudflarestorage.com/rec/1?X-Amz-Signature=abc' },
    }
    expect(scrubBreadcrumbUrl(breadcrumb)).toEqual({
      category: 'fetch',
      data: { url: 'https://crosstune-audio.r2.cloudflarestorage.com/rec/1' },
    })
  })

  it('strips the query string from an xhr breadcrumb', () => {
    const breadcrumb = {
      category: 'xhr',
      data: { url: 'https://bucket.r2.cloudflarestorage.com/x?sig=abc' },
    }
    expect(scrubBreadcrumbUrl(breadcrumb).data?.url).toBe(
      'https://bucket.r2.cloudflarestorage.com/x',
    )
  })

  it('strips the query string from a breadcrumb to the API', () => {
    const breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.crosstune.app/v1/links/search?q=x' },
    }
    expect(scrubBreadcrumbUrl(breadcrumb).data?.url).toBe(
      'https://api.crosstune.app/v1/links/search',
    )
  })

  it('strips the query string from a relative url', () => {
    const breadcrumb = { category: 'fetch', data: { url: '/v1/x?q=1' } }
    expect(scrubBreadcrumbUrl(breadcrumb).data?.url).toBe('/v1/x')
  })

  it('leaves a url with no query string untouched', () => {
    const breadcrumb = { category: 'fetch', data: { url: 'https://api.crosstune.app/v1/me' } }
    expect(scrubBreadcrumbUrl(breadcrumb)).toBe(breadcrumb)
  })

  it('leaves a non-network breadcrumb untouched', () => {
    const breadcrumb = { category: 'ui.click', message: 'button' }
    expect(scrubBreadcrumbUrl(breadcrumb)).toBe(breadcrumb)
  })

  it('leaves a breadcrumb with no url untouched', () => {
    const breadcrumb = { category: 'fetch', data: { method: 'GET' } }
    expect(scrubBreadcrumbUrl(breadcrumb)).toBe(breadcrumb)
  })
})
