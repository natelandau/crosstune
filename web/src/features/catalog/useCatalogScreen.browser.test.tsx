import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { readSearchQuery, writeSearchQuery } from './searchSession'
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

function setup() {
  const onOpenTune = vi.fn()
  const onCreate = vi.fn()
  const view = renderHook(() => useCatalogScreen({ onOpenTune, onCreate }), {
    wrapper: dataProviders({ db }),
  })
  return { ...view, onOpenTune, onCreate }
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
})
