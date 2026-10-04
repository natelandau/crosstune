import { afterEach, describe, expect, it, vi } from 'vitest'
import { compensatedSemitones, type PitchStage } from './pitchStage'
import { PlaybackEngine, type EngineClock, type PlaybackState } from './playbackEngine'

/** jsdom has no AudioContext; state stays 'running' unless a test suspends or interrupts it. */
class FakeAudioContext {
  /** Every instance this test has constructed, so a test can grab the one `prime()` built (no
   * `createStage` call hands it back) or prove one was reused rather than built twice. Reset
   * in `afterEach`. */
  static instances: FakeAudioContext[] = []
  static get created() {
    return FakeAudioContext.instances.length
  }

  state: 'running' | 'suspended' | 'interrupted' | 'closed' = 'running'
  // A real context processes suspend()/resume()/close() as control messages in call order,
  // asynchronously: the state does not flip the instant one is called. Queuing each behind
  // the last (rather than flipping `state` synchronously, as an earlier version of this fake
  // did) reproduces that: a resume queued right after a still-pending suspend still lands
  // after it and wins, exactly as the real API orders it.
  #queue: Promise<void> = Promise.resolve()
  #settle(next: FakeAudioContext['state']): Promise<void> {
    this.#queue = this.#queue.then(async () => {
      this.state = next
    })
    return this.#queue
  }

  resume = vi.fn(() => this.#settle('running'))
  suspend = vi.fn(() => this.#settle('suspended'))
  close = vi.fn(() => this.#settle('closed'))

  constructor() {
    FakeAudioContext.instances.push(this)
  }
}

class FakeAudioElement extends EventTarget {
  src = ''
  currentTime = 0
  playbackRate = 1
  preservesPitch = false
  paused = true

  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

function fakeElement(): FakeAudioElement {
  return new FakeAudioElement()
}

function fakeClock(): {
  clock: EngineClock
  tick: () => void
  after: ReturnType<typeof vi.fn>
  fire: () => void
} {
  let onTick: (() => void) | null = null
  let pending: (() => void) | null = null
  const after = vi.fn((_ms: number, fn: () => void) => {
    pending = fn
    return () => {
      pending = null
    }
  })
  return {
    clock: {
      every: (_ms, fn) => {
        onTick = fn
        return () => {
          onTick = null
        }
      },
      after,
    },
    tick: () => onTick?.(),
    after,
    fire: () => pending?.(),
  }
}

/** Stubs `navigator.mediaSession`, which jsdom does not implement at all. */
function fakeMediaSession(): {
  session: MediaSession
  handlers: Map<MediaSessionAction, MediaSessionActionHandler>
} {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>()
  const session = {
    metadata: null,
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      if (handler) handlers.set(action, handler)
      else handlers.delete(action)
    },
    setPositionState: () => {},
  } as unknown as MediaSession
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
  return { session, handlers }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaSession')
  Reflect.deleteProperty(navigator, 'audioSession')
  vi.unstubAllGlobals()
  FakeAudioContext.instances = []
})

const span = { fromS: 2, toS: 10, lengthMs: 8000 }
const settings = { speedPercent: 100, pitchCents: 0 }
const meta = { title: 'Test recording' }

describe('PlaybackEngine', () => {
  it('seek(0) sets currentTime to the trim start', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    element.currentTime = 999
    engine.seek(0)
    expect(element.currentTime).toBe(2)
  })

  it('stops at the trim end', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.play()
    element.currentTime = 11
    tick()
    expect(element.paused).toBe(true)
    expect(element.currentTime).toBe(2)
  })

  it('takes an unknown window end from the loaded audio once its duration is known', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', { fromS: 0, toS: Infinity, lengthMs: 0 }, settings, meta)
    engine.play()
    element.currentTime = 1
    tick()
    expect(element.paused).toBe(false)

    Object.defineProperty(element, 'duration', { value: 12, configurable: true })
    element.dispatchEvent(new Event('durationchange'))
    expect(engine.getState().lengthMs).toBe(12_000)
  })

  it('reports not playing once its own stop at the trim end pauses the element', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.play()
    expect(engine.getState().playing).toBe(true)
    const pause = vi.spyOn(engine, 'pause')
    element.currentTime = 10
    tick()
    // The tick pauses the element directly; only its native pause event updates the state.
    expect(pause).not.toHaveBeenCalled()
    expect(engine.getState()).toMatchObject({ playing: false, positionMs: 0 })
  })

  it('setSpeed(75) sets playbackRate to 0.75 and preserves pitch', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.setSpeed(75)
    expect(element.playbackRate).toBe(0.75)
    expect(element.preservesPitch).toBe(true)
  })

  it('reports the speed and pitch it plays at', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, { speedPercent: 80, pitchCents: 200 }, meta)
    expect(engine.getState()).toMatchObject({ speedPercent: 80, pitchCents: 200 })
    engine.setSpeed(75)
    engine.setPitch(-100)
    expect(engine.getState()).toMatchObject({ speedPercent: 75, pitchCents: -100 })
  })

  it('a load notifies once, with the new recording whole', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:one', span, settings, meta)
    const states: PlaybackState[] = []
    engine.subscribe((state) => states.push(state))
    engine.load(
      'blob:two',
      { fromS: 0, toS: 4, lengthMs: 4000 },
      { speedPercent: 70, pitchCents: 100 },
      meta,
    )
    expect(states).toEqual([
      expect.objectContaining({ lengthMs: 4000, speedPercent: 70, pitchCents: 100 }),
    ])
  })

  it('reports positionMs relative to the trim start', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    const states: PlaybackState[] = []
    engine.subscribe((state) => states.push(state))
    engine.load('blob:test', span, settings, meta)
    element.currentTime = 5
    tick()
    expect(states.at(-1)?.positionMs).toBe(3000)
  })

  it('notifies nobody on a tick that changes nothing, but always on a load', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.load('blob:test', span, settings, meta)
    engine.load('blob:test', span, settings, meta, { keepLoop: true })
    expect(listener).toHaveBeenCalledTimes(2)
    tick()
    tick()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('reports the lock-screen position on a jump and about once a second while playing', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const { session } = fakeMediaSession()
    const setPositionState = vi.spyOn(session, 'setPositionState')
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    expect(setPositionState).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 40; i++) tick()
    expect(setPositionState).toHaveBeenCalledTimes(1)
    element.paused = false
    setPositionState.mockClear()
    for (let i = 0; i < 40; i++) tick()
    expect(setPositionState).toHaveBeenCalledTimes(2)
    element.currentTime = 10
    tick()
    expect(setPositionState).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0 }))
  })

  it('derives playing from the element rather than assuming its own call succeeded', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.play()
    expect(engine.getState().playing).toBe(true)
    // A lock-screen control, media key, or headset disconnect pauses the element directly,
    // without going through pause() below.
    element.dispatchEvent(new Event('pause'))
    expect(engine.getState().playing).toBe(false)
  })

  it('pause() pauses the element', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.play()
    engine.pause()
    expect(element.paused).toBe(true)
    expect(engine.getState().playing).toBe(false)
  })

  it('setWindow moves the length and clamps the current position into the new range', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    element.currentTime = 20
    engine.setWindow({ fromS: 3, toS: 9, lengthMs: 6000 })
    expect(element.currentTime).toBe(9)
    expect(engine.getState().lengthMs).toBe(6000)
  })

  it('setPitch stores the value without touching the element', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.setPitch(700)
    expect(engine.pitchCents).toBe(700)
    expect(element.playbackRate).toBe(1)
  })

  it('unload stops the tick, pauses, and releases the source', () => {
    const element = fakeElement()
    const { clock, tick } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.play()
    engine.unload()
    expect(element.paused).toBe(true)
    expect(element.src).toBe('')
    expect(engine.getState()).toEqual({
      playing: false,
      positionMs: 0,
      lengthMs: 0,
      failed: false,
      pitchUnavailable: false,
      loop: null,
      repeat: false,
      speedPercent: 100,
      pitchCents: 0,
    })
    element.currentTime = 999
    tick()
    expect(element.currentTime).toBe(999)
  })

  it('loads and plays again after unload, since the engine outlives any one recording', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:first', span, settings, meta)
    engine.play()
    engine.unload()

    engine.load('blob:second', span, settings, meta)
    engine.play()
    expect(element.paused).toBe(false)
    expect(engine.getState().playing).toBe(true)
  })

  it('getState() returns the same reference between changes', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    expect(engine.getState()).toBe(engine.getState())
  })

  it('registers a Media Session play handler that plays the element', () => {
    const { handlers } = fakeMediaSession()
    const element = fakeElement()
    const { clock } = fakeClock()
    new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    handlers.get('play')?.({} as MediaSessionActionDetails)
    expect(element.paused).toBe(false)
  })

  it('keeps Media Session action handlers registered through an unload', () => {
    const { handlers } = fakeMediaSession()
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.unload()
    expect(handlers.has('play')).toBe(true)
  })

  it('clears Media Session action handlers on dispose', () => {
    const { handlers } = fakeMediaSession()
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    expect(handlers.has('play')).toBe(true)
    engine.dispose()
    expect(handlers.size).toBe(0)
  })

  it('reacts to the element and the lock screen again once revived', () => {
    const { handlers } = fakeMediaSession()
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.dispose()
    engine.revive()
    engine.load('blob:test', span, settings, meta)

    element.play()
    expect(engine.getState().playing).toBe(true)
    element.pause()
    expect(engine.getState().playing).toBe(false)
    expect(handlers.has('pause')).toBe(true)
  })

  it('stops reacting to the element after dispose', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.dispose()

    element.play()
    expect(engine.getState().playing).toBe(false)
  })

  it('prime does nothing when AudioContext cannot be constructed', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    // No AudioContext stubbed: jsdom has none at all.
    expect(() => engine.prime()).not.toThrow()
  })

  it('prime creates the AudioContext that a later pitch stage reuses, not a second one', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const element = fakeElement()
    const { clock } = fakeClock()
    const { stage } = fakeStage()
    const createStage = vi.fn(async () => stage)
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
    engine.load('blob:test', span, settings, meta)

    engine.prime()
    expect(createStage).not.toHaveBeenCalled()

    engine.setPitch(200)
    await createStage.mock.results[0]?.value

    expect(FakeAudioContext.created).toBe(1)
  })

  it('unload suspends an existing AudioContext, so nothing holds the session while it is not needed', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    engine.prime()
    const context = FakeAudioContext.instances[0]!

    engine.unload()

    expect(context.suspend).toHaveBeenCalled()
  })

  it('resumes even while an unload from a switch has a suspend still pending, so it never lands silently suspended', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const element = fakeElement()
    const { clock } = fakeClock()
    const { stage } = fakeStage()
    const createStage = vi.fn(async () => stage)
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
    engine.load('blob:first', span, settings, meta)
    engine.setPitch(200)
    await createStage.mock.results[0]?.value
    const context = FakeAudioContext.instances[0]!

    engine.unload() // queues a suspend; the real API does not flip state synchronously
    expect(context.state).toBe('running') // still mid-flight: this is the race window

    engine.load('blob:second', span, settings, meta)
    engine.play() // must resume despite state still reading 'running'

    expect(context.resume).toHaveBeenCalled()
    await context.resume.mock.results.at(-1)?.value
    expect(context.state).toBe('running')
  })

  it('unload leaves no AudioContext alone: nothing to suspend, nothing thrown', () => {
    const element = fakeElement()
    const { clock } = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock)
    engine.load('blob:test', span, settings, meta)
    expect(() => engine.unload()).not.toThrow()
  })

  it('dispose disposes the pitch stage and closes the AudioContext', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const element = fakeElement()
    const { clock } = fakeClock()
    const { stage, dispose } = fakeStage()
    const createStage = vi.fn(async () => stage)
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
    engine.load('blob:test', span, settings, meta)
    engine.setPitch(200)
    await createStage.mock.results[0]?.value
    const context = FakeAudioContext.instances[0]!

    engine.dispose()

    expect(dispose).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
  })

  function fakeStage(): {
    stage: PitchStage
    setTranspose: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } {
    const setTranspose = vi.fn()
    const start = vi.fn(async () => {})
    const stop = vi.fn()
    const dispose = vi.fn()
    return { stage: { setTranspose, start, stop, dispose }, setTranspose, start, stop, dispose }
  }

  describe('pitch shifting', () => {
    it('setPitch(200) creates the stage once and transposes by 2', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, setTranspose } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      engine.setPitch(200)
      await createStage.mock.results[0]?.value

      expect(createStage).toHaveBeenCalledTimes(1)
      expect(setTranspose).toHaveBeenCalledWith(2)
    })

    it('setSpeed(75) after pitch recomputes the transpose', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, setTranspose } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      engine.setSpeed(75)

      expect(setTranspose).toHaveBeenLastCalledWith(compensatedSemitones(200, 75))
    })

    it('setPitch(0) after a stage still corrects for the current speed', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, setTranspose } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      engine.setSpeed(75)
      engine.setPitch(0)

      expect(setTranspose).toHaveBeenLastCalledWith(compensatedSemitones(0, 75))
    })

    it('preservesPitch becomes false once a stage exists', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)
      expect(element.preservesPitch).toBe(true)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value

      expect(element.preservesPitch).toBe(false)
    })

    it('play() creates the stage when the stored pitch is non-zero', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, setTranspose } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, { speedPercent: 100, pitchCents: 200 }, meta)

      engine.play()
      await createStage.mock.results[0]?.value

      expect(createStage).toHaveBeenCalledTimes(1)
      expect(setTranspose).toHaveBeenCalledWith(2)
    })

    it('play() resumes a suspended AudioContext even when the stored pitch is 0', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage } = fakeStage()
      const createStage = vi.fn(async (context: AudioContext) => {
        void context
        return stage
      })
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      const context = createStage.mock.calls[0]?.[0] as unknown as FakeAudioContext
      engine.setPitch(0)
      context.state = 'suspended'

      engine.play()

      expect(context.resume).toHaveBeenCalled()
    })

    it('starts the stage when the element resumes and stops it when the element pauses', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, start, stop } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      expect(start).not.toHaveBeenCalled()

      engine.play()
      expect(start).toHaveBeenCalledTimes(1)

      engine.pause()
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it('reports pitch unavailable when the stage fails to start', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, start } = fakeStage()
      start.mockRejectedValue(new Error('start failed'))
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value

      engine.play()
      await start.mock.results[0]?.value.catch(() => {})

      expect(engine.getState().pitchUnavailable).toBe(true)
    })

    it('hands pitch correction back to the element when the stage fails to start', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage, start } = fakeStage()
      start.mockRejectedValue(new Error('start failed'))
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, { speedPercent: 75, pitchCents: 0 }, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      expect(element.preservesPitch).toBe(false)

      engine.play()
      await start.mock.results[0]?.value.catch(() => {})

      expect(element.preservesPitch).toBe(true)
    })

    it('play() re-claims the playback audio session once the graph exists', async () => {
      const audioSession = { type: '' }
      Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true })
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value
      // A recording since the graph was built would have handed the session back to 'auto'.
      audioSession.type = 'auto'

      engine.play()

      expect(audioSession.type).toBe('playback')
    })

    it('a stage load failure reports pitch unavailable and keeps playing', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const element = fakeElement()
      const { clock } = fakeClock()
      const createStage = vi.fn(async () => {
        throw new Error('worklet unavailable')
      })
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      engine.setPitch(200)
      await createStage.mock.results[0]?.value.catch(() => {})
      expect(engine.getState().pitchUnavailable).toBe(true)

      engine.play()
      expect(element.paused).toBe(false)
    })

    it('a successful retry after a threw-on-construction AudioContext clears pitchUnavailable', async () => {
      const element = fakeElement()
      const { clock } = fakeClock()
      const { stage } = fakeStage()
      const createStage = vi.fn(async () => stage)
      const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, clock, createStage)
      engine.load('blob:test', span, settings, meta)

      // No AudioContext stubbed yet: `new AudioContext()` throws (jsdom has none at all).
      engine.setPitch(200)
      expect(engine.getState().pitchUnavailable).toBe(true)
      expect(createStage).not.toHaveBeenCalled()

      vi.stubGlobal('AudioContext', FakeAudioContext)
      engine.setPitch(400)
      await createStage.mock.results[0]?.value

      expect(engine.getState().pitchUnavailable).toBe(false)
    })
  })
})

