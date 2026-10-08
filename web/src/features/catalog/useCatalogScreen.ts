import { useCallback, useMemo, useState } from 'react'
import type { Instrument } from '../../api/vocabulary'
import type { SortChoice } from '../../ui/sortChoice'
import { useScanTuneIds } from '../scans/useScans'
import { isTuningKey } from '../../domain/instruments'
import { useInstruments } from '../settings/useInstruments'
import { sortCatalog, type CatalogSort } from './catalogSort'
import {
  DEFAULT_FILTERS,
  facetValues,
  filterCatalog,
  hiddenResets,
  hideArchived,
  missingChoices,
  tuneCountLabel,
  visibleFacets,
  type CatalogCounts,
  type CatalogEntry,
  type CatalogFilters,
  type Facet,
  type FacetValues,
  type HeardEntry,
  type MissingAttribute,
} from './filters'
import { sheetFilters, type SheetFilters } from './filterLabels'
import { enterAction, searchOutcome, type EnterAction, type SearchOutcome } from './searchIntent'
import { readSearchQuery, writeSearchQuery } from '../../ui/searchSession'
import { useCatalog } from './useCatalog'
import { useCatalogFilters } from './useCatalogFilters'
import { setCatalogSort, useCatalogSort } from './useCatalogSort'
import { useLastPlayed } from './useLastPlayed'

const NO_ENTRIES: HeardEntry[] = []
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

export interface CatalogScreenOptions {
  onOpenTune(id: string): void
  onCreate(title: string): void
  /** The facets with their own control on the screen, which the sheet count leaves out. */
  barFacets?: readonly Facet[]
}

export interface CatalogScreen {
  /** False until the entries, filters, and instruments have all been read. */
  ready: boolean
  /** Every stored tune, unfiltered. */
  entries: HeardEntry[]
  instruments: ReadonlySet<Instrument>
  /** Ids of the tunes that have a scan. */
  scanTunes: ReadonlySet<string>
  /** The visible tunes, filtered, searched, and sorted. */
  tunes: CatalogEntry[]
  counts: CatalogCounts
  countLabel: string
  /** The stored filters. Screens render from `effectiveFilters`, which also drops hidden facets. */
  storedFilters: CatalogFilters
  /** Writes a filter patch, forgetting any facet the musician cannot see. */
  setFilters(patch: Partial<CatalogFilters>): Promise<void>
  /** The filters with hidden-facet resets applied, which is what narrows the list. */
  effectiveFilters: CatalogFilters
  filterError: string | null
  /** Every facet value some tune holds. */
  facets: FacetValues
  /** The facets the musician can see. */
  visibleFacets: Facet[]
  missingOptions: MissingAttribute[]
  sheetCount: number
  /** The sheet's facets, count, tokens, and Reset, all from `barFacets`. */
  sheet: SheetFilters
  query: string
  /** Sets the query and keeps it for the rest of the session. */
  setQuery(value: string): void
  searchOutcome: SearchOutcome
  /**
   * Applies the Enter rules and returns what they decided, so the screen can blur on `blur`.
   * Pass `selecting` while a selection mode is active. Returns null while loading, when Enter
   * leaves focus where it is.
   */
  submit(selecting?: boolean): EnterAction | null
  /** Ends the search and hands the typed title to `onCreate`. */
  createFromSearch(title?: string): void
  sort: SortChoice<CatalogSort>
  setSort: typeof setCatalogSort
  /** The count for a live region, empty on load. */
  announcement: string
  /** Re-reads the session query, for when another screen cleared it while this one stayed mounted. */
  refreshQuery(): void
}

