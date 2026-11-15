import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_STORE_ID,
  APP_STORE_URL,
  APP_URL,
  NATE_EMAIL,
  SECTIONS,
  SIGN_UP_URL,
  START_ID,
} from '../src/components/actions'
import { FAQ } from '../src/components/faq'
import { FEATURES, PLATFORMS } from '../src/components/features'
import { MAKER_BAND } from '../src/components/maker'
import { BILLING, PRICES } from '../src/components/pricing'
import { HOME_DESCRIPTION, HOME_TITLE, STRUCTURED_DATA, scriptJson } from '../src/components/seo'
import { APP_STORE_PLACEMENTS, PLACEMENTS } from '../src/scripts/analytics'
import { parseHtml, readDist, readPage } from './dist'

const doc = readPage('/')
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

function textNodes(root: Node): string[] {
  const walker = root.ownerDocument!.createTreeWalker(root, 4)
  const out: string[] = []
  while (walker.nextNode()) out.push(walker.currentNode.nodeValue ?? '')
  return out
}

// Text a reader or a link preview shows outside the body's text nodes.
function attributeTexts(): string[] {
  const out = [doc.title]
  for (const el of doc.querySelectorAll('[alt], [title], [aria-label], [placeholder]')) {
    for (const name of ['alt', 'title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(name)
      if (value) out.push(value)
    }
  }
  const meta = 'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]'
  for (const el of doc.querySelectorAll(meta)) out.push(el.getAttribute('content') ?? '')
  return out
}

describe('home page copy', () => {
  it('has one headline', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
  })

  it("describes Nate's photo", () => {
    const maker = doc.getElementById('maker-title')?.closest('section')
    expect(maker?.querySelector('img')?.getAttribute('alt')).toBeTruthy()
  })

  it.each([
    ['email Nate', `mailto:${NATE_EMAIL}`],
    ["open Nate's band's page", MAKER_BAND.url],
  ])('lets a reader %s from the maker note', (_, href) => {
    const maker = doc.getElementById('maker-title')?.closest('section')
    expect(maker?.querySelector(`a[href="${href}"]`)).not.toBeNull()
  })

  it('reads attribute text from the page', () => {
    expect(attributeTexts()).toEqual(expect.arrayContaining([HOME_TITLE, HOME_DESCRIPTION]))
  })

  it('never says song, or notation where the app says scans', () => {
    for (const value of [...textNodes(doc.body), ...attributeTexts()]) {
      expect(value).not.toMatch(/\bsong\b/i)
      expect(value).not.toMatch(/\bnotation\b/i)
    }
  })

  it('nav links home, to the sections, to sign in, and to sign up, each with a name', () => {
    const links = [...doc.querySelectorAll('header.nav a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/',
      ...SECTIONS.map(([, id]) => `#${id}`),
      APP_URL,
      SIGN_UP_URL,
    ])
    for (const link of links) expect(link.getAttribute('aria-label') ?? text(link)).not.toBe('')
  })

  it('names every nav section that exists on the page', () => {
    for (const [, id] of SECTIONS) expect(doc.getElementById(id)).not.toBeNull()
  })
})

