import { TUNING_FIELDS } from '../settings/instruments'
import {
  STATUSES,
  type Instrument,
  type LocalSong,
  type LocalUserSong,
  type SongStatus,
} from '../../db/types'

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
  query: string
  status: SongStatus | 'all'
  archived: boolean
}

export const DEFAULT_FILTERS: CatalogFilters = {
  query: '',
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

function isStatus(value: unknown): value is SongStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function normalizeFilters(value: unknown): CatalogFilters {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const text = (key: Facet | 'query') =>
    typeof stored[key] === 'string' ? (stored[key] as string) : DEFAULT_FILTERS[key]
  return {
    query: text('query'),
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

function facetMatches(filter: string, value: string | null | undefined): boolean {
  return filter === 'all' || (value != null && collator.compare(filter, value) === 0)
}

export function filterCatalog(entries: CatalogEntry[], filters: CatalogFilters): CatalogEntry[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return entries.filter(({ song, userSong }) => {
    if (!filters.archived && userSong.archived_at) return false
    if (filters.status !== 'all' && userSong.status !== filters.status) return false
    for (const facet of FACETS) {
      if (!facetMatches(filters[facet], song[facet])) return false
    }
    if (!query) return true
    const haystack = [song.title, ...song.alternate_titles].map((t) => t.toLocaleLowerCase())
    return haystack.some((t) => t.includes(query))
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

/** A patch that resets every hidden facet, so a change never carries a stale filter along. */
export function hiddenResets(visible: readonly Facet[]): Partial<CatalogFilters> {
  const resets: Partial<CatalogFilters> = {}
  for (const facet of FACETS) {
    if (!visible.includes(facet)) resets[facet] = 'all'
  }
  return resets
}
