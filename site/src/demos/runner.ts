// Runs one demo's script against its stage: waits and tweens that pause with the demo, a pointer
// for desktop clicks and a ring for phone taps, and a loop that rebuilds the first frame.
import { place } from './camera'
import type { DemoDef } from './types'

const ABORT = Symbol('abort')

/** The one element `sel` matches inside `root`; a demo's markup always has it. */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`demo element missing: ${sel}`)
  return el
}

export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode): T[] => [
  ...root.querySelectorAll<T>(sel),
]

export class Demo {
  readonly stage: HTMLElement
  readonly cam: HTMLElement
  /** The scale the camera last applied, to turn screen pixels back into stage pixels. */
  scale = 1
  paused = true
  /** Set while the visitor has paused it, so scrolling it back into view does not resume it. */
  userPaused = false
  /** Reduced motion: every wait and tween finishes at once, leaving the last frame. */
  readonly instant: boolean
  cursor: HTMLElement | null = null
  onChange: () => void = () => {}
  private token = 0
  private started = false
  private timers = new Set<ReturnType<typeof setTimeout>>()
  /** Tweens parked while paused, so a paused demo schedules no frames. */
  private parked = new Set<() => void>()

  constructor(
    stage: HTMLElement,
    private readonly def: DemoDef,
    instant: boolean,
  ) {
    this.stage = stage
    this.cam = stage.parentElement as HTMLElement
    this.instant = instant
  }

  wait(ms: number): Promise<void> {
    return this.anim(ms, () => {})
  }

  /** Calls `fn` with eased progress from 0 to 1 over `ms` of unpaused time. */
  anim(ms: number, fn: (p: number) => void, ease: (x: number) => number = (x) => x): Promise<void> {
    const t = this.token
    if (this.instant) {
      fn(1)
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      let elapsed = 0
      let last = performance.now()
      const tick = (now: number) => {
        if (t !== this.token) return reject(ABORT)
        if (this.paused) {
          const resume = () => {
            last = performance.now()
            requestAnimationFrame(tick)
          }
          this.parked.add(resume)
          return
        }
        // A frame's timestamp can predate the `performance.now()` taken just before it.
        elapsed += Math.max(0, now - last)
        last = now
        const p = Math.min(1, elapsed / ms)
        fn(ease(p))
        if (p >= 1) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  /** The center of `el` in stage pixels. */
  pos(el: Element): { x: number; y: number } {
    const r = el.getBoundingClientRect()
    const sr = this.stage.getBoundingClientRect()
    return {
      x: (r.left + r.width / 2 - sr.left) / this.scale,
      y: (r.top + r.height / 2 - sr.top) / this.scale,
    }
  }

  /** Moves the pointer onto `el`, offset by `dx`, `dy` stage pixels. */
  async point(el: Element, dx = 0, dy = 0): Promise<void> {
    const c = this.cursor
    if (!c) return
    const p = this.pos(el)
    c.style.opacity = '1'
    c.style.transform = `translate(${p.x - 5 + dx}px, ${p.y - 4 + dy}px)`
    await this.wait(760)
  }

  /** Moves the pointer by `dx`, `dy` stage pixels from where it is. */
  nudge(dx: number, dy: number): void {
    const c = this.cursor
    if (!c) return
    c.style.transform = c.style.transform.replace(
      /translate\(([-\d.]+)px, ([-\d.]+)px\)/,
      (_, x: string, y: string) => `translate(${parseFloat(x) + dx}px, ${parseFloat(y) + dy}px)`,
    )
  }

  press(down: boolean): void {
    this.cursor?.classList.toggle('down', down)
  }

  async click(el: Element): Promise<void> {
    await this.point(el)
    if (!this.cursor) return
    this.press(true)
    await this.wait(170)
    this.press(false)
  }

  /** A touch ring on `el`, for phone screens, which have no pointer. */
  async tap(el: Element): Promise<void> {
    if (!this.instant) {
      const p = this.pos(el)
      const ring = document.createElement('div')
      ring.className = 'touch'
      ring.style.left = `${p.x}px`
      ring.style.top = `${p.y}px`
      this.stage.appendChild(ring)
      const timer = setTimeout(() => {
        ring.remove()
        this.timers.delete(timer)
      }, 700)
      this.timers.add(timer)
    }
    await this.wait(300)
  }

  async type(
    el: Element,
    text: string,
    per = 130,
    onChar?: (value: string) => void,
  ): Promise<void> {
    for (const ch of text) {
      el.textContent += ch
      onChar?.(el.textContent ?? '')
      await this.wait(per)
    }
  }

  /** Rebuilds the first frame and puts the pointer back at its resting place. */
  reset(): void {
    this.stage.innerHTML = this.def.markup()
    place(this.cam)
    this.cursor = null
    if (this.instant) return
    const cursor = document.createElement('div')
    cursor.className = 'cursor'
    cursor.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-cursor"/></svg>'
    cursor.style.transform = `translate(${this.stage.offsetWidth * 0.62}px, ${this.stage.offsetHeight * 0.92}px)`
    this.stage.appendChild(cursor)
    this.cursor = cursor
  }

  async run(): Promise<void> {
    const script = this.def.script
    if (!script) return
    const t = ++this.token
    try {
      do {
        this.reset()
        await this.wait(500)
        await script(this)
        if (this.instant) break
        await this.wait(1800)
        this.stage.classList.add('fading')
        await this.wait(380)
        this.stage.classList.remove('fading')
      } while (t === this.token)
    } catch (e) {
      if (e !== ABORT) throw e
    }
  }

  /** Restarts parked tweens; after a stop or replay they see the new token and abort. */
  private unpark(): void {
    const parked = [...this.parked]
    this.parked.clear()
    for (const resume of parked) resume()
  }

  play(): void {
    this.paused = false
    this.stage.classList.remove('paused')
    if (!this.started) {
      this.started = true
      void this.run()
    }
    this.unpark()
    this.onChange()
  }

  pause(): void {
    this.paused = true
    this.stage.classList.add('paused')
    this.onChange()
  }

  replay(): void {
    this.started = true
    this.userPaused = false
    this.paused = false
    this.stage.classList.remove('paused')
    void this.run()
    this.unpark()
    this.onChange()
  }

  /** Stops the script and its timers and leaves the first frame showing. */
  stop(): void {
    this.token++
    this.started = false
    this.paused = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.unpark()
    this.stage.classList.remove('paused', 'fading')
    this.stage.innerHTML = this.def.markup()
    place(this.cam)
    this.cursor = null
  }
}
