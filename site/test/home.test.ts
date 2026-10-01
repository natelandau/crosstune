import { describe, expect, it } from 'vitest'
import { JOIN_WAITLIST, NATE_EMAIL, SIGN_IN } from '../src/components/actions'
import { CHAPTERS } from '../src/components/chapters/chapters'
import {
  CATALOG_REST,
  LISTS,
  MAX_ROWS,
  moreLabel,
  RAIL,
  SHOW_ALL,
  TUNES,
} from '../src/demos/catalog'
import { PITCH_DOWN, PITCH_UP, PLAY, PLAYER_REST, REST_LINE } from '../src/demos/practice'
import { LINKS, RECORD_LABEL, RECORD_REST } from '../src/demos/record'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { resolve } from 'node:path'
import { HOME_DESCRIPTION, HOME_TITLE, STRUCTURED_DATA } from '../src/components/seo'
import { readDist, readPage } from './dist'

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
    expect(text(doc.querySelector('h1'))).toBe(
      'The tune list in your case, rebuilt for your phone.',
    )
  })

  it('has the why heading, then the closing band', () => {
    expect([...doc.querySelectorAll('h2')].map(text)).toEqual([
      'Why musicians love Crosstune',
      'Who built this',
      'Crosstune opens to players a few at a time.',
    ])
  })

  it('has the why lede', () => {
    expect(text(doc.querySelector('.why .lede'))).toBe(
      "It's made for learning by ear: hear a tune, slow it down, and play along until it's yours.",
    )
  })

  it('has the chapters in order under the why heading', () => {
    expect([...doc.querySelectorAll('.why .chapter h3')].map(text)).toEqual(
      CHAPTERS.map((c) => c.title),
    )
    expect([...doc.querySelectorAll('.why .chapter .sentence')].map(text)).toEqual(
      CHAPTERS.map((c) => c.sentence),
    )
  })

  it('links each chapter from the nav', () => {
    const links = [...doc.querySelectorAll('nav .chapters a')]
    expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual(
      CHAPTERS.map((c) => [c.nav, `#${c.id}`]),
    )
    for (const c of CHAPTERS) expect(doc.getElementById(c.id)?.tagName).toBe('SECTION')
  })

  it('has the hero lede', () => {
    expect(text(doc.querySelector('.hero .lede'))).toBe(
      'Crosstune is a tune list and practice app for musicians who learn by ear. Keep every tune you know or want to learn next to the recordings you learn from, then slow them down, shift the pitch, and loop the hard parts. Made for old-time, bluegrass, Irish, and folk players.',
    )
  })

  it('has the maker note', () => {
    const paragraphs = [...doc.querySelectorAll('figure blockquote p')].map(text)
    expect(paragraphs).toEqual([
      "I'm Nate, and I built Crosstune because I needed it myself. I was tired of the folded list of tunes in my fiddle case, and of keeping the tunes I wanted to learn in lists scattered across online services. I'm a fiddle player in New York's old-time scene and a member of the Strung Out String Band.",
      `I'd love to hear from you. Send feedback, ideas, or anything that gets in your way to ${NATE_EMAIL}.`,
    ])
  })

  it('has the closing lede', () => {
    expect(text(doc.querySelector('#waitlist .lede'))).toBe(
      "Join the waitlist and you'll get an email when your account is ready.",
    )
  })

  it('says violin, not fiddle, outside the maker note', () => {
    const outside = doc.body.cloneNode(true) as HTMLElement
    outside.querySelector('figure blockquote')?.remove()
    expect(text(outside)).not.toMatch(/fiddle/i)
    // Search metadata may say fiddle, the word players search with; nothing on the page may.
    for (const el of doc.body.querySelectorAll('[alt], [title], [aria-label], [placeholder]')) {
      for (const name of ['alt', 'title', 'aria-label', 'placeholder']) {
        expect(el.getAttribute(name) ?? '').not.toMatch(/fiddle/i)
      }
    }
    const quote = doc.querySelector('figure blockquote')
    expect(text(quote)).toContain('fiddle player')
  })

  it('lets a reader email Nate from the maker note', () => {
    const mail = doc.querySelector(`figure blockquote a[href="mailto:${NATE_EMAIL}"]`)
    expect(text(mail)).toBe(NATE_EMAIL)
  })

  it("links the maker note to Nate's band", () => {
    const band = doc.querySelector('figure blockquote a')
    expect(text(band)).toBe('Strung Out String Band')
    expect(band?.getAttribute('href')).toBe('https://strungoutstringband.com')
  })

  it('reads attribute text from the page', () => {
    expect(attributeTexts()).toEqual(
      expect.arrayContaining([HOME_TITLE, expect.stringMatching(/campfire/), HOME_DESCRIPTION]),
    )
  })

  it('never says song and never mentions price', () => {
    for (const value of [...textNodes(doc.body), ...attributeTexts()]) {
      expect(value).not.toMatch(/\bsong\b/i)
      expect(value).not.toMatch(/\$|price|free/i)
    }
  })
})

