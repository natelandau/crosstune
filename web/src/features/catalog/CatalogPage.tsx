import {
  IonButton,
  IonList,
  IonRefresher,
  IonRefresherContent,
  useIonRouter,
  type RefresherCustomEvent,
} from '@ionic/react'
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Music,
  Plus,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { setArchived } from '../../commands/songs'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../db/types'
import { usePointer } from '../../platform/pointer'
import { useSyncEngine } from '../../sync/SyncProvider'
import { EmptyState } from '../../ui/EmptyState'
import { InlineError } from '../../ui/InlineError'
import { useMenu } from '../../ui/Menu'
import { Screen } from '../../ui/Screen'
import { SearchField, type SearchFieldHandle } from '../../ui/SearchField'
import { useRowArrowKeys, useSearchShortcut } from '../../ui/useShortcut'
import { SelectionFooter } from '../selection/SelectionFooter'
import { useSelectionToolbar } from '../selection/SelectionToolbar'
import { useBulkActions, type SelectionContext } from '../selection/useBulkActions'
import { useSelection } from '../selection/useSelection'
import { useInstruments } from '../settings/useInstruments'
import { SongFormSheet, type SongFormTarget } from '../song/SongFormSheet'
import { CatalogFilterSheet } from './CatalogFilterSheet'
import { CatalogFilters } from './CatalogFilters'
import {
  facetValues,
  filterCatalog,
  hiddenResets,
  hideArchived,
  sheetFilterCount,
  songCountLabel,
  visibleFacets,
  DEFAULT_FILTERS,
  type CatalogEntry,
  type CatalogFilters as Filters,
} from './filters'
import { HiddenMatchNote, SearchOfferRow } from './SearchOffer'
import { enterAction, searchOutcome, type SearchOutcome } from './searchIntent'
import { clearSearchQuery, readSearchQuery, writeSearchQuery } from './searchSession'
import { SongItem } from './SongItem'
import { useCatalog } from './useCatalog'
import { useCatalogFilters } from './useCatalogFilters'

const NO_ENTRIES: CatalogEntry[] = []
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()
const CATALOG: SelectionContext = { kind: 'catalog' }
// Every suggestion under the search leads off the screen, and leaving drops the selection, so
// while selecting the search offers nothing at all.
const NO_OUTCOME: SearchOutcome = { kind: 'none' }

