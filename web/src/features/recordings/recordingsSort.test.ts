import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SORT } from './arrangeRecordings'
import { RECORDINGS_SORT_KEY, setRecordingsSort, useRecordingsSort } from './recordingsSort'

function storageChangedElsewhere(key: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  // The module remembers the last choice; a cleared-storage event resets it between tests.
  storageChangedElsewhere(null)
})

describe('recordings sort preference', () => {
  it('defaults to date added, newest first', () => {
    const { result } = renderHook(() => useRecordingsSort())
    expect(result.current).toEqual({ sort: 'added', descending: true })
    expect(result.current).toEqual(DEFAULT_SORT)
  })

  it('ignores a choice stored under the earlier key', () => {
    localStorage.setItem(
      'crosstune.recordingsSort',
      JSON.stringify({ sort: 'recorded', descending: false }),
    )
    storageChangedElsewhere(null)
    const { result } = renderHook(() => useRecordingsSort())
    expect(RECORDINGS_SORT_KEY).toBe('crosstune.recordingsSort.v2')
    expect(result.current).toEqual({ sort: 'added', descending: true })
  })

  it('stores a choice as JSON and returns it', () => {
    const { result } = renderHook(() => useRecordingsSort())
    act(() => setRecordingsSort({ sort: 'title', descending: false }))
    expect(result.current).toEqual({ sort: 'title', descending: false })
    expect(JSON.parse(localStorage.getItem(RECORDINGS_SORT_KEY) ?? '')).toEqual({
      sort: 'title',
      descending: false,
    })
  })

  it('falls back to the default for a stored unknown sort', () => {
    localStorage.setItem(RECORDINGS_SORT_KEY, JSON.stringify({ sort: 'size', descending: true }))
    storageChangedElsewhere(RECORDINGS_SORT_KEY)
    const { result } = renderHook(() => useRecordingsSort())
    expect(result.current).toEqual(DEFAULT_SORT)
  })

  it('falls back to the default for unparsable storage', () => {
    localStorage.setItem(RECORDINGS_SORT_KEY, '{nope')
    storageChangedElsewhere(RECORDINGS_SORT_KEY)
    const { result } = renderHook(() => useRecordingsSort())
    expect(result.current).toEqual(DEFAULT_SORT)
  })

  it('follows a choice made in another tab', () => {
    const { result } = renderHook(() => useRecordingsSort())
    localStorage.setItem(RECORDINGS_SORT_KEY, JSON.stringify({ sort: 'tune', descending: true }))
    storageChangedElsewhere(RECORDINGS_SORT_KEY)
    expect(result.current).toEqual({ sort: 'tune', descending: true })
  })

  it('works in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    storageChangedElsewhere(null)
    const { result } = renderHook(() => useRecordingsSort())
    expect(result.current).toEqual(DEFAULT_SORT)
    act(() => setRecordingsSort({ sort: 'tune', descending: false }))
    expect(result.current).toEqual({ sort: 'tune', descending: false })
  })
})
