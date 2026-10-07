import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  APP_URL,
  HOME_LINK,
  JOIN_WAITLIST,
  NATE_EMAIL,
  SECTIONS,
  SIGN_IN,
  WAITLIST_ID,
} from '../src/components/actions'
import { hasCapture } from '../src/components/capture/captures'
import { CLOSING_LEDE, CLOSING_TITLE } from '../src/components/closing'
import { FAQ, FAQ_TITLE } from '../src/components/faq'
import { FAMILY, FEATURES, FEATURES_LINE, FEATURES_TITLE } from '../src/components/features'
import { HERO_LEDE, HERO_MICRO, HERO_TITLE } from '../src/components/hero'
import { MAKER_BAND, MAKER_INVITE, MAKER_STORY, MAKER_TITLE } from '../src/components/maker'
import {
  INACTIVE_RULE,
  KEEP_DETAIL,
  KEEP_PROMISE,
  PLAN_FREE,
  PLAN_PREMIUM,
  PRICE_LINE,
  PRICES,
  PRICING_LEDE,
  PRICING_TITLE,
} from '../src/components/pricing'
import { PROBLEM_BODY, PROBLEM_TITLE } from '../src/components/problem'
import { HOME_DESCRIPTION, HOME_TITLE, STRUCTURED_DATA } from '../src/components/seo'
import { HERO_SCENES, SCENES_LABEL } from '../src/scripts/heroScenes'
import { PAUSE } from '../src/scripts/playback'
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
    expect(text(doc.querySelector('h1'))).toBe(HERO_TITLE)
  })

  it('has the hero lede', () => {
    expect(text(doc.querySelector('.hero .lede'))).toBe(HERO_LEDE)
  })

  it('has the maker note', () => {
    const paragraphs = [...doc.querySelectorAll('figure blockquote p')].map(text)
    expect(paragraphs).toEqual([
      `${MAKER_STORY} ${MAKER_BAND.name}.`,
      `${MAKER_INVITE} ${NATE_EMAIL}.`,
    ])
  })

  it('has the closing lede', () => {
    expect(text(doc.querySelector('#waitlist .lede'))).toBe(CLOSING_LEDE)
  })

  it('lets a reader email Nate from the maker note', () => {
    const mail = doc.querySelector(`figure blockquote a[href="mailto:${NATE_EMAIL}"]`)
    expect(text(mail)).toBe(NATE_EMAIL)
  })

  it("links the maker note to Nate's band", () => {
    const band = doc.querySelector('figure blockquote a')
    expect(text(band)).toBe(MAKER_BAND.name)
    expect(band?.getAttribute('href')).toBe(MAKER_BAND.url)
  })

  it('reads attribute text from the page', () => {
    expect(attributeTexts()).toEqual(expect.arrayContaining([HOME_TITLE, HOME_DESCRIPTION]))
  })

  it('never says song', () => {
    for (const value of [...textNodes(doc.body), ...attributeTexts()]) {
      expect(value).not.toMatch(/\bsong\b/i)
    }
  })

  it('nav links to features, pricing, and questions', () => {
    const nav = doc.querySelector('nav[aria-label="Main"]')
    const links = [...(nav?.querySelectorAll('a') ?? [])].map((a) => [
      a.getAttribute('aria-label') ?? text(a),
      a.getAttribute('href'),
    ])
    expect(links).toEqual([
      [HOME_LINK, '/'],
      ...SECTIONS.map(([label, id]) => [label, `#${id}`]),
      [SIGN_IN, APP_URL],
      [JOIN_WAITLIST, `#${WAITLIST_ID}`],
    ])
  })
})

