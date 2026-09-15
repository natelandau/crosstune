import { describe, expect, it } from 'vitest'
import { scrubR2Breadcrumb } from './sentryBreadcrumbs'

describe('scrubR2Breadcrumb', () => {
  it('strips the query string from a fetch breadcrumb to an r2 host', () => {
    const breadcrumb = {
      category: 'fetch',
      data: { url: 'https://crosstune-audio.r2.cloudflarestorage.com/rec/1?X-Amz-Signature=abc' },
    }
    expect(scrubR2Breadcrumb(breadcrumb)).toEqual({
      category: 'fetch',
      data: { url: 'https://crosstune-audio.r2.cloudflarestorage.com/rec/1' },
    })
  })

  it('strips the query string from an xhr breadcrumb to an r2 host', () => {
    const breadcrumb = {
      category: 'xhr',
      data: { url: 'https://bucket.r2.cloudflarestorage.com/x?sig=abc' },
    }
    expect(scrubR2Breadcrumb(breadcrumb).data?.url).toBe(
      'https://bucket.r2.cloudflarestorage.com/x',
    )
  })

  it('leaves a breadcrumb to the API untouched', () => {
    const breadcrumb = { category: 'fetch', data: { url: 'https://api.crosstune.app/v1/me' } }
    expect(scrubR2Breadcrumb(breadcrumb)).toBe(breadcrumb)
  })

  it('leaves a non-network breadcrumb untouched', () => {
    const breadcrumb = { category: 'ui.click', message: 'button' }
    expect(scrubR2Breadcrumb(breadcrumb)).toBe(breadcrumb)
  })

  it('leaves a breadcrumb with no url untouched', () => {
    const breadcrumb = { category: 'fetch', data: { method: 'GET' } }
    expect(scrubR2Breadcrumb(breadcrumb)).toBe(breadcrumb)
  })

  it('does not mistake a host that merely contains the r2 suffix as a subdomain', () => {
    const breadcrumb = {
      category: 'fetch',
      data: { url: 'https://evil.example/not.r2.cloudflarestorage.com?x=1' },
    }
    expect(scrubR2Breadcrumb(breadcrumb)).toBe(breadcrumb)
  })
})
