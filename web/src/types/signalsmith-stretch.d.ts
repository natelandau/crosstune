declare module 'signalsmith-stretch' {
  interface StretchNode extends AudioNode {
    start(): Promise<void>
    stop(): Promise<void>
    schedule(params: { semitones?: number }): Promise<void>
  }

  export default function SignalsmithStretch(
    context: AudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>
}