describe('home page hero', () => {
  const links = [...doc.querySelectorAll('.hero a')].map((a) => [text(a), a.getAttribute('href')])

  it('links to the waitlist and to sign in', () => {
    expect(links).toContainEqual([JOIN_WAITLIST, '#waitlist'])
    expect(links).toContainEqual([SIGN_IN, 'https://my.crosstune.app'])
  })

  it('answers what it costs under the buttons', () => {
    expect(text(doc.querySelector('.hero .micro'))).toBe(HERO_MICRO)
  })

  const hero = doc.querySelector('.hero')!
  const runway = hero.querySelector<HTMLElement>('[data-runway]')
  const items = [...hero.querySelectorAll('[data-stack-item]')]

  it('pins the phone and its tabs in a runway of three steps, one snap point each', () => {
    expect(runway?.classList.contains('runway')).toBe(true)
    expect(runway?.getAttribute('style')).toMatch(/--n:\s*3\b/)
    const snaps = [...(runway?.querySelectorAll(':scope > .snap') ?? [])]
    expect(snaps.map((s) => s.getAttribute('style'))).toEqual(
      HERO_SCENES.map((_, i) => `--i: ${i}`),
    )
    const pinned = runway?.querySelector('.pinned')
    expect(pinned?.querySelector('[data-stack]')).not.toBeNull()
    expect(pinned?.querySelector('[data-scene-picker]')).not.toBeNull()
    expect(pinned?.querySelector('[data-scene-toggle]')).not.toBeNull()
  })

  it('keeps the headline and buttons out of the runway, so they scroll normally', () => {
    expect(runway?.contains(hero.querySelector('h1'))).toBe(false)
    expect(runway?.contains(hero.querySelector('.actions'))).toBe(false)
  })

  it('stacks the three scenes as whole phones, only the first shown and described', () => {
    expect(items.map((item) => item.querySelectorAll('.phone').length)).toEqual([1, 1, 1])
    expect(items.map((item) => item.querySelector('video')?.getAttribute('data-capture'))).toEqual(
      HERO_SCENES.map((s) => s.name),
    )
    expect(items.map((item) => item.classList.contains('is-active'))).toEqual([true, false, false])
    expect(items.map((item) => item.getAttribute('aria-hidden'))).toEqual([null, 'true', 'true'])
    for (const [i, item] of items.entries()) {
      expect(item.querySelector('video')?.getAttribute('aria-label')).toBe(HERO_SCENES[i].alt)
    }
  })

  it('has a scene switcher of three pressed-state buttons, hidden without JavaScript', () => {
    const picker = hero.querySelector('[data-scene-picker]')
    expect(picker?.getAttribute('role')).toBe('group')
    expect(picker?.getAttribute('aria-label')).toBe(SCENES_LABEL)
    expect(picker?.hasAttribute('hidden')).toBe(true)
    const buttons = [...(picker?.querySelectorAll('button') ?? [])]
    expect(buttons.map(text)).toEqual(HERO_SCENES.map((scene) => scene.label))
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button')
  })

  it('has a pause button, hidden without JavaScript', () => {
    const toggle = hero.querySelector('button[data-scene-toggle]')
    expect(text(toggle)).toBe(PAUSE)
    expect(toggle?.getAttribute('type')).toBe('button')
    expect(toggle?.hasAttribute('hidden')).toBe(true)
  })

  it('loads the first poster at high priority and the hidden ones eagerly at low priority', () => {
    const posters = items.map((item) => item.querySelector('img'))
    expect(posters[0]?.getAttribute('fetchpriority')).toBe('high')
    expect(posters[0]?.getAttribute('loading')).toBe('eager')
    for (const poster of posters.slice(1)) {
      // A lazy poster could still be loading as its phone arrives, so a switch would flash empty.
      expect(poster?.getAttribute('loading')).toBe('eager')
      expect(poster?.getAttribute('fetchpriority')).toBe('low')
    }
    for (const poster of posters) {
      expect(poster?.getAttribute('src')).toMatch(/\.webp$/)
      // The video beside it carries the description.
      expect(poster?.getAttribute('alt')).toBe('')
    }
  })
})

