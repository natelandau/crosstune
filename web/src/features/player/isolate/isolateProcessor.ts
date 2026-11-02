import { ISOLATE_PROCESSOR, type IsolateMessage, type IsolateReport } from './isolateMessages'
import { IsolateRenderer } from './isolateRenderer'

// Globals of AudioWorkletGlobalScope, which TypeScript's DOM library does not describe.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

class IsolateProcessor extends AudioWorkletProcessor {
  private readonly renderer: IsolateRenderer

  constructor() {
    super()
    this.renderer = new IsolateRenderer(sampleRate, (outline) => {
      const report: IsolateReport = { outline }
      this.port.postMessage(report, [outline.pan.buffer, outline.freq.buffer])
    })
    this.port.onmessage = (event: MessageEvent<IsolateMessage>) => {
      this.renderer.receive(event.data)
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (output) this.renderer.render(inputs[0] ?? [], output)
    return true
  }
}

registerProcessor(ISOLATE_PROCESSOR, IsolateProcessor)
