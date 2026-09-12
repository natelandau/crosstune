import { STATUSES, type LocalSong, type LocalUserSong, type SongStatus } from '../../db/types'

export interface CatalogFilters {
  query: string
  status: SongStatus | 'all'
  key: string
  mode: string
  tuning: string
  genre: string
  archived: boolean
}

export const DEFAULT_FILTERS: CatalogFilters = {
  query: '',
  status: 'all',
  key: 'all',
  mode: 'all',
  tuning: 'all',
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
  const text = (key: keyof CatalogFilters) =>
    typeof stored[key] === 'string' ? (stored[key] as string) : DEFAULT_FILTERS[key]
  return {
    query: text('query') as string,
    status: isStatus(stored.status) || stored.status === 'all' ? stored.status : 'all',
    key: text('key') as string,
    mode: text('mode') as string,
    tuning: text('tuning') as string,
    genre: text('genre') as string,
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
    if (!facetMatches(filters.key, song.key)) return false
    if (!facetMatches(filters.mode, song.mode)) return false
    if (!facetMatches(filters.tuning, song.tuning)) return false
    if (!facetMatches(filters.genre, song.genre)) return false
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

export function facetValues(entries: CatalogEntry[]) {
  return {
    keys: distinct(entries.map((e) => e.song.key)),
    modes: distinct(entries.map((e) => e.song.mode)),
    tunings: distinct(entries.map((e) => e.song.tuning)),
    genres: distinct(entries.map((e) => e.song.genre)),
  }
}
