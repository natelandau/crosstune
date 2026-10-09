import { describe, expect, it } from 'vitest'
import { PracticeLog, type ClosedVisit, type PracticeRecord } from './practiceLog'

function setup() {
  let t = 2_000_000
  const written: PracticeRecord[] = []
  const closed: ClosedVisit[] = []
  const log = new PracticeLog(
    () => t,
    (record) => written.push(record),
    (visit) => closed.push(visit),
  )
  const advance = (ms: number) => {
    t += ms
  }
  return { log, written, closed, advance, at: () => t }
}

const DEFAULTS = { speedPercent: 100, pitchCents: 0 }

describe('PracticeLog', () => {
  it('a loop session is practice', () => {
    const { log, written, advance, at } = setup()
    log.open('rec-1', DEFAULTS)
    advance(1_000)
    const startedAt = at()
    log.playing(true)
    log.usedLoop('loop-1')
    advance(8_000)
    log.usedLoop('loop-2')
    log.usedLoop('loop-1')
    advance(4_000)
    log.playing(false)
    expect(log.close()).toBe('practice')
    expect(written).toEqual([
      {
        recordingId: 'rec-1',
        startedAt,
        durationMs: 12_000,
        loopIds: ['loop-1', 'loop-2'],
        speedPercent: 100,
        pitchCents: 0,
      },
    ])
  })

  it('slowed down session is practice with the longest speed', () => {
    const { log, written, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    advance(5_000)
    log.setSpeed(75)
    advance(20_000)
    log.setSpeed(90)
    log.setPitch(-100)
    advance(6_000)
    expect(log.close()).toBe('practice')
    expect(written).toEqual([
      expect.objectContaining({
        durationMs: 31_000,
        loopIds: [],
        speedPercent: 75,
        pitchCents: 0,
      }),
    ])
  })

  it('a setting changed while paused counts only once it plays', () => {
    const { log, written, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.setSpeed(50)
    advance(60_000)
    log.setSpeed(100)
    log.playing(true)
    advance(30_000)
    expect(log.close()).toBe('play')
    expect(written).toEqual([])
  })

  it('default settings fall back to a play', () => {
    const { log, written, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    advance(40_000)
    expect(log.close()).toBe('play')
    expect(written).toEqual([])
  })

  it('practice under ten seconds writes nothing', () => {
    const { log, written, advance } = setup()
    log.open('rec-1', { speedPercent: 80, pitchCents: 0 })
    log.playing(true)
    advance(9_000)
    expect(log.close()).toBeNull()
    expect(written).toEqual([])
  })

  it('closing resets for the next visit', () => {
    const { log, written, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    log.usedLoop('loop-1')
    advance(12_000)
    log.close()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    advance(12_000)
    expect(log.close()).toBe('play')
    expect(written).toHaveLength(1)
  })

  it('reports no visit that was not practice', () => {
    const { log, closed, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    advance(40_000)
    log.playing(false)
    // Set away from normal but never played, which alone is not practice.
    log.setSpeed(80)
    expect(log.close()).toBe('play')
    expect(closed).toEqual([])
  })

  it('reports short practice it does not write, with a setting set but never played', () => {
    const { log, written, closed, advance } = setup()
    log.open('rec-1', DEFAULTS)
    log.playing(true)
    log.usedLoop('loop-1')
    advance(3_000)
    log.playing(false)
    log.setPitch(200)
    expect(log.close()).toBeNull()
    expect(written).toEqual([])
    expect(closed).toEqual([
      {
        recordingId: 'rec-1',
        durationMs: 3_000,
        usedLoops: true,
        usedSpeed: false,
        usedPitch: true,
      },
    ])
  })

  it('reports nothing for a visit that never sounded', () => {
    const { log, closed } = setup()
    log.open('rec-1', DEFAULTS)
    log.setSpeed(80)
    log.close()
    expect(closed).toEqual([])
  })
})
