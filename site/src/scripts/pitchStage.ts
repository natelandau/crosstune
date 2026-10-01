export interface PitchStage {
  setTranspose(semitones: number): void
  start(): Promise<void>
  stop(): void
}

/**
 * Routes the element's audio through the Signalsmith Stretch AudioWorklet so pitch moves apart
 * from speed. The library loads before the source node exists, so a failed load never cuts
 * the element off from the speakers.
 */
export async function createPitchStage(
  context: AudioContext,
  element: HTMLAudioElement,
): Promise<PitchStage> {
  const { default: signalsmithStretch } = await import('signalsmith-stretch')
  const stretch = await signalsmithStretch(context)
  const source = context.createMediaElementSource(element)
  source.connect(stretch)
  stretch.connect(context.destination)
  return {
    setTranspose(semitones) {
      void stretch.schedule({ semitones }).catch(() => {})
    },
    async start() {
      try {
        await stretch.start()
      } catch (error) {
        // An unstarted worklet passes only silence, so fall back to the element's own output.
        stretch.disconnect()
        source.disconnect()
        source.connect(context.destination)
        throw error
      }
    },
    stop() {
      void stretch.stop().catch(() => {})
    },
  }
}
