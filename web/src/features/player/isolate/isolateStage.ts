import {
  ISOLATE_PROCESSOR,
  type IsolateMessage,
  type IsolateOutline,
  type IsolateReport,
} from './isolateMessages'
import type { IsolateSetting } from './isolateSetting'
import isolateUrl from './isolateProcessor.ts?worker&url'

export type { IsolateOutline }

/** The isolate worklet node. The processor decides whether to engage from the setting and the
 * engaged flag together, so these calls only pass them on. */
export interface IsolateNode {
  node: AudioNode
  setSetting(setting: IsolateSetting, isMono: boolean): void
  setEngaged(on: boolean): void
  /** Drops the processor's buffered audio, for a jump in the playhead. */
  reset(): void
  onOutline(fn: (outline: IsolateOutline) => void): () => void
}

export async function createIsolateNode(context: BaseAudioContext): Promise<IsolateNode> {
  await context.audioWorklet.addModule(isolateUrl)
  const node = new AudioWorkletNode(context, ISOLATE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    // Downmixes a source with more channels instead of dropping all but the first two.
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  const listeners = new Set<(outline: IsolateOutline) => void>()
  node.port.onmessage = (event: MessageEvent<IsolateReport>) => {
    for (const fn of listeners) fn(event.data.outline)
  }
  const post = (message: IsolateMessage) => node.port.postMessage(message)
  return {
    node,
    setSetting: (setting, isMono) => post({ setting, isMono }),
    setEngaged: (engaged) => post({ engaged }),
    reset: () => post({ reset: true }),
    onOutline(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
