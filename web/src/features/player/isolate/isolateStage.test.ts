import { afterEach, describe, expect, it, vi } from 'vitest'
import { ISOLATE_PROCESSOR } from './isolateMessages'
import { DEFAULT_ISOLATE } from './isolateSetting'
import { createIsolateNode, type IsolateOutline } from './isolateStage'

class FakeWorkletNode {
  static last: FakeWorkletNode | null = null
  readonly port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  }
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    FakeWorkletNode.last = this
  }
}

function fakeContext() {
  const addModule = vi.fn(async () => {})
  const context = { audioWorklet: { addModule } } as unknown as AudioContext
  return { context, addModule }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWorkletNode.last = null
})

describe('createIsolateNode', () => {
  it('loads the processor module and builds a stereo node that downmixes wider input', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    const { context, addModule } = fakeContext()

    const isolate = await createIsolateNode(context)

    expect(addModule).toHaveBeenCalledTimes(1)
    const worklet = FakeWorkletNode.last!
    expect(isolate.node).toBe(worklet)
    expect(worklet.name).toBe(ISOLATE_PROCESSOR)
    expect(worklet.options).toMatchObject({
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
  })

  it('rejects without building a node when the module fails to load', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    const { context, addModule } = fakeContext()
    addModule.mockRejectedValue(new Error('module failed'))

    await expect(createIsolateNode(context)).rejects.toThrow('module failed')
    expect(FakeWorkletNode.last).toBeNull()
  })

  it('posts the setting, engaged flag, and reset over the port', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    const { context } = fakeContext()
    const isolate = await createIsolateNode(context)
    const { postMessage } = FakeWorkletNode.last!.port
    const setting = { ...DEFAULT_ISOLATE, effect: 'mute' as const }

    isolate.setSetting(setting, true)
    isolate.setEngaged(true)
    isolate.reset()

    expect(postMessage.mock.calls).toEqual([
      [{ setting, isMono: true }],
      [{ engaged: true }],
      [{ reset: true }],
    ])
  })

  it('forwards outline messages to subscribers until they unsubscribe', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    const { context } = fakeContext()
    const isolate = await createIsolateNode(context)
    const { port } = FakeWorkletNode.last!
    const received: IsolateOutline[] = []
    const unsubscribe = isolate.onOutline((outline) => received.push(outline))
    const outline = { pan: new Float32Array(32).fill(0.5), freq: new Float32Array(48) }

    port.onmessage?.({ data: { outline } } as MessageEvent)
    unsubscribe()
    port.onmessage?.({ data: { outline } } as MessageEvent)

    expect(received).toEqual([outline])
  })
})
