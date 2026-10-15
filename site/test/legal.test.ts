import { describe, expect, it } from 'vitest'
import { APP_URL, SIGN_UP_URL, SUPPORT_EMAIL } from '../src/components/actions'
import { readPage } from './dist'

const pages = ['/privacy', '/terms', '/support']

describe.each(pages)('%s', (path) => {
  const doc = readPage(path)

  it('has one h1', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
  })

  it('links the support address', () => {
    expect(doc.querySelector(`a[href="mailto:${SUPPORT_EMAIL}"]`)).not.toBeNull()
  })

  it('shows a last updated date', () => {
    expect(doc.body.textContent).toMatch(/Last updated:? \d{4}-\d{2}-\d{2}/)
  })
})

describe('/privacy', () => {
  const text = readPage('/privacy').body.textContent ?? ''

  it.each(['Clerk', 'Neon', 'Railway', 'Cloudflare', 'Fastmail', 'Resend', 'Sentry', 'PostHog'])(
    'names %s',
    (name) => {
      expect(text).toContain(name)
    },
  )

  it.each([
    // The web app's sign-in session, never the site itself, which counts visits without cookies.
    'To keep you signed in to the web app at my.crosstune.app, it sets cookies on the crosstune.app domain',
    'visits are counted without cookies',
  ])('discloses "%s"', (phrase) => {
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
    '100 MB',
    '3 GB',
  ])('states "%s"', (phrase) => {
    expect(text.toLowerCase()).toContain(phrase.toLowerCase())
  })
})

describe.each(pages)('%s after the waitlist', (path) => {
  it('never mentions the waitlist', () => {
    expect(readPage(path).body.textContent).not.toMatch(/waitlist/i)
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

  it.each([/create an account/, /sign/, /delet/])('has a heading matching %s', (pattern) => {
    expect(headings.some((h) => pattern.test(h))).toBe(true)
  })

  it('links sign-up and sign-in to the app this build targets', () => {
    const hrefs = [...readPage('/support').querySelectorAll('main a')].map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain(SIGN_UP_URL)
    expect(hrefs).toContain(APP_URL)
  })
})
