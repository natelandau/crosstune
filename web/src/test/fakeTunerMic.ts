import { act } from '@testing-library/react'
import { onTestFinished, vi } from 'vitest'
import { TUNER_FFT_SIZE, type TunerMicDeps } from '../features/tuner/tunerMic'
import { FakeTrack, fakeStream } from './fakeMedia'

const SAMPLE_RATE = 48_000
/** Input between two ticks, as the default frame schedule reads it. */
const TICK_SAMPLES = SAMPLE_RATE * 0.02

/**
 * The tuner's microphone, its context, and its schedule, driven by the test: `play` hands the
 * analyser input a tick at a time and runs every scheduled tick after each. Each opening gets
 * its own track, so `openTracks` counts the microphones still held.
 */
export function fakeTunerMic({
  contextState = 'running',
}: { contextState?: AudioContextState | 'interrupted' } = {}) {
  const tracks: FakeTrack[] = []
  const ticks = new Set<() => void>()
  const heard = new Float32Array(TUNER_FFT_SIZE)
  let total = 0
  let mostOpen = 0
  const contexts: FakeContext[] = []
  const openTracks = () => tracks.filter((track) => track.stop.mock.calls.length === 0).length

  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => {
    const track = new FakeTrack()
    tracks.push(track)
    mostOpen = Math.max(mostOpen, openTracks())
    return fakeStream(track) as unknown as MediaStream
  })

  const audioContext = () => {
    const context = new FakeContext(contextState, () => total / SAMPLE_RATE, heard)
    contexts.push(context)
    return context as unknown as AudioContext
  }

  const schedule = (tick: () => void) => {
    ticks.add(tick)
    return () => void ticks.delete(tick)
  }

  /** Input arriving, a piece at most the analyser's length at a time. */
  function hear(samples: Float32Array) {
    for (let at = 0; at < samples.length; at += TUNER_FFT_SIZE) {
      const piece = samples.subarray(at, Math.min(at + TUNER_FFT_SIZE, samples.length))
      heard.copyWithin(0, piece.length)
      heard.set(piece, heard.length - piece.length)
      total += piece.length
    }
  }

  const deps: TunerMicDeps = { getUserMedia, audioContext, schedule }

  return {
    deps,
    getUserMedia,
    tracks,
    openTracks,
    /** The most microphones ever open at once. */
    mostOpen: () => mostOpen,
    /** The newest context opened. */
    context: () => contexts.at(-1),
    /** Passes `count` samples of silence with no tick, as a stalled page would. */
    stall(count: number) {
      hear(new Float32Array(count))
    },
    /** Plays `samples`, calling `afterTick` once every tick has run on each piece. */
    play(samples: Float32Array, afterTick?: () => void) {
      for (let at = 0; at < samples.length; at += TICK_SAMPLES) {
        hear(samples.subarray(at, Math.min(at + TICK_SAMPLES, samples.length)))
        act(() => {
          for (const tick of ticks) tick()
        })
        afterTick?.()
      }
    },
  }
}

/**
 * An AudioContext whose clock is the input the test has played, and whose state it sets. Like a
 * browser's, it resumes only when asked inside a tap or key press.
 */
class FakeContext extends EventTarget {
  sampleRate = SAMPLE_RATE
  closed = false
  private inGesture = false
  private readonly gestures = new AbortController()

  constructor(
    public state: AudioContextState | 'interrupted',
    private readonly clock: () => number,
    private readonly heard: Float32Array,
  ) {
    super()
    const { signal } = this.gestures
    onTestFinished(() => this.gestures.abort())
    // Registered before anything the context's user adds, so it marks the gesture first.
    for (const type of ['pointerdown', 'keydown']) {
      document.addEventListener(type, () => (this.inGesture = true), { capture: true, signal })
      // A browser runs microtasks between the listeners of a real event, so the gesture ends
      // at the last listener of its dispatch instead.
      window.addEventListener(type, () => (this.inGesture = false), { signal })
    }
  }

  get currentTime() {
    return this.clock()
  }

  /** Moves to `state` and says so, as a browser does. */
  become(state: AudioContextState | 'interrupted') {
    act(() => {
      this.state = state
      this.dispatchEvent(new Event('statechange'))
    })
  }

  resume = vi.fn(async () => {
    if (this.state !== 'running' && !this.closed && this.inGesture) this.become('running')
  })

  close = async () => {
    this.closed = true
    this.gestures.abort()
  }

  createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} })

  createAnalyser = () => ({
    fftSize: 0,
    getFloatTimeDomainData: (into: Float32Array) =>
      into.set(this.heard.subarray(this.heard.length - into.length)),
  })
}

const PARTIALS: [number, number][] = [
  [1, 1],
  [2, 0.5],
  [3, 0.3],
]

/** A bowed-like tone through each `[hz, seconds]` in turn, unbroken in phase, at the fake's rate. */
export function toneThrough(segments: [hz: number, seconds: number][]): Float32Array {
  const length = segments.reduce((sum, [, seconds]) => sum + Math.round(seconds * SAMPLE_RATE), 0)
  const out = new Float32Array(length)
  let phase = 0
  let i = 0
  for (const [hz, seconds] of segments) {
    for (let n = Math.round(seconds * SAMPLE_RATE); n > 0; n--, i++) {
      let tone = 0
      for (const [harmonic, weight] of PARTIALS)
        tone += weight * Math.sin(2 * Math.PI * harmonic * phase)
      out[i] = 0.2 * tone
      phase += hz / SAMPLE_RATE
    }
  }
  return out
}

/** The frequency `cents` above A4 at 440 Hz. */
export const a4Plus = (cents: number) => 440 * 2 ** (cents / 1200)