describe('PlaybackEngine loops', () => {
  const loop = { id: 'l1', label: 'Bridge', fromS: 2, toS: 4 }
  const setup = () => {
    const element = fakeElement()
    const c = fakeClock()
    const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, c.clock)
    engine.load('blob:test', { fromS: 0, toS: 10, lengthMs: 10_000 }, settings, meta)
    return { element, engine, ...c }
  }

  it('wraps to the loop start only when it reaches the end from inside', () => {
    const { element, engine, tick } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 4.02
    tick()
    expect(element.currentTime).toBe(2)
  })

  it('reports a seek, a wrap, and the end of the range as jumps, but not playing on', () => {
    const { element, engine, tick, fire } = setup()
    const jumps = vi.fn()
    const stop = engine.onJump(jumps)
    engine.play()
    element.currentTime = 1
    tick()
    expect(jumps).not.toHaveBeenCalled()

    engine.seek(3000)
    expect(jumps).toHaveBeenCalledTimes(1)

    engine.setLoop(loop)
    engine.setRepeat(true)
    element.currentTime = 4.02
    tick()
    expect(jumps).toHaveBeenCalledTimes(2)
    element.currentTime = 3.99
    tick()
    fire()
    expect(jumps).toHaveBeenCalledTimes(3)

    engine.setRepeat(false)
    element.currentTime = 10
    tick()
    expect(jumps).toHaveBeenCalledTimes(4)

    stop()
    engine.seek(1000)
    expect(jumps).toHaveBeenCalledTimes(4)
  })

  it('plays on past a loop it entered after the loop end', () => {
    const { element, engine, tick } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    engine.seek(5000)
    element.currentTime = 5.5
    tick()
    expect(element.currentTime).toBe(5.5)
  })

  it('plays into the loop from before it and then repeats', () => {
    const { element, engine, tick } = setup()
    engine.setLoop({ ...loop, fromS: 3, toS: 4 })
    engine.setRepeat(true)
    engine.seek(3000)
    engine.seek(1000)
    engine.play()
    element.currentTime = 1.5
    tick()
    element.currentTime = 3.2
    tick()
    element.currentTime = 4.01
    tick()
    expect(element.currentTime).toBe(3)
  })

  it('play with Repeat on outside the loop starts at the loop start', () => {
    const { element, engine } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    element.currentTime = 7
    engine.play()
    expect(element.currentTime).toBe(2)
  })

  it('setRepeat(true) outside the loop moves the playhead to its start', () => {
    const { element, engine } = setup()
    engine.setLoop(loop)
    element.currentTime = 7
    engine.setRepeat(true)
    expect(element.currentTime).toBe(2)
  })

  it('turning Repeat or the loop off never moves the playhead', () => {
    const { element, engine } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    element.currentTime = 3
    engine.setRepeat(false)
    expect(element.currentTime).toBe(3)
    engine.setLoop(null)
    expect(element.currentTime).toBe(3)
  })

  it('schedules the end timer scaled by speed', () => {
    const { element, engine, tick, after, fire } = setup()
    engine.setSpeed(50)
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 3.976
    tick()
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0]![0]).toBeCloseTo(48)
    element.currentTime = 4
    fire()
    expect(element.currentTime).toBe(2)
  })

  it('does not wrap from the end timer after Repeat is turned off', () => {
    const { element, engine, tick, fire } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 3.97
    tick()
    engine.setRepeat(false)
    element.currentTime = 4
    fire()
    expect(element.currentTime).toBe(4)
  })

  it('moving the loop so the playhead is outside jumps to its start', () => {
    const { element, engine } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    element.currentTime = 3
    engine.setLoop({ id: 'l2', label: 'Tail', fromS: 6, toS: 8 })
    expect(element.currentTime).toBe(6)
  })

  it('resumes at the loop start when the loop ends where the media ends', () => {
    const { element, engine, tick } = setup()
    engine.setLoop({ ...loop, fromS: 6, toS: 10 })
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 9.9
    tick()
    element.currentTime = 10
    element.pause()
    element.dispatchEvent(new Event('ended'))
    expect(element.currentTime).toBe(6)
    expect(element.paused).toBe(false)
    expect(engine.getState().playing).toBe(true)
  })

  it('schedules the end timer in wall-clock time at 150% speed', () => {
    const { element, engine, tick, after } = setup()
    engine.setSpeed(150)
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 3.93
    tick()
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0]![0]).toBeCloseTo(46.67, 1)
  })

  it('keeps Repeat and the loop across a same-recording load but suspends wrapping', () => {
    const { element, engine, tick } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.load('blob:two', { fromS: 0, toS: 10, lengthMs: 10_000 }, settings, meta, {
      keepLoop: true,
    })
    expect(engine.getState().repeat).toBe(true)
    expect(engine.getState().loop).toEqual({ id: 'l1', label: 'Bridge' })
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 4.5
    tick()
    expect(element.currentTime).toBe(4.5)
    engine.setLoop(loop)
    element.currentTime = 3
    tick()
    element.currentTime = 4.1
    tick()
    expect(element.currentTime).toBe(2)
  })

  it('repeats only the part of the loop inside the trim window', () => {
    const { element, engine, tick } = setup()
    engine.setWindow({ fromS: 1, toS: 5, lengthMs: 4000 })
    engine.setLoop({ ...loop, fromS: 3, toS: 8 })
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 4
    tick()
    element.currentTime = 5
    tick()
    expect(element.currentTime).toBe(3)
    expect(element.paused).toBe(false)
  })

  it('treats a loop wholly outside the trim window as no loop', () => {
    const { element, engine } = setup()
    engine.setWindow({ fromS: 1, toS: 5, lengthMs: 4000 })
    element.currentTime = 2
    engine.setLoop({ ...loop, fromS: 6, toS: 8 })
    engine.setRepeat(true)
    engine.play()
    expect(element.currentTime).toBe(2)
  })

  it('a window change that moves the playhead drops a pending wrap', () => {
    const { element, engine, tick, fire } = setup()
    engine.setLoop({ ...loop, fromS: 2, toS: 6 })
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 5
    tick()
    element.currentTime = 5.97
    tick()
    engine.setWindow({ fromS: 0, toS: 5.5, lengthMs: 5500 })
    expect(element.currentTime).toBe(5.5)
    fire()
    expect(element.currentTime).toBe(5.5)
  })

  it('re-arms the end timer instead of wrapping early when playback stalls', () => {
    const { element, engine, tick, after, fire } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 3.96
    tick()
    expect(after).toHaveBeenCalledTimes(1)
    fire()
    expect(element.currentTime).toBe(3.96)
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('reports reaching the end of the range or the media as an end, but never a wrap', () => {
    const { element, engine, tick } = setup()
    const ends = vi.fn()
    const stop = engine.onEnded(ends)
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 3
    tick()
    element.currentTime = 4.02
    tick()
    expect(ends).not.toHaveBeenCalled()

    engine.setRepeat(false)
    element.currentTime = 10
    tick()
    expect(ends).toHaveBeenCalledTimes(1)

    engine.play()
    element.dispatchEvent(new Event('ended'))
    expect(ends).toHaveBeenCalledTimes(2)
    stop()
    element.dispatchEvent(new Event('ended'))
    expect(ends).toHaveBeenCalledTimes(2)
  })

  it('wraps and plays again when a tick finds the media ended at the loop end', () => {
    const { element, engine, tick } = setup()
    engine.setLoop({ ...loop, fromS: 6, toS: 10 })
    engine.setRepeat(true)
    engine.play()
    element.currentTime = 9.9
    tick()
    // The element stopped at the media end without its ended event having run yet.
    element.paused = true
    Object.assign(element, { ended: true })
    element.currentTime = 10
    tick()
    expect(element.currentTime).toBe(6)
    expect(element.paused).toBe(false)
  })

  it('hands out a copy of the loop range', () => {
    const { engine } = setup()
    engine.setLoop({ ...loop })
    // The type already forbids the write; this checks a caller that casts it away.
    Object.assign(engine.loopRange!, { fromS: 0 })
    expect(engine.loopRange).toEqual(loop)
  })

  it('load clears the loop and Repeat', () => {
    const { engine } = setup()
    engine.setLoop(loop)
    engine.setRepeat(true)
    engine.load('blob:two', span, settings, meta)
    expect(engine.getState().loop).toBeNull()
    expect(engine.getState().repeat).toBe(false)
  })

  it('state reports loop and repeat', () => {
    const { engine } = setup()
    expect(engine.getState().loop).toBeNull()
    engine.setLoop(loop)
    engine.setRepeat(true)
    expect(engine.getState().loop).toEqual({ id: 'l1', label: 'Bridge' })
    expect(engine.getState().repeat).toBe(true)
    engine.setLoop({ ...loop, label: 'Renamed' })
    expect(engine.getState().loop).toEqual({ id: 'l1', label: 'Renamed' })
  })
})
