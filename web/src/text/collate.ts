const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

/**
 * The order every user-facing list of names sorts in: the reader's locale, ignoring case and
 * accents. One collator, so the catalog, recordings, and Quick Find never disagree. Computed
 * values that must match the Swift client sort with `compareText` in `spelling` instead.
 */
export const compareNames = collator.compare