describe('home page Create account buttons', () => {
  const big = (placement: string) => doc.querySelector(`main a[data-create-account="${placement}"]`)
  const hero = big('hero')
  const closing = big('closing')

  it('has one big button in the hero and one in the closing band', () => {
    expect(hero?.closest('.hero')).not.toBeNull()
    expect(closing?.closest(`#${START_ID}`)?.tagName).toBe('SECTION')
    expect(doc.querySelectorAll('.hero a[data-create-account]')).toHaveLength(1)
    expect(doc.querySelectorAll(`#${START_ID} a[data-create-account]`)).toHaveLength(1)
  })

  it.each(['hero', 'closing'])('the %s button hides its icons from assistive tech', (placement) => {
    const icons = [...(big(placement)?.closest('.cta')?.querySelectorAll('svg') ?? [])]
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(['hero', 'closing'])(
    'the %s button offers sign in to people who already have an account',
    (placement) => {
      const signIn = big(placement)?.closest('.cta')?.querySelector(`a[href="${APP_URL}"]`)
      expect(signIn).not.toBeNull()
    },
  )

  it('sends every Create account link to sign-up, one per placement', () => {
    const links = [...doc.querySelectorAll('[data-create-account]')]
    expect(links.map((a) => a.getAttribute('data-create-account')).sort()).toEqual(
      [...PLACEMENTS].sort(),
    )
    for (const link of links) expect(link.getAttribute('href')).toBe(SIGN_UP_URL)
  })

  it.each(['hero', 'closing'])('the %s button has the App Store button under it', (placement) => {
    const button = big(placement)
      ?.closest('.cta')
      ?.querySelector(`a[data-app-store="${placement}"]`)
    expect(button?.getAttribute('href')).toBe(APP_STORE_URL)
  })

  it('sends every App Store link to the App Store, in every placement', () => {
    const links = [...doc.querySelectorAll('[data-app-store]')]
    const placements = new Set(links.map((a) => a.getAttribute('data-app-store')))
    expect([...placements].sort()).toEqual([...APP_STORE_PLACEMENTS].sort())
    for (const link of links) expect(link.getAttribute('href')).toBe(APP_STORE_URL)
  })

  it('links each platform that has a store page, and no other', () => {
    const section = doc.getElementById('platforms-title')?.closest('section')
    const items = [...(section?.querySelectorAll('li') ?? [])]
    expect(items.map((li) => li.querySelector('a')?.getAttribute('href'))).toEqual(
      PLATFORMS.map((platform) => platform.href),
    )
  })

  it('has no form and no waitlist anchor', () => {
    expect(doc.querySelector('form')).toBeNull()
    expect(doc.getElementById('waitlist')).toBeNull()
  })

  it('gives every element its own id', () => {
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ships the layout and page module scripts and one block of structured data', () => {
    expect([...doc.querySelectorAll('script')].map((s) => s.getAttribute('type'))).toEqual([
      'application/ld+json',
      'module',
      'module',
    ])
  })
})

describe('home page features', () => {
  it('shows each feature as a section with its heading, body, and points', () => {
    for (const feature of FEATURES) {
      const section = doc.getElementById(feature.id)
      expect(section?.tagName).toBe('SECTION')
      expect(section?.getAttribute('aria-labelledby')).toBe(section?.querySelector('h2')?.id)
    }
  })

  it('gives every demo one description and hides its drawn screens from assistive tech', () => {
    const demos = [...doc.querySelectorAll('[role="img"]')]
    // Seven features, the hero, the platforms, and the five places.
    expect(demos.length).toBe(FEATURES.length + 3)
    for (const demo of demos) {
      expect(demo.getAttribute('aria-label')?.length).toBeGreaterThan(20)
      for (const child of demo.querySelectorAll('[aria-label]')) {
        expect(child.closest('[aria-hidden="true"]')).not.toBeNull()
      }
    }
  })

  it('keeps the demos out of the tab order', () => {
    for (const demo of doc.querySelectorAll('[role="img"]')) {
      expect(demo.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
    }
  })
})

describe('home page head', () => {
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')

  it('describes the page for search in a length results show whole', () => {
    expect(doc.title).toBe(HOME_TITLE)
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60)
    expect(meta('meta[name="description"]')).toBe(HOME_DESCRIPTION)
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://crosstune.app/',
    )
  })

  it('gives link previews the image size and alt text', () => {
    expect(meta('meta[property="og:image:width"]')).toBe('1200')
    expect(meta('meta[property="og:image:height"]')).toBe('630')
    expect(meta('meta[property="og:image:alt"]')).toBeTruthy()
    expect(meta('meta[name="twitter:image:alt"]')).toBe(meta('meta[property="og:image:alt"]'))
    expect(meta('meta[property="og:locale"]')).toBe('en_US')
  })

  it("offers the app in Safari's Smart App Banner", () => {
    expect(meta('meta[name="apple-itunes-app"]')).toBe(`app-id=${APP_STORE_ID}`)
  })

  it('colors the browser chrome to match the page background', () => {
    const tokens = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8')
    const white = /--white:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1]
    expect(meta('meta[name="theme-color"]')).toBe(white)
  })

  it('links icons that exist', () => {
    const icons = [...doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')]
    expect(icons.map((l) => l.getAttribute('href'))).toEqual([
      '/favicon.ico',
      '/favicon.svg',
      '/apple-touch-icon-180x180.png',
    ])
    for (const icon of icons) {
      expect(
        existsSync(resolve(import.meta.dirname, '../dist', `.${icon.getAttribute('href')}`)),
      ).toBe(true)
    }
  })

  it('escapes markup in inline JSON so copy cannot close the script', () => {
    const json = scriptJson({ answer: '</script><p>' })
    expect(json).not.toContain('<')
    expect(JSON.parse(json)).toEqual({ answer: '</script><p>' })
  })

  it('describes the site and the app as structured data', () => {
    const block = doc.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(block?.textContent ?? '{}')
    expect(data).toEqual(STRUCTURED_DATA)
    expect(data['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual([
      'WebSite',
      'Organization',
      'Person',
      'WebApplication',
      'MobileApplication',
      'FAQPage',
    ])
  })

  it('prices the plans as the pricing section does', () => {
    const app = STRUCTURED_DATA['@graph'].find((node) => node['@type'] === 'WebApplication') as
      { offers: { price: string }[] } | undefined
    const shown = doc.querySelector('#pricing')?.textContent ?? ''
    const prices = (app?.offers ?? []).map((offer) => offer.price)
    expect(prices.map((price) => `$${price}`)).toEqual(['$0', PRICES.monthly, PRICES.yearly])
    for (const price of prices) expect(shown).toContain(`$${price}`)
  })

  it('answers the questions the page shows, in order', () => {
    const faq = STRUCTURED_DATA['@graph'].find((node) => node['@type'] === 'FAQPage')
    const shown = [...doc.querySelectorAll('#questions details')].map((item) => ({
      name: text(item.querySelector('summary') as Element),
      text: text(item.querySelector('.answer') as Element),
    }))
    expect(
      (faq?.mainEntity ?? []).map((q) => ({ name: q.name, text: q.acceptedAnswer.text })),
    ).toEqual(shown)
  })
})

describe('404 page', () => {
  const page = parseHtml(readDist('/404.html'))

  it('stays out of search results', () => {
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    expect(page.querySelector('link[rel="canonical"]')).toBeNull()
  })
})

describe('home page outline and sections', () => {
  const pricing = doc.getElementById('pricing')!

  it('offers an account from both plans', () => {
    expect(pricing.tagName).toBe('SECTION')
    expect(pricing.getAttribute('aria-labelledby')).toBe(pricing.querySelector('h2')?.id)
    expect(pricing.querySelectorAll('a[data-create-account]')).toHaveLength(2)
  })

  it('shows the yearly price first and keeps the monthly one a choice away', () => {
    const periods = [...pricing.querySelectorAll<HTMLInputElement>('input[name="billing"]')]
    expect(periods.map((input) => [input.value, input.checked])).toEqual([
      ['yearly', true],
      ['monthly', false],
    ])
    for (const [period, { price, per }] of Object.entries(BILLING)) {
      const shown = pricing.querySelector(`.price[data-period="${period}"]`)
      expect(text(shown)).toContain(`${price} ${per}`)
    }
  })

  const faq = doc.getElementById('questions')!

  it('lists the questions as h3s, each with its answer', () => {
    expect(faq.tagName).toBe('SECTION')
    expect(faq.querySelectorAll('h3')).toHaveLength(FAQ.length)
    expect(faq.querySelectorAll('.answer')).toHaveLength(FAQ.length)
  })

  it("keeps the questions' open and close marker from being read out", () => {
    for (const marker of faq.querySelectorAll('summary svg')) {
      expect(marker.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('orders the sections as the nav does', () => {
    const order = [
      doc.getElementById('features'),
      pricing,
      doc.getElementById('maker-title')?.closest('section'),
      faq,
      doc.getElementById(START_ID),
    ]
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i]!.compareDocumentPosition(order[i + 1]!) & 4).toBeTruthy()
    }
  })
})

describe('home page search snippets', () => {
  it("keeps the demos' drawn screens out of search snippets", () => {
    for (const demo of doc.querySelectorAll('[role="img"]')) {
      expect(demo.hasAttribute('data-nosnippet')).toBe(true)
    }
  })

  it('preloads the headline font the stylesheet uses', () => {
    const preload = doc.querySelector('link[rel="preload"][as="font"]')
    const href = preload?.getAttribute('href') ?? ''
    expect(href).toMatch(/\/schibsted-grotesk\.[\w-]+\.woff2$/)
    expect(preload?.hasAttribute('crossorigin')).toBe(true)
    expect(readDist(href)).toBeTruthy()
  })
})
