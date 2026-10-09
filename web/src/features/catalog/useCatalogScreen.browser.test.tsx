import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { type SettleClock } from '../../usage/searchSettler'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { readSearchQuery, writeSearchQuery } from '../../ui/searchSession'
import { useCatalogScreen } from './useCatalogScreen'

let db: CrosstuneDb
const ids: Record<string, string> = {}

beforeEach(async () => {
  sessionStorage.clear()
  db = openTestDb()
  for (const title of ["Soldier's Joy", 'The Banshee', 'Drowsy Maggie', 'Cooley’s']) {
    const { tuneId, userTuneId } = await createTune(db, { title }, { status: 'known' })
    ids[title] = tuneId
    ids[`${title}:user`] = userTuneId
  }
})

/** A clock a test steps by hand, so a search settles exactly when the test says. */
function manualClock() {
  const pending = new Set<() => void>()
  const clock: SettleClock = {
    after: (_ms, run) => {
      pending.add(run)
      return () => void pending.delete(run)
    },
  }
  const pause = () => {
    for (const run of [...pending]) {
      pending.delete(run)
      run()
    }
  }
  return { clock, pause }
}

function setup() {
  const onOpenTune = vi.fn()
  const onCreate = vi.fn()
  const analytics = recordingAnalytics()
  const { clock, pause } = manualClock()
  const view = renderHook(() => useCatalogScreen({ onOpenTune, onCreate, settleClock: clock }), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...view, onOpenTune, onCreate, analytics, pause }
}

async function ready(result: { current: ReturnType<typeof useCatalogScreen> }) {
  await expect.poll(() => result.current.ready).toBe(true)
}

