import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setRecordingsSort, useRecordingsSort } from '../recordings/recordingsSort'
import { CATALOG_SORT_KEY, pickCatalogSort, setCatalogSort, useCatalogSort } from './useCatalogSort'

afterEach(() => {
  localStorage.clear()
  // The module remembers the last choice; a cleared-storage event resets it between tests.
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
  })
})

describe('catalog sort preference', () => {
  it('defaults to title, A to Z', () => {
    const { result } = renderHook(() => useCatalogSort())
    expect(result.current).toEqual({ sort: 'title', descending: false })
  })

  it('stores a choice on the device and reads it back after a reload', () => {
    const { result } = renderHook(() => useCatalogSort())
    act(() => setCatalogSort({ sort: 'played', descending: true }))
    expect(result.current).toEqual({ sort: 'played', descending: true })
    expect(JSON.parse(localStorage.getItem(CATALOG_SORT_KEY) ?? '')).toEqual({
      sort: 'played',
      descending: true,
    })
  })

  it('keeps its choice apart from the Recordings screen', () => {
    const catalog = renderHook(() => useCatalogSort())
    const recordings = renderHook(() => useRecordingsSort())
    act(() => setCatalogSort({ sort: 'added', descending: false }))
    act(() => setRecordingsSort({ sort: 'tune', descending: true }))
    expect(catalog.result.current).toEqual({ sort: 'added', descending: false })
    expect(recordings.result.current).toEqual({ sort: 'tune', descending: true })
  })
})

describe('pickCatalogSort', () => {
  it('starts every date sort newest first and Title at A', () => {
    const title = { sort: 'title', descending: false } as const
    expect(pickCatalogSort(title, 'added')).toEqual({ sort: 'added', descending: true })
    expect(pickCatalogSort(title, 'modified')).toEqual({ sort: 'modified', descending: true })
    expect(pickCatalogSort(title, 'played')).toEqual({ sort: 'played', descending: true })
    expect(pickCatalogSort({ sort: 'played', descending: true }, 'title')).toEqual(title)
  })

  it('reverses the current sort when it is picked again', () => {
    expect(pickCatalogSort({ sort: 'played', descending: true }, 'played')).toEqual({
      sort: 'played',
      descending: false,
    })
    expect(pickCatalogSort({ sort: 'title', descending: false }, 'title')).toEqual({
      sort: 'title',
      descending: true,
    })
  })
})
