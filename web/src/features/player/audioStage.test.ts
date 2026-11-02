import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compensatedSemitones, createAudioStage } from './audioStage'

const { stretchFactory, createIsolateNode } = vi.hoisted(() => ({
  stretchFactory: vi.fn(),
  createIsolateNode: vi.fn(),
}))
vi.mock('signalsmith-stretch', () => ({ default: stretchFactory }))
vi.mock('./isolate/isolateStage', () => ({ createIsolateNode }))

describe('compensatedSemitones', () => {
  it('needs no correction at full speed and no pitch shift', () => {
    expect(compensatedSemitones(0, 100)).toBe(0)
  })

  it('converts stored cents to semitones', () => {
    expect(compensatedSemitones(200, 100)).toBe(2)
  })

  it('corrects the octave drop a halved speed would otherwise cause', () => {
    expect(compensatedSemitones(0, 50)).toBeCloseTo(12)
  })

  it('combines a pitch drop with the rise from doubled speed', () => {
    expect(compensatedSemitones(-100, 200)).toBeCloseTo(-13)
  })
})

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

function fakeContext(): { context: AudioContext; source: FakeNode } {
  const source = new FakeNode()
  const context = {
    destination: {},
    createMediaElementSource: vi.fn(() => source),
  } as unknown as AudioContext
  return { context, source }
}

function fakeStretch() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    schedule: vi.fn(async () => {}),
  }
}

function fakeIsolate() {
  return {
    node: new FakeNode(),
    setSetting: vi.fn(),
    setEngaged: vi.fn(),
    reset: vi.fn(),
    onOutline: vi.fn(() => () => {}),
  }
}

const element = {} as HTMLAudioElement

describe('createAudioStage', () => {
  let isolate: ReturnType<typeof fakeIsolate>

  beforeEach(() => {
    stretchFactory.mockReset()
    createIsolateNode.mockReset()
    isolate = fakeIsolate()
    createIsolateNode.mockResolvedValue(isolate)
  })

  it('wires the element through the isolate and stretch nodes to the destination, stopped by default', async () => {
    const stretch = fakeStretch()
    stretchFactory.mockResolvedValue(stretch)
    const { context, source } = fakeContext()

    const stage = await createAudioStage(context, element)

    expect(stage.isolate).toBe(isolate)
    expect(source.connect).toHaveBeenCalledWith(isolate.node)
    expect(isolate.node.connect).toHaveBeenCalledWith(stretch)
    expect(stretch.connect).toHaveBeenCalledWith(context.destination)
    expect(stretch.start).not.toHaveBeenCalled()

    await stage.start()
    expect(stretch.start).toHaveBeenCalled()
    stage.stop()
    expect(stretch.stop).toHaveBeenCalled()

    stage.setTranspose(3)
    expect(stretch.schedule).toHaveBeenCalledWith({ semitones: 3 })

    stage.dispose()
    expect(stretch.disconnect).toHaveBeenCalled()
    expect(isolate.node.disconnect).toHaveBeenCalled()
    expect(source.disconnect).toHaveBeenCalled()
  })

  it('leaves the element untouched and drops the stretch node when the isolate module fails to load', async () => {
    const stretch = fakeStretch()
    stretchFactory.mockResolvedValue(stretch)
    createIsolateNode.mockRejectedValue(new Error('module failed'))
    const { context, source } = fakeContext()

    await expect(createAudioStage(context, element)).rejects.toThrow('module failed')

    expect(stretch.disconnect).toHaveBeenCalled()
    expect(stretch.start).not.toHaveBeenCalled()

    expect(context.createMediaElementSource).not.toHaveBeenCalled()
    expect(source.connect).not.toHaveBeenCalled()
  })

  it('leaves the element untouched when the worklet fails to load', async () => {
    stretchFactory.mockRejectedValue(new Error('worklet unavailable'))
    const { context, source } = fakeContext()

    await expect(createAudioStage(context, element)).rejects.toThrow('worklet unavailable')
    expect(isolate.node.disconnect).toHaveBeenCalled()

    // The import and worklet build both happen before any source node exists, so a failure
    // here never redirects (and so never has to restore) the element's own output.
    expect(context.createMediaElementSource).not.toHaveBeenCalled()
    expect(source.connect).not.toHaveBeenCalled()
  })

  it('connects the source straight to the destination when wiring the built node fails', async () => {
    const stretch = fakeStretch()
    stretchFactory.mockResolvedValue(stretch)
    const { context, source } = fakeContext()
    source.connect.mockImplementationOnce(() => {
      throw new Error('connect failed')
    })

    await expect(createAudioStage(context, element)).rejects.toThrow('connect failed')

    // The source node already redirected the element's output into the graph by this point,
    // so the stretch side is dropped and the source is wired straight to destination instead.
    expect(stretch.disconnect).toHaveBeenCalled()
    expect(isolate.node.disconnect).toHaveBeenCalled()
    expect(source.disconnect).toHaveBeenCalled()
    expect(source.connect).toHaveBeenLastCalledWith(context.destination)
  })

  it('falls back to a direct connection and rejects when start() fails', async () => {
    const stretch = fakeStretch()
    stretch.start.mockRejectedValue(new Error('start failed'))
    stretchFactory.mockResolvedValue(stretch)
    const { context, source } = fakeContext()

    const stage = await createAudioStage(context, element)
    await expect(stage.start()).rejects.toThrow('start failed')

    // Left unstarted, the worklet would only ever pass silence through, so this is not one
    // to leave in place the way a refused stop or transpose is.
    expect(stretch.disconnect).toHaveBeenCalled()
    expect(isolate.node.disconnect).toHaveBeenCalled()
    expect(source.disconnect).toHaveBeenCalled()
    expect(source.connect).toHaveBeenLastCalledWith(context.destination)
  })

  it('never leaves an unhandled rejection when stop or setTranspose is refused', async () => {
    const stretch = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {
        throw new Error('nope')
      }),
      schedule: vi.fn(async () => {
        throw new Error('nope')
      }),
    }
    stretchFactory.mockResolvedValue(stretch)
    const { context } = fakeContext()
    const stage = await createAudioStage(context, element)

    expect(() => stage.stop()).not.toThrow()
    expect(() => stage.setTranspose(1)).not.toThrow()
    // Lets the rejected promises settle so a missing .catch would surface as an unhandled
    // rejection rather than pass silently.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
