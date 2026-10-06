// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { activeStep, mountRunway, stackClasses } from '../src/scripts/runway'

const VIEWPORT = 1000
const STEP = 700
const RUNWAY_TOP = 500

describe('activeStep', () => {
  it('rounds travel to the nearest step and clamps', () => {
    expect(activeStep(0, 600, 3)).toBe(0)
    expect(activeStep(420, 600, 3)).toBe(1)
    expect(activeStep(1300, 600, 3)).toBe(2)
    expect(activeStep(5000, 600, 3)).toBe(2)
    expect(activeStep(-50, 600, 3)).toBe(0)
  })

  it('stays on the only clip of a one-clip runway', () => {
    expect(activeStep(0, 0, 1)).toBe(0)
    expect(activeStep(300, 0, 1)).toBe(0)
  })
})

describe('stackClasses', () => {
  it('puts earlier phones above, the active one in view, later ones below', () => {
    expect(stackClasses(0, 1)).toBe('is-before')
    expect(stackClasses(1, 1)).toBe('is-active')
    expect(stackClasses(2, 1)).toBe('')
  })
})

describe('mountRunway', () => {
  let root: HTMLElement
  let scrollTo: MockInstance<typeof window.scrollTo>
  let runwayHeight: number
  let frames: FrameRequestCallback[]
  const disposers: Array<() => void> = []
  const mount = (opts: Partial<Parameters<typeof mountRunway>[1]> = {}) => {
    const onChange = vi.fn()
    const runway = mountRunway(root, {
      count: 3,
      onChange,
      reducedMotion: false,
      enabled: () => true,
      ...opts,
    })
    disposers.push(runway.dispose)
    return { runway, onChange }
  }
  const flush = () => {
    for (const frame of frames.splice(0)) frame(0)
  }
  const scrollTop = (y: number) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
    window.dispatchEvent(new Event('scroll'))
    flush()
  }

  const saved = (['innerHeight', 'scrollY'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
  )

  beforeEach(() => {
    root = document.createElement('section')
    root.innerHTML = '<div class="snap"></div><div class="snap"></div><div class="snap"></div>'
    document.body.append(root)
    runwayHeight = VIEWPORT + 2 * STEP
    root.getBoundingClientRect = () =>
      ({ top: RUNWAY_TOP - window.scrollY, height: runwayHeight }) as DOMRect
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    frames = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    vi.restoreAllMocks()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(window, key, descriptor)
    }
    root.remove()
  })

  it('syncs to the scroll position on mount', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + STEP })
    const { onChange } = mount()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1, -1)
  })

  it('reports the previous step when scrolling back up', () => {
    const { onChange } = mount()
    scrollTop(RUNWAY_TOP + 2 * STEP)
    scrollTop(RUNWAY_TOP + STEP)
    expect(onChange).toHaveBeenLastCalledWith(1, 2)
  })

  it('measures its step from the rendered runway, not the viewport', () => {
    // A mobile browser's innerHeight can differ from the CSS vh the runway was laid out with.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    const { onChange } = mount()
    // (2400 - 900) / 2 = 750 per step, so 360 in rounds to the first stop and 380 to the second.
    scrollTop(RUNWAY_TOP + 360)
    expect(onChange).toHaveBeenLastCalledWith(0, -1)
    scrollTop(RUNWAY_TOP + 380)
    expect(onChange).toHaveBeenLastCalledWith(1, 0)
  })

  it('handles a runway with one clip', () => {
    runwayHeight = VIEWPORT
    const { runway, onChange } = mount({ count: 1 })
    scrollTop(RUNWAY_TOP + 300)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0, -1)
    runway.go(0)
    expect(scrollTo).toHaveBeenCalledWith({ top: RUNWAY_TOP, behavior: 'smooth' })
  })

  it('coalesces scroll events into one sync per frame', () => {
    const { onChange } = mount()
    onChange.mockClear()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + STEP })
    window.dispatchEvent(new Event('scroll'))
    Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + 2 * STEP })
    window.dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    flush()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2, 0)
  })

  it('stays quiet while the step is unchanged or the layout is disabled', () => {
    let enabled = true
    const { onChange } = mount({ enabled: () => enabled })
    onChange.mockClear()
    scrollTop(RUNWAY_TOP + 10)
    expect(onChange).not.toHaveBeenCalled()
    enabled = false
    scrollTop(RUNWAY_TOP + 2 * STEP)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports its step again when refreshed after being enabled', () => {
    let enabled = false
    const { runway, onChange } = mount({ enabled: () => enabled })
    scrollTop(RUNWAY_TOP + STEP)
    expect(onChange).not.toHaveBeenCalled()
    enabled = true
    runway.refresh()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1, -1)
  })

  it('forgets its step while disabled, so enabling again reports it', () => {
    let enabled = true
    const { runway, onChange } = mount({ enabled: () => enabled })
    enabled = false
    runway.refresh()
    enabled = true
    runway.refresh()
    expect(onChange.mock.calls).toEqual([
      [0, -1],
      [0, -1],
    ])
  })

  it('re-syncs on resize', () => {
    const { onChange } = mount()
    onChange.mockClear()
    // A taller viewport shortens each step: (2400 - 1600) / 2 = 400.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1600 })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + 450 })
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1, 0)
  })

  const snapTops = () => [...root.querySelectorAll<HTMLElement>('.snap')].map((s) => s.style.top)

  it('puts each snap point at its stop, so a scroll to a stop is not nudged off it', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    const { runway } = mount()
    expect(snapTops()).toEqual(['0px', '750px', '1500px'])
    runway.go(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: RUNWAY_TOP + 1500, behavior: 'smooth' })
  })

  it('moves the snap points when a resize changes the step', () => {
    mount()
    expect(snapTops()).toEqual(['0px', '700px', '1400px'])
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1600 })
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(snapTops()).toEqual(['0px', '400px', '800px'])
  })

  it('scrolls to a step, smoothly unless motion is reduced', () => {
    mount().runway.go(2)
    expect(scrollTo).toHaveBeenCalledWith({ top: RUNWAY_TOP + 2 * STEP, behavior: 'smooth' })
    mount({ reducedMotion: true }).runway.go(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: RUNWAY_TOP + 2 * STEP, behavior: 'auto' })
  })

  it('clamps a step out of range to the runway', () => {
    const { runway } = mount()
    runway.go(7)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: RUNWAY_TOP + 2 * STEP, behavior: 'smooth' })
    runway.go(-1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: RUNWAY_TOP, behavior: 'smooth' })
  })

  describe('sized to a pinned block shorter than the viewport', () => {
    const PINNED = 600
    const OFFSET = 150
    // The block sticks once the page has scrolled to `RUNWAY_TOP - OFFSET`.
    const START = RUNWAY_TOP - OFFSET
    let pinned: HTMLElement

    beforeEach(() => {
      pinned = document.createElement('div')
      pinned.className = 'pinned'
      pinned.style.top = `${OFFSET}px`
      pinned.getBoundingClientRect = () => ({ height: PINNED }) as DOMRect
      root.prepend(pinned)
      // What the CSS lays out once the script reports the block's height.
      runwayHeight = PINNED + 2 * STEP
    })

    it("reports the pinned block's height for the runway's CSS, and clears it when disposed", () => {
      const { runway } = mount()
      expect(root.style.getPropertyValue('--pinned-h')).toBe(`${PINNED}px`)
      runway.dispose()
      expect(root.style.getPropertyValue('--pinned-h')).toBe('')
    })

    it('steps by the runway left past the pinned block, from where the block sticks', () => {
      const { onChange } = mount()
      scrollTop(START + STEP / 2 + 10)
      expect(onChange).toHaveBeenLastCalledWith(1, 0)
      scrollTop(START + 2 * STEP)
      expect(onChange).toHaveBeenLastCalledWith(2, 1)
      scrollTop(START - 200)
      expect(onChange).toHaveBeenLastCalledWith(0, 2)
    })

    it('puts the snap points and the stops where the block sticks for each clip', () => {
      const { runway } = mount()
      const snaps = [...root.querySelectorAll<HTMLElement>('.snap')]
      expect(snaps.map((snap) => snap.style.top)).toEqual(
        [0, 1, 2].map((i) => `${i * STEP - OFFSET}px`),
      )
      runway.go(2)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: START + 2 * STEP, behavior: 'smooth' })
    })
  })

  describe('with an initial clip', () => {
    // A jump updates the scroll position at once, as an instant browser scroll does.
    const jumping = () =>
      scrollTo.mockImplementation((options) => {
        const { top } = options as ScrollToOptions
        Object.defineProperty(window, 'scrollY', { configurable: true, value: top })
      })

    it.each([
      ['while pinned', RUNWAY_TOP + 100],
      ['above the runway', RUNWAY_TOP - 300],
    ])('jumps to its stop when mounted %s, and reports it first', (_where, y) => {
      jumping()
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
      const { onChange } = mount({ initial: 2 })
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
        top: RUNWAY_TOP + 2 * STEP,
        behavior: 'instant',
      })
      expect(onChange.mock.calls).toEqual([[2, -1]])
    })

    it.each([
      ['on its stop', RUNWAY_TOP + STEP, 1],
      ['past the last stop', RUNWAY_TOP + 2 * STEP + 300, 2],
    ])('keeps the scroll position when already %s', (_where, y, initial) => {
      jumping()
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
      const { onChange } = mount({ initial })
      expect(scrollTo).not.toHaveBeenCalled()
      expect(onChange.mock.calls).toEqual([[initial, -1]])
    })
  })

  describe('root snapping', () => {
    const snapping = () => document.documentElement.hasAttribute('data-snap')

    it('is on from the first stop to the last, and off beyond them', () => {
      mount()
      expect(snapping()).toBe(false)
      scrollTop(RUNWAY_TOP)
      expect(snapping()).toBe(true)
      scrollTop(RUNWAY_TOP + STEP + 120)
      expect(snapping()).toBe(true)
      scrollTop(RUNWAY_TOP + 2 * STEP)
      expect(snapping()).toBe(true)
      scrollTop(RUNWAY_TOP + 2 * STEP + 100)
      expect(snapping()).toBe(false)
      scrollTop(RUNWAY_TOP - 100)
      expect(snapping()).toBe(false)
    })

    const wheel = (deltaY: number) => window.dispatchEvent(new WheelEvent('wheel', { deltaY }))
    const key = (k: string, target: EventTarget = document.body) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    const touch = (type: 'touchstart' | 'touchmove', clientY: number) =>
      window.dispatchEvent(Object.assign(new Event(type), { touches: [{ clientY }] }))

    it('turns off for a wheel pointing out of the runway from an edge stop', () => {
      mount()
      scrollTop(RUNWAY_TOP)
      wheel(40)
      expect(snapping()).toBe(true)
      wheel(-40)
      expect(snapping()).toBe(false)
      wheel(40)
      expect(snapping()).toBe(true)
      scrollTop(RUNWAY_TOP + 2 * STEP)
      wheel(-40)
      expect(snapping()).toBe(true)
      wheel(40)
      expect(snapping()).toBe(false)
    })

    it('stays on for a wheel either way from a middle stop', () => {
      mount()
      scrollTop(RUNWAY_TOP + STEP)
      wheel(-40)
      expect(snapping()).toBe(true)
      wheel(40)
      expect(snapping()).toBe(true)
    })

    it.each([
      ['ArrowUp', 0],
      ['PageUp', 0],
      ['Home', 0],
      ['ArrowDown', 2],
      ['PageDown', 2],
      ['End', 2],
      [' ', 2],
    ])('turns off for %j pressed on the stop it leads out of', (k, stop) => {
      mount()
      scrollTop(RUNWAY_TOP + stop * STEP)
      key(k)
      expect(snapping()).toBe(false)
    })

    it('ignores keys typed into a field, and Space pressing a button', () => {
      mount()
      const input = document.createElement('input')
      const button = document.createElement('button')
      root.append(input, button)
      scrollTop(RUNWAY_TOP)
      key('Home', input)
      expect(snapping()).toBe(true)
      scrollTop(RUNWAY_TOP + 2 * STEP)
      key(' ', button)
      expect(snapping()).toBe(true)
    })

    it('turns off for a touch dragging the page out of the runway', () => {
      mount()
      scrollTop(RUNWAY_TOP)
      touch('touchstart', 300)
      touch('touchmove', 280)
      expect(snapping()).toBe(true)
      // A finger moving down scrolls the page up, out past the first stop.
      touch('touchmove', 340)
      expect(snapping()).toBe(false)
    })

    it('turns on again once the scroll position is back between the stops', () => {
      mount()
      scrollTop(RUNWAY_TOP)
      wheel(-40)
      expect(snapping()).toBe(false)
      scrollTop(RUNWAY_TOP + 0.5)
      expect(snapping()).toBe(false)
      scrollTop(RUNWAY_TOP + 200)
      expect(snapping()).toBe(true)
    })

    it('stays on while any runway holds the scroll position', () => {
      mount()
      const other = document.createElement('section')
      other.innerHTML = '<div class="snap"></div><div class="snap"></div>'
      document.body.append(other)
      other.getBoundingClientRect = () =>
        ({ top: 5000 - window.scrollY, height: VIEWPORT + STEP }) as DOMRect
      disposers.push(
        mountRunway(other, {
          count: 2,
          onChange: () => {},
          reducedMotion: false,
          enabled: () => true,
        }).dispose,
      )
      scrollTop(RUNWAY_TOP + STEP)
      expect(snapping()).toBe(true)
      scrollTop(5000 + 300)
      expect(snapping()).toBe(true)
      scrollTop(3500)
      expect(snapping()).toBe(false)
      other.remove()
    })

    it('stays off with one clip, with reduced motion, and while disabled', () => {
      let enabled = true
      runwayHeight = VIEWPORT
      const single = mount({ count: 1 })
      scrollTop(RUNWAY_TOP)
      expect(snapping()).toBe(false)
      single.runway.dispose()
      runwayHeight = VIEWPORT + 2 * STEP
      const reduced = mount({ reducedMotion: true })
      scrollTop(RUNWAY_TOP + STEP)
      expect(snapping()).toBe(false)
      wheel(40)
      expect(snapping()).toBe(false)
      reduced.runway.dispose()
      const { runway } = mount({ enabled: () => enabled })
      expect(snapping()).toBe(true)
      enabled = false
      runway.refresh()
      expect(snapping()).toBe(false)
    })

    it('turns off when the runway holding the scroll position is disposed', () => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: RUNWAY_TOP + STEP })
      const { runway } = mount()
      expect(snapping()).toBe(true)
      runway.dispose()
      expect(snapping()).toBe(false)
    })
  })

  it('stops listening once disposed', () => {
    const { runway, onChange } = mount()
    onChange.mockClear()
    window.dispatchEvent(new Event('scroll'))
    runway.dispose()
    flush()
    scrollTop(RUNWAY_TOP + 2 * STEP)
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(onChange).not.toHaveBeenCalled()
  })
})
