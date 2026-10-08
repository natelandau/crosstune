import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DESELECT_ALL, SELECT_ALL } from './selectionCopy'
import { useSelectionTitle } from './useSelectionTitle'

const title = (count: number, total: number) =>
  renderHook(() => useSelectionTitle(count, total)).result.current

describe('useSelectionTitle', () => {
  it('counts what is selected and names the tunes aloud', () => {
    expect(title(3, 5)).toEqual({
      title: '3 selected',
      spoken: '3 tunes selected',
      selectAllLabel: SELECT_ALL,
    })
    expect(title(1, 5).spoken).toBe('1 tune selected')
  })

  it('offers Deselect all once everything is selected', () => {
    expect(title(5, 5).selectAllLabel).toBe(DESELECT_ALL)
  })

  it('offers Select all over an empty screen', () => {
    expect(title(0, 0).selectAllLabel).toBe(SELECT_ALL)
  })
})
