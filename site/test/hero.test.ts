// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { HERO_SCENES, mountHero } from '../src/scripts/heroScenes'
import {
  PAUSE,
  PLAY,
  followReducedMotion,
  playWhenVisible,
  type MediaQuery,
  type Observe,
} from '../src/scripts/playback'

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

let visibility: DocumentVisibilityState = 'visible'
let play: MockInstance<HTMLMediaElement['play']>
let pause: MockInstance<HTMLMediaElement['pause']>
const disposers: Array<() => void> = []
// Every mount is disposed after its test so no document listener outlives it.
const track = (dispose: () => void) => {
  disposers.push(dispose)
  return dispose
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const setVisibility = (value: DocumentVisibilityState) => {
  visibility = value
  document.dispatchEvent(new Event('visibilitychange'))
}

const playedBy = (video: HTMLVideoElement) => play.mock.contexts.filter((c) => c === video).length

describe('playWhenVisible', () => {
  let video: HTMLVideoElement
  beforeEach(() => {
    document.body.innerHTML = `<video data-src="/clip.mp4" preload="none" loop muted></video>`
    video = document.querySelector('video')!
  })

  it('assigns src from data-src and plays only once on screen', () => {
    const io = fakeObserver()
    track(playWhenVisible(video, { reducedMotion: false, observe: io.observe }))
    expect(video.hasAttribute('src')).toBe(false)
    expect(play).not.toHaveBeenCalled()
    io.show(video)
    expect(video.getAttribute('src')).toBe('/clip.mp4')
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('pauses off screen and while the tab is hidden', () => {
    const io = fakeObserver()
    track(playWhenVisible(video, { reducedMotion: false, observe: io.observe }))
    io.show(video)
    io.show(video, false)
    expect(pause).toHaveBeenCalledTimes(1)
    io.show(video)
    setVisibility('hidden')
    expect(pause).toHaveBeenCalledTimes(2)
    setVisibility('visible')
    expect(play).toHaveBeenCalledTimes(3)
  })

  it('never plays or loads under reduced motion', () => {
    const io = fakeObserver()
    track(playWhenVisible(video, { reducedMotion: true, observe: io.observe }))
    io.show(video)
    expect(play).not.toHaveBeenCalled()
    expect(video.hasAttribute('src')).toBe(false)
  })

  it('stops watching and pauses when disposed', () => {
    const io = fakeObserver()
    const dispose = track(playWhenVisible(video, { reducedMotion: false, observe: io.observe }))
    io.show(video)
    dispose()
    expect(io.watchers.size).toBe(0)
    expect(pause).toHaveBeenCalled()
    setVisibility('hidden')
    setVisibility('visible')
    expect(play).toHaveBeenCalledTimes(1)
  })
})

describe('mountHero', () => {
  const saved = (['innerHeight', 'innerWidth', 'scrollY'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
  )
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(window, key, descriptor)
    }
  })
  const VIEWPORT = 1000
  const STEP = 700
  const RUNWAY_TOP = 800
  let root: HTMLElement
  let runway: HTMLElement
  let items: HTMLElement[]
  let videos: HTMLVideoElement[]
  let buttons: HTMLButtonElement[]
  let toggle: HTMLButtonElement
  let scrollTo: MockInstance<typeof window.scrollTo>
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    document.body.innerHTML = `
      <section data-hero>
        <div data-runway style="--n: 3">
          <div data-stack>
            ${HERO_SCENES.map(
              (
                s,
                i,
              ) => `<div class="stack-item ${i ? '' : 'is-active'}" data-stack-item ${i ? 'aria-hidden="true"' : ''}>
                <video data-capture="${s.name}" data-src="/${s.name}.mp4" aria-label="${s.alt}" preload="none" loop muted></video>
              </div>`,
            ).join('')}
          </div>
          <div data-scene-picker hidden>
            ${HERO_SCENES.map((s, i) => `<button type="button" aria-pressed="${i === 0}">${s.label}</button>`).join('')}
          </div>
          <button type="button" data-scene-toggle hidden>${PAUSE}</button>
        </div>
      </section>`
    root = document.querySelector('[data-hero]')!
    runway = root.querySelector('[data-runway]')!
    items = [...root.querySelectorAll<HTMLElement>('[data-stack-item]')]
    videos = [...root.querySelectorAll('video')]
    buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-scene-picker] button')]
    toggle = root.querySelector('[data-scene-toggle]')!

    runway.getBoundingClientRect = () =>
      ({ top: RUNWAY_TOP - window.scrollY, height: VIEWPORT + 2 * STEP }) as DOMRect
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    frames = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  const scrollToStep = (step: number) => {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: RUNWAY_TOP + step * STEP,
    })
    window.dispatchEvent(new Event('scroll'))
    for (const frame of frames.splice(0)) frame(0)
  }
  const classes = () =>
    items.map((item) =>
      item.classList.contains('is-active')
        ? 'active'
        : item.classList.contains('is-before')
          ? 'before'
          : 'after',
    )
  const hidden = () => items.map((item) => item.getAttribute('aria-hidden') === 'true')
  const pressed = () => buttons.map((b) => b.getAttribute('aria-pressed'))

  it('reveals the switcher and the pause button', () => {
    track(mountHero(root, { reducedMotion: false, observe: fakeObserver().observe }))
    expect(root.querySelector('[data-scene-picker]')!.hasAttribute('hidden')).toBe(false)
    expect(toggle.hasAttribute('hidden')).toBe(false)
  })

  it('plays only the first scene, looping, from the top of the runway', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: false, observe: io.observe }))
    expect(classes()).toEqual(['active', 'after', 'after'])
    expect(hidden()).toEqual([false, true, true])
    expect([...io.watchers.keys()]).toEqual([videos[0]])
    io.show(videos[0])
    expect(playedBy(videos[0])).toBe(1)
    expect(videos[0].loop).toBe(true)
    expect(videos[0].preload).toBe('auto')
    expect(videos[1].hasAttribute('src')).toBe(false)
  })

  it('steps through the scenes by scrolling, earlier phones above and later ones below', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: false, observe: io.observe }))
    io.show(videos[0])
    videos[2].currentTime = 5

    scrollToStep(2)
    expect(pressed()).toEqual(['false', 'false', 'true'])
    expect(classes()).toEqual(['before', 'before', 'active'])
    expect(hidden()).toEqual([true, true, false])
    expect(videos[2].currentTime).toBe(0)
    expect(videos[0].preload).toBe('none')
    expect(pause.mock.contexts).toContain(videos[0])
    expect([...io.watchers.keys()]).toEqual([videos[2]])
    io.show(videos[2])
    expect(playedBy(videos[2])).toBe(1)
    expect(videos[2].getAttribute('src')).toBe(`/${HERO_SCENES[2].name}.mp4`)
    expect(videos[1].hasAttribute('src')).toBe(false)

    scrollToStep(1)
    expect(pressed()).toEqual(['false', 'true', 'false'])
    expect(classes()).toEqual(['before', 'active', 'after'])
  })

  it('shows the scene for the scroll position it mounts at', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + STEP })
    track(mountHero(root, { reducedMotion: false, observe: fakeObserver().observe }))
    expect(pressed()).toEqual(['false', 'true', 'false'])
    expect(classes()).toEqual(['before', 'active', 'after'])
  })

  it("scrolls to a tab's stop when pressed", () => {
    track(mountHero(root, { reducedMotion: false, observe: fakeObserver().observe }))
    buttons[2].click()
    expect(scrollTo).toHaveBeenCalledWith({ top: RUNWAY_TOP + 2 * STEP, behavior: 'smooth' })
  })

  it('switches scenes from the tabs when there is no runway to scroll', () => {
    runway.replaceWith(...runway.children)
    track(mountHero(root, { reducedMotion: false, observe: fakeObserver().observe }))
    buttons[1].click()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(pressed()).toEqual(['false', 'true', 'false'])
    expect(classes()).toEqual(['before', 'active', 'after'])
  })

  it('never advances when a clip ends', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: false, observe: io.observe }))
    io.show(videos[0])
    videos[0].dispatchEvent(new Event('ended'))
    expect(pressed()).toEqual(['true', 'false', 'false'])
    expect(classes()).toEqual(['active', 'after', 'after'])
    expect(toggle.textContent).toBe(PAUSE)
  })

  it('keeps stepping by scroll on a narrow screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /max-width/.test(query),
      media: query,
    }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    track(mountHero(root, { reducedMotion: false, observe: fakeObserver().observe }))
    scrollToStep(1)
    expect(pressed()).toEqual(['false', 'true', 'false'])
  })

  it('pauses while the tab is hidden', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: false, observe: io.observe }))
    io.show(videos[0])
    pause.mockClear()
    setVisibility('hidden')
    expect(pause.mock.contexts).toContain(videos[0])
  })

  it('toggles pause and play, naming the button for what it does next, across scenes', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: false, observe: io.observe }))
    io.show(videos[0])
    toggle.click()
    expect(toggle.textContent).toBe(PLAY)
    expect(pause.mock.contexts).toContain(videos[0])
    scrollToStep(1)
    expect(io.watchers.size).toBe(0)

    toggle.click()
    expect(toggle.textContent).toBe(PAUSE)
    io.show(videos[1])
    expect(playedBy(videos[1])).toBe(1)
  })

  it('plays nothing under reduced motion until asked, and scrolling swaps posters', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: true, observe: io.observe }))
    expect(toggle.textContent).toBe(PLAY)
    expect(io.watchers.size).toBe(0)
    scrollToStep(1)
    expect(classes()).toEqual(['before', 'active', 'after'])
    expect(play).not.toHaveBeenCalled()
    expect(videos[1].hasAttribute('src')).toBe(false)

    toggle.click()
    io.show(videos[1])
    expect(playedBy(videos[1])).toBe(1)
    expect(toggle.textContent).toBe(PAUSE)
  })

  it('jumps to a stop without smooth scrolling under reduced motion', () => {
    track(mountHero(root, { reducedMotion: true, observe: fakeObserver().observe }))
    buttons[1].click()
    expect(scrollTo).toHaveBeenCalledWith({ top: RUNWAY_TOP + STEP, behavior: 'auto' })
  })

  it('stops at the end of a clip under reduced motion', () => {
    const io = fakeObserver()
    track(mountHero(root, { reducedMotion: true, observe: io.observe }))
    toggle.click()
    io.show(videos[0])
    expect(videos[0].loop).toBe(false)
    videos[0].dispatchEvent(new Event('ended'))
    expect(classes()).toEqual(['active', 'after', 'after'])
    expect(toggle.textContent).toBe(PLAY)
  })

  it('stops listening to scroll, its buttons, and clips when disposed', () => {
    const io = fakeObserver()
    const dispose = mountHero(root, { reducedMotion: true, observe: io.observe })
    dispose()
    buttons[1].click()
    toggle.click()
    videos[0].dispatchEvent(new Event('ended'))
    scrollToStep(2)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(classes()).toEqual(['active', 'after', 'after'])
    expect(toggle.textContent).toBe(PLAY)
    expect(io.watchers.size).toBe(0)
  })
})

describe('followReducedMotion', () => {
  function fakeQuery(matches: boolean) {
    const listeners = new Set<() => void>()
    const query: MediaQuery = {
      matches,
      addEventListener: (_type: 'change', fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: 'change', fn: () => void) => listeners.delete(fn),
    }
    const flip = (next: boolean) => {
      query.matches = next
      for (const fn of listeners) fn()
    }
    return { query, flip, listeners }
  }

  it('mounts with the current setting and mounts again when it changes', () => {
    const { query, flip } = fakeQuery(false)
    const mounts: boolean[] = []
    const disposed: boolean[] = []
    track(
      followReducedMotion(query, (reducedMotion) => {
        mounts.push(reducedMotion)
        return () => disposed.push(reducedMotion)
      }),
    )
    flip(true)
    expect(mounts).toEqual([false, true])
    expect(disposed).toEqual([false])
  })

  it('stops following and disposes the last mount when disposed', () => {
    const { query, flip, listeners } = fakeQuery(true)
    const disposed: boolean[] = []
    const dispose = followReducedMotion(
      query,
      (reducedMotion) => () => disposed.push(reducedMotion),
    )
    dispose()
    flip(false)
    expect(disposed).toEqual([true])
    expect(listeners.size).toBe(0)
  })
})
