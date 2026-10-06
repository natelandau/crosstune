/** The clip a scroll position lands on: nearest step, clamped to the clips that exist. */
export function activeStep(traveled: number, stepPx: number, count: number): number {
  if (count <= 1 || stepPx <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(traveled / stepPx)))
}

/** Phones before the active one wait above it, phones after it wait below. */
export function stackClasses(index: number, active: number): 'is-before' | 'is-active' | '' {
  if (index < active) return 'is-before'
  return index === active ? 'is-active' : ''
}

export type RunwayOptions = {
  count: number
  /** `previous` is -1 for the first sync on mount, and for the first sync after being disabled. */
  onChange: (index: number, previous: number) => void
  reducedMotion: boolean
  /** False while another layout owns the section, so scrolling does not drive it. */
  enabled: () => boolean
  /**
   * A clip to open on: mounting jumps to its stop instead of reading the clip from the scroll
   * position, so a layout change keeps the clip the visitor was on.
   */
  initial?: number
}

export type Runway = {
  /** Scrolls to clip `i`'s stop, clamped to the runway. */
  go(i: number): void
  /** Re-reads the scroll position and `enabled()`, for a caller that knows either changed. */
  refresh(): void
  dispose(): void
}

// Runways that hold the scroll position, from their first stop to their last. Root snapping is
// on only while one does, so the page rests wherever it is put outside a runway.
const holding = new Set<object>()

/** The keys that scroll the page, and which way: -1 up, 1 down. */
const SCROLL_KEYS: Record<string, number> = {
  ArrowUp: -1,
  PageUp: -1,
  Home: -1,
  ArrowDown: 1,
  PageDown: 1,
  End: 1,
  ' ': 1,
}

function hold(key: object, inside: boolean) {
  if (inside) holding.add(key)
  else holding.delete(key)
  document.documentElement.toggleAttribute('data-snap', holding.size > 0)
}

/**
 * Drive the active clip from scroll position through a runway with a sticky `.pinned` child,
 * reporting the child's height to the runway's CSS as `--pinned-h`.
 */
export function mountRunway(root: HTMLElement, opts: RunwayOptions): Runway {
  const pinned = root.querySelector<HTMLElement>(':scope > .pinned')
  const pinnedHeight = () => (pinned ? pinned.getBoundingClientRect().height : window.innerHeight)
  // The sticky `top`, which the CSS may set from the block's height to center it.
  const stickyTop = () => (pinned ? Number.parseFloat(getComputedStyle(pinned).top) || 0 : 0)
  // Where the page has scrolled to when the block sticks, and the first clip shows.
  const start = () => root.getBoundingClientRect().top + window.scrollY - stickyTop()
  // Measured rather than taken from the CSS step: on mobile, innerHeight and the CSS vh the
  // runway was laid out with differ as the browser's toolbars come and go.
  const stepPx = () =>
    opts.count > 1 ? (root.getBoundingClientRect().height - pinnedHeight()) / (opts.count - 1) : 0
  const snaps = [...root.querySelectorAll<HTMLElement>(':scope > .snap')]
  let current = -1
  let frame = 0
  let placed = ''
  let reported = Number.NaN
  const key = {}
  // Where the last sync found the page, so an input handler can tell which stop it is on
  // without reading layout.
  let traveled = Number.NaN
  let last = 0
  // Set by an input pointing out of the runway from an edge stop, until the page is back between
  // the stops or an input points inward.
  let released = false

  const reportHeight = () => {
    if (!pinned) return
    const height = pinnedHeight()
    if (height === reported) return
    reported = height
    root.style.setProperty('--pinned-h', `${height}px`)
  }

  // The CSS places snap points at multiples of 70vh from the runway's top; moved to where the
  // block sticks for each clip, so a scroll to a stop and the snap that catches it agree.
  const placeSnaps = (step: number, offset: number) => {
    const key = `${step} ${offset}`
    if (key === placed) return
    placed = key
    for (const [i, snap] of snaps.entries()) {
      snap.style.top = `${i * Math.max(0, step) - offset}px`
    }
  }

  const sync = () => {
    frame = 0
    if (!opts.enabled()) {
      current = -1
      hold(key, false)
      return
    }
    reportHeight()
    const step = stepPx()
    placeSnaps(step, stickyTop())
    traveled = window.scrollY - start()
    last = (opts.count - 1) * step
    // A pixel of slack, since a stop can land a fraction of a pixel off.
    if (traveled > 1 && traveled < last - 1) released = false
    hold(key, holds())
    const next = activeStep(traveled, step, opts.count)
    if (next === current) return
    const previous = current
    current = next
    opts.onChange(next, previous)
  }
  const holds = () =>
    !opts.reducedMotion &&
    !released &&
    opts.count > 1 &&
    opts.enabled() &&
    traveled >= -1 &&
    traveled <= last + 1

  // On an edge stop, snapping would catch a short scroll out of the runway and pull it back, so
  // an input pointing out turns it off before the browser scrolls; one pointing in, or in the
  // middle, keeps it, so one flick still reaches the next stop. Snapping stays on at rest on an
  // edge stop, because turning it on partway through a flick inward snaps back to that stop.
  const steer = (direction: number) => {
    if (!direction) return
    released =
      (direction < 0 && Math.abs(traveled) <= 1) ||
      (direction > 0 && Math.abs(traveled - last) <= 1)
    hold(key, holds())
  }
  const onWheel = (event: WheelEvent) => steer(Math.sign(event.deltaY))
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return
    // Space presses a focused control instead of scrolling.
    if (event.key === ' ' && target?.closest?.('button, a, summary')) return
    const direction = SCROLL_KEYS[event.key]
    if (direction) steer(event.key === ' ' && event.shiftKey ? -1 : direction)
  }
  let touchY = Number.NaN
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY ?? Number.NaN
  }
  // A finger moving down the screen scrolls the page up.
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY
    if (y === undefined || Number.isNaN(touchY)) return
    steer(Math.sign(touchY - y))
    touchY = y
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync)
  }

  const jumpToInitial = () => {
    if (opts.initial === undefined || !opts.enabled()) return
    const step = Math.max(0, stepPx())
    const target = Math.max(0, Math.min(opts.count - 1, opts.initial))
    const traveled = window.scrollY - start()
    // Already on the clip's stretch of the runway: no jump, so the visitor's place is kept.
    if (traveled >= 0 && activeStep(traveled, step, opts.count) === target) return
    window.scrollTo({ top: start() + target * step, behavior: 'instant' })
  }

  // The block's height changes without a resize too, as web fonts load and text rewraps.
  const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  if (pinned) resized?.observe(pinned)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: true })
  if (opts.enabled()) reportHeight()
  jumpToInitial()
  sync()

  return {
    go(i) {
      const step = Math.max(0, Math.min(opts.count - 1, i))
      window.scrollTo({
        top: start() + step * Math.max(0, stepPx()),
        behavior: opts.reducedMotion ? 'auto' : 'smooth',
      })
    },
    refresh() {
      if (frame) cancelAnimationFrame(frame)
      sync()
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      resized?.disconnect()
      hold(key, false)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      root.style.removeProperty('--pinned-h')
    },
  }
}
