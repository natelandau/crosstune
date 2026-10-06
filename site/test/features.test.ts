// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { hasCapture } from '../src/components/capture/captures'
import { FAMILY, FEATURES } from '../src/components/features'
import { activeIndex, mountFeatures } from '../src/scripts/features'
import { PAUSE, PLAY, type MediaQuery, type Observe } from '../src/scripts/playback'

describe('activeIndex', () => {
  it('picks the last section whose top is above the middle', () => {
    expect(activeIndex([0, 800, 1600], 900)).toBe(1)
  })

  it('is the first section before any reaches the middle', () => {
    expect(activeIndex([100, 800], 50)).toBe(0)
  })

  it('is the last section once scrolled past it', () => {
    expect(activeIndex([-2400, -1600, -800], 450)).toBe(2)
  })
})

describe('FEATURES', () => {
  it('has eight sections with unique ids and nav labels', () => {
    expect(FEATURES).toHaveLength(8)
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(8)
    expect(new Set(FEATURES.map((f) => f.nav)).size).toBe(8)
  })

  it('names a manifest capture with a description for every section but the last', () => {
    for (const feature of FEATURES.slice(0, -1)) {
      const shown = feature.bullets ?? [{ capture: feature.capture, alt: feature.alt }]
      for (const { capture, alt } of shown) {
        expect(hasCapture(capture ?? ''), capture).toBe(true)
        expect(alt, capture).toBeTruthy()
      }
    }
    expect(FEATURES.at(-1)?.capture).toBe('family')
    // The family shot's devices carry their own descriptions.
    expect(FEATURES.at(-1)?.alt).toBeUndefined()
  })

  it('gives each bullet its own capture, and bulleted sections no capture of their own', () => {
    const bulleted = FEATURES.filter((feature) => feature.bullets)
    expect(bulleted.map((feature) => feature.id)).toEqual(['tunes', 'tune', 'practice'])
    const captures = bulleted.flatMap((feature) => feature.bullets!.map((b) => b.capture))
    expect(new Set(captures).size).toBe(captures.length)
    for (const feature of bulleted) expect(feature.capture).toBeUndefined()
  })

  it('describes all five devices in the family shot', () => {
    expect(FAMILY.map((d) => d.name)).toEqual([
      'family-mac',
      'family-web',
      'family-ipad',
      'family-android',
      'family-iphone',
    ])
    for (const device of FAMILY) expect(device.alt).toBeTruthy()
  })
})

// A stand-in for IntersectionObserver: tests flip what is on screen by hand.
function fakeObserver() {
  const watchers = new Map<Element, (visible: boolean) => void>()
  const observe: Observe = (el, onChange) => {
    watchers.set(el, onChange)
    return () => watchers.delete(el)
  }
  const show = (el: Element, visible = true) => watchers.get(el)?.(visible)
  return { observe, show, watchers }
}

// A stand-in for the `(min-width: 900px)` MediaQueryList.
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const media: MediaQuery = {
    matches,
    addEventListener: (_type: 'change', fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: 'change', fn: () => void) => listeners.delete(fn),
  }
  const flip = (next: boolean) => {
    media.matches = next
    for (const fn of listeners) fn()
  }
  return { media, flip, listeners }
}

const VIEWPORT = 900
const STEP = 630
/** A pinned section's height: its content, shorter than the viewport. */
const PINNED = 700

// Each entry is one section: its id and how many bullets it has (0 for none).
type Layout = Array<[id: string, bullets: number]>
const PLAIN: Layout = [
  ['s0', 0],
  ['s1', 0],
  ['s2', 0],
]
const MIXED: Layout = [
  ['tunes', 3],
  ['record', 0],
  ['practice', 3],
  ['lists', 0],
  ['services', 0],
]

const clip = (id: string, i: number) => `${id}-${i}`

