import { createIsolateNode, type IsolateNode } from './isolate/isolateStage'

/**
 * Semitones the stretch node must add on top of `pitchCents` to cancel the pitch shift the
 * browser's own `playbackRate` already applies at `speedPercent`, so the stored cents describe
 * the perceived shift regardless of speed.
 */
export function compensatedSemitones(pitchCents: number, speedPercent: number): number {
  return pitchCents / 100 - 12 * Math.log2(speedPercent / 100)
}

export interface AudioStage {
  /** Runs ahead of the stretch node, so pitch and speed act on the isolated audio. */
  isolate: IsolateNode
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
 * Routes the element's audio through the isolate worklet and then the Signalsmith Stretch
 * AudioWorklet, both loaded lazily, so pitch can move independently of playback rate. The
 * imports, worklet compiles, and WASM init all happen before the source node is created, so a
 * failed load never touches the element's own audio output.
 */
export async function createAudioStage(
  context: AudioContext,
  element: HTMLAudioElement,
): Promise<AudioStage> {
  const [stretchLoad, isolateLoad] = await Promise.allSettled([
    import('signalsmith-stretch').then(({ default: signalsmithStretch }) =>
      signalsmithStretch(context),
    ),
    createIsolateNode(context),
  ])
  // A node that loaded beside a failed one is not yet started or connected, and the caller
  // never receives it.
  if (stretchLoad.status === 'rejected') {
    if (isolateLoad.status === 'fulfilled') isolateLoad.value.node.disconnect()
    throw stretchLoad.reason
  }
  if (isolateLoad.status === 'rejected') {
    stretchLoad.value.disconnect()
    throw isolateLoad.reason
  }
  const stretch = stretchLoad.value
  const isolate = isolateLoad.value
  const source = context.createMediaElementSource(element)
  // In signal order, so pitch and speed act on the isolated audio.
  const nodes: AudioNode[] = [source, isolate.node, stretch, context.destination]

  const disconnectAll = (): void => {
    for (const node of nodes.slice(0, -1)) node.disconnect()
  }
  // The source node redirects the element's output into this graph the moment it exists, so
  // a failure past that point needs its own path to destination or playback goes silent.
  const fallBackToDirectOutput = (): void => {
    disconnectAll()
    source.connect(context.destination)
  }

  try {
    for (let i = 1; i < nodes.length; i++) nodes[i - 1]!.connect(nodes[i]!)
  } catch (error) {
    fallBackToDirectOutput()
    throw error
  }
  return {
    isolate,
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
    dispose: disconnectAll,
  }
}
