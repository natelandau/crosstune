import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FILTERS,
  sheetFacets,
  sheetFilterCount,
  sheetResets,
  type FacetValues,
} from './filters'
import { FilterSheet } from './FilterSheet'

const facets: FacetValues = {
  key: ['A', 'D'],
  mode: ['major', 'mixolydian'],
  violin_tuning: ['AEAE'],
  banjo_tuning: [],
  genre: ['Old-time'],
}
const visible = ['key', 'mode', 'violin_tuning', 'genre'] as const

describe('sheet facet helpers', () => {
  it('owns every visible facet except key', () => {
    expect(sheetFacets(visible)).toEqual(['mode', 'violin_tuning', 'genre'])
  })

  it('counts set sheet filters including archived and resets only those', () => {
    const filters = { ...DEFAULT_FILTERS, key: 'D', mode: 'major', archived: true }
    expect(sheetFilterCount(filters, visible)).toBe(2)
    expect(sheetResets(visible)).toEqual({
      mode: 'all',
      violin_tuning: 'all',
      genre: 'all',
      archived: false,
    })
  })
})

describe('FilterSheet', () => {
  it('shows a chip group per owned facet, the archived switch, and the live count', () => {
    render(
      <FilterSheet
        open
        filters={DEFAULT_FILTERS}
        facets={facets}
        visible={visible}
        counts={{ visible: 11, total: 84, archived: 3, all: 87 }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(dialog).getByText('11 of 84 songs')).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Key' })).toBeNull()
    expect(within(dialog).getByRole('group', { name: 'Mode' })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Violin tuning' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Banjo tuning' })).toBeNull()
    expect(within(dialog).getByRole('checkbox', { name: 'Show archived' })).toBeInTheDocument()
    expect(within(dialog).getByText('3 archived songs')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('applies each tap at once and resets only its own filters', async () => {
    const onChange = vi.fn()
    render(
      <FilterSheet
        open
        filters={{ ...DEFAULT_FILTERS, key: 'D', genre: 'Old-time' }}
        facets={facets}
        visible={visible}
        counts={{ visible: 1, total: 2, archived: 0, all: 2 }}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )
    const mode = screen.getByRole('group', { name: 'Mode' })
    await userEvent.click(within(mode).getByRole('button', { name: 'mixolydian' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'mixolydian' })
    await userEvent.click(within(mode).getByRole('button', { name: 'Any' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    expect(onChange).toHaveBeenLastCalledWith({ archived: true })
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'all',
      violin_tuning: 'all',
      genre: 'all',
      archived: false,
    })
  })

  it('closes on Done', async () => {
    const onClose = vi.fn()
    render(
      <FilterSheet
        open
        filters={DEFAULT_FILTERS}
        facets={facets}
        visible={visible}
        counts={{ visible: 2, total: 2, archived: 0, all: 2 }}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
