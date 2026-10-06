// The feature sections' captures: which clip shows as the visitor scrolls, the arrow to it, and
// which clips may load.
import { mountCarousel } from './carousel'
import { connectorPath, variantFor } from './connector'
import { PAUSE, PLAY, playWhenVisible, type MediaQuery, type Observe } from './playback'
import { mountRunway, stackClasses, type Runway } from './runway'

/** Matches the layout that pins sections and shows stages; below it each section stacks. */
export const DESKTOP_QUERY = '(min-width: 900px)'

/** Every connector in a section starts this far past its widest bullet's text. */
const GATE_CLEARANCE = 24
/** The arrowhead stops this far short of the phone's edge. */
const PHONE_GAP = 6
/** The arrowhead stays this share of the phone's height away from its top and bottom. */
const PHONE_MARGIN = 0.12

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The last section whose top is at or above the viewport middle, else the first. */
export function activeIndex(tops: number[], viewportMiddle: number): number {
  let index = 0
  tops.forEach((top, i) => {
    if (top <= viewportMiddle) index = i
  })
  return index
}

/**
 * Swaps a bullet's element for a `tag` holding the same text. Without JavaScript, and below the
 * desktop width where a bullet has nothing to move, the bullets read as a plain list, so only a
 * pinned section makes them buttons.
 */
function swapBullet(bullet: HTMLElement, tag: 'button' | 'span'): HTMLElement {
  const next = bullet.ownerDocument.createElement(tag)
  // Scoped styles match the component's own attribute, so every attribute carries over.
  for (const { name, value } of bullet.attributes) {
    if (!/^(type|aria-.*)$/.test(name)) next.setAttribute(name, value)
  }
  if (next instanceof HTMLButtonElement) next.type = 'button'
  next.append(...bullet.childNodes)
  bullet.replaceWith(next)
  return next
}

/** The line boxes of an element's text, or its own box when the text has none to measure. */
function lineBoxes(el: Element): DOMRect[] {
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  const rects =
    typeof range.getClientRects === 'function'
      ? [...range.getClientRects()].filter((rect) => rect.width > 0)
      : []
  return rects.length ? rects : [el.getBoundingClientRect()]
}

/** What a capture says to assistive tech: a clip's label or a still's alt text. */
function describe(el: Element | undefined): string | null | undefined {
  return (
    el?.querySelector('video[aria-label]')?.getAttribute('aria-label') ??
    el?.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt')
  )
}

/** A bulleted section's control that had keyboard focus: its section and bullet. */
type FocusSpot = { section: HTMLElement; index: number }

// Remounting rebuilds the bullets, so a disposer leaves the focused control's place here for the
// next mount on the same root to focus its replacement.
const focusHandoff = new WeakMap<HTMLElement, FocusSpot>()

/** A run of sections without bullets beside one stage that shows the capture of the one in view. */
type StageGroup = {
  stage: HTMLElement | null
  steps: HTMLElement[]
  items: HTMLElement[]
  videos: Array<HTMLVideoElement | null>
  images: Array<Array<HTMLImageElement | HTMLSourceElement>>
  section: number
  shown: number
  stop: () => void
}

/**
 * A bulleted section: at the desktop width it pins in its own runway while scroll steps through
 * its bullets; below it, its bullets are cards in a carousel that swipes sideways.
 */
type Pinned = {
  id: string
  section: HTMLElement
  bullets: HTMLElement[]
  phones: HTMLElement[]
  videos: Array<HTMLVideoElement | null>
  marks: HTMLButtonElement[]
  marksBox: HTMLElement | null
  stack: HTMLElement | null
  svg: SVGSVGElement | null
  runwayEl: HTMLElement | null
  runway?: Runway
  /** The bullet on show in either layout, so crossing the breakpoint keeps it. */
  active: number
  shown: number
  stop: () => void
  /** The card whose clip is cued in the narrow layout, so a pause toggle resumes it. */
  cardShown: number
  /** Disposes the narrow layout's carousel while it is mounted. */
  carousel?: () => void
}