// Mirrors FeatureScroller's markup without JavaScript. A bulleted section is a runway holding a
// carousel track of cards (a plain-text bullet, then its panel), hidden card marks and a pause
// toggle under it, a phone stack with hidden marks and a pause toggle, and the connector. Runs of
// sections without bullets share a stage group: one step with a panel per section beside a stage
// holding one item per section.
function render(layout: Layout = PLAIN) {
  const groups: Layout[] = []
  for (const entry of layout) {
    const last = groups.at(-1)
    if (entry[1] === 0 && last && last[0][1] === 0) last.push(entry)
    else groups.push([entry])
  }
  const markup = groups
    .map((group) => {
      const [[id, count]] = group
      if (count > 0) {
        const range = Array.from({ length: count }, (_, b) => b)
        return `
      <article data-bulleted data-feature="${id}">
        <div class="runway" style="--n: ${count}" data-runway>
          <div class="pinned">
            <svg data-connector aria-hidden="true"></svg>
            <ul data-track>${range
              .map(
                (b) => `
              <li data-card>
                <span class="point" data-bullet="${b}" data-astro-cid-test>Bullet ${id} ${b}</span>
                <div data-panel><video data-src="/panel-${clip(id, b)}.mp4" aria-label="Panel ${clip(id, b)}" preload="none" muted loop></video></div>
              </li>`,
              )
              .join('')}</ul>
            <div data-carousel-controls hidden>
              <div>${range
                .map(
                  (b) =>
                    `<button type="button" data-card-mark aria-label="Bullet ${id} ${b}"></button>`,
                )
                .join('')}</div>
              <button type="button" data-clip-toggle hidden>${PAUSE}</button>
            </div>
            <div data-side>
              <div data-stack>${range
                .map(
                  (b) =>
                    `<div class="stack-item${b === 0 ? ' is-active' : ''}" ${b === 0 ? '' : 'aria-hidden="true"'} data-stack-item><video data-src="/stack-${clip(id, b)}.mp4" aria-label="Clip ${clip(id, b)}" preload="none" muted loop></video></div>`,
                )
                .join('')}</div>
              <div data-marks hidden>${range
                .map(
                  (b) => `<button type="button" data-mark aria-label="Bullet ${id} ${b}"></button>`,
                )
                .join('')}</div>
              <button type="button" data-clip-toggle hidden>${PAUSE}</button>
            </div>
          </div>
          ${range.map((b) => `<div class="snap" style="--i: ${b}"></div>`).join('')}
        </div>
      </article>`
      }
      const steps = group
        .map(
          ([sid]) => `
        <article data-feature-step data-feature="${sid}">
          <div data-panel><video data-src="/panel-${clip(sid, 0)}.mp4" preload="none" muted loop></video></div>
          <button type="button" data-clip-toggle hidden>${PAUSE}</button>
        </article>`,
        )
        .join('')
      const items = group
        .map(
          ([sid], i) => `
        <div data-stage-item="${sid}" ${i === 0 ? 'data-active' : 'aria-hidden="true"'}>
          ${i === 0 ? `<img class="poster" src="/poster-${sid}.webp" alt="">` : `<img class="poster" data-src="/poster-${sid}.webp" alt="">`}
          ${i === 2 ? `<picture><source data-srcset="/still-${sid}.avif 300w" type="image/avif"><img class="still" data-src="/still-${sid}.webp" data-srcset="/still-${sid}.webp 300w" alt=""></picture>` : ''}
          <video data-src="/stage-${sid}.mp4" aria-label="Clip ${sid}" preload="none" muted loop></video>
        </div>`,
        )
        .join('')
      return `
      <div data-stage-group>${steps}
        <div data-stage>${items}<button type="button" data-clip-toggle hidden>${PAUSE}</button></div>
      </div>`
    })
    .join('')
  document.body.innerHTML = `<section data-features>${markup}<p data-features-live aria-live="polite"></p></section>`
  const root = document.querySelector<HTMLElement>('[data-features]')!
  const q = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)]
  const section = (id: string) => root.querySelector<HTMLElement>(`[data-feature="${id}"]`)!
  return {
    root,
    steps: q<HTMLElement>('[data-feature-step]'),
    stage: q<HTMLVideoElement>('[data-stage-item] video'),
    items: q<HTMLElement>('[data-stage-item]'),
    panels: q<HTMLVideoElement>('[data-panel] video'),
    stacks: q<HTMLVideoElement>('[data-stack-item] video'),
    toggles: q<HTMLButtonElement>('[data-clip-toggle]'),
    stageToggles: q<HTMLButtonElement>('[data-stage] [data-clip-toggle]'),
    panelToggles: q<HTMLButtonElement>('[data-panel] + [data-clip-toggle]'),
    live: root.querySelector<HTMLElement>('[data-features-live]')!,
    section,
    bullets: (id: string) => [...section(id).querySelectorAll<HTMLElement>('[data-bullet]')],
    phones: (id: string) => [...section(id).querySelectorAll<HTMLElement>('[data-stack-item]')],
    marks: (id: string) => [...section(id).querySelectorAll<HTMLButtonElement>('[data-mark]')],
    cardMarks: (id: string) => [
      ...section(id).querySelectorAll<HTMLButtonElement>('[data-card-mark]'),
    ],
    track: (id: string) => section(id).querySelector<HTMLElement>('[data-track]')!,
    controls: (id: string) => section(id).querySelector<HTMLElement>('[data-carousel-controls]')!,
    runway: (id: string) => section(id).querySelector<HTMLElement>('[data-runway]')!,
    connector: (id: string) => section(id).querySelector<SVGSVGElement>('[data-connector]')!,
    stackFor: (id: string, i: number) =>
      root.querySelector<HTMLVideoElement>(`video[data-src="/stack-${clip(id, i)}.mp4"]`)!,
    panelFor: (id: string, i: number) =>
      root.querySelector<HTMLVideoElement>(`video[data-src="/panel-${clip(id, i)}.mp4"]`)!,
  }
}

// Places each step's top at `tops[i]` in viewport coordinates.
function placeSteps(steps: HTMLElement[], tops: number[]) {
  steps.forEach((step, i) => {
    step.getBoundingClientRect = () => ({ top: tops[i] }) as DOMRect
  })
}

// Lays out a bulleted section for the runway and the connector: the runway starts at `top` in
// page coordinates and is its pinned block's height plus a step per extra bullet, each bullet's
// text is one line ending further right the later it is, and the phone sits to the right.
function layOut(view: ReturnType<typeof render>, id: string, top: number) {
  const runway = view.runway(id)
  const count = view.bullets(id).length
  const height = PINNED + (count - 1) * STEP
  runway.querySelector<HTMLElement>(':scope > .pinned')!.getBoundingClientRect = () =>
    ({ height: PINNED }) as DOMRect
  runway.getBoundingClientRect = () => ({ top: top - window.scrollY, height }) as DOMRect
  placeSection(view, id, top, height)
  view.connector(id).getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect
  const stack = view.section(id).querySelector<HTMLElement>('[data-stack]')!
  stack.getBoundingClientRect = () =>
    ({ left: 760, top: 120, width: 300, height: 650, right: 1060, bottom: 770 }) as DOMRect
}

// Places a section at `top` in page coordinates, `height` tall.
function placeSection(view: ReturnType<typeof render>, id: string, top: number, height: number) {
  view.section(id).getBoundingClientRect = () =>
    ({ top: top - window.scrollY, bottom: top - window.scrollY + height, height }) as DOMRect
}

/** The text's line boxes for a Range over one bullet: bullet i is one line, 40px apart. */
function lineBoxes(this: Range): DOMRect[] {
  const el = this.startContainer as Element
  const i = Number(el.getAttribute?.('data-bullet') ?? 0)
  const top = 420 + i * 40
  return [
    { left: 40, right: 260 + i * 50, top, bottom: top + 24, height: 24, width: 220 } as DOMRect,
  ]
}

const scrollTo = (y: number) => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  window.dispatchEvent(new Event('scroll'))
}

/** How far apart a carousel's cards start, as offsets inside its track. */
const CARD = 300

// Lays out a carousel's cards one `CARD` apart after the track's leading padding.
function layOutCards(view: ReturnType<typeof render>, id: string) {
  view
    .track(id)
    .querySelectorAll<HTMLElement>('[data-card]')
    .forEach((card, i) => {
      Object.defineProperty(card, 'offsetLeft', { configurable: true, value: 16 + i * CARD })
    })
}

// A scroll that lands at once: the browser reports it, then reports that it ended.
const swipe = (track: HTMLElement, left: number) => {
  track.scrollLeft = left
  track.dispatchEvent(new Event('scroll'))
  track.dispatchEvent(new Event('scrollend'))
}

let play: MockInstance<HTMLMediaElement['play']>
let pause: MockInstance<HTMLMediaElement['pause']>
let windowScroll: MockInstance<typeof window.scrollTo>
const disposers: Array<() => void> = []
const track = (dispose: () => void) => {
  disposers.push(dispose)
  return dispose
}
const saved = (['innerHeight', 'scrollY'] as const).map(
  (key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
)

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // Runways coalesce scroll work into a frame; here every frame runs at once.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: lineBoxes,
  })
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(window, key, descriptor)
  }
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects
})

