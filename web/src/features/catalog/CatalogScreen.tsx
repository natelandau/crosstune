import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { Instrument } from '../../db/types'
import { useInstruments } from '../settings/useInstruments'
import { FilterBar } from './FilterBar'
import { SearchSuggestion } from './SearchSuggestion'
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
import { enterAction, searchOutcome } from './searchIntent'
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
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

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
  const outcome = useMemo(
    () => searchOutcome(entries, visible, query, effectiveFilters.archived),
    [entries, visible, query, effectiveFilters.archived],
  )
  const filtering =
    JSON.stringify({ ...effectiveFilters, query: DEFAULT_FILTERS.query }) !==
    JSON.stringify(DEFAULT_FILTERS)

  // The query stays: it names the song the user is looking for, and clearing the other
  // filters is what brings a hidden match into view.
  const clearFilters = () => {
    void updateFilters({ ...DEFAULT_FILTERS, query })
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const action = enterAction(query, visible, outcome)
    if (action.kind === 'open') {
      void navigate({ to: '/songs/$id', params: { id: action.songId } })
    } else if (action.kind === 'create') {
      void navigate({ to: '/songs/new', search: { title: action.title } })
    } else {
      searchRef.current?.blur()
    }
  }

  const noSongs = entries.length === 0 && !query.trim()
  let emptyTitle = noSongs ? 'No songs yet' : 'Nothing matches'
  if (outcome.kind === 'create') emptyTitle = `No song called "${outcome.title}"`

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Catalog</h1>
      <form role="search" onSubmit={submitSearch}>
        <label className="input w-full">
          <input
            ref={searchRef}
            type="search"
            className="grow"
            placeholder="Search songs"
            aria-label="Search songs"
            enterKeyHint="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              void update({ query: e.target.value })
            }}
          />
        </label>
      </form>
      <FilterBar
        filters={effectiveFilters}
        facets={facets}
        visible={visibleFacetList}
        onChange={(patch) => void update(patch)}
      />
      {visible.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          hint={noSongs ? 'Add the first tune you know.' : undefined}
          action={
            outcome.kind === 'none' && !filtering ? null : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <SearchSuggestion outcome={outcome} placement="empty" />
                {filtering ? (
                  <button type="button" className="btn btn-sm" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((entry) => (
              <li key={entry.userSong.id}>
                <SongCard entry={entry} />
              </li>
            ))}
          </ul>
          <SearchSuggestion outcome={outcome} placement="list" />
        </>
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
