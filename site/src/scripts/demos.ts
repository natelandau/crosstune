// Wires every demo panel on the page: scales each camera to its panel, plays a demo while it is
// in view and pauses it when it leaves, runs its pause and replay buttons, and drifts the five
// places together once. With reduced motion every demo shows its last frame and nothing moves.
import { fit } from '../demos/camera'
import { DEMOS, isDemoName } from '../demos/index'
import { PAUSE_ANIMATION, PLAY_ANIMATION } from '../demos/labels'
import { Demo } from '../demos/runner'

/** How much of a demo must show before it plays. */
const VISIBLE = 0.35

type Playable = { play(): void; pause(): void; userPaused: boolean }

export function mountDemos(
  root: ParentNode,
  { reducedMotion }: { reducedMotion: boolean },
): () => void {
  const listeners = new AbortController()
  const demos: Demo[] = []
  const byTarget = new Map<Element, Playable>()

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const demo = demos.find((d) => d.cam === entry.target)
      if (demo) demo.scale = fit(demo.cam)
    }
  })

  for (const panel of root.querySelectorAll<HTMLElement>('[data-demo]')) {
    const name = panel.dataset.demo ?? ''
    const cam = panel.querySelector<HTMLElement>('.cam')
    const stage = cam?.querySelector<HTMLElement>('.stage')
    if (!isDemoName(name) || !cam || !stage) continue
    const def = DEMOS[name]
    const demo = new Demo(stage, def, reducedMotion)
    demo.scale = fit(cam)
    cam.dataset.ready = ''
    demos.push(demo)
    resize.observe(cam)
    if (!def.script) continue

    const controls = panel.querySelector<HTMLElement>('.demo-ctl')
    if (controls && !reducedMotion) {
      const [toggle, replay] = controls.querySelectorAll('button')
      const use = toggle.querySelector('use')
      demo.onChange = () => {
        toggle.setAttribute('aria-label', demo.paused ? PLAY_ANIMATION : PAUSE_ANIMATION)
        use?.setAttribute('href', demo.paused ? '#i-play' : '#i-pause')
      }
      demo.onChange()
      toggle.addEventListener(
        'click',
        () => {
          demo.userPaused = !demo.paused
          if (demo.paused) demo.play()
          else demo.pause()
        },
        { signal: listeners.signal },
      )
      replay.addEventListener('click', () => demo.replay(), { signal: listeners.signal })
      controls.hidden = false
    }

    if (reducedMotion) void demo.run()
    else byTarget.set(cam, demo)
  }

  const places = root.querySelector<HTMLElement>('[data-places]')
  const scraps = places ? [...places.querySelectorAll<HTMLElement>('[data-from]')] : []
  if (places && !reducedMotion) {
    for (const s of scraps) {
      const [x, y, r] = (s.dataset.from ?? '0,0,0').split(',').map(Number)
      s.style.translate = `${x}px ${y}px`
      s.style.rotate = `${r}deg`
    }
    let done = false
    byTarget.set(places, {
      userPaused: false,
      play() {
        if (done) return
        done = true
        for (const s of scraps) {
          s.style.translate = ''
          s.style.rotate = ''
        }
      },
      pause() {},
    })
  }

  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = byTarget.get(entry.target)
        if (!target) continue
        if (entry.isIntersecting) {
          if (!target.userPaused) target.play()
        } else target.pause()
      }
    },
    { threshold: VISIBLE },
  )
  for (const target of byTarget.keys()) seen.observe(target)

  return () => {
    seen.disconnect()
    resize.disconnect()
    listeners.abort()
    for (const demo of demos) {
      demo.stop()
      demo.onChange = () => {}
    }
    for (const controls of root.querySelectorAll<HTMLElement>('[data-demo] .demo-ctl')) {
      controls.hidden = true
    }
    for (const s of scraps) {
      s.style.translate = ''
      s.style.rotate = ''
    }
  }
}
