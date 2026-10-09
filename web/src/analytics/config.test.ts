import { afterEach, describe, expect, it, vi } from 'vitest'
import { MASKED_ATTRIBUTE, maskReplayAttribute, WEB_POSTHOG_CONFIG } from './config'

const mask = WEB_POSTHOG_CONFIG.session_recording.maskCapturedNetworkRequestFn

describe('replay request masking', () => {
  it('reduces a URL to its route pattern and drops headers and bodies', () => {
    const out = mask({
      name: 'https://app.crosstune.app/catalog/3f0c1b52-8a7e-4d3a-9c11-2b6f5e0a7d44?__clerk_handshake=abc#x',
      entryType: 'navigation',
      duration: 0,
      startTime: 0,
      requestHeaders: { authorization: 'Bearer x' },
      requestBody: '{"title":"Tune"}',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"lyrics":"words"}',
    })
    expect(out?.name).toBe('https://app.crosstune.app/catalog/:id')
    expect(out).not.toHaveProperty('requestHeaders')
    expect(out).not.toHaveProperty('requestBody')
    expect(out).not.toHaveProperty('responseHeaders')
    expect(out).not.toHaveProperty('responseBody')
  })

  it('returns a non-empty name for a malformed URL', () => {
    expect(mask({ name: 'garbage', entryType: 'resource', duration: 0, startTime: 0 })?.name).toBe(
      '/',
    )
  })
})

const PAGE = 'https://app.crosstune.app/catalog/3f0c1b52-8a7e-4d3a-9c11-2b6f5e0a7d44'
const TITLE = 'The Silver Spear'

describe('replay attribute masking', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    'aria-label',
    'aria-description',
    'aria-valuetext',
    'aria-placeholder',
    'aria-roledescription',
    'title',
    'alt',
    'placeholder',
    'label',
    'value',
    'download',
    'srcdoc',
    'data-title',
    'data-set',
  ])('masks the words in %s', (name) => {
    expect(maskReplayAttribute(name, `Open ${TITLE}`, PAGE)).toBe(MASKED_ATTRIBUTE)
    expect(maskReplayAttribute(name.toUpperCase(), TITLE, PAGE)).toBe(MASKED_ATTRIBUTE)
  })

  it.each(['href', 'xlink:href', 'src', 'rr_src', 'poster', 'action'])(
    'reduces a same-origin %s to its route pattern',
    (name) => {
      expect(
        maskReplayAttribute(
          name,
          'https://app.crosstune.app/lists/3f0c1b52-8a7e-4d3a-9c11-2b6f5e0a7d44?q=Silver#Spear',
          PAGE,
        ),
      ).toBe('https://app.crosstune.app/lists/:id')
      expect(maskReplayAttribute(name, '/catalog/my-typed-words', PAGE)).toBe(
        'https://app.crosstune.app/catalog/:id',
      )
    },
  )

  it.each(['href', 'xlink:href', 'src', 'rr_src', 'poster', 'action'])(
    'blanks a cross-origin %s',
    (name) => {
      expect(
        maskReplayAttribute(
          name,
          'https://www.youtube.com/results?search_query=The+Silver+Spear',
          PAGE,
        ),
      ).toBe('')
      expect(maskReplayAttribute(name, 'https://www.youtube.com/embed/abc', PAGE)).toBe('')
      expect(maskReplayAttribute(name, 'data:image/png;base64,AAAA', PAGE)).toBe('')
    },
  )

  it('scrubs each same-origin srcset candidate and drops the rest', () => {
    expect(
      maskReplayAttribute(
        'srcset',
        'https://cdn.example.com/a.png 1x, /scans/Silver-Spear.png 2x',
        PAGE,
      ),
    ).toBe('https://app.crosstune.app/:id/:id 2x')
    expect(maskReplayAttribute('srcset', 'https://cdn.example.com/a.png 1x', PAGE)).toBe('')
  })

  it('blanks a URL when the page URL cannot be read', () => {
    expect(maskReplayAttribute('href', 'https://app.crosstune.app/lists/x', '')).toBe('')
  })

  it.each([
    ['class', 'flex items-center'],
    ['style', 'width: 10px;'],
    ['id', 'react-aria-1'],
    ['role', 'row'],
    ['data-color', 'blue'],
    ['data-status', 'synced'],
    ['_cssText', '.a { color: red }'],
    ['rr_width', '10px'],
  ])('keeps %s so the replay still draws', (name, value) => {
    expect(maskReplayAttribute(name, value, PAGE)).toBe(value)
  })

  it('reads the page URL from the location the recorder runs in', () => {
    vi.stubGlobal('location', new URL(PAGE))
    const fn = WEB_POSTHOG_CONFIG.session_recording.maskAttributeFn
    expect(fn('aria-label', `Open ${TITLE}`)).toBe(MASKED_ATTRIBUTE)
    expect(fn('href', `${PAGE}?q=x`)).toBe('https://app.crosstune.app/catalog/:id')
    expect(fn('href', 'https://www.youtube.com/watch?v=abc')).toBe('')
  })
})