export function CatalogPage() {
  const loadedEntries = useCatalog()
  const [storedFilters, updateFilters, filterError] = useCatalogFilters()
  const loadedInstruments = useInstruments()
  // One Screen whether or not the data has loaded: swapping the IonPage element after the
  // router outlet has mounted it would leave the outlet holding a detached page.
  const ready =
    loadedEntries !== undefined && storedFilters !== undefined && loadedInstruments !== undefined
  const entries = loadedEntries ?? NO_ENTRIES
  const filters = storedFilters ?? DEFAULT_FILTERS
  const instruments = loadedInstruments ?? NO_INSTRUMENTS
  const db = useDb()
  const engine = useSyncEngine()
  const router = useIonRouter()
  const pointer = usePointer()
  const { error, run } = useAction()
  const [query, setQuery] = useState(readSearchQuery)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState<SongFormTarget | null>(null)
  const searchRef = useRef<SearchFieldHandle>(null)
  const listRef = useRef<HTMLIonListElement>(null)

  const facets = useMemo(() => facetValues(entries), [entries])
  const visibleFacetList = useMemo(() => visibleFacets(facets, instruments), [facets, instruments])
  // A facet the musician cannot see must not narrow the list, and every write forgets it, so
  // turning an instrument back on later does not bring a stale filter back with it.
  const resets = useMemo(() => hiddenResets(visibleFacetList), [visibleFacetList])
  const effective = useMemo(() => ({ ...filters, ...resets }), [filters, resets])
  const update = useCallback(
    (patch: Partial<Filters>) => void updateFilters({ ...resets, ...patch }),
    [resets, updateFilters],
  )
  const visible = useMemo(
    () => filterCatalog(entries, effective, query),
    [entries, effective, query],
  )
  // Catalog-wide counts change with the stored songs, not with each search keystroke.
  const stored = useMemo(
    () => ({
      total: hideArchived(entries, effective.archived).length,
      archived: entries.filter((entry) => entry.userSong.archived_at !== null).length,
      all: entries.length,
    }),
    [entries, effective.archived],
  )
  const counts = useMemo(() => ({ ...stored, visible: visible.length }), [stored, visible.length])
  const countLabel = songCountLabel(counts.visible, counts.total)

  const visibleIds = useMemo(() => visible.map((entry) => entry.userSong.id), [visible])
  // One ref covers both: the arrow keys walk this list, and a swipe leaves a row in it open.
  const closeOpenRow = useCallback(() => void listRef.current?.closeSlidingItems(), [])
  const { active, selection, selectRef, enter, exit, rowSelection, onClickCapture } = useSelection(
    visibleIds,
    closeOpenRow,
  )
  const { isSelected } = selection
  // Filtered out of the visible list rather than gathered from the set, so an action reads the
  // songs in the order the screen shows them.
  const selected = useMemo(
    () => visible.filter((entry) => isSelected(entry.userSong.id)),
    [visible, isSelected],
  )
  const bulk = useBulkActions({ entries: selected, instruments, context: CATALOG, onExit: exit })
  const toolbar = useSelectionToolbar({
    selection,
    actions: bulk.actions,
    more: bulk.more,
    onExit: exit,
  })
  const openMenu = useMenu()

  const outcome = useMemo(
    () => (active ? NO_OUTCOME : searchOutcome(entries, visible, query, effective.archived)),
    [active, entries, visible, query, effective.archived],
  )
  // A count read out on every keystroke would talk over the typing, so the live region only
  // takes a new count when the filters or the stored songs change, and stays quiet on load.
  const [announced, setAnnounced] = useState({ effective, entries, ready, text: '' })
  if (
    announced.effective !== effective ||
    announced.entries !== entries ||
    announced.ready !== ready
  ) {
    setAnnounced({ effective, entries, ready, text: announced.ready && ready ? countLabel : '' })
  }
  const setCount = sheetFilterCount(effective, visibleFacetList)

  useSearchShortcut(useCallback(() => searchRef.current?.focus(), []))
  useRowArrowKeys(listRef)

  const changeQuery = (value: string) => {
    setQuery(value)
    writeSearchQuery(value)
  }
  const openSong = (songId: string) => router.push(`/catalog/${songId}`, 'forward', 'push')
  const createFromSearch = (title: string) => {
    // A song created from the search ends that search, whatever the form's outcome.
    clearSearchQuery()
    setQuery('')
    setForm({ kind: 'new', title })
  }
  const submitSearch = () => {
    if (!ready) return
    // Enter must not navigate while selecting: leaving the screen drops the selection.
    const action = active ? ({ kind: 'blur' } as const) : enterAction(query, visible, outcome)
    if (action.kind === 'open') openSong(action.songId)
    else if (action.kind === 'create') createFromSearch(action.title)
    else searchRef.current?.blur()
  }
  const refresh = (event: RefresherCustomEvent) => {
    void engine.sync().finally(() => event.detail.complete())
  }
  // A sheet owns the screen while it is up, so nothing behind it, not even a long press, opens
  // the mode under it.
  const sheetOwnsScreen = sheetOpen || form !== null

  const noSongs = entries.length === 0 && !query.trim()
  let emptyTitle = noSongs ? 'No songs yet' : 'Nothing matches'
  if (outcome.kind === 'create' && !outcome.another)
    emptyTitle = `No song called "${outcome.title}"`

  return (
    <Screen
      title={active ? toolbar.title : 'Catalog'}
      titleClass={active ? toolbar.titleClass : undefined}
      level="top"
      selecting={active}
      start={active ? toolbar.start : undefined}
      end={
        active ? (
          toolbar.end
        ) : (
          <>
            <IonButton
              className="toolbar-control"
              aria-label={setCount > 0 ? `Filters, ${setCount} set` : 'Filters'}
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal
                aria-hidden="true"
                className={`size-6 ${setCount > 0 ? 'fill-current' : ''}`}
              />
            </IonButton>
            <IonButton
              className="toolbar-control"
              aria-label="Add song"
              onClick={() => setForm({ kind: 'new' })}
            >
              <Plus aria-hidden="true" className="size-7" />
            </IonButton>
            {visible.length > 0 ? (
              <IonButton
                ref={selectRef}
                className="toolbar-control"
                aria-label="More actions"
                onClick={(event) =>
                  openMenu(event, 'More actions', [{ label: 'Select', onPress: () => enter() }])
                }
              >
                <Ellipsis aria-hidden="true" className="size-6" />
              </IonButton>
            ) : null}
          </>
        )
      }
      search={
        <SearchField
          ref={searchRef}
          name="Search songs"
          value={query}
          onInput={changeQuery}
          onEnter={submitSearch}
        />
      }
      refresher={
        pointer === 'touch' ? (
          <IonRefresher slot="fixed" onIonRefresh={refresh}>
            <IonRefresherContent />
          </IonRefresher>
        ) : null
      }
      footer={
        active ? (
          <SelectionFooter selection={selection} actions={bulk.actions} more={bulk.more} />
        ) : null
      }
    >
      <h1 className="sr-only">Catalog</h1>
      {ready ? (
        <>
          <CatalogFilters
            filters={effective}
            facets={facets}
            visible={visibleFacetList}
            onChange={update}
          />
          {filterError ? <InlineError className="px-5 pb-2">{filterError}</InlineError> : null}
          {error ? <InlineError className="px-5 pb-2">{error}</InlineError> : null}
          {bulk.error ? <InlineError className="px-5 pb-2">{bulk.error}</InlineError> : null}
          {visible.length === 0 ? (
            <EmptyState
              icon={Music}
              title={emptyTitle}
              hint={noSongs ? 'Add the first song you know.' : undefined}
              action={
                outcome.kind === 'create' ? (
                  <>
                    <HiddenMatchNote outcome={outcome} onOpen={openSong} />
                    <IonButton shape="round" onClick={() => createFromSearch(outcome.title)}>
                      {outcome.another
                        ? `Add another "${outcome.title}"`
                        : `Add "${outcome.title}"`}
                    </IonButton>
                  </>
                ) : noSongs ? (
                  <IonButton shape="round" onClick={() => setForm({ kind: 'new' })}>
                    Add song
                  </IonButton>
                ) : null
              }
            />
          ) : (
            <>
              <IonList ref={listRef} onClickCapture={onClickCapture}>
                {visible.map((entry) => {
                  const { song, userSong } = entry
                  const archived = userSong.archived_at !== null
                  const row = rowSelection(userSong.id)
                  return (
                    <SongItem
                      key={userSong.id}
                      entry={entry}
                      instruments={instruments}
                      selection={active ? row : undefined}
                      onOpen={() => openSong(song.id)}
                      onLongPress={sheetOwnsScreen ? undefined : row.onLongPress}
                      actions={
                        active
                          ? undefined
                          : [
                              {
                                label: 'Edit',
                                icon: SquarePen,
                                tone: 'neutral',
                                onPress: () => setForm({ kind: 'edit', entry }),
                              },
                              {
                                label: archived ? 'Unarchive' : 'Archive',
                                icon: archived ? ArchiveRestore : Archive,
                                tone: 'warning',
                                onPress: () => run(() => setArchived(db, userSong.id, !archived)),
                              },
                            ]
                      }
                    />
                  )
                })}
                <SearchOfferRow outcome={outcome} onCreate={createFromSearch} />
              </IonList>
              <HiddenMatchNote outcome={outcome} onOpen={openSong} />
            </>
          )}
          {counts.all > 0 ? (
            <p className="type-footnote py-4 text-center tabular-nums">{countLabel}</p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {announced.text}
          </p>
          <CatalogFilterSheet
            open={sheetOpen}
            filters={effective}
            facets={facets}
            visible={visibleFacetList}
            counts={counts}
            onChange={update}
            onClose={() => setSheetOpen(false)}
          />
          <SongFormSheet
            target={form}
            instruments={instruments}
            onClose={() => setForm(null)}
            onSaved={({ songId }) => {
              const created = form?.kind === 'new'
              setForm(null)
              if (created) openSong(songId)
            }}
          />
          {/* Never behind `active`: a successful edit ends the mode while its sheet is still
              dismissing, and unmounting it mid-dismissal strands the overlay. */}
          {bulk.sheets}
        </>
      ) : null}
    </Screen>
  )
}