const playing = (video: HTMLVideoElement) => play.mock.contexts.includes(video)
const active = (items: HTMLElement[]) => items.findIndex((item) => item.hasAttribute('data-active'))
const exposed = (items: HTMLElement[]) =>
  items.flatMap((item, i) => (item.getAttribute('aria-hidden') === 'true' ? [] : [i]))
const frameNow = (cb: () => void) => cb()
const settleNow = (cb: () => void) => {
  cb()
  return () => {}
}
// Holds each carousel read until the test lets it run; a cancelled one leaves the queue.
function manualSettle() {
  const queue = new Set<() => void>()
  const settle = (cb: () => void) => {
    queue.add(cb)
    return () => queue.delete(cb)
  }
  return { settle, pending: () => [...queue] }
}

describe('mountFeatures stage on desktop', () => {
  it('plays only the active stage clip once it is on screen, and never a panel clip', () => {
    const { root, steps, stage, panels } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    expect(stage[0].preload).toBe('auto')
    expect(stage[1].preload).toBe('none')
    io.show(stage[0])
    expect(stage[0].getAttribute('src')).toBe('/stage-s0.mp4')
    expect(io.watchers.has(stage[1])).toBe(false)
    for (const video of panels) {
      expect(io.watchers.has(video)).toBe(false)
      expect(video.hasAttribute('src')).toBe(false)
      expect(video.preload).toBe('none')
    }
  })

  it('crossfades to the section at the viewport middle as the page scrolls', () => {
    const { root, steps, stage, items } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    expect(active(items)).toBe(0)
    placeSteps(steps, [-800, 100, 1000])
    window.dispatchEvent(new Event('scroll'))
    expect(active(items)).toBe(1)
    expect(exposed(items)).toEqual([1])
    expect(io.watchers.has(stage[0])).toBe(false)
    expect(stage[0].preload).toBe('none')
    io.show(stage[1])
    expect(playing(stage[1])).toBe(true)
  })

  it('switches each stage only among its own sections', () => {
    const { root, steps, items } = render(MIXED)
    // record, lists, services: lists is at the middle.
    placeSteps(steps, [-2400, 100, 1000])
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    const shown = items.filter((item) => item.hasAttribute('data-active'))
    expect(shown.map((item) => item.dataset.stageItem)).toEqual(['record', 'lists'])
  })

  it('measures at most once per frame', () => {
    const { root, steps, items } = render()
    placeSteps(steps, [100, 1000, 1900])
    const frames: Array<() => void> = []
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: (cb) => frames.push(cb),
      }),
    )
    placeSteps(steps, [-1700, -800, 100])
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(1)
    expect(active(items)).toBe(0)
    frames[0]()
    expect(active(items)).toBe(2)
  })

  it('switches captures but loads and plays nothing under reduced motion', () => {
    const { root, steps, stage, items } = render()
    placeSteps(steps, [-800, 100, 1000])
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(mountFeatures(root, { reducedMotion: true, media, observe: io.observe, frame: frameNow }))
    expect(active(items)).toBe(1)
    for (const video of stage) {
      io.show(video)
      expect(video.hasAttribute('src')).toBe(false)
      expect(video.preload).toBe('none')
    }
    expect(play).not.toHaveBeenCalled()
  })

  it('crossfades only without reduced motion', () => {
    const { root, steps } = render()
    placeSteps(steps, [100, 1000, 1900])
    const stageEl = root.querySelector<HTMLElement>('[data-stage]')!
    const { media } = fakeMedia(true)
    const opts = { media, observe: fakeObserver().observe, frame: frameNow }
    const dispose = mountFeatures(root, { reducedMotion: false, ...opts })
    expect(stageEl.hasAttribute('data-crossfade')).toBe(true)
    dispose()
    expect(stageEl.hasAttribute('data-crossfade')).toBe(false)
    track(mountFeatures(root, { reducedMotion: true, ...opts }))
    expect(stageEl.hasAttribute('data-crossfade')).toBe(false)
  })
})

