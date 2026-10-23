import { setAudioSessionType } from '../../platform/audioSession'

export interface TunerMicDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  audioContext: () => AudioContext
  /** Calls `tick` repeatedly until the returned function is called. */
  schedule: (tick: () => void) => () => void
}

export interface MicRead {
  /** How many samples were written. */
  samples: number
  /** True when more input passed since the last read than the analyser holds, so the samples
   * written do not follow on from the ones before. */
  gap: boolean
}

export interface TunerMic {
  sampleRate: number
  /** Copies the input heard since the last read into `into`. */
  read(into: Float32Array): MicRead
  /** Whether the context runs, which input needs. */
  running(): boolean
  /** Calls `listener` whenever the context starts or stops running. */
  onRunningChange(listener: () => void): void
  /** Asks a stopped context to run again. Call it inside a user gesture. */
  resume(): void
  /** Calls `listener` once the microphone goes away, such as when it is unplugged. */
  onEnded(listener: () => void): void
  close(): Promise<void>
}

/** The analyser's window: about 170 ms at 48 kHz, longer than any gap between two reads. */
export const TUNER_FFT_SIZE = 8192

const TICK_MS = 20

/** Animation frames, at most one tick per `TICK_MS`. */
export function frameSchedule(tick: () => void): () => void {
  let last = -Infinity
  let frame = requestAnimationFrame(function loop(now) {
    if (now - last >= TICK_MS) {
      last = now
      tick()
    }
    frame = requestAnimationFrame(loop)
  })
  return () => cancelAnimationFrame(frame)
}

export const defaultTunerMicDeps: TunerMicDeps = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  audioContext: () => new AudioContext(),
  schedule: frameSchedule,
}

/**
 * Opens the microphone raw, since voice processing cuts the low notes a bass sounds and gain
 * control bends a decaying note's level, and taps it with an analyser. The context is the mic's
 * own and closes with it. Claims the audio session for recording while open.
 */
export async function openTunerMic(deps: TunerMicDeps): Promise<TunerMic> {
  setAudioSessionType('play-and-record')
  let stream: MediaStream
  try {
    stream = await deps.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (error) {
    setAudioSessionType('auto')
    throw error
  }

  let context: AudioContext | null = null
  try {
    context = deps.audioContext()
    return tap(stream, context)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    setAudioSessionType('auto')
    await context?.close().catch(() => {})
    throw error
  }
}

function tap(stream: MediaStream, context: AudioContext): TunerMic {
  // iOS keeps a context suspended unless a user gesture created or resumed it; this resume only
  // helps where the page already has one, and `resume()` asks again from the next gesture.
  if (context.state === 'suspended') void context.resume().catch(() => {})
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = TUNER_FFT_SIZE
  source.connect(analyser)
  const latest = new Float32Array(TUNER_FFT_SIZE)
  const { sampleRate } = context
  const listening = new AbortController()
  // Whole samples by the context's clock, so rounding never drifts a sample in or out.
  let readTo = Math.round(context.currentTime * sampleRate)
  let closed: Promise<void> | null = null

  return {
    sampleRate,
    read(into) {
      const now = Math.round(context.currentTime * sampleRate)
      const passed = now - readTo
      readTo = now
      if (passed <= 0) return { samples: 0, gap: false }
      const samples = Math.min(passed, TUNER_FFT_SIZE, into.length)
      analyser.getFloatTimeDomainData(latest)
      into.set(latest.subarray(TUNER_FFT_SIZE - samples))
      return { samples, gap: passed > samples }
    },
    running: () => context.state === 'running',
    onRunningChange(listener) {
      context.addEventListener('statechange', listener, { signal: listening.signal })
    },
    resume() {
      void context.resume().catch(() => {})
    },
    onEnded(listener) {
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', listener, { once: true, signal: listening.signal })
      }
    },
    close() {
      closed ??= (async () => {
        listening.abort()
        source.disconnect()
        for (const track of stream.getTracks()) track.stop()
        setAudioSessionType('auto')
        await context.close().catch(() => {})
      })()
      return closed
    },
  }
}
