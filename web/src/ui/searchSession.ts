import { readStored, writeStored } from '../platform/storage'

// Search text lasts for one app session, unlike the facet filters kept in the meta table:
// a query coming back on a later launch reads as a filter nobody remembers setting.
const KEYS = {
  catalog: 'crosstune.catalogQuery',
  recordings: 'crosstune.recordingsQuery',
} as const

export type SearchScreen = keyof typeof KEYS

export function readSearchQuery(screen: SearchScreen): string {
  return readStored(KEYS[screen], 'session') ?? ''
}

/** Blocked storage drops the query: the search still works, but not after leaving the screen. */
export function writeSearchQuery(screen: SearchScreen, query: string): void {
  writeStored(KEYS[screen], query || null, 'session')
}

/** Whoever signs in next in this tab must not inherit the previous user's searches. */
export function clearSearchQueries(): void {
  for (const screen of Object.keys(KEYS) as SearchScreen[]) writeSearchQuery(screen, '')
}
