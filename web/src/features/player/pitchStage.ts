/**
 * Semitones the stretch node must add on top of `pitchCents` to cancel the pitch shift the
 * browser's own `playbackRate` already applies at `speedPercent`, so the stored cents describe
 * the perceived shift regardless of speed.
 */
export function compensatedSemitones(pitchCents: number, speedPercent: number): number {
  return pitchCents / 100 - 12 * Math.log2(speedPercent / 100)
}

export interface PitchStage {
  setTranspose(semitones: number): void
  /**
   * Resumes worklet processing; a stage is created stopped and stays stopped while paused.
   * Rejects if the worklet refuses to start, after already falling back to a direct
   * connection so playback keeps making sound without it.
   */
  start(): Promise<void>
  stop(): void
  dispose(): void
}

/**
 * Routes the element's audio through the Signalsmith Stretch AudioWorklet, loaded lazily, so
 * pitch can move independently of playback rate. The import, worklet compile, and WASM init all
 * happen before the source node is created, so a failed load never touches the element's own
 * audio output.
 */
export async function createPitchStage(
  context: AudioContext,
  element: HTMLAudioElement,
): Promise<PitchStage> {
  const { default: signalsmithStretch } = await import('signalsmith-stretch')
  const stretch = await signalsmithStretch(context)
  const source = context.createMediaElementSource(element)

  // The source node redirects the element's output into this graph the moment it exists, so
  // a failure past that point needs its own path to destination or playback goes silent.
  const fallBackToDirectOutput = (): void => {
    stretch.disconnect()
    source.disconnect()
    source.connect(context.destination)
  }

  try {
    source.connect(stretch)
    stretch.connect(context.destination)
  } catch (error) {
    fallBackToDirectOutput()
    throw error
  }
  return {
    setTranspose(semitones) {
      // Live input (this element, not a loaded buffer) ignores the node's own rate; the
      // element's playbackRate sets speed, so only semitones ever needs scheduling here.
      void stretch.schedule({ semitones }).catch(() => {})
    },
    async start() {
      try {
        await stretch.start()
      } catch (error) {
        // Left unstarted, the worklet passes only silence through, so a refusal here is not
        // survivable in place the way a failed transpose or stop is.
        fallBackToDirectOutput()
        throw error
      }
    },
    stop() {
      void stretch.stop().catch(() => {})
    },
    dispose() {
      stretch.disconnect()
      source.disconnect()
    },
  }
}
