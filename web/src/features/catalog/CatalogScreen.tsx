import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Plus, SquarePen, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { setArchived } from '../../commands/songs'
import { EmptyState } from '../../components/EmptyState'
import { useOpenRow } from '../../components/swipe'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../db/types'
import { useSelectMode } from '../../editMode'
import { SongSelectionActions } from '../selection/SongSelectionActions'
import { useSongSelectionMode } from '../selection/useSongSelectionMode'
import { useInstruments } from '../settings/useInstruments'
import { FilterBar } from './FilterBar'
import { SearchSuggestion } from './SearchSuggestion'
import { SongRow } from './SongRow'
import {
  DEFAULT_FILTERS,
  facetValues,
  filterCatalog,
  hiddenResets,
  visibleFacets,
  type CatalogEntry,
  type CatalogFilters,
} from './filters'
import { enterAction, searchOutcome, type EnterAction } from './searchIntent'
import { readSearchQuery, writeSearchQuery } from './searchSession'
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
  const [query, setQuery] = useState(readSearchQuery)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const db = useDb()
  const rowState = useOpenRow()
  const { error, run, runThen } = useAction()
  const { select: selecting, setSelect } = useSelectMode()

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
  const visible = useMemo(
    () => filterCatalog(entries, effectiveFilters, query),
    [entries, effectiveFilters, query],
  )
  const visibleIds = useMemo(() => visible.map((entry) => entry.userSong.id), [visible])
  // Destructured so JSX below reads plain locals rather than member expressions on an
  // object that also carries selectButtonRef, which the ref-access lint rule flags.
  const { selection, selectButtonRef, enter, exit, rowSelection } = useSongSelectionMode({
    visibleIds,
    active: selecting,
    setActive: setSelect,
    // useOpenRow closes whichever row is open regardless of the id asked for.
    onEnter: () => rowState('').closeOpenRow(),
  })
  const selectedEntries = visible.filter((entry) => selection.isSelected(entry.userSong.id))
  const outcome = useMemo(
    () => searchOutcome(entries, visible, query, effectiveFilters.archived),
    [entries, visible, query, effectiveFilters.archived],
  )
  const filtering = JSON.stringify(effectiveFilters) !== JSON.stringify(DEFAULT_FILTERS)

  const changeQuery = (value: string) => {
    setQuery(value)
    writeSearchQuery(value)
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    // Opening or adding a song while selecting would leave the screen and drop the selection.
    const action: EnterAction = selecting ? { kind: 'blur' } : enterAction(query, visible, outcome)
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
  if (outcome.kind === 'create' && !outcome.another) {
    emptyTitle = `No song called "${outcome.title}"`
  }

  return (
    // Lets the last row scroll clear of the floating add link, which would cover its swipe actions.
    <div className="space-y-3 pb-12">
      <h1 className="sr-only">Catalog</h1>
      <form role="search" onSubmit={submitSearch}>
        <label className="input w-full">
          <input
            ref={searchRef}
            type="search"
            // The native cancel button is missing in Firefox and too small to tap in WebKit.
            className="grow [&::-webkit-search-cancel-button]:appearance-none"
            placeholder="Search songs"
            aria-label="Search songs"
            enterKeyHint="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="btn btn-ghost btn-circle btn-sm -mr-2"
              aria-label="Clear search"
              onClick={() => {
                changeQuery('')
                searchRef.current?.focus()
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </label>
      </form>
      <FilterBar
        filters={effectiveFilters}
        facets={facets}
        visible={visibleFacetList}
        onChange={(patch) => void update(patch)}
        // The query stays: clearing the other filters is what brings a hidden match into view.
        onClear={filtering ? () => void updateFilters(DEFAULT_FILTERS) : undefined}
        trailing={
          visible.length > 0 || selecting ? (
            <button
              ref={selectButtonRef}
              type="button"
              className={`btn btn-sm ml-auto min-h-11 transition-[opacity,scale] duration-(--select-bar-duration) ease-(--ease-emphasized) ${
                selecting ? 'pointer-events-none opacity-0 motion-safe:scale-90' : ''
              }`}
              aria-hidden={selecting}
              tabIndex={selecting ? -1 : undefined}
              onClick={() => enter()}
            >
              Select
            </button>
          ) : null
        }
      />
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          hint={noSongs ? 'Add the first tune you know.' : undefined}
          action={selecting ? null : <SearchSuggestion outcome={outcome} placement="empty" />}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((entry, index) => {
              const { song, userSong } = entry
              const archived = userSong.archived_at !== null
              return (
                <li key={userSong.id}>
                  <SongRow
                    entry={entry}
                    instruments={instruments}
                    {...rowState(userSong.id)}
                    selection={rowSelection(userSong.id, index)}
                    actions={[
                      {
                        label: 'Edit',
                        tone: 'neutral',
                        icon: <SquarePen aria-hidden="true" className="size-5" />,
                        onPress: () =>
                          void navigate({
                            to: '/songs/$id',
                            params: { id: song.id },
                            search: { edit: true },
                            state: { editPushed: true },
                          }),
                      },
                      {
                        label: archived ? 'Unarchive' : 'Archive',
                        tone: 'warning',
                        icon: archived ? (
                          <ArchiveRestore aria-hidden="true" className="size-5" />
                        ) : (
                          <Archive aria-hidden="true" className="size-5" />
                        ),
                        onPress: () => run(() => setArchived(db, userSong.id, !archived)),
                      },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
          {selecting ? null : <SearchSuggestion outcome={outcome} placement="list" />}
        </>
      )}
      <SongSelectionActions
        active={selecting}
        entries={selectedEntries}
        allSelected={selection.allSelected}
        instruments={instruments}
        context={{ kind: 'catalog' }}
        runThen={runThen}
        onToggleAll={selection.toggleAll}
        onExit={exit}
      />
      <Link
        to="/songs/new"
        className={`btn btn-primary btn-circle btn-lg fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom)+var(--player-dock-height,0px))] z-10 shadow-lg transition-[opacity,scale] duration-(--select-bar-duration) ease-(--ease-emphasized) ${
          selecting ? 'pointer-events-none opacity-0 motion-safe:scale-60' : ''
        }`}
        aria-label="Add song"
        aria-hidden={selecting}
        tabIndex={selecting ? -1 : undefined}
      >
        <Plus aria-hidden="true" className="size-7" />
      </Link>
    </div>
  )
}
