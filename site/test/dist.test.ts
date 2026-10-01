import { describe, expect, it } from 'vitest'
import { HOME_TITLE } from '../src/components/seo'
import { JSDOM } from 'jsdom'
import { readDist, readPage } from './dist'
import { APP_URL, SIGN_IN } from '../src/components/actions'

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
