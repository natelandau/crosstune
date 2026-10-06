// The hero phone's three scenes: which one shows as the visitor scrolls, and the controls that
// pick it.
import { PAUSE, PLAY, playWhenVisible, type Observe } from './playback'
import { mountRunway, stackClasses } from './runway'

export const HERO_SCENES = [
  {
    label: 'Find tunes',
    name: 'hero-jam',
    alt: 'Crosstune on iPhone: the D key filter narrows the tune list to Backstep Cindy, which opens and starts playing its recording.',
  },
  {
    label: 'Record',
    name: 'hero-record',
    alt: "Recording a take in Crosstune: the live waveform runs, then Stop, and the take is filed under Half Past Four, landing in that tune's recordings.",
  },
  {
    label: 'Practice',
    name: 'hero-home',
    alt: 'Practice mode on Bibb County Hoedown: the speed drops to 75%, a loop is dragged over the B part and named B part, and the playhead wraps back to its start.',
  },
] as const

export const SCENES_LABEL = 'Scenes'

export type SceneState = { index: number; paused: boolean }
export type SceneEvent = { pick: number } | 'pause' | 'play'

/** The scene after `event`. A pick keeps the pause state, so a paused hero stays paused. */
export function nextScene(s: SceneState, count: number, event: SceneEvent): SceneState {
  if (event === 'pause') return { ...s, paused: true }
  if (event === 'play') return { ...s, paused: false }
  if (event.pick < 0 || event.pick >= count) return s
  return { ...s, index: event.pick }
}

/**
 * Wires the hero's scenes to scroll through its runway, its tabs, and its pause button, the
 * controls `hidden` until now so a page without JavaScript shows only the first poster. Each scene
 * is a whole phone; only the active one is exposed to assistive tech and only its clip loads and
 * plays. Under reduced motion nothing plays until the visitor presses Play, and a clip stops at
 * its end. Returns a disposer.
 */
export function mountHero(
  root: HTMLElement,
  opts: { reducedMotion: boolean; observe?: Observe },
): () => void {
  const runwayEl = root.querySelector<HTMLElement>('[data-runway]')
  const items = [...root.querySelectorAll<HTMLElement>('[data-stack-item]')]
  const videos = items.map((item) => item.querySelector('video'))
  const picker = root.querySelector<HTMLElement>('[data-scene-picker]')
  const buttons = [...(picker?.querySelectorAll('button') ?? [])]
  const toggle = root.querySelector<HTMLButtonElement>('[data-scene-toggle]')
  const { reducedMotion } = opts

  let state: SceneState = { index: 0, paused: reducedMotion }
  let stopPlayback = () => {}

  const render = () => {
    stopPlayback()
    items.forEach((item, i) => {
      const position = stackClasses(i, state.index)
      item.classList.toggle('is-before', position === 'is-before')
      item.classList.toggle('is-active', position === 'is-active')
      if (position === 'is-active') item.removeAttribute('aria-hidden')
      else item.setAttribute('aria-hidden', 'true')
      buttons[i]?.setAttribute('aria-pressed', String(i === state.index))
      const video = videos[i]
      if (!video) return
      video.preload = i === state.index ? 'auto' : 'none'
      // Under reduced motion a clip plays once and stops, so its `ended` can pause the hero.
      video.loop = !reducedMotion
    })
    if (toggle) toggle.textContent = state.paused ? PLAY : PAUSE
    const video = videos[state.index]
    // Playback is gated on `paused`, which starts true under reduced motion, so a clip plays
    // here only once it may or the visitor asked.
    stopPlayback =
      video && !state.paused
        ? playWhenVisible(video, { reducedMotion: false, observe: opts.observe })
        : () => {}
  }

  const apply = (event: SceneEvent) => {
    const before = state.index
    state = nextScene(state, items.length, event)
    const video = videos[state.index]
    // The arriving clip starts from its first frame, so its one action reads from the start.
    if (video && state.index !== before) video.currentTime = 0
    render()
  }

  const runway = runwayEl
    ? mountRunway(runwayEl, {
        count: items.length,
        reducedMotion,
        enabled: () => true,
        onChange: (index, previous) => {
          if (previous === -1 && index === state.index) render()
          else apply({ pick: index })
        },
      })
    : undefined
  if (!runway) render()

  const onEnded = (e: Event) => {
    if (reducedMotion && e.target === videos[state.index]) apply('pause')
  }
  const onPick = (e: Event) => {
    const index = buttons.indexOf(e.currentTarget as HTMLButtonElement)
    if (index < 0) return
    if (runway) runway.go(index)
    else apply({ pick: index })
  }
  const onToggle = () => apply(state.paused ? 'play' : 'pause')

  for (const video of videos) video?.addEventListener('ended', onEnded)
  for (const button of buttons) button.addEventListener('click', onPick)
  toggle?.addEventListener('click', onToggle)
  picker?.removeAttribute('hidden')
  toggle?.removeAttribute('hidden')

  return () => {
    runway?.dispose()
    stopPlayback()
    for (const video of videos) video?.removeEventListener('ended', onEnded)
    for (const button of buttons) button.removeEventListener('click', onPick)
    toggle?.removeEventListener('click', onToggle)
  }
}
