import type { CatalogEntry } from '../../db/types'
import { catalogComposers, catalogLearnedFrom, orderedTypes } from './tuneTypes'

export interface TuneFormSuggestions {
  /** The genre's types first, then the catalog's by use, then the rest. */
  types: string[]
  composers: string[]
  learnedFrom: string[]
}

/** The catalog-driven suggestions for a tune of this genre, shared by the form and the attribute editors. */
export function suggestionsFor(
  genre: string,
  entries: readonly CatalogEntry[],
): TuneFormSuggestions {
  return {
    types: orderedTypes(genre, entries),
    composers: catalogComposers(entries),
    learnedFrom: catalogLearnedFrom(entries),
  }
}
