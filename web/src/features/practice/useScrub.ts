import { animate, useReducedMotionConfig, type AnimationPlaybackControls } from 'motion/react'
import { useEffect, useMemo, useRef, type PointerEvent, type RefObject } from 'react'
import type { PlaybackEngine } from '../player/playbackEngine'
import { capturePointer } from '../../platform/pointer'
import { useLatest } from '../../ui/useLatest'
import { DRAG_THRESHOLD_PX } from '../../domain/loopModel'
import { MOMENTUM_TAU_MS, momentumScrollMs, scrubMs, unstretchedMs } from './practiceZoom'
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
/** A momentum scroll stops at three time constants, where 95% of its distance is covered. */
const MOMENTUM_RUN_MS = 3 * MOMENTUM_TAU_MS
const MOMENTUM_SPAN = 1 - Math.exp(-MOMENTUM_RUN_MS / MOMENTUM_TAU_MS)

interface Press {
  pointerId: number
  startX: number
  fromMs: number
  moved: boolean
  /** A press that caught a momentum scroll stops it and is never a tap. */
  caught: boolean
  target: EventTarget | null
  touch: boolean
  pinch: number
  samples: { t: number; x: number }[]
}

/**
 * Dragging the audio under a fixed playhead. A drag past the threshold holds playback where it
 * is and reports the playhead it draws to `onShow` (trimmed timeline), and a touch released
 * while moving starts a momentum scroll with exponential decay. A drag past either end pulls on with
 * resistance and springs back to that end on release, so what it shows can briefly lie outside
 * the take. `onShow` gets null once it lets go.
 * Once still, the engine seeks there once and plays on if it was playing. A press released
 * without moving is a tap, reported with its x from the element's left edge and the element
 * it began on.
 */
export function useScrub({
  engine,
  position,
  pxPerS,
  lengthMs,
  pinches,
  onShow,
  onTap,
}: {
  engine: ScrubEngine
  /** Where the playhead is drawn now (trimmed timeline), where a drag picks the audio up. */
  position: () => number
  onShow: (ms: number | null) => void
  pxPerS: number
  lengthMs: number
  /** Counts pinches; a press that gave way to one seeks nothing. */
  pinches?: RefObject<number>
  onTap?: (x: number, target: EventTarget | null) => void
}): {
  handlers: PointerHandlers
  /**
   * Stops a momentum scroll under way where it has got to, so a command acts where the playhead shows
   * and the scroll cannot carry it off afterward. True when there was one.
   */
  settleMomentumScroll: () => boolean
  /** Where a scrub or momentum scroll under way has the playhead (trimmed timeline), else null. */
  shownMs: () => number | null
} {
  const reduceMotion = useReducedMotionConfig() ?? false
  const latestRef = useLatest({
    engine,
    position,
    pxPerS,
    lengthMs,
    pinches,
    onShow,
    onTap,
    reduceMotion,
  })
  const shownRef = useRef<number | null>(null)
  const press = useRef<Press | null>(null)
  const frame = useRef(0)
  const springBack = useRef<AnimationPlaybackControls | null>(null)
  const held = useRef<{ playing: boolean } | null>(null)

  const controls = useMemo(() => {
    const show = (ms: number | null) => {
      shownRef.current = ms
      latestRef.current.onShow(ms)
    }
    const stopMomentumScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      springBack.current?.stop()
      springBack.current = null
    }
    const isMomentumScrolling = () => frame.current !== 0 || springBack.current !== null
    /**
     * Lets go of playback: seeks to `ms` unless null, and plays on if it was playing, unless
     * the playhead is at the end.
     */
    const settle = (ms: number | null) => {
      stopMomentumScroll()
      const { engine, lengthMs } = latestRef.current
      const atMs = ms === null ? null : clamp(ms, 0, lengthMs)
      if (atMs !== null) engine.seek(atMs)
      show(null)
      const was = held.current
      held.current = null
      if (was?.playing && (atMs ?? 0) < lengthMs) engine.play()
    }
    const startMomentumScroll = (fromMs: number, toMs: number) => {
      let startT: number | null = null
      const step = (t: number) => {
        startT ??= t
        const elapsed = t - startT
        if (elapsed >= MOMENTUM_RUN_MS) {
          frame.current = 0
          settle(toMs)
          return
        }
        show(
          fromMs + ((toMs - fromMs) * (1 - Math.exp(-elapsed / MOMENTUM_TAU_MS))) / MOMENTUM_SPAN,
        )
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
        const { position, pinches } = latestRef.current
        const caught = isMomentumScrolling()
        if (caught) stopMomentumScroll()
        const caughtMs = caught ? shownRef.current : null
        const { pxPerS, lengthMs } = latestRef.current
        const fromMs = caughtMs === null ? position() : unstretchedMs(caughtMs, pxPerS, lengthMs)
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
          const { engine, position } = latestRef.current
          const state = engine.getState()
          pressed.fromMs = position()
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
          ? momentumScrollMs(velocity(pressed.samples, performance.now()), pxPerS)
          : 0
        const toMs = clamp(atMs + distance, 0, lengthMs)
        if (Math.abs(toMs - atMs) < 1) settle(atMs)
        else startMomentumScroll(atMs, toMs)
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
    const settleMomentumScroll = () => {
      if (!isMomentumScrolling()) return false
      settle(shownRef.current)
      return true
    }
    const shownMs = () => shownRef.current
    return { handlers, stopMomentumScroll, settle, settleMomentumScroll, shownMs }
  }, [latestRef])

  // Leaving mid-scrub still lands the playhead where it was dragged.
  useEffect(
    () => () => {
      if (held.current) controls.settle(shownRef.current)
      else controls.stopMomentumScroll()
    },
    [controls],
  )

  const { handlers, settleMomentumScroll, shownMs } = controls
  return { handlers, settleMomentumScroll, shownMs }
}