export function useCatalogScreen({
  onOpenTune,
  onCreate,
  barFacets,
}: CatalogScreenOptions): CatalogScreen {
  const loadedEntries = useCatalog(true, { heard: true })
  const [storedFilters, updateFilters, filterError] = useCatalogFilters()
  const loadedInstruments = useInstruments()
  const scanTunes = useScanTuneIds()
  const ready =
    loadedEntries !== undefined && storedFilters !== undefined && loadedInstruments !== undefined
  const entries = loadedEntries ?? NO_ENTRIES
  const filters = storedFilters ?? DEFAULT_FILTERS
  const instruments = loadedInstruments ?? NO_INSTRUMENTS
  const [query, setQueryState] = useState(() => readSearchQuery('catalog'))

  const facets = useMemo(() => facetValues(entries), [entries])
  const visibleFacetList = useMemo(() => visibleFacets(facets, instruments), [facets, instruments])
  // A facet the musician cannot see must not narrow the list, and every write forgets it, so
  // turning an instrument back on later does not bring a stale filter back with it.
  const resets = useMemo(
    () => hiddenResets(visibleFacetList, filters.missing),
    [visibleFacetList, filters.missing],
  )
  const missingOptions = useMemo(
    () =>
      missingChoices(entries).filter(
        (attribute) => !isTuningKey(attribute) || visibleFacetList.includes(attribute),
      ),
    [entries, visibleFacetList],
  )
  const effective = useMemo(() => ({ ...filters, ...resets }), [filters, resets])
  const sheet = useMemo(
    () => sheetFilters(effective, visibleFacetList, barFacets),
    [effective, visibleFacetList, barFacets],
  )
  const setFilters = useCallback(
    (patch: Partial<CatalogFilters>) => updateFilters({ ...resets, ...patch }),
    [resets, updateFilters],
  )
  const sort = useCatalogSort()
  const lastPlayed = useLastPlayed(sort.sort === 'played')
  const tunes = useMemo(
    () => sortCatalog(filterCatalog(entries, effective, query), sort, lastPlayed),
    [entries, effective, query, sort, lastPlayed],
  )
  // Catalog-wide counts change with the stored tunes, not with each search keystroke.
  const stored = useMemo(
    () => ({
      total: hideArchived(entries, effective.archived).length,
      archived: entries.filter((entry) => entry.userTune.archived_at !== null).length,
      all: entries.length,
    }),
    [entries, effective.archived],
  )
  const counts = useMemo(() => ({ ...stored, visible: tunes.length }), [stored, tunes.length])
  const countLabel = tuneCountLabel(counts.visible, counts.total)

  const outcome = useMemo(
    () => searchOutcome(entries, tunes, query, effective.archived),
    [entries, tunes, query, effective.archived],
  )
  // A count read out on every keystroke would talk over the typing, so the live region only
  // takes a new count when the filters or the stored tunes change, and stays quiet on load.
  const [announced, setAnnounced] = useState({ effective, entries, ready, text: '' })
  if (
    announced.effective !== effective ||
    announced.entries !== entries ||
    announced.ready !== ready
  ) {
    setAnnounced({ effective, entries, ready, text: announced.ready && ready ? countLabel : '' })
  }

  const setQuery = (value: string) => {
    setQueryState(value)
    writeSearchQuery('catalog', value)
  }
  const refreshQuery = useCallback(() => setQueryState(readSearchQuery('catalog')), [])
  const createFromSearch = (title?: string) => {
    const typed = title ?? (outcome.kind === 'create' ? outcome.title : undefined)
    if (typed === undefined) return
    // A tune created from the search ends that search, whatever the form's outcome.
    setQuery('')
    onCreate(typed)
  }
  const submit = (selecting = false): EnterAction | null => {
    if (!ready) return null
    const action = enterAction(query, tunes, outcome, selecting)
    if (action.kind === 'open') onOpenTune(action.tuneId)
    else if (action.kind === 'create') createFromSearch(action.title)
    return action
  }

  return {
    ready,
    entries,
    instruments,
    scanTunes,
    tunes,
    counts,
    countLabel,
    storedFilters: filters,
    setFilters,
    effectiveFilters: effective,
    filterError,
    facets,
    visibleFacets: visibleFacetList,
    missingOptions,
    sheetCount: sheet.count,
    sheet,
    query,
    setQuery,
    searchOutcome: outcome,
    submit,
    createFromSearch,
    sort,
    setSort: setCatalogSort,
    announcement: announced.text,
    refreshQuery,
  }
}
