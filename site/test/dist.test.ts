import { describe, expect, it, vi } from 'vitest'
import { HOME_TITLE } from '../src/components/seo'
import { JSDOM } from 'jsdom'
import { readDist, readPage } from './dist'
import { runInNewContext } from 'node:vm'
import { APP_URL, SIGN_IN } from '../src/components/actions'
import { JOINED_KEY, THANKS_PATH } from '../src/scripts/waitlist'

describe('home page shell', () => {
  const doc = readPage('/')

  it('has the title and canonical link', () => {
    expect(doc.title).toBe(HOME_TITLE)
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(
      'https://crosstune.app/',
    )
  })

  it('points social tags at the og image', () => {
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toMatch(
      /\/og\.png$/,
    )
    expect(doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toMatch(
      /\/og\.png$/,
    )
  })

  it('links Sign in to the app', () => {
    const link = [...doc.querySelectorAll('nav a')].find((a) => a.textContent?.trim() === SIGN_IN)
    expect(link?.getAttribute('href')).toBe('https://my.crosstune.app')
  })

  it('links the legal and support pages in the footer', () => {
    const links = Object.fromEntries(
      [...doc.querySelectorAll('footer a')].map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]),
    )
    expect(links).toMatchObject({ Privacy: '/privacy', Terms: '/terms', Support: '/support' })
  })
})

describe('404 page', () => {
  it('exists, links to the app, and links home', () => {
    const doc = new JSDOM(readDist('/404.html')).window.document
    const hrefs = [...doc.querySelectorAll('main a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(APP_URL)
    expect(hrefs).toContain('/')
  })
})

describe('waitlist thanks page', () => {
  const doc = readPage(THANKS_PATH)

  // Runs the page's inline gate against a stand-in session store.
  function gate(stored: string | null) {
    const script = [...doc.head.querySelectorAll('script:not([src])')].find((s) =>
      s.textContent?.includes('sessionStorage'),
    )!
    const store = new Map(stored === null ? [] : [[JOINED_KEY, stored]])
    const sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
    }
    const location = { replace: vi.fn() }
    runInNewContext(script.textContent!, { sessionStorage, location })
    return { store, location }
  }

  it('stays out of search results and the sitemap', () => {
    expect(doc.querySelector('meta[name=robots]')?.getAttribute('content')).toBe('noindex')
    expect(readDist('/sitemap-0.xml')).not.toContain(THANKS_PATH)
  })

  it('links to the app and home', () => {
    const hrefs = [...doc.querySelectorAll('main a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(APP_URL)
    expect(hrefs).toContain('/')
  })

  it('shows once after a join and clears the flag', () => {
    const { store, location } = gate('1')
    expect(location.replace).not.toHaveBeenCalled()
    expect(store.has(JOINED_KEY)).toBe(false)
  })

  it('sends a visitor who did not just join to the home page', () => {
    expect(gate(null).location.replace).toHaveBeenCalledWith('/')
  })
})

describe('_redirects', () => {
  it('sends /waitlist and /waitlist/ to the waitlist form', () => {
    const rules = readDist('/_redirects')
    expect(rules).toMatch(/^\/waitlist \/#waitlist 302$/m)
    expect(rules).toMatch(/^\/waitlist\/ \/#waitlist 302$/m)
  })
})

describe('_headers', () => {
  it('caches hashed assets for a year', () => {
    expect(readDist('/_headers')).toMatch(
      /^\/_astro\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m,
    )
  })

  it('serves /sw.js with no-cache', () => {
    expect(readDist('/_headers')).toMatch(/^\/sw\.js\n\s+Cache-Control: no-cache$/m)
  })
})
