import {
  compensatedSemitones,
  formatTime,
  handleCaption,
  INITIAL_LOOP,
  LOADING_PITCH,
  LOOP_STEP,
  loopCaption,
  moveHandle,
  PAUSE,
  PITCH,
  PITCH_UNAVAILABLE,
  pitchCaption,
  PLAY,
  PLAYER_PROMPT,
  signed,
  SPEED,
  speedCaption,
  wrapTime,
  type Loop,
} from '../demos/practice'
import { createPitchStage, type PitchStage } from './pitchStage'

type Handle = 'a' | 'b'

export function mountPractice(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const audio = $<HTMLAudioElement>('[data-audio]')
  const track = $('[data-track]')
  const now = $('[data-now]')
  const play = $<HTMLButtonElement>('[data-play]')
  const loopButton = $<HTMLButtonElement>('[data-loop]')
  const speedInput = $<HTMLInputElement>('[data-speed]')
  const speedValue = $('[data-speed-value]')
  const pitchValue = $('[data-pitch-value]')
  const caption = $('[data-caption]')
  const handles = {
    a: $('[data-handle="a"]'),
    b: $('[data-handle="b"]'),
  }
  const duration = Number(root.dataset.duration)

  let loop: Loop = { ...INITIAL_LOOP }
  let looping = false
  let speed: number = SPEED.initial
  let semitones: number = PITCH.initial
  let context: AudioContext | null = null
  let stage: PitchStage | null = null
  let stageFailed = false
  let frame = 0

  const say = (text: string) => {
    caption.textContent = text
  }

  const drawTime = () => {
    track.style.setProperty('--at', String(audio.currentTime / duration))
    now.textContent = formatTime(audio.currentTime)
  }

  const drawLoop = () => {
    track.style.setProperty('--a', String(loop.a / duration))
    track.style.setProperty('--b', String(loop.b / duration))
    for (const handle of ['a', 'b'] as const) {
      handles[handle].setAttribute('aria-valuenow', String(loop[handle]))
      handles[handle].setAttribute('aria-valuetext', formatTime(loop[handle]))
    }
  }

  const applyRate = () => {
    audio.playbackRate = speed / 100
    // With a pitch stage in the chain it owns the shift, so the element must stop holding
    // pitch on its own or the two corrections compound.
    audio.preservesPitch = stage === null
    stage?.setTranspose(compensatedSemitones(semitones, speed))
  }

  const tick = () => {
    const next = wrapTime(audio.currentTime, loop, looping)
    if (next !== audio.currentTime) audio.currentTime = next
    drawTime()
    frame = requestAnimationFrame(tick)
  }

  const setPlaying = (playing: boolean) => {
    play.setAttribute('aria-label', playing ? PAUSE : PLAY)
    cancelAnimationFrame(frame)
    if (playing) frame = requestAnimationFrame(tick)
  }

  play.addEventListener('click', async () => {
    if (!audio.paused) return audio.pause()
    if (looping && (audio.currentTime < loop.a || audio.currentTime >= loop.b)) {
      audio.currentTime = loop.a
    }
    await context?.resume()
    await stage?.start().catch(() => {
      stage = null
      stageFailed = true
      applyRate()
    })
    await audio.play().catch(() => {})
  })
  audio.addEventListener('play', () => setPlaying(true))
  audio.addEventListener('pause', () => {
    setPlaying(false)
    stage?.stop()
  })
  audio.addEventListener('ended', () => {
    audio.currentTime = 0
    drawTime()
  })

  loopButton.addEventListener('click', () => {
    looping = !looping
    loopButton.setAttribute('aria-pressed', String(looping))
    track.classList.toggle('looping', looping)
    if (looping && !audio.paused && audio.currentTime >= loop.b) audio.currentTime = loop.a
    say(loopCaption(loop, looping))
  })

  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value)
    speedValue.textContent = `${speed}%`
    applyRate()
    say(speedCaption(speed))
  })

  const ensureStage = async () => {
    if (stage || stageFailed) return
    // The context must be created inside the click, or browsers keep it suspended.
    context ??= new AudioContext()
    say(LOADING_PITCH)
    try {
      stage = await createPitchStage(context, audio)
      applyRate()
      if (!audio.paused) await stage.start()
      say(pitchCaption(semitones))
    } catch {
      stage = null
      stageFailed = true
      applyRate()
      say(PITCH_UNAVAILABLE)
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-pitch]')) {
    button.addEventListener('click', () => {
      semitones = Math.min(PITCH.max, Math.max(PITCH.min, semitones + Number(button.dataset.pitch)))
      pitchValue.textContent = signed(semitones)
      for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pitch]')) {
        const step = Number(b.dataset.pitch)
        b.disabled = step < 0 ? semitones <= PITCH.min : semitones >= PITCH.max
      }
      if (stageFailed) return say(PITCH_UNAVAILABLE)
      say(pitchCaption(semitones))
      if (stage) applyRate()
      else void ensureStage()
    })
  }

  const timeAt = (clientX: number) => {
    const inset = parseFloat(getComputedStyle(track).getPropertyValue('--inset')) || 0
    const rect = track.getBoundingClientRect()
    const fraction = (clientX - rect.left - inset) / (rect.width - 2 * inset)
    return Math.min(duration, Math.max(0, fraction * duration))
  }

  const move = (handle: Handle, to: number) => {
    loop = moveHandle(loop, handle, to, duration)
    drawLoop()
    say(handleCaption(loop, looping))
  }

  let dragging: Handle | null = null
  track.addEventListener('pointerdown', (event) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]')
    if (handle) {
      dragging = handle.dataset.handle as Handle
      track.setPointerCapture(event.pointerId)
      handle.focus()
      return
    }
    audio.currentTime = timeAt(event.clientX)
    drawTime()
  })
  track.addEventListener('pointermove', (event) => {
    if (dragging) move(dragging, timeAt(event.clientX))
  })
  const release = () => {
    dragging = null
  }
  track.addEventListener('pointerup', release)
  track.addEventListener('pointercancel', release)

  for (const handle of ['a', 'b'] as const) {
    handles[handle].addEventListener('keydown', (event) => {
      const steps: Record<string, number> = {
        ArrowLeft: -LOOP_STEP,
        ArrowDown: -LOOP_STEP,
        ArrowRight: LOOP_STEP,
        ArrowUp: LOOP_STEP,
        PageDown: -5,
        PageUp: 5,
      }
      if (event.key in steps) move(handle, loop[handle] + steps[event.key])
      else if (event.key === 'Home') move(handle, 0)
      else if (event.key === 'End') move(handle, duration)
      else return
      event.preventDefault()
    })
  }

  $('[data-controls]').hidden = false
  say(PLAYER_PROMPT)
}
