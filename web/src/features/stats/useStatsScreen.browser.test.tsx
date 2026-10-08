import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { DEFAULT_FILTERS, FACET_LABELS, META_CATALOG_FILTERS } from '../catalog/filters'
import { FILTER_SAVE_ERROR } from '../catalog/useCatalogFilters'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import { useStatsScreen } from './useStatsScreen'

const NOW = new Date('2026-10-04T12:00:00.000Z')

let db: CrosstuneDb

beforeEach(() => {
  sessionStorage.clear()
  db = openTestDb()
})

function setup() {
  const openCatalog = vi.fn()
  const view = renderHook(() => useStatsScreen({ openCatalog, now: NOW }), {
    wrapper: dataProviders({ db }),
  })
  return { ...view, openCatalog }
}

describe('useStatsScreen', () => {
  it('filters the catalog by the one value alone and clears the query', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, key: 'D', genre: 'Irish' })
    writeSearchQuery('catalog', 'reel')
    const { result, openCatalog } = setup()
    await expect.poll(() => result.current.view).toBeDefined()
    await act(() => result.current.filterCatalog({ status: 'learning' }, FACET_LABELS.key))
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toEqual({
      ...DEFAULT_FILTERS,
      status: 'learning',
    })
    expect(readSearchQuery('catalog')).toBe('')
    expect(openCatalog).toHaveBeenCalledOnce()
  })

  it('reports a failed write under the group that made it and stays put', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeSearchQuery('catalog', 'reel')
    const { result, openCatalog } = setup()
    await expect.poll(() => result.current.view).toBeDefined()
    db.close()
    await act(() => result.current.filterCatalog({ genre: 'Irish' }, FACET_LABELS.genre))
    await expect.poll(() => result.current.filterError(FACET_LABELS.genre)).toBe(FILTER_SAVE_ERROR)
    expect(result.current.filterError(FACET_LABELS.composer)).toBeNull()
    expect(readSearchQuery('catalog')).toBe('reel')
    expect(openCatalog).not.toHaveBeenCalled()
  })

  it('reports a later failure only under the header that made it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = setup()
    await expect.poll(() => result.current.view).toBeDefined()
    db.close()
    await act(() => result.current.filterCatalog({ genre: 'Irish' }, FACET_LABELS.genre))
    await expect.poll(() => result.current.filterError(FACET_LABELS.genre)).toBe(FILTER_SAVE_ERROR)
    await act(() => result.current.filterCatalog({ composer: 'Ed Haley' }, FACET_LABELS.composer))
    await expect
      .poll(() => result.current.filterError(FACET_LABELS.composer))
      .toBe(FILTER_SAVE_ERROR)
    expect(result.current.filterError(FACET_LABELS.genre)).toBeNull()
  })
})
