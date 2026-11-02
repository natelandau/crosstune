import { describe, expect, it } from 'vitest'
import { createIsolateNode } from './isolateStage'

const SAMPLE_RATE = 48_000
const FRAMES = SAMPLE_RATE / 4

describe('createIsolateNode in a real audio context', () => {
  it('loads the processor and passes audio through untouched in the default state', async () => {
    const context = new OfflineAudioContext(2, FRAMES, SAMPLE_RATE)
    const input = context.createBuffer(2, FRAMES, SAMPLE_RATE)
    for (let c = 0; c < 2; c++) {
      const channel = input.getChannelData(c)
      for (let i = 0; i < FRAMES; i++)
        channel[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
    }
    const source = context.createBufferSource()
    source.buffer = input

    const isolate = await createIsolateNode(context)
    source.connect(isolate.node)
    isolate.node.connect(context.destination)
    source.start()
    const output = await context.startRendering()

    for (let c = 0; c < 2; c++) {
      expect(output.getChannelData(c)).toEqual(input.getChannelData(c))
    }
  })
})
