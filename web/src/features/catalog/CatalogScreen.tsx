import { Link } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { Instrument } from '../../db/types'
import { useInstruments } from '../settings/useInstruments'
import { FilterBar } from './FilterBar'
import { SongCard } from './SongCard'
import {
  DEFAULT_FILTERS,
  facetValues,
  filterCatalog,
  hiddenResets,
  visibleFacets,
  type CatalogEntry,
  type CatalogFilters,
} from './filters'
import { useCatalog } from './useCatalog'
import { useCatalogFilters } from './useCatalogFilters'

export function CatalogScreen() {
  const entries = useCatalog()
  const [filters, updateFilters] = useCatalogFilters()
  const instruments = useInstruments()
  if (entries === undefined || filters === undefined || instruments === undefined) return null
  return (
    <Catalog
      entries={entries}
      filters={filters}
      instruments={instruments}
      updateFilters={updateFilters}
    />
  )
}

function Catalog({
  entries,
  filters,
  instruments,
  updateFilters,
}: {
  entries: CatalogEntry[]
  filters: CatalogFilters
  instruments: ReadonlySet<Instrument>
  updateFilters: (patch: Partial<CatalogFilters>) => Promise<void>
}) {
  // The search box holds its own state so typing filters immediately instead of
  // waiting on the persisted round trip through the meta table.
  const [query, setQuery] = useState(filters.query)

  const facets = useMemo(() => facetValues(entries), [entries])
  const visibleFacetList = useMemo(() => visibleFacets(facets, instruments), [facets, instruments])
  // A facet the bar does not show must not narrow the list, whatever storage holds, and
  // every write forgets it so re-enabling the instrument later does not resurrect it.
  const resets = useMemo(() => hiddenResets(visibleFacetList), [visibleFacetList])
  const effectiveFilters = useMemo(() => ({ ...filters, ...resets }), [filters, resets])
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => updateFilters({ ...resets, ...patch }),
    [resets, updateFilters],
  )
  const activeFilters = useMemo(() => ({ ...effectiveFilters, query }), [effectiveFilters, query])
  const visible = useMemo(() => filterCatalog(entries, activeFilters), [entries, activeFilters])
  const filtering = JSON.stringify(activeFilters) !== JSON.stringify(DEFAULT_FILTERS)

  const clearFilters = () => {
    setQuery(DEFAULT_FILTERS.query)
    void updateFilters(DEFAULT_FILTERS)
  }

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Catalog</h1>
      <label className="input w-full">
        <input
          type="search"
          className="grow"
          placeholder="Search songs"
          aria-label="Search songs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            void update({ query: e.target.value })
          }}
        />
      </label>
      <FilterBar
        filters={effectiveFilters}
        facets={facets}
        visible={visibleFacetList}
        onChange={(patch) => void update(patch)}
      />
      {visible.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'No songs yet' : 'Nothing matches'}
          hint={entries.length === 0 ? 'Add the first tune you know.' : undefined}
          action={
            filtering ? (
              <button type="button" className="btn btn-sm" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((entry) => (
            <li key={entry.userSong.id}>
              <SongCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/songs/new"
        className="btn btn-primary btn-circle btn-lg fixed right-4 bottom-20 shadow-lg"
        aria-label="Add song"
      >
        +
      </Link>
    </div>
  )
}