/**
 * At the desktop width, pins each bulleted section in its runway: scrolling steps through its
 * bullets, each a button that moves to its clip, with the active bullet, phone, and mark marked
 * and a hand-drawn connector from the bullet to the phone, redrawn with a pen stroke on each
 * change and without one on resize. Each run of sections without bullets keeps one stage beside
 * it that crossfades to the section at the viewport middle, loading the posters of the shown
 * capture and its neighbors. Below the desktop width nothing pins: each section without bullets
 * shows its own panel, whose clip plays while it is on screen, and each bulleted section is a
 * carousel whose marks scroll to a card and where only the card it rests on plays. Only the
 * layout on screen loads media, and crossing the breakpoint hands playback to the other one,
 * keeping the visitor in the bulleted section they were reading, on the same bullet, and keyboard
 * focus on that bullet's control. Every pause toggle, `hidden` until now, pauses and plays all
 * the clips at once, and a pause holds across sections, bullets, and layouts until the visitor
 * plays again. Under reduced motion stages do not crossfade, the connector appears without its
 * stroke, and the clips start paused. Returns a disposer, which puts the plain lists back.
 */
export function mountFeatures(
  root: HTMLElement,
  opts: {
    reducedMotion: boolean
    media?: MediaQuery
    observe?: Observe
    frame?: (callback: () => void) => void
    /** Runs `callback` once a carousel's scrolling pauses; returns its cancel function. */
    settle?: (callback: () => void) => () => void
  },
): () => void {
  const win = root.ownerDocument.defaultView ?? window
  const doc = root.ownerDocument
  const media = opts.media ?? win.matchMedia(DESKTOP_QUERY)
  const frame = opts.frame ?? ((callback: () => void) => win.requestAnimationFrame(callback))
  const { reducedMotion, observe } = opts

  const groups: StageGroup[] = [...root.querySelectorAll<HTMLElement>('[data-stage-group]')].map(
    (group) => {
      const items = [...group.querySelectorAll<HTMLElement>('[data-stage-item]')]
      return {
        stage: group.querySelector<HTMLElement>('[data-stage]'),
        steps: [...group.querySelectorAll<HTMLElement>('[data-feature-step]')],
        items,
        videos: items.map((item) => item.querySelector('video')),
        images: items.map((item) => [
          ...item.querySelectorAll<HTMLImageElement | HTMLSourceElement>(
            '[data-src], [data-srcset]',
          ),
        ]),
        section: 0,
        shown: -1,
        stop: () => {},
      }
    },
  )
  const pinned: Pinned[] = [...root.querySelectorAll<HTMLElement>('[data-bulleted]')].map(
    (section) => {
      const phones = [...section.querySelectorAll<HTMLElement>('[data-stack-item]')]
      return {
        id: section.dataset.feature ?? '',
        section,
        bullets: [...section.querySelectorAll<HTMLElement>('[data-bullet]')],
        phones,
        videos: phones.map((phone) => phone.querySelector('video')),
        marks: [...section.querySelectorAll<HTMLButtonElement>('[data-mark]')],
        marksBox: section.querySelector<HTMLElement>('[data-marks]'),
        stack: section.querySelector<HTMLElement>('[data-stack]'),
        svg: section.querySelector<SVGSVGElement>('[data-connector]'),
        runwayEl: section.querySelector<HTMLElement>('[data-runway]'),
        active: 0,
        shown: 0,
        stop: () => {},
        cardShown: -1,
      }
    },
  )
  const panelVideos = [
    ...root.querySelectorAll<HTMLVideoElement>('[data-feature-step] [data-panel] video'),
  ]
  const toggles = [...root.querySelectorAll<HTMLButtonElement>('[data-clip-toggle]')]
  const live = root.querySelector<HTMLElement>('[data-features-live]')

  let paused = reducedMotion
  let desktop = false
  let pending = false
  /** The layout set up last, so a setup can tell crossing the breakpoint from a pause toggle. */
  let layout: 'desktop' | 'mobile' | null = null
  /** The bulleted section at the viewport middle as of the last scroll, in the layout on screen. */
  let focused: Pinned | null = null
  const stopPanels = new Map<HTMLVideoElement, () => void>()

  // Gated on `paused`, which starts true under reduced motion, so a clip plays only once it may.
  const play = (video: HTMLVideoElement | null) =>
    video && !paused ? playWhenVisible(video, { reducedMotion: false, observe }) : () => {}

  const showStage = (group: StageGroup) => {
    const index = group.section
    if (index === group.shown) return
    group.shown = index
    group.stop()
    // Stacked images would all load at once, so only the ones a scroll can show next load,
    // ready before the crossfade reaches them.
    group.images.forEach((images, i) => {
      if (Math.abs(i - index) > 1) return
      for (const el of images) {
        const { src, srcset } = el.dataset
        if (srcset && !el.hasAttribute('srcset')) el.srcset = srcset
        if (src && el instanceof HTMLImageElement && !el.hasAttribute('src')) el.src = src
      }
    })
    // Stacked captures are all rendered, so only the active one is exposed to assistive tech.
    group.items.forEach((item, i) => {
      item.toggleAttribute('data-active', i === index)
      if (i === index) item.removeAttribute('aria-hidden')
      else item.setAttribute('aria-hidden', 'true')
    })
    group.videos.forEach((video, i) => {
      if (video) video.preload = i === index && !paused ? 'auto' : 'none'
    })
    group.stop = play(group.videos[index])
  }

  const measureStages = () => {
    for (const group of groups) {
      group.section = activeIndex(
        group.steps.map((step) => step.getBoundingClientRect().top),
        win.innerHeight / 2,
      )
      showStage(group)
    }
  }

  const draw = (p: Pinned, animate: boolean) => {
    const label = p.bullets[p.active]
    if (!p.svg || !p.stack || !label) return
    const box = p.svg.getBoundingClientRect()
    const lines = lineBoxes(label)
    const middle = (lines[0].top + lines.at(-1)!.bottom) / 2 - box.top
    const widest = Math.max(
      ...p.bullets.flatMap((bullet) => lineBoxes(bullet).map((rect) => rect.right)),
    )
    const phone = p.stack.getBoundingClientRect()
    const margin = phone.height * PHONE_MARGIN
    // The nearest point on the phone's edge, so the arrow runs level with its bullet.
    const landing = Math.min(
      phone.top + phone.height - margin - box.top,
      Math.max(phone.top + margin - box.top, middle),
    )
    const { line, head } = connectorPath(
      { x: widest - box.left + GATE_CLEARANCE, y: middle },
      { x: phone.left - box.left - PHONE_GAP, y: landing },
      variantFor(p.id, p.active),
    )
    const path = (d: string, name: string) => {
      const el = doc.createElementNS(SVG_NS, 'path')
      el.setAttribute('d', d)
      if (name) el.setAttribute('class', name)
      return el
    }
    const stroke = path(line, animate ? 'draw' : '')
    // A unit length lets the stroke animation run in CSS without measuring the path.
    stroke.setAttribute('pathLength', '1')
    p.svg.replaceChildren(stroke, path(head, animate ? 'head' : ''))
  }

  const renderPinned = (p: Pinned, animate: boolean) => {
    const index = p.active
    p.stop()
    const video = p.videos[index]
    // The arriving clip starts from its first frame, so its one action reads from the start.
    if (video && index !== p.shown) video.currentTime = 0
    p.shown = index
    p.phones.forEach((phone, i) => {
      const position = stackClasses(i, index)
      phone.classList.toggle('is-before', position === 'is-before')
      phone.classList.toggle('is-active', position === 'is-active')
      if (position === 'is-active') phone.removeAttribute('aria-hidden')
      else phone.setAttribute('aria-hidden', 'true')
    })
    for (const [i, el] of [...p.bullets.entries(), ...p.marks.entries()]) {
      if (i === index) el.setAttribute('aria-current', 'true')
      else el.removeAttribute('aria-current')
    }
    p.videos.forEach((clip, i) => {
      if (clip) clip.preload = i === index && !paused ? 'auto' : 'none'
    })
    p.stop = play(video)
    draw(p, animate && !reducedMotion)
  }

  const onPick = (event: Event) => {
    const target = event.currentTarget as HTMLElement
    const p = pinned.find(
      (section) =>
        section.bullets.includes(target) || section.marks.includes(target as HTMLButtonElement),
    )
    if (!p) return
    const index = Math.max(p.bullets.indexOf(target), p.marks.indexOf(target as HTMLButtonElement))
    p.runway?.go(index)
    // Only a pick announces: a scroll change would talk over the copy being read.
    const described = describe(p.phones[index])
    if (live && described) live.textContent = described
  }

  // Plays every panel clip below the breakpoint and stops them all above it.
  const syncPanels = () => {
    for (const video of panelVideos) {
      const wanted = !desktop && !paused
      const stop = stopPanels.get(video)
      if (wanted && !stop) stopPanels.set(video, play(video))
      if (!wanted && stop) {
        stop()
        stopPanels.delete(video)
      }
    }
  }

  const findFocused = () => {
    const middle = win.innerHeight / 2
    focused =
      pinned.find((p) => {
        const box = p.section.getBoundingClientRect()
        return box.top <= middle && box.bottom >= middle
      }) ?? null
  }

  const measure = () => {
    pending = false
    if (desktop) measureStages()
    findFocused()
  }

  const onScroll = () => {
    if (pending) return
    pending = true
    frame(measure)
  }

  const onResize = () => {
    onScroll()
    frame(() => {
      if (desktop) for (const p of pinned) draw(p, false)
    })
  }

  const setup = () => {
    desktop = media.matches
    // Crossing the breakpoint keeps the visitor in the section they were reading, on the same
    // bullet, wherever the browser's own scroll adjustment for the new layout put them.
    const crossing = layout !== null && layout !== (desktop ? 'desktop' : 'mobile')
    const kept = crossing ? focused : null
    win.addEventListener('scroll', onScroll, { passive: true })
    if (desktop) {
      win.addEventListener('resize', onResize)
      for (const group of groups) group.shown = -1
      measureStages()
      for (const p of pinned) {
        p.bullets = p.bullets.map((bullet) => swapBullet(bullet, 'button'))
        for (const el of [...p.bullets, ...p.marks]) el.addEventListener('click', onPick)
        p.marksBox?.removeAttribute('hidden')
        if (!p.runwayEl) continue
        p.runway = mountRunway(p.runwayEl, {
          count: p.phones.length,
          reducedMotion,
          enabled: () => desktop,
          initial: p === kept ? p.active : undefined,
          onChange: (index, previous) => {
            p.active = index
            renderPinned(p, previous !== -1)
          },
        })
      }
      // Text set in a web font that is still loading measures wider or narrower than it ends up.
      void doc.fonts?.ready.then(() => {
        if (desktop) for (const p of pinned) draw(p, false)
      })
    } else {
      if (kept) {
        const box = kept.section.getBoundingClientRect()
        const middle = win.innerHeight / 2
        if (box.top > middle || box.bottom < middle) {
          win.scrollTo({ top: box.top + win.scrollY, behavior: 'instant' })
        }
      }
      for (const p of pinned) {
        // Only the section being read carries its bullet over; the others open at the start.
        if (crossing && p !== kept) p.active = 0
        p.carousel = mountCarousel(p.section, {
          start: p.active,
          // A clip arriving with the layout starts from its first frame, as on every card change.
          shown: crossing ? -1 : p.cardShown,
          reducedMotion,
          play,
          paused,
          settle: opts.settle,
          onShow: (index) => {
            p.active = index
            p.cardShown = index
          },
          onPick: (card) => {
            const described = describe(card)
            if (live && described) live.textContent = described
          },
        })
      }
    }
    layout = desktop ? 'desktop' : 'mobile'
    findFocused()
    syncPanels()
  }

  const teardown = () => {
    const wasDesktop = desktop
    desktop = false
    win.removeEventListener('scroll', onScroll)
    win.removeEventListener('resize', onResize)
    for (const group of groups) {
      group.stop()
      group.stop = () => {}
      group.shown = -1
      for (const video of group.videos) if (video) video.preload = 'none'
    }
    for (const p of pinned) {
      p.runway?.dispose()
      p.runway = undefined
      p.stop()
      p.stop = () => {}
      for (const video of p.videos) if (video) video.preload = 'none'
      p.svg?.replaceChildren()
      if (wasDesktop) {
        for (const el of [...p.bullets, ...p.marks]) el.removeEventListener('click', onPick)
        p.bullets = p.bullets.map((bullet) => swapBullet(bullet, 'span'))
      }
      p.marksBox?.setAttribute('hidden', '')
      p.carousel?.()
      p.carousel = undefined
    }
    for (const stop of stopPanels.values()) stop()
    stopPanels.clear()
  }

  const cardMarks = (p: Pinned) => [
    ...p.section.querySelectorAll<HTMLButtonElement>('[data-card-mark]'),
  ]

  const spotOf = (el: EventTarget | null): FocusSpot | null => {
    for (const p of pinned) {
      for (const controls of [p.bullets, p.marks, cardMarks(p)]) {
        const index = (controls as EventTarget[]).indexOf(el as EventTarget)
        if (index >= 0) return { section: p.section, index }
      }
    }
    return null
  }

  // The new layout's styles can hide the focused control before the change event arrives, and
  // the browser then moves focus to the body, so the last control focused is kept until focus
  // goes elsewhere or leaves a control that is still on screen.
  let lastSpot: FocusSpot | null = null
  const onFocusIn = (event: Event) => {
    lastSpot = spotOf(event.target)
  }
  const onFocusOut = (event: Event) => {
    const el = event.target as Element
    if (el.isConnected && el.getClientRects().length > 0) lastSpot = null
  }

  const focusSpot = (): FocusSpot | null => {
    const el = doc.activeElement
    if (el && el !== doc.body) return spotOf(el)
    return lastSpot
  }

  // A layout change removes or hides the focused control, which would drop a keyboard visitor
  // back at the top of the page, so the same bullet's control in the new layout takes focus.
  const restoreFocus = (spot: FocusSpot | null) => {
    const p = spot && pinned.find((section) => section.section === spot.section)
    if (!p || !spot) return
    const target = desktop ? p.bullets[spot.index] : cardMarks(p)[spot.index]
    target?.focus({ preventScroll: true })
  }

  const onChange = () => {
    const spot = focusSpot()
    teardown()
    setup()
    restoreFocus(spot)
  }

  const onToggle = () => {
    paused = !paused
    for (const toggle of toggles) toggle.textContent = paused ? PLAY : PAUSE
    onChange()
  }

  for (const group of groups) group.stage?.toggleAttribute('data-crossfade', !reducedMotion)
  media.addEventListener('change', onChange)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  for (const toggle of toggles) {
    toggle.textContent = paused ? PLAY : PAUSE
    toggle.addEventListener('click', onToggle)
    toggle.hidden = false
  }
  setup()
  const handed = focusHandoff.get(root)
  focusHandoff.delete(root)
  if (handed && (!doc.activeElement || doc.activeElement === doc.body)) restoreFocus(handed)

  return () => {
    const spot = focusSpot()
    if (spot) focusHandoff.set(root, spot)
    media.removeEventListener('change', onChange)
    root.removeEventListener('focusin', onFocusIn)
    root.removeEventListener('focusout', onFocusOut)
    for (const toggle of toggles) toggle.removeEventListener('click', onToggle)
    for (const group of groups) group.stage?.removeAttribute('data-crossfade')
    teardown()
  }
}
