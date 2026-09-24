import { STATUSES, type Instrument, type TuneStatus } from '../../api/vocabulary'
import type { LocalSong, LocalUserSong } from '../../db/types'
import { countSongs } from '../selection/copy'
import { TUNING_FIELDS } from '../settings/instruments'

export const FACETS = ['key', 'mode', 'violin_tuning', 'banjo_tuning', 'genre'] as const
export type Facet = (typeof FACETS)[number]

export const FACET_LABELS: Record<Facet, string> = {
  key: 'Key',
  mode: 'Mode',
  violin_tuning: TUNING_FIELDS.violin_tuning.label,
  banjo_tuning: TUNING_FIELDS.banjo_tuning.label,
  genre: 'Genre',
}

const FACET_INSTRUMENT: Partial<Record<Facet, Instrument>> = Object.fromEntries(
  Object.entries(TUNING_FIELDS).map(([field, { instrument }]) => [field, instrument]),
)

export type CatalogFilters = Record<Facet, string> & {
  status: TuneStatus | 'all'
  archived: boolean
}

export const DEFAULT_FILTERS: CatalogFilters = {
  status: 'all',
  key: 'all',
  mode: 'all',
  violin_tuning: 'all',
  banjo_tuning: 'all',
  genre: 'all',
  archived: false,
}

export const META_CATALOG_FILTERS = 'catalog_filters'

export interface CatalogEntry {
  song: LocalSong
  userSong: LocalUserSong
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
  return {
    status: isStatus(stored.status) || stored.status === 'all' ? stored.status : 'all',
    key: text('key'),
    mode: text('mode'),
    violin_tuning: text('violin_tuning'),
    banjo_tuning: text('banjo_tuning'),
    genre: text('genre'),
    archived: stored.archived === true,
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

export function catalogEntries(songs: LocalSong[], userSongs: LocalUserSong[]): CatalogEntry[] {
  const songById = new Map(songs.filter((s) => !s.deleted_at).map((s) => [s.id, s]))
  const entries: CatalogEntry[] = []
  for (const userSong of userSongs) {
    if (userSong.deleted_at) continue
    const song = songById.get(userSong.song_id)
    if (song) entries.push({ song, userSong })
  }
  return entries.sort((a, b) => collator.compare(a.song.title, b.song.title))
}

/** True when the trimmed query equals the song's title or an alternate title, ignoring case and accents. */
export function titleMatches(song: LocalSong, query: string): boolean {
  const q = query.trim()
  return (
    q !== '' && [song.title, ...song.alternate_titles].some((t) => collator.compare(t, q) === 0)
  )
}

export function hideArchived<T extends CatalogEntry>(entries: T[], show: boolean): T[] {
  return show ? entries : entries.filter((entry) => !entry.userSong.archived_at)
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
  return hideArchived(entries, filters.archived).filter(({ song, userSong }) => {
    if (filters.status !== 'all' && userSong.status !== filters.status) return false
    for (const facet of FACETS) {
      if (!facetMatches(filters[facet], song[facet])) return false
    }
    if (!needle) return true
    const haystack = [song.title, ...song.alternate_titles].map((t) => t.toLocaleLowerCase())
    // An exact match ignoring accents must stay visible, or the search would call it hidden.
    return haystack.some((t) => t.includes(needle)) || titleMatches(song, query)
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
    FACETS.map((facet) => [facet, distinct(entries.map((e) => e.song[facet]))]),
  ) as FacetValues
}

/** Facets worth offering: those with values, minus tunings for instruments the user does not play. */
export function visibleFacets(facets: FacetValues, instruments: ReadonlySet<Instrument>): Facet[] {
  return FACETS.filter((facet) => {
    if (facets[facet].length === 0) return false
    const instrument = FACET_INSTRUMENT[facet]
    return instrument === undefined || instruments.has(instrument)
  })
}

/** `all` counts the catalog as stored, so the count row outlives every song being filtered out. */
export interface CatalogCounts {
  visible: number
  total: number
  archived: number
  all: number
}

/** The one wording for a catalog count, so the bar and the filter sheet never disagree. */
export function songCountLabel(visible: number, total: number): string {
  if (visible !== total) return `${visible} of ${total} songs`
  return countSongs(total)
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
export const BAR_FACETS: readonly Facet[] = ['key']

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