describe('mountFeatures stage posters', () => {
  const loaded = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-stage-item] img')].map((img) => img.getAttribute('src'))

  it('loads the posters of the active capture and its neighbors, then more as the page scrolls', () => {
    const { root, steps } = render()
    placeSteps(steps, [100, 1000, 1900])
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    expect(loaded(root)).toEqual(['/poster-s0.webp', '/poster-s1.webp', null, null])

    const still = root.querySelector('picture')!
    expect(still.querySelector('source')!.hasAttribute('srcset')).toBe(false)

    placeSteps(steps, [-800, 100, 1000])
    window.dispatchEvent(new Event('scroll'))
    expect(loaded(root)).toEqual([
      '/poster-s0.webp',
      '/poster-s1.webp',
      '/poster-s2.webp',
      '/still-s2.webp',
    ])
    expect(still.querySelector('source')!.getAttribute('srcset')).toBe('/still-s2.avif 300w')
    expect(still.querySelector('img')!.getAttribute('srcset')).toBe('/still-s2.webp 300w')
  })

  it('loads no stage poster below 900px', () => {
    const { root, steps } = render()
    placeSteps(steps, [100, 1000, 1900])
    const { media } = fakeMedia(false)
    track(
      mountFeatures(root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    expect(loaded(root)).toEqual(['/poster-s0.webp', null, null, null])
  })
})

describe('mountFeatures below 900px', () => {
  it('plays each unbulleted panel while it is on screen, and leaves the stage and phone stacks alone', () => {
    const view = render(MIXED)
    placeSteps(view.steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(false)
    track(
      mountFeatures(view.root, {
        reducedMotion: false,
        media,
        observe: io.observe,
        frame: frameNow,
      }),
    )
    for (const id of ['record', 'lists', 'services']) {
      expect(io.watchers.has(view.panelFor(id, 0)), id).toBe(true)
    }
    for (const video of [...view.stage, ...view.stacks]) {
      expect(io.watchers.has(video)).toBe(false)
      expect(video.preload).toBe('none')
    }
  })

  it('ignores scrolling', () => {
    const view = render(MIXED)
    placeSteps(view.steps, [100, 1000, 1900])
    layOut(view, 'practice', 3000)
    const { media } = fakeMedia(false)
    track(
      mountFeatures(view.root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    placeSteps(view.steps, [-1700, -800, 100])
    scrollTo(3000 + 2 * STEP)
    expect(active(view.items)).toBe(0)
    expect(view.phones('practice').map((p) => p.classList.contains('is-active'))).toEqual([
      true,
      false,
      false,
    ])
  })

  it('leaves the bullets as plain text, since there is nothing for them to move', () => {
    const view = render(MIXED)
    const { media } = fakeMedia(false)
    track(
      mountFeatures(view.root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    for (const bullet of view.bullets('practice')) expect(bullet.tagName).toBe('SPAN')
    expect(view.section('practice').querySelector('[data-marks]')!.hasAttribute('hidden')).toBe(
      true,
    )
  })
})

describe('mountFeatures carousels below 900px', () => {
  const scrolls: Array<{ el: HTMLElement; options: ScrollToOptions }> = []
  const mount = (
    opts: { reducedMotion?: boolean; settle?: (cb: () => void) => () => void } = {},
  ) => {
    const view = render(MIXED)
    placeSteps(view.steps, [100, 1000, 1900])
    for (const id of ['tunes', 'practice']) layOutCards(view, id)
    const io = fakeObserver()
    const dispose = mountFeatures(view.root, {
      reducedMotion: opts.reducedMotion ?? false,
      media: fakeMedia(false).media,
      observe: io.observe,
      frame: frameNow,
      settle: opts.settle ?? settleNow,
    })
    track(dispose)
    return { ...view, io, dispose }
  }
  const current = (els: Element[]) => els.findIndex((el) => el.getAttribute('aria-current'))

  beforeEach(() => {
    // jsdom has no element scrolling; this one lands at once, as a browser's scroll ends.
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        scrolls.push({ el: this, options })
        swipe(this, options.left ?? 0)
      },
    })
  })

  afterEach(() => {
    scrolls.splice(0)
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  })

  it('shows the marks and pause under each carousel and plays only the first card', () => {
    const view = mount()
    for (const id of ['tunes', 'practice']) {
      expect(view.controls(id).hasAttribute('hidden')).toBe(false)
      expect(current(view.cardMarks(id))).toBe(0)
      expect(view.cardMarks(id)).toHaveLength(view.bullets(id).length)
      expect(view.section(id).querySelector('[data-marks]')!.hasAttribute('hidden')).toBe(true)
    }
    expect([0, 1, 2].map((i) => view.io.watchers.has(view.panelFor('practice', i)))).toEqual([
      true,
      false,
      false,
    ])
    expect(view.panelFor('practice', 0).preload).toBe('auto')
    view.io.show(view.panelFor('practice', 0))
    expect(view.panelFor('practice', 0).getAttribute('src')).toBe('/panel-practice-0.mp4')
    for (const i of [1, 2]) {
      expect(view.panelFor('practice', i).hasAttribute('src')).toBe(false)
      expect(view.panelFor('practice', i).preload).toBe('none')
    }
  })

  it('plays only the card the carousel snaps to, from its first frame, and marks it current', () => {
    const view = mount()
    view.panelFor('practice', 1).currentTime = 4
    swipe(view.track('practice'), CARD - 40)
    expect(current(view.cardMarks('practice'))).toBe(1)
    expect([0, 1, 2].map((i) => view.io.watchers.has(view.panelFor('practice', i)))).toEqual([
      false,
      true,
      false,
    ])
    expect(view.panelFor('practice', 1).currentTime).toBe(0)
    expect(view.panelFor('practice', 0).preload).toBe('none')
    view.io.show(view.panelFor('practice', 1))
    expect(playing(view.panelFor('practice', 1))).toBe(true)
    // Another carousel stays on its own card.
    expect(current(view.cardMarks('tunes'))).toBe(0)
    expect(view.io.watchers.has(view.panelFor('tunes', 0))).toBe(true)
  })

  it('reads the last card once the track has scrolled as far as it goes', () => {
    const view = mount()
    // The last card is too narrow to reach the start, so the track stops short of its offset.
    swipe(view.track('practice'), 2 * CARD - 70)
    expect(current(view.cardMarks('practice'))).toBe(2)
  })

  it("scrolls to a card from its mark and announces the card's clip", () => {
    const view = mount()
    view.cardMarks('practice')[2].click()
    expect(scrolls.at(-1)).toEqual({
      el: view.track('practice'),
      options: { left: 2 * CARD, behavior: 'smooth' },
    })
    expect(current(view.cardMarks('practice'))).toBe(2)
    expect(view.live.textContent).toBe('Panel practice-2')
  })

  it('jumps to a card and plays nothing under reduced motion', () => {
    const view = mount({ reducedMotion: true })
    view.cardMarks('practice')[1].click()
    expect(scrolls.at(-1)?.options).toEqual({ left: CARD, behavior: 'auto' })
    expect(current(view.cardMarks('practice'))).toBe(1)
    expect(view.io.watchers.size).toBe(0)
  })

  it('reads the card once the scroll ends, so cards passed on the way never play', () => {
    const view = mount()
    const track = view.track('practice')
    track.scrollLeft = CARD
    track.dispatchEvent(new Event('scroll'))
    track.scrollLeft = 2 * CARD
    track.dispatchEvent(new Event('scroll'))
    expect(current(view.cardMarks('practice'))).toBe(0)
    track.dispatchEvent(new Event('scrollend'))
    expect(current(view.cardMarks('practice'))).toBe(2)
    expect(view.io.watchers.has(view.panelFor('practice', 1))).toBe(false)
    expect(view.panelFor('practice', 1).preload).toBe('none')
  })

  it('stops reading scroll ends when disposed', () => {
    const view = mount()
    view.dispose()
    swipe(view.track('practice'), 2 * CARD)
    expect(current(view.cardMarks('practice'))).toBe(0)
    expect(view.io.watchers.size).toBe(0)
  })

  describe('where the browser does not report the end of a scroll', () => {
    // jsdom, like current browsers, has the `onscrollend` handler on a prototype of window.
    let owner: object | null = null
    let descriptor: PropertyDescriptor | undefined
    beforeEach(() => {
      owner = window
      while (owner && !Object.prototype.hasOwnProperty.call(owner, 'onscrollend')) {
        owner = Object.getPrototypeOf(owner)
      }
      descriptor = owner ? Object.getOwnPropertyDescriptor(owner, 'onscrollend') : undefined
      if (owner) delete (owner as { onscrollend?: unknown }).onscrollend
    })
    afterEach(() => {
      if (owner && descriptor) Object.defineProperty(owner, 'onscrollend', descriptor)
    })

    it('reads the card only once the scrolling settles', () => {
      expect('onscrollend' in window).toBe(false)
      const waiting = manualSettle()
      const view = mount({ settle: waiting.settle })
      swipe(view.track('practice'), CARD)
      swipe(view.track('practice'), 2 * CARD)
      expect(waiting.pending()).toHaveLength(1)
      expect(current(view.cardMarks('practice'))).toBe(0)
      waiting.pending()[0]()
      expect(current(view.cardMarks('practice'))).toBe(2)
      expect(view.io.watchers.has(view.panelFor('practice', 1))).toBe(false)
    })

    it('drops a read still waiting for the scrolling to settle when disposed', () => {
      const waiting = manualSettle()
      const view = mount({ settle: waiting.settle })
      swipe(view.track('practice'), 2 * CARD)
      view.dispose()
      expect(waiting.pending()).toHaveLength(0)
      expect(current(view.cardMarks('practice'))).toBe(0)
      expect(view.io.watchers.size).toBe(0)
    })
  })

  it("pauses the cards from a carousel's toggle and holds the pause across cards", () => {
    const view = mount()
    const toggle = view.controls('practice').querySelector<HTMLButtonElement>('[data-clip-toggle]')!
    expect(toggle.hidden).toBe(false)
    toggle.click()
    expect(view.io.watchers.size).toBe(0)
    swipe(view.track('practice'), CARD)
    expect(view.io.watchers.has(view.panelFor('practice', 1))).toBe(false)
    toggle.click()
    expect(toggle.textContent).toBe(PAUSE)
    expect(view.io.watchers.has(view.panelFor('practice', 1))).toBe(true)
    expect(view.io.watchers.has(view.panelFor('practice', 0))).toBe(false)
  })

  it('stops following the carousels when disposed', () => {
    const view = mount()
    view.dispose()
    expect(view.controls('practice').hasAttribute('hidden')).toBe(true)
    swipe(view.track('practice'), 2 * CARD)
    expect(current(view.cardMarks('practice'))).toBe(0)
    expect(view.io.watchers.size).toBe(0)
  })
})

describe('mountFeatures across the 900px line', () => {
  it('hands playback to the layout now on screen', () => {
    const { root, steps, stage, panels } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media, flip } = fakeMedia(true)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    expect(io.watchers.has(stage[0])).toBe(true)

    flip(false)
    expect(io.watchers.has(stage[0])).toBe(false)
    expect(stage[0].preload).toBe('none')
    expect(panels.every((video) => io.watchers.has(video))).toBe(true)

    flip(true)
    expect(panels.some((video) => io.watchers.has(video))).toBe(false)
    expect(io.watchers.has(stage[0])).toBe(true)
  })

  it('stops listening when disposed', () => {
    const { root, steps, stage, items } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media, listeners } = fakeMedia(true)
    const dispose = mountFeatures(root, {
      reducedMotion: false,
      media,
      observe: io.observe,
      frame: frameNow,
    })
    dispose()
    expect(listeners.size).toBe(0)
    expect(io.watchers.size).toBe(0)
    expect(stage[0].preload).toBe('none')
    placeSteps(steps, [-1700, -800, 100])
    window.dispatchEvent(new Event('scroll'))
    expect(active(items)).toBe(0)
  })
})

describe('mountFeatures pause control', () => {
  const labels = (toggles: HTMLButtonElement[]) => toggles.map((toggle) => toggle.textContent)

  it('reveals every toggle, named for pausing', () => {
    const { root, steps, toggles } = render(MIXED)
    placeSteps(steps, [100, 1000, 1900])
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, {
        reducedMotion: false,
        media,
        observe: fakeObserver().observe,
        frame: frameNow,
      }),
    )
    expect(toggles.map((toggle) => toggle.hidden)).toEqual(toggles.map(() => false))
    expect(labels(toggles)).toEqual(toggles.map(() => PAUSE))
  })

  it('pauses the stage clip and keeps later sections paused until Play', () => {
    const { root, steps, stage, stageToggles, toggles } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    io.show(stage[0])
    pause.mockClear()

    stageToggles[0].click()
    expect(pause.mock.contexts).toContain(stage[0])
    expect(io.watchers.size).toBe(0)
    expect(labels(toggles)).toEqual(toggles.map(() => PLAY))

    placeSteps(steps, [-800, 100, 1000])
    window.dispatchEvent(new Event('scroll'))
    expect(io.watchers.size).toBe(0)

    stageToggles[0].click()
    expect(labels(toggles)).toEqual(toggles.map(() => PAUSE))
    io.show(stage[1])
    expect(playing(stage[1])).toBe(true)
  })

  it('pauses every panel clip from any panel, and plays them again', () => {
    const { root, steps, panels, panelToggles, toggles } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(false)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    io.show(panels[0])
    pause.mockClear()

    panelToggles[2].click()
    expect(pause.mock.contexts).toContain(panels[0])
    expect(io.watchers.size).toBe(0)
    expect(labels(toggles)).toEqual(toggles.map(() => PLAY))

    panelToggles[0].click()
    expect(panels.every((video) => io.watchers.has(video))).toBe(true)
    expect(labels(toggles)).toEqual(toggles.map(() => PAUSE))
  })

  it('pauses a pinned section from its own toggle and holds the pause across bullets', () => {
    const view = render(MIXED)
    placeSteps(view.steps, [100, 1000, 1900])
    layOut(view, 'practice', 3000)
    scrollTo(3000)
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(
      mountFeatures(view.root, {
        reducedMotion: false,
        media,
        observe: io.observe,
        frame: frameNow,
      }),
    )
    const toggle = view
      .section('practice')
      .querySelector<HTMLButtonElement>('[data-side] [data-clip-toggle]')!
    toggle.click()
    expect(io.watchers.has(view.stackFor('practice', 0))).toBe(false)
    scrollTo(3000 + STEP)
    expect(io.watchers.has(view.stackFor('practice', 1))).toBe(false)
    toggle.click()
    expect(io.watchers.has(view.stackFor('practice', 1))).toBe(true)
  })

  it('stays paused across the 900px line', () => {
    const { root, steps, panels, stageToggles } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media, flip } = fakeMedia(true)
    track(
      mountFeatures(root, { reducedMotion: false, media, observe: io.observe, frame: frameNow }),
    )
    stageToggles[0].click()
    flip(false)
    expect(io.watchers.size).toBe(0)
    for (const video of panels) expect(video.hasAttribute('src')).toBe(false)
  })

  it('starts paused under reduced motion and plays once asked', () => {
    const { root, steps, stage, stageToggles, toggles } = render()
    placeSteps(steps, [100, 1000, 1900])
    const io = fakeObserver()
    const { media } = fakeMedia(true)
    track(mountFeatures(root, { reducedMotion: true, media, observe: io.observe, frame: frameNow }))
    expect(labels(toggles)).toEqual(toggles.map(() => PLAY))
    expect(io.watchers.size).toBe(0)

    stageToggles[0].click()
    expect(stage[0].preload).toBe('auto')
    io.show(stage[0])
    expect(playing(stage[0])).toBe(true)
  })

  it('stops listening to the toggles when disposed', () => {
    const { root, steps, stageToggles } = render()
    placeSteps(steps, [100, 1000, 1900])
    const { media } = fakeMedia(true)
    const dispose = mountFeatures(root, {
      reducedMotion: false,
      media,
      observe: fakeObserver().observe,
      frame: frameNow,
    })
    dispose()
    stageToggles[0].click()
    expect(stageToggles[0].textContent).toBe(PAUSE)
  })
})

