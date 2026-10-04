import { describe, expect, it } from 'vitest'
import { heardLengthMs, PlayLog, type PlayRecord } from './playLog'

function setup() {
  let t = 1_000_000
  const written: PlayRecord[] = []
  const log = new PlayLog(
    () => t,
    (record) => written.push(record),
  )
  const advance = (ms: number) => {
    t += ms
  }
  return { log, written, advance, at: () => t }
}

describe('PlayLog', () => {
  it('writes nothing under ten seconds', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'row' }, 60_000)
    log.playing(true)
    advance(9_999)
    log.playing(false)
    log.end()
    expect(written).toEqual([])
  })

  it('writes a play at ten seconds', () => {
    const { log, written, advance, at } = setup()
    const startedAt = at()
    log.start('rec-1', { context: 'row' }, 60_000)
    log.playing(true)
    advance(10_000)
    log.end()
    expect(written).toEqual([
      {
        recordingId: 'rec-1',
        context: 'row',
        listId: null,
        startedAt,
        listenedMs: 10_000,
      },
    ])
  })

  it('a short item played to the end counts', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'dock' }, 4_000)
    log.playing(true)
    advance(4_000)
    log.playing(false)
    log.end()
    expect(written.map((r) => r.listenedMs)).toEqual([4_000])
  })

  it('pause and resume is one play', () => {
    const { log, written, advance, at } = setup()
    log.start('rec-1', { context: 'row' }, 60_000)
    advance(500)
    const startedAt = at()
    log.playing(true)
    advance(6_000)
    log.playing(false)
    // Paused time is not audible.
    advance(30_000)
    log.playing(true)
    advance(6_000)
    log.end()
    expect(written).toEqual([expect.objectContaining({ startedAt, listenedMs: 12_000 })])
  })

  it('a new item ends the previous one', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'row' }, 60_000)
    log.playing(true)
    advance(15_000)
    log.start('rec-2', { context: 'row' }, 60_000)
    expect(written.map((r) => [r.recordingId, r.listenedMs])).toEqual([['rec-1', 15_000]])
    expect(log.current).toBe('rec-2')
    // The new item starts paused; only a fresh playing signal counts toward it.
    advance(20_000)
    log.end()
    expect(written).toHaveLength(1)
  })

  it('context and list id are kept', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'list', listId: 'list-1' }, 60_000)
    log.playing(true)
    advance(11_000)
    log.end()
    expect(written).toEqual([
      expect.objectContaining({ context: 'list', listId: 'list-1', listenedMs: 11_000 }),
    ])
  })

  it('an unknown length waits for ten seconds', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'row' })
    log.playing(true)
    advance(5_000)
    log.end()
    expect(written).toEqual([])
  })

  it('takes the length the engine reports once loaded', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'row' })
    log.setLength(3_000)
    log.playing(true)
    advance(3_000)
    log.end()
    expect(written.map((r) => r.listenedMs)).toEqual([3_000])
  })

  it('flush writes the open play and opens a fresh one for the same item', () => {
    const { log, written, advance, at } = setup()
    log.start('rec-1', { context: 'list', listId: 'list-1' }, 60_000)
    log.playing(true)
    advance(20_000)
    log.flush()
    expect(written.map((r) => r.listenedMs)).toEqual([20_000])
    expect(log.current).toBe('rec-1')
    const resumedAt = at()
    log.playing(true)
    advance(12_000)
    log.end()
    expect(written[1]).toEqual(
      expect.objectContaining({ context: 'list', listId: 'list-1', startedAt: resumedAt }),
    )
  })

  it('drop forgets the open play', () => {
    const { log, written, advance } = setup()
    log.start('rec-1', { context: 'row' }, 60_000)
    log.playing(true)
    advance(30_000)
    log.drop()
    log.end()
    expect(written).toEqual([])
    expect(log.current).toBeNull()
  })
})

describe('heardLengthMs', () => {
  it('scales the length by the playback speed', () => {
    expect(heardLengthMs(6_000, 100)).toBe(6_000)
    expect(heardLengthMs(6_000, 150)).toBe(4_000)
    expect(heardLengthMs(6_000, 50)).toBe(12_000)
  })
})
