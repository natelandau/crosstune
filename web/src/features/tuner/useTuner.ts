import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useLatest } from '../../ui/useLatest'
import { PitchTracker, type Reading } from './pitch/tracker'
import {
  defaultTunerMicDeps,
  openTunerMic,
  TUNER_FFT_SIZE,
  type TunerMic,
  type TunerMicDeps,
} from './tunerMic'

export type TunerState =
  | { status: 'starting' }
  | { status: 'listening'; reading: Reading | null }
  /** The microphone is open but its context is not running, until the next tap or key. */
  | { status: 'paused' }
  | { status: 'denied' }
  | { status: 'unavailable' }

/** Stands in for any of the microphone's dependencies, such as a test's fake one. */
export const TunerMicContext = createContext<Partial<TunerMicDeps> | undefined>(undefined)

export function useTunerMicDeps(): Partial<TunerMicDeps> | undefined {
  return useContext(TunerMicContext)
}

function failed(error: unknown): TunerState {
  const name = error instanceof Error ? error.name : ''
  return {
    status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
  }
}

/**
 * Listens while `active`, and reads the pitch heard. One microphone at most is ever open: each
 * opening waits for the one before it to have closed.
 */
export function useTuner({
  active,
  a4,
  deps,
}: {
  active: boolean
  a4: number
  deps?: Partial<TunerMicDeps>
}): TunerState {
  const [state, setState] = useState<TunerState>({ status: 'starting' })
  const a4Ref = useLatest(a4)
  const depsRef = useLatest(deps)
  const tracker = useRef<PitchTracker | null>(null)
  const settled = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    tracker.current?.setA4(a4)
  }, [a4])

  useEffect(() => {
    if (!active) return
    let live = true
    let mic: TunerMic | null = null
    let stopTicks: (() => void) | null = null
    let stopGestures: (() => void) | null = null
    const before = settled.current

    const open = async () => {
      await before
      if (!live) return
      setState({ status: 'starting' })
      const all = { ...defaultTunerMicDeps, ...depsRef.current }
      try {
        mic = await openTunerMic(all)
      } catch (error) {
        if (live) setState(failed(error))
        return
      }
      if (!live) return
      const opened = mic
      const pitch = new PitchTracker({ sampleRate: opened.sampleRate, a4: a4Ref.current })
      tracker.current = pitch
      const samples = new Float32Array(TUNER_FFT_SIZE)
      let shown: Reading | null = null

      // A context the browser has not let run (no gesture yet, or an iOS call or Siri has it)
      // resumes from the next tap or key, which is a gesture the browser accepts.
      const resumeOnGesture = () => opened.resume()
      const watchGestures = (on: boolean) => {
        for (const type of ['pointerdown', 'keydown'] as const) {
          if (on) document.addEventListener(type, resumeOnGesture, { capture: true })
          else document.removeEventListener(type, resumeOnGesture, { capture: true })
        }
      }
      const followRunning = () => {
        if (!live) return
        const running = opened.running()
        watchGestures(!running)
        if (!running) pitch.reset()
        shown = null
        setState(running ? { status: 'listening', reading: null } : { status: 'paused' })
      }
      stopGestures = () => watchGestures(false)
      opened.onRunningChange(followRunning)
      followRunning()

      opened.onEnded(() => {
        if (!live) return
        stopTicks?.()
        stopTicks = null
        stopGestures?.()
        void opened.close()
        setState({ status: 'unavailable' })
      })
      stopTicks = all.schedule(() => {
        const { samples: count, gap } = opened.read(samples)
        if (count === 0) return
        // Input that does not follow on from the last would join two windows into a false pitch.
        if (gap) pitch.reset()
        // The tracker hands back the same reading until its next analysis.
        const reading = pitch.push(samples.subarray(0, count))
        if (reading === shown) return
        shown = reading
        setState({ status: 'listening', reading })
      })
    }

    const opening = open()
    return () => {
      live = false
      stopTicks?.()
      stopGestures?.()
      tracker.current = null
      setState((current) =>
        current.status === 'listening' ? { status: 'listening', reading: null } : current,
      )
      settled.current = opening.then(() => mic?.close())
    }
  }, [active, a4Ref, depsRef])

  return state
}