describe('mountFeatures pinned bulleted sections', () => {
  const PRACTICE_TOP = 3000
  const mount = (opts: { reducedMotion?: boolean; desktop?: boolean } = {}) => {
    const view = render(MIXED)
    placeSteps(view.steps, [100, 1000, 1900])
    layOut(view, 'tunes', 0)
    layOut(view, 'practice', PRACTICE_TOP)
    for (const id of ['tunes', 'practice']) layOutCards(view, id)
    const io = fakeObserver()
    const media = fakeMedia(opts.desktop ?? true)
    track(
      mountFeatures(view.root, {
        reducedMotion: opts.reducedMotion ?? false,
        media: media.media,
        observe: io.observe,
        frame: frameNow,
        settle: settleNow,
      }),
    )
    return { ...view, io, flip: media.flip }
  }
  const classes = (phones: HTMLElement[]) =>
    phones.map((phone) =>
      phone.classList.contains('is-active')
        ? 'active'
        : phone.classList.contains('is-before')
          ? 'before'
          : 'after',
    )
  const current = (els: Element[]) => els.findIndex((el) => el.getAttribute('aria-current'))
  const lineD = (svg: SVGSVGElement) => svg.querySelector('path')?.getAttribute('d') ?? ''

  it('turns each bullet into a button for its clip and reveals the marks', () => {
    const view = mount()
    for (const id of ['tunes', 'practice']) {
      const bullets = view.bullets(id)
      expect(bullets.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
      expect(bullets.map((b) => (b as HTMLButtonElement).type)).toEqual([
        'button',
        'button',
        'button',
      ])
      // Scoped styles match the component's attribute, so the button keeps every one.
      for (const bullet of bullets) {
        expect(bullet.className).toContain('point')
        expect(bullet.hasAttribute('data-astro-cid-test')).toBe(true)
      }
      expect(bullets.map((b) => b.textContent)).toEqual([0, 1, 2].map((i) => `Bullet ${id} ${i}`))
      expect(view.section(id).querySelector('[data-marks]')!.hasAttribute('hidden')).toBe(false)
      expect(view.marks(id)).toHaveLength(3)
    }
  })

  it('steps through the bullets as the page scrolls down, then back up in reverse', () => {
    const view = mount()
    const svg = view.connector('practice')
    scrollTo(PRACTICE_TOP)
    expect(current(view.bullets('practice'))).toBe(0)
    expect(classes(view.phones('practice'))).toEqual(['active', 'after', 'after'])
    const first = lineD(svg)
    expect(first).toMatch(/^M/)

    scrollTo(PRACTICE_TOP + 2 * STEP)
    expect(current(view.bullets('practice'))).toBe(2)
    expect(current(view.marks('practice'))).toBe(2)
    expect(classes(view.phones('practice'))).toEqual(['before', 'before', 'active'])
    expect(exposed(view.phones('practice'))).toEqual([2])
    const third = lineD(svg)
    expect(third).not.toBe(first)

    scrollTo(PRACTICE_TOP + STEP)
    expect(current(view.bullets('practice'))).toBe(1)
    expect(current(view.marks('practice'))).toBe(1)
    expect(classes(view.phones('practice'))).toEqual(['before', 'active', 'after'])
    expect(exposed(view.phones('practice'))).toEqual([1])
    expect(lineD(svg)).not.toBe(third)
    expect(lineD(svg)).not.toBe(first)
    // Another section's bullets stay where they were.
    expect(current(view.bullets('tunes'))).toBe(2)
  })

  it('shows the bullet the page is already scrolled to when it mounts', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: PRACTICE_TOP + STEP })
    const view = mount()
    expect(current(view.bullets('practice'))).toBe(1)
    expect(classes(view.phones('practice'))).toEqual(['before', 'active', 'after'])
  })

  it('plays only the active phone and restarts the arriving clip at its first frame', () => {
    const view = mount()
    scrollTo(PRACTICE_TOP)
    expect(view.stackFor('practice', 0).preload).toBe('auto')
    view.io.show(view.stackFor('practice', 0))
    expect(playing(view.stackFor('practice', 0))).toBe(true)
    view.stackFor('practice', 1).currentTime = 4
    scrollTo(PRACTICE_TOP + STEP)
    expect(view.stackFor('practice', 1).currentTime).toBe(0)
    expect(view.io.watchers.has(view.stackFor('practice', 0))).toBe(false)
    expect(view.stackFor('practice', 0).preload).toBe('none')
    expect(view.io.watchers.has(view.stackFor('practice', 1))).toBe(true)
    for (const video of view.panels) expect(view.io.watchers.has(video)).toBe(false)
  })

  it("moves to a clip's stop from its bullet or its mark, and announces the clip", () => {
    const view = mount()
    scrollTo(PRACTICE_TOP)
    view.bullets('practice')[2].click()
    expect(windowScroll).toHaveBeenLastCalledWith({
      top: PRACTICE_TOP + 2 * STEP,
      behavior: 'smooth',
    })
    expect(view.live.textContent).toBe('Clip practice-2')
    view.marks('practice')[1].click()
    expect(windowScroll).toHaveBeenLastCalledWith({ top: PRACTICE_TOP + STEP, behavior: 'smooth' })
    expect(view.live.textContent).toBe('Clip practice-1')
  })

  it('does not announce a change made by scrolling', () => {
    const view = mount()
    scrollTo(PRACTICE_TOP + STEP)
    expect(view.live.textContent).toBe('')
  })

  const ends = (d: string) => {
    const numbers = d
      .trim()
      .split(/[\s,MCL]+/)
      .filter(Boolean)
      .map(Number)
    return { start: numbers.slice(0, 2), end: numbers.slice(-2) }
  }

  it('draws the connector with a pen stroke on each change, decorative and level with its bullet', () => {
    const view = mount()
    const svg = view.connector('practice')
    scrollTo(PRACTICE_TOP + STEP)
    const [line, head] = [...svg.querySelectorAll('path')]
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(line.classList.contains('draw')).toBe(true)
    expect(head.classList.contains('head')).toBe(true)
    // The widest bullet ends at 360, bullet 1 sits at 460 to 484, and the phone's edge is at 760.
    expect(ends(line.getAttribute('d')!)).toEqual({ start: [384, 472], end: [754, 472] })
  })

  it("starts every bullet's connector on one line past the widest bullet, ending on the phone", () => {
    const view = mount()
    const svg = view.connector('practice')
    for (const i of [0, 1, 2]) {
      scrollTo(PRACTICE_TOP + i * STEP)
      const { start, end } = ends(svg.querySelector('path')!.getAttribute('d')!)
      expect(start).toEqual([384, 432 + i * 40])
      expect(end[0]).toBe(754)
      // Level with its bullet, within the phone's height.
      expect(end[1]).toBe(start[1])
      expect(end[1]).toBeGreaterThan(120)
      expect(end[1]).toBeLessThan(770)
    }
  })

  it("keeps the connector within the phone's height when its bullet sits beyond it", () => {
    const view = mount()
    view.section('practice').querySelector<HTMLElement>('[data-stack]')!.getBoundingClientRect =
      () => ({ left: 760, top: 500, width: 300, height: 400, right: 1060, bottom: 900 }) as DOMRect
    scrollTo(PRACTICE_TOP)
    window.dispatchEvent(new Event('resize'))
    const { start, end } = ends(
      view.connector('practice').querySelector('path')!.getAttribute('d')!,
    )
    expect(start).toEqual([384, 432])
    expect(end[0]).toBe(754)
    expect(end[1]).toBe(500 + 400 * 0.12)
  })

  it('redraws the connector without the stroke when the window resizes', () => {
    const view = mount()
    const svg = view.connector('practice')
    scrollTo(PRACTICE_TOP + STEP)
    const before = svg.querySelector('path')!.getAttribute('d')
    view.section('practice').querySelector<HTMLElement>('[data-stack]')!.getBoundingClientRect =
      () => ({ left: 700, top: 100, width: 280, height: 600, right: 980, bottom: 700 }) as DOMRect
    window.dispatchEvent(new Event('resize'))
    const line = svg.querySelector('path')!
    expect(line.getAttribute('d')).not.toBe(before)
    expect(line.classList.contains('draw')).toBe(false)
  })

  it('draws the connector without the stroke animation under reduced motion', () => {
    const view = mount({ reducedMotion: true })
    const svg = view.connector('practice')
    scrollTo(PRACTICE_TOP + STEP)
    expect(current(view.bullets('practice'))).toBe(1)
    const paths = [...svg.querySelectorAll('path')]
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.classList.contains('draw')).toBe(false)
      expect(path.classList.contains('head')).toBe(false)
    }
  })

  it('jumps to a stop without smooth scrolling under reduced motion', () => {
    const view = mount({ reducedMotion: true })
    view.marks('practice')[2].click()
    expect(windowScroll).toHaveBeenLastCalledWith({
      top: PRACTICE_TOP + 2 * STEP,
      behavior: 'auto',
    })
  })

  // Window scrolls land at once, as an instant browser scroll does.
  const jumping = () =>
    windowScroll.mockImplementation((options) => {
      const { top } = options as ScrollToOptions
      Object.defineProperty(window, 'scrollY', { configurable: true, value: top })
    })
  const MOBILE_TOP = 5000

  it('stops pinning and drawing below 900px, and shows the same bullet on the carousel', () => {
    const view = mount()
    scrollTo(PRACTICE_TOP + STEP)
    jumping()
    windowScroll.mockClear()
    // The narrow layout moves the section; the browser leaves the scroll position elsewhere.
    placeSection(view, 'practice', MOBILE_TOP, 1200)
    view.flip(false)
    expect(windowScroll).toHaveBeenCalledExactlyOnceWith({ top: MOBILE_TOP, behavior: 'instant' })
    expect(view.connector('practice').querySelector('path')).toBeNull()
    expect(view.bullets('practice').map((b) => b.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN'])
    expect(view.section('practice').querySelector('[data-marks]')!.hasAttribute('hidden')).toBe(
      true,
    )
    for (const video of view.stacks) {
      expect(view.io.watchers.has(video)).toBe(false)
      expect(video.preload).toBe('none')
    }
    expect(view.track('practice').scrollLeft).toBe(CARD)
    expect(current(view.cardMarks('practice'))).toBe(1)
    expect([0, 1, 2].map((i) => view.io.watchers.has(view.panelFor('practice', i)))).toEqual([
      false,
      true,
      false,
    ])

    // Scrolling the page no longer drives the section.
    scrollTo(PRACTICE_TOP + 2 * STEP)
    expect(view.connector('practice').querySelector('path')).toBeNull()
    expect(classes(view.phones('practice'))).toEqual(['before', 'active', 'after'])
  })

  it('opens every other carousel on its first card below 900px', () => {
    const view = mount()
    // Past the tunes runway, so desktop shows its last bullet there.
    scrollTo(PRACTICE_TOP + STEP)
    expect(current(view.bullets('tunes'))).toBe(2)
    placeSection(view, 'practice', PRACTICE_TOP + STEP - 200, 1200)
    view.flip(false)
    expect(current(view.cardMarks('tunes'))).toBe(0)
    expect(view.track('tunes').scrollLeft).toBe(0)
    expect(current(view.cardMarks('practice'))).toBe(1)
  })

  it('restarts the card clip each time the carousel comes back', () => {
    const view = mount()
    scrollTo(PRACTICE_TOP + STEP)
    placeSection(view, 'practice', PRACTICE_TOP + STEP - 200, 1200)
    view.flip(false)
    view.flip(true)
    view.panelFor('practice', 1).currentTime = 4
    view.flip(false)
    expect(current(view.cardMarks('practice'))).toBe(1)
    expect(view.panelFor('practice', 1).currentTime).toBe(0)
  })

  it('leaves the scroll alone below 900px when the section is still in view', () => {
    const view = mount()
    scrollTo(PRACTICE_TOP + STEP)
    windowScroll.mockClear()
    placeSection(view, 'practice', PRACTICE_TOP + STEP - 200, 1200)
    view.flip(false)
    expect(windowScroll).not.toHaveBeenCalled()
    expect(current(view.cardMarks('practice'))).toBe(1)
  })

  it("keeps the carousel's section and card when the window widens past 900px", () => {
    const view = mount()
    scrollTo(PRACTICE_TOP)
    placeSection(view, 'practice', PRACTICE_TOP - 100, 1200)
    view.flip(false)
    swipe(view.track('practice'), 2 * CARD)
    // The wide layout moves the section back; the browser leaves the scroll position elsewhere.
    layOut(view, 'practice', PRACTICE_TOP)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1500 })
    jumping()
    windowScroll.mockClear()
    view.io.watchers.clear()
    view.flip(true)
    expect(windowScroll).toHaveBeenCalledExactlyOnceWith({
      top: PRACTICE_TOP + 2 * STEP,
      behavior: 'instant',
    })
    expect(current(view.bullets('practice'))).toBe(2)
    expect(classes(view.phones('practice'))).toEqual(['before', 'before', 'active'])
    expect(view.connector('practice').querySelector('path')).not.toBeNull()
    // Only the bullet's own desktop clip is asked to play.
    expect(view.io.watchers.has(view.stackFor('practice', 2))).toBe(true)
    expect(view.stackFor('practice', 0).preload).toBe('none')
    expect(view.stackFor('practice', 0).hasAttribute('src')).toBe(false)
    expect(view.panels.some((video) => view.io.watchers.has(video))).toBe(false)
    expect(view.controls('practice').hasAttribute('hidden')).toBe(true)
  })

  it('leaves the scroll alone across 900px when no bulleted section is in view', () => {
    const view = mount()
    scrollTo(2000)
    windowScroll.mockClear()
    view.flip(false)
    swipe(view.track('tunes'), CARD)
    view.flip(true)
    expect(windowScroll).not.toHaveBeenCalled()
    // Past the tunes runway, so its last bullet shows, as the scroll position says.
    expect(current(view.bullets('tunes'))).toBe(2)
  })

  describe('keyboard focus', () => {
    const focused = () => document.activeElement

    it.each([
      ['bullet', (view: ReturnType<typeof mount>) => view.bullets('practice')[2]],
      ['mark', (view: ReturnType<typeof mount>) => view.marks('practice')[2]],
    ])('moves from a %s to its card mark when the window narrows past 900px', (_what, pick) => {
      const view = mount()
      scrollTo(PRACTICE_TOP + STEP)
      pick(view).focus()
      placeSection(view, 'practice', PRACTICE_TOP + STEP - 200, 1200)
      view.flip(false)
      expect(focused()).toBe(view.cardMarks('practice')[2])
    })

    it('moves from a card mark to its bullet when the window widens past 900px', () => {
      const view = mount({ desktop: false })
      view.cardMarks('practice')[1].focus()
      view.flip(true)
      expect(focused()).toBe(view.bullets('practice')[1])
      expect(view.bullets('practice')[1].tagName).toBe('BUTTON')
    })

    // The new layout's styles can hide the focused control before the change reaches the script,
    // and the browser moves focus to the page body as they do.
    it('moves from a card mark the wide styles hid first to its bullet', () => {
      const view = mount({ desktop: false })
      view.cardMarks('practice')[1].focus()
      view.cardMarks('practice')[1].blur()
      view.flip(true)
      expect(focused()).toBe(view.bullets('practice')[1])
    })

    it('leaves focus alone once the visitor moved it away from a control still on screen', () => {
      const view = mount({ desktop: false })
      const mark = view.cardMarks('practice')[1]
      mark.getClientRects = () => [new DOMRect(0, 0, 28, 44)] as unknown as DOMRectList
      mark.focus()
      mark.blur()
      view.flip(true)
      expect(focused()).toBe(document.body)
    })

    it('stays on a bullet when a pause rebuilds the layout', () => {
      const view = mount()
      view.bullets('practice')[1].focus()
      view.toggles[0].click()
      expect(focused()).toBe(view.bullets('practice')[1])
    })

    it('stays on its bullet when the sections are mounted again', () => {
      const view = render(MIXED)
      layOut(view, 'practice', PRACTICE_TOP)
      const options = () => ({
        reducedMotion: false,
        media: fakeMedia(true).media,
        observe: fakeObserver().observe,
        frame: frameNow,
      })
      const dispose = mountFeatures(view.root, options())
      view.bullets('practice')[2].focus()
      dispose()
      track(mountFeatures(view.root, { ...options(), reducedMotion: true }))
      expect(focused()).toBe(view.bullets('practice')[2])
    })

    it('leaves focus alone when no bullet or mark had it', () => {
      const view = mount()
      const toggle = view.toggles.at(-1)!
      toggle.focus()
      view.flip(false)
      expect(focused()).toBe(toggle)
    })
  })

  it('puts the plain list back and stops following the scroll when disposed', () => {
    const view = render(MIXED)
    layOut(view, 'practice', PRACTICE_TOP)
    const { media } = fakeMedia(true)
    const dispose = mountFeatures(view.root, {
      reducedMotion: false,
      media,
      observe: fakeObserver().observe,
      frame: frameNow,
    })
    dispose()
    for (const bullet of view.bullets('practice')) {
      expect(bullet.tagName).toBe('SPAN')
      expect(bullet.hasAttribute('data-astro-cid-test')).toBe(true)
      expect(bullet.hasAttribute('type')).toBe(false)
      expect(bullet.hasAttribute('aria-current')).toBe(false)
    }
    expect(view.connector('practice').querySelector('path')).toBeNull()
    expect(view.section('practice').querySelector('[data-marks]')!.hasAttribute('hidden')).toBe(
      true,
    )
    scrollTo(PRACTICE_TOP + 2 * STEP)
    expect(classes(view.phones('practice'))).toEqual(['active', 'after', 'after'])
  })
})
