import { titleMatches, type CatalogEntry } from './filters'

export type SearchOutcome =
  | { kind: 'none' }
  | { kind: 'hidden'; entry: CatalogEntry; reason: 'archived' | 'filtered' }
  | { kind: 'create'; title: string }

export type EnterAction =
  { kind: 'open'; songId: string } | { kind: 'create'; title: string } | { kind: 'blur' }

/**
 * What the search box should offer beyond the visible results. Exact matches are looked for
 * across the whole catalog so a song hidden by a filter is pointed to instead of duplicated.
 */
export function searchOutcome(
  entries: CatalogEntry[],
  visible: CatalogEntry[],
  query: string,
  archivedShown: boolean,
): SearchOutcome {
  const title = query.trim()
  if (!title || visible.some((e) => titleMatches(e.song, title))) return { kind: 'none' }
  const hidden = entries.find((e) => titleMatches(e.song, title))
  if (!hidden) return { kind: 'create', title }
  const reason = hidden.userSong.archived_at && !archivedShown ? 'archived' : 'filtered'
  return { kind: 'hidden', entry: hidden, reason }
}

export function enterAction(
  query: string,
  visible: CatalogEntry[],
  outcome: SearchOutcome,
): EnterAction {
  if (!query.trim() || visible.length > 1) return { kind: 'blur' }
  const [only] = visible
  if (only) return { kind: 'open', songId: only.song.id }
  if (outcome.kind === 'hidden') return { kind: 'open', songId: outcome.entry.song.id }
  if (outcome.kind === 'create') return { kind: 'create', title: outcome.title }
  return { kind: 'blur' }
}
