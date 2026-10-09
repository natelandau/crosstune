import { expect, it } from 'vitest'
import { appliedFilters } from './appliedFilters'
import { DEFAULT_FILTERS } from './filters'

it('names each kind set once, mapping every instrument tuning to tuning', () => {
  expect(
    appliedFilters(DEFAULT_FILTERS, {
      status: 'known',
      key: 'D',
      'tuning:violin': 'AEAE',
      archived: true,
      missing: 'genre',
    }),
  ).toEqual(['status', 'key', 'tuning', 'archived', 'missing'])
})

it('ignores a filter cleared, kept, or already on', () => {
  const before = { ...DEFAULT_FILTERS, status: 'known' as const, archived: true }
  expect(
    appliedFilters(before, { status: 'known', archived: true, unheard: false, genre: 'all' }),
  ).toEqual([])
  expect(appliedFilters(before, { status: 'all', archived: false })).toEqual([])
})

it('names a changed value of a filter already set', () => {
  expect(appliedFilters({ ...DEFAULT_FILTERS, status: 'known' }, { status: 'learning' })).toEqual([
    'status',
  ])
})
