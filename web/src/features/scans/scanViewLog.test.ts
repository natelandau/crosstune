import { describe, expect, it } from 'vitest'
import { SCAN_VIEW_THRESHOLD_MS, ScanViewLog, type ScanViewRecord } from './scanViewLog'

function setup() {
  let t = 1_000_000
  const written: ScanViewRecord[] = []
  const log = new ScanViewLog(
    () => t,
    (record) => written.push(record),
  )
  const advance = (ms: number) => {
    t += ms
  }
  return { log, written, advance, at: () => t }
}

describe('ScanViewLog', () => {
  it('writes nothing under three seconds', () => {
    const { log, written, advance } = setup()
    log.start('tune-1', { context: 'tune' })
    advance(SCAN_VIEW_THRESHOLD_MS - 1)
    log.end()
    expect(written).toEqual([])
  })

  it('writes a view at three seconds', () => {
    const { log, written, advance, at } = setup()
    const startedAt = at()
    log.start('tune-1', { context: 'tune' })
    advance(SCAN_VIEW_THRESHOLD_MS)
    log.end()
    expect(written).toEqual([
      { tuneId: 'tune-1', context: 'tune', listId: null, startedAt, viewedMs: 3_000 },
    ])
  })

  it('keeps the context and list it was opened from', () => {
    const { log, written, advance } = setup()
    log.start('tune-1', { context: 'list', listId: 'list-1' })
    advance(5_000)
    log.end()
    log.start('tune-2', { context: 'row' })
    advance(5_000)
    log.end()
    expect(written.map((r) => [r.tuneId, r.context, r.listId])).toEqual([
      ['tune-1', 'list', 'list-1'],
      ['tune-2', 'row', null],
    ])
  })

  it('leaving the foreground ends the view and coming back starts a new one', () => {
    const { log, written, advance, at } = setup()
    const first = at()
    log.start('tune-1', { context: 'row' })
    advance(4_000)
    log.visible(false)
    expect(written.map((r) => [r.startedAt, r.viewedMs])).toEqual([[first, 4_000]])
    advance(60_000)
    const second = at()
    log.visible(true)
    advance(3_500)
    log.end()
    expect(written.map((r) => [r.startedAt, r.viewedMs])).toEqual([
      [first, 4_000],
      [second, 3_500],
    ])
  })

  it('counts no time out of the foreground and never writes a view twice', () => {
    const { log, written, advance } = setup()
    log.start('tune-1', { context: 'tune' })
    advance(1_000)
    log.visible(false)
    log.visible(false)
    advance(10_000)
    log.end()
    log.end()
    log.visible(true)
    advance(10_000)
    log.end()
    expect(written).toEqual([])
  })

  it('a second show of the page keeps the view under way', () => {
    const { log, written, advance } = setup()
    log.start('tune-1', { context: 'tune' })
    advance(2_000)
    log.visible(true)
    advance(2_000)
    log.end()
    expect(written.map((r) => r.viewedMs)).toEqual([4_000])
  })

  it('starting another viewer ends the open one', () => {
    const { log, written, advance } = setup()
    log.start('tune-1', { context: 'tune' })
    advance(3_000)
    log.start('tune-2', { context: 'tune' })
    expect(written.map((r) => r.tuneId)).toEqual(['tune-1'])
  })
})
