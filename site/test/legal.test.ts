import { readFileSync } from 'node:fs'
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
    'IP geolocation by DB-IP',
    'licensed under CC BY 4.0',
    // The countries where Share usage data starts off, as the API's consent list names them.
    'European Economic Area (Iceland, Liechtenstein, and Norway)',
    'cannot tell which country you are in',
    // Refund records outlive a deleted account.
    'Refund records',
  ])('discloses "%s"', (phrase) => {
    expect(text).toContain(phrase)
  })

  it('never mentions session recordings, which the apps do not make', () => {
    expect(text).not.toMatch(/session recordings/i)
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

  // Read as text: the site's test config does not resolve web source imports.
  const planCopy = readFileSync(
    new URL('../../web/src/features/plan/planCopy.ts', import.meta.url),
    'utf8',
  )

  it.each(['MANAGE_SUBSCRIPTION', 'WITHDRAW_LABEL'])('names the web app label %s', (name) => {
    const label = planCopy.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1]
    expect(label).toBeDefined()
    expect(text).toContain(label)
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
