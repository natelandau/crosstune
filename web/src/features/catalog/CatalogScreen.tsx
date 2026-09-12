import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import { SongCard } from './SongCard'
import {
  DEFAULT_FILTERS,
  facetValues,
  filterCatalog,
  type CatalogEntry,
  type CatalogFilters,
} from './filters'
import { useCatalog } from './useCatalog'
import { useCatalogFilters } from './useCatalogFilters'

export function CatalogScreen() {
  const entries = useCatalog()
  const [filters, updateFilters] = useCatalogFilters()
  if (filters === undefined) return null
  return <Catalog entries={entries} filters={filters} updateFilters={updateFilters} />
}

function Catalog({
  entries,
  filters,
  updateFilters,
}: {
  entries: CatalogEntry[] | undefined
  filters: CatalogFilters
  updateFilters: (patch: Partial<CatalogFilters>) => Promise<void>
}) {
  // The search box holds its own state so typing filters immediately instead of
  // waiting on the persisted round trip through the meta table.
  const [query, setQuery] = useState(filters.query)

  const activeFilters = useMemo(() => ({ ...filters, query }), [filters, query])
  const facets = useMemo(() => facetValues(entries ?? []), [entries])
  const visible = useMemo(
    () => filterCatalog(entries ?? [], activeFilters),
    [entries, activeFilters],
  )
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
            void updateFilters({ query: e.target.value })
          }}
        />
      </label>
      <FilterBar
        filters={filters}
        facets={facets}
        onChange={(patch) => void updateFilters(patch)}
      />
      {entries === undefined ? null : visible.length === 0 ? (
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