describe('useCatalogScreen', () => {
  it('opens the only result on Enter', async () => {
    const { result, onOpenTune, onCreate } = setup()
    await ready(result)
    act(() => result.current.setQuery('banshee'))
    expect(result.current.submit()).toEqual({ kind: 'open', tuneId: ids['The Banshee'] })
    expect(onOpenTune).toHaveBeenCalledExactlyOnceWith(ids['The Banshee'])
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('creates the typed title on Enter when nothing matches', async () => {
    const { result, onOpenTune, onCreate } = setup()
    await ready(result)
    act(() => result.current.setQuery('  Kesh Jig '))
    act(() => void result.current.submit())
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('Kesh Jig')
    expect(onOpenTune).not.toHaveBeenCalled()
    expect(result.current.query).toBe('')
    expect(readSearchQuery('catalog')).toBe('')
  })

  it('only blurs on Enter with two or more results', async () => {
    const { result, onOpenTune, onCreate } = setup()
    await ready(result)
    act(() => result.current.setQuery('e'))
    expect(result.current.tunes.length).toBeGreaterThan(1)
    expect(result.current.submit()).toEqual({ kind: 'blur' })
    expect(onOpenTune).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('leaves focus alone on Enter while the data is loading', () => {
    const { result, onOpenTune, onCreate } = setup()
    expect(result.current.ready).toBe(false)
    expect(result.current.submit()).toBeNull()
    expect(onOpenTune).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('only blurs on Enter while selecting', async () => {
    const { result, onOpenTune } = setup()
    await ready(result)
    act(() => result.current.setQuery('banshee'))
    expect(result.current.submit(true)).toEqual({ kind: 'blur' })
    expect(onOpenTune).not.toHaveBeenCalled()
  })

  it('reports an exact title hidden by archiving, and Enter opens it', async () => {
    await setArchived(db, ids['The Banshee:user']!, true)
    const { result, onOpenTune } = setup()
    await ready(result)
    await expect.poll(() => result.current.tunes).toHaveLength(3)
    act(() => result.current.setQuery('The Banshee'))
    const outcome = result.current.searchOutcome
    expect(outcome.kind === 'create' && outcome.hidden?.reason).toBe('archived')
    expect(outcome.kind === 'create' && outcome.hidden?.entry.tune.id).toBe(ids['The Banshee'])
    act(() => void result.current.submit())
    expect(onOpenTune).toHaveBeenCalledExactlyOnceWith(ids['The Banshee'])
  })

  it('reports an exact title hidden by a filter, and Enter opens it', async () => {
    const { result, onOpenTune } = setup()
    await ready(result)
    act(() => result.current.setQuery('The Banshee'))
    await act(() => result.current.setFilters({ status: 'learning' }))
    await expect.poll(() => result.current.tunes).toHaveLength(0)
    const outcome = result.current.searchOutcome
    expect(outcome.kind === 'create' && outcome.hidden?.reason).toBe('filtered')
    act(() => void result.current.submit())
    expect(onOpenTune).toHaveBeenCalledExactlyOnceWith(ids['The Banshee'])
  })

  it('creates from the search and ends it', async () => {
    const { result, onCreate } = setup()
    await ready(result)
    act(() => result.current.setQuery('Kesh Jig'))
    act(() => result.current.createFromSearch())
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('Kesh Jig')
    expect(result.current.query).toBe('')
  })

  it('reads "N of M tunes" while narrowed and the plain count otherwise', async () => {
    const { result } = setup()
    await ready(result)
    await expect.poll(() => result.current.countLabel).toBe('4 tunes')
    act(() => result.current.setQuery('banshee'))
    expect(result.current.countLabel).toBe('1 of 4 tunes')
    expect(result.current.counts).toMatchObject({ visible: 1, total: 4, all: 4 })
  })

  it('announces the count when the stored tunes change, not on each keystroke', async () => {
    const { result } = setup()
    await ready(result)
    expect(result.current.announcement).toBe('')
    act(() => result.current.setQuery('banshee'))
    expect(result.current.announcement).toBe('')
    await createTune(db, { title: 'Kesh Jig' }, { status: 'known' })
    await expect.poll(() => result.current.announcement).toBe('1 of 5 tunes')
  })

  it('keeps the session query and re-reads it on refresh', async () => {
    writeSearchQuery('catalog', 'maggie')
    const { result } = setup()
    expect(result.current.query).toBe('maggie')
    act(() => writeSearchQuery('catalog', 'joy'))
    expect(result.current.query).toBe('maggie')
    act(() => result.current.refreshQuery())
    expect(result.current.query).toBe('joy')
  })

  it('merges a filter write onto the effective filters', async () => {
    const { result } = setup()
    await ready(result)
    await act(() => result.current.setFilters({ archived: true }))
    await expect.poll(() => result.current.effectiveFilters.archived).toBe(true)
    expect(result.current.sheetCount).toBeGreaterThan(0)
  })

  describe('analytics', () => {
    it('reports a search once it settles and ends, with the count it settled on', async () => {
      const { result, analytics, pause } = setup()
      await ready(result)
      act(() => result.current.setQuery('banshee'))
      expect(analytics.sends()).toEqual([])
      act(() => pause())
      expect(analytics.sends()).toEqual([])
      act(() => result.current.setQuery(''))
      expect(analytics.sends()).toEqual([
        { name: 'search_performed', props: { result_count_bucket: '1-9', took_offer: false } },
      ])
    })

    it('reports the settled query when a different one settles', async () => {
      const { result, analytics, pause } = setup()
      await ready(result)
      act(() => result.current.setQuery('banshee'))
      act(() => pause())
      act(() => result.current.setQuery('zzz'))
      act(() => pause())
      expect(analytics.sends()).toEqual([
        { name: 'search_performed', props: { result_count_bucket: '1-9', took_offer: false } },
      ])
      act(() => result.current.setQuery(''))
      expect(analytics.sends()).toHaveLength(2)
      expect(analytics.sends()[1]!.props).toEqual({ result_count_bucket: '0', took_offer: false })
    })

    it('reports took_offer when the typed title is taken to a new tune', async () => {
      const { result, analytics, pause } = setup()
      await ready(result)
      act(() => result.current.setQuery('Kesh Jig'))
      act(() => pause())
      act(() => result.current.createFromSearch())
      expect(analytics.sends()).toEqual([
        { name: 'search_performed', props: { result_count_bucket: '0', took_offer: true } },
      ])
    })

    it('reports a search that was open when the screen goes', async () => {
      const { result, analytics, pause, unmount } = setup()
      await ready(result)
      act(() => result.current.setQuery('banshee'))
      act(() => pause())
      unmount()
      expect(analytics.sends()).toHaveLength(1)
    })

    it('ends the search when a result is opened', async () => {
      const { result, analytics, pause } = setup()
      await ready(result)
      act(() => result.current.setQuery('banshee'))
      act(() => pause())
      act(() => result.current.endSearch())
      act(() => result.current.endSearch())
      expect(analytics.sends()).toHaveLength(1)
    })

    it('reports a filter applied, once the write lands, and not one cleared', async () => {
      const { result, analytics } = setup()
      await ready(result)
      await act(() => result.current.setFilters({ status: 'known', 'tuning:violin': 'AEAE' }))
      await expect.poll(() => analytics.sends().length).toBe(2)
      expect(analytics.sends().map((send) => send.props)).toEqual([
        { filter: 'status' },
        { filter: 'tuning' },
      ])
      await act(() => result.current.setFilters({ status: 'all' }))
      await expect.poll(() => result.current.effectiveFilters.status).toBe('all')
      expect(analytics.sends()).toHaveLength(2)
    })

    it('reports a sort chosen', async () => {
      const { result, analytics } = setup()
      await ready(result)
      act(() => result.current.setSort({ sort: 'added', descending: true }))
      expect(analytics.sends()).toEqual([{ name: 'catalog_sorted', props: { sort: 'added' } }])
    })
  })
})
