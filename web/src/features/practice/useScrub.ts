import { animate, useReducedMotionConfig, type AnimationPlaybackControls } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { PlaybackEngine } from '../player/playbackEngine'
import { capturePointer } from '../../platform/pointer'
import { useLatest } from '../../ui/useLatest'
import { DRAG_THRESHOLD_PX } from '../../domain/loopModel'
import { GLIDE_TAU_MS, glideMs, scrubMs, unstretchedMs } from './practiceZoom'
import { clamp } from '../../math'
import { SPRING } from '../../theme/motion'

type Handler = (event: PointerEvent<HTMLElement>) => void

export interface PointerHandlers {
  onPointerDown: Handler
  onPointerMove: Handler
  onPointerUp: Handler
  onPointerCancel: Handler
  onLostPointerCapture: Handler
}

export type ScrubEngine = Pick<PlaybackEngine, 'getState' | 'play' | 'pause' | 'seek'>

/** How far back the release velocity looks. */
const VELOCITY_WINDOW_MS = 100
/** A glide stops at three time constants, where 95% of its distance is covered. */
const GLIDE_RUN_MS = 3 * GLIDE_TAU_MS
const GLIDE_SPAN = 1 - Math.exp(-GLIDE_RUN_MS / GLIDE_TAU_MS)

interface Press {
  pointerId: number
  startX: number
  fromMs: number
  moved: boolean
  /** A press that caught a glide stops it and is never a tap. */
  caught: boolean
  target: EventTarget | null
  touch: boolean
  pinch: number
  samples: { t: number; x: number }[]
}

/**
 * Dragging the audio under a fixed playhead. A drag past the threshold holds playback where it
 * is and moves `scrubbingMs` (trimmed timeline), and a touch released while moving
 * glides on with exponential decay. A drag past either end pulls on with resistance and
 * springs back to that end on release, so `scrubbingMs` can briefly lie outside the take.
 * Once still, the engine seeks there once and plays on if it was playing. A press released
 * without moving is a tap, reported with its x from the element's left edge and the element
 * it began on.
 */
