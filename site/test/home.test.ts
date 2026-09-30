import { describe, expect, it } from 'vitest'
import { JOIN_WAITLIST, SIGN_IN } from '../src/components/actions'
import { readPage } from './dist'

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

const sectionText = (id: string) =>
  text(doc.querySelector(`section[aria-labelledby="${id}"] .words p`))

describe('home page copy', () => {
  it('has the headline', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    expect(text(doc.querySelector('h1'))).toBe(
      'The tune list in your case, rebuilt for your phone.',
    )
  })

  it('has the sections in order, then the closing band', () => {
    expect([...doc.querySelectorAll('h2')].map(text)).toEqual([
      'Record it or find it, and learn it later.',
      'Sorted the way you play.',
      'Known, learning, want to learn.',
      'Your own lists.',
      'No signal needed.',
      'Crosstune opens to players a few at a time.',
    ])
  })

  it('has the hero lede', () => {
    expect(text(doc.querySelector('.hero .lede'))).toBe(
      "Crosstune keeps the tunes you know and the tunes you're learning, sorted the way you play them, with a recording one tap away.",
    )
  })

  it.each([
    [
      'record',
      "Hear a tune you want? Record it on the spot, or paste the link to a version on YouTube, Spotify, Bandcamp, or the Internet Archive. Either way it's filed under the tune, ready when you sit down to learn it.",
    ],
    [
      'sorted',
      'Key, mode, tuning, type, and part structure live on every tune. Filter by key and every tune in A is there, cross-tuned ones included.',
    ],
    ['status', 'One catalog replaces the two paper lists. A tune moves along as you learn it.'],
    [
      'lists',
      'A setlist for Saturday, the sets you play with your band, the tunes to learn by spring. A tune can be in as many lists as you like, in the order you choose.',
    ],
    [
      'offline',
      "The whole catalog lives on your phone, along with the recordings you've made. At a festival campsite with no reception, you can still find the tune and hear how it goes. Your changes sync when you're back in range.",
    ],
  ])('has the %s section paragraph', (id, body) => {
    expect(sectionText(id)).toBe(body)
  })

  it('has the maker note', () => {
    expect(text(doc.querySelector('figure blockquote'))).toBe(
      'I play old-time fiddle in New York City. For years my tunes lived on a folded list in my case, and the recordings I learned them from were scattered across voice memos, YouTube, and Spotify. I built Crosstune so any tune I know, or want to learn, is two taps from hearing it.',
    )
  })

  it('has the closing lede', () => {
    expect(text(doc.querySelector('#waitlist .lede'))).toBe(
      "Join the waitlist and you'll get an email when your account is ready.",
    )
  })

  it('names the platforms', () => {
    expect(text(doc.body)).toContain(
      'Coming to iPhone, iPad, and Mac. The web version works today in any browser.',
    )
  })

  it('says violin, not fiddle, outside the maker note', () => {
    const matches = text(doc.body).match(/fiddle/gi) ?? []
    expect(matches).toHaveLength(1)
    for (const value of attributeTexts()) expect(value).not.toMatch(/fiddle/i)
    const quote = doc.querySelector('figure blockquote')
    expect(text(quote)).toContain('old-time fiddle')
    expect(text(doc.querySelector('figure cite'))).toBe('Nate')
  })

  it('reads attribute text from the page', () => {
    expect(attributeTexts()).toEqual(
      expect.arrayContaining([
        'Crosstune',
        expect.stringMatching(/campfire/),
        expect.stringMatching(/^Crosstune keeps the tunes/),
      ]),
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

  it('ships exactly one module script', () => {
    const scripts = doc.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].getAttribute('type')).toBe('module')
  })
})

describe('home page fragments', () => {
  it('hides every drawn fragment from assistive tech', () => {
    const fragments = [...doc.querySelectorAll('[data-fragment]')]
    expect(fragments.map((f) => f.getAttribute('data-fragment'))).toEqual([
      'paper-list',
      'phone-catalog',
      'recordings',
      'keys-and-facets',
      'status-counts',
      'lists',
      'offline-phone',
    ])
    for (const fragment of fragments) expect(fragment.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the recordings', () => {
    const recordings = text(doc.querySelector('[data-fragment="recordings"]'))
    for (const value of ['Porch, Sunday', 'Tommy Jarrell, 1970s', 'YouTube', 'Spotify']) {
      expect(recordings).toContain(value)
    }
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
