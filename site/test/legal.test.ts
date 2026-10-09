import { describe, expect, it } from 'vitest'
import { readPage } from './dist'

const pages = ['/privacy', '/terms', '/support']

describe.each(pages)('%s', (path) => {
  const doc = readPage(path)

  it('has one h1', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
  })

  it('links the support address', () => {
    expect(doc.querySelector('a[href="mailto:support@crosstune.app"]')).not.toBeNull()
  })

  it('shows a last updated date', () => {
    expect(doc.body.textContent).toMatch(/Last updated:? \d{4}-\d{2}-\d{2}/)
  })
})

describe('/privacy', () => {
  const text = readPage('/privacy').body.textContent ?? ''

  it.each(['Clerk', 'Neon', 'Railway', 'Cloudflare', 'Sentry', 'PostHog'])('names %s', (name) => {
    expect(text).toContain(name)
  })

  it.each(['Email Routing', 'sets cookies'])('discloses "%s"', (phrase) => {
    expect(text).toContain(phrase)
  })

  it.each([
    'no ads',
    'Usage analytics',
    'Share usage data',
    // Where the switch is on each platform.
    'Settings > About',
    'Settings > General',
    'Wi-Fi or cellular',
    'installed or in a browser tab',
    'photo library',
    'the app stops collecting',
    'if Share usage data is on, the app then reports',
    '50 MB',
    '5 GB',
  ])('states "%s"', (phrase) => {
    expect(text.toLowerCase()).toContain(phrase.toLowerCase())
  })
})

describe('/terms', () => {
  const text = readPage('/terms').body.textContent ?? ''

  it('names the governing law and the operator', () => {
    expect(text).toContain('New York')
    expect(text).toContain('Nathaniel Landau')
  })
})

describe('/support', () => {
  const headings = [...readPage('/support').querySelectorAll('h2, h3')].map(
    (h) => h.textContent?.toLowerCase() ?? '',
  )

  it.each([/waitlist/, /sign/, /delet/])('has a heading matching %s', (pattern) => {
    expect(headings.some((h) => pattern.test(h))).toBe(true)
  })
})
