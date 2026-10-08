import { titleMatches, type CatalogEntry } from './filters'

export interface HiddenMatch {
  entry: CatalogEntry
  reason: 'archived' | 'filtered'
}

/**
 * `another` is true when some tune already carries the title, so the add row reads as adding a
 * second tune rather than the first. `hidden` is set when every such tune is hidden.
 */
export type SearchOutcome =
  { kind: 'none' } | { kind: 'create'; title: string; another: boolean; hidden?: HiddenMatch }

export type EnterAction =
  { kind: 'open'; tuneId: string } | { kind: 'create'; title: string } | { kind: 'blur' }

/**
 * What the search box should offer beyond the visible results. Different tunes can share a
 * title, so an exact match never suppresses create. Exact matches are looked for across the
 * whole catalog so a tune hidden by a filter is pointed to before a second one is added.
 */
export function searchOutcome(
  entries: CatalogEntry[],
  visible: CatalogEntry[],
  query: string,
  archivedShown: boolean,
): SearchOutcome {
  const title = query.trim()
  if (!title) return { kind: 'none' }
  if (visible.some((e) => titleMatches(e.tune, title))) {
    return { kind: 'create', title, another: true }
  }
  const entry = entries.find((e) => titleMatches(e.tune, title))
  if (!entry) return { kind: 'create', title, another: false }
  const reason = entry.userTune.archived_at && !archivedShown ? 'archived' : 'filtered'
  return { kind: 'create', title, another: true, hidden: { entry, reason } }
}

const NO_OUTCOME: SearchOutcome = { kind: 'none' }

/**
 * Every suggestion under the search leads off the screen, and leaving drops the selection, so
 * while selecting the search offers nothing at all.
 */
export function offeredOutcome(outcome: SearchOutcome, selecting: boolean): SearchOutcome {
  return selecting ? NO_OUTCOME : outcome
}

/**
 * Enter never adds a tune whose title already exists; that takes a deliberate tap. While
 * selecting it only closes the keyboard, since opening or creating would leave the screen.
 */
export function enterAction(
  query: string,
  visible: CatalogEntry[],
  outcome: SearchOutcome,
  selecting = false,
): EnterAction {
  if (selecting || !query.trim() || visible.length > 1) return { kind: 'blur' }
  const [only] = visible
  if (only) return { kind: 'open', tuneId: only.tune.id }
  if (outcome.kind !== 'create') return { kind: 'blur' }
  if (outcome.hidden) return { kind: 'open', tuneId: outcome.hidden.entry.tune.id }
  return { kind: 'create', title: outcome.title }
}
