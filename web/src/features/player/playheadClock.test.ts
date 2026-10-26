import { afterEach, describe, expect, it } from 'vitest'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { TICK_MS, type EngineClock } from './playbackEngine'
import { PlayheadClock, type FrameSource } from './playheadClock'

const LENGTH_MS = 60_000

/** Frames that run only when the test steps them. */
function manualFrames() {
  const due = new Map<number, () => void>()
  let next = 0
  const frames: FrameSource = {
    request: (fn) => {
      due.set(++next, fn)
      return next
    },
    cancel: (id) => {
      due.delete(id)
    },
  }
  const step = () => {
    const now = [...due.values()]
    due.clear()
    for (const fn of now) fn()
  }
  return { frames, step, pending: () => due.size }
}

let disconnect: (() => void) | null = null

afterEach(() => {
  disconnect?.()
  disconnect = null
})

function setup() {
  const element = new FakeAudioElement()
  let tick = () => {}
  const engineClock: EngineClock = {
    every: (_ms, fn) => {
      tick = fn
      return () => {}
    },
    after: () => () => {},
  }
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement, engineClock)
  engine.load(
    'blob:test',
    { fromS: 0, toS: LENGTH_MS / 1000, lengthMs: LENGTH_MS },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Test recording' },
  )
  let t = 1000
  const { frames, step, pending } = manualFrames()
  const clock = new PlayheadClock(engine, { frames, now: () => t })
  disconnect = clock.connect()
  const calls: number[] = []
  clock.subscribe(() => calls.push(clock.ms))
  /** The element plays on to `ms` and the engine reports it at its tick. */
  const report = (ms: number) => {
    element.currentTime = ms / 1000
    tick()
  }
  return {
    engine,
    clock,
    calls,
    step,
    pending,
    report,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('PlayheadClock', () => {
  it('runs on between the engine reports at the playing speed', () => {
    const { engine, clock, report, advance, step } = setup()
    engine.play()
    report(10_000)
    report(10_050)
    advance(20)
    step()
    expect(clock.ms).toBe(10_070)
    engine.setSpeed(50)
    report(10_075)
    report(10_100)
    advance(20)
    step()
    expect(clock.ms).toBe(10_110)
  })

  it('waits for the next report rather than running far past the last one', () => {
    const { engine, clock, report, advance, step } = setup()
    engine.play()
    report(10_000)
    report(10_050)
    advance(10 * TICK_MS)
    step()
    expect(clock.ms).toBe(10_050 + 2 * TICK_MS)
  })

  it('holds a report a little behind what it drew, and snaps to a seek', () => {
    const { engine, clock, report, advance, step } = setup()
    engine.play()
    report(10_000)
    report(10_050)
    advance(40)
    step()
    expect(clock.ms).toBe(10_090)
    report(10_080)
    step()
    expect(clock.ms).toBe(10_090)
    engine.seek(5_000)
    expect(clock.ms).toBe(5_000)
  })

  it('stops its frames on pause and snaps to where the engine stopped', () => {
    const { engine, clock, report, step, pending } = setup()
    engine.play()
    report(10_000)
    step()
    expect(pending()).toBe(1)
    report(10_040)
    engine.pause()
    expect(pending()).toBe(0)
    expect(clock.ms).toBe(10_040)
  })

  it('draws a scrub in place of the engine and runs no frames under it', () => {
    const { engine, clock, pending, calls, step } = setup()
    engine.play()
    clock.setScrub(-400)
    expect(clock.ms).toBe(-400)
    expect(calls.at(-1)).toBe(-400)
    step()
    expect(pending()).toBe(0)
    clock.setScrub(null)
    expect(clock.ms).toBe(0)
    expect(pending()).toBe(1)
  })

  it('runs frames only while playing', () => {
    const { engine, clock, pending } = setup()
    expect(pending()).toBe(0)
    engine.play()
    expect(pending()).toBe(1)
    engine.pause()
    expect(pending()).toBe(0)
    expect(clock.running).toBe(false)
  })
})
