// A bulleted feature section on a narrow screen: a sideways track of cards, one per bullet, with
// marks under it that scroll to a card, and only the card the track rests on playing.

/**
 * How long a track's scrolling stays still before the card it rests on starts playing, where the
 * browser does not report the end of a scroll.
 */
const SETTLE_MS = 120

export type CarouselOptions = {
  /** The card to open on; the track jumps there at once. */
  start: number
  /** The card whose clip is already cued, which resumes rather than restarting; -1 for none. */
  shown: number
  reducedMotion: boolean
  /** Plays a card's clip while it may play; returns a function that stops it. */
  play: (video: HTMLVideoElement | null) => () => void
  /** Whether clips are paused, which keeps every card's clip from preloading. */
  paused: boolean
  /** Runs `callback` once a track's scrolling pauses; returns its cancel function. */
  settle?: (callback: () => void) => () => void
  /** Called with each card shown, including the one opened on. */
  onShow: (index: number) => void
  /** Called with the card a mark moves to. */
  onPick: (card: HTMLElement) => void
}

/**
 * Mounts the carousel in `section`: reveals its marks and pause toggle, opens on `start`, and
 * follows the track. Returns a disposer that stops the clip and hides the controls again, or
 * nothing when the section has no track.
 */
export function mountCarousel(
  section: HTMLElement,
  opts: CarouselOptions,
): (() => void) | undefined {
  const win = section.ownerDocument.defaultView ?? window
  const track = section.querySelector<HTMLElement>('[data-track]')
  const cards = [...section.querySelectorAll<HTMLElement>('[data-card]')]
  if (!track || !cards.length) return undefined
  const videos = cards.map((card) => card.querySelector('video'))
  const marks = [...section.querySelectorAll<HTMLButtonElement>('[data-card-mark]')]
  const controls = section.querySelector<HTMLElement>('[data-carousel-controls]')
  const settle =
    opts.settle ??
    ((callback: () => void) => {
      const timer = win.setTimeout(callback, SETTLE_MS)
      return () => win.clearTimeout(timer)
    })

  let shown = opts.shown
  let stop = () => {}
  let cancelRead = () => {}

  /** How far the track scrolls to bring card `i` to its start. */
  const offset = (i: number) => cards[i].offsetLeft - cards[0].offsetLeft

  const show = (index: number) => {
    stop()
    const video = videos[index]
    if (video && index !== shown) video.currentTime = 0
    shown = index
    marks.forEach((mark, i) => {
      if (i === index) mark.setAttribute('aria-current', 'true')
      else mark.removeAttribute('aria-current')
    })
    videos.forEach((clip, i) => {
      if (clip) clip.preload = i === index && !opts.paused ? 'auto' : 'none'
    })
    stop = opts.play(video)
    opts.onShow(index)
  }

  // The card whose start is nearest the track's scroll position: the one it snapped to. The last
  // card can stop short of its start, and is still the nearest there.
  const read = () => {
    const left = track.scrollLeft
    let index = 0
    cards.forEach((_, i) => {
      if (Math.abs(offset(i) - left) < Math.abs(offset(index) - left)) index = i
    })
    if (index !== shown) show(index)
  }

  // Read once the track rests, so a swipe or a mark's smooth scroll across several cards never
  // starts the clips of the cards it passes: on `scrollend` where the browser has it, else once
  // the scroll events stop.
  const scrollEnd = 'onscrollend' in win
  const trackEvent = scrollEnd ? 'scrollend' : 'scroll'
  const onScroll = () => {
    if (scrollEnd) {
      read()
      return
    }
    cancelRead()
    cancelRead = settle(() => {
      cancelRead = () => {}
      read()
    })
  }

  const onPick = (event: Event) => {
    const index = marks.indexOf(event.currentTarget as HTMLButtonElement)
    track.scrollTo({ left: offset(index), behavior: opts.reducedMotion ? 'auto' : 'smooth' })
    opts.onPick(cards[index])
  }

  controls?.removeAttribute('hidden')
  track.addEventListener(trackEvent, onScroll, { passive: true })
  for (const mark of marks) mark.addEventListener('click', onPick)
  // An instant jump, so the carousel opens on its bullet.
  track.scrollLeft = offset(opts.start)
  show(opts.start)

  return () => {
    track.removeEventListener(trackEvent, onScroll)
    for (const mark of marks) mark.removeEventListener('click', onPick)
    stop()
    cancelRead()
    for (const video of videos) if (video) video.preload = 'none'
    controls?.setAttribute('hidden', '')
  }
}
