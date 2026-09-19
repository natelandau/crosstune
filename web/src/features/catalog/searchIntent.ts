import { titleMatches, type CatalogEntry } from './filters'

export interface HiddenMatch {
  entry: CatalogEntry
  reason: 'archived' | 'filtered'
}

/**
 * `another` is true when some song already carries the title, so the add row reads as adding a
 * second song rather than the first. `hidden` is set when every such song is hidden.
 */
export type SearchOutcome =
  { kind: 'none' } | { kind: 'create'; title: string; another: boolean; hidden?: HiddenMatch }

export type EnterAction =
  { kind: 'open'; songId: string } | { kind: 'create'; title: string } | { kind: 'blur' }

/**
 * What the search box should offer beyond the visible results. Different songs can share a
 * title, so an exact match never suppresses create. Exact matches are looked for across the
 * whole catalog so a song hidden by a filter is pointed to before a second one is added.
 */
export function searchOutcome(
  entries: CatalogEntry[],
  visible: CatalogEntry[],
  query: string,
  archivedShown: boolean,
): SearchOutcome {
  const title = query.trim()
  if (!title) return { kind: 'none' }
  if (visible.some((e) => titleMatches(e.song, title))) {
    return { kind: 'create', title, another: true }
  }
  const entry = entries.find((e) => titleMatches(e.song, title))
  if (!entry) return { kind: 'create', title, another: false }
  const reason = entry.userSong.archived_at && !archivedShown ? 'archived' : 'filtered'
  return { kind: 'create', title, another: true, hidden: { entry, reason } }
}

/** Enter never adds a song whose title already exists; that takes a deliberate tap. */
export function enterAction(
  query: string,
  visible: CatalogEntry[],
  outcome: SearchOutcome,
): EnterAction {
  if (!query.trim() || visible.length > 1) return { kind: 'blur' }
  const [only] = visible
  if (only) return { kind: 'open', songId: only.song.id }
  if (outcome.kind !== 'create') return { kind: 'blur' }
  if (outcome.hidden) return { kind: 'open', songId: outcome.hidden.entry.song.id }
  return { kind: 'create', title: outcome.title }
}