describe('home page hero', () => {
  const links = [...doc.querySelectorAll('.hero a')].map((a) => [text(a), a.getAttribute('href')])

  it('links to the waitlist and to sign in', () => {
    expect(links).toContainEqual([JOIN_WAITLIST, '#waitlist'])
    expect(links).toContainEqual([SIGN_IN, 'https://my.crosstune.app'])
  })
})

describe('home page waitlist', () => {
  const band = doc.getElementById('waitlist')

  it('is a section holding the form', () => {
    expect(band?.tagName).toBe('SECTION')
    const form = band?.querySelector('form[data-waitlist]')
    expect(form).not.toBeNull()
    const input = form?.querySelector('input[type="email"][name="email"]')
    expect(input?.hasAttribute('required')).toBe(true)
    expect(input?.getAttribute('autocomplete')).toBe('email')
    expect(input?.id && doc.querySelector(`label[for="${input.id}"]`)).toBeTruthy()
    const button = form?.querySelector('button[type="submit"]')
    expect(text(button)).toBe(JOIN_WAITLIST)
    const status = form?.querySelector('p[data-waitlist-status]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(text(status)).toBe('')
  })

  it('falls back to a mailto link without JavaScript', () => {
    const noscript = band?.querySelector('noscript')
    expect(noscript?.innerHTML).toContain('href="mailto:support@crosstune.app"')
  })

  it('hides the form without JavaScript', () => {
    const noscript = band?.querySelector('noscript')
    expect(noscript?.innerHTML).toContain('form[data-waitlist]')
    expect(noscript?.innerHTML).toMatch(/display:\s*none/)
  })

  it('ships one module script and one block of structured data', () => {
    expect([...doc.querySelectorAll('script')].map((s) => s.getAttribute('type'))).toEqual([
      'application/ld+json',
      'module',
    ])
  })
})

describe('home page demos', () => {
  const chapter = (id: string) => doc.getElementById(id)!
  const caption = (id: string) => chapter(id).querySelector('[data-caption]')

  it('hides only the decorative fragments from assistive tech', () => {
    const fragments = [...doc.querySelectorAll('[data-fragment]')]
    expect(fragments.map((f) => f.getAttribute('data-fragment'))).toEqual([
      'paper-list',
      'phone-catalog',
      'offline-phone',
    ])
    for (const fragment of fragments) expect(fragment.getAttribute('aria-hidden')).toBe('true')
    for (const c of CHAPTERS) expect(chapter(c.id).closest('[aria-hidden]')).toBeNull()
  })

  it('gives every demo a polite caption with its still-state text', () => {
    const rest = {
      tunes: CATALOG_REST,
      record: RECORD_REST,
      practice: PLAYER_REST,
    }
    for (const [id, line] of Object.entries(rest)) {
      expect(caption(id)?.getAttribute('aria-live')).toBe('polite')
      expect(text(caption(id))).toBe(line)
    }
  })

  it('hides every demo control until the script runs', () => {
    for (const id of ['tunes', 'record', 'practice']) {
      const controls = [...chapter(id).querySelectorAll('[data-controls]')]
      expect(controls.length).toBeGreaterThan(0)
      for (const el of controls) expect(el.hasAttribute('hidden')).toBe(true)
    }
  })

  it('lists every tune and names every catalog control', () => {
    expect(chapter('tunes').querySelectorAll('[data-tune]')).toHaveLength(TUNES.length)
    const names = [...chapter('tunes').querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? text(b),
    )
    expect(names).toEqual([
      ...RAIL.map((k) => `Key of ${k === 'Bb' ? 'B♭' : k}`),
      'All',
      'Known',
      'Learning',
      'Want to learn',
      ...LISTS.map((l) => l.name),
      SHOW_ALL,
    ])
  })

  it(`shows ${MAX_ROWS} tunes and counts the rest without JavaScript`, () => {
    const rows = [...chapter('tunes').querySelectorAll('[data-tune]')]
    expect(rows.filter((li) => !li.hasAttribute('hidden'))).toHaveLength(MAX_ROWS)
    expect(text(chapter('tunes').querySelector('[data-more]'))).toBe(
      moreLabel(TUNES.length - MAX_ROWS),
    )
    expect(chapter('tunes').querySelector('[data-empty]')?.hasAttribute('hidden')).toBe(true)
  })

  it('opens each link at its provider without JavaScript', () => {
    const rows = [...chapter('record').querySelectorAll('a[data-row="link"]')]
    expect(rows.map((a) => [text(a.querySelector('.title')), a.getAttribute('href')])).toEqual(
      LINKS.map((l) => [l.tune, l.href]),
    )
    expect(chapter('record').querySelector('iframe')).toBeNull()
    expect(chapter('record').querySelector(`[aria-label="${RECORD_LABEL}"]`)).not.toBeNull()
  })

  it('plays the clip with named controls', () => {
    const practice = chapter('practice')
    const audio = practice.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('/audio/bibb-county-hoedown.m4a')
    expect(audio?.getAttribute('preload')).toBe('none')
    expect(readDist('/audio/bibb-county-hoedown.m4a').length).toBeGreaterThan(100_000)
    for (const name of [PLAY, PITCH_DOWN, PITCH_UP]) {
      expect(practice.querySelector(`button[aria-label="${name}"]`)).not.toBeNull()
    }
    expect(text(practice.querySelector('label[for="practice-speed"]'))).toBe('Speed')
    const sliders = [...practice.querySelectorAll('[role="slider"]')]
    expect(
      sliders.map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-valuetext')]),
    ).toEqual([
      ['Loop start', '0:08'],
      ['Loop end', '0:14'],
    ])
    expect(text(practice.querySelector('.rest'))).toBe(REST_LINE)
  })
})

describe('home page photo', () => {
  const picture = doc.querySelector('picture')
  const img = picture?.querySelector('img')

  it('describes the campsite and stays visible to assistive tech', () => {
    expect(img?.getAttribute('alt')?.trim()).toBeTruthy()
    expect(img?.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('serves AVIF and WebP sources', () => {
    for (const type of ['image/avif', 'image/webp']) {
      const source = picture?.querySelector(`source[type="${type}"]`)
      expect(source?.getAttribute('srcset')).toBeTruthy()
    }
  })

  it('credits the photographer', () => {
    expect(text(doc.body)).toContain('Photo by Ivan Dimitrov on Unsplash')
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
    expect(meta('meta[property="og:image:alt"]')).toBeTruthy()
    expect(meta('meta[name="twitter:image:alt"]')).toBe(meta('meta[property="og:image:alt"]'))
    expect(meta('meta[property="og:locale"]')).toBe('en_US')
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

  it('describes the site and the app as structured data', () => {
    const block = doc.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(block?.textContent ?? '{}')
    expect(data).toEqual(STRUCTURED_DATA)
    expect(data['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual([
      'WebSite',
      'Organization',
      'WebApplication',
    ])
  })
})

describe('404 page', () => {
  const page = new JSDOM(readDist('/404.html')).window.document

  it('stays out of search results', () => {
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    expect(page.querySelector('link[rel="canonical"]')).toBeNull()
  })
})