describe('home page features', () => {
  const features = doc.getElementById('features')!

  it('is a section introduced by an h2 with its line', () => {
    expect(features?.tagName).toBe('SECTION')
    const title = features.querySelector('h2')
    expect(text(title)).toBe(FEATURES_TITLE)
    expect(features.getAttribute('aria-labelledby')).toBe(title?.id)
    expect(text(features.querySelector('.intro p'))).toBe(FEATURES_LINE)
  })

  it('has the eight section headings, in order, as h3s', () => {
    expect([...features.querySelectorAll('h3')].map(text)).toEqual(FEATURES.map((f) => f.heading))
  })

  it("shows each section's paragraphs and bullets", () => {
    const sections = [...features.querySelectorAll('article.feature')]
    expect(sections).toHaveLength(FEATURES.length)
    sections.forEach((section, i) => {
      const copy = section.querySelector('.copy')!
      expect([...copy.querySelectorAll(':scope > p:not(.plan)')].map(text)).toEqual(
        FEATURES[i].body,
      )
      expect([...copy.querySelectorAll('li > [data-bullet]')].map(text)).toEqual(
        FEATURES[i].bullets?.map((bullet) => bullet.text) ?? [],
      )
    })
  })

  it('ends sections with their plan lines', () => {
    expect([...features.querySelectorAll('.plan')].map(text)).toEqual(
      FEATURES.flatMap((f) => (f.plan ? [f.plan] : [])),
    )
  })

  const bulletedFeatures = FEATURES.filter((f) => f.bullets)
  const bulleted = [...features.querySelectorAll<HTMLElement>('[data-bulleted]')]
  const steps = [...features.querySelectorAll<HTMLElement>('[data-feature-step]')]
  const groups = [...features.querySelectorAll<HTMLElement>('[data-stage-group]')]

  it('pins each bulleted section in a runway with one step and one snap point per bullet', () => {
    expect(bulleted.map((section) => section.dataset.feature)).toEqual([
      'tunes',
      'tune',
      'practice',
    ])
    for (const [i, section] of bulleted.entries()) {
      const count = bulletedFeatures[i].bullets!.length
      const runway = section.querySelector<HTMLElement>('[data-runway]')
      expect(runway?.classList.contains('runway')).toBe(true)
      expect(runway?.getAttribute('style')).toMatch(new RegExp(`--n:\\s*${count}\\b`))
      const snaps = [...(runway?.querySelectorAll(':scope > .snap') ?? [])]
      expect(snaps.map((s) => s.getAttribute('style'))).toEqual(
        Array.from({ length: count }, (_, s) => `--i: ${s}`),
      )
      const pinned = runway?.querySelector(':scope > .pinned')
      for (const part of [
        'h3',
        '[data-bullet]',
        '[data-stack]',
        '[data-marks]',
        '[data-connector]',
      ]) {
        expect(pinned?.querySelector(part), part).not.toBeNull()
      }
    }
  })

  it('stacks a whole phone per bullet beside the list, in copy order, only the first shown', () => {
    expect(bulleted).toHaveLength(bulletedFeatures.length)
    for (const [i, section] of bulleted.entries()) {
      const bullets = bulletedFeatures[i].bullets!
      expect([...section.querySelectorAll('[data-bullet]')].map(text)).toEqual(
        bullets.map((b) => b.text),
      )
      const phones = [...section.querySelectorAll('[data-stack] [data-stack-item]')]
      expect(phones.map((p) => p.querySelector('video')?.getAttribute('data-capture'))).toEqual(
        bullets.map((b) => b.capture),
      )
      expect(phones.map((p) => p.querySelector('video')?.getAttribute('aria-label'))).toEqual(
        bullets.map((b) => b.alt),
      )
      expect(phones.map((p) => p.classList.contains('is-active'))).toEqual(
        bullets.map((_, b) => b === 0),
      )
      expect(phones.map((p) => p.getAttribute('aria-hidden'))).toEqual(
        bullets.map((_, b) => (b === 0 ? null : 'true')),
      )
    }
  })

  it('puts a mark per bullet under the phone, named for its bullet and hidden without JavaScript', () => {
    expect(bulleted).toHaveLength(bulletedFeatures.length)
    for (const [i, section] of bulleted.entries()) {
      const bullets = bulletedFeatures[i].bullets!
      const marks = section.querySelector('[data-marks]')
      expect(marks?.hasAttribute('hidden')).toBe(true)
      const buttons = [...(marks?.querySelectorAll('button[data-mark]') ?? [])]
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(bullets.map((b) => b.text))
      for (const button of buttons) expect(button.getAttribute('type')).toBe('button')
      expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual(
        bullets.map((_, b) => (b === 0 ? 'true' : null)),
      )
    }
  })

  it('leaves the connector an empty drawing, hidden from assistive tech', () => {
    expect(bulleted).toHaveLength(bulletedFeatures.length)
    for (const section of bulleted) {
      const svg = section.querySelector('svg[data-connector]')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      expect(svg?.querySelector('path')).toBeNull()
    }
  })

  it('stacks each run of sections without bullets beside a stage of their captures', () => {
    const unbulleted = FEATURES.slice(0, -1).filter((f) => !f.bullets)
    expect(steps.map((step) => step.dataset.feature)).toEqual(unbulleted.map((f) => f.id))
    expect(
      groups.map((g) =>
        [...g.querySelectorAll<HTMLElement>('[data-feature-step]')].map((s) => s.dataset.feature),
      ),
    ).toEqual([['record'], ['lists', 'services', 'folk']])
    for (const group of groups) {
      const stage = group.querySelector('[data-stage]')!
      expect(stage.querySelectorAll('.phone')).toHaveLength(1)
      const items = [...stage.querySelectorAll<HTMLElement>('[data-stage-item]')]
      const ids = [...group.querySelectorAll<HTMLElement>('[data-feature-step]')].map(
        (s) => s.dataset.feature,
      )
      expect(items.map((item) => item.dataset.stageItem)).toEqual(ids)
      const described = (item: Element) =>
        item.querySelector('video')?.getAttribute('aria-label') ??
        item.querySelector('img.capture')?.getAttribute('alt')
      expect(items.map(described)).toEqual(ids.map((id) => FEATURES.find((f) => f.id === id)!.alt))
      for (const [i, item] of items.entries()) {
        const video = item.querySelector('video')
        const feature = FEATURES.find((f) => f.id === ids[i])!
        if (video) expect(video.getAttribute('data-capture')).toBe(feature.capture)
      }
      // Only the active stage capture is exposed to assistive tech.
      expect(items.map((item) => item.hasAttribute('data-active'))).toEqual(
        items.map((_, i) => i === 0),
      )
      expect(items.map((item) => item.getAttribute('aria-hidden'))).toEqual(
        items.map((_, i) => (i === 0 ? null : 'true')),
      )
      expect(stage.querySelector('[data-stage-item] img')?.getAttribute('src')).toMatch(/\.webp$/)
    }
  })

  it("makes each bulleted section's bullets a carousel of cards, text before a whole phone", () => {
    expect(bulleted).toHaveLength(bulletedFeatures.length)
    for (const [i, section] of bulleted.entries()) {
      const feature = bulletedFeatures[i]
      const track = section.querySelector('[data-track]')
      expect(track?.tagName).toBe('UL')
      const cards = [...(track?.querySelectorAll(':scope > li[data-card]') ?? [])]
      expect(cards).toHaveLength(feature.bullets!.length)
      for (const [b, card] of cards.entries()) {
        const point = card.querySelector(':scope > [data-bullet]')!
        // Plain text without JavaScript; only a pinned desktop section makes it a button.
        expect(point.tagName).toBe('SPAN')
        expect(text(point)).toBe(feature.bullets![b].text)
        const panel = card.querySelector(':scope > [data-panel]')!
        expect(point.compareDocumentPosition(panel) & 4).toBe(4)
        // The clip is already zoomed onto its action, so the card shows the whole screen.
        expect(panel.querySelectorAll('.phone')).toHaveLength(1)
        expect(panel.querySelector('.crop')).toBeNull()
        const video = panel.querySelector('video')
        expect(video?.getAttribute('data-capture')).toBe(feature.bullets![b].capture)
        expect(video?.hasAttribute('src')).toBe(false)
        expect(panel.querySelector('img.poster')).not.toBeNull()
      }
    }
  })

  it('puts a mark per card under each carousel, named for its bullet and hidden without JavaScript', () => {
    expect(bulleted).toHaveLength(bulletedFeatures.length)
    for (const [i, section] of bulleted.entries()) {
      const bullets = bulletedFeatures[i].bullets!
      const controls = section.querySelector('[data-carousel-controls]')
      expect(controls?.hasAttribute('hidden')).toBe(true)
      expect(section.querySelector('[data-track]')!.compareDocumentPosition(controls!) & 4).toBe(4)
      const marks = [...(controls?.querySelectorAll('button[data-card-mark]') ?? [])]
      expect(marks).toHaveLength(section.querySelectorAll('[data-card]').length)
      expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(bullets.map((b) => b.text))
      for (const mark of marks) expect(mark.getAttribute('type')).toBe('button')
      expect(marks.map((m) => m.getAttribute('aria-current'))).toEqual(
        bullets.map((_, b) => (b === 0 ? 'true' : null)),
      )
    }
  })

  it('has a live region for the clip a bullet or mark moves to', () => {
    const live = features.querySelector('[data-features-live]')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    expect(text(live)).toBe('')
  })

  it('has a pause button on each stage, beside each pinned phone, under each carousel, and under each panel, hidden without JavaScript', () => {
    for (const group of groups) {
      expect(group.querySelectorAll('[data-stage] button[data-clip-toggle]')).toHaveLength(1)
    }
    for (const section of bulleted) {
      expect(section.querySelectorAll('[data-side] button[data-clip-toggle]')).toHaveLength(1)
      expect(
        section.querySelectorAll('[data-carousel-controls] button[data-clip-toggle]'),
      ).toHaveLength(1)
      expect(section.querySelectorAll('[data-card] button[data-clip-toggle]')).toHaveLength(0)
    }
    const panels = [...features.querySelectorAll('[data-feature-step] [data-panel]')]
    expect(panels).toHaveLength(steps.length)
    for (const panel of panels) {
      expect(
        panel.parentElement!.querySelectorAll(':scope > button[data-clip-toggle]'),
      ).toHaveLength(1)
    }
    for (const toggle of features.querySelectorAll('button[data-clip-toggle]')) {
      expect(text(toggle)).toBe(PAUSE)
      expect(toggle.getAttribute('type')).toBe('button')
      expect(toggle.hasAttribute('hidden')).toBe(true)
    }
  })

  it('gives every section without bullets and every bullet a whole, uncropped phone', () => {
    for (const step of steps) {
      const panels = [...step.querySelectorAll('[data-panel]')]
      expect(panels).toHaveLength(1)
      expect(panels[0].querySelectorAll('.phone')).toHaveLength(1)
    }
    for (const section of bulleted) {
      for (const panel of section.querySelectorAll('[data-panel]')) {
        expect(panel.querySelectorAll('.phone')).toHaveLength(1)
      }
    }
    expect(features.querySelector('.crop')).toBeNull()
  })

  it('shows the family shot with every captured device, skipping one not captured yet', () => {
    const shot = features.querySelector('[data-family]')
    const shown = [...(shot?.querySelectorAll('[data-device]') ?? [])].map((d) =>
      d.getAttribute('data-device'),
    )
    const captured = FAMILY.filter((d) => hasCapture(d.name))
    expect(shown).toEqual(captured.map((d) => d.name))
    expect(shown).toEqual(expect.arrayContaining(['family-web', 'family-ipad', 'family-iphone']))
    for (const device of captured) {
      const el = shot?.querySelector(`[data-device="${device.name}"]`)
      expect(el?.querySelector(`[alt="${device.alt}"], [aria-label="${device.alt}"]`)).toBeTruthy()
    }
  })

  it('describes each family device once, on its own image, and no device it leaves out', () => {
    const shot = features.querySelector('[data-family]')
    expect(shot?.hasAttribute('aria-label')).toBe(false)
    expect(shot?.hasAttribute('role')).toBe(false)
    const descriptions = [...(shot?.querySelectorAll('[alt], [aria-label]') ?? [])].map(
      (el) => el.getAttribute('alt') || el.getAttribute('aria-label'),
    )
    expect(descriptions).toEqual(FAMILY.filter((d) => hasCapture(d.name)).map((d) => d.alt))
  })

  it('leaves every feature clip without a source until the script picks a layout', () => {
    const videos = [...features.querySelectorAll('video')]
    expect(videos.length).toBeGreaterThan(0)
    for (const video of videos) {
      expect(video.hasAttribute('src')).toBe(false)
      expect(video.querySelector('source')).toBeNull()
      expect(video.hasAttribute('poster')).toBe(false)
      expect(video.getAttribute('data-src')).toBeTruthy()
    }
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

  it('ships the layout and page module scripts and one block of structured data', () => {
    expect([...doc.querySelectorAll('script')].map((s) => s.getAttribute('type'))).toEqual([
      'application/ld+json',
      'module',
      'module',
    ])
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

  it('colors the browser chrome to match the page background', () => {
    const tokens = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8')
    const mist = /--mist:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1]
    expect(meta('meta[name="theme-color"]')).toBe(mist)
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
      'FAQPage',
    ])
  })

  it('prices the plans as the pricing section does', () => {
    const app = STRUCTURED_DATA['@graph'].find((node) => node['@type'] === 'WebApplication')
    const shown = doc.querySelector('#pricing')?.textContent ?? ''
    const prices = (app?.offers ?? []).map((offer) => offer.price)
    expect(prices.map((price) => `$${price}`)).toEqual(['$0', PRICES.monthly, PRICES.yearly])
    for (const price of prices.slice(1)) expect(shown).toContain(`$${price}`)
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
  const page = new JSDOM(readDist('/404.html')).window.document

  it('stays out of search results', () => {
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    expect(page.querySelector('link[rel="canonical"]')).toBeNull()
  })
})

describe('home page outline and sections', () => {
  it('has exactly the copy h2s in order', () => {
    expect([...doc.querySelectorAll('h2')].map(text)).toEqual([
      PROBLEM_TITLE,
      FEATURES_TITLE,
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

  it('shows both plans with their prices and bullets', () => {
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
    expect(text(pricing.querySelector('.plan.premium .price'))).toBe(PRICE_LINE)
  })

  it('promises that a lapsed account keeps what it made, and states the inactivity rule', () => {
    expect(text(pricing.querySelector('.keep strong'))).toBe(KEEP_PROMISE)
    expect(text(pricing.querySelector('.keep'))).toBe(`${KEEP_PROMISE} ${KEEP_DETAIL}`)
    expect(text(pricing.querySelector('.inactive'))).toBe(INACTIVE_RULE)
  })

  it('never mentions the storage add-on', () => {
    expect(text(pricing)).not.toMatch(/add-on/i)
  })

  const faq = doc.getElementById('questions')!

  it('lists the questions as h3s, each with its answer', () => {
    expect(faq.tagName).toBe('SECTION')
    expect([...faq.querySelectorAll('h3')].map(text)).toEqual(FAQ.map((item) => item.question))
    expect([...faq.querySelectorAll('.answer')].map(text)).toEqual(FAQ.map((item) => item.answer))
  })

  it("keeps the questions' open and close marker from being read out", () => {
    const astro = resolve(import.meta.dirname, '../dist/_astro')
    const css = readdirSync(astro)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(resolve(astro, file), 'utf8'))
      .join('\n')
    expect(css).toMatch(/content:\s*"\+"\s*\/\s*""/)
  })

  it('orders the sections as the nav does', () => {
    const order = [
      doc.getElementById('features'),
      pricing,
      doc.getElementById('maker-title')?.closest('section'),
      faq,
      doc.getElementById('waitlist'),
    ]
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i]!.compareDocumentPosition(order[i + 1]!) & 4).toBeTruthy()
    }
  })
})
