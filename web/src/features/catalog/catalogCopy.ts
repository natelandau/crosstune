import type { HiddenMatch, SearchOutcome } from './searchIntent'

export const ADD_TUNE = 'Add tune'
export const NO_TUNES_HINT = 'Add the first tune you know, or import a list you already keep.'
export const NO_TUNES_TITLE = 'No tunes yet'
export const NOTHING_MATCHES = 'Nothing matches'
export const SEARCH_TUNES = 'Search tunes'
export const SHOW_ARCHIVED = 'Show archived'
/** The link that opens a hidden exact match. */
export const OPEN = 'Open'

type CreateOutcome = Extract<SearchOutcome, { kind: 'create' }>

/** The add row's label, which reads as a second tune when the title is already taken. */
export function addOfferLabel(outcome: CreateOutcome): string {
  return outcome.another ? `Add another "${outcome.title}"` : `Add "${outcome.title}"`
}

/** Names the exact match that search found but a filter or the archived setting hides. */
export function hiddenMatchText({ entry, reason }: HiddenMatch): string {
  return `"${entry.tune.title}" is ${reason === 'archived' ? 'archived' : 'hidden by your filters'}.`
}

/** A picker row's name; every picker searches archived tunes, so the name says which are. */
export function pickRowName(name: string, archived: boolean): string {
  return archived ? `${name}, archived` : name
}

/** The hidden match's Open link, named for the tune it opens. */
export function openTuneName(title: string): string {
  return `Open ${title}`
}

/**
 * What an empty catalog says: no tunes at all, no tune by the typed title, or nothing left
 * once the filters apply.
 */
export function catalogEmpty(
  storedCount: number,
  query: string,
  outcome: SearchOutcome,
): { title: string; hint?: string; noTunes: boolean } {
  const noTunes = storedCount === 0 && !query.trim()
  if (noTunes) return { title: NO_TUNES_TITLE, hint: NO_TUNES_HINT, noTunes }
  if (outcome.kind === 'create' && !outcome.another)
    return { title: `No tune called "${outcome.title}"`, noTunes }
  return { title: NOTHING_MATCHES, noTunes }
}

/** The name of the catalog's list of tune rows. */
export const TUNE_LIST = 'Tunes'

export const SELECT_TUNES = 'Select tunes'
