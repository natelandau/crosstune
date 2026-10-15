import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALREADY_SIGNED_UP,
  APP_URL,
  CREATE_ACCOUNT,
  CREATE_FREE_ACCOUNT,
  HOME_LINK,
  NATE_EMAIL,
  NO_CARD,
  PREMIUM_INCLUDED,
  SECTIONS,
  SIGN_IN,
  SIGN_UP_URL,
  START_ID,
} from '../src/components/actions'
import { CLOSING_LEDE, CLOSING_TITLE } from '../src/components/closing'
import { FAQ, FAQ_TITLE } from '../src/components/faq'
import { FEATURES, PLATFORMS, PLATFORMS_BODY, PLATFORMS_TITLE } from '../src/components/features'
import { HERO_LEDE, HERO_LEDE_LEAD, HERO_TITLE } from '../src/components/hero'
import {
  MAKER_BAND,
  MAKER_INVITE,
  MAKER_PHOTO_ALT,
  MAKER_STORY,
  MAKER_TITLE,
} from '../src/components/maker'
import {
  BILLING,
  PLAN_FREE,
  PLAN_PREMIUM,
  PRICES,
  PRICING_LEDE,
  PRICING_TITLE,
} from '../src/components/pricing'
import { PROBLEM_BODY, PROBLEM_TITLE } from '../src/components/problem'
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  OG_IMAGE_ALT,
  STRUCTURED_DATA,
  scriptJson,
} from '../src/components/seo'
import { PLACEMENTS } from '../src/scripts/analytics'
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
  it('has the headline', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    expect(text(doc.querySelector('h1'))).toBe(HERO_TITLE)
  })

  it('has the hero lede, its first sentence in bold', () => {
    const lede = doc.querySelector('.hero .lede')
    expect(text(lede)).toBe(`${HERO_LEDE_LEAD} ${HERO_LEDE}`)
    expect(text(lede?.querySelector('strong'))).toBe(HERO_LEDE_LEAD)
  })

  it('has the maker note', () => {
    const maker = doc.getElementById('maker-title')?.closest('section')
    expect([...(maker?.querySelectorAll('p') ?? [])].map(text)).toEqual([
      `${MAKER_STORY} ${MAKER_BAND.name}.`,
      `${MAKER_INVITE} ${NATE_EMAIL}.`,
    ])
  })

  it("shows Nate's photo with its description", () => {
    const maker = doc.getElementById('maker-title')?.closest('section')
    expect(maker?.querySelector('img')?.getAttribute('alt')).toBe(MAKER_PHOTO_ALT)
  })

  it('lets a reader email Nate from the maker note', () => {
    const mail = doc.querySelector(`.maker a[href="mailto:${NATE_EMAIL}"]`)
    expect(text(mail)).toBe(NATE_EMAIL)
  })

  it("links the maker note to Nate's band", () => {
    const band = doc.querySelector(`.maker a[href="${MAKER_BAND.url}"]`)
    expect(text(band)).toBe(MAKER_BAND.name)
  })

  it('has the closing lede, which promises the web today and the apps soon', () => {
    expect(CLOSING_LEDE).toBe(
      'Start free on the web today. The iPhone, iPad, and Mac apps follow soon.',
    )
    expect(text(doc.querySelector(`#${START_ID} h2 + p`))).toBe(CLOSING_LEDE)
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

  it('ends no headline with a period', () => {
    for (const heading of doc.querySelectorAll('h1, h2')) {
      expect(text(heading)).not.toMatch(/\.$/)
    }
  })

  it('nav links home, to the sections, to sign in, and to sign up', () => {
    const nav = doc.querySelector('header.nav')
    const links = [...(nav?.querySelectorAll('a') ?? [])].map((a) => [
      a.getAttribute('aria-label') ?? text(a),
      a.getAttribute('href'),
    ])
    expect(links).toEqual([
      [HOME_LINK, '/'],
      ...SECTIONS.map(([label, id]) => [label, `#${id}`]),
      [SIGN_IN, APP_URL],
      [CREATE_ACCOUNT, SIGN_UP_URL],
    ])
  })

  it("keeps the nav's Create account to one label at every width", () => {
    const link = doc.querySelector('header.nav a[data-create-account="nav"]')
    expect(link?.classList.contains('small')).toBe(true)
    expect(link?.querySelector('.short, .long, svg')).toBeNull()
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

  it.each(['hero', 'closing'])(
    'the %s button names the free account and leads to sign-up',
    (placement) => {
      const link = big(placement)
      expect(text(link)).toBe(CREATE_FREE_ACCOUNT)
      expect(link?.getAttribute('href')).toBe(SIGN_UP_URL)
      const icons = [...(link?.querySelectorAll('svg') ?? [])]
      expect(icons).toHaveLength(1)
      expect(icons[0]!.getAttribute('aria-hidden')).toBe('true')
    },
  )

  it('draws the closing button in jet, since coral has no contrast on the coral wash', () => {
    expect(closing?.classList.contains('jet')).toBe(true)
    expect(hero?.classList.contains('jet')).toBe(false)
  })

  it.each(['hero', 'closing'])('the %s button lists the terms under it', (placement) => {
    const items = [...(big(placement)?.parentElement?.querySelectorAll('.checks li') ?? [])]
    expect(items.map(text)).toEqual([PREMIUM_INCLUDED, NO_CARD])
    for (const item of items) {
      expect(item.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it.each(['hero', 'closing'])(
    'the %s button offers sign in to people who already have an account',
    (placement) => {
      const note = big(placement)?.parentElement?.querySelector('.note')
      expect(text(note)).toBe(`${ALREADY_SIGNED_UP} ${SIGN_IN}`)
      expect(note?.querySelector('a')?.getAttribute('href')).toBe(APP_URL)
    },
  )

  it('offers the free account on the Free card and an account on the Premium card', () => {
    const free = doc.querySelector('#pricing a[data-create-account="pricing_free"]')
    const premium = doc.querySelector('#pricing a[data-create-account="pricing_premium"]')
    expect(text(free)).toBe(CREATE_FREE_ACCOUNT)
    expect(free?.className).toBe('button quiet')
    expect(text(premium)).toBe(CREATE_ACCOUNT)
    expect(premium?.className).toBe('button')
  })

  it('sends every Create account link to sign-up, one per placement', () => {
    const links = [...doc.querySelectorAll('[data-create-account]')]
    expect(links.map((a) => a.getAttribute('data-create-account')).sort()).toEqual(
      [...PLACEMENTS].sort(),
    )
    for (const link of links) expect(link.getAttribute('href')).toBe(SIGN_UP_URL)
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
      expect(text(section?.querySelector('h2'))).toBe(feature.heading)
      expect(text(section?.querySelector('.copy > p'))).toBe(feature.body)
      expect([...(section?.querySelectorAll('.points li') ?? [])].map(text)).toEqual(
        feature.points ?? [],
      )
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

  it('names the platforms under their picture', () => {
    const section = doc.getElementById('platforms-title')?.closest('section')
    expect(text(section?.querySelector('h2'))).toBe(PLATFORMS_TITLE)
    expect(text(section?.querySelector('.head p'))).toBe(PLATFORMS_BODY)
    const names = [...(section?.querySelectorAll('.names li') ?? [])].map((li) => ({
      name: text(li.querySelector('b')),
      detail: text(li.querySelector('span')),
    }))
    expect(names).toEqual(PLATFORMS.map(({ name, detail }) => ({ name, detail })))
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

  it('names the genres and instruments players search for', () => {
    for (const word of ['fiddle', 'banjo', 'by ear', 'old-time', 'bluegrass', 'Irish', 'folk']) {
      expect(HOME_DESCRIPTION).toContain(word)
    }
  })

  it('gives link previews the image size and alt text', () => {
    expect(meta('meta[property="og:image:width"]')).toBe('1200')
    expect(meta('meta[property="og:image:height"]')).toBe('630')
    expect(meta('meta[property="og:image:alt"]')).toBe(OG_IMAGE_ALT)
    expect(meta('meta[name="twitter:image:alt"]')).toBe(OG_IMAGE_ALT)
    expect(meta('meta[property="og:locale"]')).toBe('en_US')
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
      'FAQPage',
    ])
  })

  it('prices the plans as the pricing section does', () => {
    const app = STRUCTURED_DATA['@graph'].find((node) => node['@type'] === 'WebApplication')
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
  it('has exactly the copy h2s in order', () => {
    expect([...doc.querySelectorAll('h2')].map(text)).toEqual([
      PROBLEM_TITLE,
      ...FEATURES.map((feature) => feature.heading),
      PLATFORMS_TITLE,
      PRICING_TITLE,
      MAKER_TITLE,
      FAQ_TITLE,
      CLOSING_TITLE,
    ])
  })

  it('has the problem band', () => {
    expect(text(doc.querySelector('.problem p'))).toBe(PROBLEM_BODY)
  })

  const pricing = doc.getElementById('pricing')!

  it('shows both plans with their bullets', () => {
    expect(pricing.tagName).toBe('SECTION')
    expect(pricing.getAttribute('aria-labelledby')).toBe(pricing.querySelector('h2')?.id)
    expect(text(pricing.querySelector('.lede'))).toBe(PRICING_LEDE)
    expect([...pricing.querySelectorAll('.plan h3')].map(text)).toEqual([
      PLAN_FREE.name,
      PLAN_PREMIUM.name,
    ])
    const lists = [...pricing.querySelectorAll('.plan ul')].map((ul) =>
      [...ul.querySelectorAll('li')].map(text),
    )
    expect(lists).toEqual([PLAN_FREE.bullets, PLAN_PREMIUM.bullets])
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
    expect([...faq.querySelectorAll('h3')].map(text)).toEqual(FAQ.map((item) => item.question))
    expect([...faq.querySelectorAll('.answer')].map(text)).toEqual(FAQ.map((item) => item.answer))
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
