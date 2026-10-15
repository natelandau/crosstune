import { describe, expect, it } from 'vitest'
import { HOME_TITLE } from '../src/components/seo'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { dist, parseHtml, readDist, readPage } from './dist'
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
    const doc = parseHtml(readDist('/404.html'))
    const hrefs = [...doc.querySelectorAll('main a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(APP_URL)
    expect(hrefs).toContain('/')
  })
})

describe('the retired waitlist', () => {
  it("sends /waitlist and /waitlist/ to the web app's sign-up screen", () => {
    const rules = readDist('/_redirects')
    expect(rules).toMatch(/^\/waitlist https:\/\/my\.crosstune\.app\/sign-up 302$/m)
    expect(rules).toMatch(/^\/waitlist\/ https:\/\/my\.crosstune\.app\/sign-up 302$/m)
  })

  it('builds no thanks page', () => {
    expect(existsSync(join(dist, 'waitlist'))).toBe(false)
  })

  it('names the waitlist nowhere but the redirects', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : [path]
      })
    const mentions = files(dist)
      .filter((path) => /\.(html|txt|xml|js|css|json)$/.test(path))
      .filter((path) => /waitlist/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(dist, path))
    expect(mentions).toEqual([])
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
