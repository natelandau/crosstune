// Search text lasts for one app session, unlike the facet filters kept in the meta table:
// a query coming back on a later launch reads as a filter nobody remembers setting.
const KEY = 'crosstune.catalogQuery'

export function readSearchQuery(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeSearchQuery(query: string): void {
  try {
    if (query) sessionStorage.setItem(KEY, query)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Blocked storage: the search still works, it just does not survive leaving the catalog.
  }
}

export function clearSearchQuery(): void {
  writeSearchQuery('')
}
