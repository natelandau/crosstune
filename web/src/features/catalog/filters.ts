import { STATUSES, type Instrument, type TuneStatus } from '../../api/vocabulary'
import type { LocalTune, LocalUserTune } from '../../db/types'
import { countTunes } from '../selection/copy'
import { DETAIL_LABELS } from '../tune/detailFields'
import {
  byTuningKey,
  isTuningKey,
  TUNING_KEYS,
  tuningEntry,
  tuningKey,
  tuningKeyInstrument,
  tuningLabel,
} from '../settings/instruments'

/** One tuning facet per instrument, so each instrument's tunings filter on their own. */
export const FACETS = ['key', 'tune_type', 'mode', ...TUNING_KEYS, 'genre'] as const
export type Facet = (typeof FACETS)[number]

export const FACET_LABELS: Record<Facet, string> = {
  key: 'Key',
  tune_type: DETAIL_LABELS.tune_type,
  mode: 'Mode',
  ...byTuningKey(tuningLabel),
  genre: 'Genre',
}

/** Every value a tune holds for a facet: one mode per part, one instrument's tuning from the
 * map, or a column's one value. */
export function facetValuesOf(
  tune: LocalTune,
  facet: Facet,
): readonly (string | null | undefined)[] {
  if (facet === 'mode') return tune.modes
  if (!isTuningKey(facet)) return [tune[facet]]
  const instrument = tuningKeyInstrument(facet)
  return [instrument ? tuningEntry(tune.tunings, instrument).tuning : null]
}

export type CatalogFilters = Record<Facet, string> & {
  status: TuneStatus | 'all'
  archived: boolean
}

export const DEFAULT_FILTERS: CatalogFilters = {
  status: 'all',
  key: 'all',
  tune_type: 'all',
  mode: 'all',
  ...byTuningKey(() => 'all'),
  genre: 'all',
  archived: false,
}

export const META_CATALOG_FILTERS = 'catalog_filters'

export interface CatalogEntry {
  tune: LocalTune
  userTune: LocalUserTune
}

function isStatus(value: unknown): value is TuneStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function normalizeFilters(value: unknown): CatalogFilters {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const text = (key: Facet) =>
    typeof stored[key] === 'string' ? (stored[key] as string) : DEFAULT_FILTERS[key]
  // Only current facet keys are read, so a filter stored under a retired key reads as Any and
  // the next write drops it.
  return {
    status: isStatus(stored.status) || stored.status === 'all' ? stored.status : 'all',
    key: text('key'),
    tune_type: text('tune_type'),
    mode: text('mode'),
    ...byTuningKey((instrument) => text(tuningKey(instrument))),
    genre: text('genre'),
    archived: stored.archived === true,
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

export function catalogEntries(tunes: LocalTune[], userTunes: LocalUserTune[]): CatalogEntry[] {
  const tuneById = new Map(tunes.filter((s) => !s.deleted_at).map((s) => [s.id, s]))
  const entries: CatalogEntry[] = []
  for (const userTune of userTunes) {
    if (userTune.deleted_at) continue
    const tune = tuneById.get(userTune.tune_id)
    if (tune) entries.push({ tune, userTune })
  }
  return entries.sort((a, b) => collator.compare(a.tune.title, b.tune.title))
}

/** True when the trimmed query equals the tune's title or an alternate title, ignoring case and accents. */
export function titleMatches(tune: LocalTune, query: string): boolean {
  const q = query.trim()
  return (
    q !== '' && [tune.title, ...tune.alternate_titles].some((t) => collator.compare(t, q) === 0)
  )
}

export function hideArchived<T extends CatalogEntry>(entries: T[], show: boolean): T[] {
  return show ? entries : entries.filter((entry) => !entry.userTune.archived_at)
}

function facetMatches(filter: string, value: string | null | undefined): boolean {
  return filter === 'all' || (value != null && collator.compare(filter, value) === 0)
}

export function filterCatalog(
  entries: CatalogEntry[],
  filters: CatalogFilters,
  query = '',
): CatalogEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  return hideArchived(entries, filters.archived).filter(({ tune, userTune }) => {
    if (filters.status !== 'all' && userTune.status !== filters.status) return false
    for (const facet of FACETS) {
      const values = facetValuesOf(tune, facet)
      if (filters[facet] !== 'all' && !values.some((value) => facetMatches(filters[facet], value)))
        return false
    }
    if (!needle) return true
    const haystack = [tune.title, ...tune.alternate_titles, tune.composer ?? '']
      .filter(Boolean)
      .map((t) => t.toLocaleLowerCase())
    // An exact match ignoring accents must stay visible, or the search would call it hidden.
    return haystack.some((t) => t.includes(needle)) || titleMatches(tune, query)
  })
}

// Dedupe the way facetMatches compares, so one option stands for every spelling it matches.
function distinct(values: (string | null | undefined)[]): string[] {
  const seen: string[] = []
  for (const value of values) {
    if (value && !seen.some((s) => collator.compare(s, value) === 0)) seen.push(value)
  }
  return seen.sort(collator.compare)
}

export type FacetValues = Record<Facet, string[]>

export function facetValues(entries: CatalogEntry[]): FacetValues {
  return Object.fromEntries(
    FACETS.map((facet) => [facet, distinct(entries.flatMap((e) => facetValuesOf(e.tune, facet)))]),
  ) as FacetValues
}

/** Facets worth offering: those with values, minus tunings for instruments the user does not play. */
export function visibleFacets(facets: FacetValues, instruments: ReadonlySet<Instrument>): Facet[] {
  return FACETS.filter((facet) => {
    if (facets[facet].length === 0) return false
    const instrument = tuningKeyInstrument(facet)
    return instrument === undefined || instruments.has(instrument)
  })
}

/** `all` counts the catalog as stored, so the count row outlives every tune being filtered out. */
export interface CatalogCounts {
  visible: number
  total: number
  archived: number
  all: number
}

/** The one wording for a catalog count, so the bar and the filter sheet never disagree. */
export function tuneCountLabel(visible: number, total: number): string {
  if (visible !== total) return `${visible} of ${total} tunes`
  return countTunes(total)
}

/** A patch that resets every hidden facet, so a change never carries a stale filter along. */
export function hiddenResets(visible: readonly Facet[]): Partial<CatalogFilters> {
  const resets: Partial<CatalogFilters> = {}
  for (const facet of FACETS) {
    if (!visible.includes(facet)) resets[facet] = 'all'
  }
  return resets
}

/** Facets with their own control on the filter bar; every other visible facet lives in the sheet. */
export const BAR_FACETS: readonly Facet[] = ['key', 'tune_type']

export function sheetFacets(visible: readonly Facet[]): Facet[] {
  return visible.filter((facet) => !BAR_FACETS.includes(facet))
}

/** How many sheet filters are set: the badge on the Filters button and the gate on Reset. */
export function sheetFilterCount(filters: CatalogFilters, visible: readonly Facet[]): number {
  const facets = sheetFacets(visible).filter((facet) => filters[facet] !== 'all').length
  return facets + (filters.archived ? 1 : 0)
}

/** A patch that clears the sheet's filters and nothing else. */
export function sheetResets(visible: readonly Facet[]): Partial<CatalogFilters> {
  const patch: Partial<CatalogFilters> = { archived: false }
  for (const facet of sheetFacets(visible)) patch[facet] = 'all'
  return patch
}
