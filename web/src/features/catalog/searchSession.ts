// Search text lasts for one app session, unlike the facet filters kept in the meta table:
// a query coming back on a later launch reads as a filter nobody remembers setting.
const KEYS = {
  catalog: 'crosstune.catalogQuery',
  recordings: 'crosstune.recordingsQuery',
} as const

export type SearchScreen = keyof typeof KEYS

export function readSearchQuery(screen: SearchScreen): string {
  try {
    return sessionStorage.getItem(KEYS[screen]) ?? ''
  } catch {
    return ''
  }
}

export function writeSearchQuery(screen: SearchScreen, query: string): void {
  try {
    if (query) sessionStorage.setItem(KEYS[screen], query)
    else sessionStorage.removeItem(KEYS[screen])
  } catch {
    // Blocked storage: the search still works, it just does not survive leaving the screen.
  }
}

/** Whoever signs in next in this tab must not inherit the previous user's searches. */
export function clearSearchQueries(): void {
  for (const screen of Object.keys(KEYS) as SearchScreen[]) writeSearchQuery(screen, '')
}