export function useScrub({
  engine,
  pxPerS,
  lengthMs,
  pinches,
  onTap,
}: {
  engine: ScrubEngine
  pxPerS: number
  lengthMs: number
  /** Counts pinches; a press that gave way to one seeks nothing. */
  pinches?: RefObject<number>
  onTap?: (x: number, target: EventTarget | null) => void
}): {
  scrubbingMs: number | null
  handlers: PointerHandlers
  /**
   * Stops a glide under way where it has got to, so a command acts where the playhead shows
   * and the glide cannot carry it off afterward. True when there was one.
   */
  settleGlide: () => boolean
  /** Where a scrub or glide under way has the playhead (trimmed timeline), else null. */
  shownMs: () => number | null
} {
  const [scrubbingMs, setScrubbingMs] = useState<number | null>(null)
  const reduceMotion = useReducedMotionConfig() ?? false
  const latestRef = useLatest({ engine, pxPerS, lengthMs, pinches, onTap, reduceMotion })
  const shownRef = useRef<number | null>(null)
  const press = useRef<Press | null>(null)
  const frame = useRef(0)
  const springBack = useRef<AnimationPlaybackControls | null>(null)
  const held = useRef<{ playing: boolean } | null>(null)

  const controls = useMemo(() => {
    const show = (ms: number | null) => {
      shownRef.current = ms
      setScrubbingMs(ms)
    }
    const stopGlide = () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      springBack.current?.stop()
      springBack.current = null
    }
    const gliding = () => frame.current !== 0 || springBack.current !== null
    /**
     * Lets go of playback: seeks to `ms` unless null, and plays on if it was playing, unless
     * the playhead is at the end.
     */
    const settle = (ms: number | null) => {
      stopGlide()
      const { engine, lengthMs } = latestRef.current
      const atMs = ms === null ? null : clamp(ms, 0, lengthMs)
      if (atMs !== null) engine.seek(atMs)
      show(null)
      const was = held.current
      held.current = null
      if (was?.playing && (atMs ?? 0) < lengthMs) engine.play()
    }
    const glide = (fromMs: number, toMs: number) => {
      let startT: number | null = null
      const step = (t: number) => {
        startT ??= t
        const elapsed = t - startT
        if (elapsed >= GLIDE_RUN_MS) {
          frame.current = 0
          settle(toMs)
          return
        }
        show(fromMs + ((toMs - fromMs) * (1 - Math.exp(-elapsed / GLIDE_TAU_MS))) / GLIDE_SPAN)
        frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    }
    const springTo = (fromMs: number, toMs: number) => {
      if (latestRef.current.reduceMotion) {
        settle(toMs)
        return
      }
      springBack.current = animate(fromMs, toMs, {
        ...SPRING,
        onUpdate: show,
        onComplete: () => {
          springBack.current = null
          settle(toMs)
        },
      })
    }
    const velocity = (samples: Press['samples'], now: number) => {
      const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
      if (recent.length < 2) return 0
      const first = recent[0]!
      const last = recent.at(-1)!
      const dt = last.t - first.t
      return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0
    }

    const localX = (event: PointerEvent<HTMLElement>) =>
      event.clientX - event.currentTarget.getBoundingClientRect().left

    const handlers: PointerHandlers = {
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        // A second finger belongs to a pinch, not to this press.
        if (press.current) return
        capturePointer(event.currentTarget, event.pointerId)
        const { engine, pinches } = latestRef.current
        const caught = gliding()
        if (caught) stopGlide()
        const caughtMs = caught ? shownRef.current : null
        const { pxPerS, lengthMs } = latestRef.current
        const fromMs =
          caughtMs === null
            ? engine.getState().positionMs
            : unstretchedMs(caughtMs, pxPerS, lengthMs)
        press.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          fromMs,
          moved: false,
          caught,
          target: event.target,
          touch: event.pointerType === 'touch',
          pinch: pinches?.current ?? 0,
          samples: [{ t: performance.now(), x: event.clientX }],
        }
      },
      onPointerMove: (event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId) return
        const { pxPerS, lengthMs, pinches } = latestRef.current
        // The pinch owns the view now; this finger goes back to where the press began.
        if ((pinches?.current ?? 0) !== pressed.pinch) {
          if (shownRef.current !== null) show(null)
          return
        }
        const dx = event.clientX - pressed.startX
        if (!pressed.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        // A tap leaves playback alone; only a drag holds it, from where the playhead now is.
        if (!held.current) {
          const { engine } = latestRef.current
          const state = engine.getState()
          pressed.fromMs = state.positionMs
          held.current = { playing: state.playing }
          if (state.playing) engine.pause()
        }
        pressed.moved = true
        const now = performance.now()
        pressed.samples.push({ t: now, x: event.clientX })
        while (pressed.samples.length > 2 && now - pressed.samples[0]!.t > VELOCITY_WINDOW_MS) {
          pressed.samples.shift()
        }
        show(scrubMs(pressed.fromMs, dx, pxPerS, lengthMs))
      },
      onPointerUp: (event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId) return
        press.current = null
        const { pxPerS, lengthMs, pinches, onTap } = latestRef.current
        if ((pinches?.current ?? 0) !== pressed.pinch) {
          settle(null)
          return
        }
        if (!pressed.moved) {
          if (pressed.caught) {
            settle(shownRef.current)
            return
          }
          settle(null)
          onTap?.(localX(event), pressed.target)
          return
        }
        const atMs = shownRef.current ?? pressed.fromMs
        const endMs = clamp(atMs, 0, lengthMs)
        if (endMs !== atMs) {
          springTo(atMs, endMs)
          return
        }
        const distance = pressed.touch
          ? glideMs(velocity(pressed.samples, performance.now()), pxPerS)
          : 0
        const toMs = clamp(atMs + distance, 0, lengthMs)
        if (Math.abs(toMs - atMs) < 1) settle(atMs)
        else glide(atMs, toMs)
      },
      onPointerCancel: (event) => {
        const pressed = press.current
        if (!pressed || pressed.pointerId !== event.pointerId) return
        press.current = null
        settle(pressed.moved ? shownRef.current : null)
      },
      // After a pointerup the press is already gone, so only a capture taken away mid-drag lands.
      onLostPointerCapture: (event) => handlers.onPointerCancel(event),
    }
    const settleGlide = () => {
      if (!gliding()) return false
      settle(shownRef.current)
      return true
    }
    const shownMs = () => shownRef.current
    return { handlers, stopGlide, settle, settleGlide, shownMs }
  }, [latestRef])

  // Leaving mid-scrub still lands the playhead where it was dragged.
  useEffect(
    () => () => {
      if (held.current) controls.settle(shownRef.current)
      else controls.stopGlide()
    },
    [controls],
  )

  const { handlers, settleGlide, shownMs } = controls
  return { scrubbingMs, handlers, settleGlide, shownMs }
}
