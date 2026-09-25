import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTuneSelection } from './useTuneSelection'

const IDS = ['a', 'b', 'c', 'd', 'e']

function setup(initial: { ids?: readonly string[]; active?: boolean } = {}) {
  return renderHook(({ ids, active }) => useTuneSelection(ids, active), {
    initialProps: { ids: initial.ids ?? IDS, active: initial.active ?? true },
  })
}

describe('useTuneSelection', () => {
  it('toggles a tune on and off', () => {
    const { result } = setup()
    act(() => result.current.toggle('b'))
    expect(result.current.isSelected('b')).toBe(true)
    expect(result.current.count).toBe(1)
    act(() => result.current.toggle('b'))
    expect(result.current.count).toBe(0)
  })

  it('selects all visible tunes and deselects them', () => {
    const { result } = setup()
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(5)
    expect(result.current.allSelected).toBe(true)
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(0)
    expect(result.current.allSelected).toBe(false)
  })

  it('is never all selected with nothing visible', () => {
    const { result } = setup({ ids: [] })
    expect(result.current.allSelected).toBe(false)
  })

  it('selects a range downward from the last toggled tune', () => {
    const { result } = setup()
    act(() => result.current.toggle('b'))
    act(() => result.current.toggleRange('d'))
    expect(['a', 'b', 'c', 'd', 'e'].map(result.current.isSelected)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })

  it('selects a range upward from the last toggled tune', () => {
    const { result } = setup()
    act(() => result.current.toggle('d'))
    act(() => result.current.toggleRange('a'))
    expect(result.current.count).toBe(4)
    expect(result.current.isSelected('e')).toBe(false)
  })

  it('treats a range with no anchor as a toggle', () => {
    const { result } = setup()
    act(() => result.current.toggleRange('c'))
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('c')).toBe(true)
  })

  it('drops tunes that are no longer visible', () => {
    const { result, rerender } = setup()
    act(() => result.current.toggleAll())
    rerender({ ids: ['a', 'c'], active: true })
    expect(result.current.count).toBe(2)
    expect(result.current.isSelected('b')).toBe(false)
    rerender({ ids: IDS, active: true })
    expect(result.current.isSelected('b')).toBe(false)
  })

  it('clears when selection mode ends', () => {
    const { result, rerender } = setup()
    act(() => result.current.toggle('a'))
    rerender({ ids: IDS, active: false })
    expect(result.current.count).toBe(0)
  })

  it('keeps a tune toggled just before selection mode starts', () => {
    const { result, rerender } = setup({ active: false })
    act(() => result.current.toggle('c'))
    rerender({ ids: IDS, active: true })
    expect(result.current.isSelected('c')).toBe(true)
  })

  it('clears when selection mode ends while the visible tunes change', () => {
    const { result, rerender } = setup()
    act(() => result.current.toggleAll())
    rerender({ ids: ['a', 'c'], active: false })
    expect(result.current.count).toBe(0)
    rerender({ ids: IDS, active: true })
    expect(result.current.count).toBe(0)
  })

  it('selectAll selects every visible tune', () => {
    const { result } = setup()
    act(() => result.current.selectAll())
    expect(result.current.count).toBe(5)
    expect(result.current.allSelected).toBe(true)
  })

  it('clear empties the selection and forgets the range anchor', () => {
    const { result } = setup()
    act(() => result.current.toggle('b'))
    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
    act(() => result.current.toggleRange('d'))
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('d')).toBe(true)
  })

  it('keeps its callbacks stable across renders that change nothing', () => {
    const { result, rerender } = setup()
    const first = result.current
    rerender({ ids: IDS, active: true })
    expect(result.current.isSelected).toBe(first.isSelected)
    expect(result.current.toggleRange).toBe(first.toggleRange)
    expect(result.current.toggleAll).toBe(first.toggleAll)
  })
})
