import { expect, it } from 'vitest'
import {
  createSearchSettler,
  SEARCH_SETTLE_MS,
  type SettledSearch,
  type SettleClock,
} from './searchSettler'

function setup() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 0
  const clock: SettleClock = {
    after: (ms, run) => {
      const id = next++
      timers.set(id, { at: now + ms, run })
      return () => void timers.delete(id)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue
      timers.delete(id)
      timer.run()
    }
  }
  const reports: SettledSearch[] = []
  const settler = createSearchSettler(clock, (search) => reports.push(search))
  return { settler, advance, reports }
}

it('settles after the pause and reports once when the search ends', () => {
  const { settler, advance, reports } = setup()
  settler.setCount(4)
  settler.typed('rev')
  advance(SEARCH_SETTLE_MS - 1)
  settler.finish()
  expect(reports).toEqual([{ resultCount: 4, tookOffer: false }])
  settler.finish()
  expect(reports).toHaveLength(1)
})

it('keeps the count the query settled on', () => {
  const { settler, advance, reports } = setup()
  settler.setCount(4)
  settler.typed('reel')
  advance(SEARCH_SETTLE_MS)
  settler.setCount(9)
  settler.typed('')
  expect(reports).toEqual([{ resultCount: 4, tookOffer: false }])
})

it('reports a settled query when a different one settles', () => {
  const { settler, advance, reports } = setup()
  settler.setCount(4)
  settler.typed('reel')
  advance(SEARCH_SETTLE_MS)
  settler.setCount(1)
  settler.typed('reeler')
  expect(reports).toEqual([])
  advance(SEARCH_SETTLE_MS)
  expect(reports).toEqual([{ resultCount: 4, tookOffer: false }])
  settler.finish()
  expect(reports[1]).toEqual({ resultCount: 1, tookOffer: false })
})

it('does not report the same query twice', () => {
  const { settler, advance, reports } = setup()
  settler.setCount(4)
  settler.typed('reel')
  advance(SEARCH_SETTLE_MS)
  settler.typed('reel ')
  advance(SEARCH_SETTLE_MS)
  expect(reports).toEqual([])
})

it('reports took_offer when the offer was taken', () => {
  const { settler, reports } = setup()
  settler.setCount(0)
  settler.typed('kesh jig')
  settler.finish(true)
  expect(reports).toEqual([{ resultCount: 0, tookOffer: true }])
})

it('reports nothing for a search that never settled or has no results yet', () => {
  const { settler, advance, reports } = setup()
  settler.typed('reel')
  advance(SEARCH_SETTLE_MS)
  settler.finish()
  settler.setCount(3)
  settler.typed('jig')
  settler.typed('')
  expect(reports).toEqual([])
})

it('settles a query whose pause ended while its results were loading once they load', () => {
  const { settler, advance, reports } = setup()
  settler.setCount(undefined)
  settler.typed('reel')
  advance(SEARCH_SETTLE_MS)
  settler.setCount(undefined)
  settler.setCount(3)
  settler.finish()
  expect(reports).toEqual([{ resultCount: 3, tookOffer: false }])
})
