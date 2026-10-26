import { expect, it } from 'vitest'
import {
  createSearchDebouncer,
  SEARCH_DEBOUNCE_MS,
  type DebouncedSearch,
  type DebounceClock,
} from './searchDebouncer'

function setup() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 0
  const clock: DebounceClock = {
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
  const reports: DebouncedSearch[] = []
  const debouncer = createSearchDebouncer(clock, (search) => reports.push(search))
  return { debouncer, advance, reports }
}

it('counts a query after the pause and reports once when the search ends', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.setCount(4)
  debouncer.typed('rev')
  advance(SEARCH_DEBOUNCE_MS - 1)
  debouncer.finish()
  expect(reports).toEqual([{ resultCount: 4, addedTypedTitle: false }])
  debouncer.finish()
  expect(reports).toHaveLength(1)
})

it('keeps the count the query showed when the pause ended', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.setCount(4)
  debouncer.typed('reel')
  advance(SEARCH_DEBOUNCE_MS)
  debouncer.setCount(9)
  debouncer.typed('')
  expect(reports).toEqual([{ resultCount: 4, addedTypedTitle: false }])
})

it('reports a counted query when a different one counts', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.setCount(4)
  debouncer.typed('reel')
  advance(SEARCH_DEBOUNCE_MS)
  debouncer.setCount(1)
  debouncer.typed('reeler')
  expect(reports).toEqual([])
  advance(SEARCH_DEBOUNCE_MS)
  expect(reports).toEqual([{ resultCount: 4, addedTypedTitle: false }])
  debouncer.finish()
  expect(reports[1]).toEqual({ resultCount: 1, addedTypedTitle: false })
})

it('does not report the same query twice', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.setCount(4)
  debouncer.typed('reel')
  advance(SEARCH_DEBOUNCE_MS)
  debouncer.typed('reel ')
  advance(SEARCH_DEBOUNCE_MS)
  expect(reports).toEqual([])
})

it('reports took_offer when the typed title was added as a tune', () => {
  const { debouncer, reports } = setup()
  debouncer.setCount(0)
  debouncer.typed('kesh jig')
  debouncer.finish(true)
  expect(reports).toEqual([{ resultCount: 0, addedTypedTitle: true }])
})

it('reports nothing for a search that never counted or has no results yet', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.typed('reel')
  advance(SEARCH_DEBOUNCE_MS)
  debouncer.finish()
  debouncer.setCount(3)
  debouncer.typed('jig')
  debouncer.typed('')
  expect(reports).toEqual([])
})

it('counts a query whose pause ended while its results were loading once they load', () => {
  const { debouncer, advance, reports } = setup()
  debouncer.setCount(undefined)
  debouncer.typed('reel')
  advance(SEARCH_DEBOUNCE_MS)
  debouncer.setCount(undefined)
  debouncer.setCount(3)
  debouncer.finish()
  expect(reports).toEqual([{ resultCount: 3, addedTypedTitle: false }])
})
